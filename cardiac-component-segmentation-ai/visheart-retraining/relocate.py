"""Move the retraining data to another root, after checking every file (plan linux-and-cpu-support, Task 2).

The registry, the frozen manifest and the pipeline's reports name files by absolute path. After the data folder is
copied to another machine or root (for example from E:\\Jy\\Unet on Windows to ~/visheart-unet on Linux), run this
once there:

  python relocate.py --old-root E:\\Jy\\Unet [--new-root DIR] [--models-dir DIR] [--dry-run]

--new-root defaults to the data root (VISHEART_UNET_ROOT, else the platform default), and --models-dir to this
repository's visheart-inference-gpu/app/models. Nothing is written unless every file checks out:
- the moved frozen manifest verifies (holdout.verify: every frozen file present, with its recorded SHA-256);
- the moved registry passes Registry.integrity_problem (the original and the active slot);
- every version that is not deleted has its checkpoint, with its hash.

Then the registry, the manifest, the frozen index and the pipeline's reports are copied to
versions/relocation-backup-<time>/, rewritten, and the frozen index is rebuilt from content, because its hash
covers the manifest's paths. Reports under evidence/ are never touched.
"""
import argparse
import copy
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import holdout  # noqa: E402
import versions  # noqa: E402
from common import REPO_MODELS, UNET_ROOT, sha256_file  # noqa: E402
from evaluate import atomic_write_json, read_json  # noqa: E402
from frozen_guard import build as build_index  # noqa: E402


def _parts(path):
    """A path's parts, whichever separator it uses: 'E:\\Jy\\Unet' and 'E:/Jy/Unet' give ['E:', 'Jy', 'Unet']."""
    return [part for part in str(path).replace("\\", "/").split("/") if part]


def moved(value, old_root, new_root):
    """`value` under `new_root` instead of `old_root` (compared without regard to case), or None if it is not under it."""
    old, parts = [part.lower() for part in _parts(old_root)], _parts(value)
    if [part.lower() for part in parts[:len(old)]] != old:
        return None
    return Path(new_root, *parts[len(old):])


def plan(versions_dir, evaluations, old_root, new_root, models):
    """The rewritten manifest, registry and reports, and the paths that could not be moved."""
    problems = []
    manifest = copy.deepcopy(read_json(versions_dir / "frozen_holdout.json"))
    for name, arm in manifest["public"].items():
        for key in ("images", "masks"):
            target = moved(arm[key], old_root, new_root)
            if target is None:
                problems.append(f"frozen set {name}: {arm[key]} is not under {old_root}")
            else:
                arm[key] = str(target)

    registry = copy.deepcopy(read_json(versions_dir / "registry.json"))
    old_models = "/".join(_parts(registry["original_file"])[:-1])
    for key in ("original_file", "active_slot"):
        target = moved(registry[key], old_models, models)
        if target is None:
            problems.append(f"registry {key}: {registry[key]} is not in the original's folder {old_models}")
        else:
            registry[key] = str(target)

    reports = {}
    for path in sorted(evaluations.glob("*.json")) if evaluations.is_dir() else []:
        try:
            report = read_json(path)
        except (OSError, ValueError):
            continue
        datasets = report.get("datasets") if isinstance(report, dict) else None
        if not isinstance(datasets, dict):
            continue
        changed = False
        for entry in datasets.values():
            for key in ("images", "masks"):
                target = moved(entry.get(key, ""), old_root, new_root) if isinstance(entry, dict) else None
                if target is not None:
                    entry[key], changed = str(target), True
        if changed:
            reports[path] = report
    return manifest, registry, reports, problems


def check(versions_dir, manifest, registry):
    """Every reason the moved files do not check out; empty when they all do."""
    problems = []
    with tempfile.TemporaryDirectory() as scratch:
        moved_manifest = Path(scratch) / "frozen_holdout.json"
        atomic_write_json(moved_manifest, manifest)
        problems += [f"frozen set: {problem}" for problem in holdout.verify(moved_manifest)]
    moved_registry = versions.Registry(versions_dir / "registry.json")
    moved_registry.data = registry
    problem = moved_registry.integrity_problem()
    if problem:
        problems.append(f"registry: {problem}")
    for label, entry in registry["versions"].items():
        if entry.get("status") == "deleted":
            continue
        weights = versions_dir / entry["file"]
        if not weights.exists():
            problems.append(f"version {label}: {weights} is missing")
        elif sha256_file(weights) != entry["sha256"]:
            problems.append(f"version {label}: {weights} is not the registered file")
    return problems


def write(versions_dir, manifest, registry, reports, old_root, new_root):
    backup = versions_dir / f"relocation-backup-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}"
    (backup / "evaluations").mkdir(parents=True)
    for name in ("registry.json", "frozen_holdout.json", "frozen_slices.npz"):
        if (versions_dir / name).exists():
            shutil.copy2(versions_dir / name, backup / name)
    for path in reports:
        shutil.copy2(path, backup / "evaluations" / path.name)
    versions.record(registry, "relocate", registry["original"], old_root=str(old_root), new_root=str(new_root))
    atomic_write_json(versions_dir / "frozen_holdout.json", manifest)
    atomic_write_json(versions_dir / "registry.json", registry)
    for path, report in reports.items():
        atomic_write_json(path, report)
    build_index(versions_dir / "frozen_holdout.json", versions_dir / "frozen_slices.npz")
    return backup


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--old-root", required=True, help="the data root the files name now, e.g. E:\\Jy\\Unet")
    parser.add_argument("--new-root", default=str(UNET_ROOT), help="where the data is now (default: the data root)")
    parser.add_argument("--models-dir", default=str(REPO_MODELS),
                        help="the inference service's models folder here (default: this repository's)")
    parser.add_argument("--dry-run", action="store_true", help="check everything, write nothing")
    args = parser.parse_args(argv)
    new_root, models = Path(args.new_root), Path(args.models_dir)
    versions_dir, evaluations = new_root / "versions", new_root / "evaluations"

    manifest, registry, reports, problems = plan(versions_dir, evaluations, args.old_root, new_root, models)
    if not problems:
        problems = check(versions_dir, manifest, registry)
    if problems:
        print(f"Nothing was changed: {len(problems)} problem(s).")
        for problem in problems[:30]:
            print(f"  {problem}")
        return 1
    files = sum(len(arm["image_files"]) + len(arm["mask_files"]) for arm in manifest["public"].values())
    summary = (f"{files} frozen files verified; registry and {len(registry['versions'])} version entries verified; "
               f"{len(reports)} report(s) to rewrite")
    if args.dry_run:
        print(f"Dry run, nothing written. {summary}.")
        return 0
    backup = write(versions_dir, manifest, registry, reports, args.old_root, new_root)
    print(f"Moved from {args.old_root} to {new_root}. {summary}; frozen index rebuilt. Backup: {backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
