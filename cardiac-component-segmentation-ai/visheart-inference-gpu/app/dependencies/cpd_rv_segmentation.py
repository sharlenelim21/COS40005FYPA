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
from scipy.sparse.csgraph import connected_components, dijkstra
from scipy.spatial import cKDTree

import cpd_gpu

logger = logging.getLogger("visheart")

_ATLAS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "atlas_rv")
_ATLAS_ZONES = ["Apical", "Basal", "Mid"]

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
# Fraction of each atlas zone's own points (by distance to that zone's own
# centroid) used as geodesic seed candidates for _geodesic_apex_base_ratio.
# 2026-09-28: tried 1.0 (the whole zone, to rule out a lopsided seed as the
# cause of Mid bulging into Basal's territory on one side) -- measured WORSE
# on all three level-overlap pairs (60.0/61.0/13.6% vs 54.3/56.7/0% at 0.3),
# so a lopsided seed was NOT the cause. Reverted; root cause still open.
_ATLAS_CORE_FRACTION = 0.3
# Set False to revert label_with_warp to plain nearest-neighbor classification
# with no call-site changes -- see _classify_levels_and_sectors_geodesic.
_GEODESIC_CLASSIFICATION_ENABLED = True


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


def _circular_mean_deg(angles_deg: np.ndarray) -> float:
    """Circular mean of a set of angles in degrees -- plain averaging is wrong
    across the 0/360 wrap (e.g. 350 and 10 would wrongly average to 180)."""
    rad = np.radians(angles_deg)
    return float(np.degrees(np.arctan2(np.mean(np.sin(rad)), np.mean(np.cos(rad)))) % 360.0)


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

    Returns None if lv_reference_points is empty, or if even the dominant
    cluster (see below) still doesn't agree on a direction -- callers should
    treat that as "no anatomical anchor available", not an error.

    2026-09-10: root-caused a real per-patient, per-frame bug via this path.
    On a handful of frames of one patient's RV (specific cardiac phases
    where the independently-reconstructed LV and RV meshes pass unusually
    close to each other over a WIDE arc, not just the true septal wall),
    "near" ends up spanning two separate clusters of RV points on opposite
    sides of the mesh -- e.g. septum AND part of the free wall both within
    15mm of the LV at that frame. A circular mean over a bimodal
    distribution like that doesn't land near either real cluster; it can
    point anywhere, including squarely at the WRONG side.

    2026-09-24: measured this isn't a rare edge case -- on a full 30-frame
    real reconstruction (patient005), the plain circular-mean version above
    returned None on 29/30 frames, i.e. the septal anchor was essentially
    NEVER engaging in practice, and register_cpd_warp/label_with_warp were
    silently falling back to the population-count-only heuristic on every
    frame. That heuristic is far weaker than assumed: a direct sweep found
    60 of 72 candidate Z-rotations (83%) achieve full 9/9 segment
    population on that same mesh, so "populated count" barely constrains
    the choice at all -- the fallback was picking an essentially arbitrary
    rotation among 60 equally-valid-looking ones on nearly every frame,
    which is why RV segmentation looked wrong/inconsistent in practice, not
    just occasionally.

    Root cause: near-LV points routinely form two genuine clusters (the true
    septum, plus a secondary near-contact elsewhere), and a flat circular
    mean over both is dragged toward a point between them -- lowering the
    resultant length below the trust threshold even though one of the two
    clusters is a clear, confident majority. Fixed by finding the dominant
    cluster FIRST (a 10-degree-bin histogram peak, then every point within
    30 degrees of that peak) and computing the circular mean and
    concentration check over just that cluster, rather than over the full,
    contaminated set. Re-measured on the same 30-frame sequence: 30/30
    frames now return a confident angle (concentration 0.96-0.98, versus
    the 0.5 threshold) instead of 1/30. Still returns None (same contract
    as before) if even the dominant cluster is too small or too spread out
    to trust, so a genuinely ambiguous frame still degrades to the
    anchor-free heuristic rather than being handed a guess.
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
        near_idx = np.argsort(distances)[: max(1, int(np.ceil(0.10 * target_points.shape[0])))]
    else:
        near_idx = np.where(near)[0]

    near_points = target_points[near_idx]
    angles_deg = np.degrees(np.arctan2(near_points[:, 1], near_points[:, 0])) % 360.0

    # Mode-seeking: find the single densest 10-degree bin, then take every
    # near-LV point within 30 degrees of that bin's centre as "the" cluster.
    # This is what makes the estimate robust to a second, unrelated cluster
    # (e.g. a spurious near-contact elsewhere) -- a flat mean over both
    # would land between them; this isolates the dominant one first.
    bin_edges = np.linspace(0.0, 360.0, 37)
    hist, _ = np.histogram(angles_deg, bins=bin_edges)
    peak_bin = int(np.argmax(hist))
    peak_center_deg = (bin_edges[peak_bin] + bin_edges[peak_bin + 1]) / 2.0

    angular_dist_deg = np.abs((angles_deg - peak_center_deg + 180.0) % 360.0 - 180.0)
    cluster_angles_deg = angles_deg[angular_dist_deg <= 30.0]
    if cluster_angles_deg.shape[0] < 3:
        return None

    cluster_rad = np.radians(cluster_angles_deg)
    sin_mean = np.mean(np.sin(cluster_rad))
    cos_mean = np.mean(np.cos(cluster_rad))
    # Mean resultant length: sqrt(sin_mean^2 + cos_mean^2), in [0, 1]. Low
    # values mean even the dominant cluster is too spread out to trust as a
    # single direction.
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
    (unsampled) vertices, centre on the combined centroid, rotate the apex-zone
    -to-base-zone centroid axis onto Z (apex toward -Z, same convention LV's
    atlas uses), normalise to a unit envelope, then label every dense point by
    which of the 9 source .obj files it came from (the atlas's own ground-truth
    labels -- no fixed-rule classifier to cross-check against here, unlike LV).
    """
    all_points: list[np.ndarray] = []
    dense_labels_list: list[np.ndarray] = []
    segment_names: list[str] = []
    zone_points: dict[str, list[np.ndarray]] = {zone: [] for zone in _ATLAS_ZONES}

    for zone in _ATLAS_ZONES:
        zone_dir = os.path.join(_ATLAS_DIR, zone)
        for obj_path in sorted(glob.glob(os.path.join(zone_dir, "*.obj"))):
            mesh = trimesh.load(obj_path, force="mesh", process=False)
            vertices = np.asarray(mesh.vertices, dtype=np.float64)
            seg_index = len(segment_names)
            segment_names.append(os.path.basename(obj_path))
            all_points.append(vertices)
            dense_labels_list.append(np.full(len(vertices), seg_index, dtype=np.int16))
            zone_points[zone].append(vertices)

    if not all_points:
        raise RuntimeError(f"No atlas OBJ files found under {_ATLAS_DIR}")

    dense_points = np.concatenate(all_points, axis=0)
    dense_labels = np.concatenate(dense_labels_list, axis=0)

    # 1. Centre on the combined centroid.
    global_centroid = dense_points.mean(axis=0)
    dense_points = dense_points - global_centroid

    # 2. Rotate the apex-zone -> base-zone centroid axis onto +Z (apex ends up
    #    at -Z). Using the WHOLE Apical/Basal zone centroids, not one arbitrary
    #    sector file, matters: a single-sector anchor (the previous approach)
    #    measured 15-18 degrees off the true apex/base axis here, because that
    #    one sector sits off to one side of the apex cap rather than at its
    #    center -- verified by PCA on the resulting point cloud (long axis
    #    should be ~0 degrees from Z; the single-sector anchor gave ~15 degrees,
    #    this full-zone-centroid axis gives ~3 degrees, the residual being the
    #    free wall's genuine curvature).
    apex_centroid = np.concatenate(zone_points["Apical"], axis=0).mean(axis=0) - global_centroid
    base_centroid = np.concatenate(zone_points["Basal"], axis=0).mean(axis=0) - global_centroid
    v = (base_centroid - apex_centroid)
    v = v / np.linalg.norm(v)
    rotation = _rotation_matrix_from_vectors(v, np.array([0.0, 0.0, 1.0]))
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

    # Ground-truth apex/base "core" points (nearest _ATLAS_CORE_FRACTION to each
    # zone's own centroid) and per-(level,segment) reference angles, relative to
    # the septal gap above -- both precomputed once here so register_cpd_warp's
    # per-patient classification can seed a geodesic level pass and anchor
    # sector assignment WITHOUT bootstrapping from the patient's own (possibly
    # wrong) nearest-neighbor labels. See _classify_levels_and_sectors_geodesic.
    level_of_segment = np.array([name.split("_")[0] for name in segment_names])
    dense_level = level_of_segment[dense_labels]

    def _core_mask(zone: str) -> np.ndarray:
        idx = np.where(dense_level == zone)[0]
        centroid = dense_points[idx].mean(axis=0)
        dist = np.linalg.norm(dense_points[idx] - centroid, axis=1)
        keep = idx[np.argsort(dist)[: max(1, int(len(idx) * _ATLAS_CORE_FRACTION))]]
        mask = np.zeros(dense_points.shape[0], dtype=bool)
        mask[keep] = True
        return mask

    sector_ref_angle_deg: dict[str, list[float]] = {}
    for zone in _ATLAS_ZONES:
        zone_mask = dense_level == zone
        local_xy = dense_points[zone_mask, :2]
        local_center = local_xy.mean(axis=0)
        angle_deg = np.degrees(np.arctan2(
            local_xy[:, 1] - local_center[1], local_xy[:, 0] - local_center[0]
        )) % 360.0
        angle_rel_septum = (angle_deg - atlas_septal_gap_center_deg) % 360.0
        zone_labels = dense_labels[zone_mask]
        sector_ref_angle_deg[zone] = [
            _circular_mean_deg(angle_rel_septum[zone_labels == segment_names.index(f"{zone}_Seg{seg + 1}.obj")])
            for seg in range(3)
        ]

    return {
        "dense_points": dense_points,
        "dense_labels": dense_labels,
        "reg_points": reg_points,
        "segment_names": segment_names,
        "septal_gap_center_deg": atlas_septal_gap_center_deg,
        "apex_core_mask": _core_mask("Apical"),
        "base_core_mask": _core_mask("Basal"),
        "sector_ref_angle_deg": sector_ref_angle_deg,
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
            # Passed through so label_with_warp's geodesic level/sector pass
            # doesn't need its own _get_atlas() call either -- see
            # _classify_levels_and_sectors_geodesic.
            "apex_core_mask": atlas["apex_core_mask"],
            "base_core_mask": atlas["base_core_mask"],
            "sector_ref_angle_deg": atlas["sector_ref_angle_deg"],
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


def _reassign_stray_islands(labels: np.ndarray, faces: np.ndarray, n_segments: int,
                             max_iterations: int = 30) -> np.ndarray:
    """
    Per-vertex majority-vote smoothing only looks at each vertex's immediate
    neighbours, so it has no way to notice that a self-consistent patch of
    one label is a stray island completely disconnected from the rest of
    that same segment, sitting inside a DIFFERENT segment's territory --
    2026-09-27, checked directly on a real reconstruction: 8 of 9 segments
    had multiple disconnected components, the smallest segment split across
    7 fragments with only ~80% of its own vertices actually connected to
    each other. That's what shows up as an island of one colour stranded
    inside another.

    Fixed by keeping only each segment's LARGEST connected component as
    confirmed, then growing the confirmed regions outward one adjacency-ring
    at a time: an unconfirmed vertex adjacent to at least one confirmed
    neighbour takes the majority label among those confirmed neighbours and
    becomes confirmed itself for the next round. Islands are small (single
    digits to a couple hundred vertices, measured), so this converges in a
    handful of rounds -- max_iterations is just a safety bound, not expected
    to bind in practice.
    """
    n = labels.shape[0]
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]], axis=0)
    rows = np.concatenate([edges[:, 0], edges[:, 1]])
    cols = np.concatenate([edges[:, 1], edges[:, 0]])
    adjacency = coo_matrix((np.ones(rows.shape[0]), (rows, cols)), shape=(n, n)).tocsr()

    current = labels.astype(np.int64).copy()
    confirmed = np.zeros(n, dtype=bool)
    for seg in range(n_segments):
        idx = np.where(current == seg)[0]
        if idx.size == 0:
            continue
        remap = -np.ones(n, dtype=np.int64)
        remap[idx] = np.arange(idx.size)
        seg_edges = edges[(current[edges[:, 0]] == seg) & (current[edges[:, 1]] == seg)]
        sub_rows = remap[seg_edges[:, 0]]
        sub_cols = remap[seg_edges[:, 1]]
        sub_graph = coo_matrix((np.ones(sub_rows.shape[0]), (sub_rows, sub_cols)), shape=(idx.size, idx.size))
        n_comp, comp_of = connected_components(sub_graph, directed=False)
        if n_comp <= 1:
            confirmed[idx] = True
            continue
        largest = np.argmax(np.bincount(comp_of))
        confirmed[idx[comp_of == largest]] = True

    needs_fix = ~confirmed
    for _ in range(max_iterations):
        if not needs_fix.any():
            break
        one_hot = np.zeros((n, n_segments), dtype=np.float64)
        confirmed_idx = np.where(~needs_fix)[0]
        one_hot[confirmed_idx, current[confirmed_idx]] = 1.0
        neighbor_counts = adjacency @ one_hot
        pending = np.where(needs_fix)[0]
        has_confirmed_neighbor = neighbor_counts[pending].sum(axis=1) > 0
        resolve_now = pending[has_confirmed_neighbor]
        if resolve_now.size == 0:
            break
        current[resolve_now] = np.argmax(neighbor_counts[resolve_now], axis=1)
        needs_fix[resolve_now] = False

    return current.astype(np.int16)


# --- Geometric (geodesic) level/sector classification --------------------
#
# label_with_warp's nearest-neighbor lookup assumes the atlas's flat-disk
# level/sector structure survives the CPD warp onto a real patient's free
# wall. Measured directly (2026-09-27, patient005): it doesn't -- adjacent
# levels' vertex positions overlap 66.9% (Apical/Mid) and 31.4% (Mid/Basal)
# along the mesh's own best-fit long axis, and an interactive 3D inspection
# from multiple camera angles showed the SAME classified mesh looking like a
# clean 3-band structure from one angle but scrambled from others -- proof
# the labels aren't organized into real 3D rings, not a display artifact.
# Neither CPD's regularization strength (_CPD_LAMBDA, swept 30-300) nor its
# kernel width (_CPD_BETA, swept 1.5-20) changed this at all, ruling out
# "the deformation isn't smooth enough" as the cause. Root cause: the RV
# free wall's apex-to-base path genuinely curves/bends, and nearest-neighbor
# label transfer has no way to respect that.
#
# The functions below recompute level (apex/base position) via true mesh-
# surface (geodesic) distance instead of a straight-axis projection, and
# recompute sector (circumferential position) via a per-level local angle
# anchored to the same septal direction label_with_warp already computes --
# i.e. reparametrize the PATIENT's own geometry directly, the same way
# build_rv_atlas.py's partition_template_real_uvc() already does for the
# atlas's own canonical shape, rather than trusting nearest-neighbor label
# transfer to carry that structure through the warp intact.

def _largest_connected_subset(candidate_idx: np.ndarray, faces: np.ndarray, n_vertices: int) -> np.ndarray:
    """Restricts candidate_idx to its largest connected component under the
    mesh's own face adjacency -- same pattern _reassign_stray_islands uses,
    applied to a seed CANDIDATE set instead of a post-hoc label so a stray
    outlier can't drag a geodesic seed to the wrong place."""
    if candidate_idx.size <= 1:
        return candidate_idx
    is_candidate = np.zeros(n_vertices, dtype=bool)
    is_candidate[candidate_idx] = True
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]], axis=0)
    both_candidates = is_candidate[edges[:, 0]] & is_candidate[edges[:, 1]]
    remap = -np.ones(n_vertices, dtype=np.int64)
    remap[candidate_idx] = np.arange(candidate_idx.size)
    sub_edges = edges[both_candidates]
    sub_rows, sub_cols = remap[sub_edges[:, 0]], remap[sub_edges[:, 1]]
    sub_graph = coo_matrix(
        (np.ones(sub_rows.shape[0]), (sub_rows, sub_cols)),
        shape=(candidate_idx.size, candidate_idx.size),
    )
    n_comp, comp_of = connected_components(sub_graph, directed=False)
    if n_comp <= 1:
        return candidate_idx
    largest = np.argmax(np.bincount(comp_of))
    return candidate_idx[comp_of == largest]


