"""
bullseye_route.py
=================
FastAPI router for the LV and RV bullseye analyses.

The geometry (slices, rays, segments, lengths, areas) is in
bullseye_analysis.py. This file loads the NIfTI masks, applies the strain
formulas and builds the JSON responses.

Strain formula used everywhere:  (ES - ED) / ED x 100   (%)
    negative = shortening / shrinking, positive = thickening.

Endpoints
---------
POST /bullseye/analyze
    LV wall thickness (AHA 17 segments) — direct NIfTI file upload
    (.nii or .nii.gz). Accepts multipart/form-data with field `file`.

POST /bullseye/analyze-from-s3
    Same analysis — from a presigned S3 URL.
    Accepts JSON body with `s3_url` and optional `request_id`.

POST /bullseye/compute-strain
    LV strain. Accepts ED and ES NIfTI files + optional RV insertion points.
    Returns GRS and GCS per AHA segment, plus the global values.

POST /bullseye/compute-rv-strain
    RV strain. Accepts ED and ES NIfTI files + optional RV insertion points.
    Returns GCS and GAS (separate, not combined) per RV free-wall segment
    (basal/mid/apical x 3), plus RV septal GCS per ring (septal_regions).

Both analyze endpoints return the same BullseyeAnalysisResult schema.

Alignment
---------
The LV segments are positioned from the ANTERIOR RV insertion point
(rv_insertion_1): segment 1 is the 60° that end at it, segments 2–3 are the
septum. If no landmark is sent, the point is estimated from the RV in the
mask. Each result says which was used in `alignment_source`:
"landmark", "rv-mask" (estimated) or "fixed-angle" (mask has no RV).

Units
-----
The two analyze endpoints return wall thickness in PIXELS (no voxel size is
applied). The two strain endpoints also return lengths / areas in mm / mm²,
using the in-plane voxel size from the NIfTI header (`vox_xy_mm`). Strain is
a percentage, so it does not depend on the voxel size.
"""

from __future__ import annotations

import tempfile
import os
from typing import Annotated, List, Optional

import numpy as np
import nibabel as nib
import aiohttp

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from security.backend_authentication import conditional_verify_jwt, TokenPayLoad
from classes.pydantic_schema import (
    BullseyeAnalysisResult,
    BullseyeS3Request,
)
from bullseye_analysis import (
    AHA_SEGMENTS,
    RING_NAMES,
    classify_slices,
    estimate_anterior_rv_insertion,
    mask_to_17_segments,
    mask_to_rv_regions,
)

router = APIRouter()

# ── internal helpers ──────────────────────────────────────────────────────────

