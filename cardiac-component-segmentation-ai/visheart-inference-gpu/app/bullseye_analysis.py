"""
bullseye_analysis.py
====================
AHA 17-segment left-ventricular wall-thickness analysis from a 3-D
segmentation mask.

Mask class convention (matches UNETRESNET34 best_model.pth output):
    0 = background
    1 = RV
    2 = myocardium
    3 = LV cavity

Public API
----------
    classify_slices(mask_3d)        -> list[str]
    compute_centroid(slice_mask)    -> (cx, cy) | (None, None)
    ray_cast_thickness(slice_mask, cx, cy, n_rays) -> np.ndarray (n_rays,)
    group_sectors(thicknesses, ring_type)           -> np.ndarray (6|4|1,)
    mask_to_17_segments(mask_3d)    -> np.ndarray (17,)

AHA segment / angle definitions are copied verbatim from
UNETRESNET34/bullseye_17seg.ipynb — do not redefine here.
"""

from __future__ import annotations
import numpy as np
import cv2

# ── AHA 17-Segment Definitions ───────────────────────────────────────────────
# Copied verbatim from UNETRESNET34/bullseye_17seg.ipynb.
# Angles are in degrees, counterclockwise, 90° = Anterior (top / 12 o'clock).

RING_RADII: list[tuple[float, float]] = [
    (1.00, 0.65),  # ring 0 — Basal
    (0.65, 0.40),  # ring 1 — Mid-cavity
    (0.40, 0.18),  # ring 2 — Apical
    (0.18, 0.00),  # ring 3 — Apex (full disk)
]

AHA_SEGMENTS: list[dict] = [
    # Basal (ring 0, 6 × 60°)
    {"idx":  1, "name": "Basal Anterior",      "ring": 0, "t1":  60, "t2": 120},
    {"idx":  2, "name": "Basal Anterolateral", "ring": 0, "t1": 120, "t2": 180},
    {"idx":  3, "name": "Basal Inferolateral", "ring": 0, "t1": 180, "t2": 240},
    {"idx":  4, "name": "Basal Inferior",      "ring": 0, "t1": 240, "t2": 300},
    {"idx":  5, "name": "Basal Inferoseptal",  "ring": 0, "t1": 300, "t2": 360},
    {"idx":  6, "name": "Basal Anteroseptal",  "ring": 0, "t1":   0, "t2":  60},
    # Mid-cavity (ring 1, 6 × 60°)
    {"idx":  7, "name": "Mid Anterior",        "ring": 1, "t1":  60, "t2": 120},
    {"idx":  8, "name": "Mid Anterolateral",   "ring": 1, "t1": 120, "t2": 180},
    {"idx":  9, "name": "Mid Inferolateral",   "ring": 1, "t1": 180, "t2": 240},
    {"idx": 10, "name": "Mid Inferior",        "ring": 1, "t1": 240, "t2": 300},
    {"idx": 11, "name": "Mid Inferoseptal",    "ring": 1, "t1": 300, "t2": 360},
    {"idx": 12, "name": "Mid Anteroseptal",    "ring": 1, "t1":   0, "t2":  60},
    # Apical (ring 2, 4 × 90°)
    {"idx": 13, "name": "Apical Anterior",     "ring": 2, "t1":  45, "t2": 135},
    {"idx": 14, "name": "Apical Lateral",      "ring": 2, "t1": 135, "t2": 225},
    {"idx": 15, "name": "Apical Inferior",     "ring": 2, "t1": 225, "t2": 315},
    {"idx": 16, "name": "Apical Septal",       "ring": 2, "t1": -45, "t2":  45},
    # Apex (ring 3, full circle)
    {"idx": 17, "name": "Apex",                "ring": 3, "t1":   0, "t2": 360},
]

RING_NAMES: list[str] = ["Basal", "Mid-cavity", "Apical", "Apex"]

# ── Internal constants ────────────────────────────────────────────────────────
_MYO_CLASS = 2
_MIN_MYO_PIXELS = 50


# ─────────────────────────────────────────────────────────────────────────────
# classify_slices
# ─────────────────────────────────────────────────────────────────────────────

