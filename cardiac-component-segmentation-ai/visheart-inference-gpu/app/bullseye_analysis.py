"""
bullseye_analysis.py
====================
Geometry for the LV and RV bullseyes, measured from a 3-D segmentation mask
of ONE cardiac frame.

This file only MEASURES (wall thickness, boundary lengths, areas — all in
pixels). The strain formulas and the pixel → mm conversion are in
routes/bullseye_route.py.

Mask class convention (matches UNETRESNET34 best_model.pth output):
    0 = background
    1 = RV cavity
    2 = myocardium (LV wall)
    3 = LV cavity

Coordinates and angles
----------------------
    x = column (grows to the right), y = row (grows DOWNWARD).
    An angle θ points along (cos θ, sin θ), so
        0° = right, 90° = down, 180° = left, 270° = up.
    LV rays are cast with INCREASING θ (clockwise on screen), exactly as in
    the client's alignment notebook: angles = start + linspace(0, 2π).
    The RV rays (ray_cast_rv_hits) sweep the other way, with decreasing θ.

How the file is organised
-------------------------
LV — AHA 17 segments (wall thickness, and the lengths used for GRS / GCS)
    classify_slices(mask_3d)                    -> list[str]  basal/mid/apical/apex/none
    compute_centroid(slice_mask, class_label=3) -> (cx, cy) | (None, None)
    ray_cast_thickness(...)                     -> wall thickness per ray
    ray_cast_boundary_points(...)               -> inner / outer wall point per ray
    ray_cast_inner_radius(...)                  -> inner-wall radius per ray (legacy)
    group_sectors / group_inner_radii           -> mean per AHA sector
    group_chord_sums(points, ring_type)         -> boundary length per AHA sector
    compute_alignment_angle(...)                -> ray start angle from the RV insertion landmark
    estimate_anterior_rv_insertion(mask_3d)     -> stand-in for that landmark when there is none
                                                   (estimated from the RV in the mask; LV and RV use it)
    mask_to_17_segments(mask_3d, ...)           -> dict   (LV ENTRY POINT)

RV — 9 segments (3 rings x 3 free-wall sections) + 1 septal segment per ring
    classify_rv_slices(mask_3d)                 -> list[str]  basal/mid/apical/none
    lv_reference_centroids(mask_3d)             -> LV centre per slice (where the rays start)
    ray_cast_rv_hits(...)                       -> (septal-side pts, free-wall pts) per ray
    rv_arc_sections(hit, cx, cy, ...)           -> section id per ray, or -1
    rv_section_measures(...)                    -> chord / area / radius / septal chord
    mask_to_rv_regions(mask_3d, ..., layout)    -> dict   (RV ENTRY POINT)

LV segments use the STANDARD AHA 17-segment numbering (2–3 and 8–9 septal,
5–6 and 11–12 lateral, 14 apical septal, 16 apical lateral) — see the notes
above AHA_SEGMENTS. Do not redefine them elsewhere.
"""

from __future__ import annotations
import numpy as np
import cv2

