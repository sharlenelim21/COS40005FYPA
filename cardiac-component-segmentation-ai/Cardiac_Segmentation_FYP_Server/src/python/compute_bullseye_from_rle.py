"""
compute_bullseye_from_rle.py
============================
Compute AHA 17-segment wall-thickness from a segmentation mask document stored
in MongoDB (RLE / segmentationmaskcontents format).

Input (stdin): JSON object with fields:
    frames   — list of frame objects (same schema as IProjectSegmentationMask.frames)
    width    — image width in pixels
    height   — image height in pixels

Output (stdout): JSON object matching BullseyeAnalysisResult:
    segment_values   — list[float], length 17
    segment_metadata — list[{idx, name, ring, value}]
    stats            — {min, max, mean, n_nan}
    input_shape      — [H, W, N_slices]
    slice_labels     — list[str]
    request_id       — null

Class mapping (same as GPU bullseye_analysis.py):
    0 = background
    1 = RV
    2 = myocardium (MYO / myo)
    3 = LV cavity  (LVC / lvc)

RLE format: COCO-style space-separated pairs "offset length offset length ..."
applied to a flat (H*W) row-major array. Value of 1 means the pixel belongs to
this class.

This script is pure Python + numpy — no cv2, no nibabel required.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Optional

import warnings
import numpy as np
warnings.filterwarnings("ignore", category=RuntimeWarning)

# ── AHA 17-Segment Definitions ─────────────────────────────────────────────
# `name` strings are Lateral/Septal-swapped relative to a literal "verbatim"
# copy — see the matching note in bullseye_analysis.py's AHA_SEGMENTS. Kept
# in sync here so this subprocess-fallback path (used when the GPU service
# is unreachable) shows the same names as the primary path. NOTE: this
# file's ray_cast_thickness/group_sectors use a different angle formula than
# bullseye_analysis.py's (no start-angle offset, no roll) — that's a
# pre-existing, separate implementation and wasn't re-verified as part of
# this fix; only the display names were changed here.
AHA_SEGMENTS = [
    {"idx":  1, "name": "Basal Anterior",      "ring": 0, "t1":  60, "t2": 120},
    {"idx":  2, "name": "Basal Anteroseptal",  "ring": 0, "t1": 120, "t2": 180},
    {"idx":  3, "name": "Basal Inferoseptal",  "ring": 0, "t1": 180, "t2": 240},
    {"idx":  4, "name": "Basal Inferior",      "ring": 0, "t1": 240, "t2": 300},
    {"idx":  5, "name": "Basal Inferolateral", "ring": 0, "t1": 300, "t2": 360},
    {"idx":  6, "name": "Basal Anterolateral", "ring": 0, "t1":   0, "t2":  60},
    {"idx":  7, "name": "Mid Anterior",        "ring": 1, "t1":  60, "t2": 120},
    {"idx":  8, "name": "Mid Anteroseptal",    "ring": 1, "t1": 120, "t2": 180},
    {"idx":  9, "name": "Mid Inferoseptal",    "ring": 1, "t1": 180, "t2": 240},
    {"idx": 10, "name": "Mid Inferior",        "ring": 1, "t1": 240, "t2": 300},
    {"idx": 11, "name": "Mid Inferolateral",   "ring": 1, "t1": 300, "t2": 360},
    {"idx": 12, "name": "Mid Anterolateral",   "ring": 1, "t1":   0, "t2":  60},
    {"idx": 13, "name": "Apical Anterior",     "ring": 2, "t1":  45, "t2": 135},
    {"idx": 14, "name": "Apical Septal",       "ring": 2, "t1": 135, "t2": 225},
    {"idx": 15, "name": "Apical Inferior",     "ring": 2, "t1": 225, "t2": 315},
    {"idx": 16, "name": "Apical Lateral",      "ring": 2, "t1": -45, "t2":  45},
    {"idx": 17, "name": "Apex",                "ring": 3, "t1":   0, "t2": 360},
]
RING_NAMES = ["Basal", "Mid-cavity", "Apical", "Apex"]

_MYO_CLASS = 2
_MIN_MYO_PIXELS = 50

CLASS_MAP = {
    "myo": 2, "MYO": 2,
    "lvc": 3, "LVC": 3,
    "rv":  1, "RV":  1,
}


# ── RLE decode ────────────────────────────────────────────────────────────────

def decode_rle(rle_str: str, H: int, W: int) -> np.ndarray:
    """Decode COCO-style RLE string to a boolean (H, W) mask."""
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


# ── Build 3D mask from frames ─────────────────────────────────────────────────

def build_mask_3d(frames: list, H: int, W: int) -> np.ndarray:
    """
    Convert MongoDB mask frames to a 3D numpy array (H, W, N_slices).

    Each frame may have multiple slices. We collect all slices in order,
    using sliceindex as the z-axis position.
    """
    # Collect all (sliceindex, class_label, rle_str) triples
    slice_data: dict[int, np.ndarray] = {}

    for frame in frames:
        for slc in frame.get("slices", []):
            sidx = slc.get("sliceindex", 0)
            if sidx not in slice_data:
                slice_data[sidx] = np.zeros((H, W), dtype=np.uint8)
            for seg in slc.get("segmentationmasks", []):
                cls_name = seg.get("class", "")
                cls_val = CLASS_MAP.get(cls_name, 0)
                if cls_val == 0:
                    continue
                rle_str = seg.get("segmentationmaskcontents", "")
                if not rle_str:
                    continue
                binary_mask = decode_rle(rle_str, H, W)
                # Only set pixels where this class is present (don't overwrite higher-priority classes)
                slice_data[sidx] = np.where(binary_mask & (slice_data[sidx] == 0), cls_val, slice_data[sidx])

    if not slice_data:
        return np.zeros((H, W, 1), dtype=np.uint8)

    sorted_indices = sorted(slice_data.keys())
    slices = [slice_data[i] for i in sorted_indices]
    return np.stack(slices, axis=-1)  # (H, W, N_slices)


# ── Bullseye computation (cv2-free port of bullseye_analysis.py) ──────────────

def classify_slices(mask_3d: np.ndarray) -> list[str]:
    n_slices = mask_3d.shape[2]
    labels = ["none"] * n_slices
    valid = [i for i in range(n_slices) if int(np.sum(mask_3d[:, :, i] == _MYO_CLASS)) >= _MIN_MYO_PIXELS]
    n_valid = len(valid)
    if n_valid == 0:
        return labels
    n_apex = 2 if n_valid >= 15 else 1
    n_remaining = max(n_valid - n_apex, 3)  # need at least 1 per ring
    n_basal  = max(1, round(n_remaining / 3))
    n_mid    = max(1, round(n_remaining / 3))
    n_apical = max(1, n_remaining - n_basal - n_mid)
    # If rounding pushed us over, trim basal (outermost ring) by 1
    while n_basal + n_mid + n_apical > n_remaining and n_basal > 1:
        n_basal -= 1
    boundaries = [
        (0,                          n_basal,                        "basal"),
        (n_basal,                    n_basal + n_mid,                "mid"),
        (n_basal + n_mid,            n_basal + n_mid + n_apical,     "apical"),
        (n_basal + n_mid + n_apical, n_valid,                        "apex"),
    ]
    for start, end, label in boundaries:
        for sl in valid[start:end]:
            labels[sl] = label
    return labels


def compute_centroid(slice_mask: np.ndarray) -> tuple[Optional[float], Optional[float]]:
    """Pure-numpy centroid of myocardium pixels (replaces cv2.moments)."""
    myo = (slice_mask == _MYO_CLASS).astype(np.float64)
    total = myo.sum()
    if total == 0:
        return None, None
    ys, xs = np.where(myo)
    cx = float(xs.sum() / total)
    cy = float(ys.sum() / total)
    return cx, cy


def ray_cast_thickness(slice_mask: np.ndarray, cx: float, cy: float, n_rays: int = 360) -> np.ndarray:
    H, W = slice_mask.shape
    max_r = max(H, W)
    myo = (slice_mask == _MYO_CLASS).astype(np.uint8)
    angles = np.linspace(0.0, 2.0 * math.pi, n_rays, endpoint=False)
    directions = np.stack([np.cos(angles), np.sin(angles)], axis=1)
    thicknesses = np.full(n_rays, np.nan, dtype=np.float64)
    cx_i = int(np.clip(int(cx), 0, W - 1))
    cy_i = int(np.clip(int(cy), 0, H - 1))
    for ray_i, d in enumerate(directions):
        transitions = []
        prev = int(myo[cy_i, cx_i])
        for r in range(1, max_r):
            x = int(cx + r * d[0])
            y = int(cy + r * d[1])
            if x < 0 or x >= W or y < 0 or y >= H:
                break
            val = int(myo[y, x])
            if val != prev:
                transitions.append((x, y))
                prev = val
        if len(transitions) < 2:
            continue
        p1 = np.array(transitions[0], dtype=float)
        p2 = np.array(transitions[1], dtype=float)
        centre = np.array([cx, cy], dtype=float)
        if np.linalg.norm(p1 - centre) < np.linalg.norm(p2 - centre):
            inner, outer = p1, p2
        else:
            inner, outer = p2, p1
        thicknesses[ray_i] = float(np.linalg.norm(outer - inner))
    return thicknesses


def group_sectors(thicknesses: np.ndarray, ring_type: str) -> np.ndarray:
    n_rays = len(thicknesses)
    ray_angles = np.linspace(0.0, 360.0, n_rays, endpoint=False)
    if ring_type == "apex":
        return np.array([np.nanmean(thicknesses)])
    if ring_type in ("basal", "mid"):
        n_sectors = 6
        raw = ((ray_angles - 60.0) % 360.0) / 60.0
    elif ring_type == "apical":
        n_sectors = 4
        raw = ((ray_angles - 45.0) % 360.0) / 90.0
    else:
        raise ValueError(f"Unknown ring_type: {ring_type!r}")
    sector_indices = np.clip(raw.astype(int), 0, n_sectors - 1)
    result = np.full(n_sectors, np.nan, dtype=np.float64)
    for s in range(n_sectors):
        mask_s = sector_indices == s
        if mask_s.any():
            vals = thicknesses[mask_s]
            if not np.all(np.isnan(vals)):
                result[s] = float(np.nanmean(vals))
    return result


def mask_to_17_segments(mask_3d: np.ndarray) -> dict:
    labels = classify_slices(mask_3d)
    ring_configs = {"basal": 6, "mid": 6, "apical": 4, "apex": 1}
    ring_results = {}
    lv_centroids: list[list[float]] = []
    for ring_type, n_sectors in ring_configs.items():
        ring_slices = [i for i, lbl in enumerate(labels) if lbl == ring_type]
        if not ring_slices:
            ring_results[ring_type] = np.full(n_sectors, np.nan)
            continue
        per_slice = []
        for sl_idx in ring_slices:
            sl = mask_3d[:, :, sl_idx]
            cx, cy = compute_centroid(sl)
            if cx is None:
                continue
            if ring_type in ("basal", "mid"):
                lv_centroids.append([cx, cy])
            thick = ray_cast_thickness(sl, cx, cy)
            sectors = group_sectors(thick, ring_type)
            if not np.all(np.isnan(sectors)):
                per_slice.append(sectors)
        if per_slice:
            ring_results[ring_type] = np.nanmean(per_slice, axis=0)
        else:
            ring_results[ring_type] = np.full(n_sectors, np.nan)
    values = np.concatenate([
        ring_results["basal"],
        ring_results["mid"],
        ring_results["apical"],
        ring_results["apex"],
    ])
    lv_centroid = (
        [float(np.mean([c[0] for c in lv_centroids])),
         float(np.mean([c[1] for c in lv_centroids]))]
        if lv_centroids else None
    )
    return {"values": values, "lv_centroid": lv_centroid}


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    try:
        data = json.load(sys.stdin)
        frames = data["frames"]
        W = int(data["width"])
        H = int(data["height"])
    except Exception as e:
        print(json.dumps({"error": f"Invalid input JSON: {e}"}), file=sys.stdout)
        sys.exit(1)

    mask_3d = build_mask_3d(frames, H, W)

    if not np.any(mask_3d == _MYO_CLASS):
        print(json.dumps({"error": "No myocardium (class 2) pixels found in mask data."}), file=sys.stdout)
        sys.exit(1)

    analysis = mask_to_17_segments(mask_3d)
    values = analysis["values"]
    lv_centroid = analysis["lv_centroid"]
    slice_labels = classify_slices(mask_3d)

    # Replace Python nan with None so JSON serialises to null, not NaN
    def _safe_float(v):
        if v is None:
            return None
        try:
            f = float(v)
            return None if math.isnan(f) or math.isinf(f) else f
        except (TypeError, ValueError):
            return None

    segment_values = [_safe_float(v) for v in values]
    finite_vals = [v for v in segment_values if v is not None]
    n_nan = len(segment_values) - len(finite_vals)

    stats = {
        "min":   _safe_float(min(finite_vals)) if finite_vals else None,
        "max":   _safe_float(max(finite_vals)) if finite_vals else None,
        "mean":  _safe_float(sum(finite_vals) / len(finite_vals)) if finite_vals else None,
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

    result = {
        "request_id":       None,
        "segment_values":   segment_values,
        "segment_metadata": segment_metadata,
        "stats":            stats,
        "input_shape":      list(mask_3d.shape),
        "slice_labels":     slice_labels,
        "lv_centroid":      lv_centroid,
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
