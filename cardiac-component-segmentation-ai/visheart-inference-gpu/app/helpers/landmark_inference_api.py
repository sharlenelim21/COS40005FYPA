"""
Landmark detection inference: RV insertion point detection.

Supports two-channel (MRI + seg mask) and one-channel (MRI only) modes.
Automatically falls back to 1ch when seg mask is missing or invalid.

Called from inference_route.py via the /inference/v2/landmark-detection endpoint.
Models are loaded at startup by model_init.landmark_model_lifespan().
"""

import importlib.util
import math
import os
import sys
import logging
import traceback
from math import sqrt
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

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
    env = os.getenv("LANDMARK_MODEL_2CH_PATH")
    if env and Path(env).exists():
        return Path(env).resolve()
    models_dir = Path(__file__).resolve().parents[1] / "models"
    for name in ("best_model_2ch.pth", "best_model.pth"):
        p = models_dir / name
        if p.exists():
            return p.resolve()
    repo_dir = _resolve_unetresnet34_dir()
    p = repo_dir / "checkpoints" / "best_model_2ch.pth"
    if p.exists():
        return p.resolve()
    raise FileNotFoundError(
        "Could not find 2ch landmark checkpoint. "
        "Set LANDMARK_MODEL_2CH_PATH or place best_model_2ch.pth in app/models/."
    )


def _resolve_checkpoint_1ch() -> Optional[Path]:
    """Path to the 1-channel (MRI only) BatchNorm checkpoint. Returns None if absent."""
    env = os.getenv("LANDMARK_MODEL_1CH_PATH")
    if env and Path(env).exists():
        return Path(env).resolve()
    models_dir = Path(__file__).resolve().parents[1] / "models"
    p = models_dir / "best_model_1ch.pth"
    if p.exists():
        return p.resolve()
    repo_dir = _resolve_unetresnet34_dir()
    p = repo_dir / "checkpoints" / "best_model_1ch.pth"
    if p.exists():
        return p.resolve()
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


def _zscore_volume(vol: np.ndarray):
    """Compute per-volume mean/std — matches training _PatientNormCache exactly."""
    mu  = float(vol.mean())
    std = float(vol.std()) + 1e-8
    return mu, std


def _normalize_slice(img_2d: np.ndarray, mu: float, std: float) -> np.ndarray:
    """Resize to 256×256 then apply per-volume z-score (matches training __getitem__)."""
    resized = _resize_2d(img_2d)
    return ((resized - mu) / std).astype(np.float32)


def preprocess_1ch(img_2d: np.ndarray, mu: float, std: float) -> torch.Tensor:
    """Return (1, 1, 256, 256) tensor from a 2-D MRI slice."""
    img = _normalize_slice(img_2d, mu, std)
    return torch.from_numpy(img).unsqueeze(0).unsqueeze(0)


def preprocess_2ch(img_2d: np.ndarray, seg_2d: np.ndarray, mu: float, std: float) -> torch.Tensor:
    """Return (1, 2, 256, 256) tensor: ch0 = volume z-scored MRI, ch1 = seg /max(max,3)."""
    img = _normalize_slice(img_2d, mu, std)
    seg_resized = np.round(_resize_2d(seg_2d)).astype(np.float32)
    # Match training: zero channel if RV absent, else divide by max(max, 3)
    if not np.any(seg_resized == 1):
        seg_norm = np.zeros_like(seg_resized)
    else:
        smax = max(float(seg_resized.max()), 3.0)
        seg_norm = (seg_resized / smax).astype(np.float32)
    stacked = np.stack([img, seg_norm], axis=0)
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
# RVIP anterior/inferior class check
#
# The model outputs two RVIP heatmap channels in a fixed training order
# (channel 0, channel 1) with no anatomical identity attached — downstream
# (bullseye_analysis.compute_alignment_angle) trusts "rv_insertion_1 =
# anterior, rv_insertion_2 = inferior" purely on that training convention.
# This computes the actual anterior/inferior identity geometrically from
# each point's angle around the LV centroid and reorders lm1/lm2 to match,
# so a model output in the "wrong" channel order gets corrected before it
# is stored, rather than propagating a silently-swapped alignment.
#
# Geometry: angles measured anti-clockwise from the LV centroid. The point
# at the smaller angle is anterior; the point at the larger angle is
# inferior. See Landmark-logic-Sharlene.pdf for the derivation.
# ---------------------------------------------------------------------------

