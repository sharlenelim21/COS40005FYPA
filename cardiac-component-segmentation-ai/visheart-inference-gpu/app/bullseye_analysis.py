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
    ray_cast_thickness(slice_mask, cx, cy, n_rays, start_angle_rad) -> np.ndarray (n_rays,)
    group_sectors(thicknesses, ring_type)           -> np.ndarray (6|4|1,)
    compute_alignment_angle(cx, cy, rv_insertion_1, rv_insertion_2) -> float | None
    mask_to_17_segments(mask_3d, rv_insertion_1, rv_insertion_2)    -> dict

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
    n_remaining = max(n_valid - n_apex, 3)  # need at least 1 per ring
    n_basal  = max(1, round(n_remaining / 3))
    n_mid    = max(1, round(n_remaining / 3))
    n_apical = max(1, n_remaining - n_basal - n_mid)
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


# ─────────────────────────────────────────────────────────────────────────────
# compute_centroid
# ─────────────────────────────────────────────────────────────────────────────

def compute_centroid(slice_mask: np.ndarray) -> tuple[float, float] | tuple[None, None]:
    """
    Compute the centroid of the LV cavity (class 3) using cv2.moments.

    Uses the LV cavity as the geometric reference centre rather than the
    myocardium ring — this produces a stable centroid that does not drift
    when the wall thickens at ES, eliminating centroid-shift artefacts in
    per-sector GRS computation.

    Parameters
    ----------
    slice_mask : ndarray, shape (H, W), values 0–3

    Returns
    -------
    (cx, cy) as floats, or (None, None) if class 3 is absent.
    """
    lv = (slice_mask == 3).astype(np.uint8)
    M = cv2.moments(lv * 255)
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
    start_angle_rad: float = 0.0,
) -> np.ndarray:
    """
    Cast `n_rays` radial rays from (cx, cy) and measure myocardial wall thickness.

    Rays are cast counter-clockwise on screen starting at `start_angle_rad`,
    matching alignment_17seg_update.ipynb:
        angles = start_angle_rad - linspace(0, 2π, n_rays)

    Parameters
    ----------
    slice_mask      : ndarray, shape (H, W), values 0–3
    cx, cy          : centroid (float pixel coords)
    n_rays          : number of evenly-spaced rays (default 360 → 1° resolution)
    start_angle_rad : starting angle in radians (default 0.0)

    Returns
    -------
    ndarray, shape (n_rays,)
        Thickness in pixels per ray. np.nan where both boundaries were not found.
    """
    H, W = slice_mask.shape
    max_r = max(H, W)

    myo = (slice_mask == _MYO_CLASS).astype(np.uint8)

    angles     = start_angle_rad - np.linspace(0.0, 2.0 * np.pi, n_rays, endpoint=False)
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
# ray_cast_inner_radius  (companion to ray_cast_thickness for GCS)
# ─────────────────────────────────────────────────────────────────────────────

def ray_cast_inner_radius(
    slice_mask: np.ndarray,
    cx: float,
    cy: float,
    n_rays: int = 360,
    start_angle_rad: float = 0.0,
) -> np.ndarray:
    """
    Return the inner-wall radius per ray (centroid → inner myocardium boundary).

    Same ray geometry as ray_cast_thickness; returns np.nan where the inner
    boundary was not found.  Used to compute circumferential strain (GCS).
    """
    H, W = slice_mask.shape
    max_r = max(H, W)

    myo = (slice_mask == _MYO_CLASS).astype(np.uint8)

    angles     = start_angle_rad - np.linspace(0.0, 2.0 * np.pi, n_rays, endpoint=False)
    directions = np.stack([np.cos(angles), np.sin(angles)], axis=1)

    inner_radii = np.full(n_rays, np.nan, dtype=np.float64)

    cx_i = int(np.clip(int(cx), 0, W - 1))
    cy_i = int(np.clip(int(cy), 0, H - 1))

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

        # inner is the closer transition
        if np.linalg.norm(p1 - centre) < np.linalg.norm(p2 - centre):
            inner = p1
        else:
            inner = p2

        inner_radii[ray_i] = float(np.linalg.norm(inner - centre))

    return inner_radii


# ─────────────────────────────────────────────────────────────────────────────
# group_sectors
# ─────────────────────────────────────────────────────────────────────────────

