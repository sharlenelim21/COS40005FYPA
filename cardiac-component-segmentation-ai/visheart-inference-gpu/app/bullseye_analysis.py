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
    compute_centroid(slice_mask, class_label=3) -> (cx, cy) | (None, None)
    ray_cast_thickness(slice_mask, cx, cy, n_rays, start_angle_rad) -> np.ndarray (n_rays,)
    group_sectors(thicknesses, ring_type)           -> np.ndarray (6|4|1,)
    compute_alignment_angle(cx, cy, rv_insertion_1, rv_insertion_2, ring_type) -> float | None
    mask_to_17_segments(mask_3d, rv_insertion_1, rv_insertion_2)    -> dict

    classify_rv_slices(mask_3d)                     -> list[str]
    ray_cast_rv_hits(slice_mask, cx, cy, n_rays, start_angle_rad) -> (inner_pts, outer_pts)
    rv_arc_sections(hit, cx, cy, ...)               -> np.ndarray (n_rays,) section id or -1
    mask_to_rv_regions(mask_3d, rv_insertion_1, rv_insertion_2, layout) -> dict

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
    {"idx":  2, "name": "Basal Anteroseptal",  "ring": 0, "t1": 120, "t2": 180},
    {"idx":  3, "name": "Basal Inferoseptal",  "ring": 0, "t1": 180, "t2": 240},
    {"idx":  4, "name": "Basal Inferior",      "ring": 0, "t1": 240, "t2": 300},
    {"idx":  5, "name": "Basal Inferolateral", "ring": 0, "t1": 300, "t2": 360},
    {"idx":  6, "name": "Basal Anterolateral", "ring": 0, "t1":   0, "t2":  60},
    # Mid-cavity (ring 1, 6 × 60°)
    {"idx":  7, "name": "Mid Anterior",        "ring": 1, "t1":  60, "t2": 120},
    {"idx":  8, "name": "Mid Anteroseptal",    "ring": 1, "t1": 120, "t2": 180},
    {"idx":  9, "name": "Mid Inferoseptal",    "ring": 1, "t1": 180, "t2": 240},
    {"idx": 10, "name": "Mid Inferior",        "ring": 1, "t1": 240, "t2": 300},
    {"idx": 11, "name": "Mid Inferolateral",   "ring": 1, "t1": 300, "t2": 360},
    {"idx": 12, "name": "Mid Anterolateral",   "ring": 1, "t1":   0, "t2":  60},
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
_RV_CLASS = 1
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

def compute_centroid(
    slice_mask: np.ndarray, class_label: int = 3
) -> tuple[float, float] | tuple[None, None]:
    """
    Compute the centroid of the given mask class using cv2.moments.

    Defaults to the LV cavity (class 3) — used as the geometric reference
    centre rather than the myocardium ring because it produces a stable
    centroid that does not drift when the wall thickens at ES, eliminating
    centroid-shift artefacts in per-sector GRS computation. Pass
    class_label=1 (RV cavity) to get the RV centroid instead — used by
    mask_to_rv_regions().

    Parameters
    ----------
    slice_mask : ndarray, shape (H, W), values 0–3
    class_label : mask class to centre on (default 3 = LV cavity)

    Returns
    -------
    (cx, cy) as floats, or (None, None) if the class is absent from the slice.
    """
    region = (slice_mask == class_label).astype(np.uint8)
    M = cv2.moments(region * 255)
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
# ray_cast_boundary_points  (per-ray inner/outer (x,y), for notebook-style GCS)
# ─────────────────────────────────────────────────────────────────────────────

