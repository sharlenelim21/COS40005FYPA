"""Smooth heart motion for the landmark page: carry the end-diastole mesh through every frame.

The 4D reconstruction (fourdreconstruction_handler.py) writes one mesh per frame, each fitted and meshed on its own,
so frames share no vertices: the landmark page swaps whole meshes during playback (flicker), needs AHA labels for
every frame, and re-derives the orientation from each frame's labels. This module takes those per-frame meshes and
returns the END-DIASTOLE mesh's own vertices moved onto every frame, in the ED file's exact vertex order. The page
keeps loading the ED mesh, its ED AHA labels and its ED orientation, and only moves the vertices.

Method (CPU only, numpy + scipy; prototype: Jy's heart_motion_4d notebook, 2026-10-14; method and settings chosen
on patient108's real LV/RV reconstruction, 2026-10-15):
  1. each frame's mesh becomes a distance field on one shared grid (surface voxels, then a Euclidean distance
     transform; signed where the surface encloses a volume);
  2. the ED mesh is carried onto each frame by ONE smooth displacement field over the whole heart (cubic B-splines
     on a ~6 mm control grid): points of the ED mesh are pulled onto the frame's surface along the field's gradient,
     and the displacement field is refitted to them with a smoothness and a small pull-back term, a few times. A
     smooth field cannot crumple the surface or let points drift along it, which per-vertex tracking did on real,
     frame-to-frame jittery reconstructions (patient108: 1,472 folded LV triangles and a visible dent; now none);
  3. every frame is fitted from ED on its own (not from the previous frame), so one collapsed reconstruction frame
     cannot crush the mesh for the frames after it;
  4. the field is smoothed over time as one closed cardiac cycle (Gaussian, 5 % of the cycle = 1.5 frames at 30
     frames, wrapping from the last frame back to ED), which removes the frame-to-frame jitter of independently
     fitted meshes and the jump when playback loops; the ED frame stays exactly the reconstructed ED mesh.
     Chosen by Jy (2026-10-16) from a side-by-side of 0.75 frame / 1.5 frames / 1.5 frames closed on patient108 UNet.

Output (encode_motion): b"VHMO", version, a JSON header (frame numbers, vertex count, quantisation), then int16
positions for every frame and vertex. Motion along the surface (twist, base descent) is not observed: the field moves
the surface onto each frame's surface by the smoothest way it can.
"""
from __future__ import annotations

import io
import json
import re
import struct
import tarfile
import time

import numpy as np
from scipy import ndimage, sparse
from scipy.sparse.linalg import splu

FORMAT_VERSION = 1
METHOD = "ffd2"          # the backend names the file after it (reconstruction_motion.ts MOTION_SUFFIX): change both
FRAME_NAME = re.compile(r"frame[_\s-]*(\d+)", re.IGNORECASE)   # the frontend's own rule (reconstruction-cache.ts)


# --- reading meshes -----------------------------------------------------------------------------------------------
_COMPONENTS = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(data: bytes) -> tuple[np.ndarray, np.ndarray]:
    """Vertices and triangles of the first mesh's first primitive, in the file's own vertex order: the order three.js's
    GLTFLoader gives the page, which the AHA labels index. Node transforms are ignored, as the page ignores them when it
    labels and aligns the geometry."""
    magic, version, _ = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67 or version != 2:
        raise ValueError("not a glTF 2.0 binary")
    offset, document, blob = 12, None, b""
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        chunk = data[offset + 8: offset + 8 + length]
        if kind == 0x4E4F534A:
            document = json.loads(chunk)
        elif kind == 0x004E4942:
            blob = chunk
        offset += 8 + length
    if document is None or not document.get("meshes"):
        raise ValueError("no mesh in the glTF file")
    primitive = document["meshes"][0]["primitives"][0]
    if primitive.get("mode", 4) != 4:
        raise ValueError("only triangle meshes are supported")

    def accessor(index: int) -> np.ndarray:
        acc = document["accessors"][index]
        view = document["bufferViews"][acc["bufferView"]]
        dtype = np.dtype(_COMPONENTS[acc["componentType"]])
        width = _WIDTH[acc["type"]]
        start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stride = view.get("byteStride") or dtype.itemsize * width
        count = acc["count"]
        if stride == dtype.itemsize * width:
            values = np.frombuffer(blob, dtype=dtype, count=count * width, offset=start)
        else:
            raw = np.frombuffer(blob, dtype=np.uint8, count=stride * (count - 1) + dtype.itemsize * width, offset=start)
            values = np.lib.stride_tricks.as_strided(raw, shape=(count, dtype.itemsize * width), strides=(stride, 1))
            values = np.ascontiguousarray(values).view(dtype)
        return values.reshape(count, width) if width > 1 else values.reshape(count)

    vertices = accessor(primitive["attributes"]["POSITION"]).astype(np.float64)
    if "indices" in primitive:
        faces = accessor(primitive["indices"]).astype(np.int64).reshape(-1, 3)
    else:
        faces = np.arange(len(vertices), dtype=np.int64).reshape(-1, 3)
    return vertices, faces


