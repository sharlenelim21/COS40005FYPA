"""Pack the UNet Extend Training data for another computer, and check the pack when it arrives there.

The training service needs more than this repository: the version registry and checkpoints, the frozen test set, the
public datasets for replay and scoring, the v2-unet code, the reports Results reads, and the original unet.pth the
registry checks. This copies exactly those into one folder, with every file's SHA-256 in PACKED.json:

  python pack_training_data.py pack --out F:\\visheart-training-pack
  python pack_training_data.py verify F:\\visheart-training-pack

On the other computer setup-training-pc.ps1 verifies the pack, then relocate.py rewrites the paths inside it. The
evidence runs' frozen-set reports are copied into evaluations/ (as from-evidence-<run>-<name>.json), so relocate.py
rewrites the copies and the evidence itself is neither shipped nor changed. Left out: jobs, exports, scratch versions,
the virtual environment, old v2-unet checkpoints and data.zip, which duplicates data/.
"""
import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import UNET_ROOT, default_v2_root, sha256_file  # noqa: E402

PACK_MANIFEST = "PACKED.json"
MODELS_IN_PACK = "repo-models"


def _files(folder, pattern="*"):
    return sorted(path for path in folder.glob(pattern) if path.is_file() and "__pycache__" not in path.parts)


def selection(root, v2_root=None):
    """Every (source, path in the pack) another computer needs, from the data root."""
    root = Path(root)
    v2 = Path(v2_root) if v2_root else default_v2_root(root)
    if root not in v2.parents:   # the frozen manifest names the v2 data by path; it must move with the root
        raise SystemExit(f"The v2-unet copy {v2} is not inside the data root {root}; pack it by hand.")
    versions_dir = root / "versions"
    registry = json.loads((versions_dir / "registry.json").read_text(encoding="utf-8"))
    chosen = [versions_dir / name for name in ("registry.json", "frozen_holdout.json", "frozen_slices.npz")]
    for entry in registry["versions"].values():
        if entry.get("status") == "deleted":
            continue
        weights = versions_dir / entry["file"]
        chosen += [weights] + [path for path in (weights.with_suffix(".json"),) if path.exists()]
    chosen += [path for path in _files(v2) if path.suffix == ".py" or path.name == "requirements.txt"]
    chosen += _files(v2 / "models", "*.py") + _files(v2 / "utils", "**/*.py")
    chosen += [path for path in _files(v2 / "data", "**/*") if path.suffix != ".zip"]
    chosen += _files(root / "evaluations", "*.json") + _files(root / "examples", "**/*")

    pairs = [(path, path.relative_to(root).as_posix()) for path in chosen]
    for report in _files(root / "evidence", "*/public*.json"):
        pairs.append((report, f"evaluations/from-evidence-{report.parent.name}-{report.name}"))
    original = Path(registry["original_file"])
    pairs.append((original, f"{MODELS_IN_PACK}/{original.name}"))
    missing = [str(source) for source, _ in pairs if not source.is_file()]
    if missing:
        raise SystemExit("Cannot pack: missing " + ", ".join(missing[:10]))
    return pairs


def pack(root, out, v2_root=None, log=print):
    """Copy the selection into out, an empty or new folder; PACKED.json is written last."""
    root, out = Path(root), Path(out)
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} is not empty; choose a new folder.")
    pairs = selection(root, v2_root)
    registry = json.loads((root / "versions" / "registry.json").read_text(encoding="utf-8"))
    files, total = {}, 0
    for count, (source, rel) in enumerate(pairs, 1):
        target = out / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        files[rel] = sha256_file(target)
        total += target.stat().st_size
        if count % 500 == 0 or count == len(pairs):
            log(f"  {count}/{len(pairs)} files, {total / 1e9:.2f} GB")
    manifest = {"schema": 1, "packed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "old_root": str(root), "old_models_dir": str(Path(registry["original_file"]).parent),
                "bytes": total, "files": files}
    temporary = out / (PACK_MANIFEST + ".tmp")
    temporary.write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    temporary.replace(out / PACK_MANIFEST)
    return manifest


def verify(folder):
    """Every reason the pack in folder is not exactly what was packed; empty when it is."""
    folder = Path(folder)
    if not (folder / PACK_MANIFEST).exists():
        return [f"{PACK_MANIFEST} is missing: the pack was not finished, or this is not a pack."]
    manifest = json.loads((folder / PACK_MANIFEST).read_text(encoding="utf-8"))
    problems = []
    for rel, digest in manifest["files"].items():
        path = folder / rel
        if not path.is_file():
            problems.append(f"{rel} is missing")
        elif sha256_file(path) != digest:
            problems.append(f"{rel} differs from the packed file")
    return problems


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    making = commands.add_parser("pack", help="copy the training data into a new folder")
    making.add_argument("--out", required=True, help="a new or empty folder, e.g. on a USB drive")
    making.add_argument("--root", default=str(UNET_ROOT), help="the data root (default: this computer's)")
    checking = commands.add_parser("verify", help="check a pack file by file")
    checking.add_argument("folder")
    args = parser.parse_args(argv)
    if args.command == "pack":
        manifest = pack(args.root, args.out)
        print(f"Packed {len(manifest['files'])} files, {manifest['bytes'] / 1e9:.2f} GB, into {args.out}.")
        return 0
    problems = verify(args.folder)
    if problems:
        print(f"The pack does not check out: {len(problems)} problem(s).")
        for problem in problems[:30]:
            print(f"  {problem}")
        return 1
    print(f"The pack checks out: every file matches {PACK_MANIFEST}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
