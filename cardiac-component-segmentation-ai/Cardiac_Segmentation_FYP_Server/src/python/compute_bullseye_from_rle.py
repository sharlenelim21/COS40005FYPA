"""
compute_bullseye_from_rle.py
============================
Compute AHA 17-segment wall-thickness from a segmentation mask document stored
in MongoDB (RLE / segmentationmaskcontents format).

Input (stdin): JSON object with fields:
    frames          — list of frame objects (same schema as IProjectSegmentationMask.frames)
    width           — image width in pixels
    height          — image height in pixels
    rv_insertion_1  — optional [x, y] of the ANTERIOR RV insertion point (pixels).
                      With it the segments are aligned to the landmark exactly as
                      the GPU does. Without it the point is estimated from the RV
                      in the mask (same method as the GPU); only if the mask has
                      no RV are the fixed fallback angles used.
    rv_insertion_slices — optional [{slice, p1: [x, y], p2: [x, y]}, ...]: both RV
                      insertion points of every slice (slice = sliceindex). When it
                      holds usable slices, each ring is aligned to its own slices'
                      anterior points (as the GPU does) and rv_insertion_1 is not used.
    anterior_points — optional [{slice, point: [x, y]}, ...]: anterior points that
                      were ALREADY chosen on a reference frame (the first frame of
                      the cycle). Used for every slice that has no usable point of
                      its own in rv_insertion_slices.

Output (stdout): JSON object matching BullseyeAnalysisResult:
    segment_values   — list[float], length 17 (pixels), standard AHA numbering
    segment_metadata — list[{idx, name, ring, value}]
    stats            — {min, max, mean, n_nan}
    input_shape      — [H, W, N_slices]
    slice_labels     — list[str]
    request_id       — null
    alignment_angle_deg / alignment_source — as in the GPU result
        ("landmark" | "rv-mask" | "fixed-angle")
    alignment_point  — [x, y] the start angle was measured from, or null
    anterior_points  — [{slice, point}] the anterior points used per slice (empty
                       when per-slice landmarks were not used)

Segment order and alignment follow the GPU's bullseye_analysis.py (which
follows the client's alignment notebook): rays sweep with increasing angle
from the start angle and the first 60° block is segment 1.

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

# ── AHA 17-Segment Definitions (verbatim from bullseye_analysis.py) ───────────
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
_RV_CLASS = 1
_LV_CAVITY_CLASS = 3
_MIN_MYO_PIXELS = 50
_MIN_RV_PIXELS = 30
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


def compute_centroid(
    slice_mask: np.ndarray, class_label: int = _LV_CAVITY_CLASS,
) -> tuple[Optional[float], Optional[float]]:
    """Pure-numpy centroid of the given mask class (replaces cv2.moments) — mirrors the
    GPU's bullseye_analysis.compute_centroid exactly, including its default.

    Defaults to the LV cavity (class 3), not the myocardium ring: the GPU code's own
    docstring explains why — the cavity is a stable reference that doesn't drift the way
    the ring does. The ring can carry small mislabeled blobs disconnected from the real
    wall (segmentation noise), and an ALL-myocardium-pixel centroid gets pulled toward
    them; rays cast from that shifted point then cut the real wall at a tangent on one
    side and foreshorten it on the other, instead of measuring it radially. Reported live,
    2026-10-26: patient005's MedSAM apical-septal segment read 12.85mm against this same
    patient's ground-truth 9.94mm for that segment, traced to a slice whose myocardium
    label had 14 disconnected components (one a 163px blob) pulling the myo-centroid ~6px
    off the true ring centre — while the LV-cavity centroid for that slice was undisturbed
    by it, cavity pixels being a single compact region far less prone to this kind of
    stray mislabeling.
    """
    region = (slice_mask == class_label).astype(np.float64)
    total = region.sum()
    if total == 0:
        return None, None
    ys, xs = np.where(region)
    cx = float(xs.sum() / total)
    cy = float(ys.sum() / total)
    return cx, cy


# Ray start angles when no RV insertion landmark is available (degrees, image
# convention: 0 = right, 90 = down, 180 = left, 270 = up). Same values as the
# GPU's bullseye_analysis.mask_to_17_segments: segment 1 / 7 covers 240–300°
# and segment 13 covers 225–315°, i.e. both are centred at the top of the image.
_FALLBACK_START_DEG = {"basal": 240.0, "mid": 240.0, "apical": 225.0, "apex": 0.0}


def compute_alignment_angle_deg(cx: float, cy: float, rv_insertion_1, ring_type: str) -> Optional[float]:
    """
    Ray start angle (degrees) from the anterior RV insertion point — same rule
    as the GPU's bullseye_analysis.compute_alignment_angle (client notebook):
    angle(centre → rv_insertion_1) − 60°, or − 75° for the apical ring.
    Returns None when no landmark is given.
    """
    if rv_insertion_1 is None:
        return None
    angle_deg = math.degrees(math.atan2(rv_insertion_1[1] - cy, rv_insertion_1[0] - cx))
    return angle_deg - (75.0 if ring_type == "apical" else 60.0)


def estimate_anterior_rv_insertion(mask_3d: np.ndarray):
    """
    Estimate the anterior RV insertion point from the mask alone, for projects
    with no landmark — a port of the GPU's
    bullseye_analysis.estimate_anterior_rv_insertion (same steps, same numbers).

    Per slice with both an LV cavity and an RV: look at the RV pixels from the
    LV-cavity centre, take the 2 % with the lowest angle (the end of the RV
    from which increasing angle sweeps into the RV) and average their (x, y).
    The per-slice points are then averaged into one point.

    Returns (x, y), or None if no slice has both an LV cavity and an RV.
    """
    points = []
    for sl_idx in range(mask_3d.shape[2]):
        sl = mask_3d[:, :, sl_idx]
        lys, lxs = np.nonzero(sl == _LV_CAVITY_CLASS)
        if lxs.size == 0:
            continue
        cx, cy = float(lxs.mean()), float(lys.mean())
        ys, xs = np.nonzero(sl == _RV_CLASS)
        if xs.size < _MIN_RV_PIXELS:
            continue
        rv_dir = math.atan2(float(ys.mean()) - cy, float(xs.mean()) - cx)
        rel = (np.arctan2(ys - cy, xs - cx) - rv_dir + math.pi) % (2.0 * math.pi) - math.pi
        edge = rel <= np.percentile(rel, _RV_EDGE_PERCENTILE)
        points.append((float(xs[edge].mean()), float(ys[edge].mean())))
    if not points:
        return None
    return (
        float(np.mean([p[0] for p in points])),
        float(np.mean([p[1] for p in points])),
    )


def select_anterior_insertions(mask_3d: np.ndarray, slice_pairs) -> dict:
    """
    Port of the GPU's bullseye_analysis.select_anterior_insertions (same rule):
    from the two RV insertion points of each slice keep the one that has the RV
    on its increasing-angle (clockwise-on-screen) side, seen from that slice's
    LV-cavity centre. Skips slices with no LV cavity, too little RV, collapsed
    points (< _MIN_INSERTION_SEPARATION_PX apart) or an ambiguous choice.

    slice_pairs : {z: ((x, y), (x, y))} in this mask's slice position.
    Returns {z: (x, y)}.
    """
    selected = {}
    for z, (p1, p2) in (slice_pairs or {}).items():
        if not (0 <= z < mask_3d.shape[2]):
            continue
        if math.hypot(p1[0] - p2[0], p1[1] - p2[1]) < _MIN_INSERTION_SEPARATION_PX:
            continue
        sl = mask_3d[:, :, z]
        lys, lxs = np.nonzero(sl == _LV_CAVITY_CLASS)
        if lxs.size == 0:
            continue
        cx, cy = float(lxs.mean()), float(lys.mean())
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


def ring_alignment_points(labels: list, anterior_by_slice: dict) -> dict:
    """
    Port of the GPU's bullseye_analysis._ring_alignment_points: one point per
    ring = mean of the anterior points of the ring's own slices; a ring with
    no usable slice takes the points of the nearest slice(s).
    """
    points = {}
    if not anterior_by_slice:
        return points
    for ring in ("basal", "mid", "apical"):
        ring_slices = [i for i, lbl in enumerate(labels) if lbl == ring]
        own = [p for z, p in anterior_by_slice.items() if z in ring_slices]
        if not own and ring_slices:
            gap = {z: min(abs(z - r) for r in ring_slices) for z in anterior_by_slice}
            nearest = min(gap.values())
            own = [anterior_by_slice[z] for z, g in gap.items() if g == nearest]
        if own:
            points[ring] = (
                float(np.mean([p[0] for p in own])),
                float(np.mean([p[1] for p in own])),
            )
    return points


def ray_cast_thickness(
    slice_mask: np.ndarray, cx: float, cy: float, n_rays: int = 360, start_angle_rad: float = 0.0,
) -> np.ndarray:
    """Wall thickness per ray. Rays start at `start_angle_rad` and sweep with
    INCREASING angle (clockwise on screen), as in the GPU code and the client
    notebook: angles = start + linspace(0, 2π)."""
    H, W = slice_mask.shape
    max_r = max(H, W)
    myo = (slice_mask == _MYO_CLASS).astype(np.uint8)
    angles = start_angle_rad + np.linspace(0.0, 2.0 * math.pi, n_rays, endpoint=False)
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
    """Mean thickness per AHA sector. The rays are already in casting order,
    so each sector is the next equal block of rays and the first block is
    segment 1 / 7 / 13 — same as the GPU's bullseye_analysis.group_sectors."""
    if ring_type == "apex":
        return np.array([np.nanmean(thicknesses)])
    if ring_type in ("basal", "mid"):
        n_sectors = 6
    elif ring_type == "apical":
        n_sectors = 4
    else:
        raise ValueError(f"Unknown ring_type: {ring_type!r}")
    rays_per_sector = len(thicknesses) // n_sectors
    result = np.full(n_sectors, np.nan, dtype=np.float64)
    for s in range(n_sectors):
        vals = thicknesses[s * rays_per_sector : (s + 1) * rays_per_sector]
        if vals.size and not np.all(np.isnan(vals)):
            result[s] = float(np.nanmean(vals))
    return result


