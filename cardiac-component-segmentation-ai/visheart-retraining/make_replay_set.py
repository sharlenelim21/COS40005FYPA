"""Replay set for a fine-tune: slices of the original training data, mixed in beside the corrections so the model
keeps what it knew (proposal §3, "mix in original training data"). The WS9 loop test measured the forgetting this
is meant to prevent.

Patients are drawn at random (seeded) from each source, in equal shares of --slices. A patient is left out whole
when any slice of any of its volumes:
  - belongs to the frozen test set (frozen_guard index): finetune.py would refuse it anyway. Byte-identical slices
    are found by scanning every volume; near matches are checked for each patient drawn;
  - equals a slice of --exclude-like (the corrections export): its ground truth would contradict the correction
    drawn on the same image. Every volume is scanned for these.
So the manifest lists every correction and exact frozen overlap in the sources, drawn or not.
From each accepted patient one volume (at random) gives --per-volume heart-containing slices, spread evenly from
its first to its last heart slice. They are copied exactly, with the source affine, as H x W x k volumes.

  python make_replay_set.py --source acdc IMAGES MASKS [--source ...] --slices 100 --out DIR
                            [--exclude-like CORRECTIONS_IMAGES_DIR] [--frozen-slices frozen_slices.npz]
                            [--per-volume 2] [--seed 20260924]
"""
import argparse
import datetime as dt
import json
import random
import sys
from pathlib import Path

import nibabel as nib
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import sha256_file  # noqa: E402
from frozen_guard import DEFAULT_INDEX, FrozenIndex, exact_key, iter_slices, load_volume, thumbnail  # noqa: E402
from make_control_set import patient_of  # noqa: E402


def list_patients(images, masks):
    patients = {}
    for image in sorted(Path(images).glob("*.nii.gz")):
        mask = Path(masks) / image.name.replace(".nii.gz", "_gt.nii.gz")
        if mask.exists():
            patients.setdefault(patient_of(image.name), []).append((image, mask))
    return patients


def heart_slices(labels):
    return [z for z in range(labels.shape[2]) if labels[:, :, z].any()]


