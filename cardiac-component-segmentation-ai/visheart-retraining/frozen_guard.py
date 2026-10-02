"""Frozen-set guard: keep frozen test patients out of exports, fine-tuning and the review queue.

frozen_holdout.json locks the public test arm by file hash, but the app can hold the same patients in another
file. ACDC's patientNNN_4d cine contains the ED/ES frames that testing-acdc stores as patientNNN_frameXX. On
2026-09-23, slices exported from the app's patient108_4d were byte-identical to patient108_frame01. So the guard
compares pixels, not names, one 2D slice at a time:

  exact : SHA-256 of the slice as float32, which catches the same data in any file
  near  : mean absolute difference <= 0.01 between 32 x 32 thumbnails of the min-max-normalised slice, which
          catches rescaled or re-encoded copies

Constant slices are skipped, because every blank slice looks alike. Rotated, flipped, cropped or resampled copies
are not caught. numpy and nibabel only, so this also runs in the app container beside build_training_volumes.py.

  python frozen_guard.py build --manifest frozen_holdout.json --output frozen_slices.npz
  python frozen_guard.py check --index frozen_slices.npz DIR_OR_FILE [...]
"""
import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import nibabel as nib
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import UNET_ROOT, default_frozen_index  # noqa: E402

DEFAULT_INDEX = default_frozen_index(UNET_ROOT)
THUMB = 32
NEAR_TOLERANCE = 0.01


def load_volume(path):
    """As build_training_volumes.py and evaluate.py read volumes, so exact keys agree across the tools."""
    return np.asanyarray(nib.load(str(path)).dataobj, dtype=np.float32)


def iter_slices(data):
    """(frame, slice, 2D array) for a 2D, 3D (H x W x slices) or 4D (H x W x slices x frames) array."""
    data = np.asarray(data)
    if data.ndim == 2:
        data = data[:, :, np.newaxis]
    if data.ndim == 3:
        data = data[..., np.newaxis]
    if data.ndim != 4:
        raise ValueError(f"expected a 2D, 3D or 4D array, got shape {data.shape}")
    for t in range(data.shape[3]):
        for z in range(data.shape[2]):
            yield t, z, data[:, :, z, t]


def exact_key(slice2d):
    array = np.ascontiguousarray(slice2d, dtype=np.float32)
    return hashlib.sha256(repr(array.shape).encode() + array.tobytes()).hexdigest()


def thumbnail(slice2d):
    """Min-max normalised, nearest-sampled 32 x 32 thumbnail, or None for a constant slice."""
    array = np.nan_to_num(np.asarray(slice2d, dtype=np.float64), nan=0.0, posinf=0.0, neginf=0.0)
    low, high = float(array.min()), float(array.max())
    if high - low < 1e-8:
        return None
    rows = ((np.arange(THUMB) + 0.5) * array.shape[0] / THUMB).astype(int)
    cols = ((np.arange(THUMB) + 0.5) * array.shape[1] / THUMB).astype(int)
    return ((array[np.ix_(rows, cols)] - low) / (high - low)).astype(np.float32).ravel()


def public_arm_sha256(manifest_data):
    """Hash of the public arm alone: drawing the clinical arm later must not invalidate the index."""
    return hashlib.sha256(json.dumps(manifest_data["public"], sort_keys=True).encode()).hexdigest()


