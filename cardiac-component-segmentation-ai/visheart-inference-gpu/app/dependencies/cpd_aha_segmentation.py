"""
CPD-based AHA-17 boundary classification.

aha_segmentation_3d.classify_vertices_to_aha17() assigns every mesh vertex a segment
using fixed ring-height/angle cutoffs - the same cutoffs for every patient, so segment
BOUNDARIES aren't patient-specific even though the mesh itself is real.

This module instead warps a real-patient LV atlas onto each patient's own mesh with
CPD (pycpd.DeformableRegistration) and transfers the atlas's own labels via nearest
neighbor after warping - same method as v5_deform.ipynb. Only the classification step
changes: mesh generation, the metadata-JSON label channel, and the frontend all consume
classify_vertices_to_aha17_cpd()'s output exactly like they consumed the fixed-rule
function's output before.

Scope: one shape per patient. CPD runs once against a single reference frame, matching
how this pipeline already only classifies a single ED frame (not per-frame).
"""
from __future__ import annotations

import glob
import logging
import os

import numpy as np
import trimesh
from pycpd import DeformableRegistration
from scipy.spatial import cKDTree

from aha_segmentation_3d import classify_vertices_to_aha17

logger = logging.getLogger("visheart")

_ATLAS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models", "atlas")
_ATLAS_ZONES = ["AnteriorLV", "SeptalLV", "LateralLV", "InferiorPosteriorLV"]
# Same anchor v5_deform.ipynb used to fix the atlas's rotation, kept for consistency.
_ANCHOR_ZONE = "AnteriorLV"
_ANCHOR_FILE = "MM628_BP52011_FMA9560_Anterior.obj"

_CPD_BETA = 1.5
_CPD_LAMBDA = 10.0
_CPD_MAX_ITER = 30
_MAX_TARGET_POINTS = 3000  # CPD is O(N*M)/iteration; subsample the patient cloud for registration
# pycpd's DeformableRegistration builds a dense (M, M) Gaussian kernel over the SOURCE
# (atlas) point count alone, independent of the target size above - at the full raw
# atlas vertex count (~26k across all 17 files) this is a >2.5 GiB float64 array and
# reliably fails to allocate. The REGISTRATION step uses a capped subsample of the
# atlas; the (cheaper, linear-in-N) field-extension step below then applies the learned
# warp to the full dense atlas for label-lookup resolution.
_MAX_REGISTRATION_POINTS = 2000
# Chunk size for the dense field-extension step (see _apply_cpd_field), so peak memory
# is bounded by a chunk x _MAX_REGISTRATION_POINTS matrix, not the full dense count x
# _MAX_REGISTRATION_POINTS at once.
_DENSE_FIELD_CHUNK = 4000
# Candidate Z-axis rotations tried before the expensive CPD step - see
# _find_best_rigid_rotation. 72 candidates = 5-degree steps. Bumped up from 12
# (30-degree steps): measured on a real reconstruction, most remaining failures
# were near-misses (16/17, missing just segment 4) rather than the original
# systemic half-heart failure - a sign the right angle might sit between the
# coarser candidates rather than being fundamentally unreachable by rotation.
_Z_ROTATION_CANDIDATES = 72

_atlas_cache: dict | None = None


