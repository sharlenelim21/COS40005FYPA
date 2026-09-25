"""Score UNet checkpoints on held-out volumes: per-volume Dice, and every checkpoint against the first.

Scoring matches the raw arm of E:\\Jy\\Unet\\diagnostics\\evaluate_unet_orientation_resumable.py, so the
production baseline reproduces: one whole volume per case, each slice min-max normalised, image resized
bilinear and label nearest to 256 x 256, argmax, Dice per class over the stack. Resumable: a label's scored
cases are kept while its checkpoint's SHA-256 is unchanged.

  python evaluate.py --checkpoint base PATH --checkpoint new PATH
                     --dataset acdc IMAGES_DIR MASKS_DIR [--dataset ...] --output report.json
                     [--manifest frozen_holdout.json] [--batch-size 4] [--max-cases N]
"""
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

import nibabel as nib
import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import build_model, sha256_file  # noqa: E402

CLASSES = ("background", "rv", "myocardium", "lv_cavity")
CARDIAC = CLASSES[1:]
MAX_PLAUSIBLE_SLICES = 64  # BUG-005 guard, as in the diagnostic script


def dice_by_class(prediction, target):
    scores = {}
    for index, name in enumerate(CLASSES):
        predicted, expected = prediction == index, target == index
        scores[name] = float((2 * (predicted & expected).sum() + 1e-6) / (predicted.sum() + expected.sum() + 1e-6))
    return scores


def normalize(image):
    image = np.nan_to_num(image.astype(np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    low, high = float(image.min()), float(image.max())
    return np.zeros_like(image) if high - low < 1e-8 else (image - low) / (high - low)


def score_case(model, image_path, mask_path, batch_size=4):
    image = np.asanyarray(nib.load(str(image_path)).dataobj, dtype=np.float32)
    mask = np.asanyarray(nib.load(str(mask_path)).dataobj, dtype=np.int64)
    if image.shape != mask.shape or image.ndim != 3:
        raise ValueError(f"{Path(image_path).name}: expected paired 3D volumes, got {image.shape} vs {mask.shape}")
    if not 1 <= image.shape[2] <= MAX_PLAUSIBLE_SLICES:
        raise ValueError(f"{Path(image_path).name}: implausible slice count {image.shape[2]}")
    slices = torch.from_numpy(np.stack([normalize(image[:, :, i]) for i in range(image.shape[2])])).unsqueeze(1)
    target = torch.from_numpy(np.stack([mask[:, :, i] for i in range(mask.shape[2])]).astype(np.float32)).unsqueeze(1)
    slices = F.interpolate(slices, size=(256, 256), mode="bilinear", align_corners=False)
    target = F.interpolate(target, size=(256, 256), mode="nearest").squeeze(1).to(torch.int64)
    outputs = []
    with torch.no_grad():
        for start in range(0, len(slices), batch_size):
            outputs.append(torch.argmax(model(slices[start:start + batch_size]), dim=1).cpu())
    return dice_by_class(torch.cat(outputs).numpy(), target.numpy())


def list_cases(images_dir, masks_dir):
    cases = []
    for image in sorted(Path(images_dir).glob("*.nii.gz")):
        mask = Path(masks_dir) / image.name.replace(".nii.gz", "_gt.nii.gz")
        if mask.exists():
            cases.append((image.name, image, mask))
    return cases


def cardiac_mean(scores):
    return float(np.mean([scores[name] for name in CARDIAC]))


def paired_bootstrap(deltas, iterations=2000, seed=20260914):
    deltas = np.asarray(deltas, dtype=np.float64)
    rng = np.random.default_rng(seed)
    means = deltas[rng.integers(0, len(deltas), size=(iterations, len(deltas)))].mean(axis=1)
    return [float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))]


def compare(base_scores, other_scores):
    shared = sorted(set(base_scores) & set(other_scores))
    deltas = [cardiac_mean(other_scores[case]) - cardiac_mean(base_scores[case]) for case in shared]
    if not deltas:
        return {"n": 0}
    return {"n": len(deltas), "mean_delta_cardiac": float(np.mean(deltas)), "ci95": paired_bootstrap(deltas),
            "better": int(sum(d > 1e-9 for d in deltas)), "worse": int(sum(d < -1e-9 for d in deltas)),
            "tied": int(sum(abs(d) <= 1e-9 for d in deltas))}


def summarize(scores):
    if not scores:
        return {"n": 0}
    return {"n": len(scores),
            "per_class_mean": {name: float(np.mean([s[name] for s in scores.values()])) for name in CLASSES},
            "cardiac_mean": float(np.mean([cardiac_mean(s) for s in scores.values()]))}


def atomic_write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, indent=2)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def evaluate(checkpoints, datasets, output, batch_size=4, max_cases=None, model_factory=None, log=print):
    """checkpoints: [(label, path)], the first is the baseline; datasets: [(name, images_dir, masks_dir)]."""
    output = Path(output)
    report = json.loads(output.read_text(encoding="utf-8")) if output.exists() else {}
    report.setdefault("checkpoints", {})
    report.setdefault("scores", {})
    report["datasets"] = {name: {"images": str(images), "masks": str(masks)} for name, images, masks in datasets}
    factory = model_factory or (lambda path: build_model(checkpoint=path))
    for label, path in checkpoints:
        digest = sha256_file(path)
        if report["checkpoints"].get(label, {}).get("sha256") != digest:
            report["scores"][label] = {}  # a different file under this label invalidates its old scores
        report["checkpoints"][label] = {"path": str(path), "sha256": digest}
        model = factory(path)
        model.eval()
        for name, images, masks in datasets:
            done = report["scores"][label].setdefault(name, {})
            for case, image, mask in list_cases(images, masks)[:max_cases]:
                if case not in done:
                    done[case] = score_case(model, image, mask, batch_size)
                    atomic_write_json(output, report)
            log(f"{label} / {name}: {len(done)} cases scored")
    base = checkpoints[0][0]
    report["baseline"] = base
    report["summary"] = {label: {name: summarize(report["scores"][label].get(name, {})) for name, _, _ in datasets}
                         for label, _ in checkpoints}
    report["comparison"] = {label: {name: compare(report["scores"][base].get(name, {}),
                                                  report["scores"][label].get(name, {}))
                                    for name, _, _ in datasets}
                            for label, _ in checkpoints[1:]}
    atomic_write_json(output, report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", nargs=2, action="append", required=True, metavar=("LABEL", "PATH"))
    parser.add_argument("--dataset", nargs=3, action="append", required=True,
                        metavar=("NAME", "IMAGES_DIR", "MASKS_DIR"))
    parser.add_argument("--output", required=True)
    parser.add_argument("--manifest", help="frozen held-out manifest; nothing is scored unless it verifies")
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--max-cases", type=int, default=None)
    args = parser.parse_args(argv)
    if args.manifest:
        from holdout import verify
        problems = verify(args.manifest)
        if problems:
            print("frozen manifest does not verify — nothing scored:\n" + "\n".join(problems))
            return 1
    report = evaluate([tuple(c) for c in args.checkpoint], [tuple(d) for d in args.dataset], args.output,
                      args.batch_size, args.max_cases)
    print(json.dumps({"summary": report["summary"], "comparison": report["comparison"]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
