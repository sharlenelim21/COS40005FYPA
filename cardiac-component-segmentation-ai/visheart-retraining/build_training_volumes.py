"""Build training NIfTI pairs from one saved editable mask, keeping only its tracked, corrected slices.

stdin : {"source_nifti", "case_id", "out_dir", "plane": {"height", "width"}, "min_pixels",
         "tracked_slices": editTracking.slices, "frames": the saved editable mask's frames,
         "frozen_slices": optional frozen_guard.py index; a source volume with any frozen slice exports nothing}
stdout: {"files": [...], "skipped": {...}[, "frozen_match": {...}]}  or  {"error": "..."}

With {"check_frozen": true, "source_nifti", "frozen_slices"} it only checks: {"frozen_match": {...} or null}.
"""
import json
import sys
from pathlib import Path

import nibabel as nib
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import sha256_file  # noqa: E402

CLASS_TO_LABEL = {"lvc": 3, "lv": 3, "myo": 2, "rv": 1}


def decode_rle(rle, height, width):
    """Same rules as decode_rle in SRV/src/python/create_nifti_with_stored_affine.py:25-50."""
    mask = np.zeros(height * width, dtype=bool)
    try:
        parts = [int(p) for p in (rle or "").split()]
    except ValueError:
        return mask.reshape(height, width)
    for i in range(0, len(parts) - 1, 2):
        start, length = parts[i], parts[i + 1]
        if start < 0 or start + length > mask.size:
            continue
        mask[start:start + length] = True
    return mask.reshape(height, width)


def has_manual(entries):
    return any(str(e.get("class", "")).lower() == "manual" and e.get("segmentationmaskcontents")
               for e in entries)


def select_slices(tracked, frames, min_pixels):
    saved = {(int(f.get("frameindex", 0)), int(s.get("sliceindex", 0))): s
             for f in frames or [] for s in f.get("slices") or []}
    chosen = {}
    skipped = {"below_min_pixels": 0, "manual": 0, "excluded": 0, "missing": 0}
    for t in tracked or []:
        key = (int(t["frameindex"]), int(t["sliceindex"]))
        entries = (saved.get(key) or {}).get("segmentationmasks") or []
        if key not in saved:
            skipped["missing"] += 1
        elif saved[key].get("excluded"):
            skipped["excluded"] += 1
        elif (t.get("byClass") or {}).get("manual", 0) > 0 or has_manual(entries):
            skipped["manual"] += 1
        elif t.get("pixelsChanged", 0) < min_pixels:
            skipped["below_min_pixels"] += 1
        else:
            chosen.setdefault(key[0], []).append((key[1], entries))
    return {f: sorted(v, key=lambda item: item[0]) for f, v in sorted(chosen.items())}, skipped


def label_slice(entries, height, width):
    """Array order, first label written wins — create_nifti_with_stored_affine.py:141-162."""
    labels = np.zeros((height, width), dtype=np.uint8)
    for entry in entries:
        label = CLASS_TO_LABEL.get(str(entry.get("class", "")).lower())
        if label is None:
            continue
        decoded = decode_rle(entry.get("segmentationmaskcontents"), height, width)
        labels[decoded & (labels == 0)] = label
    return labels


def frozen_match(data, frozen_slices):
    """The first slice of the whole volume that matches the frozen set, or None."""
    from frozen_guard import FrozenIndex
    return FrozenIndex.load(frozen_slices).first_match(data)


def build(payload):
    source = nib.load(payload["source_nifti"])
    data = np.asanyarray(source.dataobj, dtype=np.float32)
    if data.ndim == 3:
        data = data[..., np.newaxis]
    if payload.get("check_frozen"):
        # The export's dry run asks only this, so the Prepare page can lock a frozen test patient's cases.
        return {"frozen_match": frozen_match(data, payload["frozen_slices"])}
    height, width = int(payload["plane"]["height"]), int(payload["plane"]["width"])
    if data.ndim != 4 or data.shape[:2] != (height, width):
        return {"error": f"source shape {data.shape} does not match plane ({height}, {width})"}
    if payload.get("frozen_slices"):
        # Whole patient: another frame of a frozen test patient is as much a leak as the frozen frame itself.
        hit = frozen_match(data, payload["frozen_slices"])
        if hit:
            return {"files": [], "skipped": {"frozen_test_patient": len(payload.get("tracked_slices") or [])},
                    "frozen_match": hit}
    chosen, skipped = select_slices(payload.get("tracked_slices"), payload.get("frames"),
                                    int(payload.get("min_pixels", 20)))
    out = Path(payload["out_dir"])
    (out / "images").mkdir(parents=True, exist_ok=True)
    (out / "masks").mkdir(parents=True, exist_ok=True)
    files = []
    for frame, items in chosen.items():
        slices = [s for s, _ in items]
        if frame >= data.shape[3] or max(slices) >= data.shape[2]:
            return {"error": f"frame {frame} / slice {max(slices)} is outside the source shape {data.shape}"}
        image = np.stack([data[:, :, s, frame] for s in slices], axis=2)  # what the model sees
        labels = np.stack([label_slice(e, height, width) for _, e in items], axis=2)
        stem = f"{payload['case_id']}_f{frame}"
        image_path = out / "images" / f"{stem}.nii.gz"
        mask_path = out / "masks" / f"{stem}_gt.nii.gz"
        nib.save(nib.Nifti1Image(image, source.affine), str(image_path))
        nib.save(nib.Nifti1Image(labels, source.affine), str(mask_path))
        files.append({"frameindex": frame, "slices": slices, "image": str(image_path), "mask": str(mask_path),
                      "sha256_image": sha256_file(image_path), "sha256_mask": sha256_file(mask_path)})
    return {"files": files, "skipped": skipped}


def main():
    try:
        result = build(json.loads(sys.stdin.read()))
    except (KeyError, ValueError, TypeError, OSError) as exc:
        result = {"error": f"{type(exc).__name__}: {exc}"}
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