def _find_apex_base_seed_vertices(
    pts_aligned: np.ndarray, rotated_warped_atlas: np.ndarray, faces: np.ndarray,
    apex_core_mask: np.ndarray, base_core_mask: np.ndarray,
) -> tuple[np.ndarray | None, np.ndarray | None]:
    """
    Apex/base seed vertices for _geodesic_apex_base_ratio, found via reverse
    nearest-neighbor from the ATLAS's own ground-truth apex/base core points
    (already warped and rotated into this frame) onto the PATIENT mesh --
    not from the patient's own nearest-neighbor labels, which is exactly what
    needs fixing here and would make the seeding circular.
    """
    tree = cKDTree(pts_aligned)

    def _seed(core_mask: np.ndarray) -> np.ndarray | None:
        query_points = rotated_warped_atlas[core_mask]
        if query_points.shape[0] == 0:
            return None
        _, nearest_idx = tree.query(query_points)
        candidates = np.unique(nearest_idx)
        if candidates.size < _LEVEL_MIN_SEED_VERTICES:
            return None
        return _largest_connected_subset(candidates, faces, pts_aligned.shape[0])

    return _seed(apex_core_mask), _seed(base_core_mask)


def _geodesic_apex_base_ratio(
    pts_aligned: np.ndarray, faces: np.ndarray, apex_seed_idx: np.ndarray, base_seed_idx: np.ndarray,
) -> np.ndarray:
    """
    Per-vertex apex(0)<->base(1) position via true mesh-surface distance, not
    a straight-line axis projection -- see this section's own header comment
    for why a straight axis produced 66.9%/31.4% level overlap on a real
    (curved) free wall. NaN where a vertex can't reach one of the two seed
    sets (a disconnected mesh fragment); caller falls back to nearest-
    neighbor labels there.

    Virtual-hub trick: one extra graph node per seed set, zero-weight-
    connected to every vertex in that set, turns "shortest distance to ANY
    of these N seed vertices" into a single-source Dijkstra call instead of
    N separate ones.
    """
    n = pts_aligned.shape[0]
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]], axis=0)
    edge_len = np.linalg.norm(pts_aligned[edges[:, 0]] - pts_aligned[edges[:, 1]], axis=1)
    rows = np.concatenate([edges[:, 0], edges[:, 1]])
    cols = np.concatenate([edges[:, 1], edges[:, 0]])
    vals = np.concatenate([edge_len, edge_len])

    apex_hub, base_hub = n, n + 1
    hub_rows = np.concatenate([
        np.full(apex_seed_idx.size, apex_hub), apex_seed_idx,
        np.full(base_seed_idx.size, base_hub), base_seed_idx,
    ])
    hub_cols = np.concatenate([
        apex_seed_idx, np.full(apex_seed_idx.size, apex_hub),
        base_seed_idx, np.full(base_seed_idx.size, base_hub),
    ])
    hub_vals = np.zeros(hub_rows.shape[0])

    graph = coo_matrix(
        (np.concatenate([vals, hub_vals]), (np.concatenate([rows, hub_rows]), np.concatenate([cols, hub_cols]))),
        shape=(n + 2, n + 2),
    ).tocsr()
    dist = dijkstra(graph, directed=False, indices=[apex_hub, base_hub])
    dist_from_apex, dist_from_base = dist[0, :n], dist[1, :n]

    t = np.full(n, np.nan)
    reachable = np.isfinite(dist_from_apex) & np.isfinite(dist_from_base)
    total = dist_from_apex[reachable] + dist_from_base[reachable]
    t[reachable] = dist_from_apex[reachable] / np.maximum(total, 1e-9)
    return t


