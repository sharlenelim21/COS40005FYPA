"""Active-learning review queue (proposal 2.5, spec 6): which uncorrected projects a doctor should check first.

Reads the volumes and review_manifest.json written by SRV/src/scripts/export_review_volumes.ts. Each slice is
preprocessed as evaluate.py scores it (min-max per slice, bilinear to 256 x 256), and the model's softmax gives:

  per pixel : entropy over the 4 classes, divided by log 4, so 0 = certain and 1 = uniform. 0.5 is a coin flip
              between two classes, and a pixel at or above --unsure-entropy counts as unsure.
  per slice : mean entropy over the heart region, the pixels given at least --foreground-min-prob of heart.
              Averaging over the whole image would let the confident background dilute every score.
  per case  : mean over the slices that have a heart region.

Ranking by uncertainty alone tends to return cases that are hard in the same way (proposal 2.5), so selection is
greedy: each pick maximises  normalised uncertainty + --diversity-weight x normalised novelty,  where novelty is
the cosine distance, in pooled deepest-encoder features, to the nearest corrected or already-queued case.
Corrected projects are never queued; they seed the novelty term instead. A project holding any slice of the frozen
test set (frozen_guard.py) is left out whole, and listed under "excluded".

Every run writes a new file and never overwrites one: the queues are the record of which cases the system
suggested, so a later comparison with the doctor's own choices stays possible (proposal 2.5).

  python review_queue.py --manifest DIR/review_manifest.json --output queue.json
                         [--checkpoint PATH] [--top 10] [--diversity-weight 1.0] [--batch-size 8]
                         [--foreground-min-prob 0.1] [--unsure-entropy 0.5] [--frozen-slices frozen_slices.npz]
"""
import argparse
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import nibabel as nib
import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DEFAULT_V2_ROOT, build_model, sha256_file  # noqa: E402
from evaluate import MAX_PLAUSIBLE_SLICES, atomic_write_json, normalize  # noqa: E402
from frozen_guard import DEFAULT_INDEX, FrozenIndex, load_volume  # noqa: E402

DEFAULT_CHECKPOINT = DEFAULT_V2_ROOT / "models" / "checkpoints" / "unet.pth"
IMAGE_SIZE = 256
TOP_SLICES = 5


def normalized_entropy(probs):
    """probs [B, C, H, W] -> [B, H, W] in [0, 1]."""
    return -(probs * torch.log(probs.clamp_min(1e-12))).sum(dim=1) / math.log(probs.shape[1])


def slice_uncertainty(probs, foreground_min_prob, unsure_entropy):
    """One entry per slice: None without a heart region, else its mean entropy there and the unsure count."""
    entropy = normalized_entropy(probs)
    region = (1.0 - probs[:, 0]) >= foreground_min_prob
    results = []
    for i in range(probs.shape[0]):
        pixels = int(region[i].sum())
        if pixels == 0:
            results.append(None)
            continue
        values = entropy[i][region[i]]
        results.append({"score": float(values.mean()), "region_pixels": pixels,
                        "unsure_pixels": int((values >= unsure_entropy).sum())})
    return results


def load_slices(path):
    """Every (frame, slice) of a 3D or 4D volume, preprocessed as evaluate.py does, in frame-then-slice order."""
    data = np.asanyarray(nib.load(str(path)).dataobj, dtype=np.float32)
    if data.ndim == 3:
        data = data[..., np.newaxis]
    if data.ndim != 4 or not 1 <= data.shape[2] <= MAX_PLAUSIBLE_SLICES:
        raise ValueError(f"{Path(path).name}: expected H x W x slices [x frames], got {data.shape}")
    index = [(t, z) for t in range(data.shape[3]) for z in range(data.shape[2])]
    slices = torch.from_numpy(np.stack([normalize(data[:, :, z, t]) for t, z in index])).unsqueeze(1)
    return F.interpolate(slices, size=(IMAGE_SIZE, IMAGE_SIZE), mode="bilinear", align_corners=False), index


