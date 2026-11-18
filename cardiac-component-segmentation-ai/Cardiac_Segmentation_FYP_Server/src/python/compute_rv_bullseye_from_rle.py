"""
compute_rv_bullseye_from_rle.py
================================
Compute the 9-segment RV bullseye's per-segment CAVITY AREA from a single
segmentation-mask frame stored in MongoDB (RLE / segmentationmaskcontents
format). RV analogue of compute_bullseye_from_rle.py (LV wall thickness) --
same "pure RLE, no GPU, no NIfTI" design, so it can auto-run in the
background the same way.

Input (stdin): JSON object with fields:
    frames           — this frame's frame objects (same schema as
                       IProjectSegmentationMask.frames)
    width            — image width in pixels
    height           — image height in pixels
    reference_frames — optional: the frame objects of the REFERENCE frame (the
                       frame FAC is measured against — the first frame of the
                       cycle). The slice → ring assignment and the ray → section
                       wedges are made on it and reused for `frames`, the same
                       way the GPU reuses the ED layout at ES (mask_to_rv_regions'
                       `layout`), so every frame's segment covers the same
                       slices and angles. Without it the layout is made from
                       `frames` itself.
    rv_insertion_slices — optional [{slice, p1: [x, y], p2: [x, y]}, ...]: both RV
                       insertion points of every slice of the REFERENCE frame
                       (slice = sliceindex). The anterior one is picked per slice
                       from the mask, and it decides which end of that slice's RV
                       arc is anterior (Seg3) — as the GPU does. A slice without a
                       usable point uses the default end (lower angle).
    rv_insertion_1   — optional [x, y]: a single anterior point for every slice,
                       used only when rv_insertion_slices holds no usable slice.
                       Without either, the point is estimated from the RV in the
                       mask (same method as the GPU).

Output (stdout): JSON object:
    regions      — list[{region, area}], region 1-9 (Basal 1-3 / Mid 4-6 /
                   Apical 7-9, Seg1 inferior → Seg3 anterior — the same order as
                   the GPU's RV strain regions and the frontend's
                   CRESCENT_REGION_NAMES), area in raw pixel units (no voxel
                   spacing is passed to this script, so this is NOT physical
                   mm² -- only ratios of this value, e.g. FAC =
                   (area_ref - area_frame) / area_ref, are meaningful; the
                   absolute number is not comparable across patients/scans).
    input_shape  — [H, W, N_slices]
    alignment_source — "landmark" | "rv-mask" (no landmark, point estimated
                   from the RV) | "fixed-angle" (no point at all)

Class mapping (same as GPU bullseye_analysis.py / compute_bullseye_from_rle.py):
    0 = background, 1 = RV, 2 = myocardium, 3 = LV cavity

Method — a port of the GPU service's mask_to_rv_regions, AREA ONLY
(visheart-inference-gpu/app/bullseye_analysis.py): the same slice
classification, LV reference centre, ray hits (360 rays from the LV centre,
sampled every 0.25 px), arc split and orientation, and pixel → ray
assignment. On the same mask and points it gives the GPU's per-segment
"area", so the FAC this series yields at ES matches -GAS of the GPU's
ED → ES RV strain (when the reference frame is the ED frame).

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
_RV_RAY_STEP_PX = 0.25                  # sub-pixel sampling along each RV ray (GPU value)
_N_RAYS = 360
# Share of each slice's RV pixels (those with the lowest angle seen from the LV
# centre) taken as the RV's anterior tip — same value as the GPU code.
_RV_EDGE_PERCENTILE = 2.0
# Two insertion points closer than this (pixels) are treated as "both on the
# same spot" and ignored — same value as the GPU code.
_MIN_INSERTION_SEPARATION_PX = 5.0

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


def build_mask_3d(frames: list, H: int, W: int, slice_order: list | None = None) -> np.ndarray:
    """Convert MongoDB mask frames to a 3D numpy array (H, W, N_slices).
    `slice_order` (sorted sliceindex values) fixes the z position of every
    slice, so two frames built with the same order line up slice by slice."""
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

    order = slice_order if slice_order is not None else sorted(slice_data.keys())
    if not order:
        return np.zeros((H, W, 1), dtype=np.uint8)
    return np.stack([slice_data.get(i, np.zeros((H, W), dtype=np.uint8)) for i in order], axis=-1)


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

def stack_runs_apex_first(mask_3d: np.ndarray, min_myo_pixels: int = 50) -> bool:
    """True when slice 0 is at the apex (most M&Ms scans; ACDC is base first),
    decided from the LV: its base end is the wider one. Port of the GPU's
    bullseye_analysis.stack_runs_apex_first — keep the two in sync."""
    valid = [i for i in range(mask_3d.shape[2]) if int(np.sum(mask_3d[:, :, i] == _MYO_CLASS)) >= min_myo_pixels]
    if len(valid) < 3:
        return False
    areas = [int(np.sum((mask_3d[:, :, i] == _MYO_CLASS) | (mask_3d[:, :, i] == _LVC_CLASS))) for i in valid]
    k = max(1, len(valid) // 3)
    return float(np.mean(areas[-k:])) > float(np.mean(areas[:k]))


def classify_rv_slices(mask_3d: np.ndarray) -> list[str]:
    n_slices = mask_3d.shape[2]
    labels: list[str] = ["none"] * n_slices
    valid = [i for i in range(n_slices) if int(np.sum(mask_3d[:, :, i] == _RV_CLASS)) >= _MIN_RV_PIXELS]
    # Rings are counted from the base: reverse a stack that runs apex first.
    if stack_runs_apex_first(mask_3d):
        valid = valid[::-1]
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


# ── Orientation points (ported from bullseye_analysis.py's
#    estimate_anterior_rv_insertion / select_anterior_insertions) ──

def estimate_anterior_rv_insertion(mask_3d: np.ndarray):
    """No landmark: per slice with an LV cavity and an RV, the mean of the 2 %
    of RV pixels with the lowest angle seen from the LV-cavity centre; the
    per-slice points are averaged into one point. None if no such slice."""
    points = []
    for sl_idx in range(mask_3d.shape[2]):
        sl = mask_3d[:, :, sl_idx]
        cx, cy = compute_centroid(sl, _LVC_CLASS)
        if cx is None:
            continue
        ys, xs = np.nonzero(sl == _RV_CLASS)
        if xs.size < _MIN_RV_PIXELS:
            continue
        rv_dir = math.atan2(float(ys.mean()) - cy, float(xs.mean()) - cx)
        rel = (np.arctan2(ys - cy, xs - cx) - rv_dir + math.pi) % (2.0 * math.pi) - math.pi
        edge = rel <= np.percentile(rel, _RV_EDGE_PERCENTILE)
        points.append((float(xs[edge].mean()), float(ys[edge].mean())))
    if not points:
        return None
    return (float(np.mean([p[0] for p in points])), float(np.mean([p[1] for p in points])))


def select_anterior_insertions(mask_3d: np.ndarray, slice_pairs) -> dict:
    """From the two RV insertion points of each slice keep the one that has the
    RV on its increasing-angle (clockwise-on-screen) side, seen from that
    slice's LV-cavity centre — chosen by geometry, not by its label. Skips
    slices with no LV cavity, too little RV, collapsed points or an ambiguous
    choice. slice_pairs: {z: ((x, y), (x, y))}. Returns {z: (x, y)}."""
    selected = {}
    for z, (p1, p2) in (slice_pairs or {}).items():
        if not (0 <= z < mask_3d.shape[2]):
            continue
        if math.hypot(p1[0] - p2[0], p1[1] - p2[1]) < _MIN_INSERTION_SEPARATION_PX:
            continue
        sl = mask_3d[:, :, z]
        cx, cy = compute_centroid(sl, _LVC_CLASS)
        if cx is None:
            continue
        ys, xs = np.nonzero(sl == _RV_CLASS)
        if xs.size < _MIN_RV_PIXELS:
            continue
        rv_dir = math.atan2(float(ys.mean()) - cy, float(xs.mean()) - cx)

        def _rv_is_clockwise_of(p):
            d = (rv_dir - math.atan2(p[1] - cy, p[0] - cx)) % (2.0 * math.pi)
            return 0.0 < d < math.pi

        cw1, cw2 = _rv_is_clockwise_of(p1), _rv_is_clockwise_of(p2)
        if cw1 == cw2:
            continue
        anterior = p1 if cw1 else p2
        selected[z] = (float(anterior[0]), float(anterior[1]))
    return selected


# ── Ray hits / arc split / section areas
#    (ported from bullseye_analysis.py's ray_cast_rv_hits, rv_arc_sections and
#    the area part of rv_section_measures) ──

def rv_ray_hits(slice_mask: np.ndarray, cx: float, cy: float, n_rays: int = _N_RAYS) -> np.ndarray:
    """Which of the n_rays rays from (cx, cy) touch the RV. Ray i points at
    angle -i * 360/n_rays degrees (the ray index grows COUNTER-clockwise on
    screen, as in ray_cast_rv_hits); a ray stops where it leaves the image."""
    H, W = slice_mask.shape
    max_r = max(H, W)
    angles = 0.0 - np.linspace(0.0, 2.0 * np.pi, n_rays, endpoint=False)
    rs = np.arange(_RV_RAY_STEP_PX, max_r, _RV_RAY_STEP_PX)
    xs = (cx + rs[None, :] * np.cos(angles)[:, None]).astype(int)
    ys = (cy + rs[None, :] * np.sin(angles)[:, None]).astype(int)
    in_bounds = np.logical_and.accumulate((xs >= 0) & (xs < W) & (ys >= 0) & (ys < H), axis=1)
    hit = in_bounds & (slice_mask[np.clip(ys, 0, H - 1), np.clip(xs, 0, W - 1)] == _RV_CLASS)
    return hit.any(axis=1)


def rv_arc_sections(hit: np.ndarray, cx: float, cy: float, rv_insertion_1=None,
                    n_sections: int = _RV_SECTIONS) -> np.ndarray:
    """
    Assign each ray to an RV section (0..n_sections-1), or -1 if it is outside
    the RV arc. The arc runs from the first to the last RV-hitting ray around
    the largest angular gap of misses (so small holes inside the RV don't
    split it), then splits into n_sections groups of equal ray count.

    Section 0 = inferior end, n_sections-1 = anterior end. The anterior end is
    the arc end nearer rv_insertion_1 (this slice's orientation point); with
    no point it is the LOWER-angle end of the arc — the GPU's default.
    """
    n = len(hit)
    sections = np.full(n, -1, dtype=int)
    idx_hits = np.flatnonzero(hit)
    if idx_hits.size == 0:
        return sections

    nxt = np.roll(idx_hits, -1)
    gaps = (nxt - idx_hits) % n
    gaps[gaps == 0] = n  # single hit ray: the whole circle is the gap
    k = int(np.argmax(gaps))
    arc_start = int(nxt[k])
    arc_len = n - int(gaps[k]) + 1
    arc = (arc_start + np.arange(arc_len)) % n

    order = np.arange(arc_len) * n_sections // arc_len  # 0 at arc_start

    # The arc is listed in ray order, i.e. with DECREASING angle, so its start
    # is the higher-angle end and its end is the lower-angle (anterior) end.
    start_is_anterior = False
    if rv_insertion_1 is not None:
        step = 2.0 * np.pi / n
        ant = np.arctan2(rv_insertion_1[1] - cy, rv_insertion_1[0] - cx)

        def _dist(ray_i: int) -> float:
            d = (0.0 - ray_i * step - ant) % (2.0 * np.pi)
            return min(d, 2.0 * np.pi - d)

        start_is_anterior = _dist(int(arc[0])) <= _dist(int(arc[-1]))

    sections[arc] = (n_sections - 1 - order) if start_is_anterior else order
    return sections


def rv_section_areas(slice_mask: np.ndarray, cx: float, cy: float, sections: np.ndarray) -> np.ndarray:
    """RV cavity pixels whose angle from (cx, cy) falls in each section's rays
    (each pixel goes to its nearest ray). NaN for a section with no rays."""
    n = len(sections)
    ys, xs = np.nonzero(slice_mask == _RV_CLASS)
    step = 2.0 * np.pi / n
    ray_of_px = np.round(((0.0 - np.arctan2(ys - cy, xs - cx)) % (2.0 * np.pi)) / step).astype(int) % n
    px_section = sections[ray_of_px]
    areas = np.full(_RV_SECTIONS, np.nan)
    for s in range(_RV_SECTIONS):
        if np.any(sections == s):
            areas[s] = float(np.sum(px_section == s))
    return areas


# ── Layout (made once, on the reference frame) + per-frame areas ──────────────

def make_layout(ref_mask: np.ndarray, anterior_by_slice: dict, rv_insertion_1):
    """Slice → ring labels and ray → section map of every RV slice, made on the
    reference mask (as mask_to_rv_regions does on the ED mask)."""
    labels = classify_rv_slices(ref_mask)
    centroids = lv_reference_centroids(ref_mask)

    alignment_source = "landmark"
    if not anterior_by_slice and rv_insertion_1 is None:
        rv_insertion_1 = estimate_anterior_rv_insertion(ref_mask)
        alignment_source = "rv-mask" if rv_insertion_1 is not None else "fixed-angle"

    # With per-slice landmarks: the slice's own anterior point (None → the
    # default end); otherwise the one rv_insertion_1 for every slice.
    def _orientation_point(sl_idx):
        return anterior_by_slice.get(sl_idx) if anterior_by_slice else rv_insertion_1

    sections = {}
    for sl_idx, lbl in enumerate(labels):
        if lbl == "none" or centroids[sl_idx] is None:
            continue
        cx, cy = centroids[sl_idx]
        sections[sl_idx] = rv_arc_sections(
            rv_ray_hits(ref_mask[:, :, sl_idx], cx, cy), cx, cy, _orientation_point(sl_idx),
        )
    if not sections:
        alignment_source = "fixed-angle"
    return {"labels": labels, "sections": sections}, alignment_source


def mask_to_rv_region_areas(mask_3d: np.ndarray, layout: dict) -> np.ndarray:
    """9-element array: Basal_Seg1-3, Mid_Seg1-3, Apical_Seg1-3 (matches the
    frontend's CRESCENT_REGION_NAMES / RvStrainSeries region order). Uses the
    given layout; only the LV centre is taken from this frame's own mask."""
    centroids = lv_reference_centroids(mask_3d)
    labels = layout["labels"]

    ring_values = []
    for ring_type in _RV_RINGS:
        per_slice = []
        for sl_idx, sections in layout["sections"].items():
            if labels[sl_idx] != ring_type or sl_idx >= mask_3d.shape[2] or centroids[sl_idx] is None:
                continue
            cx, cy = centroids[sl_idx]
            per_slice.append(rv_section_areas(mask_3d[:, :, sl_idx], cx, cy, sections))
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

    ref_frames = data.get("reference_frames") or None

    # Both masks are stacked in the same sliceindex order, so a slice's z
    # position is the same in each (the layout is indexed by z).
    slice_order = sorted({
        slc.get("sliceindex", 0)
        for fr in frames + (ref_frames or []) for slc in fr.get("slices", [])
    })
    mask_3d = build_mask_3d(frames, H, W, slice_order)
    ref_mask = build_mask_3d(ref_frames, H, W, slice_order) if ref_frames else mask_3d

    if not np.any(mask_3d == _RV_CLASS):
        print(json.dumps({"error": "No RV (class 1) pixels found in mask data."}), file=sys.stdout)
        sys.exit(1)

    def _xy(v):
        return (float(v[0]), float(v[1]))

    rv_insertion_1 = None
    rv1 = data.get("rv_insertion_1")
    if isinstance(rv1, (list, tuple)) and len(rv1) >= 2:
        try:
            rv_insertion_1 = _xy(rv1)
        except (TypeError, ValueError):
            rv_insertion_1 = None

    # Per-slice landmarks of the reference frame. `slice` is the stored
    # sliceindex → map it to its z position.
    z_of = {sidx: z for z, sidx in enumerate(slice_order)}
    pairs = {}
    for e in data.get("rv_insertion_slices") or []:
        try:
            if int(e["slice"]) in z_of:
                pairs[z_of[int(e["slice"])]] = (_xy(e["p1"]), _xy(e["p2"]))
        except (KeyError, TypeError, ValueError, IndexError):
            continue
    anterior_by_slice = select_anterior_insertions(ref_mask, pairs) if pairs else {}

    layout, alignment_source = make_layout(ref_mask, anterior_by_slice, rv_insertion_1)
    values = mask_to_rv_region_areas(mask_3d, layout)
    regions = [{"region": i + 1, "area": _safe_float(v)} for i, v in enumerate(values)]

    result = {
        "regions": regions,
        "input_shape": list(mask_3d.shape),
        "alignment_source": alignment_source,
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