def read_obj(text: str) -> tuple[np.ndarray, np.ndarray]:
    vertices, faces = [], []
    for line in text.splitlines():
        if line.startswith("v "):
            vertices.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("f "):
            corners = [int(token.split("/")[0]) for token in line.split()[1:]]
            corners = [c - 1 if c > 0 else len(vertices) + c for c in corners]
            faces.extend([corners[0], corners[k], corners[k + 1]] for k in range(1, len(corners) - 1))
    return np.asarray(vertices, dtype=np.float64), np.asarray(faces, dtype=np.int64)


def frames_from_tar(data: bytes, chamber: str | None = None) -> tuple[dict, int | None]:
    """{frame number: (vertices, faces)} from a reconstruction tar, and the ED frame (the file marked _ED)."""
    meshes, ed_frame = {}, None
    try:
        archive = tarfile.open(fileobj=io.BytesIO(data))
    except tarfile.TarError as error:
        raise ValueError(f"not a reconstruction archive ({error})") from error
    with archive:
        for member in archive.getmembers():
            name = member.name.rsplit("/", 1)[-1]
            if not member.isfile() or not name.lower().endswith((".glb", ".obj")):
                continue
            if chamber and f"_{chamber.lower()}_" not in name.lower():
                continue
            match = FRAME_NAME.search(name)
            if not match:
                continue
            frame = int(match.group(1))
            content = archive.extractfile(member).read()
            meshes[frame] = read_glb(content) if name.lower().endswith(".glb") else read_obj(content.decode("utf-8"))
            if re.search(r"_ED\.(glb|obj)$", name, re.IGNORECASE):
                ed_frame = frame
    return meshes, ed_frame


# --- distance fields ----------------------------------------------------------------------------------------------
class Field:
    """A distance field on a regular grid: values[i, j, k] at origin + (i, j, k) * pitch, in the meshes' units."""

    def __init__(self, values: np.ndarray, origin: np.ndarray, pitch: float):
        self.values = values.astype(np.float32)
        self.origin = origin
        self.pitch = pitch
        self.gradient = np.stack(np.gradient(self.values, pitch), axis=0)

    def coordinates(self, points: np.ndarray) -> np.ndarray:
        return ((points - self.origin) / self.pitch).T

    def distance(self, points: np.ndarray) -> np.ndarray:
        return ndimage.map_coordinates(self.values, self.coordinates(points), order=1, mode="nearest")

    def grad(self, points: np.ndarray) -> np.ndarray:
        c = self.coordinates(points)
        return np.stack([ndimage.map_coordinates(g, c, order=1, mode="nearest") for g in self.gradient], axis=1)


def surface_points(vertices: np.ndarray, faces: np.ndarray, spacing: float) -> np.ndarray:
    """Points spread over every triangle no further apart than `spacing` (barycentric grids per triangle)."""
    a, b, c = vertices[faces[:, 0]], vertices[faces[:, 1]], vertices[faces[:, 2]]
    longest = np.maximum.reduce([np.linalg.norm(b - a, axis=1), np.linalg.norm(c - b, axis=1),
                                 np.linalg.norm(a - c, axis=1)])
    steps = np.clip(np.ceil(longest / spacing).astype(int), 1, 64)
    points = [vertices]
    for n in np.unique(steps):
        chosen = steps == n
        i, j = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")
        keep = (i + j) <= n
        u, v = i[keep] / n, j[keep] / n
        w = 1 - u - v
        pa, pb, pc = a[chosen], b[chosen], c[chosen]
        points.append((pa[:, None, :] * w[None, :, None] + pb[:, None, :] * u[None, :, None]
                       + pc[:, None, :] * v[None, :, None]).reshape(-1, 3))
    return np.concatenate(points)