def score_volume(model, path, batch_size=8, foreground_min_prob=0.1, unsure_entropy=0.5):
    slices, index = load_slices(path)
    pooled = []
    hook = None
    if hasattr(model, "encoder"):
        # The encoder yields NHWC maps (UNet2D.forward permutes them), so pool over dims 1 and 2.
        hook = model.encoder.register_forward_hook(lambda _m, _i, out: pooled.append(out[-1].mean(dim=(1, 2))))
    results = []
    try:
        model.eval()
        with torch.no_grad():
            for start in range(0, len(slices), batch_size):
                probs = torch.softmax(model(slices[start:start + batch_size]), dim=1)
                results.extend(slice_uncertainty(probs, foreground_min_prob, unsure_entropy))
    finally:
        if hook is not None:
            hook.remove()

    scored = [i for i, r in enumerate(results) if r is not None]
    embedding = None
    if pooled:
        features = torch.cat(pooled).double().numpy()
        vector = features[scored].mean(axis=0) if scored else features.mean(axis=0)
        norm = np.linalg.norm(vector)
        embedding = vector / norm if norm > 0 else vector
    ranked = sorted(scored, key=lambda i: -results[i]["score"])[:TOP_SLICES]
    region = sum(results[i]["region_pixels"] for i in scored)
    return {
        "uncertainty": float(np.mean([results[i]["score"] for i in scored])) if scored else None,
        "unsure_fraction": sum(results[i]["unsure_pixels"] for i in scored) / region if region else None,
        "slices_scored": len(scored),
        "slices_total": len(results),
        "top_slices": [{"frameindex": index[i][0], "sliceindex": index[i][1], "score": round(results[i]["score"], 4)}
                       for i in ranked],
        "embedding": embedding,
    }


def cosine_distance(a, b):
    if a is None or b is None:
        return 0.0
    denominator = float(np.linalg.norm(a) * np.linalg.norm(b))
    return 1.0 - float(np.dot(a, b)) / denominator if denominator > 0 else 0.0


def select_queue(pool, seeds, top, diversity_weight):
    """Greedy: uncertainty (min-max over the pool) plus weighted novelty against everything chosen so far."""
    pool = list(pool)
    if not pool:
        return []
    values = [c["uncertainty"] for c in pool]
    low, high = min(values), max(values)
    u_norm = {id(c): (c["uncertainty"] - low) / (high - low) if high > low else 1.0 for c in pool}
    chosen = [s for s in seeds if s is not None]
    queue = []
    while pool and len(queue) < top:
        novelty = {id(c): min(cosine_distance(c["embedding"], e) for e in chosen) if chosen else None for c in pool}
        top_novelty = max((n for n in novelty.values() if n is not None), default=0.0)
        rows = []
        for c in pool:
            n = novelty[id(c)]
            n_norm = n / top_novelty if n is not None and top_novelty > 0 else 0.0
            rows.append((u_norm[id(c)] + diversity_weight * n_norm, n, n_norm, c))
        combined, n, n_norm, pick = min(rows, key=lambda r: (-r[0], -r[3]["uncertainty"], str(r[3]["projectId"])))
        queue.append({**pick, "rank": len(queue) + 1, "uncertainty_norm": u_norm[id(pick)], "novelty": n,
                      "novelty_norm": n_norm, "combined": combined})
        pool.remove(pick)
        chosen.append(pick["embedding"])
    return queue


def reason(entry):
    text = (f"the model was unsure on {entry['unsure_fraction']:.0%} of heart-region pixels across "
            f"{entry['slices_scored']} of {entry['slices_total']} slices")
    if entry["top_slices"]:
        worst = entry["top_slices"][0]
        text += f"; most unsure at frame {worst['frameindex']}, slice {worst['sliceindex']}"
    if entry.get("novelty") is not None:
        text += f"; distance {entry['novelty']:.2f} from the nearest corrected or already-queued case"
    return text


def public(entry):
    return {k: v for k, v in entry.items() if k != "embedding"}