def _lv_centroid_from_mask(seg_2d: Optional[np.ndarray], lv_class: float = 3.0) -> Optional[tuple[float, float]]:
    """Centroid (cx, cy) of the LV cavity class in a slice mask, or None if absent."""
    if seg_2d is None:
        return None
    ys, xs = np.where(np.round(seg_2d) == lv_class)
    if xs.size == 0:
        return None
    return float(xs.mean()), float(ys.mean())


def _assign_rvip_classes(
    point_a: tuple[float, float],
    point_b: tuple[float, float],
    centroid: tuple[float, float],
) -> tuple[tuple[float, float], tuple[float, float], bool]:
    """
    Classify two RVIP points as (anterior, inferior) using their angular
    position around the LV centroid.

    The anterior RVIP always occurs at a smaller angle than the inferior
    RVIP (anti-clockwise positive), given a non-flipped image.

    Returns
    -------
    (anterior_point, inferior_point, swapped)
        swapped is True when point_b (the original lm2) turned out to be
        anterior — i.e. the model's channel order needed correcting.
    """
    cx, cy = centroid
    ax, ay = point_a
    bx, by = point_b

    angle_a = math.degrees(math.atan2(ay - cy, ax - cx)) % 360.0
    angle_b = math.degrees(math.atan2(by - cy, bx - cx)) % 360.0

    if angle_b < angle_a:
        inferior, anterior = point_a, point_b
        swapped = True
    else:
        inferior, anterior = point_b, point_a
        swapped = False

    return anterior, inferior, swapped


# ---------------------------------------------------------------------------
# Core inference (called from inference_jobs / inference_route)
# ---------------------------------------------------------------------------

