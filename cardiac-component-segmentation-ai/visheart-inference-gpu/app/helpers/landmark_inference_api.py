"""
Landmark detection inference: RV insertion point detection.

Supports two-channel (MRI + seg mask) and one-channel (MRI only) modes.
Automatically falls back to 1ch when seg mask is missing or invalid.

Called from inference_route.py via the /inference/v2/landmark-detection endpoint.
Models are loaded at startup by model_init.landmark_model_lifespan().
"""

import importlib.util
import os
import sys
import logging
import traceback
from math import sqrt
from pathlib import Path
from typing import Any, Dict, List, Optional

import nibabel as nib
import numpy as np
import torch
import torch.nn as nn

logger = logging.getLogger("visheart")

# ---------------------------------------------------------------------------
# Module-level model cache — populated by model_init.landmark_model_lifespan
# so we don't reload from disk on every request.
# ---------------------------------------------------------------------------
_LOADED_MODEL_2CH: Optional[nn.Module] = None
_LOADED_MODEL_1CH: Optional[nn.Module] = None
_LOADED_DEVICE: Optional[torch.device] = None

# ---------------------------------------------------------------------------
# Path resolution — mirrors the existing UNETRESNET34 wiring
# ---------------------------------------------------------------------------

def _resolve_unetresnet34_dir() -> Path:
    configured = os.getenv("LANDMARK_REPO_PATH")
    if configured:
        return Path(configured).resolve()
    # Container path: /app/UNETRESNET34
    return Path("/app/UNETRESNET34")


def _resolve_checkpoint_2ch() -> Path:
    """Path to the 2-channel (MRI + seg) BatchNorm checkpoint."""
    # Prefer env var, then models dir, then UNETRESNET34/checkpoints
    env = os.getenv("LANDMARK_MODEL_2CH_PATH")
    if env and Path(env).exists():
        return Path(env).resolve()
    # Models dir is volume-mounted: /app/app/models/
    models_dir = Path(__file__).resolve().parents[1] / "models"
    candidate = models_dir / "best_model.pth"
    if candidate.exists():
        return candidate.resolve()
    # Fallback: UNETRESNET34/checkpoints/best_model_2ch.pth
    repo_dir = _resolve_unetresnet34_dir()
    fallback = repo_dir / "checkpoints" / "best_model_2ch.pth"
    if fallback.exists():
        return fallback.resolve()
    raise FileNotFoundError(
        "Could not find 2ch landmark checkpoint. "
        "Set LANDMARK_MODEL_2CH_PATH or place best_model.pth in app/models/."
    )


def _resolve_checkpoint_1ch() -> Optional[Path]:
    """Path to the 1-channel (MRI only) BatchNorm checkpoint. Returns None if absent."""
    env = os.getenv("LANDMARK_MODEL_1CH_PATH")
    if env and Path(env).exists():
        return Path(env).resolve()
    models_dir = Path(__file__).resolve().parents[1] / "models"
    candidate = models_dir / "best_model_1ch.pth"
    if candidate.exists():
        return candidate.resolve()
    repo_dir = _resolve_unetresnet34_dir()
    fallback = repo_dir / "checkpoints" / "best_model_1ch.pth"
    if fallback.exists():
        return fallback.resolve()
    return None


# ---------------------------------------------------------------------------
# Model architecture import
# ---------------------------------------------------------------------------