def _area_weighted_level_thresholds(t: np.ndarray, faces: np.ndarray, pts_aligned: np.ndarray) -> tuple[float, float]:
    """
    Two cut points on t splitting the mesh into thirds by SURFACE AREA (not
    raw vertex count, which would force exactly 1/3 of vertices into each
    level regardless of true anatomical proportions) -- mirrors build_rv_
    atlas.py's partition_template_real_uvc(), which cuts its own atlas the
    same way.
    """
    valid = np.isfinite(t[faces]).all(axis=1)
    face_t = t[faces[valid]].mean(axis=1)
    v0, v1, v2 = (pts_aligned[faces[valid, k]] for k in range(3))
    face_area = 0.5 * np.linalg.norm(np.cross(v1 - v0, v2 - v0), axis=1)

    order = np.argsort(face_t)
    cumulative = np.cumsum(face_area[order])
    cumulative /= cumulative[-1]
    t_lo = float(face_t[order][np.searchsorted(cumulative, 1.0 / 3.0)])
    t_hi = float(face_t[order][np.searchsorted(cumulative, 2.0 / 3.0)])
    return t_lo, t_hi


def _warped_sector_ref_angle_deg(
    rotated_warped_atlas: np.ndarray, dense_labels: np.ndarray, segment_names: list[str],
    patient_septal_deg: float,
) -> dict[str, list[float]]:
    """
    Same computation _load_canonical_atlas uses for sector_ref_angle_deg, but
    on the atlas points AFTER CPD warping + rigid rotation into this specific
    patient's frame, anchored to this patient's OWN septal direction instead
    of the atlas's generic one. Matters because CPD's warp is not a rigid
    rotation -- it can stretch the free wall unevenly across its width, so a
    reference angle fixed once on the FLAT, unwarped atlas no longer marks
    the same physical location once the atlas is bent to fit real (non-
    generic) anatomy. Using the warped points keeps the reference angle and
    the patient's own raw angle (computed the same way, in
    _assign_sectors_by_local_angle) in the same, actually-deformed frame.
    """
    level_of_segment = np.array([name.split("_")[0] for name in segment_names])
    dense_level = level_of_segment[dense_labels]
    ref: dict[str, list[float]] = {}
    for zone in _ATLAS_ZONES:
        zone_mask = dense_level == zone
        local_xy = rotated_warped_atlas[zone_mask, :2]
        local_center = local_xy.mean(axis=0)
        angle_deg = np.degrees(np.arctan2(
            local_xy[:, 1] - local_center[1], local_xy[:, 0] - local_center[0]
        )) % 360.0
        angle_rel_septum = (angle_deg - patient_septal_deg) % 360.0
        zone_labels = dense_labels[zone_mask]
        ref[zone] = [
            _circular_mean_deg(angle_rel_septum[zone_labels == segment_names.index(f"{zone}_Seg{seg + 1}.obj")])
            for seg in range(3)
        ]
    return ref