def mesh_field(vertices: np.ndarray, faces: np.ndarray, origin: np.ndarray, shape: tuple, pitch: float,
               sigma_voxels: float = 1.0) -> Field:
    """Distance to this mesh's surface; negative inside where the surface encloses a volume (then lightly smoothed)."""
    surface = np.zeros(shape, dtype=bool)
    index = np.floor((surface_points(vertices, faces, pitch * 0.5) - origin) / pitch + 0.5).astype(int)
    inside_grid = np.all((index >= 0) & (index < np.array(shape)), axis=1)
    index = index[inside_grid]
    surface[index[:, 0], index[:, 1], index[:, 2]] = True
    distance = ndimage.distance_transform_edt(~surface).astype(np.float32) * pitch
    enclosed = ndimage.binary_fill_holes(surface) & ~surface
    if enclosed.any():
        distance[enclosed] *= -1
        if sigma_voxels > 0:
            distance = ndimage.gaussian_filter(distance, sigma_voxels)
    return Field(distance, origin, pitch)


# --- mesh helpers -------------------------------------------------------------------------------------------------
class Topology:
    """Fold checks against the ED mesh: a triangle facing the other way than at ED is folded."""

    def __init__(self, faces: np.ndarray, reference: np.ndarray):
        self.faces = faces
        self.reference_normals = self.face_normals(reference)
        self.area = 0.5 * np.linalg.norm(self.reference_normals, axis=1)

    def face_normals(self, vertices: np.ndarray) -> np.ndarray:
        f = self.faces
        return np.cross(vertices[f[:, 1]] - vertices[f[:, 0]], vertices[f[:, 2]] - vertices[f[:, 0]])

    def flipped(self, vertices: np.ndarray) -> np.ndarray:
        return (self.reference_normals * self.face_normals(vertices)).sum(axis=1) < 0

    def folded(self, vertices: np.ndarray) -> tuple[int, float]:
        """(folded triangles, their share of the surface area in %)."""
        flipped = self.flipped(vertices)
        return int(flipped.sum()), float(100.0 * self.area[flipped].sum() / max(self.area.sum(), 1e-12))


# --- the smooth displacement field --------------------------------------------------------------------------------
def _bspline(t: np.ndarray) -> np.ndarray:
    """Uniform cubic B-spline weights of the 4 control points around each t in [0, 1]."""
    return np.stack([(1 - t) ** 3, 3 * t ** 3 - 6 * t ** 2 + 4, -3 * t ** 3 + 3 * t ** 2 + 3 * t + 1, t ** 3], -1) / 6


class SplineGrid:
    """Control points every `spacing` over [low, high]; a displacement is basis(points) @ coefficients (K x 3)."""

    def __init__(self, low: np.ndarray, high: np.ndarray, spacing: float):
        self.low, self.spacing = low, spacing
        self.cells = np.maximum(np.ceil((high - low) / spacing).astype(int), 1)
        self.dims = self.cells + 3                              # one control point below each cell, two above
        self.size = int(np.prod(self.dims))

    def basis(self, points: np.ndarray) -> sparse.csr_matrix:
        u = (points - self.low) / self.spacing
        cell = np.clip(np.floor(u).astype(int), 0, self.cells - 1)
        w = [_bspline(np.clip(u[:, a] - cell[:, a], 0.0, 1.0)) for a in range(3)]
        rows, cols, values = [], [], []
        index = np.arange(len(points))
        for a in range(4):
            for b in range(4):
                for c in range(4):
                    node = ((cell[:, 0] + a) * self.dims[1] + cell[:, 1] + b) * self.dims[2] + cell[:, 2] + c
                    rows.append(index); cols.append(node); values.append(w[0][:, a] * w[1][:, b] * w[2][:, c])
        return sparse.csr_matrix((np.concatenate(values), (np.concatenate(rows), np.concatenate(cols))),
                                 shape=(len(points), self.size))

    def roughness(self) -> sparse.csr_matrix:
        """Graph Laplacian of the control grid: penalises neighbouring control points moving differently."""
        index = np.arange(self.size).reshape(self.dims)
        pairs = [np.moveaxis(index, axis, 0) for axis in range(3)]
        r = np.concatenate([p[:-1].ravel() for p in pairs])
        c = np.concatenate([p[1:].ravel() for p in pairs])
        adjacency = sparse.coo_matrix((np.ones(len(r)), (r, c)), shape=(self.size, self.size))
        adjacency = (adjacency + adjacency.T).tocsr()
        return (sparse.diags(np.asarray(adjacency.sum(axis=1)).ravel()) - adjacency).tocsr()