def ray_cast_boundary_points(
    slice_mask: np.ndarray,
    cx: float,
    cy: float,
    n_rays: int = 360,
    start_angle_rad: float = 0.0,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Cast `n_rays` radial rays from (cx, cy) and return the inner and outer
    myocardium boundary (x, y) pixel coordinates per ray.

    Same ray geometry and transition logic as ray_cast_thickness, but returns
    the boundary points themselves rather than a scalar thickness/radius —
    needed to reproduce alignment_17seg_update.ipynb's circumferential-strain
    method, which sums the Euclidean distance between each ray's boundary
    point and the next ray's boundary point (a chord-length approximation of
    the boundary's circumference) rather than averaging per-ray radii.

    Returns
    -------
    (inner_pts, outer_pts) : each ndarray, shape (n_rays, 2), np.nan rows
    where a boundary was not found for that ray.
    """
    H, W = slice_mask.shape
    max_r = max(H, W)

    myo = (slice_mask == _MYO_CLASS).astype(np.uint8)

    angles     = start_angle_rad - np.linspace(0.0, 2.0 * np.pi, n_rays, endpoint=False)
    directions = np.stack([np.cos(angles), np.sin(angles)], axis=1)

    inner_pts = np.full((n_rays, 2), np.nan, dtype=np.float64)
    outer_pts = np.full((n_rays, 2), np.nan, dtype=np.float64)

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

        if np.linalg.norm(p1 - centre) < np.linalg.norm(p2 - centre):
            inner, outer = p1, p2
        else:
            inner, outer = p2, p1

        inner_pts[ray_i] = inner
        outer_pts[ray_i] = outer

    return inner_pts, outer_pts


# ─────────────────────────────────────────────────────────────────────────────
# group_chord_sums  (notebook-style per-sector circumference for GCS)
# ─────────────────────────────────────────────────────────────────────────────

def group_chord_sums(points: np.ndarray, ring_type: str) -> np.ndarray:
    """
    Sum consecutive-ray chord lengths into AHA sectors, matching
    alignment_17seg_update.ipynb's circumferential-strain method: for each
    ray i, take the Euclidean distance from points[i] to points[i+1] (the
    next ray CCW, wrapping around), then SUM (not average) those per-sector —
    a chord-length approximation of that boundary's circumference.

    Same sector ordering/roll convention as group_sectors, since `points`
    comes from the same CCW ray sampling.

    Parameters
    ----------
    points    : ndarray, shape (n_rays, 2) — boundary (x, y) per ray, may
                contain np.nan rows for rays where no boundary was found.
    ring_type : "basal" | "mid" | "apical" | "apex"

    Returns
    -------
    ndarray — 6 values (basal/mid), 4 (apical), or 1 (apex): summed chord
    length per AHA sector.
    """
    n_rays = len(points)
    next_points = np.roll(points, -1, axis=0)
    chord_lengths = np.linalg.norm(next_points - points, axis=1)

    if ring_type == "apex":
        return np.array([np.nansum(chord_lengths)])

    n_sectors = 6 if ring_type in ("basal", "mid") else 4
    rays_per_sector = n_rays // n_sectors

    result = np.array([
        np.nansum(chord_lengths[s * rays_per_sector : (s + 1) * rays_per_sector])
        for s in range(n_sectors)
    ])

    if ring_type in ("basal", "mid"):
        return np.roll(result, 1)
    return result


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
# RV 9-segment helpers  (RV regional strain)
# ─────────────────────────────────────────────────────────────────────────────
# RV bullseye = 3 rings (basal / mid / apical) x 3 sections. Rays are shot
# from the LV centroid (not the RV's own), 360 of them; only the rays that
# pass through the RV cavity (class 1) are kept, and that contiguous arc of
# RV-hitting rays is split into 3 equal-ray-count sections. There is no RV
# free-wall myocardium label in this mask, so per section we measure the RV
# cavity itself: the free-wall boundary chord length (GCS-style) and the
# cavity area inside the section's wedge (GAS-style).

_RV_RINGS: tuple[str, ...] = ("basal", "mid", "apical")
_RV_SECTIONS = 3
_MIN_RV_PIXELS = 30


def classify_rv_slices(
    mask_3d: np.ndarray,
    min_rv_pixels: int = _MIN_RV_PIXELS,
) -> list[str]:
    """
    Label every slice as basal / mid / apical / none for the RV bullseye.

    Slices with at least `min_rv_pixels` RV (class 1) pixels are split into
    three even thirds by index (base → apex, same slice ordering as
    classify_slices). Unlike the LV there is no separate apex ring.
    """
    n_slices = mask_3d.shape[2]
    labels: list[str] = ["none"] * n_slices
    valid = [
        i for i in range(n_slices)
        if int(np.sum(mask_3d[:, :, i] == _RV_CLASS)) >= min_rv_pixels
    ]
    for k, sl in enumerate(valid):
        labels[sl] = _RV_RINGS[min(k * 3 // len(valid), 2)]
    return labels


def lv_reference_centroids(mask_3d: np.ndarray) -> list[tuple[float, float] | None]:
    """
    Per-slice LV reference centre for the RV rays: LV cavity centroid, else
    myocardium centroid, else the nearest slice's centre (RV often extends
    past the LV at the base/apex, where the slice has no LV at all).
    """
    n_slices = mask_3d.shape[2]
    own: list[tuple[float, float] | None] = []
    for i in range(n_slices):
        sl = mask_3d[:, :, i]
        cx, cy = compute_centroid(sl, class_label=3)
        if cx is None:
            cx, cy = compute_centroid(sl, class_label=_MYO_CLASS)
        own.append((cx, cy) if cx is not None else None)

    known = [i for i, c in enumerate(own) if c is not None]
    if not known:
        return own
    return [
        c if c is not None else own[min(known, key=lambda k: abs(k - i))]
        for i, c in enumerate(own)
    ]


def ray_cast_rv_hits(
    slice_mask: np.ndarray,
    cx: float,
    cy: float,
    n_rays: int = 360,
    start_angle_rad: float = 0.0,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Cast `n_rays` rays from the LV centre (cx, cy) and find where each one
    crosses the RV cavity.

    Same ray geometry/screen convention as ray_cast_thickness (index grows
    counter-clockwise on screen). Per ray, the first contiguous run of RV
    pixels gives the septal-side entry point (inner) and the free-wall exit
    point (outer).

    Returns
    -------
    (inner_pts, outer_pts) : each ndarray, shape (n_rays, 2) of (x, y),
    np.nan rows for rays that never touch the RV.
    """
    H, W = slice_mask.shape
    max_r = max(H, W)

    angles = start_angle_rad - np.linspace(0.0, 2.0 * np.pi, n_rays, endpoint=False)
    rs = np.arange(1, max_r)
    xs = (cx + rs[None, :] * np.cos(angles)[:, None]).astype(int)
    ys = (cy + rs[None, :] * np.sin(angles)[:, None]).astype(int)

    # A ray stops at the first step that leaves the image (as in ray_cast_thickness).
    in_bounds = np.logical_and.accumulate((xs >= 0) & (xs < W) & (ys >= 0) & (ys < H), axis=1)
    hit = in_bounds & (slice_mask[np.clip(ys, 0, H - 1), np.clip(xs, 0, W - 1)] == _RV_CLASS)

    inner_pts = np.full((n_rays, 2), np.nan, dtype=np.float64)
    outer_pts = np.full((n_rays, 2), np.nan, dtype=np.float64)

    any_hit = hit.any(axis=1)
    first = np.argmax(hit, axis=1)
    after_run = ~hit & (np.arange(len(rs))[None, :] >= first[:, None])
    last = np.where(after_run.any(axis=1), np.argmax(after_run, axis=1) - 1, len(rs) - 1)

    rows = np.flatnonzero(any_hit)
    inner_pts[rows] = np.stack([xs[rows, first[rows]], ys[rows, first[rows]]], axis=1)
    outer_pts[rows] = np.stack([xs[rows, last[rows]], ys[rows, last[rows]]], axis=1)
    return inner_pts, outer_pts