def classify_slices(
    mask_3d: np.ndarray,
    min_myo_pixels: int = _MIN_MYO_PIXELS,
) -> list[str]:
    """
    Label every slice in a 3-D mask as basal / mid / apical / apex / none.

    Slices with fewer than `min_myo_pixels` class-2 pixels are labelled "none".
    Among valid slices (ordered by index, base → apex):
        top 1/3     → "basal"
        middle 1/3  → "mid"
        next ~1/3   → "apical"
        last 1–2    → "apex"

    Parameters
    ----------
    mask_3d : ndarray, shape (H, W, N_slices), uint8
    min_myo_pixels : pixel-count threshold

    Returns
    -------
    list of str, length N_slices
    """
    n_slices = mask_3d.shape[2]
    labels: list[str] = ["none"] * n_slices

    valid = [
        i for i in range(n_slices)
        if int(np.sum(mask_3d[:, :, i] == _MYO_CLASS)) >= min_myo_pixels
    ]
    n_valid = len(valid)
    if n_valid == 0:
        return labels

    # 1 apex slice for short stacks, 2 for longer stacks
    n_apex = 2 if n_valid >= 15 else 1
    n_remaining = n_valid - n_apex

    n_basal = max(1, round(n_remaining / 3))
    n_mid   = max(1, round(n_remaining / 3))
    n_apical = n_remaining - n_basal - n_mid

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


# ─────────────────────────────────────────────────────────────────────────────
# compute_centroid
# ─────────────────────────────────────────────────────────────────────────────

def compute_centroid(slice_mask: np.ndarray) -> tuple[float, float] | tuple[None, None]:
    """
    Compute the centroid of myocardium (class 2) using cv2.moments.

    Matches find-centroid-and-sample-points.ipynb exactly:
        myo = (slice == 2).astype(uint8)
        M   = cv2.moments(myo * 255)
        cx  = M["m10"] / M["m00"]
        cy  = M["m01"] / M["m00"]

    Parameters
    ----------
    slice_mask : ndarray, shape (H, W), values 0–3

    Returns
    -------
    (cx, cy) as floats, or (None, None) if class 2 is absent.
    """
    myo = (slice_mask == _MYO_CLASS).astype(np.uint8)
    M = cv2.moments(myo * 255)
    if M["m00"] == 0:
        return None, None
    return M["m10"] / M["m00"], M["m01"] / M["m00"]


# ─────────────────────────────────────────────────────────────────────────────
# ray_cast_thickness
# ─────────────────────────────────────────────────────────────────────────────

def ray_cast_thickness(
    slice_mask: np.ndarray,
    cx: float,
    cy: float,
    n_rays: int = 360,
) -> np.ndarray:
    """
    Cast `n_rays` radial rays from (cx, cy) and measure myocardial wall thickness.

    Implements the same pixel-walk / transition-detection logic as
    find-centroid-and-sample-points.ipynb:
      - Walk outward from the centroid along each ray direction
      - Detect every change in the binary myocardium mask (class-2 vs not-class-2)
      - Assign the closer transition point as the inner boundary,
        the farther one as the outer boundary
      - Thickness = Euclidean distance between inner and outer boundary

    Parameters
    ----------
    slice_mask : ndarray, shape (H, W), values 0–3
    cx, cy     : centroid (float pixel coords)
    n_rays     : number of evenly-spaced rays (default 360 → 1° resolution)

    Returns
    -------
    ndarray, shape (n_rays,)
        Thickness in pixels per ray. np.nan where both boundaries were not found.
    """
    H, W = slice_mask.shape
    max_r = max(H, W)

    myo = (slice_mask == _MYO_CLASS).astype(np.uint8)

    angles     = np.linspace(0.0, 2.0 * np.pi, n_rays, endpoint=False)
    directions = np.stack([np.cos(angles), np.sin(angles)], axis=1)

    thicknesses = np.full(n_rays, np.nan, dtype=np.float64)

    cx_i, cy_i = int(cx), int(cy)
    # Clamp centroid to valid range
    cx_i = np.clip(cx_i, 0, W - 1)
    cy_i = np.clip(cy_i, 0, H - 1)

    for ray_i, d in enumerate(directions):
        transitions: list[tuple[int, int]] = []
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