# ── AHA 17-Segment Definitions ───────────────────────────────────────────────
# Segment NUMBERS and NAMES are the standard AHA 17-segment model:
#     basal  : 1 Anterior, 2 Anteroseptal, 3 Inferoseptal,
#              4 Inferior, 5 Inferolateral, 6 Anterolateral    (mid: 7–12, same order)
#     apical : 13 Anterior, 14 Septal, 15 Inferior, 16 Lateral
#     apex   : 17
# Segments 2–3, 8–9 and 14 are the septum (the wall facing the RV).
#
# This is the order the LV pipeline produces its values in: segment 1 is the
# 60° that END at the anterior RV insertion point, and the numbers then
# continue across the septum (2, 3) — the client's alignment notebook.
#
# Angles (t1/t2) are copied from UNETRESNET34/bullseye_17seg.ipynb: degrees,
# counterclockwise, 90° = Anterior (top / 12 o'clock), 270° = Inferior
# (bottom). With the names above this is the standard AHA chart: the septal
# segments on the LEFT and the lateral segments on the RIGHT — the layout the
# frontend bullseye chart draws.
#
# NOTE: t1/t2 use this CHART convention, which is not the image-angle
# convention the ray casting below uses (see the module docstring). The
# calculations in this file only use idx / name / ring. t1/t2 are read by
# dependencies/aha_segmentation_3d.py (labelling of the 3-D heart) relative
# to that module's own reference direction; that 3-D labelling was not
# changed or re-checked when the 2-D numbering was standardised. RING_RADII
# (relative ring radii of the chart) is not used by any calculation here.

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
    {"idx": 14, "name": "Apical Septal",       "ring": 2, "t1": 135, "t2": 225},
    {"idx": 15, "name": "Apical Inferior",     "ring": 2, "t1": 225, "t2": 315},
    {"idx": 16, "name": "Apical Lateral",      "ring": 2, "t1": -45, "t2":  45},
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

    Slices with fewer than `min_myo_pixels` myocardium (class 2) pixels are
    labelled "none". The remaining (valid) slices are taken in index order,
    assumed to run base → apex:
        last 1 slice (2 when there are 15+ valid slices)  → "apex"
        the rest, split into three roughly equal groups   → "basal", "mid", "apical"
    With fewer than 4 valid slices the later rings are left empty.

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
    centroid-shift artefacts in per-sector GRS computation.

    Other classes can be passed: lv_reference_centroids() falls back to the
    myocardium (class 2) when a slice has no LV cavity. The RV pipeline does
    NOT use the RV's own centroid — its rays also start from the LV centre.

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

    Rays are cast clockwise on screen (increasing angle) starting at
    `start_angle_rad`, matching alignment_17seg_update.ipynb:
        angles = start_angle_rad + linspace(0, 2π, n_rays)

    Along each ray, the first two places where the pixel changes between
    "myocardium" and "not myocardium" are the inner and outer wall edges;
    the thickness is the distance between them.

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

    angles     = start_angle_rad + np.linspace(0.0, 2.0 * np.pi, n_rays, endpoint=False)
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

    angles     = start_angle_rad + np.linspace(0.0, 2.0 * np.pi, n_rays, endpoint=False)
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
    next ray in casting order, wrapping around), then SUM (not average) those
    per-sector — a chord-length approximation of that boundary's circumference.

    Same sector ordering as group_sectors (plain consecutive blocks, first
    block = segment 1 / 7 / 13), since `points` comes from the same ray sampling.

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

    return result