def _assign_sectors_by_local_angle(
    pts_aligned: np.ndarray, level_name: np.ndarray, patient_septal_deg: float,
    sector_ref_angle_deg: dict[str, list[float]],
) -> np.ndarray:
    """
    Per-vertex sector (1/2/3) via the angle around ITS OWN level band's local
    XY centroid (a level's cross-sectional centroid can sit meaningfully off
    the mesh's global centre -- same fix build_rv_atlas.py's sector cut
    already needed), relative to patient_septal_deg -- the same anatomical
    anchor label_with_warp already computes for its rotation-search tie-
    break, reused here so sector identity (which physical side is Seg1 vs
    Seg3) stays consistent across frames and patients, not just internally
    consistent within one mesh. Assigns each vertex to whichever of that
    level's 3 reference angles (sector_ref_angle_deg, computed once from the
    atlas's own canonical shape) is circularly nearest.
    """
    sector = np.ones(pts_aligned.shape[0], dtype=np.int64)
    for zone in _ATLAS_ZONES:
        mask = level_name == zone
        if not mask.any():
            continue
        local_xy = pts_aligned[mask, :2]
        local_center = local_xy.mean(axis=0)
        angle_deg = np.degrees(np.arctan2(
            local_xy[:, 1] - local_center[1], local_xy[:, 0] - local_center[0]
        )) % 360.0
        angle_rel_septum = (angle_deg - patient_septal_deg) % 360.0
        refs = np.array(sector_ref_angle_deg[zone])
        circular_dist = np.abs((angle_rel_septum[:, None] - refs[None, :] + 180.0) % 360.0 - 180.0)
        sector[mask] = np.argmin(circular_dist, axis=1) + 1
    return sector


def _flatten_geodesic_to_plane(t: np.ndarray, pts_aligned: np.ndarray) -> np.ndarray:
    """
    Projects the geodesic apex/base field onto its own best-fit FLAT PLANE,
    via least-squares regression of t against raw position. 2026-09-28:
    confirmed by direct visual inspection that raw t itself is smooth and
    monotonic (no bug in the geodesic distance computation) -- but on a
    curved/bent free wall, geodesic distance's own iso-contours (its level
    sets) are genuinely TILTED relative to the tube's overall length, not
    flat rings. Thresholding raw t directly cuts along those tilted contours,
    which is what surfaced as Mid bulging further up one side of the mesh
    than the other into Basal's territory -- not a wrong t value, a curved
    cut. Fitting a flat plane through the same t values keeps the geodesic
    field's overall apex-to-base ordering (used to seed/orient the fit) but
    cuts with a flat, untilted plane, which is what a visually horizontal
    layer boundary actually needs.
    """
    valid = np.isfinite(t)
    A = np.hstack([pts_aligned[valid], np.ones((int(valid.sum()), 1))])
    coef, *_ = np.linalg.lstsq(A, t[valid], rcond=None)
    return pts_aligned @ coef[:3] + coef[3]


_LEVEL_MIN_SEED_VERTICES = 3
# Tercile order t=0->1 (apex->base) resolves to, independent of _ATLAS_ZONES'
# alphabetical (Apical/Basal/Mid) glob-load order used everywhere else.
_LEVEL_TERCILE_ORDER = ["Apical", "Mid", "Basal"]


def _enforce_single_component_per_class(
    class_idx: np.ndarray, pts_aligned: np.ndarray, faces: np.ndarray, n_classes: int,
) -> np.ndarray:
    """
    Collapses each class down to its single LARGEST connected patch (by face
    count) and reassigns every smaller stray island to whichever kept patch
    its centroid is nearest to -- guarantees a clean, non-overlapping,
    non-fragmented partition (e.g. exactly 3 contiguous level bands) instead
    of letting several disconnected same-class patches coexist.

    2026-09-30, per Sharlene: a flat linear threshold (the width-projection
    level cut) can cross the same class boundary more than once on a
    genuinely bent/curved free wall, producing small disconnected islands of
    the "wrong" class stranded inside a neighbor's territory -- this is a
    real geometric consequence of cutting a curved surface with a flat
    plane, not a labeling bug, and this cleanup pass is the fix: "I want
    clear three layers shown, not overlaps."
    """
    face_class = class_idx[faces[:, 0]]
    face_centroids = pts_aligned[faces].mean(axis=1)

    mesh_t = trimesh.Trimesh(vertices=pts_aligned, faces=faces, process=False)
    face_adj = mesh_t.face_adjacency
    same = face_class[face_adj[:, 0]] == face_class[face_adj[:, 1]]
    fa = face_adj[same]
    n_faces = len(faces)
    data = np.ones(len(fa))
    adj_matrix = coo_matrix((data, (fa[:, 0], fa[:, 1])), shape=(n_faces, n_faces))
    n_comp, comp_of_face = connected_components(adj_matrix, directed=False)

    keep_component = np.full(n_classes, -1, dtype=np.int64)
    kept_face_mask = np.zeros(n_faces, dtype=bool)
    for c in range(n_classes):
        comps_here = comp_of_face[face_class == c]
        if comps_here.size == 0:
            continue
        sizes = np.bincount(comps_here)
        best_comp = int(np.argmax(sizes))
        keep_component[c] = best_comp
        kept_face_mask |= (comp_of_face == best_comp) & (face_class == c)

    orphan_mask = ~kept_face_mask
    if orphan_mask.any() and kept_face_mask.any():
        kept_tree = cKDTree(face_centroids[kept_face_mask])
        kept_class = face_class[kept_face_mask]
        _, nearest = kept_tree.query(face_centroids[orphan_mask])
        new_face_class = face_class.copy()
        new_face_class[orphan_mask] = kept_class[nearest]
    else:
        new_face_class = face_class

    # carry the (now-clean) face classes back to per-vertex classes: each
    # vertex takes the class of any one of its incident faces (majority not
    # needed -- boundary vertices get resolved the same way the existing
    # _smooth_labels_by_face_adjacency pass already handles afterward)
    new_class_idx = class_idx.copy()
    for f_idx, cls in enumerate(new_face_class):
        new_class_idx[faces[f_idx]] = cls
    return new_class_idx


