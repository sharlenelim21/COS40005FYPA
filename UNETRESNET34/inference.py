"""
Landmark Inference — resolution-safe
=====================================
Accepts any NIfTI MRI file at any resolution. Internally resizes each slice
to 256x256 for the model, then maps predictions back to the original image
space before returning.

Usage (CLI - single slice):
    python inference.py --checkpoint checkpoints/best_model.pth
                        --image data/lv-landmark/Testing/images/DET0000301.nii.gz
                        --slice 4
                        --out results/

Usage (CLI - auto-find best slice):
    python inference.py --checkpoint checkpoints/best_model.pth
                        --image data/lv-landmark/Testing/images/DET0000301.nii.gz
                        --auto
                        --out results/

Usage (CLI - scan ALL slices):
    python inference.py --checkpoint checkpoints/best_model.pth
                        --image data/lv-landmark/Testing/images/DET0000301.nii.gz
                        --all-slices
                        --out results/

Usage (Python API):
    from inference import predict_landmarks, load_model
    model  = load_model("checkpoints/best_model.pth")
    coords, heatmap = predict_landmarks(slice_2d, model=model)
    # coords  -> [x1, y1, x2, y2] in ORIGINAL pixel space
    # heatmap -> [2, H, W] at original resolution
"""

import argparse
import os
import numpy as np
import torch
import cv2
import nibabel as nib
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
import matplotlib.patches as mpatches

from models.unet_resnet34 import UNetResNet34
from utils.postprocess import quadratic_subpixel_argmax

MODEL_INPUT_SIZE = 256   # network was trained on 256x256 — do not change


# ── model loader ──────────────────────────────────────────────────────────────

def load_model(checkpoint, device=None):
    """
    Load UNetResNet34 from checkpoint. Call once and reuse for multiple slices.
    """
    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = UNetResNet34(in_channels=1, num_classes=2, dropout=0.0,
                         pretrained=False, cardiac_pretrained=False).to(device)
    state = torch.load(checkpoint, map_location=device, weights_only=True)
    model.load_state_dict(state)
    model.eval()
    print(f"Loaded checkpoint : {checkpoint}")
    print(f"Device            : {device}")
    return model


# ── preprocessing ─────────────────────────────────────────────────────────────

def _preprocess(image):
    """Resize + z-score normalise — matches training pipeline exactly."""
    img = cv2.resize(image.astype(np.float32),
                     (MODEL_INPUT_SIZE, MODEL_INPUT_SIZE))
    mu  = img.mean()
    std = img.std() + 1e-8
    img = (img - mu) / std
    return torch.tensor(img, dtype=torch.float32).unsqueeze(0).unsqueeze(0)


# ── TTA predict ───────────────────────────────────────────────────────────────

@torch.no_grad()
def _tta_predict(model, tensor, device):
    """4-variant TTA: original + h-flip + v-flip + hv-flip, averaged."""
    x = tensor.to(device)
    variants = []
    for hf in [False, True]:
        for vf in [False, True]:
            t = x.clone()
            if hf: t = torch.flip(t, [3])
            if vf: t = torch.flip(t, [2])
            p = torch.sigmoid(model(t))
            if vf: p = torch.flip(p, [2])
            if hf: p = torch.flip(p, [3])
            variants.append(p)
    return torch.stack(variants).mean(0)   # [1, 2, 256, 256]


# ── core inference ────────────────────────────────────────────────────────────

def predict_landmarks(image, checkpoint=None, model=None, device=None, use_tta=True):
    """
    Predict landmarks on a single 2-D MRI slice of ANY resolution.

    Parameters
    ----------
    image      : np.ndarray [H, W]  — raw float slice, any resolution
    checkpoint : str                — path to best_model.pth
                                      (ignored if model already provided)
    model      : loaded UNetResNet34      — pass pre-loaded model to avoid reloading
    device     : torch.device       — defaults to cuda if available
    use_tta    : bool               — test-time augmentation (recommended)

    Returns
    -------
    coords  : np.ndarray [4]      — (x1, y1, x2, y2) in ORIGINAL pixel space
    heatmap : np.ndarray [2,H,W]  — probability map at original resolution
    """
    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    if model is None:
        if checkpoint is None:
            raise ValueError("Either model or checkpoint must be provided.")
        model = load_model(checkpoint, device)

    H_orig, W_orig = image.shape
    tensor = _preprocess(image)

    if use_tta:
        heatmap_256 = _tta_predict(model, tensor, device)
    else:
        with torch.no_grad():
            heatmap_256 = torch.sigmoid(model(tensor.to(device)))

    # subpixel localisation in 256-space
    coords_256 = quadratic_subpixel_argmax(heatmap_256)[0].cpu().numpy()

    # scale back to original resolution — works for any input size
    coords_orig = np.array([
        coords_256[0] * W_orig / MODEL_INPUT_SIZE,   # x1
        coords_256[1] * H_orig / MODEL_INPUT_SIZE,   # y1
        coords_256[2] * W_orig / MODEL_INPUT_SIZE,   # x2
        coords_256[3] * H_orig / MODEL_INPUT_SIZE,   # y2
    ], dtype=np.float32)

    # upsample heatmap to original resolution for display
    hm_np = heatmap_256[0].cpu().numpy()   # [2, 256, 256]
    heatmap_orig = np.stack([
        cv2.resize(hm_np[c], (W_orig, H_orig), interpolation=cv2.INTER_LINEAR)
        for c in range(hm_np.shape[0])
    ])   # [2, H_orig, W_orig]

    return coords_orig, heatmap_orig


