"""
Fine-tune from a saved checkpoint.
Useful for squeezing out the last bit of accuracy after the main run.

FIX: switched to gaussian_subpixel_argmax (window=7) for postprocessing.
FIX: tighter Wing loss (wing_w=0.008 ~2px, was 0.05 ~13px).
FIX: P90 used as checkpoint criterion instead of mean MRE.

Usage:
    python finetune.py --checkpoint checkpoints/XXXX-XX-XX_XX-XX-XX/best_model.pth
"""

import argparse
import torch
import torch.nn.functional as F_nn
from torch.utils.data import DataLoader, Subset
import numpy as np
import os
from datetime import datetime

from dataset.landmark_dataset import LandmarkDataset
from models.unet_resnet34 import UNetResNet34
from utils.loss import HeatmapLoss
from utils.postprocess import gaussian_subpixel_argmax   
from utils.metrics import (compute_mre, compute_sdr, compute_mre_per_landmark,
                           compute_sdr_multi, compute_per_sample_mre,
                           compute_mre_percentiles)
from utils.visualize import save_epoch_grid, save_training_curve

IMAGE_DIR = "data/lv-landmark/Training/images"
MASK_DIR  = "data/lv-landmark/Training/masks"
BATCH_SIZE = 8
EPOCHS     = 30
LR         = 5e-5
SIGMA      = 2
VAL_SPLIT  = 0.2
SEED       = 42
N_VIS      = 8
EARLY_STOP_PATIENCE = 10


