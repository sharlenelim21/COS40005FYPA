"""
bullseye_route.py
=================
FastAPI router exposing AHA 17-segment wall-thickness analysis.

Endpoints
---------
POST /bullseye/analyze
    Mode A — direct NIfTI file upload (.nii or .nii.gz).
    Accepts multipart/form-data with field `file`.

POST /bullseye/analyze-from-s3
    Mode B — presigned S3 URL.
    Accepts JSON body with `s3_url` and optional `request_id`.

POST /bullseye/compute-strain
    Accepts ED and ES NIfTI files + optional RV insertion points.
    Returns GRS and GCS per AHA segment.

POST /bullseye/compute-rv-strain
    Accepts ED and ES NIfTI files + optional RV insertion points.
    Returns regional RV cavity-radius strain (basal/mid free-wall sectors).

Both analyze endpoints return the same BullseyeAnalysisResult schema.
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
    mask_to_17_segments,
    mask_to_rv_regions,
)

router = APIRouter()

# ── internal helpers ──────────────────────────────────────────────────────────

def _load_nifti_bytes(data: bytes) -> np.ndarray:
    """Load NIfTI from raw bytes via a temp file, return the array cast to uint8."""
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
            # 4D NIfTI (H×W×slices×frames): collapse frames by taking max label per voxel
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


def _run_analysis(
    mask_3d: np.ndarray,
    request_id: Optional[str],
    rv_insertion_1: Optional[tuple[float, float]] = None,
    rv_insertion_2: Optional[tuple[float, float]] = None,
) -> BullseyeAnalysisResult:
    """CPU-bound analysis — called via run_in_threadpool."""
    if not np.any(mask_3d == 2):
        raise HTTPException(
            status_code=422,
            detail="Mask contains no myocardium (class 2) pixels. Cannot compute wall thickness."
        )

    analysis = mask_to_17_segments(mask_3d, rv_insertion_1=rv_insertion_1, rv_insertion_2=rv_insertion_2)
    values: np.ndarray = analysis["values"]
    lv_centroid: Optional[List[float]] = analysis["lv_centroid"]
    slice_labels: list[str] = classify_slices(mask_3d)

    # NaN-safe per-segment values: same _safe_float/finite_vals pattern already
    # used in compute_bullseye_from_rle.py (the subprocess fallback). A bare
    # Python NaN is rejected by FastAPI's JSON encoder outright (ValueError:
    # Out of range float values are not JSON compliant), crashing the request
    # with a 500 instead of a graceful null — this affects both individual
    # invalid segments and the aggregate stats when every segment is invalid
    # (e.g. insufficient myocardium in every slice).
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
    the AHA 17-segment wall-thickness analysis.

    The mask must be 3-D (H × W × N_slices) with class values:
    0=background, 1=RV, 2=myocardium, 3=LV cavity.

    Optional form fields rv_insertion_1_x/y and rv_insertion_2_x/y provide
    RV insertion point coordinates (pixel coords) for anatomical alignment.
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
    the AHA 17-segment wall-thickness analysis.

    The mask must be 3-D (H × W × N_slices) with class values:
    0=background, 1=RV, 2=myocardium, 3=LV cavity.
    """
    rv1 = tuple(request.rv_insertion_1) if request.rv_insertion_1 is not None else None
    rv2 = tuple(request.rv_insertion_2) if request.rv_insertion_2 is not None else None

    raw = await _download_nifti_from_url(str(request.s3_url))
    mask_3d = await run_in_threadpool(_load_nifti_bytes, raw)
    return await run_in_threadpool(_run_analysis, mask_3d, request.request_id, rv1, rv2)


# ── Route C: compute strain from ED + ES NIfTI uploads ───────────────────────

_AHA_NAMES = [
    "Basal Anterior", "Basal Anterolateral", "Basal Inferolateral",
    "Basal Inferior",  "Basal Inferoseptal",  "Basal Anteroseptal",
    "Mid Anterior",    "Mid Anterolateral",   "Mid Inferolateral",
    "Mid Inferior",    "Mid Inferoseptal",    "Mid Anteroseptal",
    "Apical Anterior", "Apical Lateral",      "Apical Inferior",
    "Apical Septal",   "Apex",
]