# ── GT extraction ─────────────────────────────────────────────────────────────

def extract_gt_coords(mask_2d):
    """
    Extract ground truth landmark coords from a 2D mask slice using the same
    method as LandmarkDataset — the two most distant foreground points.

    mask_2d : [H, W] numpy array
    returns : np.ndarray [4] (x1,y1,x2,y2) in pixel space, or None if no mask
    """
    pts = np.argwhere(mask_2d > 0)
    if len(pts) < 2:
        return None
    dists = np.linalg.norm(pts[:, None] - pts[None, :], axis=-1)
    i, j  = np.unravel_index(np.argmax(dists), dists.shape)
    p1, p2 = pts[i], pts[j]
    return np.array([p1[1], p1[0], p2[1], p2[0]], dtype=np.float32)
    # note: argwhere returns [row, col] = [y, x], so we swap to [x, y]


def compute_mre(pred_coords, gt_coords):
    """
    Mean Radial Error between predicted and GT coords in pixel space.
    pred_coords, gt_coords : [4] arrays (x1,y1,x2,y2)
    returns : (mre, err_lm1, err_lm2) — all in pixels
    """
    err_lm1 = np.linalg.norm(pred_coords[:2] - gt_coords[:2])
    err_lm2 = np.linalg.norm(pred_coords[2:] - gt_coords[2:])
    mre     = 0.5 * (err_lm1 + err_lm2)
    return mre, err_lm1, err_lm2


# ── slice utilities ───────────────────────────────────────────────────────────

def find_best_slices(vol, mask_vol=None, top_k=5):
    """
    Return top_k slice indices with the most image content (by pixel variance).
    If mask_vol is provided, only considers slices that have mask annotations.
    """
    if mask_vol is not None:
        # prefer slices with GT annotations
        annotated = [i for i in range(vol.shape[2])
                     if np.sum(mask_vol[:, :, i] > 0) >= 2]
        if annotated:
            variances = {i: vol[:, :, i].var() for i in annotated}
            ranked    = sorted(annotated, key=lambda i: variances[i], reverse=True)
            return ranked[:top_k]

    variances = [vol[:, :, i].var() for i in range(vol.shape[2])]
    ranked    = sorted(range(len(variances)),
                       key=lambda i: variances[i], reverse=True)
    return ranked[:top_k]


# ── visualisation ─────────────────────────────────────────────────────────────

