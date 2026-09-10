"""
CPD-based RV 9-segment classification -- the RV analogue of cpd_aha_segmentation.py.

Warps a real (Zenodo-sourced) RV atlas onto each patient's own reconstructed RV mesh
with CPD (pycpd.DeformableRegistration / cpd_gpu's CUDA port), and transfers the
atlas's own segment labels via nearest neighbor after warping. Same method as LV's
cpd_aha_segmentation.py, and this module deliberately mirrors its structure (same
function names/shapes: register_cpd_warp / label_with_warp / a one-shot convenience
wrapper) so a caller that already knows the LV module can read this one directly.

Ported and adapted from Sharlene's rv-deformation repo (github.com/sharlenelim21/
rv-deformation, src/rv_deform.py + scripts/build_rv_atlas.py), which built and
cohort-validated (20 held-out ACDC patients, 82-88% correspondence depending on CPD
alpha) this exact atlas-CPD-labeling approach for RV. Two deliberate departures from
that repo, both to fit this pipeline rather than the notebook it was validated in:

  1. Per-VERTEX labeling (nearest-neighbor against the warped atlas point cloud),
     not that repo's per-FACE labeling (assign_face_labels/transfer_labels_to_
     patient, which needs face adjacency for majority-vote smoothing). This
     pipeline's contract (aha_vertex_labels: one int per mesh vertex, consumed by
     deep_sdf/mesh.py and the frontend identically for LV and RV) is per-vertex, so
     matching it exactly means every downstream consumer needs zero RV-specific
     branching.
  2. An added long-axis (PCA) pre-alignment stage before a Z-rotation search
     (residual azimuthal correction, ported from LV's cpd_aha_segmentation.py).
     rv_deform.py's own align_long_axis() only fixes the apicobasal axis
     DIRECTION (2 of 3 rotational degrees of freedom) and leaves residual
     rotation AROUND that axis uncorrected, as an accepted limitation of its
     own ACDC-validated pipeline. 2026-09-10: this module briefly dropped the
     Z-rotation search entirely, to match rv_deform.py's code exactly -- that
     was reverted the same day after it broke real reconstructions (CPD left
     to absorb the FULL residual azimuthal offset via pure local deformation,
     which on this pipeline's DeepSDF-reconstructed meshes produced a folded/
     fragmented result missing an entire segment every frame, not just a
     differently-rotated-but-otherwise-clean one). rv_deform.py's own
     align_long_axis() docstring names exactly this failure mode for
     large axis misalignment ("CPD ... has no mechanism for large-scale
     reorientation ... produces a visibly twisted/folded result rather than
     an error") -- it turns out this pipeline's mesh source hits the same
     failure mode azimuthally, at a scale the notebook's ACDC-derived
     validation set apparently never did. The Z-rotation search stays.

HONEST LIMITATIONS (inherited from rv-deformation's README, unless noted):
  - The Zenodo atlas's 9-segment scheme (Bazhutina et al., CinC 2023) is "a
    reasonable proposal, not an established convention" -- that paper validated
    only its LV segments.
  - Blood-pool (endocardial) surface only; no RV wall thickness (needs an
    epicardial surface this pipeline's masks don't carry).
  - Correspondence accuracy measured on rv-deformation's own ACDC-mask-derived
    patient meshes was 82-88%, NOT verified against this specific pipeline's
    DeepSDF-decoded RV meshes -- a different mesh source (different resolution,
    smoothness, and potential systematic bias from marching-cubes-over-a-learned-
    SDF vs marching-cubes-over-a-labeled-mask). Treat labels from this module as
    unvalidated for this mesh source until checked against a real reconstruction.
  - No fixed-rule fallback classifier exists for RV (unlike LV's
    aha_segmentation_3d.classify_vertices_to_aha17) -- on any failure this module
    returns None, same as returning "not computed" upstream, rather than guessing.
"""
from __future__ import annotations

import glob
import logging
import os

import numpy as np
import trimesh
from pycpd import DeformableRegistration
from scipy.sparse import coo_matrix
from scipy.spatial import cKDTree

import cpd_gpu

logger = logging.getLogger("visheart")

_ATLAS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "atlas_rv")
_ATLAS_ZONES = ["Apical", "Basal", "Mid"]
# Matches rv_deform.py's own convention (align_atlas(..., reference_region=sorted(atlas_raw)[0]))
# -- the alphabetically-first file across all zones, which happens to be an apical
# segment, consistent with LV's own "rotate the apex-adjacent region to -Z" convention.
_ANCHOR_ZONE = "Apical"
_ANCHOR_FILE = "Apical_Seg1.obj"

# beta=1.5 inherited from the LV script via rv_deform.py. lamb(alpha)=30.0 is
# rv_deform.py's cohort-retuned value (scripts/tune_alpha_cohort.py, 20 held-out
# patients: 88.2% mean correspondence at alpha=30 vs 84.0% at pycpd's hardcoded
# default of 2) -- NOT LV's own _CPD_LAMBDA=10.0, which was never actually applied
# on the LV side either (see rv_deform.py's fit_cpd() docstring for the lamb/alpha
# kwarg bug this project found) and in any case was tuned for a different atlas.
_CPD_BETA = 1.5
_CPD_LAMBDA = 30.0
_CPD_MAX_ITER = 30
_MAX_TARGET_POINTS = 3000
_MAX_REGISTRATION_POINTS = 2000
_DENSE_FIELD_CHUNK = 4000
# 72 candidates (5-degree steps), matching LV's cpd_aha_segmentation.py. Necessary,
# not cosmetic -- see module docstring point 2: without this search, CPD is left to
# absorb the full residual azimuthal offset via local deformation alone, which folds/
# erases a segment rather than just landing at a different (but clean) rotation.
_Z_ROTATION_CANDIDATES = 72