def _classify_levels_and_sectors_geodesic(
    pts_aligned: np.ndarray, faces: np.ndarray, warp_state: dict,
    rotated_warped_atlas: np.ndarray, patient_septal_deg: float | None, fallback_labels: np.ndarray,
) -> np.ndarray | None:
    """
    Orchestrates the geometric relabeling this section's header comment
    describes. Returns None on any seeding/geodesic failure (caller keeps
    fallback_labels -- today's nearest-neighbor result -- unchanged, never a
    hard failure).
    """
    apex_seed, base_seed = _find_apex_base_seed_vertices(
        pts_aligned, rotated_warped_atlas, faces,
        warp_state["apex_core_mask"], warp_state["base_core_mask"],
    )
    if apex_seed is None or base_seed is None:
        return None

    t = _geodesic_apex_base_ratio(pts_aligned, faces, apex_seed, base_seed)
    if not np.isfinite(t).any():
        return None
    t_flat = _flatten_geodesic_to_plane(t, pts_aligned)

    # 2026-09-30, per Sharlene (PREVIEW -- trying a ~90-100deg level tilt:
    # "the apical basal and mid should be like that but the seg1 seg2 seg3
    # is another 90 degree"): "Apical/Mid/Basal" (level) is a LENGTHWISE
    # strip (boundary plane roughly CONTAINS the apex-base axis, ~90deg tilt
    # from a flat ring), cut perpendicular to the septal reference direction.
    # "Seg1/Seg2/Seg3" (sector) is the apex-to-base HEIGHT tercile -- a
    # further ~90deg rotation from the level cut, i.e. back toward a flat
    # ring, which is what "another 90 degree" describes geometrically.
    sector_thresholds = warp_state.get("sector_cut_thresholds")
    if sector_thresholds is None:
        sector_thresholds = _area_weighted_level_thresholds(t_flat, faces, pts_aligned)
        warp_state["sector_cut_thresholds"] = sector_thresholds
    t_lo, t_hi = sector_thresholds
    tercile_idx = np.digitize(t_flat, [t_lo, t_hi])
    sector = tercile_idx + 1  # 1=apex-ward, 2=mid, 3=base-ward

    if patient_septal_deg is not None:
        septal_rad = np.radians(patient_septal_deg)
        width_dir = np.array([-np.sin(septal_rad), np.cos(septal_rad)])
        local_xy = pts_aligned[:, :2]
        local_center = local_xy.mean(axis=0)
        width_proj = (local_xy - local_center) @ width_dir

        width_thresholds = warp_state.get("level_width_thresholds")
        if width_thresholds is None:
            v0, v1, v2 = (pts_aligned[faces[:, k]] for k in range(3))
            face_area = 0.5 * np.linalg.norm(np.cross(v1 - v0, v2 - v0), axis=1)
            face_width = width_proj[faces[:, 0]]
            order = np.argsort(face_width)
            cumulative = np.cumsum(face_area[order])
            cumulative /= cumulative[-1]
            w_lo = float(face_width[order][np.searchsorted(cumulative, 1.0 / 3.0)])
            w_hi = float(face_width[order][np.searchsorted(cumulative, 2.0 / 3.0)])
            width_thresholds = (w_lo, w_hi)
            warp_state["level_width_thresholds"] = width_thresholds
        w_lo, w_hi = width_thresholds
        wedge_idx = np.digitize(width_proj, [w_lo, w_hi])
        level_name = np.array(["Basal", "Mid", "Apical"])[wedge_idx]
    else:
        # No anatomical anchor available this frame (see _septal_direction_deg's
        # own contract) -- level can't be anchored consistently, so fall back
        # to whatever nearest-neighbor already assigned. Sector still uses
        # the new geodesic result: it doesn't depend on this anchor at all.
        fallback_level = np.array([n.split("_")[0] for n in warp_state["segment_names"]])
        level_name = fallback_level[fallback_labels]

    segment_names = warp_state["segment_names"]
    new_labels = np.array([
        segment_names.index(f"{lv}_Seg{sc}.obj") for lv, sc in zip(level_name, sector)
    ], dtype=np.int16)
    # collapse each of the 9 FINAL named segments down to its single largest
    # connected patch -- level and sector can each be individually clean and
    # still produce a fragmented intersection where their two independent
    # cuts cross each other on the curved free wall, so the enforcement has
    # to run on the combined 9-class result, not the two cuts separately
    new_labels = _enforce_single_component_per_class(
        new_labels, pts_aligned, faces, len(segment_names),
    ).astype(np.int16)
    new_labels[~np.isfinite(t)] = fallback_labels[~np.isfinite(t)]
    return new_labels


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
        # Initialized here (not just inside the block below) so it's always
        # defined for _classify_levels_and_sectors_geodesic's sector pass,
        # which treats None as "no anatomical anchor this frame" rather than
        # raising on an undefined name.
        patient_septal_deg = None
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
            if _GEODESIC_CLASSIFICATION_ENABLED:
                geodesic_labels = _classify_levels_and_sectors_geodesic(
                    pts_aligned, faces, warp_state, rotated_warped_atlas, patient_septal_deg, labels,
                )
                if geodesic_labels is not None:
                    labels = geodesic_labels

            smoothed = _smooth_labels_by_face_adjacency(labels, faces, n_segments)
            if len(np.unique(smoothed)) == n_segments:
                labels = smoothed
            else:
                logger.warning(
                    "[CPD-RV] Boundary smoothing would have dropped a segment to 0 vertices; "
                    "keeping unsmoothed labels for this frame."
                )
            labels = _reassign_stray_islands(labels, faces, n_segments)

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
    vertices: np.ndarray, faces: np.ndarray, labels: np.ndarray, n_segments: int = 9,
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
    new vertex at every edge midpoint. A new vertex inherits its label
    directly when its two parent vertices already agree -- nothing ambiguous
    to resolve there. Only when the parents disagree (a genuine boundary
    edge) does it fall back to a nearest-neighbor query against the mesh's
    OWN already-labeled vertices (pre-subdivision) -- cheap (a subdivide plus
    one small KDTree query, not a fresh ~20-30s DeepSDF decode at a higher
    marching-cubes resolution), and self-contained: no atlas or CPD warp
    involved. 2026-09-30: this used to query the CPD-warped Zenodo atlas
    instead; removed along with the rest of the atlas-CPD labeling path --
    see cpd_rv_segmentation.py's module docstring and
    label_cpd9_from_raw_slices for why. A disagreeing boundary edge's own
    nearest ORIGINAL mesh vertex is at least as good a tie-break as an
    atlas lookup, since it's already been correctly classified by
    label_cpd9_from_raw_slices.

    2026-09-25: this used to always run the nearest-neighbor query and then
    re-smooth the whole (now larger) label array -- on a real reconstruction
    that either eroded small segments (smoothing the already-resolved
    original vertices a second time) or, once that was blocked with a
    protected-vertex mask, left a periodic speckle where isolated new
    vertices couldn't out-vote their equally-new, equally-ambiguous
    neighbors. Inheriting from agreeing parents sidesteps both: the ~90% of
    new vertices with agreeing parents never touch the noisy vote at all,
    and no smoothing pass runs afterward to erode anything.

    Correspondence between a new vertex and its parent edge is found by
    exact midpoint position (matched against edges_unique via cKDTree), not
    assumed from trimesh.remesh.subdivide's vertex ordering -- verified
    against the installed version, but a KDTree match holds regardless of
    ordering.

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

        for _ in range(max(0, iterations)):
            n_before = current_vertices.shape[0]
            prior_mesh = trimesh.Trimesh(vertices=current_vertices, faces=current_faces, process=False)
            edges = prior_mesh.edges_unique

            new_vertices, new_faces = trimesh.remesh.subdivide(current_vertices, current_faces)
            new_only = new_vertices[n_before:]

            # Match each new vertex to the unique edge it's the midpoint of,
            # by exact position rather than trusting subdivide()'s internal
            # vertex ordering to line up with edges_unique's.
            edge_midpoints = (current_vertices[edges[:, 0]] + current_vertices[edges[:, 1]]) / 2.0
            _, edge_idx = cKDTree(edge_midpoints).query(new_only)
            label_a = current_labels[edges[edge_idx, 0]]
            label_b = current_labels[edges[edge_idx, 1]]

            # Disagreeing-parent tie-break: nearest neighbor against the
            # mesh's OWN pre-subdivision vertices (already correctly
            # labeled by label_cpd9_from_raw_slices) -- no atlas involved.
            tree = cKDTree(current_vertices)
            _, nearest_idx = tree.query(new_only)
            nn_label = current_labels[nearest_idx].astype(np.int16)

            # When a midpoint's two parent vertices already agree, inherit
            # that label directly -- there's no ambiguity to resolve, so a
            # majority-vote smoothing pass has nothing useful to do and can
            # only introduce noise (2026-09-25: it did -- see git history).
            # Only a genuine boundary edge (parents disagree) needs the
            # nearest-neighbor query to decide.
            new_labels = np.where(label_a == label_b, label_a, nn_label)

            current_labels = np.concatenate([current_labels, new_labels])
            current_vertices, current_faces = new_vertices, new_faces

        # 2026-10, per Sharlene, intentionally NOT calling _reassign_stray_islands
        # here anymore (it used to run as a final cleanup pass). Confirmed live on
        # real patient data that it was deleting REAL anatomy, not noise: a
        # segment's raw 2D source data (label_cpd9_from_raw_slices' own per-slice
        # masks) was a single whole, connected region on every contributing slice,
        # yet still came out as 2 disconnected pieces on the RECONSTRUCTED mesh --
        # because the DeepSDF reconstruction doesn't always align rigidly enough
        # with the raw segmentation in every region, not because of a labeling
        # bug. Measured directly: the two mesh pieces sat ~100mm apart along the
        # actual surface (geodesic) despite only ~20-30mm apart in straight-line
        # distance -- a reconstruction-alignment gap, not a stray label island.
        # _reassign_stray_islands has no way to tell that apart from genuine noise
        # (it keeps only the single largest connected piece per segment, always),
        # so it discarded a real ~19% chunk of one segment on this patient. The
        # trade-off accepted instead: a segment can occasionally render as two
        # separate-looking pieces rather than one perfectly smooth blob, in
        # exchange for never silently deleting real labeled data.
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