def rv_arc_sections(
    hit: np.ndarray,
    cx: float,
    cy: float,
    start_angle_rad: float = 0.0,
    rv_insertion_1: tuple[float, float] | None = None,
    n_sections: int = _RV_SECTIONS,
) -> np.ndarray:
    """
    Assign each ray to an RV section (0..n_sections-1), or -1 if it is
    outside the RV arc.

    The arc is every ray from the first to the last RV-hitting ray around
    the largest angular gap of misses — so small holes inside the RV (a
    mask speckle, a trabeculation) don't split it. The arc is then cut into
    `n_sections` groups of equal ray count.

    Section order: 0 = inferior end, n_sections-1 = anterior end, matching
    the frontend crescent (CombinedVentricularChart: Seg1 inferior → Seg3
    anterior). The anterior end is the arc end nearer rv_insertion_1 (the
    anterior RV insertion point); without landmarks we assume standard SAX
    display, where the CCW sweep from the lateral gap reaches anterior first.
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

    start_is_anterior = True
    if rv_insertion_1 is not None:
        step = 2.0 * np.pi / n
        ant = np.arctan2(rv_insertion_1[1] - cy, rv_insertion_1[0] - cx)

        def _dist(ray_i: int) -> float:
            d = (start_angle_rad - ray_i * step - ant) % (2.0 * np.pi)
            return min(d, 2.0 * np.pi - d)

        start_is_anterior = _dist(int(arc[0])) <= _dist(int(arc[-1]))

    sections[arc] = (n_sections - 1 - order) if start_is_anterior else order
    return sections


def rv_section_measures(
    slice_mask: np.ndarray,
    cx: float,
    cy: float,
    sections: np.ndarray,
    start_angle_rad: float = 0.0,
    n_sections: int = _RV_SECTIONS,
) -> dict[str, np.ndarray]:
    """
    Per-section RV measures for one slice, given a fixed ray → section map.

    chord  : summed free-wall (outer) boundary chord length between
             consecutive rays of the same section (px) — GCS-style, same
             idea as group_chord_sums.
    area   : RV cavity pixels whose angle from (cx, cy) falls in the
             section's rays (px²) — GAS-style.
    radius : mean LV-centre → free-wall distance (px).
    """
    n = len(sections)
    _, outer = ray_cast_rv_hits(slice_mask, cx, cy, n_rays=n, start_angle_rad=start_angle_rad)

    chords = np.linalg.norm(np.roll(outer, -1, axis=0) - outer, axis=1)
    same_section = (sections >= 0) & (sections == np.roll(sections, -1))
    radii = np.linalg.norm(outer - np.array([cx, cy]), axis=1)

    ys, xs = np.nonzero(slice_mask == _RV_CLASS)
    step = 2.0 * np.pi / n
    ray_of_px = np.round(((start_angle_rad - np.arctan2(ys - cy, xs - cx)) % (2.0 * np.pi)) / step).astype(int) % n
    px_section = sections[ray_of_px]

    chord = np.full(n_sections, np.nan)
    area = np.full(n_sections, np.nan)
    radius = np.full(n_sections, np.nan)
    for s in range(n_sections):
        in_s = sections == s
        if not in_s.any():
            continue
        valid_chords = chords[same_section & (sections == s) & ~np.isnan(chords)]
        if valid_chords.size:
            chord[s] = float(valid_chords.sum())
        area[s] = float(np.sum(px_section == s))
        if not np.all(np.isnan(radii[in_s])):
            radius[s] = float(np.nanmean(radii[in_s]))
    return {"chord": chord, "area": area, "radius": radius}


# ─────────────────────────────────────────────────────────────────────────────
# compute_alignment_angle
# ─────────────────────────────────────────────────────────────────────────────

def compute_alignment_angle_midpoint_LEGACY(
    cx: float,
    cy: float,
    rv_insertion_1: tuple[float, float] | None,
    rv_insertion_2: tuple[float, float] | None,
) -> float | None:
    """
    LEGACY — superseded by compute_alignment_angle() (single-point formula).

    Kept unused, not deleted, for comparison/revert. This was the original
    midpoint-based formula, used back when neither RV insertion point had a
    confirmed anatomical identity (no way to tell which of the two was
    anterior vs. inferior).

    Compute the anterior start angle from RV insertion points.

    The midpoint of the two RV insertion points points toward the Septal wall.

    IMPORTANT — this offset is NOT a naive "Anterior is 90° counterclockwise
    from Septal" geometric rotation. Two things make that naive assumption
    wrong here:

      1. The ray-caster's coordinate frame has y growing DOWNWARD (screen/array
         convention), so a "+90° counterclockwise" rotation in that frame
         actually points toward screen-Inferior, not screen-Anterior — the
         sign is backwards versus the usual math-convention intuition.

      2. Even after fixing the sign, the fixed-angle path's start angles
         (240° basal/mid, 315° apical) are NOT "true" anterior (270°) — they
         are baselines that group_sectors()'s np.roll(result, 1) was
         specifically calibrated against. The landmark-derived angle must
         reproduce that same 240° calibration point (when the septal
         direction is at the canonical screen-right / 0°), not the
         geometrically "correct" 270°, or the roll will misassign segments.

    Combining both corrections gives septal_angle + 240° (4π/3), which
    collapses to the fixed-angle path's 240° baseline exactly when septal
    points screen-right, and rotates consistently with the heart otherwise.

    This was diagnosed and empirically verified via a synthetic self-checking
    test: a myocardium ring with a thickened wedge at each of the 4 cardinal
    screen positions (Anterior/Septal/Inferior/Lateral) was run through the
    real pipeline, confirming the old `septal_angle + π/2` formula misassigned
    segments (e.g. an Anterior-positioned wedge landed in "Basal Inferior"),
    while `septal_angle + 4π/3` correctly assigns all 4 positions to their
    true AHA segments. See the read-only diagnostic pass on this branch for
    the full test and derivation before changing this formula again.

    Returns the anterior angle in radians, or None if landmarks not provided.
    """
    if rv_insertion_1 is None or rv_insertion_2 is None:
        return None

    x1, y1 = rv_insertion_1
    x2, y2 = rv_insertion_2

    mid_x = (x1 + x2) / 2.0
    mid_y = (y1 + y2) / 2.0

    septal_angle = np.arctan2(mid_y - cy, mid_x - cx)
    anterior_angle = septal_angle + (4.0 * np.pi / 3.0)

    return float(anterior_angle)


def compute_alignment_angle(
    cx: float,
    cy: float,
    rv_insertion_1: tuple[float, float] | None,
    rv_insertion_2: tuple[float, float] | None,
    ring_type: str = "basal",
) -> float | None:
    """
    Compute the anterior start angle from RV insertion point 1 alone.

    Per client (Ms Kathy) confirmation, the landmark model was trained with a
    fixed anatomical identity: rv_insertion_1 = anterior RV insertion point,
    rv_insertion_2 = inferior. This replaces the earlier midpoint-based
    approach (compute_alignment_angle_midpoint_LEGACY), which was needed only
    while neither point had a confirmed identity.

    start_angle = angle(rv_insertion_1) - 60°, except the apical ring, which
    uses -75° per Notes.pdf.

    Returns the anterior angle in radians, or None if rv_insertion_1 is not
    provided.
    """
    if rv_insertion_1 is None:
        return None

    p1_x, p1_y = rv_insertion_1
    angle_deg = np.degrees(np.arctan2(p1_y - cy, p1_x - cx))

    offset_deg = 75.0 if ring_type == "apical" else 60.0
    start_angle_deg = angle_deg - offset_deg

    anterior_angle = np.radians(start_angle_deg)

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
        "outer_circ_chord"      : ndarray, shape (17,) — summed outer-boundary chord length per segment (pixels)
        "mid_circ_chord"        : ndarray, shape (17,) — summed mid-wall chord length per segment (pixels)
        "inner_circ_chord"      : ndarray, shape (17,) — summed inner-boundary chord length per segment (pixels)
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
    ring_outer_chord_results: dict[str, np.ndarray] = {}
    ring_mid_chord_results: dict[str, np.ndarray] = {}
    ring_inner_chord_results: dict[str, np.ndarray] = {}
    lv_centroids: list[list[float]] = []
    final_alignment_angle: float | None = None  # first landmark-derived angle computed (same for all rings)

    for ring_type, n_sectors in ring_configs.items():
        ring_slices = [i for i, lbl in enumerate(labels) if lbl == ring_type]

        if not ring_slices:
            ring_results[ring_type] = np.full(n_sectors, np.nan)
            ring_inner_results[ring_type] = np.full(n_sectors, np.nan)
            ring_outer_chord_results[ring_type] = np.full(n_sectors, np.nan)
            ring_mid_chord_results[ring_type] = np.full(n_sectors, np.nan)
            ring_inner_chord_results[ring_type] = np.full(n_sectors, np.nan)
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
                        cx_ref, cy_ref, rv_insertion_1, rv_insertion_2, ring_type
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
        per_slice_outer_chord: list[np.ndarray] = []
        per_slice_mid_chord: list[np.ndarray] = []
        per_slice_inner_chord: list[np.ndarray] = []
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

            # Notebook-style (alignment_17seg_update.ipynb) circumferential
            # measure: sum consecutive-ray chord lengths at the outer, mid,
            # and inner myocardium boundaries separately, per AHA sector —
            # GCS then averages the three boundaries' strains (see
            # bullseye_route.py's _compute_strain_sync).
            inner_pts, outer_pts = ray_cast_boundary_points(sl, cx, cy, start_angle_rad=start_angle)
            mid_pts = (outer_pts + inner_pts) / 2.0
            per_slice_outer_chord.append(group_chord_sums(outer_pts, ring_type))
            per_slice_mid_chord.append(group_chord_sums(mid_pts, ring_type))
            per_slice_inner_chord.append(group_chord_sums(inner_pts, ring_type))

        if per_slice:
            ring_results[ring_type]       = np.nanmean(per_slice, axis=0)
            ring_inner_results[ring_type] = np.nanmean(per_slice_inner, axis=0)
        else:
            ring_results[ring_type]       = np.full(n_sectors, np.nan)
            ring_inner_results[ring_type] = np.full(n_sectors, np.nan)

        ring_outer_chord_results[ring_type] = (
            np.nanmean(per_slice_outer_chord, axis=0) if per_slice_outer_chord else np.full(n_sectors, np.nan)
        )
        ring_mid_chord_results[ring_type] = (
            np.nanmean(per_slice_mid_chord, axis=0) if per_slice_mid_chord else np.full(n_sectors, np.nan)
        )
        ring_inner_chord_results[ring_type] = (
            np.nanmean(per_slice_inner_chord, axis=0) if per_slice_inner_chord else np.full(n_sectors, np.nan)
        )

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

    def _flatten(ring_dict: dict[str, np.ndarray]) -> np.ndarray:
        return np.concatenate([ring_dict["basal"], ring_dict["mid"], ring_dict["apical"], ring_dict["apex"]])

    outer_circ_chord = _flatten(ring_outer_chord_results)
    mid_circ_chord   = _flatten(ring_mid_chord_results)
    inner_circ_chord = _flatten(ring_inner_chord_results)

    lv_centroid: list[float] | None = (
        [float(np.mean([c[0] for c in lv_centroids])),
         float(np.mean([c[1] for c in lv_centroids]))]
        if lv_centroids else None
    )
    return {
        "values": values,
        "circ_values": circ_values,
        # Notebook-style (alignment_17seg_update.ipynb) per-segment summed
        # chord length at each myocardium boundary — used for GCS as the
        # average of the three boundaries' independently-computed strains,
        # instead of a single mid-wall-radius circumference.
        "outer_circ_chord": outer_circ_chord,
        "mid_circ_chord": mid_circ_chord,
        "inner_circ_chord": inner_circ_chord,
        "lv_centroid": lv_centroid,
        "alignment_angle_deg": float(np.degrees(final_alignment_angle)) if final_alignment_angle is not None else None,
        "alignment_source": "landmark" if final_alignment_angle is not None else "fixed-angle",
    }


# ─────────────────────────────────────────────────────────────────────────────
# mask_to_rv_regions  (RV regional strain entry point)
# ─────────────────────────────────────────────────────────────────────────────

def mask_to_rv_regions(
    mask_3d: np.ndarray,
    rv_insertion_1: tuple[float, float] | None = None,
    rv_insertion_2: tuple[float, float] | None = None,
    layout: dict | None = None,
) -> dict:
    """
    Convert a 3-D segmentation mask to the 9-segment RV bullseye:
    3 rings (basal / mid / apical) x 3 sections (inferior → anterior).

    Pipeline:
        1. classify_rv_slices() → RV-containing slices split into even thirds
        2. per slice: LV centre → 360 rays → keep the rays that touch the RV
           → rv_arc_sections() splits that arc into 3 equal-ray-count sections
        3. rv_section_measures() per slice, averaged across the ring's slices

    `layout` fixes steps 1-2 to a reference frame: pass the "layout" returned
    by the ED call when processing ES (or any other frame) so each segment
    compares the same slices and the same ray wedges. Only the LV centre is
    recomputed per frame, as the LV pipeline does.

    Parameters
    ----------
    mask_3d : ndarray, shape (H, W, N_slices)
        Values: 0=background, 1=RV, 2=myocardium, 3=LV cavity.
    rv_insertion_1 : (x, y) anterior RV insertion point, or None — orients
        the sections (see rv_arc_sections).
    rv_insertion_2 : unused, kept for signature parity with mask_to_17_segments.
    layout : {"labels", "sections"} from a previous call, or None.

    Returns
    -------
    dict with keys:
        "chord"  / "area" / "radius" : ndarray, shape (9,) — per segment,
                                       pixels / pixels² / pixels (see rv_section_measures)
        "region_metadata"     : list[dict] — {idx, ring, sector, label}
        "lv_centroid"         : [cx, cy] float list, or None
        "alignment_angle_deg" : float | None — LV-style anterior start angle,
                                used by the frontend to rotate its charts
        "alignment_source"    : "landmark" | "fixed-angle"
        "layout"              : {"labels", "sections"} — pass back for ES
    """
    start_angle = 0.0
    centroids = lv_reference_centroids(mask_3d)

    if layout is None:
        labels = classify_rv_slices(mask_3d)
        slice_sections: dict[int, np.ndarray] = {}
        for sl_idx, lbl in enumerate(labels):
            if lbl == "none" or centroids[sl_idx] is None:
                continue
            cx, cy = centroids[sl_idx]
            _, outer = ray_cast_rv_hits(mask_3d[:, :, sl_idx], cx, cy, start_angle_rad=start_angle)
            slice_sections[sl_idx] = rv_arc_sections(
                ~np.isnan(outer[:, 0]), cx, cy, start_angle, rv_insertion_1
            )
        layout = {"labels": labels, "sections": slice_sections}

    labels = layout["labels"]
    n_seg = _RV_SECTIONS
    ring_out: dict[str, dict[str, np.ndarray]] = {}
    used_centroids: list[tuple[float, float]] = []

    for ring_type in _RV_RINGS:
        per_slice: dict[str, list[np.ndarray]] = {"chord": [], "area": [], "radius": []}
        for sl_idx, sections in layout["sections"].items():
            if labels[sl_idx] != ring_type or sl_idx >= mask_3d.shape[2] or centroids[sl_idx] is None:
                continue
            cx, cy = centroids[sl_idx]
            used_centroids.append((cx, cy))
            m = rv_section_measures(mask_3d[:, :, sl_idx], cx, cy, sections, start_angle)
            for key in per_slice:
                per_slice[key].append(m[key])
        ring_out[ring_type] = {
            key: (_nanmean_rows(vals) if vals else np.full(n_seg, np.nan))
            for key, vals in per_slice.items()
        }

    def _flatten(key: str) -> np.ndarray:
        return np.concatenate([ring_out[r][key] for r in _RV_RINGS])

    # Anterior start angle, computed exactly like the LV bullseye's basal ring
    # so the frontend can rotate RV and LV charts consistently.
    alignment_angle: float | None = None
    for sl_idx, lbl in enumerate(labels):
        if lbl != "none" and centroids[sl_idx] is not None:
            alignment_angle = compute_alignment_angle(
                *centroids[sl_idx], rv_insertion_1, rv_insertion_2, "basal"
            )
            break

    region_metadata = [
        {"idx": i + 1, "ring": ring, "sector": sector + 1,
         "label": f"{ring.capitalize()}_Seg{sector + 1}"}
        for i, (ring, sector) in enumerate(
            [(r, s) for r in _RV_RINGS for s in range(n_seg)]
        )
    ]

    lv_centroid: list[float] | None = (
        [float(np.mean([c[0] for c in used_centroids])),
         float(np.mean([c[1] for c in used_centroids]))]
        if used_centroids else None
    )

    return {
        "chord": _flatten("chord"),
        "area": _flatten("area"),
        "radius": _flatten("radius"),
        "region_metadata": region_metadata,
        "lv_centroid": lv_centroid,
        "alignment_angle_deg": float(np.degrees(alignment_angle)) if alignment_angle is not None else None,
        "alignment_source": "landmark" if alignment_angle is not None else "fixed-angle",
        "layout": layout,
    }


def _nanmean_rows(rows: list[np.ndarray]) -> np.ndarray:
    """Column-wise nanmean without the all-NaN-column RuntimeWarning."""
    arr = np.vstack(rows)
    counts = np.sum(~np.isnan(arr), axis=0)
    sums = np.nansum(arr, axis=0)
    return np.where(counts > 0, sums / np.maximum(counts, 1), np.nan)