def track_frame(points: np.ndarray, basis: sparse.csr_matrix, basis_t: sparse.csr_matrix, solve, field: Field,
                coefficients: np.ndarray, iterations: int = 15, max_move: float = 2.0) -> np.ndarray:
    """Pull `points` (moved by the current field) onto the field's zero level along its gradient, then refit the
    smooth field to where they want to be; repeated. `solve` is the factorised (B'B + regulariser)."""
    for _ in range(iterations):
        moved = points + basis @ coefficients
        d = field.distance(moved)
        g = field.grad(moved)
        pull = -(np.clip(d, -max_move, max_move) / np.maximum((g * g).sum(axis=1), 1e-6))[:, None] * g
        wanted = moved - points + pull
        coefficients = np.column_stack([solve(basis_t @ wanted[:, a]) for a in range(3)])
    return coefficients


def build_motion(meshes: dict, ed_frame: int | None = None, pitch: float | None = None, spacing: float = 6.0,
                 stiffness: float = 0.5, anchor: float = 0.1, smoothing: float = 0.05, periodic: bool = True, iterations: int = 25,
                 samples: int = 4000, margin: float = 8.0) -> dict:
    """meshes: {frame number: (vertices, faces)} of one chamber, in mm. Returns the ED vertices moved onto every
    frame (frames without a mesh are filled in from their neighbours), plus quality figures.

    spacing: control-point spacing (mm) of the displacement field; stiffness / anchor: how strongly neighbouring
    control points must agree / how strongly the field is pulled back to no motion (both relative to the data);
    smoothing: Gaussian sigma over time as a fraction of the cycle (0.05 = 1.5 frames at 30; 0 = none); periodic: the
    frames are one cardiac cycle, so smoothing wraps from the last frame back to ED (no jump when playback loops)."""
    start = time.time()
    numbers = sorted(meshes)
    if len(numbers) < 3:
        raise ValueError(f"need at least 3 frames, got {len(numbers)}")
    if ed_frame is None or ed_frame not in meshes:
        ed_frame = numbers[0]
    template, faces = meshes[ed_frame]
    template = np.asarray(template, dtype=np.float64)
    every = np.concatenate([meshes[n][0] for n in numbers])
    low, high = every.min(axis=0) - margin, every.max(axis=0) + margin
    if pitch is None:                                          # about 1 % of the heart's size, at most ~2.5M voxels
        pitch = max(float((high - low).max()) / 110.0, float(np.cbrt(np.prod(high - low) / 2.5e6)))
    shape = tuple(int(np.ceil(s / pitch)) + 1 for s in (high - low))
    spacing = max(spacing, float(np.cbrt(np.prod(high - low) / 20000.0)))      # at most ~20k control points

    grid = SplineGrid(low, high, spacing)
    rng = np.random.default_rng(0)
    chosen = np.sort(rng.choice(len(template), size=min(len(template), samples), replace=False))
    points = template[chosen]
    basis = grid.basis(points)
    basis_t = basis.T.tocsr()
    roughness = grid.roughness()
    scale = len(points) / grid.size
    system = basis_t @ basis + stiffness * scale * (roughness.T @ roughness) + anchor * scale * sparse.identity(grid.size)
    solve = splu(system.tocsc()).solve

    # Every frame is fitted from ED, not from the previous frame: a reconstruction that collapses in one frame (patient108
    # UNet RV: 18 ml -> 4.8 ml -> 18 ml) would otherwise crush the mesh and keep it crushed for the frames after
    # (chained fit: 0.8 ml where the input was back at 18 ml).
    cycle = [n for n in numbers if n >= ed_frame] + [n for n in numbers if n < ed_frame]
    fields, known = {}, {ed_frame: np.zeros((grid.size, 3))}
    for n in cycle[1:]:
        fields[n] = mesh_field(*meshes[n], low, shape, pitch)
        known[n] = track_frame(points, basis, basis_t, solve, fields[n], np.zeros((grid.size, 3)), iterations)

    # Every frame number from first to last: missing ones linear in time between their neighbours.
    all_frames = list(range(numbers[0], numbers[-1] + 1))
    field_series = np.empty((len(all_frames), grid.size, 3))
    for i, n in enumerate(all_frames):
        if n in known:
            field_series[i] = known[n]
        else:
            before = max(k for k in known if k < n)
            after = min(k for k in known if k > n)
            t = (n - before) / (after - before)
            field_series[i] = (1 - t) * known[before] + t * known[after]
    ed_index = all_frames.index(ed_frame)
    sigma = smoothing * len(all_frames)                                    # in frames
    if sigma > 0:
        field_series = ndimage.gaussian_filter1d(field_series, sigma, axis=0, mode="wrap" if periodic else "nearest")
        distance = np.abs(np.arange(len(all_frames)) - ed_index)
        if periodic:
            distance = np.minimum(distance, len(all_frames) - distance)
        fade = np.exp(-0.5 * (distance / sigma) ** 2)
        field_series -= fade[:, None, None] * field_series[ed_index]          # ED exactly as reconstructed
    else:
        field_series[ed_index] = 0.0

    full_basis = grid.basis(template)
    positions = np.stack([template + full_basis @ field_series[i] for i in range(len(all_frames))])
    positions[ed_index] = template

    topology = Topology(faces, template)
    errors = np.concatenate([np.abs(fields[n].distance(positions[all_frames.index(n)])) for n in cycle[1:]])
    folds = [topology.folded(v) for v in positions]
    return {
        "frames": all_frames, "edFrame": int(ed_frame), "positions": positions.astype(np.float32),
        "vertexCount": int(len(template)), "triangleCount": int(len(faces)),
        "stats": {"surfaceErrorMean": round(float(errors.mean()), 3),
                  "surfaceError95": round(float(np.percentile(errors, 95)), 3),
                  "foldedTriangles": max(f[0] for f in folds),
                  "foldedAreaPercent": round(max(f[1] for f in folds), 3),
                  "endToEdGap": round(float(np.linalg.norm(positions[-1] - positions[0], axis=1).mean()), 3),
                  "pitch": round(pitch, 3), "spacing": round(spacing, 3),
                  "smoothingFrames": round(sigma, 2), "periodic": periodic,
                  "framesTracked": len(cycle), "framesFilled": len(all_frames) - len(cycle),
                  "seconds": round(time.time() - start, 1)},
    }