# ---------------------------------------------------------------------------
# 2026-09-30, per Sharlene: 9 C-PD RV segments computed directly per short-axis
# slice from the patient's OWN raw segmentation (3 longitudinal levels by
# slice rank, 3 rotational sectors per slice via the local RV->LV direction),
# not via a global 3D plane cut on the CPD-warped atlas or the reconstructed
# mesh. This sidesteps the whole failure mode this module's earlier
# atlas-CPD approach kept hitting on this pipeline's genuinely curved,
# DeepSDF-reconstructed RV meshes (diagonal/jagged boundaries, fragmented
# islands): a flat cut -- whichever axis it's taken along -- doesn't respect
# a bent surface, but a per-slice local reference does, because each
# short-axis slice IS locally flat by construction (that's what "short-axis"
# means). Matches the apicobasal + rotational coordinate idea in Bazhutina
# et al. (CinC 2023) / Bayer et al. (2018 Universal Ventricular Coordinates),
# computed on the patient's real slices rather than a deformed generic atlas.
#
# 2026-10, per Sharlene: the per-slice SECTOR cut (below) was ported from
# rv-deformation's rv_chord_geometry.py (compute_freewall_arc_sectors /
# sector_labels_from_freewall_arc), replacing this function's own earlier
# inline "three parallel chords from the centroid" geometry. Both methods
# were validated side by side on real patient005 data this session: the
# chord method cuts along a straight line through the centroid, which can
# land outside the RV mask entirely on a crescent-shaped slice (forcing the
# "closest single pixel" fallback below to keep Seg2 non-empty); the arc
# method instead walks the free wall's OWN curved boundary and cuts it by
# arc length, which respects the crescent shape and needs no such fallback.
# Level assignment (apex-base rank into thirds) and the apex-orientation
# cache are UNCHANGED -- only the sector math and its continuity scheme
# are new. See compute_freewall_arc_sectors below for the full method.
_RV_LABEL = 1
_LV_CAVITY_LABEL = 3
_CPD9_MIN_RV_PIXELS = 15
_CPD9_LEVEL_NAMES = ["Apical", "Basal", "Mid"]
_cpd9_apex_at_start_cache: dict[str, bool] = {}


def _cpd9_load_frame_labelmap(nifti_path: str, frame_idx: int) -> tuple[np.ndarray, np.ndarray]:
    """
    Loads one frame's (Z,Y,X) integer label volume plus its voxel-to-world
    affine (4x4, LPS convention matching get_P.get_contour's own transform),
    from a 4D (T,Z,Y,X) or 3D (Z,Y,X) raw segmentation NIfTI.
    """
    import SimpleITK as sitk
    from get_P import normalize_nifti_dimensions, extract_spatial_metadata

    img = sitk.ReadImage(nifti_path)
    arr = sitk.GetArrayFromImage(img)
    if arr.ndim == 4:
        arr = arr[frame_idx]
    arr = normalize_nifti_dimensions(arr)

    origin, spacing, direction = extract_spatial_metadata(img)
    space_directions = spacing * direction
    lps2world = np.eye(4)
    lps2world[0:3, 0:3] = space_directions
    lps2world[0:3, 3] = origin
    return arr, lps2world