# ─────────────────────────────────────────────────────────────────────────────
# group_sectors
# ─────────────────────────────────────────────────────────────────────────────

def group_sectors(thicknesses: np.ndarray, ring_type: str) -> np.ndarray:
    """
    Average ray thicknesses into AHA sectors, matching AHA_SEGMENTS angle layout.

    Ray angle for ray i = i * 360 / n_rays degrees (0° = right, counterclockwise).

    Sector assignment formula:
        basal / mid  : sector_idx = int( ((angle_deg − 60) % 360) / 60 )
                       → 6 sectors, sector 0 = 60°–120°  (Anterior)
        apical       : sector_idx = int( ((angle_deg − 45) % 360) / 90 )
                       → 4 sectors, sector 0 = 45°–135°  (Apical Anterior)
        apex         : single mean across all rays

    NaN rays are excluded via np.nanmean.

    Parameters
    ----------
    thicknesses : ndarray, shape (n_rays,)
    ring_type   : "basal" | "mid" | "apical" | "apex"

    Returns
    -------
    ndarray — 6 values (basal/mid), 4 (apical), or 1 (apex).
    """
    n_rays     = len(thicknesses)
    ray_angles = np.linspace(0.0, 360.0, n_rays, endpoint=False)

    if ring_type == "apex":
        return np.array([np.nanmean(thicknesses)])

    if ring_type in ("basal", "mid"):
        n_sectors = 6
        raw       = ((ray_angles - 60.0) % 360.0) / 60.0
    elif ring_type == "apical":
        n_sectors = 4
        raw       = ((ray_angles - 45.0) % 360.0) / 90.0
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


# ─────────────────────────────────────────────────────────────────────────────
# mask_to_17_segments  (main entry point)
# ─────────────────────────────────────────────────────────────────────────────

def mask_to_17_segments(mask_3d: np.ndarray) -> np.ndarray:
    """
    Convert a 3-D segmentation mask to 17 AHA segment values.

    Pipeline:
        1. classify_slices()  → label each slice basal/mid/apical/apex/none
        2. For each ring type, process every labelled slice:
               compute_centroid() → ray_cast_thickness() → group_sectors()
        3. Average sector means across all slices of the same ring type
        4. Concatenate into a (17,) array ordered by AHA index:
               segments 1–6   (basal)
               segments 7–12  (mid)
               segments 13–16 (apical)
               segment  17    (apex)

    Parameters
    ----------
    mask_3d : ndarray, shape (H, W, N_slices)
        Values: 0=background, 1=RV, 2=myocardium, 3=LV cavity.

    Returns
    -------
    ndarray, shape (17,)
        Mean wall thickness per AHA segment (index 0 = segment 1).
        np.nan for ring types with no valid slices.
    """
    labels = classify_slices(mask_3d)

    ring_configs: dict[str, int] = {
        "basal":  6,
        "mid":    6,
        "apical": 4,
        "apex":   1,
    }
    ring_results: dict[str, np.ndarray] = {}

    for ring_type, n_sectors in ring_configs.items():
        ring_slices = [i for i, lbl in enumerate(labels) if lbl == ring_type]

        if not ring_slices:
            ring_results[ring_type] = np.full(n_sectors, np.nan)
            continue

        per_slice: list[np.ndarray] = []
        for sl_idx in ring_slices:
            sl   = mask_3d[:, :, sl_idx]
            cx, cy = compute_centroid(sl)
            if cx is None:
                continue
            thick   = ray_cast_thickness(sl, cx, cy)
            sectors = group_sectors(thick, ring_type)
            if not np.all(np.isnan(sectors)):
                per_slice.append(sectors)

        if per_slice:
            ring_results[ring_type] = np.nanmean(per_slice, axis=0)
        else:
            ring_results[ring_type] = np.full(n_sectors, np.nan)

    return np.concatenate([
        ring_results["basal"],
        ring_results["mid"],
        ring_results["apical"],
        ring_results["apex"],
    ])