# ─────────────────────────────────────────────────────────────────────────────
# ray_cast_inner_radius  (inner-wall radius per ray — feeds the legacy `circ_values`)
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
    boundary was not found.

    Feeds `circ_values` in mask_to_17_segments (2π × inner radius). NOTE: the
    strain route no longer uses that value — LV GCS is computed from the
    chord sums instead (ray_cast_boundary_points + group_chord_sums).
    """
    H, W = slice_mask.shape
    max_r = max(H, W)

    myo = (slice_mask == _MYO_CLASS).astype(np.uint8)

    angles     = start_angle_rad + np.linspace(0.0, 2.0 * np.pi, n_rays, endpoint=False)
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

    The rays arrive in casting order (clockwise on screen from the start
    angle), so each sector is simply the next equal-sized block of rays —
    exactly alignment_17seg_update.ipynb
    (distances.reshape(-1, rays_per_sector).mean). No re-ordering:

        basal/mid : block k = segment k+1; segment 1 covers
                    [start, start + 60°], segment 2 the next 60°, and so on.
        apical    : segment 13 covers [start, start + 90°], then 14, 15, 16.
        apex      : one value, the mean of all rays.

    Normally start = (angle of the anterior RV insertion) − 60° (−75° apical),
    so segment 1 ENDS at the insertion point and segments 2–3 cover the septum
    (see compute_alignment_angle). The insertion point is the landmark or,
    when there is none, the point estimated from the RV in the mask.

    Only when the mask has no RV at all are the fixed start angles used (240°
    basal/mid, 225° apical — see mask_to_17_segments). Then segment 1 / 7 / 13
    is centred at the TOP of the image and the numbering continues clockwise
    on screen:
        basal/mid : 1 top, 2 upper-right, 3 lower-right, 4 bottom,
                    5 lower-left, 6 upper-left   (mid: 7–12, same positions)
        apical    : 13 top, 14 right, 15 bottom, 16 left
    (For what each number is called, see the notes above AHA_SEGMENTS.)

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

    # The blocks are already in AHA order (first block = segment 1 / 7 / 13).
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
# cavity area inside the section's wedge (GAS-style). The septal-side
# boundary is measured too, as one separate length per slice (septal GCS) —
# it is never added to the free-wall length.

_RV_RINGS: tuple[str, ...] = ("basal", "mid", "apical")
_RV_SECTIONS = 3
_MIN_RV_PIXELS = 30
_RV_RAY_STEP_PX = 0.25        # sub-pixel sampling along each RV ray
_RV_SMOOTH_HALF_WINDOW = 3    # boundary-radius smoothing over ±3 rays (±3°)
# GCS chord-sum robustness (see _robust_arc_length):
_RV_ARC_TRIM_FRAC = 0.05      # leave this fraction of the arc's rays out at EACH end ...
_RV_ARC_TRIM_MIN_RAYS = 5     # ... but at least this many rays per end
_RV_LONG_CHORD_FACTOR = 3.0   # chord > factor × section median chord = bridging chord
_RV_MIN_VALID_CHORD_FRAC = 0.5  # fewer valid chords than this → length unreliable (NaN)


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

    Same angle convention as the LV ray casters, but the ray index grows
    COUNTER-clockwise on screen (decreasing angle) — the opposite sweep
    direction to ray_cast_thickness. Per ray, the first contiguous run of RV
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
    rs = np.arange(_RV_RAY_STEP_PX, max_r, _RV_RAY_STEP_PX)
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

    # With 1°-spaced rays, neighbouring boundary points are only ~0.5-1 px
    # apart, while the mask's own edge is a 1-px staircase. Taken raw, each
    # point jumps in/out by up to a pixel and the chord sum measures that
    # jagged edge — inflating the lengths and biasing strain toward 0.
    # So: sample the ray at sub-pixel steps, then smooth each boundary's
    # radius over neighbouring rays (±_RV_SMOOTH_HALF_WINDOW) before placing
    # the points on their ray. Which rays hit the RV is unchanged.
    r_in = np.full(n_rays, np.nan)
    r_out = np.full(n_rays, np.nan)
    rows = np.flatnonzero(any_hit)
    r_in[rows] = rs[first[rows]]
    r_out[rows] = rs[last[rows]]
    r_in, r_out = _smooth_circular(r_in), _smooth_circular(r_out)

    cos_a, sin_a = np.cos(angles), np.sin(angles)
    inner_pts[rows] = np.stack([cx + r_in * cos_a, cy + r_in * sin_a], axis=1)[rows]
    outer_pts[rows] = np.stack([cx + r_out * cos_a, cy + r_out * sin_a], axis=1)[rows]
    return inner_pts, outer_pts


def _smooth_circular(values: np.ndarray, half_window: int = None) -> np.ndarray:
    """NaN-aware circular moving average over ±half_window neighbours.
    NaN entries stay NaN and never contribute to their neighbours."""
    if half_window is None:
        half_window = _RV_SMOOTH_HALF_WINDOW
    valid = ~np.isnan(values)
    filled = np.where(valid, values, 0.0)
    total = np.zeros_like(filled)
    count = np.zeros_like(filled)
    for k in range(-half_window, half_window + 1):
        total += np.roll(filled, k)
        count += np.roll(valid, k)
    out = np.where(count > 0, total / np.maximum(count, 1), np.nan)
    out[~valid] = np.nan
    return out


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
    anterior RV insertion point, or mask_to_rv_regions' estimate of it when
    there is no landmark). With no point at all, the anterior end is taken to
    be the LOWER-angle end of the arc — the same side the LV landmark rule
    expects the anterior insertion on (the RV is on its increasing-angle side).
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
            d = (start_angle_rad - ray_i * step - ant) % (2.0 * np.pi)
            return min(d, 2.0 * np.pi - d)

        start_is_anterior = _dist(int(arc[0])) <= _dist(int(arc[-1]))

    sections[arc] = (n_sections - 1 - order) if start_is_anterior else order
    return sections


def _arc_end_trim(sections: np.ndarray) -> np.ndarray:
    """
    Boolean mask of the rays to EXCLUDE from GCS chord sums: the first/last
    few rays of the RV arc. Near the insertion points the rays from the LV
    centre run almost along the wall, so the boundary position there is
    ill-conditioned, and the tips slide between frames — with the ray layout
    fixed at ED, tip rays often miss the RV at ES, which would read as fake
    shortening. The trim is decided on the (ED-fixed) layout, so the same
    rays are excluded in every frame.
    """
    n = len(sections)
    in_arc = sections >= 0
    arc_len = int(in_arc.sum())
    trim = np.zeros(n, dtype=bool)
    if arc_len == 0 or arc_len == n:
        return trim
    k = max(_RV_ARC_TRIM_MIN_RAYS, int(round(_RV_ARC_TRIM_FRAC * arc_len)))
    if 2 * k >= arc_len:
        return trim
    start = int(np.flatnonzero(in_arc & ~np.roll(in_arc, 1))[0])  # arc is one contiguous block
    pos = (np.arange(n) - start) % n
    trim[in_arc & ((pos < k) | (pos >= arc_len - k))] = True
    return trim


def _robust_arc_length(points: np.ndarray, eligible: np.ndarray) -> float:
    """
    Open-arc chord-sum length over consecutive `eligible` rays.

    Chords next to a ray that missed the boundary (NaN), and "bridging"
    chords longer than _RV_LONG_CHORD_FACTOR × the median chord, are not
    dropped (that would read as shortening) but replaced by the median
    chord — so every chord position counts in every frame. NaN if fewer than
    _RV_MIN_VALID_CHORD_FRAC of the positions have a valid chord.
    """
    pos = eligible & np.roll(eligible, -1)
    n_pos = int(pos.sum())
    if n_pos == 0:
        return np.nan
    chords = np.linalg.norm(np.roll(points, -1, axis=0) - points, axis=1)[pos]
    valid = chords[~np.isnan(chords)]
    if valid.size < max(2, _RV_MIN_VALID_CHORD_FRAC * n_pos):
        return np.nan
    good = valid[valid <= _RV_LONG_CHORD_FACTOR * np.median(valid)]
    if good.size == 0:
        return np.nan
    return float(good.sum() + (n_pos - good.size) * np.median(good))


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

    chord  : free-wall (outer) boundary length per section (px) — open-arc
             chord sum over consecutive rays of the section (GCS-style, same
             idea as group_chord_sums), excluding the arc-end rays
             (_arc_end_trim) and robust to dropouts / bridging chords
             (_robust_arc_length).
    area   : RV cavity pixels whose angle from (cx, cy) falls in the
             section's rays (px²) — GAS-style, full wedge (no trim).
    radius : mean LV-centre → free-wall distance (px).
    septal_chord : SEPTAL-side (inner, RV entry point) boundary length over
             the whole RV arc (px), same trimming/robustness — one value per
             slice, kept separate from the free wall (Tokodi et al. 2021
             report RV septal and free-wall segments separately).
    """
    n = len(sections)
    inner, outer = ray_cast_rv_hits(slice_mask, cx, cy, n_rays=n, start_angle_rad=start_angle_rad)
    usable = (sections >= 0) & ~_arc_end_trim(sections)

    septal_chord = _robust_arc_length(inner, usable)
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
        chord[s] = _robust_arc_length(outer, usable & in_s)
        area[s] = float(np.sum(px_section == s))
        if not np.all(np.isnan(radii[in_s])):
            radius[s] = float(np.nanmean(radii[in_s]))
    return {"chord": chord, "area": area, "radius": radius, "septal_chord": np.array([septal_chord])}


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
    LEGACY — NOT CALLED ANYWHERE. Superseded by compute_alignment_angle()
    (single-point formula). Kept only for reference.

    Old midpoint-based formula, from when it was not known which of the two
    RV insertion points was anterior and which inferior: take the direction
    from the LV centre to the midpoint of the two insertion points (treated
    as the septal direction) and add 240° (4π/3) to get the ray start angle.

    Returns the start angle in radians, or None if either landmark is missing.
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
    Compute the ray start angle of the LV bullseye from RV insertion point 1
    alone.

    The landmark model was trained with a
    fixed anatomical identity: rv_insertion_1 = anterior RV insertion point,
    rv_insertion_2 = inferior. This replaces the earlier midpoint-based
    approach (compute_alignment_angle_midpoint_LEGACY), which was needed only
    while neither point had a confirmed identity.

    start_angle = angle(LV centre → rv_insertion_1) - 60°, except the apical
    ring, which uses -75° per Notes.pdf. Angles use the image convention
    (y grows downward — see the module docstring).

    Because the rays then sweep with increasing angle, segment 1 (anterior)
    is the 60° wedge that ends at rv_insertion_1, and segments 2 and 3 (the
    septum) follow it, towards the RV. Apical: segment 13 is the 90° wedge
    from 75° before the point to 15° after it. For this to be right,
    rv_insertion_1 must be the insertion point that has the RV on its
    increasing-angle (clockwise-on-screen) side. In the short-axis images
    this system produces, where the RV sits above the LV, that is the
    LEFT-hand point.

    rv_insertion_2 is accepted but not used.

    Returns the start angle in radians (the variable is named
    `anterior_angle`), or None if rv_insertion_1 is not provided. The callers
    pass an estimated point when there is no landmark
    (estimate_anterior_rv_insertion), so None only happens when the mask has
    no RV; they then fall back to their fixed start angles.
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
# estimate_anterior_rv_insertion  (used when there is NO landmark)
# ─────────────────────────────────────────────────────────────────────────────

