"""Example scans for the Extend Training page's Results tab (plan WS13 R1).

For each frozen-set dataset, from the per-case scores a report already holds: the scan whose cardiac-mean Dice changed
least under the new version (the largest drop, whenever there is one), the median one, and the one that changed most.
Both versions predict those scans with scoring's own preprocessing (evaluate.load_case and evaluate.predict), so the
page shows what was scored. The image, the expert mask and both predictions are written as 256 x 256 PNGs, one folder
per scan, with index.json. A new set is written beside the old one and swapped in whole.

  python render_examples.py --label LABEL [--against LABEL] [--report REPORT.json] [--out FOLDER] [--registry PATH]

Without --report, the newest complete report that scored both registered files is used (pipeline.find_report).
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pipeline  # noqa: E402
import versions  # noqa: E402
from common import build_model  # noqa: E402
from evaluate import atomic_write_json, cardiac_mean, load_case, predict  # noqa: E402
from jobs import now  # noqa: E402

ROLES = ("lowest", "median", "highest")  # rank names: true even when a dataset has no drop at all


def pick_scans(report, against, label):
    """Per dataset, in name order: the lowest, the median and the highest change in cardiac-mean Dice."""
    picks, scores = [], report.get("scores", {})
    for name in sorted(scores.get(label, {})):
        base, new = scores.get(against, {}).get(name, {}), scores[label][name]
        shared = sorted(set(base) & set(new))
        if not shared:
            continue
        delta = {case: cardiac_mean(new[case]) - cardiac_mean(base[case]) for case in shared}
        ranked = sorted(shared, key=lambda case: (delta[case], case))
        chosen = {"lowest": ranked[0], "median": ranked[len(ranked) // 2], "highest": ranked[-1]}
        taken = set()
        for role in ROLES:
            case = chosen[role]
            if case in taken:
                continue
            taken.add(case)
            picks.append({"dataset": name, "case": case, "role": role, "delta": delta[case],
                          "scores": {"against": base[case], "label": new[case]}})
    return picks


def save_png(path, array):
    Image.fromarray(np.ascontiguousarray(array, dtype=np.uint8)).save(path, optimize=True)


def render(picks, datasets, models, out, batch_size=4, log=print, meta=None):
    """datasets: {name: (images_dir, masks_dir)}; models: {"against": model, "label": model}. Returns the entries."""
    out = Path(out)
    partial = out.with_name(out.name + ".partial")
    shutil.rmtree(partial, ignore_errors=True)
    partial.mkdir(parents=True)
    entries = []
    for n, pick in enumerate(picks):
        images, masks = datasets[pick["dataset"]]
        slices, target = load_case(Path(images) / pick["case"],
                                   Path(masks) / pick["case"].replace(".nii.gz", "_gt.nii.gz"))
        predictions = {role: predict(model, slices, batch_size) for role, model in models.items()}
        folder = partial / str(n)
        folder.mkdir()
        for k in range(slices.shape[0]):
            save_png(folder / f"image_{k}.png", np.round(slices[k, 0].numpy() * 255))
            save_png(folder / f"truth_{k}.png", target[k].numpy())
            for role, labels in predictions.items():
                save_png(folder / f"{role}_{k}.png", labels[k])
        entries.append({"n": n, **{key: pick[key] for key in ("dataset", "case", "role", "delta", "scores")},
                        "slices": int(slices.shape[0])})
        log(json.dumps({"example": n + 1, "of": len(picks)}))
    atomic_write_json(partial / "index.json", {**(meta or {}), "created_at": now(), "size": 256, "examples": entries})
    if out.exists():
        shutil.rmtree(out)
    partial.rename(out)
    return entries


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--label", required=True)
    parser.add_argument("--against", help="default: the version it was compared against, else the original")
    parser.add_argument("--report", help="default: the newest complete report that scored both registered files")
    parser.add_argument("--registry", default=versions.DEFAULT_REGISTRY)
    parser.add_argument("--manifest", default=versions.DEFAULT_MANIFEST)
    parser.add_argument("--out", help="default: <unet root>/examples/<label>")
    parser.add_argument("--batch-size", type=int, default=4)
    args = parser.parse_args(argv)
    config = pipeline.default_config()
    registry = versions.Registry(args.registry)
    entry = registry.entry(args.label)
    against = args.against or (entry.get("gate") or {}).get("against") or registry.data["original"]
    wanted = {args.label: entry["sha256"], against: registry.entry(against)["sha256"]}
    expected = pipeline.frozen_expected(args.manifest)
    found = pipeline.find_report([Path(args.report)] if args.report else pipeline.report_paths(config), wanted, expected)
    if found is None:
        print(f"No complete frozen-set report scored both {args.label} and {against} from their registered files.")
        return 1
    path, report = found
    picks = pick_scans(report, against, args.label)
    datasets = {name: (report["datasets"][name]["images"], report["datasets"][name]["masks"]) for name in expected}
    models = {"against": build_model(checkpoint=registry.file(against)).eval(),
              "label": build_model(checkpoint=registry.file(args.label)).eval()}
    out = Path(args.out) if args.out else config.examples / args.label
    render(picks, datasets, models, out, args.batch_size,
           meta={"label": args.label, "against": against, "report": str(path)})
    print(f"{len(picks)} example scans written to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