def _rotation_matrix_from_vectors(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Rotation matrix that maps unit vector a onto unit vector b. Ported from
    rv_deform.py / v5_deform.ipynb."""
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    cross = np.cross(a, b)
    dot = np.dot(a, b)

    if np.isclose(dot, 1):
        return np.eye(3)
    if np.isclose(dot, -1):
        axis = np.array([1.0, 0.0, 0.0])
        if np.allclose(a, axis):
            axis = np.array([0.0, 1.0, 0.0])
        v = axis - axis.dot(a) * a
        v /= np.linalg.norm(v)
        return -np.eye(3) + 2 * np.outer(v, v)

    skew = np.array([
        [0, -cross[2], cross[1]],
        [cross[2], 0, -cross[0]],
        [-cross[1], cross[0], 0],
    ])
    return np.eye(3) + skew + skew @ skew * ((1 - dot) / (np.linalg.norm(cross) ** 2))


def _principal_long_axis(points: np.ndarray) -> np.ndarray:
    """
    Data-driven apicobasal axis: PCA's direction of greatest point-position
    variance. Ported from rv_deform.py's principal_long_axis(), generalised to
    take a raw point array instead of a trimesh.Trimesh (this module only ever
    has point clouds at the point this is needed, not always a full mesh with
    faces).

    Unlike rv_deform.py's version, this does NOT decide which end is the apex by
    taper -- that heuristic was measured there to make alignment WORSE on the
    (free-wall-only) atlas it was tried on, not better. The sign is instead
    resolved by whichever candidate minimises Chamfer distance against the atlas
    -- see register_cpd_warp()'s "Stage 1" below, matching rv_deform.py's
    align_long_axis() but doing the empirical sign check where it's used, on
    a plain vector, so the caller can pick either candidate cheaply.
    """
    v = points - points.mean(axis=0)
    cov = v.T @ v
    eigval, eigvec = np.linalg.eigh(cov)
    return eigvec[:, np.argmax(eigval)]


def _chamfer_distance(points_a: np.ndarray, points_b: np.ndarray) -> float:
    """Symmetric Chamfer distance (squared L2, mean-reduced each direction,
    summed). Ported from rv_deform.py's chamfer_distance()."""
    tree_a, tree_b = cKDTree(points_a), cKDTree(points_b)
    d_ab = tree_b.query(points_a)[0]
    d_ba = tree_a.query(points_b)[0]
    return float((d_ab ** 2).mean() + (d_ba ** 2).mean())


# Real physical distance (mm) used to call a point "near the septum" -- the
# same threshold rv-deformation/README.md documents tuning for its own
# free-wall extraction ("at the 15 mm default the septum comes out at ~31%
# of RV surface"). Points feeding this check are centred-but-unscaled real-
# world mm coordinates (see register_cpd_warp), so this is directly
# comparable, not a normalised/unitless value.
_SEPTAL_DISTANCE_THRESHOLD_MM = 15.0

# Minimum mean-resultant-length (circular concentration, see
# _septal_direction_deg) required to trust its output. 0.5 rejects clearly
# bimodal/scattered near-LV point sets (e.g. two roughly-equal opposed
# clusters, R landing near 0) while still accepting a real septal cluster
# with a normal amount of spread (a tight single cluster is close to 1.0).
_SEPTAL_DIRECTION_MIN_CONCENTRATION = 0.5


def _angular_gap_center_deg(points_xy_z: np.ndarray) -> float:
    """
    Given points already in a Z-is-long-axis frame, finds the centre (in
    degrees, atan2 convention) of the largest empty angular arc in their
    azimuthal (XY-plane) distribution -- i.e. the middle of the biggest gap
    when every point's angle is plotted on a circle.

    Used on the ATLAS's own dense_points (free-wall-only, ~180 degrees per
    level -- see rv-deformation/README.md's "cinc9" section) to find where,
    in the atlas's OWN canonical (angle-zero) pose, the excluded septal
    region sits. That's the reference this module rotates to match against
    a patient-specific septal direction (see _septal_direction_deg) instead
    of guessing purely from segment-population counts.
    """
    angles_deg = np.degrees(np.arctan2(points_xy_z[:, 1], points_xy_z[:, 0])) % 360.0
    sorted_angles = np.sort(angles_deg)
    wrapped = np.concatenate([sorted_angles, sorted_angles[:1] + 360.0])
    gaps = np.diff(wrapped)
    widest = np.argmax(gaps)
    return float((sorted_angles[widest] + gaps[widest] / 2.0) % 360.0)


def _septal_direction_deg(
    target_points: np.ndarray, lv_reference_points: np.ndarray,
    distance_threshold_mm: float = _SEPTAL_DISTANCE_THRESHOLD_MM,
) -> float | None:
    """
    Patient-specific analogue of _angular_gap_center_deg: given the RV's own
    (axis-aligned, centred, real-mm) points and the LV's points in that SAME
    frame, finds the azimuthal direction of the RV points that actually sit
    near the LV -- i.e. the real septal wall, identified the same way rv-
    deformation's own free-wall extraction does (distance to the LV cavity,
    same 15 mm default), not a fixed-rule assumption about RV pose.

    Falls back to the closest 10% of RV points (by distance to LV) if none
    fall within the mm threshold, so a patient whose reconstructed meshes
    don't quite touch (a real possibility given each chamber is reconstructed
    independently by DeepSDF) still gets a usable, if noisier, direction
    rather than silently contributing nothing.

    Returns None if lv_reference_points is empty, or if the near-LV points
    don't actually agree on a direction -- callers should treat that as "no
    anatomical anchor available", not an error.

    2026-09-10: root-caused a real per-patient, per-frame bug via this path.
    On a handful of frames of one patient's RV (specific cardiac phases
    where the independently-reconstructed LV and RV meshes pass unusually
    close to each other over a WIDE arc, not just the true septal wall),
    "near" ends up spanning two separate clusters of RV points on opposite
    sides of the mesh -- e.g. septum AND part of the free wall both within
    15mm of the LV at that frame. A circular mean over a bimodal
    distribution like that doesn't land near either real cluster; it can
    point anywhere, including squarely at the WRONG side. That bad angle
    then wins register_cpd_warp/label_with_warp's rotation tie-break,
    producing a CPD atlas fit that's subtly folded for that frame --
    visible as dense per-vertex "salt and pepper" mislabeling once rendered
    with smooth per-vertex color interpolation. Other patients (and most
    frames of this one) never hit this because their near-LV points stay
    genuinely single-clustered around the true septum. Guarded here with a
    circular-concentration check (mean resultant length R -- standard
    circular-statistics measure of how tightly a set of angles clusters,
    1.0 = identical angle, 0.0 = uniformly spread/bimodal-and-opposed) so a
    degenerate, spread-out "near" set is rejected rather than trusted --
    callers already treat None as "fall back to the anchor-free heuristic",
    which this session separately confirmed stays low-speckle (~1-2%) on
    exactly these frames when the anchor is absent.
    """
    if lv_reference_points is None or lv_reference_points.shape[0] == 0:
        return None

    tree = cKDTree(lv_reference_points)
    distances, _ = tree.query(target_points)

    near = distances <= distance_threshold_mm
    if not np.any(near):
        # Fall back to the closest 10% rather than an arbitrary mm cutoff
        # that happens not to fit this patient's two independently-
        # reconstructed meshes.
        cutoff = max(1, int(np.ceil(0.10 * target_points.shape[0])))
        near = np.argsort(distances)[:cutoff]

    near_points = target_points[near]
    angles_rad = np.arctan2(near_points[:, 1], near_points[:, 0])
    sin_mean = np.mean(np.sin(angles_rad))
    cos_mean = np.mean(np.cos(angles_rad))
    # Mean resultant length: sqrt(sin_mean^2 + cos_mean^2), in [0, 1]. Low
    # values mean the near-LV points are scattered around the circle (or
    # split into opposed clusters) rather than agreeing on one side of the
    # mesh -- exactly the bimodal failure mode above, where the mean angle
    # itself is not a meaningful "direction" at all.
    resultant_length = float(np.hypot(sin_mean, cos_mean))
    if resultant_length < _SEPTAL_DIRECTION_MIN_CONCENTRATION:
        return None

    # Circular mean, not a plain average -- angles wrap at 360, so naively
    # averaging e.g. 350 and 10 degrees would wrongly give 180 instead of 0.
    mean_angle_rad = np.arctan2(sin_mean, cos_mean)
    return float(np.degrees(mean_angle_rad) % 360.0)


def _apply_cpd_field(vertices: np.ndarray, Y: np.ndarray, W: np.ndarray, beta: float,
                      chunk_size: int = _DENSE_FIELD_CHUNK) -> np.ndarray:
    """
    Apply a fitted CPD deformation field to arbitrary points, chunked over the
    input so peak memory is bounded by chunk_size x len(Y) rather than the full
    dense-point count x len(Y) at once. Identical approach to
    cpd_aha_segmentation._apply_cpd_field -- see that module for the derivation.
    """
    Y_sq = np.sum(Y ** 2, axis=1)
    out = np.empty_like(vertices)
    for start in range(0, vertices.shape[0], chunk_size):
        chunk = vertices[start:start + chunk_size]
        sq_dists = (
            np.sum(chunk ** 2, axis=1)[:, None] + Y_sq[None, :] - 2.0 * chunk @ Y.T
        )
        np.maximum(sq_dists, 0, out=sq_dists)
        G = np.exp(-sq_dists / (2 * beta ** 2))
        out[start:start + chunk_size] = chunk + G @ W
    return out


def _fit_cpd(target_points: np.ndarray, source_points: np.ndarray,
             beta: float = _CPD_BETA, lamb: float = _CPD_LAMBDA,
             max_iterations: int = _CPD_MAX_ITER, backend: str = "auto"):
    """
    Fit the CPD warp, GPU when available. Ported from rv_deform.py's fit_cpd() --
    see cpd_gpu.py for the GPU path and its verification against the CPU one.
    """
    use_gpu = cpd_gpu.gpu_available() if backend == "auto" else backend == "gpu"
    if use_gpu:
        return cpd_gpu.fit_cpd_gpu(target_points, source_points, beta=beta,
                                    lamb=lamb, max_iterations=max_iterations)
    reg = DeformableRegistration(X=target_points, Y=source_points,
                                  beta=beta, alpha=lamb, max_iterations=max_iterations)
    reg.register()
    return reg


def _load_canonical_atlas() -> dict:
    """
    Build the atlas point cloud once: load the 3 Zenodo RV zone folders' FULL
    (unsampled) vertices, centre on the combined centroid, rotate the anchor
    segment's centroid onto -Z (same apex-toward-negative-Z convention LV's atlas
    uses), normalise to a unit envelope, then label every dense point by which
    of the 9 source .obj files it came from (the atlas's own ground-truth labels
    -- no fixed-rule classifier to cross-check against here, unlike LV).
    """
    all_points: list[np.ndarray] = []
    dense_labels_list: list[np.ndarray] = []
    segment_names: list[str] = []
    anchor_centroid = None

    for zone in _ATLAS_ZONES:
        zone_dir = os.path.join(_ATLAS_DIR, zone)
        for obj_path in sorted(glob.glob(os.path.join(zone_dir, "*.obj"))):
            mesh = trimesh.load(obj_path, force="mesh", process=False)
            vertices = np.asarray(mesh.vertices, dtype=np.float64)
            seg_index = len(segment_names)
            segment_names.append(os.path.basename(obj_path))
            all_points.append(vertices)
            dense_labels_list.append(np.full(len(vertices), seg_index, dtype=np.int16))
            if zone == _ANCHOR_ZONE and os.path.basename(obj_path) == _ANCHOR_FILE:
                anchor_centroid = vertices.mean(axis=0)

    if anchor_centroid is None:
        raise RuntimeError(f"Atlas anchor file {_ANCHOR_FILE!r} not found under {_ATLAS_DIR}")
    if not all_points:
        raise RuntimeError(f"No atlas OBJ files found under {_ATLAS_DIR}")

    dense_points = np.concatenate(all_points, axis=0)
    dense_labels = np.concatenate(dense_labels_list, axis=0)

    # 1. Centre on the combined centroid.
    global_centroid = dense_points.mean(axis=0)
    dense_points = dense_points - global_centroid
    anchor_centroid = anchor_centroid - global_centroid

    # 2. Rotate the anchor segment's centroid onto -Z.
    v = anchor_centroid / np.linalg.norm(anchor_centroid)
    rotation = _rotation_matrix_from_vectors(v, np.array([0.0, 0.0, -1.0]))
    dense_points = dense_points @ rotation.T

    # 3. Normalise to a unit envelope -- rescaled per-patient at classification
    #    time (see register_cpd_warp) to match that patient's own point-cloud scale.
    scale = np.max(np.abs(dense_points))
    dense_points = dense_points / scale

    if dense_points.shape[0] > _MAX_REGISTRATION_POINTS:
        reg_idx = np.random.default_rng(0).choice(dense_points.shape[0], _MAX_REGISTRATION_POINTS, replace=False)
        reg_points = dense_points[reg_idx]
    else:
        reg_points = dense_points

    # The atlas covers the free wall only (~180 degrees per level; the septal
    # side is excluded, assigned to LV in the source scheme -- see rv-
    # deformation/README.md's "cinc9" section). In THIS canonical (angle-zero)
    # pose, the missing ~180-degree gap in dense_points' own azimuthal (XY)
    # distribution marks where the septum is, in the atlas's own frame. Found
    # once here (not per-patient) so register_cpd_warp can compare it against
    # a patient-specific septal direction (see _find_best_rigid_rotation's
    # preferred_angle_deg) without recomputing it every call.
    atlas_septal_gap_center_deg = _angular_gap_center_deg(dense_points)

    return {
        "dense_points": dense_points,
        "dense_labels": dense_labels,
        "reg_points": reg_points,
        "segment_names": segment_names,
        "septal_gap_center_deg": atlas_septal_gap_center_deg,
    }


_atlas_cache: dict | None = None


def _get_atlas() -> dict:
    """Lazily compute and cache the canonical atlas. Runs once per process."""
    global _atlas_cache
    if _atlas_cache is None:
        _atlas_cache = _load_canonical_atlas()
        logger.info(
            f"[CPD-RV] Cached canonical RV atlas: {_atlas_cache['dense_points'].shape[0]} dense points, "
            f"{len(_atlas_cache['segment_names'])} segments: {_atlas_cache['segment_names']}"
        )
    return _atlas_cache


def _rotation_matrix_z(angle_deg: float) -> np.ndarray:
    """3x3 rotation matrix for a rotation of angle_deg about the Z axis -- the
    apex-base axis both the atlas and the (axis-aligned, see Stage 1 below)
    patient points share by the time this is used."""
    theta = np.radians(angle_deg)
    c, s = np.cos(theta), np.sin(theta)
    return np.array([
        [c, -s, 0.0],
        [s, c, 0.0],
        [0.0, 0.0, 1.0],
    ])


def _find_best_rigid_rotation(
    dense_points: np.ndarray, dense_labels: np.ndarray, target_points: np.ndarray,
    n_candidates: int = _Z_ROTATION_CANDIDATES,
    preferred_angle_deg: float | None = None,
) -> tuple[np.ndarray, int]:
    """
    Picks a starting Z-rotation for the atlas by how many of the 9 segments
    populate after label transfer -- not by raw shape overlap, which can't
    distinguish a correctly-aligned RV from one rotated some way around its own
    long axis (same reasoning as LV's cpd_aha_segmentation._find_best_rigid_
    rotation, which this is ported from almost verbatim).

    Cheap: rigid nearest-neighbor label lookup only, no deformable registration
    per candidate -- the winning angle seeds the one real CPD registration.

    `preferred_angle_deg`, when given, breaks ties among candidates that ALL
    achieve the best populated-segment count by picking whichever is
    angularly closest to it -- see register_cpd_warp for where this comes
    from (a patient-specific septal direction derived from the LV mesh, when
    one is available). This can only ever choose among already-equally-good
    candidates: it never overrides a HIGHER-populated candidate in favour of
    a worse one just because it's closer to the preferred angle, so passing
    a poor or absent anchor degrades gracefully to the original heuristic,
    never worse.
    """
    n_segments = len(np.unique(dense_labels))
    candidates: list[tuple[float, np.ndarray, int]] = []
    best_populated = -1
    for angle_deg in np.linspace(0, 360, n_candidates, endpoint=False):
        rotation = _rotation_matrix_z(angle_deg)
        rotated_dense = dense_points @ rotation.T
        tree = cKDTree(rotated_dense)
        _, nearest_idx = tree.query(target_points)
        labels = dense_labels[nearest_idx]
        populated = len(np.unique(labels))
        candidates.append((angle_deg, rotation, populated))
        if populated > best_populated:
            best_populated = populated
        if populated == n_segments and preferred_angle_deg is None:
            # No anchor to break ties with anyway, so the first fully-
            # populated candidate is as good as any other -- keep the
            # original early-exit behaviour/cost in that case.
            break

    tied = [(angle, rotation) for angle, rotation, populated in candidates if populated == best_populated]
    if preferred_angle_deg is not None and len(tied) > 1:
        def _angular_distance(angle_deg: float) -> float:
            return abs((angle_deg - preferred_angle_deg + 180.0) % 360.0 - 180.0)
        tied.sort(key=lambda pair: _angular_distance(pair[0]))
    _, best_rotation = tied[0]
    return best_rotation, best_populated


def register_cpd_warp(
    mesh_points_canonical: np.ndarray, lv_reference_points: np.ndarray | None = None,
) -> dict | None:
    """
    The EXPENSIVE half of CPD classification: aligns the cached RV atlas onto
    this mesh (long-axis pre-alignment, then the Z-rotation search), registers
    it with CPD, and extends the learned field to the atlas's full dense vertex
    set. Returns a warp state dict for label_with_warp() to reuse CHEAPLY on
    other frames of the same reconstruction.

    Mirrors cpd_aha_segmentation.register_cpd_warp()'s contract exactly (same
    input shape, same None-on-failure convention, same warp_state reuse
    rationale: all frames of one reconstruction share a canonical coordinate
    space, so a warp fitted on any one frame's points applies to the others).
    The one addition is Stage 1 below -- see the module docstring for why.

    `lv_reference_points`, when given, is this same frame's LV contour point
    cloud (same NIfTI, same T/offset/scale, same frame -- see
    fourdreconstruction_handler.py's caller), used to derive a real,
    anatomy-grounded septal direction (_septal_direction_deg) instead of
    relying purely on Stage 2's "maximize populated segments" heuristic to
    pick among tied candidates. Optional and purely additive: omitting it
    (None) reproduces the exact prior behaviour.

    Returns None on failure (missing atlas, degenerate input, etc) -- callers
    should treat RV segmentation as unavailable for this reconstruction, same
    as classify_aha=False upstream.
    """
    pts = np.asarray(mesh_points_canonical, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 3 or pts.shape[0] == 0:
        return None

    try:
        atlas = _get_atlas()

        # The atlas is centred at its own centroid (_load_canonical_atlas step
        # 1). mesh_points_canonical here is NOT centred -- same root cause as
        # LV's register_cpd_warp bug (see cpd_aha_segmentation.py): without
        # this, Stage 1's Chamfer-based axis-sign check is comparing a point
        # cloud translated far from the atlas, and CPD is then asked to fit
        # across that translation gap too. Store the centroid so
        # label_with_warp reuses this SAME reference frame on later frames,
        # not a fresh one.
        patient_centroid = pts.mean(axis=0)
        pts = pts - patient_centroid

        patient_scale = np.max(np.abs(pts))
        if patient_scale == 0:
            return None
        reg_points_scaled = atlas["reg_points"] * patient_scale
        dense_points_scaled = atlas["dense_points"] * patient_scale

        if pts.shape[0] > _MAX_TARGET_POINTS:
            idx = np.random.default_rng(0).choice(pts.shape[0], _MAX_TARGET_POINTS, replace=False)
            target_sample = pts[idx]
        else:
            target_sample = pts

        # --- Stage 1: long-axis alignment ----------------------------------
        # Rotate the PATIENT's points (not the atlas) so their principal axis
        # lands on -Z, matching the atlas's own apex-at--Z convention. Both
        # signs of the PCA axis are tried; whichever gives lower Chamfer
        # distance against the (already -Z-aligned) atlas is kept -- same
        # empirical tie-break rv_deform.py's align_long_axis() uses, since the
        # taper-based heuristic was measured there to pick the wrong sign as
        # often as not. Rotating the patient rather than the atlas keeps the
        # cached atlas untouched between reconstructions and means every
        # subsequent step (Stage 2, CPD, per-frame reuse) operates in ONE
        # frame: the atlas's own.
        patient_axis = _principal_long_axis(target_sample)
        best_axis_rotation, best_axis_cham = None, np.inf
        for axis in (patient_axis, -patient_axis):
            R = _rotation_matrix_from_vectors(axis, np.array([0.0, 0.0, -1.0]))
            rotated = target_sample @ R.T
            cham = _chamfer_distance(rotated, dense_points_scaled)
            if cham < best_axis_cham:
                best_axis_rotation, best_axis_cham = R, cham
        logger.info(f"[CPD-RV] Long-axis alignment: Chamfer {best_axis_cham:.5f} after axis fix.")

        target_axis_aligned = target_sample @ best_axis_rotation.T

        # Same centring + axis-alignment as the RV target, applied to the
        # LV reference cloud so the two are compared in the SAME frame. See
        # fourdreconstruction_handler.py's caller for why this is valid
        # without any extra transform: LV and RV reconstructions of the same
        # NIfTI/frame share the same T/offset/scale (T never depends on
        # chamber), so their raw contour points already share one frame
        # before any of Stage 1's rotation is applied -- centring and
        # rotating both by the RV-derived patient_centroid/best_axis_rotation
        # keeps that shared frame, it doesn't need to independently re-derive
        # one for the LV side.
        preferred_angle_deg = None
        if lv_reference_points is not None and lv_reference_points.shape[0] > 0:
            lv_axis_aligned = (lv_reference_points - patient_centroid) @ best_axis_rotation.T
            patient_septal_deg = _septal_direction_deg(target_axis_aligned, lv_axis_aligned)
            if patient_septal_deg is not None:
                preferred_angle_deg = (patient_septal_deg - atlas["septal_gap_center_deg"]) % 360.0
                logger.info(
                    f"[CPD-RV] LV-derived septal anchor: patient={patient_septal_deg:.1f} deg, "
                    f"atlas gap centre={atlas['septal_gap_center_deg']:.1f} deg, "
                    f"preferred Z-rotation={preferred_angle_deg:.1f} deg."
                )

        # --- Stage 2: Z-rotation search (residual azimuthal correction) ----
        # See module docstring point 2: this is NOT optional polish. Without
        # it, CPD is asked to fit across whatever azimuthal offset happens to
        # exist between the atlas and this mesh purely through local
        # deformation -- which on this mesh source produces a folded result
        # missing an entire segment, not just a differently-rotated one.
        # preferred_angle_deg (when available) only breaks ties among
        # candidates that already achieve the best populated-segment count --
        # see _find_best_rigid_rotation's own docstring for why this can't
        # make the result worse than the pure heuristic.
        best_rotation, best_populated = _find_best_rigid_rotation(
            dense_points_scaled, atlas["dense_labels"], target_axis_aligned,
            preferred_angle_deg=preferred_angle_deg,
        )
        n_segments = len(atlas["segment_names"])
        logger.info(
            f"[CPD-RV] Rigid pre-alignment: best candidate populated {best_populated}/{n_segments} segments."
        )
        reg_points_scaled = reg_points_scaled @ best_rotation.T
        dense_points_scaled = dense_points_scaled @ best_rotation.T

        # --- Stage 3: CPD registration --------------------------------------
        reg = _fit_cpd(target_axis_aligned, reg_points_scaled)

        # --- Stage 4: extend the learned field to the full dense atlas -----
        warped_dense_atlas = _apply_cpd_field(dense_points_scaled, reg.Y, reg.W, reg.beta)

        return {
            "warped_dense_atlas": warped_dense_atlas,
            "dense_labels": atlas["dense_labels"],
            "segment_names": atlas["segment_names"],
            # Stored so label_with_warp() can put a LATER frame's raw points into
            # this same axis-aligned frame before querying -- the warp above was
            # fit in that frame, not the mesh's own raw coordinate frame.
            "axis_rotation": best_axis_rotation,
            "patient_centroid": patient_centroid,
            # So label_with_warp's own per-frame septal anchor (computed fresh
            # per frame, since RV/LV both move independently across the
            # cardiac cycle) doesn't need its own _get_atlas() call just for
            # this one number.
            "atlas_septal_gap_center_deg": atlas["septal_gap_center_deg"],
        }

    except Exception as exc:
        logger.warning(f"[CPD-RV] CPD registration failed ({exc}).")
        return None


def _smooth_labels_by_face_adjacency(
    labels: np.ndarray, faces: np.ndarray, n_segments: int, iterations: int = 2,
) -> np.ndarray:
    """
    Majority-vote smoothing over the PATIENT mesh's own vertex adjacency
    (derived from its triangle faces) -- the vertex-based analogue of
    rv_deform.py's assign_face_labels/transfer_labels_to_patient face-adjacency
    smoothing. Needed because this pipeline labels per-vertex via nearest-
    neighbor (see module docstring point 1), which alone produces a jagged,
    zigzag boundary between segments -- confirmed visually against a real
    reconstruction (2026-09-10) once the missing-centering bug above was fixed
    and 9/9 segments started actually populating.

    Fully vectorized (sparse adjacency @ one-hot labels) rather than a Python
    loop over vertices, so it stays cheap enough for label_with_warp's
    per-frame budget. Only ever replaces a vertex's label with a STRICT
    majority (> half of its neighbours + itself) -- never a plurality -- so a
    thin but real segment can't be voted away by a single smoothing pass.

    Guarantees every segment present on input is still present on output:
    2026-09-10, an earlier version left this unprotected and relied on
    CALLERS to check "did any segment vanish?" and discard the WHOLE pass if
    so -- measured against real reconstructions, that discarded smoothing on
    most frames (a single ambiguous vertex flipping away from an already-
    thin segment was enough to nuke every other vertex's improvement too),
    which is why boundaries stayed jagged despite the smoothing code
    existing. Fixed here instead, surgically: if an iteration's proposed
    update would empty a segment, keep only that segment's single
    LEAST-confidently-flipped vertex (smallest majority margin) rather than
    reverting the entire iteration.
    """
    n = labels.shape[0]
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]], axis=0)
    self_loops = np.arange(n)
    rows = np.concatenate([edges[:, 0], edges[:, 1], self_loops])
    cols = np.concatenate([edges[:, 1], edges[:, 0], self_loops])
    adjacency = coo_matrix((np.ones(rows.shape[0]), (rows, cols)), shape=(n, n)).tocsr()
    degree = np.asarray(adjacency.sum(axis=1)).flatten()

    current = labels.astype(np.int64)
    for _ in range(iterations):
        one_hot = np.zeros((n, n_segments), dtype=np.float64)
        one_hot[np.arange(n), current] = 1.0
        neighbor_counts = adjacency @ one_hot
        best_label = np.argmax(neighbor_counts, axis=1)
        best_count = neighbor_counts[np.arange(n), best_label]
        majority = best_count > (degree / 2.0)
        proposed = np.where(majority, best_label, current)

        present_before = set(np.unique(current).tolist())
        present_after = set(np.unique(proposed).tolist())
        for seg in present_before - present_after:
            was_seg_idx = np.where(current == seg)[0]
            margins = best_count[was_seg_idx] - (degree[was_seg_idx] / 2.0)
            keep = was_seg_idx[np.argmin(margins)]
            proposed[keep] = seg

        if np.array_equal(proposed, current):
            current = proposed
            break
        current = proposed
    return current.astype(np.int16)