def _rotation_matrix_from_vectors(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Rotation matrix that maps unit vector a onto unit vector b. Ported from v5_deform.ipynb."""
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


def _apply_cpd_field(vertices: np.ndarray, Y: np.ndarray, W: np.ndarray, beta: float, chunk_size: int = _DENSE_FIELD_CHUNK) -> np.ndarray:
    """
    Apply a fitted CPD deformation field (Y, W, beta from a DeformableRegistration) to
    arbitrary points - v5_deform.ipynb's apply_cpd_field(), used there to extend the
    field learned on a sample to the atlas's full dense vertex set.

    Computed as an (N, M) squared-distance matrix rather than the notebook's (N, M, 3)
    elementwise-difference array (mathematically identical, ~3x less memory), and
    chunked over N so peak memory is bounded by chunk_size x len(Y) regardless of how
    many dense points are passed in.
    """
    Y_sq = np.sum(Y ** 2, axis=1)  # (M,)
    out = np.empty_like(vertices)
    for start in range(0, vertices.shape[0], chunk_size):
        chunk = vertices[start:start + chunk_size]
        sq_dists = (
            np.sum(chunk ** 2, axis=1)[:, None] + Y_sq[None, :] - 2.0 * chunk @ Y.T
        )
        np.maximum(sq_dists, 0, out=sq_dists)  # guard tiny negative values from float error
        G = np.exp(-sq_dists / (2 * beta ** 2))
        out[start:start + chunk_size] = chunk + G @ W
    return out


def _load_canonical_atlas() -> dict:
    """
    Build the atlas point clouds once: load the 4 LV zone folders' FULL (unsampled)
    vertices, align them into the same canonical frame classify_vertices_to_aha17()
    expects (apex toward -Z, centroid at the origin, scaled to a unit envelope -
    mirroring v5_deform.ipynb's own atlas normalization), then run the EXISTING
    fixed-rule classifier on the combined dense cloud ONE TIME to get the atlas's own
    ground-truth 17 labels.

    Returns both:
    - "dense_points"/"dense_labels": every atlas vertex (~26k) - used for the
      post-registration field extension and final nearest-neighbor label lookup.
    - "reg_points": a capped subsample of the dense cloud - used as CPD's source (Y)
      during registration, where cost is quadratic in point count.
    """
    all_points: list[np.ndarray] = []
    anchor_centroid = None

    for zone in _ATLAS_ZONES:
        zone_dir = os.path.join(_ATLAS_DIR, zone)
        for obj_path in sorted(glob.glob(os.path.join(zone_dir, "*.obj"))):
            mesh = trimesh.load(obj_path, force="mesh", process=False)
            vertices = np.asarray(mesh.vertices, dtype=np.float64)
            all_points.append(vertices)
            if zone == _ANCHOR_ZONE and os.path.basename(obj_path) == _ANCHOR_FILE:
                anchor_centroid = vertices.mean(axis=0)

    if anchor_centroid is None:
        raise RuntimeError(f"Atlas anchor file {_ANCHOR_FILE!r} not found under {_ATLAS_DIR}")
    if not all_points:
        raise RuntimeError(f"No atlas OBJ files found under {_ATLAS_DIR}")

    dense_points = np.concatenate(all_points, axis=0)

    # 1. Centre on the combined centroid (matches v5_deform.ipynb's global_mean_center step)
    global_centroid = dense_points.mean(axis=0)
    dense_points = dense_points - global_centroid
    anchor_centroid = anchor_centroid - global_centroid

    # 2. Rotate the anchor piece's centroid onto -Z. aha_segmentation_3d.py assumes
    #    APEX_AT_POSITIVE_Z = False (apex toward -Z), same convention v5_deform.ipynb
    #    aligned the atlas to.
    v = anchor_centroid / np.linalg.norm(anchor_centroid)
    target = np.array([0.0, 0.0, -1.0])
    rotation = _rotation_matrix_from_vectors(v, target)
    dense_points = dense_points @ rotation.T

    # 3. Normalize to a unit envelope. Rescaled per-patient at classification time (see
    #    classify_vertices_to_aha17_cpd) to match that patient's own point-cloud scale.
    scale = np.max(np.abs(dense_points))
    dense_points = dense_points / scale

    dense_labels = classify_vertices_to_aha17(dense_points)

    if dense_points.shape[0] > _MAX_REGISTRATION_POINTS:
        reg_idx = np.random.default_rng(0).choice(dense_points.shape[0], _MAX_REGISTRATION_POINTS, replace=False)
        reg_points = dense_points[reg_idx]
    else:
        reg_points = dense_points

    return {
        "dense_points": dense_points,
        "dense_labels": dense_labels,
        "reg_points": reg_points,
    }


def _get_atlas() -> dict:
    """Lazily compute and cache the canonical atlas. Runs once per process, not per patient."""
    global _atlas_cache
    if _atlas_cache is None:
        _atlas_cache = _load_canonical_atlas()
        logger.info(
            f"[CPD-AHA] Cached canonical atlas: {_atlas_cache['dense_points'].shape[0]} dense points "
            f"({_atlas_cache['reg_points'].shape[0]} used for registration), "
            f"{len(np.unique(_atlas_cache['dense_labels']))} unique segment labels"
        )
    return _atlas_cache


def _rotation_matrix_z(angle_deg: float) -> np.ndarray:
    """3x3 rotation matrix for a rotation of angle_deg about the Z axis - the
    apex-base axis both the atlas and every patient mesh are already aligned to."""
    theta = np.radians(angle_deg)
    c, s = np.cos(theta), np.sin(theta)
    return np.array([
        [c, -s, 0.0],
        [s,  c, 0.0],
        [0.0, 0.0, 1.0],
    ])


def _find_best_rigid_rotation(
    dense_points: np.ndarray, dense_labels: np.ndarray, target_points: np.ndarray,
    n_candidates: int = _Z_ROTATION_CANDIDATES,
) -> tuple[np.ndarray, int]:
    """
    Picks a starting Z-rotation for the atlas by the metric that actually matters -
    how many of the 17 segments populate after label transfer - not by raw shape
    overlap (tried and disproven: the LV is a smooth, near-symmetric blob, so a
    shape-distance metric can't tell "correctly septal-aligned" from "30 degrees
    off" - many wrong rotations score just as well as the right one on shape alone).

    Cheap by construction: RIGID nearest-neighbor label lookup only (rotate the
    dense atlas, build a tree, query) - no deformable registration per candidate.
    The winning angle then seeds the one real, expensive CPD registration, so total
    added cost is K cheap rigid checks, not K expensive registrations.

    Returns (rotation_matrix, populated_count) for the best candidate found.
    """
    best_rotation = np.eye(3)
    best_populated = -1
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

    return best_rotation, best_populated


def register_cpd_warp(mesh_points_canonical: np.ndarray) -> dict | None:
    """
    The EXPENSIVE half of CPD classification: registers the cached, pre-labeled
    atlas onto this mesh with CPD and extends the learned field to the atlas's full
    dense vertex set (v5_deform.ipynb's apply_cpd_field approach). Returns a warp
    state dict for label_with_warp() to reuse CHEAPLY on other frames.

    Reuse is valid across every frame of the SAME reconstruction, not just an
    approximation specific to whichever frame registered first: all frames share one
    shape latent code decoded through the same canonical coordinate space, so a warp
    fitted against any one frame's point cloud applies equally to the others - only
    the frame's own vertex positions differ, not the coordinate frame they live in.

    Returns None on failure (missing atlas, degenerate input, etc) - callers should
    fall back to the fixed-rule classifier.
    """
    pts = np.asarray(mesh_points_canonical, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 3 or pts.shape[0] == 0:
        return None

    try:
        atlas = _get_atlas()

        # Match the atlas's unit-envelope scale to this patient's own point cloud so
        # CPD's beta/lambda (tuned in v5_deform.ipynb on comparably-scaled clouds)
        # behave consistently regardless of this pipeline's absolute coordinate scale.
        patient_scale = np.max(np.abs(pts))
        reg_points_scaled = atlas["reg_points"] * patient_scale
        dense_points_scaled = atlas["dense_points"] * patient_scale

        if pts.shape[0] > _MAX_TARGET_POINTS:
            idx = np.random.default_rng(0).choice(pts.shape[0], _MAX_TARGET_POINTS, replace=False)
            target_sample = pts[idx]
        else:
            target_sample = pts

        # Rigid pre-alignment, scored by the metric that actually matters (segment
        # population after label transfer), not raw shape distance - see
        # _find_best_rigid_rotation for why the shape-distance version of this
        # (tried previously) didn't work. Cheap: only rigid nearest-neighbor checks,
        # no deformable registration yet.
        best_rotation, best_populated = _find_best_rigid_rotation(
            dense_points_scaled, atlas["dense_labels"], target_sample,
        )
        logger.info(
            f"[CPD-AHA] Rigid pre-alignment: best candidate populated {best_populated}/17 "
            f"segments before the deformable step."
        )
        reg_points_scaled = reg_points_scaled @ best_rotation.T
        dense_points_scaled = dense_points_scaled @ best_rotation.T

        reg = DeformableRegistration(
            X=target_sample, Y=reg_points_scaled,
            beta=_CPD_BETA, lamb=_CPD_LAMBDA, max_iterations=_CPD_MAX_ITER,
        )
        reg.register()

        # Extend the learned field from the registration sample to the FULL dense
        # atlas vertex set - this is what gives fine-grained boundary resolution
        # rather than being limited to the ~2000-point registration cap.
        warped_dense_atlas = _apply_cpd_field(dense_points_scaled, reg.Y, reg.W, reg.beta)

        return {"warped_dense_atlas": warped_dense_atlas, "dense_labels": atlas["dense_labels"]}

    except Exception as exc:
        logger.warning(f"[CPD-AHA] CPD registration failed ({exc}).")
        return None


def label_with_warp(mesh_points_canonical: np.ndarray, warp_state: dict) -> np.ndarray | None:
    """
    The CHEAP half: nearest-neighbor label lookup against an already-warped atlas
    from register_cpd_warp(). No new (expensive) deformable registration - this is
    what makes per-frame labeling affordable across a multi-frame reconstruction.

    Includes a cheap PER-FRAME rigid re-check (same idea as register_cpd_warp's
    pre-alignment, applied to the already-warped atlas instead of the raw one):
    measured on a real reconstruction, frames of the SAME 4D sequence do not all
    share the exact orientation the shared warp was fitted against - some frames
    hit the old full failure signature (9/17, same 8 segments) even on a warp that
    gave 17/17 for the frame it was registered on. Re-running the cheap rotation
    search per frame (rotate the already-warped atlas, no new deformable fit) fixed
    most of those without paying for a fresh ~28s registration per frame.

    Returns None if label transfer leaves any of the 17 segments empty even after
    the per-frame re-check, so a degenerate frame can't silently ship worse
    boundaries than the fixed-rule fallback would.
    """
    pts = np.asarray(mesh_points_canonical, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 3 or pts.shape[0] == 0:
        return None

    try:
        best_rotation, rigid_check_populated = _find_best_rigid_rotation(
            warp_state["warped_dense_atlas"], warp_state["dense_labels"], pts,
        )
        # DIAGNOSTIC: show what the per-frame search actually found, so a repeat
        # failure is distinguishable from "search didn't run" vs "search ran and
        # genuinely found nothing better within the candidate angles tried."
        logger.info(f"[CPD-AHA] Per-frame rigid re-check: best candidate populated {rigid_check_populated}/17.")
        rotated_warped_atlas = warp_state["warped_dense_atlas"] @ best_rotation.T

        tree = cKDTree(rotated_warped_atlas)
        _, nearest_idx = tree.query(pts)
        labels = warp_state["dense_labels"][nearest_idx].astype(np.int16)

        n_populated = len(np.unique(labels))
        if n_populated < 17:
            # DIAGNOSTIC: log per-segment counts before discarding this result, so a
            # failure is actually debuggable instead of just "9/17, fell back".
            unique, counts = np.unique(labels, return_counts=True)
            populated_set = set(unique.tolist())
            missing = sorted(set(range(1, 18)) - populated_set)
            counts_str = ", ".join(f"{seg}:{cnt}" for seg, cnt in zip(unique.tolist(), counts.tolist()))
            logger.warning(
                f"[CPD-AHA] Reused-warp label transfer only populated {n_populated}/17 segments. "
                f"Populated counts=[{counts_str}]  Missing segments={missing}"
            )
            return None

        return labels

    except Exception as exc:
        logger.warning(f"[CPD-AHA] Reused-warp labeling failed ({exc}).")
        return None


def classify_vertices_to_aha17_cpd(mesh_points_canonical: np.ndarray) -> np.ndarray:
    """
    Single-call convenience wrapper: register + label in one step, falling back to
    the fixed-rule classifier on any failure. Kept for standalone/one-off use (e.g.
    _validate_cpd_aha.py). A multi-frame reconstruction should call
    register_cpd_warp() ONCE and label_with_warp() per frame instead - calling this
    function per frame re-registers from scratch every time (~28s each).
    """
    pts = np.asarray(mesh_points_canonical, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 3:
        raise ValueError(f"Expected mesh_points_canonical of shape (N, 3), got {pts.shape}")
    if pts.shape[0] == 0:
        return classify_vertices_to_aha17(pts)

    warp_state = register_cpd_warp(pts)
    if warp_state is None:
        logger.warning("[CPD-AHA] CPD registration failed; falling back to fixed-rule classification.")
        return classify_vertices_to_aha17(pts)

    labels = label_with_warp(pts, warp_state)
    if labels is None:
        logger.warning("[CPD-AHA] CPD label transfer failed; falling back to fixed-rule classification.")
        return classify_vertices_to_aha17(pts)

    return labels
