"""Train a release candidate with the adopted default recipe, in one command.

The recipe was decided by a rule written before the runs (plan WS12; Jy's decision notebook
replay_select_last.ipynb, run 0925-1347, kept with the evidence outside this repository):
  1. the corrections export, plus
  2. a replay set of original training slices, --replay-ratio times as many as the corrected slices (at most
     --max-replay), drawn by make_replay_set.py with the corrections' patients and every frozen test patient left out;
  3. a decoder-only fine-tune from the base checkpoint that keeps the LAST epoch (finetune.py --select last).

finetune.py on its own still defaults to --select best: keeping the last epoch without replay was never tested.
Nothing is registered or activated here. Evaluate, register and compare as usual (plan Tasks 4.4 and 5.2).

  python train_candidate.py --export EXPORT_DIR --label LABEL
        [--base-checkpoint PATH]     default: the registry's original
        [--replay-ratio 10] [--max-replay 1000] [--replay-seed 20260924] [--replay-out DIR]
        [--seed 42] [--epochs 20] [--max-val-slices 200] [--image-size 256]
        [--source NAME IMAGES MASKS ...]  default: training-acdc, Training-mms, Training-mms2 of the v2 data
        [--val IMAGES MASKS]              default: Validation-mms
        [--output-dir DIR] [--frozen-slices frozen_slices.npz]

The version's metadata gains a "recipe" block that names all of the above.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import finetune  # noqa: E402
import make_replay_set  # noqa: E402
from common import DEFAULT_V2_ROOT, sha256_file  # noqa: E402
from evaluate import atomic_write_json  # noqa: E402
from frozen_guard import DEFAULT_INDEX, FrozenIndex  # noqa: E402
from versions import DEFAULT_REGISTRY  # noqa: E402

RECIPE = "corrections + replay 1:10, decoder only, last epoch"
DECIDED_IN = "replay_select_last.ipynb, run 0925-1347 (plan WS12; evidence kept outside the repository)"
DATA = Path(DEFAULT_V2_ROOT) / "data"
DEFAULT_SOURCES = [("acdc", DATA / "training-acdc" / "training"), ("mms1", DATA / "Training-mms" / "Training"),
                   ("mms2", DATA / "Training-mms2" / "Training")]


def original_checkpoint(registry_path):
    registry = Path(registry_path)
    if not registry.exists():
        return None
    data = json.loads(registry.read_text(encoding="utf-8"))
    return registry.parent / data["versions"][data["original"]]["file"]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--export", required=True, help="a corrections export: images/, masks/, export_manifest.json")
    parser.add_argument("--label", required=True)
    parser.add_argument("--base-checkpoint")
    parser.add_argument("--replay-ratio", type=int, default=10)
    parser.add_argument("--max-replay", type=int, default=1000, help="bounds the CPU time of one fine-tune")
    parser.add_argument("--replay-seed", type=int, default=20260924)
    parser.add_argument("--replay-out", help="default: replay-<label> beside the export")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--max-val-slices", type=int, default=200)
    parser.add_argument("--image-size", type=int, default=256)
    parser.add_argument("--source", nargs=3, action="append", metavar=("NAME", "IMAGES_DIR", "MASKS_DIR"))
    parser.add_argument("--val", nargs=2, metavar=("IMAGES_DIR", "MASKS_DIR"),
                        default=[str(DATA / "Validation-mms" / "Validation" / "images"),
                                 str(DATA / "Validation-mms" / "Validation" / "masks")])
    parser.add_argument("--output-dir", default=str(Path(DEFAULT_REGISTRY).parent))
    parser.add_argument("--frozen-slices", default=str(DEFAULT_INDEX))
    args = parser.parse_args(argv)

    export = Path(args.export)
    manifest_path = export / "export_manifest.json"
    if not manifest_path.exists():
        print(f"{manifest_path} not found: --export must be a folder written by export_training_set.ts")
        return 1
    corrected = int(json.loads(manifest_path.read_text(encoding="utf-8"))["counts"]["slices"])
    if corrected < 1:
        print("the export holds no corrected slices")
        return 1
    output_dir = Path(args.output_dir)
    if (output_dir / f"{args.label}.pth").exists() or (output_dir / f"{args.label}.json").exists():
        print(f"{args.label} already exists in {output_dir}; versions are never overwritten")
        return 1
    base = Path(args.base_checkpoint) if args.base_checkpoint else original_checkpoint(DEFAULT_REGISTRY)
    if base is None or not base.exists():
        print("no base checkpoint: pass --base-checkpoint, or run versions.py init first")
        return 1
    index_path = Path(args.frozen_slices)
    if not index_path.exists():
        print(f"frozen-slice index not found: {index_path}; build it with frozen_guard.py build")
        return 1
    index = FrozenIndex.load(index_path)
    if index.manifest_problem():
        print(index.manifest_problem())
        return 1

    sources = ([tuple(s) for s in args.source] if args.source
               else [(name, folder / "images", folder / "masks") for name, folder in DEFAULT_SOURCES])
    replay_slices = min(args.replay_ratio * corrected, args.max_replay)
    replay_out = Path(args.replay_out) if args.replay_out else export.parent / f"replay-{args.label}"
    try:
        replay = make_replay_set.build(sources, replay_slices, replay_out, exclude_like=export / "images", frozen_index=index,
                                       seed=args.replay_seed,
                                       frozen_meta={"path": str(index_path.resolve()), "sha256": sha256_file(index_path)})
    except SystemExit as error:
        print(f"replay set not built: {error}")
        return 1
    print(f"replay set: {replay['slices']} slices from "
          f"{sum(len(s['patients']) for s in replay['sources'].values())} patients -> {replay_out}")

    code = finetune.main([
        "--base-checkpoint", str(base), "--train", str(export / "images"), str(export / "masks"),
        "--train", str(replay_out / "images"), str(replay_out / "masks"), "--val", *args.val,
        "--output-dir", str(output_dir), "--label", args.label, "--epochs", str(args.epochs), "--seed", str(args.seed),
        "--max-val-slices", str(args.max_val_slices), "--image-size", str(args.image_size),
        "--frozen-slices", str(index_path), "--select", "last"])
    if code != 0:
        return code
    metadata_path = output_dir / f"{args.label}.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata["recipe"] = {"name": RECIPE, "decided_in": DECIDED_IN, "corrected_slices": corrected,
                          "replay_ratio": args.replay_ratio, "max_replay": args.max_replay, "replay_slices": replay["slices"],
                          "replay_seed": args.replay_seed, "replay_set": str(replay_out.resolve()),
                          "excluded": [(e["source"], e["patient"], e["reason"]) for e in replay["excluded"]]}
    atomic_write_json(metadata_path, metadata)
    print(f"candidate {args.label} trained with the default recipe. Next: evaluate.py on the frozen set, then "
          f"versions.py register --label {args.label} and versions.py compare (plan Tasks 4.4 and 5.2).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