def train_finetune(checkpoint_path):
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device} | Checkpoint: {checkpoint_path}")

    probe_ds = LandmarkDataset(IMAGE_DIR, MASK_DIR, augment=False, sigma=SIGMA, min_landmark_dist=0)
    n_total  = len(probe_ds)
    n_val    = int(n_total * VAL_SPLIT)
    n_train  = n_total - n_val
    del probe_ds

    g       = torch.Generator().manual_seed(SEED)
    indices = torch.randperm(n_total, generator=g).tolist()
    train_idx, val_idx = indices[:n_train], indices[n_train:]

    train_ds = LandmarkDataset(IMAGE_DIR, MASK_DIR, augment=True,  sigma=SIGMA, min_landmark_dist=0)
    val_ds   = LandmarkDataset(IMAGE_DIR, MASK_DIR, augment=False, sigma=SIGMA, min_landmark_dist=0)

    train_loader = DataLoader(Subset(train_ds, train_idx), batch_size=BATCH_SIZE,
                              shuffle=True,  num_workers=2, pin_memory=True)
    val_loader   = DataLoader(Subset(val_ds,   val_idx),   batch_size=BATCH_SIZE,
                              shuffle=False, num_workers=2, pin_memory=True)

    model = UNetResNet34(in_channels=1, num_classes=2, dropout=0.0).to(device)
    model.load_state_dict(torch.load(checkpoint_path, map_location=device, weights_only=True))
    print("Checkpoint loaded.")

    criterion = HeatmapLoss(
        coord_weight=25.0,
        sep_weight=0.3,
        sep_min_dist=0.08,
        wing_w=0.008,
        wing_eps=0.002,
        hard_k=BATCH_SIZE - 2,
    )
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-5)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=EPOCHS, eta_min=1e-6)

    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    run_dir   = os.path.join("checkpoints", f"finetune_{timestamp}")
    os.makedirs(run_dir, exist_ok=True)

    best_p90          = float("inf")
    epochs_no_improve = 0
    history           = []

    for epoch in range(1, EPOCHS + 1):

        model.train()
        train_loss = 0.0
        sub_totals = {"bce": 0.0, "dice": 0.0, "coord": 0.0, "sep": 0.0}

        for images, heatmaps, gt_coords in train_loader:
            images   = images.to(device)
            heatmaps = heatmaps.to(device)
            optimizer.zero_grad()
            preds       = model(images)
            loss, parts = criterion(preds, heatmaps)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=2.0)
            optimizer.step()
            train_loss += loss.item()
            for k in sub_totals:
                sub_totals[k] += parts[k]

        train_loss /= len(train_loader)
        sub_avgs    = {k: v / len(train_loader) for k, v in sub_totals.items()}

        model.eval()
        val_loss    = 0.0
        total_mre   = 0.0
        total_mre1  = 0.0
        total_mre2  = 0.0
        total_sdr   = {2: 0.0, 5: 0.0, 10: 0.0}
        sample_mres = []
        vis_images, vis_preds, vis_gts = [], [], []

        with torch.no_grad():
            for images, heatmaps, gt_coords in val_loader:
                images    = images.to(device)
                heatmaps  = heatmaps.to(device)
                gt_coords = gt_coords.to(device)

                pred_heatmap = torch.sigmoid(model(images))
                loss, _      = criterion(
                    torch.log(pred_heatmap.clamp(1e-7, 1 - 1e-7)
                              / (1 - pred_heatmap).clamp(1e-7)),
                    heatmaps,
                )
                val_loss += loss.item()

                pred_coords = gaussian_subpixel_argmax(pred_heatmap, window=7)
                total_mre  += compute_mre(pred_coords, gt_coords).item()
                m1, m2      = compute_mre_per_landmark(pred_coords, gt_coords)
                total_mre1 += m1
                total_mre2 += m2
                s = compute_sdr_multi(pred_coords, gt_coords, (2.0, 5.0, 10.0))
                for t in total_sdr:
                    total_sdr[t] += s[t]
                sample_mres.extend(compute_per_sample_mre(pred_coords, gt_coords).cpu().tolist())

                if len(vis_images) < N_VIS:
                    for j in range(min(N_VIS - len(vis_images), images.size(0))):
                        vis_images.append(images[j, 0].cpu().numpy())
                        vis_preds.append(pred_coords[j].cpu().numpy())
                        vis_gts.append(gt_coords[j].cpu().numpy())

        scheduler.step()
        n        = len(val_loader)
        val_loss /= n
        avg_mre   = total_mre / n
        avg_mre1  = total_mre1 / n
        avg_mre2  = total_mre2 / n
        avg_sdr   = {t: total_sdr[t] / n for t in total_sdr}
        pct       = compute_mre_percentiles(sample_mres)
        lr_now    = optimizer.param_groups[0]["lr"]

        history.append({"epoch": epoch, "train_loss": train_loss, "val_loss": val_loss,
                        "mre": avg_mre, "sdr": avg_sdr[5], "sigma": SIGMA})

        print(f"Epoch {epoch:3d} | lr={lr_now:.2e} | Train: {train_loss:.4f} | Val: {val_loss:.4f} | "
              f"MRE: {avg_mre:.2f}px (LM1={avg_mre1:.2f} LM2={avg_mre2:.2f}) | "
              f"SDR@2/5/10: {avg_sdr[2]:.3f}/{avg_sdr[5]:.3f}/{avg_sdr[10]:.3f} | "
              f"P50={pct[50]:.2f} P90={pct[90]:.2f} Max={pct[100]:.2f}px | "
              f"[coord={sub_avgs['coord']:.5f} bce={sub_avgs['bce']:.4f}]")

        # checkpoint on P90 — mean MRE hides the hard-sample tail
        if pct[90] < best_p90:
            best_p90 = pct[90]
            epochs_no_improve = 0
            torch.save(model.state_dict(), os.path.join(run_dir, "best_model.pth"))
            print(f"  Best P90: {best_p90:.2f}px - saved")
        else:
            epochs_no_improve += 1
            if epochs_no_improve >= EARLY_STOP_PATIENCE:
                print("Warning: Early stopping.")
                break

        torch.save(model.state_dict(), os.path.join(run_dir, "last_model.pth"))
        save_epoch_grid(vis_images, vis_preds, vis_gts, epoch=epoch,
                        save_dir=os.path.join(run_dir, "grids"), n_samples=N_VIS)

    save_training_curve(history, run_dir)
    print(f"\nDone. Best P90: {best_p90:.2f}px | Checkpoints: {run_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    args = parser.parse_args()
    train_finetune(args.checkpoint)
