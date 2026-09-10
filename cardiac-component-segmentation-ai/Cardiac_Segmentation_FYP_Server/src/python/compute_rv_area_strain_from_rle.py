"""
compute_rv_area_strain_from_rle.py
===================================
RV "Global Area Strain" (GAS) — a GEOMETRIC descriptor, explicitly NOT
myocardial strain — from a segmentation mask document's RLE frame data.

Why this exists
----------------
The rest of this pipeline's RV "strain" (see compute_bullseye_from_rle.py's
sibling `compute-rv-strain` route, RvStrain/RvStrainSeries) is a per-region
CAVITY-RADIUS measure — closer in spirit to GCS (circumferential). Nothing
in this codebase measures the OTHER geometric axis discussed in the RV
disease-pattern work: the change in cavity CROSS-SECTIONAL AREA across the
cycle. This script computes exactly that, and only that.

Method (matches the ΔA_t definition used in RvDiseasePattern's design notes)
-----------------------------------------------------------------------------
1. For every frame, sum RV (class 1) pixels per slice -> a per-slice area.
2. ED = the frame with the largest TOTAL RV pixel count across all slices
   (same "largest cavity = ED" convention compute_heart_metrics_from_rle.py
   uses for the LV).
3. Fix a REFERENCE SLICE at ED: the slice with the largest RV area in that
   frame. This is deliberate — tracking the area of a FIXED anatomical plane
   through the cycle (like a single echo view) is what "area strain" means;
   re-picking the largest slice independently every frame would let the
   measurement drift between anatomically different slices and produce a
   number that reflects slice-selection, not RV motion.
4. For every frame, A_t = the RV pixel count in that SAME reference slice.
   GAS_t = (A_t - A_ED) / A_ED * 100.
5. Peak GAS = the most negative GAS_t among non-ED frames (mirrors the
   existing RV cavity-radius strain's own "peak = most negative" convention
   — see RvStrainSeries.peak_global_rv_strain).

This is pixel-count based (no affine/voxel-spacing input needed): area
STRAIN is a ratio, so pixel-area and mm^2-area give the identical percentage
— exactly the same reasoning compute_heart_metrics_from_rle.py already
documents for why LVEF needs no spacing.

Input (stdin JSON):
    frames    — list[frame]   (same schema as IProjectSegmentationMask.frames)
    width     — int
    height    — int
    ed_frame? — int (optional) explicit ED override

Output (stdout JSON):
    ed_frame              — frame used as the ED reference
    reference_slice       — the fixed slice index tracked across all frames
    area_change_curve     — [{frameindex, gas}], gas in %, null for frames
                             missing the reference slice entirely
    global_rv_gas         — peak (most negative) GAS across non-ED frames
    units                 — {gas: "%"}
    warnings              — list[str]

Pure Python + numpy. No cv2/nibabel/scipy — mirrors compute_bullseye_from_rle.py.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Optional

import numpy as np

_RV_CLASS = 1
CLASS_MAP = {"rv": 1, "RV": 1}


def decode_rle(rle_str: str, H: int, W: int) -> np.ndarray:
    """Decode COCO-style RLE string to a boolean (H, W) mask. Verbatim from
    compute_bullseye_from_rle.py — keep both copies in sync if this changes."""
    flat = np.zeros(H * W, dtype=np.uint8)
    tokens = rle_str.strip().split()
    i = 0
    while i + 1 < len(tokens):
        offset = int(tokens[i])
        length = int(tokens[i + 1])
        end = min(offset + length, H * W)
        flat[offset:end] = 1
        i += 2
    return flat.reshape(H, W)


def _safe_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def per_frame_slice_areas(frames: list, H: int, W: int) -> dict[int, dict[int, int]]:
    """frameindex -> {sliceindex -> RV pixel count}. Union-dedups repeated
    (frame, slice) entries the same way compute_heart_metrics_from_rle.py does,
    so a manual-edit-on-top-of-AI-output document doesn't double count."""
    areas: dict[int, dict[int, np.ndarray]] = {}
    for frame in frames:
        f_idx = int(frame.get("frameindex", 0))
        areas.setdefault(f_idx, {})
        for slc in frame.get("slices", []):
            if slc.get("excluded") is True:
                continue
            s_idx = int(slc.get("sliceindex", 0))
            for seg in slc.get("segmentationmasks", []):
                if CLASS_MAP.get(seg.get("class", ""), 0) != _RV_CLASS:
                    continue
                rle_str = seg.get("segmentationmaskcontents", "")
                if not rle_str:
                    continue
                mask = decode_rle(rle_str, H, W).astype(bool)
                existing = areas[f_idx].get(s_idx)
                areas[f_idx][s_idx] = mask if existing is None else (existing | mask)
    return {f: {s: int(m.sum()) for s, m in slices.items()} for f, slices in areas.items()}


def main() -> None:
    warnings_out: list[str] = []
    try:
        data = json.load(sys.stdin)
        frames = data["frames"]
        W = int(data["width"])
        H = int(data["height"])
    except Exception as e:
        print(json.dumps({"error": f"Invalid input JSON: {e}"}), file=sys.stdout)
        sys.exit(1)

    ed_override = data.get("ed_frame")

    areas = per_frame_slice_areas(frames, H, W)
    total_by_frame = {f: sum(s.values()) for f, s in areas.items()}
    positive_frames = [f for f, t in total_by_frame.items() if t > 0]

    if not positive_frames:
        print(json.dumps({"error": "No RV (class 1) pixels found in any frame."}), file=sys.stdout)
        sys.exit(1)

    if isinstance(ed_override, int) and ed_override in positive_frames:
        ed_frame = ed_override
    else:
        # Largest total RV cavity = ED, same convention used for the LV in
        # compute_heart_metrics_from_rle.py.
        ed_frame = max(positive_frames, key=lambda f: total_by_frame[f])

    ed_slices = areas.get(ed_frame, {})
    positive_ed_slices = {s: a for s, a in ed_slices.items() if a > 0}
    if not positive_ed_slices:
        print(json.dumps({"error": f"ED frame {ed_frame} has no RV pixels in any slice."}), file=sys.stdout)
        sys.exit(1)

    # Fixed reference slice — the largest RV cross-section AT ED. Tracked
    # unchanged through every other frame (see module docstring for why).
    reference_slice = max(positive_ed_slices, key=lambda s: positive_ed_slices[s])
    A_ed = positive_ed_slices[reference_slice]

    curve: list[dict] = []
    gas_values: list[tuple[int, float]] = []
    for f in sorted(areas.keys()):
        A_t = areas[f].get(reference_slice)
        if A_t is None:
            curve.append({"frameindex": f, "gas": None})
            continue
        gas = _safe_float((A_t - A_ed) / A_ed * 100.0)
        curve.append({"frameindex": f, "gas": gas})
        if f != ed_frame and gas is not None:
            gas_values.append((f, gas))

    if not gas_values:
        warnings_out.append("No non-ED frame had the reference slice present — global_rv_gas is null.")
        global_rv_gas = None
        peak_frame = None
    else:
        # Peak = most negative (greatest area contraction), mirroring the
        # existing cavity-radius RV strain's own peak convention.
        peak_frame, global_rv_gas = min(gas_values, key=lambda t: t[1])

    result = {
        "ed_frame": int(ed_frame),
        "reference_slice": int(reference_slice),
        "reference_slice_area_px": int(A_ed),
        "area_change_curve": curve,
        "global_rv_gas": global_rv_gas,
        "peak_frame": peak_frame,
        "units": {"gas": "%"},
        "warnings": warnings_out,
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
