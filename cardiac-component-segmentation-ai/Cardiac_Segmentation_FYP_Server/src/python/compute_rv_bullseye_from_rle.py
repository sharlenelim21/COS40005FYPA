"""
compute_rv_bullseye_from_rle.py
================================
Compute the 9-segment RV bullseye's per-segment CAVITY AREA from a single
segmentation-mask frame stored in MongoDB (RLE / segmentationmaskcontents
format). RV analogue of compute_bullseye_from_rle.py (LV wall thickness) --
same input contract, same "pure RLE, no GPU, no NIfTI, no landmark data"
design, so it can auto-run in the background the same way.

Input (stdin): JSON object with fields:
    frames   — list of frame objects (same schema as IProjectSegmentationMask.frames)
    width    — image width in pixels
    height   — image height in pixels

Output (stdout): JSON object:
    regions      — list[{region, area}], region 1-9 (Basal 1-3 / Mid 4-6 /
                   Apical 7-9, matching the frontend's CRESCENT_REGION_NAMES
                   / RvStrainSeries region order), area in raw pixel units
                   (no voxel spacing is passed to this script, so this is
                   NOT physical mm² -- only ratios of this value, e.g. FAC =
                   (area_ED - area_frame) / area_ED, are meaningful; the
                   absolute number is not comparable across patients/scans).
    input_shape  — [H, W, N_slices]

Class mapping (same as GPU bullseye_analysis.py / compute_bullseye_from_rle.py):
    0 = background, 1 = RV, 2 = myocardium, 3 = LV cavity

Method — ported from the GPU service's mask_to_rv_regions/rv_arc_sections
landmark-free fallback (visheart-inference-gpu/app/bullseye_analysis.py):
this only exists because that fallback is a first-class, already-proven path
there ("alignment_source": "fixed-angle" when rv_insertion_1 is None) -- RV
segment bucketing needs zero landmark data, same as LV's fixed AHA_SEGMENTS
angular table needs zero landmark data. Simplified from the GPU version
(which also produces chord/radius for GCS strain) to AREA ONLY, since that's
all the frontend's auto per-frame FAC needs -- no sub-pixel ray sampling or
boundary smoothing required for a pixel-count area, just a per-pixel angle
bucket relative to the LV-reference centroid, run through the identical
rv_arc_sections() arc-detection/section-split algorithm.

This script is pure Python + numpy — no cv2, no nibabel required.
"""

from __future__ import annotations

import json
import math
import sys

import warnings
import numpy as np
warnings.filterwarnings("ignore", category=RuntimeWarning)

_RV_CLASS = 1
_MYO_CLASS = 2
_LVC_CLASS = 3
_MIN_RV_PIXELS = 30
_RV_SECTIONS = 3
_RV_RINGS = ("basal", "mid", "apical")  # base -> apex, matches classify_rv_slices

CLASS_MAP = {
    "myo": 2, "MYO": 2,
    "lvc": 3, "LVC": 3,
    "rv":  1, "RV":  1,
}


# ── RLE decode / mask build (identical to compute_bullseye_from_rle.py) ───────

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


def build_mask_3d(frames: list, H: int, W: int) -> np.ndarray:
    """Convert MongoDB mask frames to a 3D numpy array (H, W, N_slices)."""
    slice_data: dict[int, np.ndarray] = {}
    for frame in frames:
        for slc in frame.get("slices", []):
            sidx = slc.get("sliceindex", 0)
            if sidx not in slice_data:
                slice_data[sidx] = np.zeros((H, W), dtype=np.uint8)
            for seg in slc.get("segmentationmasks", []):
                cls_val = CLASS_MAP.get(seg.get("class", ""), 0)
                if cls_val == 0:
                    continue
                rle_str = seg.get("segmentationmaskcontents", "")
                if not rle_str:
                    continue
                binary_mask = decode_rle(rle_str, H, W)
                slice_data[sidx] = np.where(binary_mask & (slice_data[sidx] == 0), cls_val, slice_data[sidx])

    if not slice_data:
        return np.zeros((H, W, 1), dtype=np.uint8)

    sorted_indices = sorted(slice_data.keys())
    return np.stack([slice_data[i] for i in sorted_indices], axis=-1)


def compute_centroid(slice_mask: np.ndarray, class_label: int):
    """Pure-numpy centroid of `class_label` pixels (replaces cv2.moments)."""
    region = (slice_mask == class_label).astype(np.float64)
    total = region.sum()
    if total == 0:
        return None, None
    ys, xs = np.where(region)
    return float(xs.sum() / total), float(ys.sum() / total)


# ── Slice classification + reference centroid
#    (ported from bullseye_analysis.py's classify_rv_slices / lv_reference_centroids) ──

