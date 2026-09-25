"""Fine-tune the production UNet on exported corrections: a fresh optimiser, the encoder frozen by default,
and a new versioned file that never overwrites anything.

Deliberately not V2/train_runner.py --resume (plan F1): that path expects a wrapped checkpoint, restores the
old optimiser and epoch counter (so a finished run trains 0 more epochs), and writes over unet.pth. Here the
base weights load plain or wrapped, AdamW starts new at --lr, the best epoch is chosen on validation Dice
among the epochs trained, and the output is <label>.pth plus <label>.json in --output-dir.

  python finetune.py --base-checkpoint unet.pth --train IMAGES_DIR MASKS_DIR [--train ...]
                     --val IMAGES_DIR MASKS_DIR --output-dir E:\\Jy\\Unet\\versions --label LABEL
                     [--epochs 20] [--batch-size 8] [--lr 1e-4] [--weight-decay 1e-4] [--val-every 5]
                     [--augmentation corrected|original] [--unfreeze-encoder] [--image-size 256]
                     [--max-val-slices N] [--seed 42] [--frozen-slices frozen_slices.npz] [--select best|last]

--select best (the default) keeps the epoch with the best validation Dice; --select last keeps the final epoch. The
metadata records both the best epoch and the kept one.

Before anything loads, every training slice is checked against the frozen test set (frozen_guard.py). A match,
a missing index or a changed frozen manifest stops the run: nothing may train on a frozen test patient.
"""
import argparse
import copy
import datetime as dt
import json
import os
import random
import re
import sys
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.optim import AdamW
from torch.utils.data import ConcatDataset, DataLoader, Subset

sys.path.insert(0, str(Path(__file__).resolve().parent))
from augment import build_corrected_train_transforms  # noqa: E402
from common import DEFAULT_V2_ROOT, build_model, import_v2, sha256_file  # noqa: E402
from evaluate import atomic_write_json  # noqa: E402
from frozen_guard import DEFAULT_INDEX, FrozenIndex, check_paths  # noqa: E402

NUM_CLASSES = 4
LABEL_PATTERN = r"[A-Za-z0-9][A-Za-z0-9._-]*"


def set_seed(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def freeze_encoder(model):
    for parameter in model.encoder.parameters():
        parameter.requires_grad_(False)


def count_parameters(model):
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    return trainable, sum(p.numel() for p in model.parameters())


def make_loader(pairs, transform, preprocess, batch_size, shuffle, max_slices=None, seed=0):
    parts = [preprocess.Nifti2DSliceDataset(image_dir=str(images), mask_dir=str(masks), transform=transform,
                                            slice_axis=2, drop_empty_mask_slices=False)
             for images, masks in pairs]
    dataset = parts[0] if len(parts) == 1 else ConcatDataset(parts)
    if max_slices and len(dataset) > max_slices:
        dataset = Subset(dataset, sorted(set(np.linspace(0, len(dataset) - 1, max_slices).astype(int).tolist())))
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=shuffle, num_workers=0,
                        generator=torch.Generator().manual_seed(seed))
    return loader, len(dataset)


def run_epoch(model, loader, ce_loss, dice_loss, dice_metric, optimizer=None, encoder_frozen=True):
    training = optimizer is not None
    model.train(training)
    if training and encoder_frozen:
        model.encoder.eval()  # frozen weights must not drift through normalisation or dropout statistics
    total_loss = total_dice = 0.0
    batches = 0
    with torch.set_grad_enabled(training):
        for images, masks in loader:
            images = images.to(dtype=torch.float32)
            masks = masks.to(dtype=torch.long).squeeze(1)
            logits = model(images)
            loss = ce_loss(logits, masks) + dice_loss(logits, masks.unsqueeze(1))
            if training:
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()
            total_loss += float(loss.item())
            total_dice += float(dice_metric(logits.detach(), masks, NUM_CLASSES))
            batches += 1
    return {"loss": total_loss / max(1, batches), "dice": total_dice / max(1, batches)}