def label_with_warp(
    mesh_points_canonical: np.ndarray, warp_state: dict, faces: np.ndarray | None = None,
    lv_reference_points: np.ndarray | None = None,
) -> np.ndarray | None:
    """
    The CHEAP half: nearest-neighbor label lookup against an already-warped
    atlas from register_cpd_warp(). No new (expensive) deformable registration
    -- this is what makes per-frame labeling affordable across a multi-frame RV
    reconstruction. Mirrors cpd_aha_segmentation.label_with_warp() exactly,
    plus re-applying the stored axis_rotation before querying (see
    register_cpd_warp's Stage 1).

    Includes the same cheap per-frame rigid re-check LV's version does: frames
    of the same 4D sequence don't all necessarily share the exact orientation
    the shared warp was fitted against.

    `faces` (the patient mesh's own triangle index array, Nx3) is optional --
    when given, a face-adjacency majority-vote smoothing pass runs on top of
    the raw per-vertex labels (see _smooth_labels_by_face_adjacency) to clean
    up the jagged boundaries plain nearest-neighbor labeling produces. Callers
    without face connectivity handy still get correct, just rougher, labels.

    `lv_reference_points`, when given, is THIS frame's own LV contour point
    cloud -- recomputed fresh per frame (not reused from register_cpd_warp's
    ED-frame anchor) since LV and RV each move independently across the
    cardiac cycle. Same tie-break-only role as in register_cpd_warp: see
    _find_best_rigid_rotation's docstring for why this can't make a frame's
    result worse than the pure heuristic would have.

    Returns None if label transfer leaves any segment empty even after the
    per-frame re-check, so a degenerate frame doesn't silently ship broken
    boundaries -- there's no fixed-rule fallback for RV to drop back to, so
    None here should be treated as "no RV segmentation for this frame", not
    papered over.
    """
    pts = np.asarray(mesh_points_canonical, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 3 or pts.shape[0] == 0:
        return None

    try:
        # Same centring register_cpd_warp applied, reusing ITS centroid (not a
        # fresh one for this frame) so every frame of the reconstruction is
        # compared against the atlas in the exact same reference frame the
        # warp was fitted in -- see register_cpd_warp's comment for why.
        patient_centroid = warp_state.get("patient_centroid")
        if patient_centroid is not None:
            pts = pts - patient_centroid

        pts_aligned = pts @ warp_state["axis_rotation"].T

        preferred_angle_deg = None
        atlas_gap_deg = warp_state.get("atlas_septal_gap_center_deg")
        if (
            lv_reference_points is not None and lv_reference_points.shape[0] > 0
            and patient_centroid is not None and atlas_gap_deg is not None
        ):
            lv_aligned = (lv_reference_points - patient_centroid) @ warp_state["axis_rotation"].T
            patient_septal_deg = _septal_direction_deg(pts_aligned, lv_aligned)
            if patient_septal_deg is not None:
                preferred_angle_deg = (patient_septal_deg - atlas_gap_deg) % 360.0

        best_rotation, rigid_check_populated = _find_best_rigid_rotation(
            warp_state["warped_dense_atlas"], warp_state["dense_labels"], pts_aligned,
            preferred_angle_deg=preferred_angle_deg,
        )
        n_segments = len(warp_state["segment_names"])
        logger.info(f"[CPD-RV] Per-frame rigid re-check: best candidate populated {rigid_check_populated}/{n_segments}.")
        rotated_warped_atlas = warp_state["warped_dense_atlas"] @ best_rotation.T

        tree = cKDTree(rotated_warped_atlas)
        _, nearest_idx = tree.query(pts_aligned)
        labels = warp_state["dense_labels"][nearest_idx].astype(np.int16)

        n_populated = len(np.unique(labels))
        if n_populated < n_segments:
            unique, counts = np.unique(labels, return_counts=True)
            missing = sorted(set(range(n_segments)) - set(unique.tolist()))
            counts_str = ", ".join(f"{seg}:{cnt}" for seg, cnt in zip(unique.tolist(), counts.tolist()))
            logger.warning(
                f"[CPD-RV] Reused-warp label transfer only populated {n_populated}/{n_segments} segments. "
                f"Populated counts=[{counts_str}]  Missing segment indices={missing}"
            )
            return None

        if faces is not None and faces.shape[0] > 0:
            smoothed = _smooth_labels_by_face_adjacency(labels, faces, n_segments)
            if len(np.unique(smoothed)) == n_segments:
                labels = smoothed
            else:
                logger.warning(
                    "[CPD-RV] Boundary smoothing would have dropped a segment to 0 vertices; "
                    "keeping unsmoothed labels for this frame."
                )

        return labels

    except Exception as exc:
        logger.warning(f"[CPD-RV] Reused-warp labeling failed ({exc}).")
        return None


# One level roughly quadruples face count (each triangle -> 4). Enough to make
# the staircase boundary look meaningfully finer without bloating per-frame
# mesh size/load time across a 4D sequence -- see refine_mesh_for_smooth_
# boundaries' own docstring for why this is the real fix, not a cosmetic one.
_BOUNDARY_SUBDIVISION_ITERATIONS = 1


def refine_mesh_for_smooth_boundaries(
    vertices: np.ndarray, faces: np.ndarray, labels: np.ndarray, warp_state: dict,
    iterations: int = _BOUNDARY_SUBDIVISION_ITERATIONS,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    The actual fix for the jagged/staircase segment-boundary look -- not a
    smoothed line drawn over an unchanged coarse fill (tried in
    ReconstructedHeartModel.tsx and confirmed there not to work: the fill's
    own triangulation has to be finer for its edge to look smooth), but
    genuinely finer geometry at the boundary itself, labeled correctly rather
    than guessed.

    Standard 1-to-4 triangle subdivision (trimesh.remesh.subdivide) inserts a
    new vertex at every edge midpoint. Those new vertices are labeled by the
    SAME nearest-neighbor query against the already-fitted CPD warp every
    other vertex went through (not interpolated/averaged from their two
    parent vertices), so a genuinely thin segment crossing a subdivided edge
    still gets classified correctly instead of smeared into its neighbor.
    Cheap: this reuses the warp fitted once in register_cpd_warp, so refining
    a frame costs a subdivide + one small KDTree query, not a fresh ~20-30s
    DeepSDF decode at a higher marching-cubes resolution.

    trimesh.remesh.subdivide's contract (verified against the installed
    version, not assumed): output vertices are the ORIGINAL vertices
    unchanged, in their original order, followed by the new edge-midpoint
    vertices -- so original labels carry over by direct index; only the
    appended vertices need a fresh label.

    Returns (vertices, faces, labels) for the CALLER to re-export as the
    mesh file frontend consumers load -- this changes vertex/face count, so
    it can't just return labels the way label_with_warp does; the geometry
    itself has to ship the extra detail too. Falls back to returning the
    INPUT unchanged (never raises) if anything about the refinement fails,
    so a refinement bug degrades to "boundaries stay jagged this frame", not
    a lost mesh.
    """
    try:
        current_vertices, current_faces, current_labels = vertices, faces, labels
        n_segments = len(warp_state["segment_names"])

        for _ in range(max(0, iterations)):
            new_vertices, new_faces = trimesh.remesh.subdivide(current_vertices, current_faces)
            n_original = current_vertices.shape[0]
            new_only = new_vertices[n_original:]

            # Same alignment every other vertex was labeled in -- see
            # register_cpd_warp/label_with_warp for why this (stored
            # patient_centroid + axis_rotation) is the correct, already-
            # established frame to query the warped atlas against.
            aligned = (new_only - warp_state["patient_centroid"]) @ warp_state["axis_rotation"].T
            tree = cKDTree(warp_state["warped_dense_atlas"])
            _, nearest_idx = tree.query(aligned)
            new_labels = warp_state["dense_labels"][nearest_idx].astype(np.int16)

            current_labels = np.concatenate([current_labels, new_labels])
            current_vertices, current_faces = new_vertices, new_faces

        smoothed = _smooth_labels_by_face_adjacency(current_labels, current_faces, n_segments)
        if len(np.unique(smoothed)) == n_segments:
            current_labels = smoothed
        else:
            logger.warning(
                "[CPD-RV] Post-subdivision smoothing would have dropped a segment; "
                "keeping unsmoothed subdivided labels."
            )

        return current_vertices, current_faces, current_labels

    except Exception as exc:
        logger.warning(f"[CPD-RV] Boundary refinement failed ({exc}); returning the unrefined mesh.")
        return vertices, faces, labels


def classify_vertices_to_rv9_cpd(mesh_points_canonical: np.ndarray) -> np.ndarray | None:
    """
    Single-call convenience wrapper: register + label in one step. Unlike LV's
    classify_vertices_to_aha17_cpd(), there is no fixed-rule fallback to drop to
    on failure -- returns None instead. A multi-frame reconstruction should call
    register_cpd_warp() ONCE (on the ED frame) and label_with_warp() per frame
    instead of calling this per frame, which re-registers from scratch every time.
    """
    pts = np.asarray(mesh_points_canonical, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 3 or pts.shape[0] == 0:
        return None

    warp_state = register_cpd_warp(pts)
    if warp_state is None:
        logger.warning("[CPD-RV] CPD registration failed; no RV segmentation for this mesh.")
        return None

    labels = label_with_warp(pts, warp_state)
    if labels is None:
        logger.warning("[CPD-RV] CPD label transfer failed; no RV segmentation for this mesh.")
        return None

    return labels