def _load_nifti_bytes(data: bytes) -> np.ndarray:
    """Load a NIfTI mask from raw bytes (via a temp file) and return it as a
    3-D uint8 array. A 4-D file is collapsed to 3-D — see the comment below."""
    suffix = ".nii.gz" if data[:2] == b"\x1f\x8b" else ".nii"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        tmp.write(data)
        tmp.flush()
        tmp.close()
        try:
            img = nib.load(tmp.name)
        except Exception as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Failed to parse NIfTI data: {exc}. File may be corrupt or not a valid NIfTI."
            )
        arr = np.asarray(img.dataobj)
        if arr.ndim == 4:
            # 4D NIfTI (H×W×slices×frames): collapse frames by taking max label per voxel.
            # The result is therefore NOT one cardiac frame (e.g. not ED): each
            # voxel keeps the highest class it had in any frame
            # (LV cavity 3 > myocardium 2 > RV 1 > background 0).
            arr = arr.max(axis=-1)
        if arr.ndim != 3:
            raise HTTPException(
                status_code=422,
                detail=f"Expected a 3-D NIfTI mask (H×W×N_slices), got shape {arr.shape}."
            )
        return arr.astype(np.uint8)
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def _load_strain_mask(data: bytes, fname: str):
    """Load one ED or ES mask for the two strain routes (LV and RV).

    Returns (mask as a 3-D uint8 array, in-plane voxel size in mm per pixel).
    Raises ValueError on a bad shape; the routes turn that into a 422.
    """
    suffix = ".nii.gz" if (fname or "").endswith(".gz") else ".nii"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        tmp.write(data)
        tmp.flush()
        tmp.close()
        img = nib.load(tmp.name)
        arr = np.asarray(img.dataobj)
        # A 4-D file is collapsed across frames (max label per voxel). The
        # server sends ONE cardiac frame per file (a 4-D file with a single
        # frame), so this only drops the frame axis.
        if arr.ndim == 4:
            arr = arr.max(axis=-1)
        if arr.ndim != 3:
            raise ValueError(f"Expected 3-D mask, got shape {arr.shape}")
        # In-plane voxel size (mm per pixel) from the NIfTI header; 1.0 if missing.
        zooms = img.header.get_zooms()
        vox_xy = abs(float(zooms[0])) if len(zooms) > 0 and abs(float(zooms[0])) > 0 else 1.0
        return arr.astype(np.uint8), vox_xy
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def _run_analysis(
    mask_3d: np.ndarray,
    request_id: Optional[str],
    rv_insertion_1: Optional[tuple[float, float]] = None,
    rv_insertion_2: Optional[tuple[float, float]] = None,
) -> BullseyeAnalysisResult:
    """CPU-bound analysis — called via run_in_threadpool.
    LV wall thickness per AHA segment, in pixels."""
    if not np.any(mask_3d == 2):
        raise HTTPException(
            status_code=422,
            detail="Mask contains no myocardium (class 2) pixels. Cannot compute wall thickness."
        )

    analysis = mask_to_17_segments(mask_3d, rv_insertion_1=rv_insertion_1, rv_insertion_2=rv_insertion_2)
    values: np.ndarray = analysis["values"]
    lv_centroid: Optional[List[float]] = analysis["lv_centroid"]
    slice_labels: list[str] = classify_slices(mask_3d)

    # NaN → None. FastAPI's JSON encoder rejects NaN (it would fail the whole
    # request with a 500), so a segment that could not be measured is returned
    # as null, and the stats below skip it — they are None when every segment
    # is invalid (e.g. too little myocardium in every slice).
    segment_values: List[Optional[float]] = [
        None if np.isnan(v) else float(v) for v in values
    ]
    n_nan = int(np.sum(np.isnan(values)))
    valid_values = values[~np.isnan(values)]

    stats = {
        "min":   float(np.min(valid_values)) if valid_values.size > 0 else None,
        "max":   float(np.max(valid_values)) if valid_values.size > 0 else None,
        "mean":  float(np.mean(valid_values)) if valid_values.size > 0 else None,
        "n_nan": n_nan,
    }

    segment_metadata = [
        {
            "idx":   seg["idx"],
            "name":  seg["name"],
            "ring":  RING_NAMES[seg["ring"]],
            "value": segment_values[i],
        }
        for i, seg in enumerate(AHA_SEGMENTS)
    ]

    return BullseyeAnalysisResult(
        request_id=request_id,
        segment_values=segment_values,
        segment_metadata=segment_metadata,
        stats=stats,
        input_shape=list(mask_3d.shape),
        slice_labels=slice_labels,
        lv_centroid=lv_centroid,
        alignment_angle_deg=analysis.get("alignment_angle_deg"),
        alignment_source=analysis.get("alignment_source"),
    )