def group_sectors(thicknesses: np.ndarray, ring_type: str) -> np.ndarray:
    """
    Average ray thicknesses into AHA sectors using sequential grouping.

    Rays are cast CCW from a fixed start angle (set by ray_cast_thickness),
    so sectors are simply consecutive equal-sized groups of rays — matching
    alignment_17seg_update.ipynb (distances.reshape(-1, rays_per_sector).mean).

    Raw group order from CCW sampling, then np.roll(-1) for basal/mid only:
        basal/mid : [seg6,seg1,seg2,seg3,seg4,seg5] → roll(-1) → [seg1..seg6]
        apical    : [seg13,seg14,seg15,seg16] — CCW from -45° is already correct, no roll
        apex      : single nanmean (no grouping needed)

    Parameters
    ----------
    thicknesses : ndarray, shape (n_rays,)
    ring_type   : "basal" | "mid" | "apical" | "apex"

    Returns
    -------
    ndarray — 6 values (basal/mid), 4 (apical), or 1 (apex).
    """
    if ring_type == "apex":
        return np.array([np.nanmean(thicknesses)])

    if ring_type in ("basal", "mid"):
        n_sectors = 6
    elif ring_type == "apical":
        n_sectors = 4
    else:
        raise ValueError(f"Unknown ring_type: {ring_type!r}")

    n_rays = len(thicknesses)
    rays_per_sector = n_rays // n_sectors

    result = np.array([
        np.nanmean(thicknesses[s * rays_per_sector : (s + 1) * rays_per_sector])
        for s in range(n_sectors)
    ])

    if ring_type in ("basal", "mid"):
        # With start=240°, raw CW sector order is
        # [Anterolateral, Inferolateral, Inferior, Inferoseptal, Anteroseptal, Anterior].
        # np.roll(result, 1) rotates right by 1 to produce the correct CCW AHA order
        # [Anterior, Anterolateral, Inferolateral, Inferior, Inferoseptal, Anteroseptal].
        return np.roll(result, 1)
    # apical: CW from 315° gives raw order [Anterior, Lateral, Inferior, Septal] — correct as-is
    return result


def group_inner_radii(inner_radii: np.ndarray, ring_type: str) -> np.ndarray:
    """
    Average per-ray inner radii into AHA sectors, same sector ordering as group_sectors.

    Returns mean inner radius per sector (same shape contract as group_sectors).
    """
    if ring_type == "apex":
        return np.array([np.nanmean(inner_radii)])

    n_sectors = 6 if ring_type in ("basal", "mid") else 4
    n_rays = len(inner_radii)
    rays_per_sector = n_rays // n_sectors

    result = np.array([
        np.nanmean(inner_radii[s * rays_per_sector : (s + 1) * rays_per_sector])
        for s in range(n_sectors)
    ])

    if ring_type in ("basal", "mid"):
        return np.roll(result, 1)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# compute_alignment_angle
# ─────────────────────────────────────────────────────────────────────────────

def compute_alignment_angle(
    cx: float,
    cy: float,
    rv_insertion_1: tuple[float, float] | None,
    rv_insertion_2: tuple[float, float] | None,
) -> float | None:
    """
    Compute the anterior start angle from RV insertion points.

    The midpoint of the two RV insertion points points toward the Septal wall.
    Anterior is 90° counterclockwise from Septal in standard AHA orientation.

    Returns the anterior angle in radians, or None if landmarks not provided.
    """
    if rv_insertion_1 is None or rv_insertion_2 is None:
        return None

    x1, y1 = rv_insertion_1
    x2, y2 = rv_insertion_2

    mid_x = (x1 + x2) / 2.0
    mid_y = (y1 + y2) / 2.0

    septal_angle = np.arctan2(mid_y - cy, mid_x - cx)
    anterior_angle = septal_angle + np.pi / 2.0

    return float(anterior_angle)


# ─────────────────────────────────────────────────────────────────────────────
# mask_to_17_segments  (main entry point)
# ─────────────────────────────────────────────────────────────────────────────

