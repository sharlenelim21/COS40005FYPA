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


def classify_vertices_to_aha17_cpd(mesh_points_canonical: np.ndarray) -> np.ndarray:
    """
    Patient-adaptive replacement for classify_vertices_to_aha17(): registers the
    cached, pre-labeled atlas onto this patient's own mesh with CPD, extends the
    learned field to the atlas's full dense vertex set (v5_deform.ipynb's
    apply_cpd_field approach), then assigns each patient vertex the label of its
    nearest warped dense-atlas point (nearest-neighbor after warping).

    One CPD run for this single mesh (ED frame) - not per-frame.

    Falls back to the fixed-rule classifier if CPD fails, or if label transfer leaves
    any of the 17 segments empty, so a bad registration can't silently produce worse
    boundaries than the rule it's replacing.
    """
    pts = np.asarray(mesh_points_canonical, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 3:
        raise ValueError(f"Expected mesh_points_canonical of shape (N, 3), got {pts.shape}")
    if pts.shape[0] == 0:
        return classify_vertices_to_aha17(pts)

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

        reg = DeformableRegistration(
            X=target_sample, Y=reg_points_scaled,
            beta=_CPD_BETA, lamb=_CPD_LAMBDA, max_iterations=_CPD_MAX_ITER,
        )
        reg.register()

        # Extend the learned field from the registration sample to the FULL dense
        # atlas vertex set - this is what gives fine-grained boundary resolution
        # rather than being limited to the ~2000-point registration cap.
        warped_dense_atlas = _apply_cpd_field(dense_points_scaled, reg.Y, reg.W, reg.beta)

        tree = cKDTree(warped_dense_atlas)
        _, nearest_idx = tree.query(pts)
        labels = atlas["dense_labels"][nearest_idx].astype(np.int16)

        n_populated = len(np.unique(labels))
        if n_populated < 17:
            logger.warning(
                f"[CPD-AHA] CPD label transfer only populated {n_populated}/17 segments; "
                "falling back to fixed-rule classification."
            )
            return classify_vertices_to_aha17(pts)

        return labels

    except Exception as exc:
        logger.warning(f"[CPD-AHA] CPD classification failed ({exc}); falling back to fixed-rule classification.")
        return classify_vertices_to_aha17(pts)