def _cpd9_slice_info(arr: np.ndarray) -> list[dict | None]:
    """Per-slice RV/LV centroids and cleaned RV mask (largest component only)."""
    from scipy import ndimage

    info: list[dict | None] = []
    for z in range(arr.shape[0]):
        rv_mask = arr[z] == _RV_LABEL
        if rv_mask.sum() < _CPD9_MIN_RV_PIXELS:
            info.append(None)
            continue
        labeled, n_comp = ndimage.label(rv_mask)
        if n_comp > 1:
            sizes = ndimage.sum(rv_mask, labeled, range(1, n_comp + 1))
            rv_mask = labeled == (int(np.argmax(sizes)) + 1)
        if rv_mask.sum() < _CPD9_MIN_RV_PIXELS:
            info.append(None)
            continue
        rv_ij = np.argwhere(rv_mask)
        lv_mask = arr[z] == _LV_CAVITY_LABEL
        lv_centroid_ij = np.argwhere(lv_mask).mean(axis=0) if lv_mask.sum() >= _CPD9_MIN_RV_PIXELS else None
        info.append({
            "z": z, "rv_mask": rv_mask, "rv_area": int(rv_mask.sum()),
            "rv_centroid_ij": rv_ij.mean(axis=0), "lv_centroid_ij": lv_centroid_ij,
        })
    return info


def _mask_boundary_contour(mask: np.ndarray) -> np.ndarray | None:
    """The mask's own largest boundary loop, as an ordered (N, 2) array of
    (row, col) float coordinates (sub-pixel, marching-squares) -- the actual
    pixel perimeter, not a convex hull, so it follows concavities (the real
    septal/free-wall hinge points, a.k.a. "horns" below, are concave and can
    fail to survive onto a hull). None if the mask has no boundary (empty)."""
    from skimage.measure import find_contours

    contours = find_contours(np.asarray(mask).astype(float), level=0.5)
    if not contours:
        return None
    contour = max(contours, key=len)
    return contour[:-1]  # drop the duplicate closing point (first == last)


def _freewall_arc_sector_labels(
    rv_ij: np.ndarray, rv_mask: np.ndarray, centroid: np.ndarray, septal_direction: np.ndarray,
    prev_axis: np.ndarray | None, prev_horns: tuple[np.ndarray, np.ndarray] | None,
    cut_fractions: tuple[float, float] = (1 / 3, 2 / 3),
) -> tuple[np.ndarray, np.ndarray, tuple[np.ndarray, np.ndarray]] | None:
    """
    Seg1/Seg2/Seg3 (0/1/2) per rv_ij row, cut along the RV free wall's OWN
    curved boundary rather than a straight chord through the centroid.
    Replaces this module's earlier "three parallel chords" sector geometry
    (2026-09-30 - 2026-10), ported and validated against real patient005 data
    in Sharlene's rv-deformation repo (src/rv_chord_geometry.py,
    compute_freewall_arc_sectors / sector_labels_from_freewall_arc) before
    being wired in here -- see that module for the exploratory history
    (three-chord method kept as unused reference code there, not deleted).

    Method, per slice:
      1. Trace the RV mask's own boundary contour (marching squares).
      2. Find the two "horns" (septal/free-wall hinge points) as the
         farthest pair ON THE CONTOUR -- continuity-matched against the
         previous slice's own horns (direction AND position) when
         `prev_axis`/`prev_horns` are given, so adjacent slices' horns don't
         drift ~30deg apart purely from independent per-slice noise. This
         was confirmed live to matter: without it, a segment's raw 2D source
         could be whole and connected on every single slice yet still split
         into 2 disconnected pieces once fused onto the 3D mesh.
      3. Split the closed contour at the two horns into two arcs; keep
         whichever sits farther along `septal_direction` from the centroid
         as the septal one (discard), the other is the free wall (keep).
      4. Cut the free-wall arc into thirds by ARC LENGTH (not a straight
         line), and assign every RV pixel to whichever third its nearest
         free-wall-arc point belongs to.
      5. Which end (horn_a-side vs horn_b-side) is "Seg1" vs "Seg3" is fixed
         by septal_direction's handedness (same role this module's old
         chord method used `d`'s cross product for) -- independent of
         prev_axis/prev_horns, so Seg1/Seg3 identity stays anatomically
         consistent slice-to-slice AND frame-to-frame/patient-to-patient,
         not just self-consistent within one arbitrary horn ordering.

    Returns (sector, new_axis, new_horns) to thread into the NEXT slice's own
    prev_axis/prev_horns, or None if this slice is too degenerate to cut
    (too few contour points, horns coincide, or a zero-length free-wall arc
    -- confirmed rare in practice, limited to near-circular apex-tip slices a
    few dozen pixels wide).
    """
    contour = _mask_boundary_contour(rv_mask)
    if contour is None or len(contour) < 3:
        return None

    diffs = contour[:, None, :] - contour[None, :, :]
    dist2 = np.einsum("ijk,ijk->ij", diffs, diffs)
    best_i, best_j = np.unravel_index(np.argmax(dist2), dist2.shape)
    if prev_axis is not None:
        cand_i, cand_j = np.where(dist2 >= 0.9 * dist2.max())
        cand_axes = contour[cand_j] - contour[cand_i]
        cand_norms = np.linalg.norm(cand_axes, axis=1, keepdims=True)
        valid = cand_norms[:, 0] > 1e-9
        if valid.any():
            cand_i, cand_j = cand_i[valid], cand_j[valid]
            cand_axes = cand_axes[valid] / cand_norms[valid]
            agreement = np.abs(cand_axes @ prev_axis)
            if prev_horns is not None:
                well_aligned = agreement > 0.95
                if well_aligned.any():
                    ci, cj = cand_i[well_aligned], cand_j[well_aligned]
                    pa, pb = prev_horns
                    d_direct = np.linalg.norm(contour[ci] - pa, axis=1) + np.linalg.norm(contour[cj] - pb, axis=1)
                    d_swapped = np.linalg.norm(contour[ci] - pb, axis=1) + np.linalg.norm(contour[cj] - pa, axis=1)
                    pos_score = np.minimum(d_direct, d_swapped)
                    k = np.argmin(pos_score)
                    best_i, best_j = ci[k], cj[k]
                else:
                    k = np.argmax(agreement)
                    best_i, best_j = cand_i[k], cand_j[k]
            else:
                k = np.argmax(agreement)
                best_i, best_j = cand_i[k], cand_j[k]
    ia, ib = best_i, best_j
    if ia > ib:
        ia, ib = ib, ia
    horn_a, horn_b = contour[ia], contour[ib]
    horn_axis = horn_b - horn_a
    horn_axis_norm = np.linalg.norm(horn_axis)
    if horn_axis_norm < 1e-9:
        return None
    horn_axis = horn_axis / horn_axis_norm

    arc_1 = contour[ia:ib + 1]
    arc_2 = np.concatenate([contour[ib:], contour[:ia + 1]])
    score_1 = (arc_1.mean(axis=0) - centroid) @ septal_direction
    score_2 = (arc_2.mean(axis=0) - centroid) @ septal_direction
    freewall_arc = arc_1 if score_1 < score_2 else arc_2

    seg_lengths = np.linalg.norm(np.diff(freewall_arc, axis=0), axis=1)
    cum_length = np.concatenate([[0.0], np.cumsum(seg_lengths)])
    total_length = cum_length[-1]
    if total_length < 1e-6:
        return None
    arc_length_fraction = cum_length / total_length

    pixel_diffs = rv_ij[:, None, :].astype(float) - freewall_arc[None, :, :]
    pixel_dist2 = np.einsum("ijk,ijk->ij", pixel_diffs, pixel_diffs)
    nearest = np.argmin(pixel_dist2, axis=1)
    pixel_fraction = arc_length_fraction[nearest]
    cut_lo, cut_hi = cut_fractions
    sector = np.where(pixel_fraction < cut_lo, 0, np.where(pixel_fraction < cut_hi, 1, 2))

    # Fixed Seg1/Seg3 identity (see docstring point 5): horn_a's side is Seg1
    # only when septal_direction's handedness agrees; otherwise flip (0<->2,
    # 1 unchanged) -- "2 - sector" does exactly that swap in one step.
    cross_a = septal_direction[0] * (horn_a - centroid)[1] - septal_direction[1] * (horn_a - centroid)[0]
    if cross_a <= 0:
        sector = 2 - sector

    # Guard against an empty middle band (same rationale as the old chord
    # method's guard -- see git history / rv_chord_geometry.py's docstring):
    # force the single pixel closest to the arc's own midpoint fraction into
    # Seg2 so every slice contributes at least one point to its level's
    # middle band.
    if not np.any(sector == 1):
        cut_mid = (cut_lo + cut_hi) / 2.0
        nearest_px = np.argmin(np.abs(pixel_fraction - cut_mid))
        sector[nearest_px] = 1

    return sector, horn_axis, (horn_a, horn_b)


