from __future__ import annotations

import numpy as np

from bullseye_analysis import AHA_SEGMENTS

VM1 = np.array([0.0, 0.0, 1.0])
VM2 = np.array([0.993, 0.120, 0.0])
_SEPTAL_REF_ANGLE_DEG = float(np.degrees(np.arctan2(VM2[1], VM2[0])))

APEX_AT_POSITIVE_Z = False
ANGLE_SIGN = 1.0

_APEX_END = 0.10
_APICAL_END = 0.40
_MID_END = 0.70

_RING_BASAL, _RING_MID, _RING_APICAL, _RING_APEX = 0, 1, 2, 3


def classify_vertices_to_aha17(mesh_points_canonical: np.ndarray) -> np.ndarray:
    pts = np.asarray(mesh_points_canonical, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 3:
        raise ValueError(f"Expected mesh_points_canonical of shape (N, 3), got {pts.shape}")

    n = pts.shape[0]
    if n == 0:
        return np.zeros((0,), dtype=np.int16)

    z = pts[:, 2] if APEX_AT_POSITIVE_Z else -pts[:, 2]
    z_min, z_max = float(z.min()), float(z.max())
    z_range = z_max - z_min
    z_frac = np.zeros(n) if z_range < 1e-9 else (z - z_min) / z_range

    angles_deg = np.degrees(np.arctan2(pts[:, 1], pts[:, 0])) * ANGLE_SIGN
    angles_deg = (angles_deg - _SEPTAL_REF_ANGLE_DEG) % 360.0

    vertex_ring = np.empty(n, dtype=np.int8)
    vertex_ring[z_frac < _APEX_END] = _RING_APEX
    vertex_ring[(z_frac >= _APEX_END) & (z_frac < _APICAL_END)] = _RING_APICAL
    vertex_ring[(z_frac >= _APICAL_END) & (z_frac < _MID_END)] = _RING_MID
    vertex_ring[z_frac >= _MID_END] = _RING_BASAL

    labels = np.zeros(n, dtype=np.int16)
    for seg in AHA_SEGMENTS:
        ring = seg["ring"]
        in_ring = vertex_ring == ring
        if not np.any(in_ring):
            continue

        t1, t2 = seg["t1"], seg["t2"]
        span = t2 - t1
        t1n = t1 % 360.0

        idxs = np.nonzero(in_ring)[0]
        delta = (angles_deg[idxs] - t1n) % 360.0
        in_segment = delta < span
        labels[idxs[in_segment]] = seg["idx"]

    unassigned = labels == 0
    if np.any(unassigned):
        labels[unassigned] = 17

    return labels