async def _download_nifti_from_url(url: str) -> bytes:
    """Download raw bytes from a presigned URL using aiohttp."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status == 403:
                    raise HTTPException(status_code=422, detail="S3 presigned URL access denied (403). URL may have expired.")
                if response.status != 200:
                    raise HTTPException(
                        status_code=422,
                        detail=f"Failed to download NIfTI from S3: HTTP {response.status}."
                    )
                return await response.read()
    except HTTPException:
        raise
    except aiohttp.ClientError as exc:
        raise HTTPException(status_code=422, detail=f"Network error downloading from S3: {exc}")


# ── Route A: direct file upload ───────────────────────────────────────────────

@router.post(
    "/analyze",
    response_model=BullseyeAnalysisResult,
    summary="AHA 17-segment analysis — direct NIfTI upload",
    tags=["Bullseye"],
)
async def analyze_bullseye_upload(
    token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
    file: UploadFile = File(..., description="NIfTI mask file (.nii or .nii.gz)"),
    rv_insertion_1_x: Optional[float] = Form(default=None),
    rv_insertion_1_y: Optional[float] = Form(default=None),
    rv_insertion_2_x: Optional[float] = Form(default=None),
    rv_insertion_2_y: Optional[float] = Form(default=None),
) -> BullseyeAnalysisResult:
    """
    Accept a NIfTI segmentation mask as a multipart upload and return
    the AHA 17-segment wall-thickness analysis (values in pixels).

    The mask should be 3-D (H × W × N_slices) with class values:
    0=background, 1=RV, 2=myocardium, 3=LV cavity.
    A 4-D mask (… × frames) is also accepted, but it is collapsed across
    frames — see _load_nifti_bytes.

    Optional form fields rv_insertion_1_x/y and rv_insertion_2_x/y provide
    RV insertion point coordinates (pixel coords) for anatomical alignment.
    Point 1 is the anterior insertion point; only point 1 is used. Without
    it, the point is estimated from the RV in the mask.
    """
    fname = file.filename or ""
    if not (fname.endswith(".nii") or fname.endswith(".nii.gz")):
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{fname}'. Only .nii and .nii.gz are accepted."
        )

    rv1 = (rv_insertion_1_x, rv_insertion_1_y) if rv_insertion_1_x is not None and rv_insertion_1_y is not None else None
    rv2 = (rv_insertion_2_x, rv_insertion_2_y) if rv_insertion_2_x is not None and rv_insertion_2_y is not None else None

    raw = await file.read()
    mask_3d = await run_in_threadpool(_load_nifti_bytes, raw)
    return await run_in_threadpool(_run_analysis, mask_3d, None, rv1, rv2)


# ── Route B: S3 presigned URL ─────────────────────────────────────────────────

@router.post(
    "/analyze-from-s3",
    response_model=BullseyeAnalysisResult,
    summary="AHA 17-segment analysis — S3 presigned URL",
    tags=["Bullseye"],
)
async def analyze_bullseye_s3(
    token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
    request: BullseyeS3Request,
) -> BullseyeAnalysisResult:
    """
    Download a NIfTI segmentation mask from an S3 presigned URL and return
    the AHA 17-segment wall-thickness analysis (values in pixels).

    The mask should be 3-D (H × W × N_slices) with class values:
    0=background, 1=RV, 2=myocardium, 3=LV cavity.
    A 4-D mask (… × frames) is also accepted, but it is collapsed across
    frames — see _load_nifti_bytes.
    """
    rv1 = tuple(request.rv_insertion_1) if request.rv_insertion_1 is not None else None
    rv2 = tuple(request.rv_insertion_2) if request.rv_insertion_2 is not None else None

    raw = await _download_nifti_from_url(str(request.s3_url))
    mask_3d = await run_in_threadpool(_load_nifti_bytes, raw)
    return await run_in_threadpool(_run_analysis, mask_3d, request.request_id, rv1, rv2)


# ── Route C: compute strain from ED + ES NIfTI uploads ───────────────────────

# Segment names by index (1–17): the standard AHA 17-segment model. Same order
# as AHA_SEGMENTS in bullseye_analysis.py — see the notes there.
_AHA_NAMES = [
    "Basal Anterior", "Basal Anteroseptal", "Basal Inferoseptal",
    "Basal Inferior", "Basal Inferolateral", "Basal Anterolateral",
    "Mid Anterior",   "Mid Anteroseptal",    "Mid Inferoseptal",
    "Mid Inferior",   "Mid Inferolateral",   "Mid Anterolateral",
    "Apical Anterior", "Apical Septal",       "Apical Inferior",
    "Apical Lateral",  "Apex",
]


def _compute_strain_sync(
    ed_bytes: bytes,
    es_bytes: bytes,
    ed_fname: str,
    es_fname: str,
    rv1: Optional[tuple[float, float]],
    rv2: Optional[tuple[float, float]],
) -> dict:
    """CPU-bound: load both NIfTIs, run mask_to_17_segments on each, compute GRS/GCS.

    GRS = % change in wall thickness, ED → ES.
    GCS = mean of the % changes in the outer, mid-wall and inner boundary lengths.

    ED and ES are each analysed on their own (ES gets its own slice
    classification) — unlike the RV route, which reuses ED's layout at ES.
    """

    # The voxel size is taken from the ED file and used for both frames.
    mask_ed, vox_xy = _load_strain_mask(ed_bytes, ed_fname)
    mask_es, _      = _load_strain_mask(es_bytes, es_fname)

    if not np.any(mask_ed == 2):
        raise ValueError("ED mask contains no myocardium (class 2) pixels.")
    if not np.any(mask_es == 2):
        raise ValueError("ES mask contains no myocardium (class 2) pixels.")

    # No landmark → estimate the anterior RV insertion point ONCE, from the ED
    # mask, and use that same point for both frames, so ED and ES are split
    # into the same wedges (estimating it separately per frame would shift the
    # segment borders between the two).
    align_pt = rv1
    estimated_from_mask = False
    if align_pt is None:
        align_pt = estimate_anterior_rv_insertion(mask_ed)
        estimated_from_mask = align_pt is not None

    res_ed = mask_to_17_segments(mask_ed, rv_insertion_1=align_pt, rv_insertion_2=rv2)
    res_es = mask_to_17_segments(mask_es, rv_insertion_1=align_pt, rv_insertion_2=rv2)

    wt_ed   = np.array(res_ed["values"],      dtype=float)
    wt_es   = np.array(res_es["values"],      dtype=float)
    # GCS follows alignment_17seg_update.ipynb's method: compute circumferential
    # strain independently at the outer, mid-wall, and inner myocardium
    # boundaries (each boundary's "circumference" is a summed per-sector chord
    # length, not 2π×radius), then average the three boundaries' strains.
    # (The notebook's method is used at the client's request.)
    outer_chord_ed = np.array(res_ed["outer_circ_chord"], dtype=float)
    outer_chord_es = np.array(res_es["outer_circ_chord"], dtype=float)
    mid_chord_ed   = np.array(res_ed["mid_circ_chord"],   dtype=float)
    mid_chord_es   = np.array(res_es["mid_circ_chord"],   dtype=float)
    inner_chord_ed = np.array(res_ed["inner_circ_chord"], dtype=float)
    inner_chord_es = np.array(res_es["inner_circ_chord"], dtype=float)

    def _boundary_strain(ed: np.ndarray, es: np.ndarray, i: int) -> float | None:
        ed_v, es_v = float(ed[i]), float(es[i])
        if np.isnan(ed_v) or np.isnan(es_v) or ed_v <= 0:
            return None
        return (es_v - ed_v) / ed_v * 100.0

    segments = []
    grs_vals: list[float] = []
    gcs_vals: list[float] = []
    # Pooled for ratio-of-means global aggregation (see below).
    valid_wt_ed_for_grs: list[float] = []
    valid_wt_es_for_grs: list[float] = []
    valid_outer_ed: list[float] = []
    valid_outer_es: list[float] = []
    valid_mid_ed: list[float] = []
    valid_mid_es: list[float] = []
    valid_inner_ed: list[float] = []
    valid_inner_es: list[float] = []

    for i, name in enumerate(_AHA_NAMES):
        ed_v = float(wt_ed[i])   if not np.isnan(wt_ed[i])   else None
        es_v = float(wt_es[i])   if not np.isnan(wt_es[i])   else None

        # GRS: % change in this segment's wall thickness, ED → ES.
        grs: float | None = None
        if ed_v is not None and es_v is not None and ed_v > 0:
            grs = round((es_v - ed_v) / ed_v * 100.0, 2)
            grs_vals.append(grs)
            valid_wt_ed_for_grs.append(ed_v)
            valid_wt_es_for_grs.append(es_v)

        outer_strain = _boundary_strain(outer_chord_ed, outer_chord_es, i)
        mid_strain   = _boundary_strain(mid_chord_ed,   mid_chord_es,   i)
        inner_strain = _boundary_strain(inner_chord_ed, inner_chord_es, i)

        # GCS: mean of the boundary strains that could be computed (up to three).
        gcs: float | None = None
        boundary_strains = [s for s in (outer_strain, mid_strain, inner_strain) if s is not None]
        if boundary_strains:
            gcs = round(float(np.mean(boundary_strains)), 2)
            gcs_vals.append(gcs)
            if outer_strain is not None:
                valid_outer_ed.append(float(outer_chord_ed[i])); valid_outer_es.append(float(outer_chord_es[i]))
            if mid_strain is not None:
                valid_mid_ed.append(float(mid_chord_ed[i]));     valid_mid_es.append(float(mid_chord_es[i]))
            if inner_strain is not None:
                valid_inner_ed.append(float(inner_chord_ed[i])); valid_inner_es.append(float(inner_chord_es[i]))

        segments.append({
            "segment":   i + 1,
            "label":     name,
            "grs":       grs,
            "gcs":       gcs,
            "wt_ed_mm":  round(ed_v * vox_xy, 3) if ed_v is not None else None,
            "wt_es_mm":  round(es_v * vox_xy, 3) if es_v is not None else None,
        })

    # Global metrics: ratio-of-means (pool valid segments' wt/chord-sum first,
    # then take one ratio) instead of mean-of-ratios (averaging 17 percent-changes).
    # Mean-of-ratios gives small/noisy segments (e.g. apex) equal weight to
    # large, stable ones — a known source of bias in per-segment strain pooling.
    # For GCS this ratio-of-means is computed per boundary, then the three
    # boundaries' global strains are averaged — mirroring the per-segment method.
    if valid_wt_ed_for_grs:
        mean_wt_ed = float(np.mean(valid_wt_ed_for_grs))
        mean_wt_es = float(np.mean(valid_wt_es_for_grs))
        global_grs = round((mean_wt_es - mean_wt_ed) / mean_wt_ed * 100.0, 2) if mean_wt_ed > 0 else None
    else:
        global_grs = None

    def _global_boundary_strain(ed_list: list[float], es_list: list[float]) -> float | None:
        if not ed_list:
            return None
        mean_ed = float(np.mean(ed_list))
        mean_es = float(np.mean(es_list))
        return (mean_es - mean_ed) / mean_ed * 100.0 if mean_ed > 0 else None

    global_boundary_strains = [
        s for s in (
            _global_boundary_strain(valid_outer_ed, valid_outer_es),
            _global_boundary_strain(valid_mid_ed, valid_mid_es),
            _global_boundary_strain(valid_inner_ed, valid_inner_es),
        ) if s is not None
    ]
    global_gcs = round(float(np.mean(global_boundary_strains)), 2) if global_boundary_strains else None

    valid_ed_mm = [float(v) * vox_xy for v in wt_ed if not np.isnan(v)]
    valid_es_mm = [float(v) * vox_xy for v in wt_es if not np.isnan(v)]

    return {
        "segments":          segments,
        "global_grs":        global_grs,
        "global_gcs":        global_gcs,
        "ed_wt_mean_mm":     round(float(np.mean(valid_ed_mm)), 3) if valid_ed_mm else None,
        "es_wt_mean_mm":     round(float(np.mean(valid_es_mm)), 3) if valid_es_mm else None,
        "vox_xy_mm":         vox_xy,
        "alignment_source":  "rv-mask" if estimated_from_mask else res_ed.get("alignment_source", "fixed-angle"),
        "alignment_angle_deg": res_ed.get("alignment_angle_deg"),
    }


@router.post(
    "/compute-strain",
    summary="Compute GRS and GCS from ED + ES segmentation NIfTIs",
    tags=["Bullseye"],
)
async def compute_strain(
    token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
    ed_file: UploadFile = File(..., description="ED frame segmentation NIfTI (.nii or .nii.gz)"),
    es_file: UploadFile = File(..., description="ES frame segmentation NIfTI (.nii or .nii.gz)"),
    rv_insertion_1_x: Optional[float] = Form(default=None),
    rv_insertion_1_y: Optional[float] = Form(default=None),
    rv_insertion_2_x: Optional[float] = Form(default=None),
    rv_insertion_2_y: Optional[float] = Form(default=None),
):
    """
    Upload segmentation masks for End-Diastole (ED) and End-Systole (ES) frames.
    Returns GRS (wall thickening) and GCS (circumferential shortening) per AHA
    segment, plus the global values.

    Each mask should hold one cardiac frame: 3-D (H × W × N_slices), or 4-D
    with a single frame, with class values:
    0=background, 1=RV, 2=myocardium, 3=LV cavity.
    """
    for f, label in ((ed_file, "ed_file"), (es_file, "es_file")):
        fname = f.filename or ""
        if not (fname.endswith(".nii") or fname.endswith(".nii.gz")):
            raise HTTPException(
                status_code=422,
                detail=f"Unsupported file type for {label}: '{fname}'. Only .nii and .nii.gz are accepted."
            )

    rv1 = (rv_insertion_1_x, rv_insertion_1_y) if rv_insertion_1_x is not None and rv_insertion_1_y is not None else None
    rv2 = (rv_insertion_2_x, rv_insertion_2_y) if rv_insertion_2_x is not None and rv_insertion_2_y is not None else None

    ed_bytes = await ed_file.read()
    es_bytes = await es_file.read()

    try:
        result = await run_in_threadpool(
            _compute_strain_sync,
            ed_bytes, es_bytes,
            ed_file.filename or "ed.nii.gz",
            es_file.filename or "es.nii.gz",
            rv1, rv2,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return result


# ── Route D: compute regional RV strain from ED + ES NIfTI uploads ───────────
# 9-segment RV bullseye (basal/mid/apical x 3 sections), rays from the LV
# centre — see bullseye_analysis.mask_to_rv_regions. There is no RV free-wall
# myocardium label in this mask, so per segment this reports GCS (free-wall
# chord % change) and GAS (cavity area % change) rather than wall thickening.
# GCS and GAS are reported separately and are never combined into one value.
# The septal side of the RV gets its own GCS, one value per ring.

def _compute_rv_strain_sync(
    ed_bytes: bytes,
    es_bytes: bytes,
    ed_fname: str,
    es_fname: str,
    rv1: Optional[tuple[float, float]],
    rv2: Optional[tuple[float, float]],
) -> dict:
    """CPU-bound: load both NIfTIs, run mask_to_rv_regions on each, compute per-region strain.

    Per free-wall segment (9): GCS = % change in free-wall length,
                               GAS = % change in cavity area.
    Per ring (3):              septal GCS = % change in septal-side length.
    All ED → ES; negative = shortening / shrinking.
    """

    # The voxel size is taken from the ED file and used for both frames.
    mask_ed, vox_xy = _load_strain_mask(ed_bytes, ed_fname)
    mask_es, _      = _load_strain_mask(es_bytes, es_fname)

    if not np.any(mask_ed == 1):
        raise ValueError("ED mask contains no RV (class 1) pixels.")
    if not np.any(mask_es == 1):
        raise ValueError("ES mask contains no RV (class 1) pixels.")

    # ES reuses ED's slice→ring assignment and ray→section wedges, so each of
    # the 9 segments compares the same anatomical slices and angles.
    res_ed = mask_to_rv_regions(mask_ed, rv_insertion_1=rv1, rv_insertion_2=rv2)
    res_es = mask_to_rv_regions(mask_es, rv_insertion_1=rv1, rv_insertion_2=rv2, layout=res_ed["layout"])

    # NaN → None (a measurement that could not be made).
    def _opt(arr: np.ndarray, i: int) -> float | None:
        v = float(arr[i])
        return None if np.isnan(v) else v

    # THE STRAIN FORMULA: % change from ED to ES. Used for GCS, GAS and septal GCS.
    def _pct(ed_v: float | None, es_v: float | None) -> float | None:
        if ed_v is None or es_v is None or ed_v <= 0:
            return None
        return round((es_v - ed_v) / ed_v * 100.0, 2)

    # Pixels → mm (scale = vox_xy) or pixels² → mm² (scale = vox_xy²).
    def _mm(v: float | None, scale: float) -> float | None:
        return round(v * scale, 3) if v is not None else None

    regions = []
    valid_chord: list[tuple[float, float]] = []
    valid_area: list[tuple[float, float]] = []

    for i, meta in enumerate(res_ed["region_metadata"]):
        chord_ed, chord_es = _opt(res_ed["chord"], i), _opt(res_es["chord"], i)
        area_ed, area_es = _opt(res_ed["area"], i), _opt(res_es["area"], i)
        radius_ed, radius_es = _opt(res_ed["radius"], i), _opt(res_es["radius"], i)

        gcs = _pct(chord_ed, chord_es)
        gas = _pct(area_ed, area_es)
        if gcs is not None:
            valid_chord.append((chord_ed, chord_es))
        if gas is not None:
            valid_area.append((area_ed, area_es))

        regions.append({
            "region":       meta["idx"],
            "label":        meta["label"],
            # `strain` is the same value as `gcs` (free-wall GCS, the main RV
            # value). GCS and GAS are reported separately, never combined.
            "strain":       gcs,
            "gcs":          gcs,
            "gas":          gas,
            "chord_ed_mm":  _mm(chord_ed, vox_xy),
            "chord_es_mm":  _mm(chord_es, vox_xy),
            "area_ed_mm2":  _mm(area_ed, vox_xy * vox_xy),
            "area_es_mm2":  _mm(area_es, vox_xy * vox_xy),
            "radius_ed_mm": _mm(radius_ed, vox_xy),
            "radius_es_mm": _mm(radius_es, vox_xy),
        })

    # Global value = % change of the summed ED vs the summed ES values over the
    # valid segments (ratio of totals), same rationale as global_grs/global_gcs
    # above — not the average of the per-segment percentages.
    def _global(pairs: list[tuple[float, float]]) -> float | None:
        if not pairs:
            return None
        return _pct(sum(p[0] for p in pairs), sum(p[1] for p in pairs))

    global_rv_gcs = _global(valid_chord)

    # RV septal GCS — one septal segment per ring, kept separate from the
    # free-wall `regions` above (free-wall GCS stays the main RV value).
    septal_regions = []
    valid_septal: list[tuple[float, float]] = []
    for i, meta in enumerate(res_ed["septal_metadata"]):
        s_ed, s_es = _opt(res_ed["septal_chord"], i), _opt(res_es["septal_chord"], i)
        s_gcs = _pct(s_ed, s_es)
        if s_gcs is not None:
            valid_septal.append((s_ed, s_es))
        septal_regions.append({
            "region":      meta["idx"],
            "ring":        meta["ring"],
            "label":       meta["label"],
            "gcs":         s_gcs,
            "chord_ed_mm": _mm(s_ed, vox_xy),
            "chord_es_mm": _mm(s_es, vox_xy),
        })

    # `global_rv_strain` is the same value as `global_rv_gcs` (free-wall GCS).
    return {
        "regions":             regions,
        "septal_regions":      septal_regions,
        "global_rv_strain":    global_rv_gcs,
        "global_rv_gcs":       global_rv_gcs,
        "global_rv_septal_gcs": _global(valid_septal),
        "global_rv_gas":       _global(valid_area),
        "vox_xy_mm":           vox_xy,
        "alignment_source":    res_ed.get("alignment_source", "fixed-angle"),
        "alignment_angle_deg": res_ed.get("alignment_angle_deg"),
    }


@router.post(
    "/compute-rv-strain",
    summary="Compute 9-segment RV strain (GCS + GAS) from ED + ES segmentation NIfTIs",
    tags=["Bullseye"],
)
async def compute_rv_strain(
    token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
    ed_file: UploadFile = File(..., description="ED frame segmentation NIfTI (.nii or .nii.gz)"),
    es_file: UploadFile = File(..., description="ES frame segmentation NIfTI (.nii or .nii.gz)"),
    rv_insertion_1_x: Optional[float] = Form(default=None),
    rv_insertion_1_y: Optional[float] = Form(default=None),
    rv_insertion_2_x: Optional[float] = Form(default=None),
    rv_insertion_2_y: Optional[float] = Form(default=None),
):
    """
    Upload segmentation masks for ED and ES frames. Returns, per RV segment
    (basal/mid/apical x 3 sections, Seg1 inferior → Seg3 anterior), GCS
    (free-wall chord % change) and GAS (cavity area % change), reported
    separately. `strain` is the same value as `gcs`. Also returns the RV
    septal GCS per ring (`septal_regions`) and the global values. Section
    wedges are fixed at ED and reused at ES — see
    bullseye_analysis.mask_to_rv_regions.

    Each mask should hold one cardiac frame: 3-D (H × W × N_slices), or 4-D
    with a single frame, with class values:
    0=background, 1=RV, 2=myocardium, 3=LV cavity.
    """
    for f, label in ((ed_file, "ed_file"), (es_file, "es_file")):
        fname = f.filename or ""
        if not (fname.endswith(".nii") or fname.endswith(".nii.gz")):
            raise HTTPException(
                status_code=422,
                detail=f"Unsupported file type for {label}: '{fname}'. Only .nii and .nii.gz are accepted."
            )

    rv1 = (rv_insertion_1_x, rv_insertion_1_y) if rv_insertion_1_x is not None and rv_insertion_1_y is not None else None
    rv2 = (rv_insertion_2_x, rv_insertion_2_y) if rv_insertion_2_x is not None and rv_insertion_2_y is not None else None

    ed_bytes = await ed_file.read()
    es_bytes = await es_file.read()

    try:
        result = await run_in_threadpool(
            _compute_rv_strain_sync,
            ed_bytes, es_bytes,
            ed_file.filename or "ed.nii.gz",
            es_file.filename or "es.nii.gz",
            rv1, rv2,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return result