def label_cpd9_from_raw_slices(
    nifti_path: str, frame_idx: int, mesh_vertices: np.ndarray,
) -> np.ndarray | None:
    """
    Returns one label in [1, 9] per mesh vertex (region_id = level*3 + sector + 1,
    matching _CPD9_LEVEL_NAMES order), or None if this frame's raw segmentation
    doesn't have enough valid RV slices to classify. Apex/base slice-order is
    resolved ONCE per nifti_path (from that file's own frame 0 / ED RV-area
    profile: the smaller-area end is apical) and cached, so which end is
    "apical" can't flip frame-to-frame due to per-frame area noise.

    Sector (Seg1/Seg2/Seg3) is computed by _freewall_arc_sector_labels: a
    free-wall arc-length cut, not the three-straight-chords geometry this
    function used before 2026-10 -- see that helper's docstring for the full
    method and why it replaced the chord cut.
    """
    try:
        arr, lps2world = _cpd9_load_frame_labelmap(nifti_path, frame_idx)
        info = _cpd9_slice_info(arr)
        valid = [s for s in info if s is not None]
        if len(valid) < 3:
            logger.warning(f"[CPD9] Only {len(valid)} valid RV slices in frame {frame_idx}; need >=3.")
            return None
        valid_sorted = sorted(valid, key=lambda s: s["z"])

        apex_at_start = _cpd9_apex_at_start_cache.get(nifti_path)
        if apex_at_start is None:
            ed_arr, _ = _cpd9_load_frame_labelmap(nifti_path, 0)
            ed_valid = sorted((s for s in _cpd9_slice_info(ed_arr) if s is not None), key=lambda s: s["z"])
            areas = np.array([s["rv_area"] for s in ed_valid])
            n_end = min(3, len(areas))
            apex_at_start = bool(areas[:n_end].mean() < areas[-n_end:].mean())
            _cpd9_apex_at_start_cache[nifti_path] = apex_at_start
        if not apex_at_start:
            valid_sorted = valid_sorted[::-1]

        n_valid = len(valid_sorted)
        ref_dirs: dict[int, np.ndarray] = {}
        for rank, s in enumerate(valid_sorted):
            u = rank / max(n_valid - 1, 1)
            # level numbers must match _CPD9_LEVEL_NAMES' order (Apical, Basal,
            # Mid -- the frontend's RV_SEGMENT_NAMES/RV_SEGMENT_PALETTE index
            # order, inherited from the old atlas's alphabetically-sorted
            # segment_names), not rank order -- so the base-ward third gets 1
            # and the middle third gets 2, not the other way round.
            s["level"] = 0 if u < 1 / 3 else (2 if u < 2 / 3 else 1)
            if s["lv_centroid_ij"] is not None:
                d = s["lv_centroid_ij"] - s["rv_centroid_ij"]
                n = np.linalg.norm(d)
                if n > 1e-6:
                    ref_dirs[rank] = d / n
        if not ref_dirs:
            logger.warning(f"[CPD9] No slice in frame {frame_idx} has both RV and LV; no septal reference.")
            return None
        known_ranks = np.array(sorted(ref_dirs.keys()))
        for rank in range(n_valid):
            if rank not in ref_dirs:
                ref_dirs[rank] = ref_dirs[int(known_ranks[np.argmin(np.abs(known_ranks - rank))])]

        points, region_id = [], []
        prev_axis, prev_horns = None, None  # threaded slice-to-slice, see _freewall_arc_sector_labels
        for rank, s in enumerate(valid_sorted):
            rv_ij = np.argwhere(s["rv_mask"])
            c = s["rv_centroid_ij"]
            d = ref_dirs[rank]  # septal direction

            cut = _freewall_arc_sector_labels(rv_ij, s["rv_mask"], c, d, prev_axis, prev_horns)
            if cut is None:
                # Too degenerate to cut (see _freewall_arc_sector_labels' docstring) --
                # skip this slice rather than guess; the nearest-neighbor fuse below
                # still labels the mesh from every other valid slice, and prev_axis/
                # prev_horns simply carry over unchanged to the next one.
                logger.warning(f"[CPD9] Frame {frame_idx}, slice z={s['z']}: degenerate for the "
                                "free-wall-arc cut; skipping this slice.")
                continue
            sector, prev_axis, prev_horns = cut

            region_id.append(s["level"] * 3 + sector + 1)

            cols, rows = rv_ij[:, 1].astype(float), rv_ij[:, 0].astype(float)
            homog = np.column_stack([cols, rows, np.full(len(rv_ij), s["z"], dtype=float), np.ones(len(rv_ij))])
            points.append((lps2world @ homog.T).T[:, :3])

        if not points:
            logger.warning(f"[CPD9] Frame {frame_idx}: every slice was degenerate for the free-wall-arc cut.")
            return None
        points = np.concatenate(points, axis=0)
        region_id = np.concatenate(region_id, axis=0)

        tree = cKDTree(points)
        _, nearest = tree.query(np.asarray(mesh_vertices, dtype=np.float64))
        mesh_region_id = region_id[nearest].astype(np.int16)

        if len(np.unique(mesh_region_id)) < 9:
            logger.warning(f"[CPD9] Frame {frame_idx}: only {len(np.unique(mesh_region_id))}/9 regions populated.")
        return mesh_region_id

    except Exception as exc:
        logger.warning(f"[CPD9] Frame {frame_idx} classification failed ({exc}).")
        return None


def cpd9_region_id_to_name(region_id: int) -> str:
    """1-9 -> e.g. 'Apical_Seg1', matching _CPD9_LEVEL_NAMES / segment_names convention."""
    level = _CPD9_LEVEL_NAMES[(region_id - 1) // 3]
    sector = (region_id - 1) % 3 + 1
    return f"{level}_Seg{sector}"
