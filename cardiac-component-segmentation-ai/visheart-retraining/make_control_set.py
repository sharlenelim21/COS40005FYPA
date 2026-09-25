"""Control training set for a fine-tune: whole patients drawn from the original training data, sized to match
the corrections export, so a release can separate what the corrections did from what the augmentation
change did (plan §10 Q4).

  python make_control_set.py --images DIR --masks DIR --export-manifest EXPORT_DIR/export_manifest.json
                             --out DIR [--seed 20260914]
"""
import argparse
import datetime as dt
import json
import random
import shutil
import sys
from pathlib import Path

import nibabel as nib


def patient_of(file_name):
    """'A1K2P5_11.nii.gz' -> 'A1K2P5'; 'patient101_frame01.nii.gz' -> 'patient101'."""
    stem = file_name[: -len(".nii.gz")]
    return stem.rsplit("_", 1)[0] if "_" in stem else stem


def build(images, masks, target_slices, out, seed=20260914):
    out = Path(out)
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} is not empty; a control set is written once")
    volumes = {}
    for image in sorted(Path(images).glob("*.nii.gz")):
        mask = Path(masks) / image.name.replace(".nii.gz", "_gt.nii.gz")
        if mask.exists():
            volumes.setdefault(patient_of(image.name), []).append((image, mask, int(nib.load(str(image)).shape[2])))
    patients = sorted(volumes)
    random.Random(seed).shuffle(patients)
    chosen, slices = [], 0
    for patient in patients:
        if slices >= target_slices:
            break
        chosen.append(patient)
        slices += sum(count for _, _, count in volumes[patient])
    if slices < target_slices:
        raise SystemExit(f"only {slices} slices available; {target_slices} needed")
    (out / "images").mkdir(parents=True)
    (out / "masks").mkdir(parents=True)
    files = []
    for patient in sorted(chosen):
        for image, mask, count in volumes[patient]:
            shutil.copy2(image, out / "images" / image.name)
            shutil.copy2(mask, out / "masks" / mask.name)
            files.append({"image": image.name, "slices": count})
    manifest = {"created_at": dt.datetime.now(dt.timezone.utc).isoformat(), "images": str(Path(images).resolve()),
                "masks": str(Path(masks).resolve()), "seed": seed, "target_slices": target_slices,
                "slices": slices, "patients": sorted(chosen), "files": files}
    (out / "control_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--images", required=True)
    parser.add_argument("--masks", required=True)
    parser.add_argument("--export-manifest", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--seed", type=int, default=20260914)
    args = parser.parse_args(argv)
    target = json.loads(Path(args.export_manifest).read_text(encoding="utf-8"))["counts"]["slices"]
    manifest = build(args.images, args.masks, target, args.out, args.seed)
    print(json.dumps({key: manifest[key] for key in ("target_slices", "slices", "patients")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