# Share of each slice's RV pixels (those with the lowest angle seen from the LV
# centre) taken as the RV's anterior tip.
_RV_EDGE_PERCENTILE = 2.0


def estimate_anterior_rv_insertion(
    mask_3d: np.ndarray,
    min_rv_pixels: int | None = None,
) -> tuple[float, float] | None:
    """
    Estimate the anterior RV insertion point from the mask alone, for projects
    that have no landmark. It stands in for rv_insertion_1 and is used exactly
    like it (see compute_alignment_angle).

    Per slice that has both an LV cavity and an RV:
        1. Look at the RV pixels from the LV centre and measure each pixel's
           angle relative to the direction of the RV centre.
        2. Take the pixels with the LOWEST angle (the leading 2 %): that is the
           end of the RV from which increasing angle sweeps into the RV — the
           same side the landmark rule expects rv_insertion_1 on.
        3. Their mean (x, y) is that slice's estimate.
    The estimates are averaged over the slices into one point, the same way
    the server averages the landmark over the ED slices.

    On the three projects it was checked on, the direction of this point was
    within 5° of the direction of the real (correctly placed) landmark.

    Returns (x, y), or None if no slice has both an LV cavity and an RV.
    """
    if min_rv_pixels is None:
        min_rv_pixels = _MIN_RV_PIXELS

    points: list[tuple[float, float]] = []
    for sl_idx in range(mask_3d.shape[2]):
        sl = mask_3d[:, :, sl_idx]
        cx, cy = compute_centroid(sl)  # LV cavity
        if cx is None:
            continue
        ys, xs = np.nonzero(sl == _RV_CLASS)
        if xs.size < min_rv_pixels:
            continue
        rv_dir = np.arctan2(ys.mean() - cy, xs.mean() - cx)
        rel = (np.arctan2(ys - cy, xs - cx) - rv_dir + np.pi) % (2.0 * np.pi) - np.pi
        edge = rel <= np.percentile(rel, _RV_EDGE_PERCENTILE)
        points.append((float(xs[edge].mean()), float(ys[edge].mean())))

    if not points:
        return None
    return (
        float(np.mean([p[0] for p in points])),
        float(np.mean([p[1] for p in points])),
    )


