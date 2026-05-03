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

Both return the same BullseyeAnalysisResult schema.
"""

from __future__ import annotations

import tempfile
import os
from typing import Annotated, List, Optional

import numpy as np
import nibabel as nib
import aiohttp

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.security.backend_authentication import conditional_verify_jwt, TokenPayLoad
from app.classes.pydantic_schema import (
    BullseyeAnalysisResult,
    BullseyeS3Request,
)
from app.bullseye_analysis import (
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


def _run_analysis(mask_3d: np.ndarray, request_id: Optional[str]) -> BullseyeAnalysisResult:
    """CPU-bound analysis — called via run_in_threadpool."""
    if not np.any(mask_3d == 2):
        raise HTTPException(
            status_code=422,
            detail="Mask contains no myocardium (class 2) pixels. Cannot compute wall thickness."
        )

    values: np.ndarray = mask_to_17_segments(mask_3d)
    slice_labels: list[str] = classify_slices(mask_3d)

    segment_values = [float(v) for v in values]
    n_nan = int(np.sum(np.isnan(values)))

    valid = values[~np.isnan(values)]
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
) -> BullseyeAnalysisResult:
    """
    Accept a NIfTI segmentation mask as a multipart upload and return
    the AHA 17-segment wall-thickness analysis.

    The mask must be 3-D (H × W × N_slices) with class values:
    0=background, 1=RV, 2=myocardium, 3=LV cavity.
    """
    fname = file.filename or ""
    if not (fname.endswith(".nii") or fname.endswith(".nii.gz")):
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{fname}'. Only .nii and .nii.gz are accepted."
        )

    raw = await file.read()
    mask_3d = await run_in_threadpool(_load_nifti_bytes, raw)
    return await run_in_threadpool(_run_analysis, mask_3d, None)


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
    raw = await _download_nifti_from_url(str(request.s3_url))
    mask_3d = await run_in_threadpool(_load_nifti_bytes, raw)
    return await run_in_threadpool(_run_analysis, mask_3d, request.request_id)
