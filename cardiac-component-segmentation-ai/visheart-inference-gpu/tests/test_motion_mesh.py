"""Tests for app/classes/motion_mesh.py (smooth heart motion for the landmark page).

A synthetic "heart": an ellipsoidal shell that contracts and relaxes over a cycle of 10 frames, meshed on its own in
every frame (marching cubes, so frames share no vertices, like the real 4D reconstruction), exported as GLB files in
a tar named like the reconstruction's own. Runs on CPU in a few seconds.

    pytest tests/test_motion_mesh.py                         (needs numpy, scipy, scikit-image, trimesh)
    python tests/test_motion_mesh.py                         (same checks without pytest, e.g. in the GPU container)
"""
from __future__ import annotations

import io
import os
import sys
import tarfile

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from app.classes.motion_mesh import (  # noqa: E402
    build_motion, decode_motion, encode_motion, frames_from_tar, motion_from_tar, read_glb,
)

FRAMES = 10
ED = 0
RADII = np.array([20.0, 15.0, 30.0])          # mm, x / y / z


def scale_at(frame: int) -> float:
    """Contracts to 85 % at mid-cycle and relaxes back: periodic, ED (frame 0) is the largest."""
    return 1.0 - 0.15 * np.sin(np.pi * frame / FRAMES) ** 2


def ellipsoid_mesh(frame: int) -> tuple[np.ndarray, np.ndarray]:
    from skimage import measure
    radii = RADII * scale_at(frame)
    grid = np.arange(-36.0, 36.5, 1.0)
    x, y, z = np.meshgrid(grid, grid, grid, indexing="ij")
    level = np.sqrt((x / radii[0]) ** 2 + (y / radii[1]) ** 2 + (z / radii[2]) ** 2) - 1.0
    vertices, faces, _, _ = measure.marching_cubes(level, 0.0, spacing=(1.0, 1.0, 1.0))
    return (vertices + grid[0]).astype(np.float32), faces.astype(np.uint32)


def surface_error(points: np.ndarray, frame: int) -> np.ndarray:
    """Approximate distance (mm) from points to the frame's true ellipsoid."""
    radii = RADII * scale_at(frame)
    r = np.sqrt(((points / radii) ** 2).sum(axis=1))
    return np.abs(r - 1.0) * radii.min()


def glb_bytes(vertices: np.ndarray, faces: np.ndarray) -> bytes:
    import trimesh
    return trimesh.Trimesh(vertices, faces, process=False).export(file_type="glb")


_TAR: bytes | None = None


def reconstruction_tar() -> bytes:
    """Ten frames of LV meshes named like the 4D reconstruction's own files, frame 00 marked _ED."""
    global _TAR
    if _TAR is None:
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w") as archive:
            for frame in range(FRAMES):
                name = f"case_4D_lv_frame{frame:02d}{'_ED' if frame == ED else ''}.glb"
                content = glb_bytes(*ellipsoid_mesh(frame))
                info = tarfile.TarInfo(name)
                info.size = len(content)
                archive.addfile(info, io.BytesIO(content))
        _TAR = buffer.getvalue()
    return _TAR


def test_read_glb_keeps_the_files_vertex_order():
    vertices, faces = ellipsoid_mesh(3)
    read_vertices, read_faces = read_glb(glb_bytes(vertices, faces))
    assert read_vertices.shape == vertices.shape
    assert np.allclose(read_vertices, vertices, atol=1e-5)
    assert np.array_equal(read_faces.reshape(-1, 3), faces)


def test_frames_from_tar_finds_every_frame_and_the_ed_frame():
    meshes, ed_frame = frames_from_tar(reconstruction_tar(), "lv")
    assert sorted(meshes) == list(range(FRAMES))
    assert ed_frame == ED
    assert frames_from_tar(reconstruction_tar(), "rv")[0] == {}      # other chamber's files only


def test_motion_follows_the_surface_and_keeps_ed_exact():
    data, summary = motion_from_tar(reconstruction_tar(), "lv")
    header, positions = decode_motion(data)
    ed_vertices, ed_faces = ellipsoid_mesh(ED)

    assert header["format"] == "visheart-motion"
    assert header["chamber"] == "lv"
    assert header["method"] == "ffd2"
    assert header["frames"] == list(range(FRAMES))
    assert header["edFrame"] == ED
    assert header["vertexCount"] == len(ed_vertices)              # the ED file's own vertices, nothing added
    assert header["triangleCount"] == len(ed_faces)
    assert positions.shape == (FRAMES, len(ed_vertices), 3)
    assert summary["vertexCount"] == len(ed_vertices)

    # ED is the reconstructed ED mesh itself (up to the int16 quantisation, ~0.001 mm here).
    assert np.abs(positions[ED] - ed_vertices).max() < 0.01

    # Every frame lies on that frame's own surface: the motion is real, not the ED shape repeated.
    for frame in range(FRAMES):
        error = surface_error(positions[frame], frame)
        assert error.mean() < 0.5, (frame, error.mean())
        assert np.percentile(error, 95) < 1.2, (frame, np.percentile(error, 95))
    mid = FRAMES // 2
    assert surface_error(positions[ED], mid).mean() > 2.0            # ED shape does not fit mid-cycle

    # Smooth in time: no frame-to-frame jumps beyond the true wall speed.
    steps = np.linalg.norm(np.diff(positions, axis=0), axis=2)
    assert steps.max() < 3.0, steps.max()
    assert summary["stats"]["foldedTriangles"] <= len(ed_faces) * 0.002