# ─────────────────────────────────────────────────────────────────────────────
# mask_to_17_segments  (main entry point)
# ─────────────────────────────────────────────────────────────────────────────

def mask_to_17_segments(
    mask_3d: np.ndarray,
    rv_insertion_1: tuple[float, float] | None = None,
    rv_insertion_2: tuple[float, float] | None = None,
) -> dict:
    """
    Convert a 3-D segmentation mask (one cardiac frame) to 17 AHA segment
    values. LV ENTRY POINT — used for wall thickness and for LV strain.

    Pipeline:
        1. classify_slices()  → label each slice basal/mid/apical/apex/none
        2. Pick the ray start angle of each ring (compute_alignment_angle),
           from, in order of preference:
               a. the RV insertion landmark, if given;
               b. a point estimated from the RV in the mask
                  (estimate_anterior_rv_insertion);
               c. fixed angles (240° basal/mid, 225° apical) — only when the
                  mask has no RV to estimate from.
        3. For every slice of the ring, from its LV-cavity centroid
           (compute_centroid):
               ray_cast_thickness()       → group_sectors()      wall thickness
               ray_cast_boundary_points() → group_chord_sums()   outer / mid / inner boundary length
               ray_cast_inner_radius()    → group_inner_radii()  inner radius (legacy)
        4. Average each sector across all slices of the same ring type
        5. Concatenate into (17,) arrays ordered by AHA index:
               segments 1–6   (basal)
               segments 7–12  (mid)
               segments 13–16 (apical)
               segment  17    (apex)

    Parameters
    ----------
    mask_3d : ndarray, shape (H, W, N_slices)
        Values: 0=background, 1=RV, 2=myocardium, 3=LV cavity.
    rv_insertion_1 : (x, y) of the ANTERIOR RV insertion point in pixel
        coords, or None. When None, the point is estimated from the RV in
        this mask. To compare two frames (strain), pass the SAME point to
        both calls so they use the same wedges — the strain route estimates
        it once, from the ED mask.
    rv_insertion_2 : (x, y) of the inferior RV insertion point, or None.
        Accepted but not used.

    Returns
    -------
    dict with keys (all lengths in PIXELS — the route converts to mm):
        "values"               : ndarray, shape (17,) — mean wall thickness per AHA segment;
                                 used for the wall-thickness bullseye and for GRS
        "circ_values"          : ndarray, shape (17,) — 2π × mean inner radius per segment;
                                 LEGACY, no longer used for GCS
        "outer_circ_chord"      : ndarray, shape (17,) — summed outer-boundary chord length per segment
        "mid_circ_chord"        : ndarray, shape (17,) — summed mid-wall chord length per segment
        "inner_circ_chord"      : ndarray, shape (17,) — summed inner-boundary chord length per segment
                                 (the three chord arrays are what GCS uses)
        "lv_centroid"          : [cx, cy] — mean LV centre over the basal and mid slices, or None
        "alignment_angle_deg"  : float | None — start angle (degrees) of the first ring that
                                 has slices (normally basal); None when the fixed angles
                                 were used
        "alignment_source"     : "landmark"    — rv_insertion_1 was given
                                 "rv-mask"     — no landmark; point estimated from the RV
                                 "fixed-angle" — no landmark and no RV in the mask
        "alignment_point"      : [x, y] | None — the point the start angle was measured from
    """
    labels = classify_slices(mask_3d)

    # No landmark → estimate the anterior RV insertion point from the mask.
    alignment_source = "landmark"
    if rv_insertion_1 is None:
        rv_insertion_1 = estimate_anterior_rv_insertion(mask_3d)
        alignment_source = "rv-mask" if rv_insertion_1 is not None else "fixed-angle"

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
    final_alignment_angle: float | None = None  # first landmark-derived start angle found (normally the basal ring's); returned for information only (the frontend does not rotate its charts by it)

    for ring_type, n_sectors in ring_configs.items():
        ring_slices = [i for i, lbl in enumerate(labels) if lbl == ring_type]

        if not ring_slices:
            ring_results[ring_type] = np.full(n_sectors, np.nan)
            ring_inner_results[ring_type] = np.full(n_sectors, np.nan)
            ring_outer_chord_results[ring_type] = np.full(n_sectors, np.nan)
            ring_mid_chord_results[ring_type] = np.full(n_sectors, np.nan)
            ring_inner_chord_results[ring_type] = np.full(n_sectors, np.nan)
            continue

        # Determine start angle: from the landmark (or the point estimated from
        # the RV above); only if neither exists, fall back to the fixed angles.
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
                "basal":  4 * np.pi / 3,   # 240° — segment 1 = 240–300° (top of the image), then 300, 0, 60, 120, 180
                "mid":    4 * np.pi / 3,   # 240°
                "apical": 5 * np.pi / 4,   # 225° — segment 13 = 225–315° (top of the image), then 315, 45, 135
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
    # circ_values: LV inner circumference per AHA segment = 2π × mean_inner_radius.
    # LEGACY: still returned, but the strain route no longer uses it — GCS is
    # computed from the three chord-sum arrays below.
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
        "alignment_source": alignment_source if final_alignment_angle is not None else "fixed-angle",
        "alignment_point": (
            [float(rv_insertion_1[0]), float(rv_insertion_1[1])]
            if rv_insertion_1 is not None and final_alignment_angle is not None else None
        ),
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
    3 rings (basal / mid / apical) x 3 free-wall sections (inferior → anterior),
    plus one RV septal segment per ring (septal-side border, measured
    separately from the free wall).

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
        the sections (see rv_arc_sections). When None it is estimated from
        the RV in this mask (estimate_anterior_rv_insertion).
    rv_insertion_2 : not used in any calculation; kept for signature parity
        with mask_to_17_segments.
    layout : {"labels", "sections"} from a previous call, or None.

    Returns
    -------
    dict with keys:
        "chord"  / "area" / "radius" : ndarray, shape (9,) — per free-wall segment,
                                       pixels / pixels² / pixels (see rv_section_measures)
        "septal_chord"        : ndarray, shape (3,) — RV septal-side chord length
                                per ring [basal, mid, apical] (pixels); one septal
                                segment per ring, separate from the free wall
        "region_metadata"     : list[dict] — {idx, ring, sector, label}
        "septal_metadata"     : list[dict] — {idx, ring, label}
        "lv_centroid"         : [cx, cy] float list, or None
        "alignment_angle_deg" : float | None — LV-style start angle (same formula
                                as the LV basal ring). FOR INFORMATION ONLY: it does
                                not affect the RV section split or any RV value,
                                and the frontend does not rotate its charts by it
        "alignment_source"    : "landmark" | "rv-mask" (point estimated from the
                                RV, no landmark) | "fixed-angle"
        "layout"              : {"labels", "sections"} — pass back for ES
    """
    start_angle = 0.0
    centroids = lv_reference_centroids(mask_3d)

    # No landmark → estimate the anterior RV insertion point from the mask (the
    # same estimate the LV pipeline uses), so the sections are still ordered
    # inferior → anterior instead of relying on a fixed guess.
    alignment_source = "landmark"
    if rv_insertion_1 is None:
        rv_insertion_1 = estimate_anterior_rv_insertion(mask_3d)
        alignment_source = "rv-mask" if rv_insertion_1 is not None else "fixed-angle"

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
        per_slice: dict[str, list[np.ndarray]] = {"chord": [], "area": [], "radius": [], "septal_chord": []}
        for sl_idx, sections in layout["sections"].items():
            if labels[sl_idx] != ring_type or sl_idx >= mask_3d.shape[2] or centroids[sl_idx] is None:
                continue
            cx, cy = centroids[sl_idx]
            used_centroids.append((cx, cy))
            m = rv_section_measures(mask_3d[:, :, sl_idx], cx, cy, sections, start_angle)
            for key in per_slice:
                per_slice[key].append(m[key])
        ring_out[ring_type] = {
            key: (_nanmean_rows(vals) if vals else np.full(1 if key == "septal_chord" else n_seg, np.nan))
            for key, vals in per_slice.items()
        }

    def _flatten(key: str) -> np.ndarray:
        return np.concatenate([ring_out[r][key] for r in _RV_RINGS])

    # Start angle, computed with the same formula as the LV bullseye's basal
    # ring. Returned for information only — the RV sections above do not
    # depend on it, and the frontend does not rotate its charts by it.
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

    septal_metadata = [
        {"idx": i + 1, "ring": ring, "label": f"{ring.capitalize()}_Septal"}
        for i, ring in enumerate(_RV_RINGS)
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
        "septal_chord": _flatten("septal_chord"),
        "region_metadata": region_metadata,
        "septal_metadata": septal_metadata,
        "lv_centroid": lv_centroid,
        "alignment_angle_deg": float(np.degrees(alignment_angle)) if alignment_angle is not None else None,
        "alignment_source": alignment_source if alignment_angle is not None else "fixed-angle",
        "layout": layout,
    }


def _nanmean_rows(rows: list[np.ndarray]) -> np.ndarray:
    """Column-wise nanmean without the all-NaN-column RuntimeWarning."""
    arr = np.vstack(rows)
    counts = np.sum(~np.isnan(arr), axis=0)
    sums = np.nansum(arr, axis=0)
    return np.where(counts > 0, sums / np.maximum(counts, 1), np.nan)