def _import_unet_resnet34():
    """Import UNetResNet34 from the volume-mounted UNETRESNET34 repo."""
    repo_dir = _resolve_unetresnet34_dir()
    models_path = repo_dir / "models" / "unet_resnet34.py"
    if not models_path.exists():
        raise FileNotFoundError(f"unet_resnet34.py not found at {models_path}")

    spec = importlib.util.spec_from_file_location("unet_resnet34", str(models_path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.UNetResNet34


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

def load_landmark_model(checkpoint_path: Path, in_channels: int, device: torch.device) -> nn.Module:
    """
    Load a UNetResNet34 landmark model from checkpoint.

    ResNetUNet (the torchvision branch) hardcodes conv1 to 1 input channel.
    For in_channels=2 we replace enc0[0] (the first Conv2d) with a fresh
    2-channel conv before loading weights (strict=False lets everything else
    load normally).
    """
    UNetResNet34 = _import_unet_resnet34()

    model = UNetResNet34(
        in_channels=in_channels,
        num_classes=2,
        dropout=0.2,
        pretrained=False,
        cardiac_pretrained=False,
    )

    # Patch first conv for 2-channel input on the ResNetUNet branch
    if in_channels == 2 and hasattr(model, "enc0"):
        old_conv = model.enc0[0]
        if isinstance(old_conv, nn.Conv2d) and old_conv.in_channels != 2:
            new_conv = nn.Conv2d(
                2, old_conv.out_channels,
                kernel_size=old_conv.kernel_size,
                stride=old_conv.stride,
                padding=old_conv.padding,
                bias=False,
            )
            model.enc0[0] = new_conv
            logger.info("[Landmark] Patched enc0[0] → 2-channel conv")

    state = torch.load(str(checkpoint_path), map_location=device)
    # Unwrap common checkpoint wrappers
    for key in ("model_state_dict", "state_dict", "model"):
        if key in state:
            state = state[key]
            break

    missing, unexpected = model.load_state_dict(state, strict=False)
    if missing:
        logger.warning(f"[Landmark] {len(missing)} missing keys in {checkpoint_path.name}")
    if unexpected:
        logger.warning(f"[Landmark] {len(unexpected)} unexpected keys in {checkpoint_path.name}")

    model.to(device)
    model.eval()
    return model


# ---------------------------------------------------------------------------
# Preprocessing
# ---------------------------------------------------------------------------

_TARGET_SIZE = 256  # model was trained at this resolution — do not change


def _resize_2d(arr: np.ndarray) -> np.ndarray:
    from scipy.ndimage import zoom  # type: ignore
    zy = _TARGET_SIZE / arr.shape[0]
    zx = _TARGET_SIZE / arr.shape[1]
    return zoom(arr, (zy, zx), order=1).astype(np.float32)


def _zscore(arr: np.ndarray) -> np.ndarray:
    """Z-score normalise — matches training pipeline exactly (inference.py)."""
    mu = arr.mean()
    std = arr.std() + 1e-8
    return ((arr - mu) / std).astype(np.float32)


def preprocess_1ch(img_2d: np.ndarray) -> torch.Tensor:
    """Return (1, 1, 256, 256) tensor from a 2-D MRI slice."""
    img = _zscore(_resize_2d(img_2d))
    return torch.from_numpy(img).unsqueeze(0).unsqueeze(0)


def preprocess_2ch(img_2d: np.ndarray, seg_2d: np.ndarray) -> torch.Tensor:
    """Return (1, 2, 256, 256) tensor: ch0 = z-scored MRI, ch1 = class-label seg (0-3) / 3."""
    img = _zscore(_resize_2d(img_2d))
    # Preserve class labels (0=bg, 1=RV, 2=MYO, 3=LV), scale to [0,1]
    seg = np.clip(np.round(_resize_2d(seg_2d)), 0, 3).astype(np.float32) / 3.0
    stacked = np.stack([img, seg], axis=0)
    return torch.from_numpy(stacked).unsqueeze(0)


def _tta_predict(model: nn.Module, tensor: torch.Tensor, device: torch.device) -> np.ndarray:
    """
    4-variant TTA matching inference.py exactly:
    original + h-flip + v-flip + hv-flip, averaged.
    Returns heatmap (2, 256, 256) numpy array.
    """
    x = tensor.to(device)
    variants = []
    with torch.no_grad():
        for hf in [False, True]:
            for vf in [False, True]:
                t = x.clone()
                if hf:
                    t = torch.flip(t, [3])
                if vf:
                    t = torch.flip(t, [2])
                p = torch.sigmoid(model(t))
                if vf:
                    p = torch.flip(p, [2])
                if hf:
                    p = torch.flip(p, [3])
                variants.append(p)
    return torch.stack(variants).mean(0)[0].cpu().numpy()


# ---------------------------------------------------------------------------
# Seg mask validity
# ---------------------------------------------------------------------------

def is_seg_valid(seg_2d: Optional[np.ndarray]) -> bool:
    if seg_2d is None:
        return False
    if seg_2d.max() == 0:
        return False
    if np.count_nonzero(seg_2d) < 50:
        return False
    return True


# ---------------------------------------------------------------------------
# Heatmap → coordinate extraction
# ---------------------------------------------------------------------------

def _heatmap_to_coord(heatmap_ch: np.ndarray, H_orig: int, W_orig: int):
    """
    Return (x, y, max_val) from a single-channel 256×256 heatmap,
    scaled back to original image resolution (matching inference.py).
    """
    idx = np.unravel_index(np.argmax(heatmap_ch), heatmap_ch.shape)
    y256, x256 = int(idx[0]), int(idx[1])
    # Scale from 256-space back to original image space
    x = x256 * W_orig / _TARGET_SIZE
    y = y256 * H_orig / _TARGET_SIZE
    return x, y, float(heatmap_ch[idx])


# ---------------------------------------------------------------------------
# Core inference (called from inference_jobs / inference_route)
# ---------------------------------------------------------------------------

def run_landmark_inference_from_nifti(
    nifti_path: str,
    seg_mask_path: Optional[str] = None,
    device: str = "auto",
    checkpoint_path: Optional[str] = None,
    model_2ch: Optional[nn.Module] = None,
    model_1ch: Optional[nn.Module] = None,
    torch_device: Optional[torch.device] = None,
) -> Dict[str, Any]:
    """
    Run landmark detection on a NIfTI MRI volume.

    Parameters
    ----------
    nifti_path      : path to the MRI NIfTI file (already downloaded)
    seg_mask_path   : optional path to the segmentation mask NIfTI file
    device          : "auto" | "cuda" | "cpu"  (ignored when models injected)
    checkpoint_path : legacy single-checkpoint path (1ch fallback only)
    model_2ch       : pre-loaded 2-channel model (injected from lifespan)
    model_1ch       : pre-loaded 1-channel model (injected from lifespan)
    torch_device    : device the pre-loaded models live on

    Returns
    -------
    dict with keys: slices, avg_lm1, avg_lm2,
                    n_total, n_collapsed, n_2ch, n_1ch_fallback
    """
    # --- Resolve device ---
    if torch_device is None:
        if _LOADED_DEVICE is not None:
            torch_device = _LOADED_DEVICE
        elif device == "cpu":
            torch_device = torch.device("cpu")
        else:
            torch_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # --- Use pre-loaded models from lifespan if available, else load from disk ---
    if model_2ch is None:
        if _LOADED_MODEL_2CH is not None:
            model_2ch = _LOADED_MODEL_2CH
        else:
            ckpt_2ch = _resolve_checkpoint_2ch()
            logger.info(f"[Landmark] Loading 2ch model from {ckpt_2ch} (on-demand)")
            model_2ch = load_landmark_model(ckpt_2ch, in_channels=2, device=torch_device)

    if model_1ch is None:
        if _LOADED_MODEL_1CH is not None:
            model_1ch = _LOADED_MODEL_1CH
        else:
            ckpt_1ch = _resolve_checkpoint_1ch()
            if ckpt_1ch is not None:
                logger.info(f"[Landmark] Loading 1ch model from {ckpt_1ch} (on-demand)")
                model_1ch = load_landmark_model(ckpt_1ch, in_channels=1, device=torch_device)
            else:
                logger.warning("[Landmark] 1ch checkpoint not found — using 2ch model as fallback")
                model_1ch = model_2ch

    # --- Load MRI volume ---
    nii = nib.load(nifti_path)
    img = nii.get_fdata().astype(np.float32)
    if img.ndim == 4:
        img = img[:, :, :, 0]  # take first cardiac frame
    if img.ndim != 3:
        raise ValueError(f"Unsupported NIfTI shape: {img.shape}")

    n_slices = img.shape[2]
    logger.info(f"[Landmark] MRI shape {img.shape}, processing {n_slices} slices on {torch_device}")

    # --- Load seg volume once ---
    seg_vol: Optional[np.ndarray] = None
    if seg_mask_path is not None:
        try:
            seg_nii = nib.load(seg_mask_path)
            seg_vol = seg_nii.get_fdata().astype(np.float32)
            if seg_vol.ndim == 4:
                seg_vol = seg_vol[:, :, :, 0]
            logger.info(f"[Landmark] Seg mask shape {seg_vol.shape}")
        except Exception as exc:
            logger.warning(f"[Landmark] Could not load seg mask: {exc} — 1ch fallback for all slices")
            seg_vol = None

    # --- Per-slice inference ---
    slices_out: List[Dict[str, Any]] = []
    lm1_xs, lm1_ys, lm2_xs, lm2_ys = [], [], [], []
    n_collapsed = 0
    n_2ch_count = 0
    n_1ch_count = 0

    H_orig, W_orig = img.shape[0], img.shape[1]

    for i in range(n_slices):
        img_2d = img[:, :, i]

        seg_2d: Optional[np.ndarray] = None
        if seg_vol is not None and i < seg_vol.shape[2]:
            seg_2d = np.round(seg_vol[:, :, i]).astype(np.float32)

        if is_seg_valid(seg_2d):
            tensor = preprocess_2ch(img_2d, seg_2d)
            model_to_use = model_2ch
            model_used = "2ch"
        else:
            tensor = preprocess_1ch(img_2d)
            model_to_use = model_1ch
            model_used = "1ch_fallback"

        heatmap = _tta_predict(model_to_use, tensor, torch_device)
        hm_lm1 = heatmap[0]
        hm_lm2 = heatmap[1]
        lm1_x, lm1_y, hm1_max = _heatmap_to_coord(hm_lm1, H_orig, W_orig)
        lm2_x, lm2_y, hm2_max = _heatmap_to_coord(hm_lm2, H_orig, W_orig)
        logger.info(
            f"[Landmark] slice {i} [{model_used}] "
            f"lm1=({lm1_x:.1f},{lm1_y:.1f}) max={hm1_max:.4f}  "
            f"lm2=({lm2_x:.1f},{lm2_y:.1f}) max={hm2_max:.4f}  "
            f"dist={sqrt((lm1_x-lm2_x)**2+(lm1_y-lm2_y)**2):.1f}"
        )

        # Distance and collapse flag — NEVER overwrite original coords
        dist = sqrt((lm1_x - lm2_x) ** 2 + (lm1_y - lm2_y) ** 2)
        if dist < 10.0:
            mean_x = (lm1_x + lm2_x) / 2.0
            mean_y = (lm1_y + lm2_y) / 2.0
            flag = "collapsed_to_mean"
            display_mean = {"x": float(mean_x), "y": float(mean_y)}
            n_collapsed += 1
        else:
            flag = "normal"
            display_mean = None

        confidence = "high" if hm1_max > 0.6 and hm2_max > 0.6 else "low"

        if model_used == "2ch":
            n_2ch_count += 1
        else:
            n_1ch_count += 1

        lm1_xs.append(float(lm1_x))
        lm1_ys.append(float(lm1_y))
        lm2_xs.append(float(lm2_x))
        lm2_ys.append(float(lm2_y))

        slices_out.append({
            "slice": i,
            "lm1": {"x": float(lm1_x), "y": float(lm1_y)},
            "lm2": {"x": float(lm2_x), "y": float(lm2_y)},
            "display_mean": display_mean,
            "flag": flag,
            "confidence": confidence,
            "model_used": model_used,
            "hm1_max": float(hm1_max),
            "hm2_max": float(hm2_max),
            "lm_dist": float(dist),
        })

    # --- Aggregate ---
    avg_lm1_x = float(np.mean(lm1_xs)) if lm1_xs else 0.0
    avg_lm1_y = float(np.mean(lm1_ys)) if lm1_ys else 0.0
    avg_lm2_x = float(np.mean(lm2_xs)) if lm2_xs else 0.0
    avg_lm2_y = float(np.mean(lm2_ys)) if lm2_ys else 0.0

    logger.info(
        f"[Landmark] Done: {n_slices} slices, "
        f"{n_2ch_count} 2ch, {n_1ch_count} 1ch_fallback, {n_collapsed} collapsed"
    )

    return {
        "slices": slices_out,
        "avg_lm1": {"x": avg_lm1_x, "y": avg_lm1_y},
        "avg_lm2": {"x": avg_lm2_x, "y": avg_lm2_y},
        "n_total": n_slices,
        "n_collapsed": n_collapsed,
        "n_2ch": n_2ch_count,
        "n_1ch_fallback": n_1ch_count,
    }