def build_queue(manifest, checkpoint, output, frozen_index, top=10, diversity_weight=1.0, batch_size=8,
                foreground_min_prob=0.1, unsure_entropy=0.5, model_factory=None, log=print):
    """frozen_index: a frozen_guard.FrozenIndex; any project holding a frozen test slice is left out whole."""
    manifest, output = Path(manifest), Path(output)
    if output.exists():
        raise FileExistsError(f"{output} already exists; each queue is a record, so write a new file")
    projects = json.loads(manifest.read_text(encoding="utf-8"))["projects"]
    model = (model_factory or (lambda path: build_model(checkpoint=path)))(checkpoint)

    skipped, uncorrected, corrected, excluded = {}, [], [], []
    skip = lambda why: skipped.__setitem__(why, skipped.get(why, 0) + 1)  # noqa: E731
    for project in projects:
        if not project.get("eligible"):
            skip("ineligible")
            continue
        volume = manifest.parent / project["volume"] if project.get("volume") else None
        if volume is None or not volume.exists():
            skip("no_volume")
            continue
        hit = frozen_index.first_match(load_volume(volume))
        if hit:
            skip("frozen_test_patient")
            excluded.append({"projectId": project["projectId"], "name": project.get("name"),
                             "corrected": bool(project.get("corrected")), "frozen_match": hit})
            log(f"{project['projectId']}: left out, frame {hit['frame']} slice {hit['slice']} is frozen {hit['frozen']}")
            continue
        started = time.perf_counter()
        scored = score_volume(model, volume, batch_size, foreground_min_prob, unsure_entropy)
        log(f"{project['projectId']}: uncertainty {scored['uncertainty']}, {scored['slices_total']} slices, "
            f"{time.perf_counter() - started:.1f} s")
        entry = {"projectId": project["projectId"], "name": project.get("name"),
                 "hasUnetResult": bool(project.get("hasUnetResult")), **scored}
        if project.get("corrected"):
            corrected.append(entry)
        elif scored["uncertainty"] is None:
            skip("no_heart_region")
        else:
            uncorrected.append(entry)

    queue = select_queue(uncorrected, [c["embedding"] for c in corrected], top, diversity_weight)
    for entry in queue:
        entry["open"] = f"/project/{entry['projectId']}/segmentation"
        entry["reason"] = reason(entry)
    report = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "checkpoint": {"path": str(checkpoint), "sha256": sha256_file(checkpoint)},
        "manifest": {"path": str(manifest), "sha256": sha256_file(manifest)},
        "frozen_guard": {"slices_indexed": len(frozen_index), "frozen_manifest": frozen_index.manifest},
        "parameters": {"top": top, "diversity_weight": diversity_weight, "foreground_min_prob": foreground_min_prob,
                       "unsure_entropy": unsure_entropy, "image_size": IMAGE_SIZE},
        "counts": {"projects": len(projects), "uncorrected_scored": len(uncorrected), "corrected_seeds": len(corrected),
                   "queued": len(queue), "skipped": skipped},
        "queue": [public(e) for e in queue],
        "scored": [public(e) for e in sorted(uncorrected, key=lambda e: -e["uncertainty"])],
        "corrected": [public(e) for e in corrected],
        "excluded": excluded,
    }
    if output.exists():
        raise FileExistsError(f"{output} appeared while scoring; nothing was written")
    atomic_write_json(output, report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", required=True, help="review_manifest.json from export_review_volumes.ts")
    parser.add_argument("--output", required=True)
    parser.add_argument("--checkpoint", default=str(DEFAULT_CHECKPOINT),
                        help="the serving model, whose masks the doctor will correct")
    parser.add_argument("--top", type=int, default=10)
    parser.add_argument("--diversity-weight", type=float, default=1.0)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--foreground-min-prob", type=float, default=0.1)
    parser.add_argument("--unsure-entropy", type=float, default=0.5)
    parser.add_argument("--frozen-slices", default=str(DEFAULT_INDEX),
                        help="frozen_guard.py index; projects holding a frozen test slice are never queued")
    args = parser.parse_args(argv)
    if not Path(args.frozen_slices).exists():
        print(f"frozen-slice index not found: {args.frozen_slices}; build it with frozen_guard.py build")
        return 1
    frozen = FrozenIndex.load(args.frozen_slices)
    if frozen.manifest_problem():
        print(frozen.manifest_problem())
        return 1
    try:
        report = build_queue(args.manifest, args.checkpoint, args.output, frozen, args.top, args.diversity_weight,
                             args.batch_size, args.foreground_min_prob, args.unsure_entropy)
    except FileExistsError as exc:
        print(exc)
        return 1
    for e in report["excluded"]:
        print(f"left out {e['projectId']} {e['name'] or ''}: frozen test slice {e['frozen_match']['frozen']}")
    print(json.dumps(report["counts"], indent=2))
    for e in report["queue"]:
        run_first = "" if e["hasUnetResult"] else "  (run UNet on it first)"
        print(f"{e['rank']:>2}. {e['projectId']}  {e['name'] or ''}  uncertainty {e['uncertainty']:.3f}  "
              f"{e['open']}{run_first}\n    {e['reason']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