class FrozenIndex:
    def __init__(self, keys, labels, thumbs, manifest=None, tolerance=NEAR_TOLERANCE):
        self.labels = list(labels)
        self.thumbs = np.asarray(thumbs, dtype=np.float32).reshape(len(self.labels), THUMB * THUMB)
        self.by_key = {}
        for key, label in zip(keys, self.labels):
            self.by_key.setdefault(key, label)
        self.keys = list(keys)
        self.manifest = manifest
        self.tolerance = tolerance

    def __len__(self):
        return len(self.labels)

    @classmethod
    def from_arrays(cls, named, manifest=None):
        """named: {name: array} or an iterable of (name, array); each array is read once, then dropped."""
        keys, labels, thumbs = [], [], []
        for name, data in (named.items() if isinstance(named, dict) else named):
            four_d = np.asarray(data).ndim == 4
            for t, z, slice2d in iter_slices(data):
                thumb = thumbnail(slice2d)
                if thumb is None:
                    continue
                keys.append(exact_key(slice2d))
                labels.append(f"{name}#t{t}z{z}" if four_d else f"{name}#z{z}")
                thumbs.append(thumb)
        return cls(keys, labels, np.array(thumbs, dtype=np.float32).reshape(len(labels), THUMB * THUMB), manifest)

    def match(self, slice2d):
        """The frozen slice this one duplicates, or None."""
        thumb = thumbnail(slice2d)
        if thumb is None or not self.labels:
            return None
        hit = self.by_key.get(exact_key(slice2d))
        if hit:
            return hit
        differences = np.abs(self.thumbs - thumb).mean(axis=1)
        nearest = int(np.argmin(differences))
        return self.labels[nearest] if differences[nearest] <= self.tolerance else None

    def first_match(self, data):
        for t, z, slice2d in iter_slices(data):
            hit = self.match(slice2d)
            if hit:
                return {"frame": t, "slice": z, "frozen": hit}
        return None

    def manifest_problem(self):
        """None while the frozen public arm is unchanged, or while its manifest is not reachable from here."""
        if not self.manifest or not Path(self.manifest["path"]).exists():
            return None
        current = public_arm_sha256(json.loads(Path(self.manifest["path"]).read_text(encoding="utf-8")))
        if current != self.manifest["public_sha256"]:
            return (f"the public arm of {self.manifest['path']} changed after this index was built; rebuild it with "
                    "frozen_guard.py build")
        return None

    def save(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(f".{path.stem}.tmp.npz")
        np.savez_compressed(temp, keys=np.array(self.keys, dtype=str), labels=np.array(self.labels, dtype=str),
                            thumbs=self.thumbs.astype(np.float16),
                            meta=np.array(json.dumps({"manifest": self.manifest, "tolerance": self.tolerance,
                                                      "thumb": THUMB})))
        os.replace(temp, path)

    @classmethod
    def load(cls, path):
        with np.load(str(path), allow_pickle=False) as stored:
            meta = json.loads(str(stored["meta"]))
            return cls(stored["keys"].tolist(), stored["labels"].tolist(), stored["thumbs"].astype(np.float32),
                       meta.get("manifest"), meta.get("tolerance", NEAR_TOLERANCE))


def build(manifest, output):
    """Index every image slice of the frozen public arm. Refuses a manifest that does not verify."""
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from holdout import verify
    problems = verify(manifest)
    if problems:
        raise SystemExit("frozen manifest does not verify; no index written:\n" + "\n".join(problems[:20]))
    data = json.loads(Path(manifest).read_text(encoding="utf-8"))
    volumes = ((f"{name}/{rel}", load_volume(Path(arm["images"]) / rel))
               for name, arm in data["public"].items() for rel in sorted(arm["image_files"]))
    index = FrozenIndex.from_arrays(volumes, manifest={"path": str(Path(manifest).resolve()),
                                                       "public_sha256": public_arm_sha256(data)})
    index.save(output)
    return index


def check_paths(index, paths):
    """Every slice of every NIfTI under paths that matches the frozen set: (file, frame, slice, frozen)."""
    files, checked, matches = [], 0, []
    for path in map(Path, paths):
        files += sorted(path.rglob("*.nii.gz")) if path.is_dir() else [path]
    for file in files:
        for t, z, slice2d in iter_slices(load_volume(file)):
            checked += 1
            hit = index.match(slice2d)
            if hit:
                matches.append((str(file), t, z, hit))
    return len(files), checked, matches


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p_build = sub.add_parser("build")
    p_build.add_argument("--manifest", required=True)
    p_build.add_argument("--output", default=str(DEFAULT_INDEX))
    p_check = sub.add_parser("check")
    p_check.add_argument("--index", default=str(DEFAULT_INDEX))
    p_check.add_argument("paths", nargs="+")
    args = parser.parse_args(argv)

    if args.command == "build":
        index = build(args.manifest, args.output)
        print(f"indexed {len(index)} frozen slices into {args.output}")
        return 0
    index = FrozenIndex.load(args.index)
    problem = index.manifest_problem()
    if problem:
        print(problem)
        return 1
    files, checked, matches = check_paths(index, args.paths)
    for file, t, z, hit in matches[:50]:
        print(f"{file}: frame {t} slice {z} matches {hit}")
    print(f"{files} files, {checked} slices checked, {len(matches)} match the frozen set")
    return 1 if matches else 0


if __name__ == "__main__":
    sys.exit(main())