def classify_rv_slices(mask_3d: np.ndarray) -> list[str]:
    n_slices = mask_3d.shape[2]
    labels: list[str] = ["none"] * n_slices
    valid = [i for i in range(n_slices) if int(np.sum(mask_3d[:, :, i] == _RV_CLASS)) >= _MIN_RV_PIXELS]
    for k, sl in enumerate(valid):
        labels[sl] = _RV_RINGS[min(k * 3 // len(valid), 2)]
    return labels


def lv_reference_centroids(mask_3d: np.ndarray):
    """Per-slice LV reference centre for the RV rays: LV cavity centroid,
    else myocardium centroid, else the nearest slice's centre (RV often
    extends past the LV at the base/apex, where the slice has no LV at all)."""
    n_slices = mask_3d.shape[2]
    own = []
    for i in range(n_slices):
        sl = mask_3d[:, :, i]
        cx, cy = compute_centroid(sl, _LVC_CLASS)
        if cx is None:
            cx, cy = compute_centroid(sl, _MYO_CLASS)
        own.append((cx, cy) if cx is not None else None)

    known = [i for i, c in enumerate(own) if c is not None]
    if not known:
        return own
    return [c if c is not None else own[min(known, key=lambda k: abs(k - i))] for i, c in enumerate(own)]


# ── Arc detection / section split
#    (ported verbatim from bullseye_analysis.py's rv_arc_sections, landmark-free path) ──

def rv_arc_sections(hit: np.ndarray, n_sections: int = _RV_SECTIONS) -> np.ndarray:
    """
    Assign each of the 360 angle bins to an RV section (0..n_sections-1), or
    -1 if outside the RV arc. The arc runs from the first to the last
    RV-hitting bin around the largest angular gap of misses (so small holes
    inside the RV don't split it), then splits into n_sections equal-length
    groups.

    No rv_insertion_1 here -- this script is specifically the landmark-free
    fallback, so start_is_anterior is always True (assumes standard SAX
    display), matching mask_to_rv_regions' own default when no landmark is
    given.
    """
    n = len(hit)
    sections = np.full(n, -1, dtype=int)
    idx_hits = np.flatnonzero(hit)
    if idx_hits.size == 0:
        return sections

    nxt = np.roll(idx_hits, -1)
    gaps = (nxt - idx_hits) % n
    gaps[gaps == 0] = n
    k = int(np.argmax(gaps))
    arc_start = int(nxt[k])
    arc_len = n - int(gaps[k]) + 1
    arc = (arc_start + np.arange(arc_len)) % n

    order = np.arange(arc_len) * n_sections // arc_len
    sections[arc] = n_sections - 1 - order  # start_is_anterior always True
    return sections


def rv_slice_section_areas(rv_mask: np.ndarray, cx: float, cy: float) -> np.ndarray:
    """
    Per-section RV pixel COUNT for one slice: bucket every RV pixel by its
    angle bin (1 bin per degree, same ray-index convention as
    ray_cast_rv_hits: bin i <-> angle -i*(360/360) = -i degrees from +x),
    run the shared bin array through rv_arc_sections to find the 3 free-wall
    sections, then count pixels per section. NaN when too few RV pixels.
    """
    ys, xs = np.where(rv_mask)
    if ys.size < _MIN_RV_PIXELS:
        return np.full(_RV_SECTIONS, np.nan)

    theta_deg = np.degrees(np.arctan2(ys.astype(np.float64) - cy, xs.astype(np.float64) - cx))
    bin_idx = np.mod(np.floor(-theta_deg).astype(int), 360)

    hit = np.zeros(360, dtype=bool)
    hit[np.unique(bin_idx)] = True
    sections = rv_arc_sections(hit)

    pixel_section = sections[bin_idx]
    areas = np.full(_RV_SECTIONS, np.nan)
    for s in range(_RV_SECTIONS):
        count = int(np.count_nonzero(pixel_section == s))
        areas[s] = float(count) if count > 0 else 0.0
    return areas


def mask_to_rv_region_areas(mask_3d: np.ndarray) -> np.ndarray:
    """9-element array: Basal_Seg1-3, Mid_Seg1-3, Apical_Seg1-3 (matches the
    frontend's CRESCENT_REGION_NAMES / RvStrainSeries region order)."""
    labels = classify_rv_slices(mask_3d)
    centroids = lv_reference_centroids(mask_3d)

    ring_values = []
    for ring_type in _RV_RINGS:
        per_slice = []
        for sl_idx, lbl in enumerate(labels):
            if lbl != ring_type or centroids[sl_idx] is None:
                continue
            cx, cy = centroids[sl_idx]
            rv_mask = mask_3d[:, :, sl_idx] == _RV_CLASS
            areas = rv_slice_section_areas(rv_mask, cx, cy)
            if not np.all(np.isnan(areas)):
                per_slice.append(areas)
        if per_slice:
            arr = np.vstack(per_slice)
            counts = np.sum(~np.isnan(arr), axis=0)
            sums = np.nansum(arr, axis=0)
            ring_values.append(np.where(counts > 0, sums / np.maximum(counts, 1), np.nan))
        else:
            ring_values.append(np.full(_RV_SECTIONS, np.nan))

    return np.concatenate(ring_values)


# ── Main ──────────────────────────────────────────────────────────────────────

def _safe_float(v):
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


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

    if not np.any(mask_3d == _RV_CLASS):
        print(json.dumps({"error": "No RV (class 1) pixels found in mask data."}), file=sys.stdout)
        sys.exit(1)

    values = mask_to_rv_region_areas(mask_3d)
    regions = [{"region": i + 1, "area": _safe_float(v)} for i, v in enumerate(values)]

    result = {
        "regions": regions,
        "input_shape": list(mask_3d.shape),
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