def visualize_prediction(image, coords, heatmap=None, gt_coords=None,
                          slice_idx=None, mre_info=None,
                          save_path=None, show=False):
    """
    Overlay predicted and (optionally) GT landmark coords on the image.

    image     : [H, W]   — original resolution slice
    coords    : [4]      — predicted (x1,y1,x2,y2) in original pixel space
    heatmap   : [2,H,W]  — probability map (optional)
    gt_coords : [4]      — ground truth coords (optional, shown in green)
    slice_idx : int      — shown in title if provided
    mre_info  : (mre, err_lm1, err_lm2) tuple — shown in title if provided
    save_path : str      — saves PNG here if provided
    show      : bool     — interactive display
    """
    has_heatmap = heatmap is not None
    has_gt      = gt_coords is not None
    n_panels    = 3 if has_heatmap else 1

    fig = plt.figure(figsize=(5 * n_panels, 5))
    gs  = gridspec.GridSpec(1, n_panels, figure=fig)

    slice_label = f"slice {slice_idx}" if slice_idx is not None else ""

    # build title
    if mre_info is not None:
        mre, e1, e2 = mre_info
        title = (f"{slice_label}  |  MRE={mre:.2f}px  "
                 f"(LM1={e1:.1f}px  LM2={e2:.1f}px)")
    else:
        title = slice_label

    # ── panel 1: image + pred (red/blue) + GT (green, if available) ───────────
    ax0 = fig.add_subplot(gs[0])
    ax0.imshow(image, cmap="gray", aspect="auto")

    # GT dots — solid green
    if has_gt:
        ax0.scatter([gt_coords[0], gt_coords[2]],
                    [gt_coords[1], gt_coords[3]],
                    c="lime", s=60, zorder=4,
                    edgecolors="black", linewidths=0.6, label="GT")
        ax0.plot([gt_coords[0], gt_coords[2]],
                 [gt_coords[1], gt_coords[3]],
                 color="lime", lw=0.8, alpha=0.5, linestyle="--", zorder=3)

    # pred dots — red LM1, blue LM2
    ax0.scatter([coords[0]], [coords[1]],
                c="red",  s=60, zorder=5,
                edgecolors="white", linewidths=0.8, label="Pred LM1")
    ax0.scatter([coords[2]], [coords[3]],
                c="deepskyblue", s=60, zorder=5,
                edgecolors="white", linewidths=0.8, label="Pred LM2")
    ax0.plot([coords[0], coords[2]], [coords[1], coords[3]],
             "w--", lw=0.8, alpha=0.6, zorder=3)

    # error lines from pred to GT
    if has_gt:
        ax0.plot([coords[0], gt_coords[0]], [coords[1], gt_coords[1]],
                 color="yellow", lw=1.0, alpha=0.8, zorder=4)
        ax0.plot([coords[2], gt_coords[2]], [coords[3], gt_coords[3]],
                 color="yellow", lw=1.0, alpha=0.8, zorder=4)

    ax0.set_title(title, fontsize=8)
    ax0.legend(loc="lower right", fontsize=6, markerscale=0.7)
    ax0.axis("off")

    # ── panel 2: LM1 heatmap ─────────────────────────────────────────────────
    if has_heatmap:
        ax1 = fig.add_subplot(gs[1])
        ax1.imshow(image, cmap="gray", aspect="auto")
        ax1.imshow(heatmap[0], cmap="hot", alpha=0.5,
                   vmin=0, vmax=max(heatmap[0].max(), 1e-6))
        ax1.scatter([coords[0]], [coords[1]],
                    c="red", s=60, zorder=4,
                    edgecolors="white", linewidths=0.8)
        if has_gt:
            ax1.scatter([gt_coords[0]], [gt_coords[1]],
                        c="lime", s=60, zorder=4,
                        edgecolors="black", linewidths=0.6)
        ax1.set_title("LM1 heatmap  (red=pred  green=GT)", fontsize=8)
        ax1.axis("off")

        # ── panel 3: LM2 heatmap ─────────────────────────────────────────────
        ax2 = fig.add_subplot(gs[2])
        ax2.imshow(image, cmap="gray", aspect="auto")
        ax2.imshow(heatmap[1], cmap="hot", alpha=0.5,
                   vmin=0, vmax=max(heatmap[1].max(), 1e-6))
        ax2.scatter([coords[2]], [coords[3]],
                    c="deepskyblue", s=60, zorder=4,
                    edgecolors="white", linewidths=0.8)
        if has_gt:
            ax2.scatter([gt_coords[2]], [gt_coords[3]],
                        c="lime", s=60, zorder=4,
                        edgecolors="black", linewidths=0.6)
        ax2.set_title("LM2 heatmap  (blue=pred  green=GT)", fontsize=8)
        ax2.axis("off")

    plt.tight_layout()

    if save_path:
        os.makedirs(os.path.dirname(os.path.abspath(save_path)), exist_ok=True)
        plt.savefig(save_path, dpi=150, bbox_inches="tight")
        print(f"   Saved -> {save_path}")

    if show:
        plt.show()

    plt.close()


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Cardiac landmark inference — any NIfTI resolution"
    )
    parser.add_argument("--checkpoint", required=True,
                        help="Path to best_model.pth")
    parser.add_argument("--image", required=True,
                        help="Path to .nii.gz image file")
    parser.add_argument("--slice", type=int, default=None,
                        help="Specific slice index (along axis=2)")
    parser.add_argument("--auto", action="store_true",
                        help="Auto-select top-5 most informative slices")
    parser.add_argument("--all-slices", action="store_true",
                        help="Run inference on every slice in the volume")
    parser.add_argument("--no-tta", action="store_true",
                        help="Disable TTA (faster, slightly less accurate)")
    parser.add_argument("--out", default="inference_results",
                        help="Output directory for result images")
    args = parser.parse_args()

    # ── load image volume ─────────────────────────────────────────────────────
    print(f"\nLoading image : {args.image}")
    nii = nib.load(args.image)
    vol = nii.get_fdata().astype(np.float32)
    print(f"Volume shape  : {vol.shape}  (H x W x N_slices)")

    # ── try to load matching GT mask ──────────────────────────────────────────
    mask_path = args.image.replace("images", "masks")
    mask_vol  = None
    if os.path.exists(mask_path):
        mask_vol = nib.load(mask_path).get_fdata()
        print(f"GT mask found : {mask_path}")
    else:
        print(f"No GT mask    : {mask_path} not found - running prediction only")

    # ── decide which slices to process ───────────────────────────────────────
    if args.all_slices:
        slice_indices = list(range(vol.shape[2]))
        print(f"Mode: ALL slices ({len(slice_indices)} total)")

    elif args.auto:
        slice_indices = find_best_slices(vol, mask_vol=mask_vol, top_k=5)
        print(f"Mode: AUTO - top-5 slices: {slice_indices}")

    elif args.slice is not None:
        n_slices = vol.shape[2]
        if args.slice >= n_slices:
            print(f"ERROR: --slice {args.slice} is out of range. "
                  f"This volume has {n_slices} slices (0 to {n_slices-1}).")
            print(f"Try --auto to let the script pick the best slice.")
            raise SystemExit(1)
        slice_indices = [args.slice]
        print(f"Mode: single slice {args.slice}")

    else:
        slice_indices = find_best_slices(vol, mask_vol=mask_vol, top_k=1)
        print(f"Mode: auto-picked best slice: {slice_indices[0]}")

    use_tta = not args.no_tta

    # ── load model once ───────────────────────────────────────────────────────
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model  = load_model(args.checkpoint, device)

    # ── run inference ─────────────────────────────────────────────────────────
    fname = os.path.splitext(
                os.path.splitext(
                    os.path.basename(args.image)
                )[0]
            )[0]

    print(f"\n{'-'*70}")
    if mask_vol is not None:
        print(f"{'Slice':>6}  {'Pred LM1':>20}  {'Pred LM2':>20}  "
              f"{'MRE':>8}  {'LM1 err':>8}  {'LM2 err':>8}")
    else:
        print(f"{'Slice':>6}  {'Pred LM1':>20}  {'Pred LM2':>20}")
    print(f"{'-'*70}")

    all_mres = []

    for sl in slice_indices:
        slc = vol[:, :, sl]

        # skip blank slices in all-slices mode
        if args.all_slices and slc.var() < 0.001:
            continue

        coords, heatmap = predict_landmarks(
            slc, model=model, device=device, use_tta=use_tta
        )

        # GT comparison if mask available
        gt_coords = None
        mre_info  = None
        if mask_vol is not None:
            mask_2d   = mask_vol[:, :, sl]
            gt_coords = extract_gt_coords(mask_2d)
            if gt_coords is not None:
                mre, e1, e2 = compute_mre(coords, gt_coords)
                mre_info    = (mre, e1, e2)
                all_mres.append(mre)
                print(f"  {sl:>4}  "
                      f"({coords[0]:7.1f},{coords[1]:7.1f})  "
                      f"({coords[2]:7.1f},{coords[3]:7.1f})  "
                      f"{mre:>8.2f}px  {e1:>7.1f}px  {e2:>7.1f}px")
            else:
                print(f"  {sl:>4}  "
                      f"({coords[0]:7.1f},{coords[1]:7.1f})  "
                      f"({coords[2]:7.1f},{coords[3]:7.1f})  "
                      f"  (no GT mask on this slice)")
        else:
            print(f"  {sl:>4}  "
                  f"({coords[0]:7.1f},{coords[1]:7.1f})  "
                  f"({coords[2]:7.1f},{coords[3]:7.1f})")

        save_path = os.path.join(args.out, f"{fname}_slice{sl:03d}.png")
        visualize_prediction(
            slc, coords, heatmap,
            gt_coords=gt_coords,
            slice_idx=sl,
            mre_info=mre_info,
            save_path=save_path,
        )

    print(f"{'-'*70}")

    # ── summary stats if multiple slices with GT ──────────────────────────────
    if len(all_mres) > 1:
        arr = np.array(all_mres)
        print(f"\nSummary across {len(arr)} annotated slices:")
        print(f"  Mean MRE : {arr.mean():.2f}px")
        print(f"  P50  MRE : {np.percentile(arr, 50):.2f}px")
        print(f"  P90  MRE : {np.percentile(arr, 90):.2f}px")
        print(f"  Max  MRE : {arr.max():.2f}px")
        print(f"  SDR@3px  : {(arr < 3.0).mean():.1%}")
        print(f"  SDR@5px  : {(arr < 5.0).mean():.1%}")

    print(f"\nDone. Results saved to: {args.out}/")
