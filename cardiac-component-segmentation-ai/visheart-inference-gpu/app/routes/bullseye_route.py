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

    segment_values = [float(v) for v in values]
    n_nan = int(np.sum(np.isnan(values)))

    stats = {
        "min":   float(np.nanmin(values)),
        "max":   float(np.nanmax(values)),
        "mean":  float(np.nanmean(values)),
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
    circ_ed = np.array(res_ed["circ_values"], dtype=float)
    circ_es = np.array(res_es["circ_values"], dtype=float)

    segments = []
    grs_vals: list[float] = []
    gcs_vals: list[float] = []

    for i, name in enumerate(_AHA_NAMES):
        ed_v = float(wt_ed[i])   if not np.isnan(wt_ed[i])   else None
        es_v = float(wt_es[i])   if not np.isnan(wt_es[i])   else None
        c_ed = float(circ_ed[i]) if not np.isnan(circ_ed[i]) else None
        c_es = float(circ_es[i]) if not np.isnan(circ_es[i]) else None

        grs: float | None = None
        if ed_v is not None and es_v is not None and ed_v > 0:
            grs = round((es_v - ed_v) / ed_v * 100.0, 2)
            grs_vals.append(grs)

        gcs: float | None = None
        if c_ed is not None and c_es is not None and c_ed > 0:
            gcs = round((c_es - c_ed) / c_ed * 100.0, 2)
            gcs_vals.append(gcs)

        segments.append({
            "segment":   i + 1,
            "label":     name,
            "grs":       grs,
            "gcs":       gcs,
            "wt_ed_mm":  round(ed_v * vox_xy, 3) if ed_v is not None else None,
            "wt_es_mm":  round(es_v * vox_xy, 3) if es_v is not None else None,
        })

    global_grs = round(float(np.mean(grs_vals)), 2) if grs_vals else None
    global_gcs = round(float(np.mean(gcs_vals)), 2) if gcs_vals else None

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