def mask_to_17_segments(
    mask_3d: np.ndarray,
    rv_insertion_1: tuple[float, float] | None = None,
    rv_insertion_2: tuple[float, float] | None = None,
) -> dict:
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
    rv_insertion_1 : (x, y) of RV Insertion Point 1 in pixel coords, or None.
    rv_insertion_2 : (x, y) of RV Insertion Point 2 in pixel coords, or None.
        When both are provided, the start angle is derived from the true Septal
        direction instead of the fixed fallback angles.

    Returns
    -------
    dict with keys:
        "values"               : ndarray, shape (17,) — mean wall thickness per AHA segment (pixels)
        "circ_values"          : ndarray, shape (17,) — mean LV inner circumference per segment (2π×r, pixels)
        "lv_centroid"          : [cx, cy] float list, or None
        "alignment_angle_deg"  : float | None — anterior start angle in degrees (landmark-derived)
        "alignment_source"     : "landmark" | "fixed-angle"
    """
    labels = classify_slices(mask_3d)

    ring_configs: dict[str, int] = {
        "basal":  6,
        "mid":    6,
        "apical": 4,
        "apex":   1,
    }
    ring_results: dict[str, np.ndarray] = {}
    ring_inner_results: dict[str, np.ndarray] = {}
    lv_centroids: list[list[float]] = []
    final_alignment_angle: float | None = None  # first landmark-derived angle computed (same for all rings)

    for ring_type, n_sectors in ring_configs.items():
        ring_slices = [i for i, lbl in enumerate(labels) if lbl == ring_type]

        if not ring_slices:
            ring_results[ring_type] = np.full(n_sectors, np.nan)
            ring_inner_results[ring_type] = np.full(n_sectors, np.nan)
            continue

        # Determine start angle: landmark-derived if RV insertion points provided,
        # otherwise fall back to the fixed angles that match group_sectors expectations.
        alignment_angle: float | None = None
        if ring_type != "apex":
            for sl_idx in ring_slices:
                sl_ref = mask_3d[:, :, sl_idx]
                cx_ref, cy_ref = compute_centroid(sl_ref)
                if cx_ref is not None:
                    alignment_angle = compute_alignment_angle(
                        cx_ref, cy_ref, rv_insertion_1, rv_insertion_2
                    )
                    break

        if alignment_angle is not None:
            start_angle = alignment_angle
            if final_alignment_angle is None:
                final_alignment_angle = alignment_angle
        else:
            start_angle_by_ring = {
                "basal":  4 * np.pi / 3,   # 240° — sector boundaries at 240,180,120,60,0,300
                "mid":    4 * np.pi / 3,   # 240°
                "apical": 7 * np.pi / 4,   # 315° — sector boundaries at 315,225,135,45
                "apex":   0.0,
            }
            start_angle = start_angle_by_ring[ring_type]

        per_slice: list[np.ndarray] = []
        per_slice_inner: list[np.ndarray] = []
        for sl_idx in ring_slices:
            sl   = mask_3d[:, :, sl_idx]
            cx, cy = compute_centroid(sl)
            if cx is None:
                continue
            if ring_type in ("basal", "mid"):
                lv_centroids.append([cx, cy])
            thick        = ray_cast_thickness(sl, cx, cy, start_angle_rad=start_angle)
            inner_r      = ray_cast_inner_radius(sl, cx, cy, start_angle_rad=start_angle)
            sectors      = group_sectors(thick, ring_type)
            inner_secs   = group_inner_radii(inner_r, ring_type)
            if not np.all(np.isnan(sectors)):
                per_slice.append(sectors)
                per_slice_inner.append(inner_secs)

        if per_slice:
            ring_results[ring_type]       = np.nanmean(per_slice, axis=0)
            ring_inner_results[ring_type] = np.nanmean(per_slice_inner, axis=0)
        else:
            ring_results[ring_type]       = np.full(n_sectors, np.nan)
            ring_inner_results[ring_type] = np.full(n_sectors, np.nan)

    values = np.concatenate([
        ring_results["basal"],
        ring_results["mid"],
        ring_results["apical"],
        ring_results["apex"],
    ])
    # circ_values: LV inner circumference per AHA segment = 2π × mean_inner_radius
    # Used for GCS = (circ_ES - circ_ED) / circ_ED × 100
    inner_radii_flat = np.concatenate([
        ring_inner_results["basal"],
        ring_inner_results["mid"],
        ring_inner_results["apical"],
        ring_inner_results["apex"],
    ])
    circ_values = 2.0 * np.pi * inner_radii_flat

    lv_centroid: list[float] | None = (
        [float(np.mean([c[0] for c in lv_centroids])),
         float(np.mean([c[1] for c in lv_centroids]))]
        if lv_centroids else None
    )
    return {
        "values": values,
        "circ_values": circ_values,
        "lv_centroid": lv_centroid,
        "alignment_angle_deg": float(np.degrees(final_alignment_angle)) if final_alignment_angle is not None else None,
        "alignment_source": "landmark" if final_alignment_angle is not None else "fixed-angle",
    }