def source_manifest(images_dir):
    """The export, control or replay manifest sitting beside images/, if any, so a version names its exact data."""
    for name in ("export_manifest.json", "control_manifest.json", "replay_manifest.json"):
        candidate = Path(images_dir).resolve().parent / name
        if candidate.exists():
            return {"file": str(candidate), "sha256": sha256_file(candidate)}
    return None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-checkpoint", required=True)
    parser.add_argument("--train", nargs=2, action="append", required=True, metavar=("IMAGES_DIR", "MASKS_DIR"))
    parser.add_argument("--val", nargs=2, required=True, metavar=("IMAGES_DIR", "MASKS_DIR"))
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--val-every", type=int, default=5)
    parser.add_argument("--augmentation", choices=("corrected", "original"), default="corrected")
    parser.add_argument("--unfreeze-encoder", action="store_true")
    parser.add_argument("--image-size", type=int, default=256)
    parser.add_argument("--max-val-slices", type=int, default=None)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--select", choices=("best", "last"), default="best",
                        help="keep the epoch with the best validation Dice, or the last epoch (WS11: validation on "
                             "public data can pick an epoch before the corrections are learnt)")
    parser.add_argument("--v2-root", default=str(DEFAULT_V2_ROOT))
    parser.add_argument("--frozen-slices", default=str(DEFAULT_INDEX),
                        help="frozen_guard.py index of the frozen test set; training refuses to start without it")
    args = parser.parse_args(argv)
    if not re.fullmatch(LABEL_PATTERN, args.label):
        parser.error(f"--label must match {LABEL_PATTERN}")
    if args.epochs < 1 or args.val_every < 1:
        parser.error("--epochs and --val-every must be at least 1")

    output_dir = Path(args.output_dir)
    weights_path, metadata_path = output_dir / f"{args.label}.pth", output_dir / f"{args.label}.json"
    if weights_path.exists() or metadata_path.exists():
        print(f"{args.label} already exists in {output_dir}; versions are never overwritten")
        return 1
    if not Path(args.frozen_slices).exists():
        print(f"frozen-slice index not found: {args.frozen_slices}. Build it once with:\n"
              r"  python frozen_guard.py build --manifest E:\Jy\Unet\versions\frozen_holdout.json")
        return 1
    frozen = FrozenIndex.load(args.frozen_slices)
    problem = frozen.manifest_problem()
    if problem:
        print(problem)
        return 1
    _, checked, matches = check_paths(frozen, [images for images, _ in args.train])
    if matches:
        print(f"refusing to train: {len(matches)} training slice(s) belong to the frozen test set")
        for file, _, z, hit in matches[:20]:
            print(f"  {file} slice {z} = {hit}")
        return 1

    set_seed(args.seed)
    _, preprocess = import_v2(args.v2_root)
    from monai.losses import DiceLoss
    from train_runner import multiclass_dice  # the metric training used to pick unet.pth

    size = (args.image_size, args.image_size)
    train_transform = (build_corrected_train_transforms(size) if args.augmentation == "corrected"
                       else preprocess.build_train_transforms(spatial_size=size))
    train_transform.set_random_state(seed=args.seed)
    train_loader, train_slices = make_loader(args.train, train_transform, preprocess, args.batch_size, True,
                                             seed=args.seed)
    val_loader, val_slices = make_loader([args.val], preprocess.build_val_transforms(spatial_size=size), preprocess,
                                         args.batch_size, False, max_slices=args.max_val_slices)

    base_sha256 = sha256_file(args.base_checkpoint)
    model = build_model(args.v2_root, checkpoint=args.base_checkpoint)
    encoder_frozen = not args.unfreeze_encoder
    if encoder_frozen:
        freeze_encoder(model)
    trainable, total = count_parameters(model)
    optimizer = AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr, weight_decay=args.weight_decay)
    ce_loss, dice_loss = nn.CrossEntropyLoss(), DiceLoss(to_onehot_y=True, softmax=True)

    started = dt.datetime.now(dt.timezone.utc)
    base_val = run_epoch(model, val_loader, ce_loss, dice_loss, multiclass_dice)
    print(json.dumps({"epoch": 0, "val_loss": base_val["loss"], "val_dice": base_val["dice"]}))
    best_dice, best_epoch, best_state, history = float("-inf"), None, None, []
    for epoch in range(1, args.epochs + 1):
        tick = time.time()
        train = run_epoch(model, train_loader, ce_loss, dice_loss, multiclass_dice, optimizer, encoder_frozen)
        row = {"epoch": epoch, "train_loss": train["loss"], "train_dice": train["dice"]}
        if epoch % args.val_every == 0 or epoch == args.epochs:
            val = run_epoch(model, val_loader, ce_loss, dice_loss, multiclass_dice)
            row.update({"val_loss": val["loss"], "val_dice": val["dice"]})
            if val["dice"] > best_dice:
                best_dice, best_epoch, best_state = val["dice"], epoch, copy.deepcopy(model.state_dict())
        row["seconds"] = round(time.time() - tick, 1)
        history.append(row)
        print(json.dumps(row))

    if args.select == "best":
        kept_state, kept_epoch, kept_dice = best_state, best_epoch, best_dice
    else:  # the last epoch is always validated, so its Dice is on record
        kept_state, kept_epoch, kept_dice = copy.deepcopy(model.state_dict()), args.epochs, history[-1]["val_dice"]
    output_dir.mkdir(parents=True, exist_ok=True)
    temp = weights_path.with_name(weights_path.name + ".tmp")
    torch.save(kept_state, temp)
    os.replace(temp, weights_path)

    import monai
    import timm
    metadata = {
        "label": args.label,
        "started_at": started.isoformat(),
        "finished_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "base_checkpoint": {"path": str(Path(args.base_checkpoint).resolve()), "sha256": base_sha256},
        "weights": {"path": str(weights_path.resolve()), "sha256": sha256_file(weights_path)},
        "train": [{"images": str(Path(images).resolve()), "masks": str(Path(masks).resolve()),
                   "manifest": source_manifest(images)} for images, masks in args.train],
        "train_slices": train_slices,
        "val": {"images": str(Path(args.val[0]).resolve()), "masks": str(Path(args.val[1]).resolve()),
                "slices_used": val_slices},
        "hyperparameters": {"epochs": args.epochs, "batch_size": args.batch_size, "lr": args.lr,
                            "weight_decay": args.weight_decay, "val_every": args.val_every,
                            "augmentation": args.augmentation, "encoder_frozen": encoder_frozen,
                            "image_size": args.image_size, "max_val_slices": args.max_val_slices, "seed": args.seed,
                            "select": args.select},
        "parameters": {"trainable": trainable, "total": total},
        "frozen_guard": {"index": {"path": str(Path(args.frozen_slices).resolve()),
                                  "sha256": sha256_file(args.frozen_slices)},
                        "train_slices_checked": checked, "matches": 0},
        "base_val": base_val,
        "best_epoch": best_epoch,
        "best_val_dice": best_dice,
        "kept_epoch": kept_epoch,
        "kept_val_dice": kept_dice,
        "improved_over_base_on_val": kept_dice > base_val["dice"],
        "history": history,
        "software": {"python": sys.version.split()[0], "torch": torch.__version__, "monai": monai.__version__,
                     "timm": timm.__version__},
    }
    atomic_write_json(metadata_path, metadata)
    print(f"saved {weights_path} (kept epoch {kept_epoch} by '{args.select}', val Dice {kept_dice:.4f}; "
          f"best epoch {best_epoch} at {best_dice:.4f}; base {base_val['dice']:.4f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