def test_jittery_reconstructions_do_not_crumple():
    """Like patient108: frames meshed at alternating resolutions, each slightly off (the 4D fit is per frame). The
    old per-vertex tracker drifted along the surface and folded (a visible dent); the smooth field must not."""
    from skimage import measure
    rng = np.random.default_rng(1)
    meshes = {}
    for frame in range(FRAMES):
        radii = RADII * scale_at(frame) * (1 + rng.normal(0, 0.02, 3))          # +-2 % per-frame shape jitter
        step = 1.0 if frame % 3 == 0 else 2.0                                      # 16k-ish vs 3k-ish vertices
        grid = np.arange(-36.0, 36.5, step)
        x, y, z = np.meshgrid(grid, grid, grid, indexing="ij")
        level = np.sqrt((x / radii[0]) ** 2 + (y / radii[1]) ** 2 + (z / radii[2]) ** 2) - 1.0
        v, f, _, _ = measure.marching_cubes(level, 0.0, spacing=(step, step, step))
        meshes[frame] = ((v + grid[0]).astype(np.float32), f.astype(np.uint32))
    result = build_motion(meshes, ED)
    assert result["stats"]["foldedAreaPercent"] < 0.1, result["stats"]
    assert result["stats"]["surfaceErrorMean"] < 1.0, result["stats"]
    steps = np.linalg.norm(np.diff(result["positions"], axis=0), axis=2)
    assert steps.max() < 3.0, steps.max()


def test_playback_loop_closes():
    """The cycle is smoothed as a loop: the last frame leads back into ED without a jump."""
    result = build_motion({frame: ellipsoid_mesh(frame) for frame in range(FRAMES)}, ED)
    positions = result["positions"]
    step = np.linalg.norm(np.diff(positions, axis=0), axis=2).mean(axis=1).max()
    wrap = np.linalg.norm(positions[0] - positions[-1], axis=1).mean()
    assert wrap <= step * 1.5, (wrap, step)
    assert result["stats"]["periodic"] is True


def test_missing_frames_are_filled_in():
    meshes = {frame: ellipsoid_mesh(frame) for frame in range(FRAMES) if frame not in (4, 7)}
    result = build_motion(meshes, ED)
    assert result["frames"] == list(range(FRAMES))
    assert result["stats"]["framesFilled"] == 2
    assert np.isfinite(result["positions"]).all()
    assert surface_error(result["positions"][4], 4).mean() < 1.0


def test_encode_decode_round_trip():
    rng = np.random.default_rng(0)
    positions = rng.uniform(-40, 60, size=(4, 50, 3)).astype(np.float32)
    result = {"frames": [2, 3, 4, 5], "edFrame": 3, "positions": positions, "vertexCount": 50,
              "triangleCount": 96, "stats": {"surfaceErrorMean": 0.1}}
    data = encode_motion(result, "rv")
    assert data[:4] == b"VHMO"
    assert (12 + int.from_bytes(data[8:12], "little")) % 4 == 0     # int16 data aligned for the browser
    header, decoded = decode_motion(data)
    assert header["frames"] == [2, 3, 4, 5] and header["edFrame"] == 3 and header["chamber"] == "rv"
    assert np.abs(decoded - positions).max() < 100 / 65535 + 1e-6


def test_bad_input_is_a_value_error():
    for call in (
        lambda: motion_from_tar(b"not a tar file"),
        lambda: build_motion({0: ellipsoid_mesh(0), 1: ellipsoid_mesh(1)}),
        lambda: decode_motion(b"XXXX" + bytes(8)),
    ):
        try:
            call()
        except ValueError:
            continue
        raise AssertionError("expected ValueError")


if __name__ == "__main__":
    import time
    failures = 0
    for name, test in [(k, v) for k, v in dict(globals()).items() if k.startswith("test_") and callable(v)]:
        start = time.time()
        try:
            test()
            print(f"PASS {name} ({time.time() - start:.1f}s)")
        except Exception as error:  # noqa: BLE001 - report every failure, then exit non-zero
            failures += 1
            print(f"FAIL {name}: {type(error).__name__}: {error}")
    sys.exit(1 if failures else 0)