<<<<<<< HEAD
def _run_landmark_inference_for_frame(
    img: np.ndarray,
    seg_vol: Optional[np.ndarray],
    model_2ch: nn.Module,
    model_1ch: nn.Module,
    torch_device: torch.device,
    frame_idx: int,
=======
def run_landmark_inference_from_nifti(
    nifti_path: str,
    seg_mask_path: Optional[str] = None,
    device: str = "auto",
    checkpoint_path: Optional[str] = None,
    model_2ch: Optional[nn.Module] = None,
    model_1ch: Optional[nn.Module] = None,
    torch_device: Optional[torch.device] = None,
    progress_callback: Optional[Callable[[int, int], None]] = None,
<<<<<<< Updated upstream
=======
>>>>>>> 93eef31cb1ce4ac8f9f7bea54c1e6df715b70773
>>>>>>> Stashed changes
) -> Dict[str, Any]:
    """
    Run per-slice landmark inference on a single cardiac frame's 3-D volume
    (img: H x W x n_slices). Identical logic to what used to be the body of
    run_landmark_inference_from_nifti before it gained a frame loop — the
    RVIP class-check is per-slice and has no cross-frame state, so this is a
    straight extraction, not a behaviour change for any one frame.
    """
<<<<<<< HEAD
    n_slices = img.shape[2]
    H_orig, W_orig = img.shape[0], img.shape[1]
=======
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
    # Landmarks are detected on every cardiac frame so each frame's slices can be reviewed and
    # edited on their own. Bullseye/strain alignment is still anchored to ED (frame 0) -- the
    # avg_lm1/avg_lm2 returned below are averaged over frame 0 only, never blended across phases.
    # Set LANDMARK_ALL_FRAMES=0 to detect on ED only (cost scales with the number of frames).
    nii = nib.load(nifti_path)
    img_full = nii.get_fdata().astype(np.float32)
    if img_full.ndim == 3:
        img_full = img_full[..., np.newaxis]
    if img_full.ndim != 4:
        raise ValueError(f"Unsupported NIfTI shape: {img_full.shape}")

    all_frames = os.getenv("LANDMARK_ALL_FRAMES", "1").strip() != "0"
    frame_ids = list(range(img_full.shape[3])) if all_frames else [0]
    img = img_full[:, :, :, 0]  # ED volume: shape reference and normalisation statistics

    n_slices = img.shape[2]
    logger.info(
        f"[Landmark] MRI shape {img_full.shape}, processing {n_slices} slices x {len(frame_ids)} frame(s) on {torch_device}"
    )

    # --- Load seg volume once ---
    seg_full: Optional[np.ndarray] = None
    if seg_mask_path is not None:
        try:
            seg_nii = nib.load(seg_mask_path)
            seg_full = seg_nii.get_fdata().astype(np.float32)
            if seg_full.ndim == 3:
                seg_full = seg_full[..., np.newaxis]
            logger.info(f"[Landmark] Seg mask shape {seg_full.shape}")
        except Exception as exc:
            logger.warning(f"[Landmark] Could not load seg mask: {exc} — 1ch fallback for all slices")
            seg_full = None
<<<<<<< Updated upstream
=======
>>>>>>> 93eef31cb1ce4ac8f9f7bea54c1e6df715b70773
>>>>>>> Stashed changes

    # --- Per-volume normalisation stats (matches training _PatientNormCache) ---
    vol_mu, vol_std = _zscore_volume(img)

    slices_out: List[Dict[str, Any]] = []
    lm1_xs, lm1_ys, lm2_xs, lm2_ys = [], [], [], []
    n_collapsed = 0
    n_2ch_count = 0
    n_1ch_count = 0
    n_class_checked = 0
    n_class_swapped = 0

<<<<<<< Updated upstream
    H_orig, W_orig = img.shape[0], img.shape[1]

    total_steps = n_slices * len(frame_ids)
    for f_pos, f in enumerate(frame_ids):
        for i in range(n_slices):
            if progress_callback is not None:
                progress_callback(f_pos * n_slices + i, total_steps)
            img_2d = img_full[:, :, i, f]

            # The mask is only usable when it has this frame; otherwise this slice falls back to 1ch.
            seg_2d: Optional[np.ndarray] = None
            if seg_full is not None and i < seg_full.shape[2] and f < seg_full.shape[3]:
                seg_2d = np.round(seg_full[:, :, i, f]).astype(np.float32)

=======
<<<<<<< HEAD
    for i in range(n_slices):
        img_2d = img[:, :, i]
=======
    H_orig, W_orig = img.shape[0], img.shape[1]

    total_steps = n_slices * len(frame_ids)
    for f_pos, f in enumerate(frame_ids):
        for i in range(n_slices):
            if progress_callback is not None:
                progress_callback(f_pos * n_slices + i, total_steps)
            img_2d = img_full[:, :, i, f]
>>>>>>> 93eef31cb1ce4ac8f9f7bea54c1e6df715b70773

            # The mask is only usable when it has this frame; otherwise this slice falls back to 1ch.
            seg_2d: Optional[np.ndarray] = None
            if seg_full is not None and i < seg_full.shape[2] and f < seg_full.shape[3]:
                seg_2d = np.round(seg_full[:, :, i, f]).astype(np.float32)

>>>>>>> Stashed changes
            if is_seg_valid(seg_2d):
                tensor = preprocess_2ch(img_2d, seg_2d, vol_mu, vol_std)
                model_to_use = model_2ch
                model_used = "2ch"
            else:
                tensor = preprocess_1ch(img_2d, vol_mu, vol_std)
                model_to_use = model_1ch
                model_used = "1ch_fallback"

            if i == 0:
                logger.info(
                    f"[Landmark] DEBUG slice 0 tensor: shape={list(tensor.shape)} "
                    f"min={tensor.min():.3f} max={tensor.max():.3f} mean={tensor.mean():.3f} "
                    f"vol_mu={vol_mu:.3f} vol_std={vol_std:.3f}"
                )

            heatmap = _tta_predict(model_to_use, tensor, torch_device)

            hm_lm1 = heatmap[0]
            hm_lm2 = heatmap[1]
            lm1_x, lm1_y, hm1_max = _heatmap_to_coord(hm_lm1, H_orig, W_orig)
            lm2_x, lm2_y, hm2_max = _heatmap_to_coord(hm_lm2, H_orig, W_orig)

            # --- RVIP anterior/inferior class check ---
            # Model channel order (lm1/lm2) has no confirmed anatomical identity;
            # verify it geometrically against the LV centroid and reorder so
            # lm1 = anterior, lm2 = inferior, matching what compute_alignment_angle
            # downstream assumes. Only possible when an LV cavity mask exists for
            # this slice (2ch mode) — otherwise the raw model order is kept as-is.
            lv_centroid = _lv_centroid_from_mask(seg_2d)
            class_swapped = False
            if lv_centroid is not None:
                anterior_pt, inferior_pt, class_swapped = _assign_rvip_classes(
                    (lm1_x, lm1_y), (lm2_x, lm2_y), lv_centroid
                )
                lm1_x, lm1_y = anterior_pt
                lm2_x, lm2_y = inferior_pt
                n_class_checked += 1
                if class_swapped:
                    n_class_swapped += 1

            logger.info(
<<<<<<< Updated upstream
=======
<<<<<<< HEAD
                f"[Landmark] DEBUG frame {frame_idx} slice 0 tensor: shape={list(tensor.shape)} "
                f"min={tensor.min():.3f} max={tensor.max():.3f} mean={tensor.mean():.3f} "
                f"vol_mu={vol_mu:.3f} vol_std={vol_std:.3f}"
=======
>>>>>>> Stashed changes
                f"[Landmark] frame {f} slice {i} [{model_used}] "
                f"lm1=({lm1_x:.1f},{lm1_y:.1f}) max={hm1_max:.4f}  "
                f"lm2=({lm2_x:.1f},{lm2_y:.1f}) max={hm2_max:.4f}  "
                f"dist={sqrt((lm1_x-lm2_x)**2+(lm1_y-lm2_y)**2):.1f}"
                + (f"  class_swapped={class_swapped} centroid={lv_centroid}" if lv_centroid is not None else "  class_check=skipped(no LV mask)")
<<<<<<< Updated upstream
=======
>>>>>>> 93eef31cb1ce4ac8f9f7bea54c1e6df715b70773
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
=======
<<<<<<< HEAD
        logger.info(
            f"[Landmark] frame {frame_idx} slice {i} [{model_used}] "
            f"lm1=({lm1_x:.1f},{lm1_y:.1f}) max={hm1_max:.4f}  "
            f"lm2=({lm2_x:.1f},{lm2_y:.1f}) max={hm2_max:.4f}  "
            f"dist={sqrt((lm1_x-lm2_x)**2+(lm1_y-lm2_y)**2):.1f}"
            + (f"  class_swapped={class_swapped} centroid={lv_centroid}" if lv_centroid is not None else "  class_check=skipped(no LV mask)")
        )
=======
>>>>>>> Stashed changes
            if f == 0:
                lm1_xs.append(float(lm1_x))
                lm1_ys.append(float(lm1_y))
                lm2_xs.append(float(lm2_x))
                lm2_ys.append(float(lm2_y))
<<<<<<< Updated upstream
=======
>>>>>>> 93eef31cb1ce4ac8f9f7bea54c1e6df715b70773
>>>>>>> Stashed changes

            slices_out.append({
                "frame": f,
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
                "class_check": {
                    "checked": lv_centroid is not None,
                    "swapped": class_swapped,
                    "centroid": {"x": lv_centroid[0], "y": lv_centroid[1]} if lv_centroid is not None else None,
                },
            })

    if progress_callback is not None:
        progress_callback(total_steps, total_steps)

    # --- Aggregate ---
    avg_lm1_x = float(np.mean(lm1_xs)) if lm1_xs else 0.0
    avg_lm1_y = float(np.mean(lm1_ys)) if lm1_ys else 0.0
    avg_lm2_x = float(np.mean(lm2_xs)) if lm2_xs else 0.0
    avg_lm2_y = float(np.mean(lm2_ys)) if lm2_ys else 0.0

    logger.info(
<<<<<<< Updated upstream
        f"[Landmark] Done: {n_slices} slices x {len(frame_ids)} frame(s), "
=======
<<<<<<< HEAD
        f"[Landmark] frame {frame_idx} done: {n_slices} slices, "
=======
        f"[Landmark] Done: {n_slices} slices x {len(frame_ids)} frame(s), "
>>>>>>> 93eef31cb1ce4ac8f9f7bea54c1e6df715b70773
>>>>>>> Stashed changes
        f"{n_2ch_count} 2ch, {n_1ch_count} 1ch_fallback, {n_collapsed} collapsed, "
        f"{n_class_checked} class_checked ({n_class_swapped} swapped), "
        f"{n_slices * len(frame_ids) - n_class_checked} class_check_skipped(no LV mask)"
    )

    return {
        "frameindex": frame_idx,
        "slices": slices_out,
        "avg_lm1": {"x": avg_lm1_x, "y": avg_lm1_y},
        "avg_lm2": {"x": avg_lm2_x, "y": avg_lm2_y},
        "n_total": n_slices * len(frame_ids),
        "n_frames": len(frame_ids),
        "n_collapsed": n_collapsed,
        "n_2ch": n_2ch_count,
        "n_1ch_fallback": n_1ch_count,
        "n_class_checked": n_class_checked,
        "n_class_swapped": n_class_swapped,
    }


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
    Run landmark detection on every cardiac frame of a 4-D NIfTI MRI volume.

    Runs across all cardiac frames (not just ED) so the frontend can show and
    edit landmarks for the whole cardiac cycle. Bullseye/strain alignment
    downstream still only ever reads frame 0's (ED's) avg_lm1/avg_lm2 — this
    just makes every other frame's points available too, it doesn't change
    what alignment consumes.

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
    dict with keys: frames (one entry per cardiac frame, each shaped like a
                    single-frame result — see _run_landmark_inference_for_frame),
                    n_frames, avg_lm1, avg_lm2 (frame 0's, for callers that
                    only ever cared about ED — e.g. the webhook's alignment
                    recompute — without needing to know about the frames list).
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

    # --- Load MRI volume (all cardiac frames) ---
    nii = nib.load(nifti_path)
    img = nii.get_fdata().astype(np.float32)
    if img.ndim == 3:
        img = img[:, :, :, np.newaxis]  # single-frame volume -> treat as 1 frame
    if img.ndim != 4:
        raise ValueError(f"Unsupported NIfTI shape: {img.shape}")

    n_frames = img.shape[3]
    logger.info(f"[Landmark] MRI shape {img.shape}, processing {n_frames} cardiac frame(s) on {torch_device}")

    # --- Load seg volume once (all frames, if the seg mask is itself 4D) ---
    seg_vol_4d: Optional[np.ndarray] = None
    if seg_mask_path is not None:
        try:
            seg_nii = nib.load(seg_mask_path)
            seg_vol_4d = seg_nii.get_fdata().astype(np.float32)
            if seg_vol_4d.ndim == 3:
                seg_vol_4d = seg_vol_4d[:, :, :, np.newaxis]
            logger.info(f"[Landmark] Seg mask shape {seg_vol_4d.shape}")
        except Exception as exc:
            logger.warning(f"[Landmark] Could not load seg mask: {exc} — 1ch fallback for all frames/slices")
            seg_vol_4d = None

    frames_out: List[Dict[str, Any]] = []
    for frame_idx in range(n_frames):
        img_frame = img[:, :, :, frame_idx]
        seg_frame: Optional[np.ndarray] = None
        if seg_vol_4d is not None:
            # Most projects only ever have a segmentation mask for one frame
            # (ED) — reuse it for every cardiac frame rather than requiring a
            # full 4D seg mask, same as how a missing mask already triggers
            # the existing per-slice 1ch fallback (is_seg_valid).
            seg_frame_idx = frame_idx if frame_idx < seg_vol_4d.shape[3] else 0
            seg_frame = seg_vol_4d[:, :, :, seg_frame_idx]
        frames_out.append(
            _run_landmark_inference_for_frame(img_frame, seg_frame, model_2ch, model_1ch, torch_device, frame_idx)
        )

    ed_frame = frames_out[0]
    logger.info(f"[Landmark] All {n_frames} frame(s) done.")

    return {
        "frames": frames_out,
        "n_frames": n_frames,
        # Flat top-level ED convenience fields, for callers (e.g. the backend
        # webhook's bullseye-alignment recompute) that only ever need ED's
        # average points and shouldn't need to know the response is now
        # multi-frame.
        "avg_lm1": ed_frame["avg_lm1"],
        "avg_lm2": ed_frame["avg_lm2"],
    }
