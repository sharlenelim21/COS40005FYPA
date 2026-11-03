"""Whole-dataset training set for a fine-tune: every original training patient, plus the corrections repeated so they
make up about 1/11 of the epoch (the supervisor's method, "Bx"; Jy's decision 2026-11-01, evidence run
decoder-1epoch-1026-145005, kept outside this repository).

A patient is left out whole when any slice of any of its volumes:
  - belongs to the frozen test set (frozen_guard index, exact or near match): finetune.py would refuse it anyway;
  - equals a slice of --exclude-like (the corrections export): its public label would contradict the correction.
The frozen check reads every volume, so its result is cached per source folder and frozen index (--cache-dir); the
correction check runs for every export.

Files are hard links (copies where linking fails), so the set costs no disk space:
  OUT/<source>/images|masks     every kept volume, all slices
  OUT/corrections/images|masks  each corrected file k times, k = max(1, round(whole slices / (10 x corrected slices)))
  OUT/whole_manifest.json

  python make_whole_set.py --source acdc IMAGES MASKS [--source ...] --corrections EXPORT_DIR --out DIR
                           [--frozen-slices frozen_slices.npz] [--cache-dir DIR]
"""
import argparse
import datetime as dt
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_replay_set  # noqa: E402
from common import sha256_file  # noqa: E402
from frozen_guard import DEFAULT_INDEX, FrozenIndex, load_volume  # noqa: E402

CORRECTION_SHARE = 10  # whole slices per corrected slice: corrections are 1/(10 + 1) of the epoch


def link(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, target)
    except OSError:
        shutil.copy2(source, target)


def repeats(whole_slices, corrected_slices):
    return max(1, round(whole_slices / (CORRECTION_SHARE * corrected_slices)))


def frozen_exclusions(name, patients, frozen_index, index_sha256, cache_dir):
    """{patient: {"volume", "match"}} for the patients holding a frozen test slice, from the cache when it fits."""
    cache = Path(cache_dir) / f"whole-frozen-{name}-{index_sha256[:16]}.json" if cache_dir else None
    listing = {p: sorted(image.name for image, _ in v) for p, v in patients.items()}
    if cache and cache.exists():
        stored = json.loads(cache.read_text(encoding="utf-8"))
        if stored.get("patients") == listing:
            return stored["excluded"]
    excluded = {}
    for patient in sorted(patients):
        volume, hit = make_replay_set.first_frozen_hit(frozen_index, patients[patient])
        if hit:
            excluded[patient] = {"volume": volume, "match": hit}
    if cache:
        cache.parent.mkdir(parents=True, exist_ok=True)
        temp = cache.with_name(cache.name + ".tmp")
        temp.write_text(json.dumps({"index_sha256": index_sha256, "patients": listing, "excluded": excluded}),
                        encoding="utf-8")
        os.replace(temp, cache)
    return excluded


def build(sources, corrections_dir, out, frozen_index, frozen_meta=None, cache_dir=None):
    """sources: [(name, images_dir, masks_dir)]; corrections_dir holds images/ and masks/ (an export)."""
    out, corrections_dir = Path(out), Path(corrections_dir)
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} is not empty; a whole set is written once")
    corrected_images = sorted((corrections_dir / "images").glob("*.nii.gz"))
    corrected_slices = sum(load_volume(p).shape[2] for p in corrected_images)
    if corrected_slices < 1:
        raise SystemExit(f"{corrections_dir} holds no corrected slices")
    corrections = FrozenIndex.from_arrays((p.name, load_volume(p)) for p in corrected_images)
    index_sha256 = (frozen_meta or {}).get("sha256") or "unhashed"

    result, excluded = {}, []
    for name, images, masks in sources:
        patients = make_replay_set.list_patients(images, masks)
        frozen = frozen_exclusions(name, patients, frozen_index, index_sha256, cache_dir)
        kept, slices = [], 0
        for patient, volumes in sorted(patients.items()):
            volume, hit = make_replay_set.first_frozen_hit(corrections, volumes)  # any index: here, the corrections'
            if hit:
                excluded.append({"source": name, "patient": patient, "reason": "same image as a correction",
                                 "volume": volume, "match": hit})
                continue
            if patient in frozen:
                excluded.append({"source": name, "patient": patient, "reason": "frozen test slice", **frozen[patient]})
                continue
            for image, mask in volumes:
                link(image, out / name / "images" / image.name)
                link(mask, out / name / "masks" / mask.name)
                slices += load_volume(image).shape[2]
            kept.append(patient)
        result[name] = {"images": str(Path(images).resolve()), "masks": str(Path(masks).resolve()),
                        "patients": len(kept), "slices": slices}
    whole_slices = sum(s["slices"] for s in result.values())
    k = repeats(whole_slices, corrected_slices)
    for image in corrected_images:
        stem = image.name[:-len(".nii.gz")]
        mask = corrections_dir / "masks" / f"{stem}_gt.nii.gz"
        for i in range(k):
            link(image, out / "corrections" / "images" / f"{stem}_r{i:03d}.nii.gz")
            link(mask, out / "corrections" / "masks" / f"{stem}_r{i:03d}_gt.nii.gz")
    manifest = {"created_at": dt.datetime.now(dt.timezone.utc).isoformat(), "corrections": str(corrections_dir.resolve()),
                "corrected_slices": corrected_slices, "repeats": k, "corrections_in_epoch": k * corrected_slices,
                "whole_slices": whole_slices,
                "correction_share": round(k * corrected_slices / (whole_slices + k * corrected_slices), 4),
                "frozen_index": frozen_meta, "sources": result, "excluded": excluded}
    out.mkdir(parents=True, exist_ok=True)
    (out / "whole_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def train_folders(out, manifest):
    """The --train pairs for finetune.py: every source, then the repeated corrections."""
    out = Path(out)
    return ([(out / name / "images", out / name / "masks") for name in manifest["sources"]]
            + [(out / "corrections" / "images", out / "corrections" / "masks")])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", nargs=3, action="append", required=True, metavar=("NAME", "IMAGES_DIR", "MASKS_DIR"))
    parser.add_argument("--corrections", required=True, help="a corrections export: images/ and masks/")
    parser.add_argument("--out", required=True)
    parser.add_argument("--frozen-slices", default=str(DEFAULT_INDEX))
    parser.add_argument("--cache-dir", help="where the frozen check of each source is cached")
    args = parser.parse_args(argv)
    index_path = Path(args.frozen_slices)
    if not index_path.exists():
        print(f"frozen-slice index not found: {index_path}; build it with frozen_guard.py build")
        return 1
    index = FrozenIndex.load(index_path)
    if index.manifest_problem():
        print(index.manifest_problem())
        return 1
    manifest = build([tuple(s) for s in args.source], args.corrections, args.out, index,
                     {"path": str(index_path.resolve()), "sha256": sha256_file(index_path)}, args.cache_dir)
    print(json.dumps({k: manifest[k] for k in ("whole_slices", "corrected_slices", "repeats", "correction_share")}
                     | {"excluded": [(e["source"], e["patient"], e["reason"]) for e in manifest["excluded"]]}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