def _compute_strain_sync(
    ed_bytes: bytes,
    es_bytes: bytes,
    ed_fname: str,
    es_fname: str,
    rv1: Optional[tuple[float, float]],
    rv2: Optional[tuple[float, float]],
) -> dict:
    """CPU-bound: load both NIfTIs, run mask_to_17_segments on each, compute GRS/GCS."""

    def _load(data: bytes, fname: str):
        suffix = ".nii.gz" if (fname or "").endswith(".gz") else ".nii"
        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        try:
            tmp.write(data)
            tmp.flush()
            tmp.close()
            img = nib.load(tmp.name)
            arr = np.asarray(img.dataobj)
            if arr.ndim == 4:
                arr = arr.max(axis=-1)
            if arr.ndim != 3:
                raise ValueError(f"Expected 3-D mask, got shape {arr.shape}")
            zooms = img.header.get_zooms()
            vox_xy = abs(float(zooms[0])) if len(zooms) > 0 and abs(float(zooms[0])) > 0 else 1.0
            return arr.astype(np.uint8), vox_xy
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

    mask_ed, vox_xy = _load(ed_bytes, ed_fname)
    mask_es, _      = _load(es_bytes, es_fname)

    if not np.any(mask_ed == 2):
        raise ValueError("ED mask contains no myocardium (class 2) pixels.")
    if not np.any(mask_es == 2):
        raise ValueError("ES mask contains no myocardium (class 2) pixels.")

    from bullseye_analysis import mask_to_17_segments
    res_ed = mask_to_17_segments(mask_ed, rv_insertion_1=rv1, rv_insertion_2=rv2)
    res_es = mask_to_17_segments(mask_es, rv_insertion_1=rv1, rv_insertion_2=rv2)

    wt_ed   = np.array(res_ed["values"],      dtype=float)
    wt_es   = np.array(res_es["values"],      dtype=float)
    # circ_values from mask_to_17_segments is 2π × pure endocardial inner_radius.
    # Back out inner_radius (r = circ / 2π), then use MID-WALL radius (r + wt/2)
    # for GCS instead of pure endocardial radius — tracking only the inner
    # cavity edge overstates circumferential shortening as the wall thickens
    # inward. wt_ed/wt_es and the recovered inner radii are both raw pixel
    # values at this point (vox_xy conversion happens later, per-segment),
    # so combining them here is unit-consistent.
    inner_r_ed = np.array(res_ed["circ_values"], dtype=float) / (2.0 * np.pi)
    inner_r_es = np.array(res_es["circ_values"], dtype=float) / (2.0 * np.pi)
    r_mid_ed = inner_r_ed + (wt_ed / 2.0)
    r_mid_es = inner_r_es + (wt_es / 2.0)
    circ_ed = 2.0 * np.pi * r_mid_ed
    circ_es = 2.0 * np.pi * r_mid_es

    segments = []
    grs_vals: list[float] = []
    gcs_vals: list[float] = []
    # Pooled for ratio-of-means global aggregation (see below).
    valid_wt_ed_for_grs: list[float] = []
    valid_wt_es_for_grs: list[float] = []
    valid_circ_ed_for_gcs: list[float] = []
    valid_circ_es_for_gcs: list[float] = []

    for i, name in enumerate(_AHA_NAMES):
        ed_v = float(wt_ed[i])   if not np.isnan(wt_ed[i])   else None
        es_v = float(wt_es[i])   if not np.isnan(wt_es[i])   else None
        c_ed = float(circ_ed[i]) if not np.isnan(circ_ed[i]) else None
        c_es = float(circ_es[i]) if not np.isnan(circ_es[i]) else None

        grs: float | None = None
        if ed_v is not None and es_v is not None and ed_v > 0:
            grs = round((es_v - ed_v) / ed_v * 100.0, 2)
            grs_vals.append(grs)
            valid_wt_ed_for_grs.append(ed_v)
            valid_wt_es_for_grs.append(es_v)

        gcs: float | None = None
        if c_ed is not None and c_es is not None and c_ed > 0:
            gcs = round((c_es - c_ed) / c_ed * 100.0, 2)
            gcs_vals.append(gcs)
            valid_circ_ed_for_gcs.append(c_ed)
            valid_circ_es_for_gcs.append(c_es)

        segments.append({
            "segment":   i + 1,
            "label":     name,
            "grs":       grs,
            "gcs":       gcs,
            "wt_ed_mm":  round(ed_v * vox_xy, 3) if ed_v is not None else None,
            "wt_es_mm":  round(es_v * vox_xy, 3) if es_v is not None else None,
        })

    # Global metrics: ratio-of-means (pool valid segments' wt/circ first, then
    # take one ratio) instead of mean-of-ratios (averaging 17 percent-changes).
    # Mean-of-ratios gives small/noisy segments (e.g. apex) equal weight to
    # large, stable ones — a known source of bias in per-segment strain pooling.
    if valid_wt_ed_for_grs:
        mean_wt_ed = float(np.mean(valid_wt_ed_for_grs))
        mean_wt_es = float(np.mean(valid_wt_es_for_grs))
        global_grs = round((mean_wt_es - mean_wt_ed) / mean_wt_ed * 100.0, 2) if mean_wt_ed > 0 else None
    else:
        global_grs = None

    if valid_circ_ed_for_gcs:
        mean_circ_ed = float(np.mean(valid_circ_ed_for_gcs))
        mean_circ_es = float(np.mean(valid_circ_es_for_gcs))
        global_gcs = round((mean_circ_es - mean_circ_ed) / mean_circ_ed * 100.0, 2) if mean_circ_ed > 0 else None
    else:
        global_gcs = None

    valid_ed_mm = [float(v) * vox_xy for v in wt_ed if not np.isnan(v)]
    valid_es_mm = [float(v) * vox_xy for v in wt_es if not np.isnan(v)]

    return {
        "segments":          segments,
        "global_grs":        global_grs,
        "global_gcs":        global_gcs,
        "ed_wt_mean_mm":     round(float(np.mean(valid_ed_mm)), 3) if valid_ed_mm else None,
        "es_wt_mean_mm":     round(float(np.mean(valid_es_mm)), 3) if valid_es_mm else None,
        "vox_xy_mm":         vox_xy,
        "alignment_source":  res_ed.get("alignment_source", "fixed-angle"),
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
    Returns GRS (wall thickening) and GCS (circumferential shortening) per AHA segment.

    Masks must be 3-D (H × W × N_slices) with class values:
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
# See bullseye_analysis.mask_to_rv_regions docstring: there is no separate RV
# free-wall myocardium label in this mask, so this measures % change in RV
# cavity boundary radius per region (a GCS-style radius measure) rather than
# wall thickening (GRS-style, like the LV route above).

def _compute_rv_strain_sync(
    ed_bytes: bytes,
    es_bytes: bytes,
    ed_fname: str,
    es_fname: str,
    rv1: Optional[tuple[float, float]],
    rv2: Optional[tuple[float, float]],
) -> dict:
    """CPU-bound: load both NIfTIs, run mask_to_rv_regions on each, compute per-region strain."""

    def _load(data: bytes, fname: str):
        suffix = ".nii.gz" if (fname or "").endswith(".gz") else ".nii"
        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        try:
            tmp.write(data)
            tmp.flush()
            tmp.close()
            img = nib.load(tmp.name)
            arr = np.asarray(img.dataobj)
            if arr.ndim == 4:
                arr = arr.max(axis=-1)
            if arr.ndim != 3:
                raise ValueError(f"Expected 3-D mask, got shape {arr.shape}")
            zooms = img.header.get_zooms()
            vox_xy = abs(float(zooms[0])) if len(zooms) > 0 and abs(float(zooms[0])) > 0 else 1.0
            return arr.astype(np.uint8), vox_xy
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

    mask_ed, vox_xy = _load(ed_bytes, ed_fname)
    mask_es, _      = _load(es_bytes, es_fname)

    if not np.any(mask_ed == 1):
        raise ValueError("ED mask contains no RV (class 1) pixels.")
    if not np.any(mask_es == 1):
        raise ValueError("ES mask contains no RV (class 1) pixels.")

    res_ed = mask_to_rv_regions(mask_ed, rv_insertion_1=rv1, rv_insertion_2=rv2)
    res_es = mask_to_rv_regions(mask_es, rv_insertion_1=rv1, rv_insertion_2=rv2)

    r_ed = np.array(res_ed["values"], dtype=float)
    r_es = np.array(res_es["values"], dtype=float)
    region_meta = res_ed["region_metadata"]

    regions = []
    valid_r_ed: list[float] = []
    valid_r_es: list[float] = []

    for i, meta in enumerate(region_meta):
        ed_v = float(r_ed[i]) if not np.isnan(r_ed[i]) else None
        es_v = float(r_es[i]) if not np.isnan(r_es[i]) else None

        strain: float | None = None
        if ed_v is not None and es_v is not None and ed_v > 0:
            strain = round((es_v - ed_v) / ed_v * 100.0, 2)
            valid_r_ed.append(ed_v)
            valid_r_es.append(es_v)

        regions.append({
            "region":       meta["idx"],
            "label":        meta["label"],
            "strain":       strain,
            "radius_ed_mm": round(ed_v * vox_xy, 3) if ed_v is not None else None,
            "radius_es_mm": round(es_v * vox_xy, 3) if es_v is not None else None,
        })

    # Ratio-of-means, same rationale as global_grs/global_gcs above.
    if valid_r_ed:
        mean_r_ed = float(np.mean(valid_r_ed))
        mean_r_es = float(np.mean(valid_r_es))
        global_rv_strain = round((mean_r_es - mean_r_ed) / mean_r_ed * 100.0, 2) if mean_r_ed > 0 else None
    else:
        global_rv_strain = None

    return {
        "regions":             regions,
        "global_rv_strain":    global_rv_strain,
        "vox_xy_mm":           vox_xy,
        "alignment_source":    res_ed.get("alignment_source", "fixed-angle"),
        "alignment_angle_deg": res_ed.get("alignment_angle_deg"),
    }


@router.post(
    "/compute-rv-strain",
    summary="Compute regional RV cavity-radius strain from ED + ES segmentation NIfTIs",
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
    Upload segmentation masks for ED and ES frames. Returns % change in RV
    cavity boundary radius per region (basal/mid free-wall sectors) — see
    bullseye_analysis.mask_to_rv_regions for why this is a radius measure
    rather than a wall-thickness measure like the LV's GRS.

    Masks must be 3-D (H × W × N_slices) with class values:
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
