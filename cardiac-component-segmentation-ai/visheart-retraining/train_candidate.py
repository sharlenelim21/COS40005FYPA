"""Train a release candidate with the adopted default recipe, in one command.

--recipe whole (the default since 2026-11-01; the supervisor's method, "Bx", Jy's decision
decisions/unet-retraining-default-recipe.md, evidence run decoder-1epoch-1026-145005, kept outside this repository):
  1. every original training patient (make_whole_set.py), leaving out the corrections' patients and every frozen
     test patient, plus
  2. the corrections repeated so they are about 1/11 of the epoch;
  3. a decoder-only fine-tune from the base checkpoint, ONE epoch, keeping the last (finetune.py --select last).

--recipe replay (the earlier default, kept as the rollback; plan WS12, notebook replay_select_last.ipynb, run 0925-1347):
  1. the corrections export, plus
  2. a replay set of original training slices, --replay-ratio times as many as the corrected slices (at most
     --max-replay), drawn by make_replay_set.py with the corrections' patients and every frozen test patient left out;
  3. a decoder-only fine-tune from the base checkpoint, 20 epochs, keeping the last.

finetune.py on its own still defaults to --select best: keeping the last epoch without replay was never tested.
Nothing is registered or activated here. Evaluate, register and compare as usual (plan Tasks 4.4 and 5.2).

  python train_candidate.py --export EXPORT_DIR --label LABEL
        [--recipe whole|replay]      default: whole
        [--base-checkpoint PATH]     default: the registry's original
        [--whole-out DIR] [--cache-dir DIR]                                                   whole only
        [--replay-ratio 10] [--max-replay 1000] [--replay-seed 20260924] [--replay-out DIR]   replay only
        [--seed 42] [--epochs 1 (whole) / 20 (replay)] [--max-val-slices 200] [--image-size 256]
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
import make_whole_set  # noqa: E402
from common import DEFAULT_V2_ROOT, UNET_ROOT, sha256_file  # noqa: E402
from evaluate import atomic_write_json  # noqa: E402
from frozen_guard import DEFAULT_INDEX, FrozenIndex  # noqa: E402
from versions import DEFAULT_REGISTRY  # noqa: E402

RECIPES = {
    "whole": {"name": "whole dataset + corrections 1:10, decoder only, 1 epoch",
              "decided_in": "decisions/unet-retraining-default-recipe.md, 2026-11-01 (supervisor's method; evidence run "
                            "decoder-1epoch-1026-145005, kept outside the repository)",
              "epochs": 1},
    "replay": {"name": "corrections + replay 1:10, decoder only, last epoch",
               "decided_in": "replay_select_last.ipynb, run 0925-1347 (plan WS12; evidence kept outside the repository)",
               "epochs": 20},
}
DEFAULT_RECIPE = "whole"
RECIPE = RECIPES[DEFAULT_RECIPE]["name"]
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
    parser.add_argument("--recipe", choices=sorted(RECIPES), default=DEFAULT_RECIPE)
    parser.add_argument("--base-checkpoint")
    parser.add_argument("--whole-out", help="whole: default whole-<label> beside the export")
    parser.add_argument("--cache-dir", default=str(Path(UNET_ROOT) / "cache"),
                        help="whole: where each source's frozen check is cached")
    parser.add_argument("--replay-ratio", type=int, default=10)
    parser.add_argument("--max-replay", type=int, default=1000, help="bounds the CPU time of one fine-tune")
    parser.add_argument("--replay-seed", type=int, default=20260924)
    parser.add_argument("--replay-out", help="default: replay-<label> beside the export")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--epochs", type=int, help="default: 1 for whole, 20 for replay")
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
    recipe = RECIPES[args.recipe]
    epochs = args.epochs or recipe["epochs"]
    common_args = ["--base-checkpoint", str(base), "--val", *args.val, "--output-dir", str(output_dir), "--label",
                   args.label, "--epochs", str(epochs), "--seed", str(args.seed), "--max-val-slices",
                   str(args.max_val_slices), "--image-size", str(args.image_size), "--frozen-slices", str(index_path),
                   "--select", "last"]
    frozen_meta = {"path": str(index_path.resolve()), "sha256": sha256_file(index_path)}
    if args.recipe == "whole":
        whole_out = Path(args.whole_out) if args.whole_out else export.parent / f"whole-{args.label}"
        print("building the whole training set (the first run checks every public volume against the frozen set)",
              flush=True)
        try:
            whole = make_whole_set.build(sources, export, whole_out, index, frozen_meta, args.cache_dir)
        except SystemExit as error:
            print(f"whole set not built: {error}")
            return 1
        print(f"whole set: {whole['whole_slices']} slices + {corrected} corrected slices x {whole['repeats']} "
              f"({whole['correction_share']:.1%} of the epoch) -> {whole_out}", flush=True)
        train_args = [x for images, masks in make_whole_set.train_folders(whole_out, whole)
                      for x in ("--train", str(images), str(masks))]
        block = {"whole_slices": whole["whole_slices"], "repeats": whole["repeats"],
                 "correction_share": whole["correction_share"], "whole_set": str(whole_out.resolve()),
                 "excluded": [(e["source"], e["patient"], e["reason"]) for e in whole["excluded"]]}
    else:
        replay_slices = min(args.replay_ratio * corrected, args.max_replay)
        replay_out = Path(args.replay_out) if args.replay_out else export.parent / f"replay-{args.label}"
        try:
            replay = make_replay_set.build(sources, replay_slices, replay_out, exclude_like=export / "images",
                                           frozen_index=index, seed=args.replay_seed, frozen_meta=frozen_meta)
        except SystemExit as error:
            print(f"replay set not built: {error}")
            return 1
        print(f"replay set: {replay['slices']} slices from "
              f"{sum(len(s['patients']) for s in replay['sources'].values())} patients -> {replay_out}")
        train_args = ["--train", str(export / "images"), str(export / "masks"),
                      "--train", str(replay_out / "images"), str(replay_out / "masks")]
        block = {"replay_ratio": args.replay_ratio, "max_replay": args.max_replay, "replay_slices": replay["slices"],
                 "replay_seed": args.replay_seed, "replay_set": str(replay_out.resolve()),
                 "excluded": [(e["source"], e["patient"], e["reason"]) for e in replay["excluded"]]}

    code = finetune.main([*train_args, *common_args])
    if code != 0:
        return code
    metadata_path = output_dir / f"{args.label}.json"
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    metadata["recipe"] = {"key": args.recipe, "name": recipe["name"], "decided_in": recipe["decided_in"],
                          "epochs": epochs, "corrected_slices": corrected, **block}
    atomic_write_json(metadata_path, metadata)
    print(f"candidate {args.label} trained with the {args.recipe} recipe. Next: evaluate.py on the frozen set, then "
          f"versions.py register --label {args.label} and versions.py compare (plan Tasks 4.4 and 5.2).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