def spread(indices, k):
    """k indices spread evenly from the first to the last; all of them when there are no more than k."""
    if k <= 0 or not indices:
        return []
    if len(indices) <= k:
        return list(indices)
    if k == 1:
        return [indices[len(indices) // 2]]
    return [indices[round(i * (len(indices) - 1) / (k - 1))] for i in range(k)]


def first_frozen_hit(index, volumes):
    for image, _ in volumes:
        hit = index.first_match(load_volume(image))
        if hit:
            return image.name, hit
    return None, None


def exact_frozen_hit(index, data):
    """Byte-identical slices only: fast enough to scan every volume of every source."""
    for t, z, slice2d in iter_slices(data):
        if thumbnail(slice2d) is not None and exact_key(slice2d) in index.by_key:
            return {"frame": t, "slice": z, "frozen": index.by_key[exact_key(slice2d)]}
    return None


def build(sources, slices, out, exclude_like=None, frozen_index=None, per_volume=2, seed=20260924, frozen_meta=None):
    """sources: [(name, images_dir, masks_dir)]. Plans every source before writing, so a shortfall writes nothing."""
    out = Path(out)
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} is not empty; a replay set is written once")
    corrections = None
    if exclude_like:
        corrections = FrozenIndex.from_arrays((p.name, load_volume(p)) for p in sorted(Path(exclude_like).glob("*.nii.gz")))
    quotas = [slices // len(sources) + (1 if i < slices % len(sources) else 0) for i in range(len(sources))]
    excluded, plans = [], []
    for (name, images, masks), quota in zip(sources, quotas):
        patients = list_patients(images, masks)
        banned = set()
        # Every volume is read once here, so the manifest lists every correction and exact frozen overlap, drawn or not.
        for patient in sorted(patients):
            for image, _ in patients[patient]:
                data = load_volume(image)
                reason, hit = None, None
                if corrections is not None:
                    reason, hit = "same image as a correction", corrections.first_match(data)
                if not hit and frozen_index is not None:
                    reason, hit = "frozen test slice", exact_frozen_hit(frozen_index, data)
                if hit:
                    banned.add(patient)
                    excluded.append({"source": name, "patient": patient, "reason": reason, "volume": image.name,
                                     "match": hit})
                    break
        order = sorted(patients)
        random.Random(f"{seed}:{name}").shuffle(order)
        pick_volume = random.Random(f"{seed}:{name}:volume")
        chosen, got = [], 0
        for patient in order:
            if got >= quota:
                break
            if patient in banned:
                continue
            if frozen_index is not None:     # the full check, near matches included, for the patients actually drawn
                volume, hit = first_frozen_hit(frozen_index, patients[patient])
                if hit:
                    excluded.append({"source": name, "patient": patient, "reason": "frozen test slice (near match)",
                                     "volume": volume, "match": hit})
                    continue
            image, mask = pick_volume.choice(patients[patient])
            picks = spread(heart_slices(np.asanyarray(nib.load(str(mask)).dataobj)), min(per_volume, quota - got))
            if picks:
                chosen.append({"patient": patient, "image": image, "mask": mask, "picks": picks})
                got += len(picks)
        if got < quota:
            raise SystemExit(f"{name}: only {got} slices available after exclusions; {quota} needed")
        plans.append((name, images, masks, quota, chosen))

    (out / "images").mkdir(parents=True, exist_ok=True)
    (out / "masks").mkdir(parents=True, exist_ok=True)
    result, total = {}, 0
    for name, images, masks, quota, chosen in plans:
        files = []
        for entry in chosen:
            image, mask = nib.load(str(entry["image"])), nib.load(str(entry["mask"]))
            stem = f"{name}_{entry['image'].name[:-len('.nii.gz')]}"
            data = np.asanyarray(image.dataobj, dtype=np.float32)[:, :, entry["picks"]]
            labels = np.asanyarray(mask.dataobj).astype(np.uint8)[:, :, entry["picks"]]
            nib.save(nib.Nifti1Image(data, image.affine), str(out / "images" / f"{stem}.nii.gz"))
            nib.save(nib.Nifti1Image(labels, mask.affine), str(out / "masks" / f"{stem}_gt.nii.gz"))
            files.append({"image": f"{stem}.nii.gz", "source_image": entry["image"].name, "patient": entry["patient"],
                          "slice_indices": entry["picks"]})
        count = sum(len(f["slice_indices"]) for f in files)
        result[name] = {"images": str(Path(images).resolve()), "masks": str(Path(masks).resolve()), "quota": quota,
                        "slices": count, "patients": sorted({f["patient"] for f in files}), "files": files}
        total += count
    manifest = {"created_at": dt.datetime.now(dt.timezone.utc).isoformat(), "seed": seed, "per_volume": per_volume,
                "requested": slices, "slices": total, "exclude_like": str(Path(exclude_like).resolve()) if exclude_like else None,
                "frozen_index": frozen_meta, "sources": result, "excluded": excluded}
    (out / "replay_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", nargs=3, action="append", required=True, metavar=("NAME", "IMAGES_DIR", "MASKS_DIR"))
    parser.add_argument("--slices", type=int, required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--exclude-like", help="corrections export images; their patients never enter the replay set")
    parser.add_argument("--frozen-slices", default=str(DEFAULT_INDEX))
    parser.add_argument("--per-volume", type=int, default=2)
    parser.add_argument("--seed", type=int, default=20260924)
    args = parser.parse_args(argv)
    index_path = Path(args.frozen_slices)
    if not index_path.exists():
        print(f"frozen-slice index not found: {index_path}; build it with frozen_guard.py build")
        return 1
    index = FrozenIndex.load(index_path)
    if index.manifest_problem():
        print(index.manifest_problem())
        return 1
    manifest = build([tuple(s) for s in args.source], args.slices, args.out, args.exclude_like, index,
                     args.per_volume, args.seed,
                     frozen_meta={"path": str(index_path.resolve()), "sha256": sha256_file(index_path)})
    summary = {name: {"slices": s["slices"], "patients": len(s["patients"])} for name, s in manifest["sources"].items()}
    print(json.dumps({"slices": manifest["slices"], "sources": summary,
                      "excluded": [(e["source"], e["patient"], e["reason"]) for e in manifest["excluded"]]}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
