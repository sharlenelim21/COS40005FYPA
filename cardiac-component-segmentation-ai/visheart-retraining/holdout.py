"""Frozen held-out manifest: lock the public arm by content hash, and draw the clinical arm once.

  python holdout.py create --manifest M --dataset NAME IMAGES_DIR MASKS_DIR [--dataset ...]
  python holdout.py verify --manifest M
  python holdout.py add-clinical --manifest M --candidates DRY_RUN.json
                                 [--exclude-exported EXPORT_MANIFEST.json ...]
                                 [--fraction 0.3] [--seed 20260914] [--min-projects 10]
"""
import argparse
import datetime as dt
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import sha256_file  # noqa: E402


def _now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _write(path, payload):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _hash_dir(directory):
    root = Path(directory)
    return {p.relative_to(root).as_posix(): sha256_file(p) for p in sorted(root.rglob("*.nii.gz"))}


def create(manifest, datasets):
    """datasets: {name: (images_dir, masks_dir)}. Refuses to overwrite: a frozen set is created once."""
    if Path(manifest).exists():
        raise SystemExit(f"{manifest} already exists; a frozen manifest is never overwritten")
    public = {name: {"images": str(Path(images).resolve()), "masks": str(Path(masks).resolve()),
                     "image_files": _hash_dir(images), "mask_files": _hash_dir(masks)}
              for name, (images, masks) in datasets.items()}
    payload = {"version": 1, "created_at": _now(), "public": public, "clinical": None}
    _write(manifest, payload)
    return payload


def verify(manifest):
    """List every file that is missing, unexpected or changed since the manifest was created."""
    problems = []
    for name, arm in _read(manifest)["public"].items():
        for folder_key, files_key in (("images", "image_files"), ("masks", "mask_files")):
            current, expected = _hash_dir(arm[folder_key]), arm[files_key]
            for rel in sorted(set(expected) | set(current)):
                if rel not in current:
                    problems.append(f"{name}: missing {rel}")
                elif rel not in expected:
                    problems.append(f"{name}: unexpected {rel}")
                elif current[rel] != expected[rel]:
                    problems.append(f"{name}: changed {rel}")
    return problems


def add_clinical(manifest, candidates_json, exclude_exported=(), fraction=0.3, seed=20260914, min_projects=10):
    """Draw once. Projects already exported for training can never join the clinical arm."""
    data = _read(manifest)
    if data.get("clinical") is not None:
        raise SystemExit("the clinical arm is already drawn; it is never redrawn")
    candidates = {c["projectId"] for c in _read(candidates_json)["candidates"]}
    exported = set()
    for export in exclude_exported:
        exported |= {c["projectId"] for c in _read(export)["cases"]}
    eligible = sorted(candidates - exported)
    summary = {"eligible": len(eligible), "excluded_as_exported": len(candidates & exported)}
    if len(eligible) < min_projects:
        return {"drawn": False, **summary}
    chosen = sorted(random.Random(seed).sample(eligible, max(1, round(fraction * len(eligible)))))
    data["clinical"] = {"project_ids": chosen, "seed": seed, "fraction": fraction, **summary, "drawn_at": _now()}
    _write(manifest, data)
    return {"drawn": True, **data["clinical"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p_create = sub.add_parser("create")
    p_create.add_argument("--manifest", required=True)
    p_create.add_argument("--dataset", nargs=3, action="append", required=True,
                          metavar=("NAME", "IMAGES_DIR", "MASKS_DIR"))  # three values: Windows paths contain ':'
    p_verify = sub.add_parser("verify")
    p_verify.add_argument("--manifest", required=True)
    p_clinical = sub.add_parser("add-clinical")
    p_clinical.add_argument("--manifest", required=True)
    p_clinical.add_argument("--candidates", required=True)
    p_clinical.add_argument("--exclude-exported", action="append", default=[])
    p_clinical.add_argument("--fraction", type=float, default=0.3)
    p_clinical.add_argument("--seed", type=int, default=20260914)
    p_clinical.add_argument("--min-projects", type=int, default=10)
    args = parser.parse_args(argv)

    if args.command == "create":
        payload = create(args.manifest, {name: (images, masks) for name, images, masks in args.dataset})
        print(json.dumps({name: len(arm["mask_files"]) for name, arm in payload["public"].items()}))
        return 0
    if args.command == "verify":
        problems = verify(args.manifest)
        print("\n".join(problems) if problems else "manifest verified")
        return 1 if problems else 0
    print(json.dumps(add_clinical(args.manifest, args.candidates, args.exclude_exported,
                                  args.fraction, args.seed, args.min_projects)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
