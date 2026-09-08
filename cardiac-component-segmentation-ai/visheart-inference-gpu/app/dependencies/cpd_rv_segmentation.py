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
  2. An added long-axis (PCA) pre-alignment stage before LV's proven Z-rotation
     search. rv_deform.py's own README documents the Zenodo atlas and a real
     patient mesh differing by 139 degrees in signed apicobasal-axis direction --
     not just azimuthal drift, the axis itself can be wrong. LV's atlas/patient
     meshes never showed that failure mode (same DeepSDF training convention on
     both sides), so LV's search only ever needed to correct ROTATION AROUND an
     already-correct Z axis. Since this reconstruction pipeline's RV meshes are a
     new, untested source for this atlas, both stages are included: long-axis
     alignment first (in case the axis itself is off, as it was for rv_deform.py's
     cross-source Zenodo/ACDC case), then the existing Z-rotation-about-that-axis
     search (for residual azimuthal drift, which rv_deform.py's own docs flag as
     an uncorrected limitation of its own pipeline).

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
# Coarser than LV's 72 (5-degree steps): RV has 9 segments to LV's 17, so there is
# less to distinguish between nearby candidate angles, and this pipeline has not
# been measured yet to justify LV's finer search cost. Revisit if real
# reconstructions show near-miss failures the way LV's did before it went 12 -> 72.
_Z_ROTATION_CANDIDATES = 36


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

    return {
        "dense_points": dense_points,
        "dense_labels": dense_labels,
        "reg_points": reg_points,
        "segment_names": segment_names,
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
) -> tuple[np.ndarray, int]:
    """
    Picks a starting Z-rotation for the atlas by how many of the 9 segments
    populate after label transfer -- not by raw shape overlap, which can't
    distinguish a correctly-aligned RV from one rotated some way around its own
    long axis (same reasoning as LV's cpd_aha_segmentation._find_best_rigid_
    rotation, which this is ported from almost verbatim).

    Cheap: rigid nearest-neighbor label lookup only, no deformable registration
    per candidate -- the winning angle seeds the one real CPD registration.
    """
    best_rotation = np.eye(3)
    best_populated = -1
    n_segments = len(np.unique(dense_labels))
    for angle_deg in np.linspace(0, 360, n_candidates, endpoint=False):
        rotation = _rotation_matrix_z(angle_deg)
        rotated_dense = dense_points @ rotation.T
        tree = cKDTree(rotated_dense)
        _, nearest_idx = tree.query(target_points)
        labels = dense_labels[nearest_idx]
        populated = len(np.unique(labels))
        if populated > best_populated:
            best_populated = populated
            best_rotation = rotation
        if populated == n_segments:
            break
    return best_rotation, best_populated


def register_cpd_warp(mesh_points_canonical: np.ndarray) -> dict | None:
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

    Returns None on failure (missing atlas, degenerate input, etc) -- callers
    should treat RV segmentation as unavailable for this reconstruction, same
    as classify_aha=False upstream.
    """
    pts = np.asarray(mesh_points_canonical, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 3 or pts.shape[0] == 0:
        return None

    try:
        atlas = _get_atlas()

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
        pts_axis_aligned = pts @ best_axis_rotation.T

        # --- Stage 2: Z-rotation search (residual azimuthal correction) ----
        best_rotation, best_populated = _find_best_rigid_rotation(
            dense_points_scaled, atlas["dense_labels"], target_axis_aligned,
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
        }

    except Exception as exc:
        logger.warning(f"[CPD-RV] CPD registration failed ({exc}).")
        return None


def label_with_warp(mesh_points_canonical: np.ndarray, warp_state: dict) -> np.ndarray | None:
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
        pts_aligned = pts @ warp_state["axis_rotation"].T

        best_rotation, rigid_check_populated = _find_best_rigid_rotation(
            warp_state["warped_dense_atlas"], warp_state["dense_labels"], pts_aligned,
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

        return labels

    except Exception as exc:
        logger.warning(f"[CPD-RV] Reused-warp labeling failed ({exc}).")
        return None


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