def mask_to_17_segments(mask_3d: np.ndarray, rv_insertion_1=None, anterior_by_slice=None) -> dict:
    """
    17 AHA wall-thickness values (pixels), standard AHA numbering.

    anterior_by_slice : {z: (x, y)} anterior insertion point per slice (from
        select_anterior_insertions). When non-empty, each ring is aligned to
        its own slices' points and rv_insertion_1 is not used.
    rv_insertion_1 : (x, y) of the ANTERIOR RV insertion point, or None.
        With it, the ray start angle of each ring follows the landmark (same
        rule as the GPU). Without it, the point is estimated from the RV in
        the mask; only if that is impossible are the fixed angles used.
    """
    labels = classify_slices(mask_3d)
    ring_points = ring_alignment_points(labels, anterior_by_slice) if anterior_by_slice else {}

    alignment_source = "landmark"
    if not ring_points and rv_insertion_1 is None:
        rv_insertion_1 = estimate_anterior_rv_insertion(mask_3d)
        alignment_source = "rv-mask" if rv_insertion_1 is not None else "fixed-angle"
    final_alignment_point = None
    ring_configs = {"basal": 6, "mid": 6, "apical": 4, "apex": 1}
    ring_results = {}
    lv_centroids: list[list[float]] = []
    final_alignment_deg: Optional[float] = None
    for ring_type, n_sectors in ring_configs.items():
        ring_slices = [i for i, lbl in enumerate(labels) if lbl == ring_type]
        if not ring_slices:
            ring_results[ring_type] = np.full(n_sectors, np.nan)
            continue

        # Start angle of this ring: from the landmark (measured from the first
        # slice of the ring that has a centroid), else the fixed fallback.
        ring_point = ring_points.get(ring_type, rv_insertion_1) if ring_points else rv_insertion_1
        start_deg: Optional[float] = None
        if ring_type != "apex":
            for sl_idx in ring_slices:
                cx_ref, cy_ref = compute_centroid(mask_3d[:, :, sl_idx])
                if cx_ref is not None:
                    start_deg = compute_alignment_angle_deg(cx_ref, cy_ref, ring_point, ring_type)
                    break
        if start_deg is not None:
            if final_alignment_deg is None:
                final_alignment_deg = start_deg
                final_alignment_point = ring_point
        else:
            start_deg = _FALLBACK_START_DEG[ring_type]
        start_rad = math.radians(start_deg)

        per_slice = []
        for sl_idx in ring_slices:
            sl = mask_3d[:, :, sl_idx]
            cx, cy = compute_centroid(sl)
            if cx is None:
                continue
            if ring_type in ("basal", "mid"):
                lv_centroids.append([cx, cy])
            thick = ray_cast_thickness(sl, cx, cy, start_angle_rad=start_rad)
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
    return {
        "values": values,
        "lv_centroid": lv_centroid,
        "alignment_angle_deg": final_alignment_deg,
        "alignment_source": alignment_source if final_alignment_deg is not None else "fixed-angle",
        "alignment_point": (
            [float(final_alignment_point[0]), float(final_alignment_point[1])]
            if final_alignment_point is not None else None
        ),
    }


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

    # Optional anterior RV insertion point [x, y] (pixel coords).
    rv1 = data.get("rv_insertion_1")
    rv_insertion_1 = None
    if isinstance(rv1, (list, tuple)) and len(rv1) >= 2:
        try:
            rv_insertion_1 = (float(rv1[0]), float(rv1[1]))
        except (TypeError, ValueError):
            rv_insertion_1 = None

    mask_3d = build_mask_3d(frames, H, W)

    # Per-slice landmarks. `slice` is the stored sliceindex; build_mask_3d
    # stacks the slices in sorted sliceindex order, so map it to that position.
    slice_order = sorted({slc.get("sliceindex", 0) for fr in frames for slc in fr.get("slices", [])})
    z_of = {sidx: z for z, sidx in enumerate(slice_order)}
    sidx_of = {z: sidx for sidx, z in z_of.items()}

    def _xy(v):
        return (float(v[0]), float(v[1]))

    # This frame's own points (chosen on this mask) win; any slice without a
    # usable one keeps the reference frame's point.
    anterior_by_slice = {}
    for e in data.get("anterior_points") or []:
        try:
            if int(e["slice"]) in z_of:
                anterior_by_slice[z_of[int(e["slice"])]] = _xy(e["point"])
        except (KeyError, TypeError, ValueError, IndexError):
            continue
    pairs = {}
    for e in data.get("rv_insertion_slices") or []:
        try:
            if int(e["slice"]) in z_of:
                pairs[z_of[int(e["slice"])]] = (_xy(e["p1"]), _xy(e["p2"]))
        except (KeyError, TypeError, ValueError, IndexError):
            continue
    if pairs:
        anterior_by_slice.update(select_anterior_insertions(mask_3d, pairs))

    if not np.any(mask_3d == _MYO_CLASS):
        print(json.dumps({"error": "No myocardium (class 2) pixels found in mask data."}), file=sys.stdout)
        sys.exit(1)

    analysis = mask_to_17_segments(mask_3d, rv_insertion_1, anterior_by_slice)
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
        "alignment_angle_deg": analysis["alignment_angle_deg"],
        "alignment_source":    analysis["alignment_source"],
        "alignment_point":     analysis["alignment_point"],
        "anterior_points":     [
            {"slice": sidx_of[z], "point": [p[0], p[1]]} for z, p in sorted(anterior_by_slice.items())
        ],
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