# --- output -------------------------------------------------------------------------------------------------------
def encode_motion(result: dict, chamber: str | None = None) -> bytes:
    """b"VHMO" + uint32 version + uint32 JSON length + JSON (padded to 4 bytes) + int16 positions (frames x vertices x
    3, little-endian). A position is offset + q * scale per axis; 1/65535 of the range, about 0.002 mm for a heart."""
    positions = result["positions"].astype(np.float64)
    low, high = positions.reshape(-1, 3).min(axis=0), positions.reshape(-1, 3).max(axis=0)
    scale = np.maximum(high - low, 1e-9) / 65535.0
    offset = low + 32768 * scale
    quantised = np.clip(np.rint((positions - offset) / scale), -32768, 32767).astype("<i2")
    header = {"format": "visheart-motion", "version": FORMAT_VERSION, "method": METHOD, "chamber": chamber,
              "frames": result["frames"], "edFrame": result["edFrame"], "vertexCount": result["vertexCount"],
              "triangleCount": result["triangleCount"], "offset": offset.tolist(), "scale": scale.tolist(),
              "stats": result["stats"]}
    text = json.dumps(header, separators=(",", ":")).encode("utf-8")
    text += b" " * (-len(text) % 4)
    return b"VHMO" + struct.pack("<II", FORMAT_VERSION, len(text)) + text + quantised.tobytes()


def decode_motion(data: bytes) -> tuple[dict, np.ndarray]:
    if data[:4] != b"VHMO":
        raise ValueError("not a VisHeart motion file")
    version, length = struct.unpack_from("<II", data, 4)
    header = json.loads(data[12:12 + length])
    count = len(header["frames"]) * header["vertexCount"] * 3
    quantised = np.frombuffer(data, dtype="<i2", count=count, offset=12 + length).reshape(-1, header["vertexCount"], 3)
    return header, np.asarray(header["offset"]) + quantised * np.asarray(header["scale"])


def motion_from_tar(data: bytes, chamber: str | None = None, ed_frame: int | None = None) -> tuple[bytes, dict]:
    meshes, marked_ed = frames_from_tar(data, chamber)
    result = build_motion(meshes, ed_frame if ed_frame is not None else marked_ed)
    return encode_motion(result, chamber), {k: v for k, v in result.items() if k != "positions"}
