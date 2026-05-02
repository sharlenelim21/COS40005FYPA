"""
Test-Time Augmentation (TTA) for landmark detection.
-----------------------------------------------------
Run 8 augmented versions of each image, average the heatmaps,
then localise with gaussian_subpixel_argmax (window=7).

Quadratic fits a parabola to 3 points — brittle when the heatmap peak is
flat or noisy. Gaussian uses a weighted centroid over a 15×15 window,
which is more robust across the full range of heatmap sharpness.

Usage:
    python tta_eval.py --checkpoint checkpoints/xxxx-xx-xxxx/best_model.pth
"""

import argparse
import torch
import numpy as np
from torch.utils.data import DataLoader, Subset

from dataset.landmark_dataset import LandmarkDataset
from models.unet_resnet34 import UNetResNet34
from utils.postprocess import gaussian_subpixel_argmax  
from utils.metrics import compute_mre, compute_sdr, compute_mre_percentiles, compute_per_sample_mre
from utils.visualize import save_epoch_grid

IMAGE_DIR = "data/lv-landmark/Training/images"
MASK_DIR  = "data/lv-landmark/Training/masks"
SEED      = 42
N_VIS     = 8


def tta_predict(model, image, device):
    """
    Run 8 TTA variants on a single image tensor [1, 1, H, W].
    Variants: original + h-flip + v-flip + hv-flip,
              each with/without 90-degree rotation.
    Returns averaged sigmoid heatmap [1, C, H, W].
    """
    variants = []

    for do_rot in [False, True]:
        for hflip in [False, True]:
            for vflip in [False, True]:
                x = image.clone()
                if hflip:
                    x = torch.flip(x, dims=[3])
                if vflip:
                    x = torch.flip(x, dims=[2])
                if do_rot:
                    x = torch.rot90(x, k=1, dims=[2, 3])

                with torch.no_grad():
                    pred = torch.sigmoid(model(x.to(device)))

                # undo transforms in reverse order
                if do_rot:
                    pred = torch.rot90(pred, k=-1, dims=[2, 3])
                if vflip:
                    pred = torch.flip(pred, dims=[2])
                if hflip:
                    pred = torch.flip(pred, dims=[3])

                variants.append(pred.cpu())

    return torch.stack(variants, dim=0).mean(dim=0)   # [1, C, H, W]


def evaluate_with_tta(checkpoint_path, use_tta=True):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device} | TTA: {use_tta}")

    full_ds = LandmarkDataset(
        IMAGE_DIR, MASK_DIR, augment=False, sigma=4,
        min_landmark_dist=0,
    )
    n_total = len(full_ds)
    n_val   = int(n_total * 0.2)
    n_train = n_total - n_val

    g       = torch.Generator().manual_seed(SEED)
    indices = torch.randperm(n_total, generator=g).tolist()
    val_idx = indices[n_train:]

    val_loader = DataLoader(
        Subset(full_ds, val_idx),
        batch_size=1,
        shuffle=False,
        num_workers=0,
    )

    model = UNetResNet34(in_channels=1, num_classes=2, dropout=0.0).to(device)
    model.load_state_dict(torch.load(checkpoint_path, map_location=device, weights_only=True))
    model.eval()
    print(f"Loaded: {checkpoint_path}")

    total_mre  = 0.0
    total_sdr  = 0.0
    sample_mres = []
    vis_images, vis_preds, vis_gts = [], [], []

    for i, (image, heatmap, gt_coords) in enumerate(val_loader):
        gt_coords = gt_coords.to(device)

        if use_tta:
            pred_heatmap = tta_predict(model, image, device).to(device)
        else:
            with torch.no_grad():
                pred_heatmap = torch.sigmoid(model(image.to(device)))

      
        # quadratic at any heatmap sharpness level.
        pred_coords = gaussian_subpixel_argmax(pred_heatmap, window=7)

        total_mre  += compute_mre(pred_coords, gt_coords).item()
        total_sdr  += compute_sdr(pred_coords, gt_coords, threshold=5.0)
        sample_mres.extend(compute_per_sample_mre(pred_coords, gt_coords).cpu().tolist())

        if len(vis_images) < N_VIS:
            vis_images.append(image[0, 0].cpu().numpy())
            vis_preds.append(pred_coords[0].cpu().numpy())
            vis_gts.append(gt_coords[0].cpu().numpy())

        if (i + 1) % 20 == 0:
            print(f"  processed {i+1}/{len(val_loader)}")

    avg_mre = total_mre / len(val_loader)
    avg_sdr = total_sdr / len(val_loader)
    pct     = compute_mre_percentiles(sample_mres)

    label = "TTA" if use_tta else "no-TTA"
    print(f"\n{label} | MRE: {avg_mre:.2f}px | SDR@5px: {avg_sdr:.3f} | "
          f"P50={pct[50]:.2f} P90={pct[90]:.2f} Max={pct[100]:.2f}px")

    save_epoch_grid(
        vis_images, vis_preds, vis_gts,
        epoch=0,
        save_dir="tta_results",
        n_samples=N_VIS,
    )
    print("Grid saved to tta_results/epoch_000_grid.png")

    return avg_mre, avg_sdr


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True,
                        help="Path to best_model.pth")
    parser.add_argument("--no-tta", action="store_true",
                        help="Disable TTA (baseline comparison)")
    args = parser.parse_args()

    print("=" * 50)
    evaluate_with_tta(args.checkpoint, use_tta=False)

    print("=" * 50)
    evaluate_with_tta(args.checkpoint, use_tta=True)