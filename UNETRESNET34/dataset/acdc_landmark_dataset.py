"""
ACDC landmark dataset — mirrors landmark_dataset.py exactly.

Differences from LandmarkDataset:
  - Three folders (images, masks, points) share identical filenames
  - Points are 4-D .nii.gz (H, W, S, 2):
      channel 0 = LM1 binary mask  (superior/anterior RV insertion point)
      channel 1 = LM2 binary mask  (inferior RV insertion point)
  - patient_ids parameter restricts which files are loaded
  - in_channels=1 → MRI only [1,256,256]
    in_channels=2 → MRI + seg mask [2,256,256], mask /3 → [0,1]
"""

import os
import nibabel as nib
import numpy as np
import torch
from torch.utils.data import Dataset
import cv2
from scipy.ndimage import gaussian_filter, map_coordinates

try:
    import torchio as tio
    _TIO_AVAILABLE = True
except ImportError:
    _TIO_AVAILABLE = False

from utils.heatmap import coords_to_heatmaps


# ── augmentation helpers (copied verbatim from landmark_dataset.py) ────────────

def elastic_deform(image, coords, alpha=20, sigma=5, seed=None):
    rng = np.random.RandomState(seed)
    H, W = image.shape
    dx = cv2.GaussianBlur(rng.uniform(-1, 1, (H, W)).astype(np.float32), (0, 0), sigma) * alpha
    dy = cv2.GaussianBlur(rng.uniform(-1, 1, (H, W)).astype(np.float32), (0, 0), sigma) * alpha
    x, y = np.meshgrid(np.arange(W), np.arange(H))
    map_x = np.clip(x + dx, 0, W - 1).astype(np.float32)
    map_y = np.clip(y + dy, 0, H - 1).astype(np.float32)
    image_def = cv2.remap(image, map_x, map_y, interpolation=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_REFLECT)
    new_coords = coords.copy()
    for i, (cx, cy) in enumerate([(coords[0], coords[1]), (coords[2], coords[3])]):
        ix = int(np.clip(round(cx), 0, W - 1))
        iy = int(np.clip(round(cy), 0, H - 1))
        new_coords[i * 2]     = np.clip(cx + dx[iy, ix], 0, W - 1)
        new_coords[i * 2 + 1] = np.clip(cy + dy[iy, ix], 0, H - 1)
    return image_def, new_coords


def random_crop_resize(image, coords, crop_ratio=0.85):
    H, W = image.shape
    ch = int(H * crop_ratio)
    cw = int(W * crop_ratio)
    top  = np.random.randint(0, H - ch + 1)
    left = np.random.randint(0, W - cw + 1)
    cropped = image[top:top+ch, left:left+cw]
    resized = cv2.resize(cropped, (W, H))
    new_coords = coords.copy()
    new_coords[0] = np.clip((coords[0] - left) * W / cw, 0, W - 1)
    new_coords[1] = np.clip((coords[1] - top)  * H / ch, 0, H - 1)
    new_coords[2] = np.clip((coords[2] - left) * W / cw, 0, W - 1)
    new_coords[3] = np.clip((coords[3] - top)  * H / ch, 0, H - 1)
    return resized, new_coords


def random_rotate(image, coords, max_angle=45, M=None):
    """
    Rotate image and coords by a random angle.
    If M is provided, use it directly (allows applying the same rotation
    to a second image, e.g. seg mask, without sampling a new angle).
    Returns (rotated_image, updated_coords, M) so the caller can reuse M.
    """
    H, W = image.shape
    if M is None:
        angle = np.random.uniform(-max_angle, max_angle)
        M = cv2.getRotationMatrix2D((W / 2.0, H / 2.0), angle, 1.0)
    rotated = cv2.warpAffine(image, M, (W, H), flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_REFLECT)
    new_coords = coords.copy()
    for i in range(2):
        px, py = coords[i * 2], coords[i * 2 + 1]
        nx = M[0, 0] * px + M[0, 1] * py + M[0, 2]
        ny = M[1, 0] * px + M[1, 1] * py + M[1, 2]
        new_coords[i * 2]     = np.clip(nx, 0, W - 1)
        new_coords[i * 2 + 1] = np.clip(ny, 0, H - 1)
    return rotated, new_coords, M


# ── MRI-specific intensity augmentations (applied before standardisation) ─────

def apply_bias_field(img_2d: np.ndarray) -> np.ndarray:
    """
    Simulate MRI scanner intensity non-uniformity via a random bias field.
    Requires torchio. Falls back to identity if torchio is unavailable.
    Operates on a raw (unnormalised) 2-D float32 slice.
    """
    if not _TIO_AVAILABLE:
        return img_2d
    tensor  = torch.tensor(img_2d[None, None], dtype=torch.float32)
    subject = tio.Subject(image=tio.ScalarImage(tensor=tensor))
    result  = tio.RandomBiasField(coefficients=0.5)(subject)
    return result.image.tensor[0, 0].numpy()


def apply_gaussian_blur(img_2d: np.ndarray) -> np.ndarray:
    """
    Simulate varying scanner resolution / point spread function.
    Operates on a raw (unnormalised) 2-D float32 slice.
    """
    sigma = np.random.uniform(0.3, 1.0)
    return gaussian_filter(img_2d, sigma=sigma).astype(np.float32)


# ── new appearance / geometric augmentations ──────────────────────────────────

def elastic_deform_appearance(image, seg=None, alpha=20, sigma=5):
    """
    Elastic deformation as a pure appearance augmentation.
    Applies the same displacement field to both image and seg mask.
    Landmark coordinates are NOT updated — caller keeps original coords.
    image: float32 (H, W)
    seg:   float32 (H, W) or None
    Returns (deformed_image, deformed_seg_or_None)
    """
    shape = image.shape
    dx = gaussian_filter(np.random.randn(*shape).astype(np.float32), sigma) * alpha
    dy = gaussian_filter(np.random.randn(*shape).astype(np.float32), sigma) * alpha
    y_grid, x_grid = np.meshgrid(np.arange(shape[0]), np.arange(shape[1]), indexing="ij")
    indices = (
        np.clip(y_grid + dy, 0, shape[0] - 1).ravel(),
        np.clip(x_grid + dx, 0, shape[1] - 1).ravel(),
    )
    deformed_img = map_coordinates(image, indices, order=1).reshape(shape).astype(np.float32)
    if seg is not None:
        deformed_seg = map_coordinates(seg, indices, order=0).reshape(shape).astype(np.float32)
        return deformed_img, deformed_seg
    return deformed_img, None


def histogram_perturb(img: np.ndarray) -> np.ndarray:
    """
    Piecewise-linear histogram perturbation to simulate scanner-specific shifts.
    Operates on a normalised float32 image; preserves value range.
    """
    lo, hi = img.min(), img.max()
    if hi - lo < 1e-6:
        return img
    n_pts = np.random.randint(3, 6)
    src = np.sort(np.random.uniform(lo, hi, n_pts))
    noise = np.random.uniform(-0.1 * (hi - lo), 0.1 * (hi - lo), n_pts)
    dst = np.clip(src + noise, lo, hi)
    return np.interp(img, src, dst).astype(np.float32)


def random_scale(image, seg=None, scale_range=(0.85, 1.15)):
    """
    Random zoom in/out with centre crop or zero-pad to restore original size.
    Applies the same scale to both image and seg (seg uses INTER_NEAREST).
    Returns (scaled_image, scaled_seg_or_None, (start_h, start_w, scale))
    so the caller can adjust landmark coordinates.
    """
    scale = np.random.uniform(*scale_range)
    H, W  = image.shape
    new_H = int(H * scale)
    new_W = int(W * scale)

    scaled_img = cv2.resize(image, (new_W, new_H), interpolation=cv2.INTER_LINEAR)
    scaled_seg = None
    if seg is not None:
        scaled_seg = cv2.resize(seg, (new_W, new_H), interpolation=cv2.INTER_NEAREST)

    if scale > 1.0:
        # Crop centre back to original size
        sh = (new_H - H) // 2
        sw = (new_W - W) // 2
        out_img = scaled_img[sh:sh + H, sw:sw + W]
        out_seg = scaled_seg[sh:sh + H, sw:sw + W] if scaled_seg is not None else None
    else:
        # Paste into zero-padded canvas
        sh = (H - new_H) // 2
        sw = (W - new_W) // 2
        out_img = np.zeros((H, W), dtype=image.dtype)
        out_img[sh:sh + new_H, sw:sw + new_W] = scaled_img
        if scaled_seg is not None:
            out_seg = np.zeros((H, W), dtype=seg.dtype)
            out_seg[sh:sh + new_H, sw:sw + new_W] = scaled_seg
        else:
            out_seg = None

    return out_img, out_seg, scale, (int(H * max(scale, 1.0) - H) // 2 if scale > 1.0 else -(H - new_H) // 2)


# ── per-patient normalisation cache (copied verbatim) ─────────────────────────

class _PatientNormCache:
    def __init__(self):
        self._cache = {}

    def get(self, img_path: str, img_array: np.ndarray):
        if img_path not in self._cache:
            mu  = img_array.mean()
            std = img_array.std() + 1e-8
            self._cache[img_path] = (mu, std)
        return self._cache[img_path]


_NORM_CACHE = _PatientNormCache()


# ── dataset ────────────────────────────────────────────────────────────────────

class ACDCLandmarkDataset(Dataset):
    def __init__(
        self,
        image_dir,
        mask_dir,
        rvip_dir,
        patient_ids,
        in_channels=1,
        augment=False,
        sigma=8,
        min_landmark_dist=5,
        min_slice_variance=0.01,
        min_lm1_confidence=0.0,
        seg_dropout_prob=0.0,
    ):
        self.image_dir          = image_dir
        self.mask_dir           = mask_dir
        self.rvip_dir           = rvip_dir
        self.patient_ids        = [p.lower() for p in patient_ids]
        self.in_channels        = in_channels
        self.augment            = augment
        self.sigma              = sigma
        self.min_landmark_dist  = min_landmark_dist
        self.min_slice_variance = min_slice_variance
        self.min_lm1_confidence = min_lm1_confidence
        self.seg_dropout_prob   = seg_dropout_prob

        self.samples = self._build_samples()

        if len(self.samples) == 0:
            raise RuntimeError("No valid ACDC samples found. Check paths and patient IDs.")

        print(f"OK ACDCLandmarkDataset: {len(self.samples)} valid slices "
              f"(in_channels={in_channels})")

    def set_sigma(self, sigma):
        self.sigma = sigma

    # ------------------------------------------------------------------
    # Index building
    # ------------------------------------------------------------------

    def _patient_files(self):
        return sorted(
            fn for fn in os.listdir(self.image_dir)
            if fn.endswith(".nii.gz")
            and any(pid in fn.lower() for pid in self.patient_ids)
        )

    def _build_samples(self):
        samples = []
        n_low_conf = 0

        for fname in self._patient_files():
            img_path  = os.path.join(self.image_dir, fname)
            mask_path = os.path.join(self.mask_dir,  fname)
            rvip_path = os.path.join(self.rvip_dir,  fname)

            if not os.path.exists(mask_path) or not os.path.exists(rvip_path):
                continue

            try:
                img_vol  = nib.load(img_path).get_fdata().astype(np.float32)
                mask_vol = nib.load(mask_path).get_fdata().astype(np.float32)
                pts_vol  = nib.load(rvip_path).get_fdata()   # (H, W, S, 2)
            except Exception as exc:
                print(f"  [skip] {fname}: {exc}")
                continue

            if img_vol.ndim == 4:
                img_vol  = img_vol[..., 0]
            if mask_vol.ndim == 4:
                mask_vol = mask_vol[..., 0]

            if pts_vol.ndim != 4 or pts_vol.shape[3] != 2:
                print(f"  [skip] {fname}: unexpected points shape {pts_vol.shape}")
                continue

            H, W, n_slices = img_vol.shape

            for z in range(n_slices):
                coords = self._extract_points(pts_vol, z)
                if coords is None:
                    continue

                # LM1 annotation confidence filter
                if self.min_lm1_confidence > 0:
                    lm1_pixels = int((pts_vol[:, :, z, 0] > 0.5).sum())
                    confidence = lm1_pixels / 5.0   # expected blob size = 5 pixels
                    if confidence < self.min_lm1_confidence:
                        n_low_conf += 1
                        continue

                # Landmark separation filter (in 256-space)
                dist = np.linalg.norm([coords[2] - coords[0], coords[3] - coords[1]]) \
                       * 256 / max(H, W)
                if dist < self.min_landmark_dist:
                    continue

                # Variance filter — same logic as LandmarkDataset
                img_sl = img_vol[:, :, z]
                mu_s   = img_sl.mean()
                std_s  = img_sl.std() + 1e-8
                if ((img_sl - mu_s) / std_s).var() < self.min_slice_variance:
                    continue

                samples.append((fname, z, coords, H, W))

        if n_low_conf:
            print(f"  [ACDCLandmarkDataset] filtered {n_low_conf} slices "
                  f"with LM1 confidence < {self.min_lm1_confidence} "
                  f"(threshold = {self.min_lm1_confidence * 5:.1f} pixels)")

        return samples

    def _extract_points(self, pts_vol, z):
        """
        Extract LM1 and LM2 from pts_vol[:,:,z,:].
        channel 0 = LM1, channel 1 = LM2 (binary masks, value > 0.5).
        Returns (x1, y1, x2, y2) float32 in original voxel space,
        LM1 = superior (smaller y), LM2 = inferior (larger y).
        Returns None if either landmark is absent.
        """
        lm1_mask   = pts_vol[:, :, z, 0]
        lm1_coords = np.argwhere(lm1_mask > 0.5)   # rows: (row=y, col=x)
        if len(lm1_coords) == 0:
            return None

        lm2_mask   = pts_vol[:, :, z, 1]
        lm2_coords = np.argwhere(lm2_mask > 0.5)
        if len(lm2_coords) == 0:
            return None

        lm1_y, lm1_x = lm1_coords.mean(axis=0)
        lm2_y, lm2_x = lm2_coords.mean(axis=0)

        # Enforce LM1 = superior (smaller y = higher in image)
        if lm1_y > lm2_y:
            lm1_x, lm1_y, lm2_x, lm2_y = lm2_x, lm2_y, lm1_x, lm1_y

        return np.array([lm1_x, lm1_y, lm2_x, lm2_y], dtype=np.float32)

    # ------------------------------------------------------------------
    # Dataset interface
    # ------------------------------------------------------------------

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        fname, z, coords, H_orig, W_orig = self.samples[idx]

        img_path  = os.path.join(self.image_dir, fname)
        mask_path = os.path.join(self.mask_dir,  fname)

        img_vol  = nib.load(img_path).get_fdata().astype(np.float32)
        mask_vol = nib.load(mask_path).get_fdata().astype(np.float32)
        if img_vol.ndim  == 4: img_vol  = img_vol[...,  0]
        if mask_vol.ndim == 4: mask_vol = mask_vol[..., 0]

        img_2d  = img_vol[:,  :, z]
        mask_2d = mask_vol[:, :, z]

        # ── Intensity augmentations BEFORE standardisation (MRI only) ─────────
        if self.augment:
            if np.random.rand() < 0.3:          # Change 1 — bias field
                img_2d = apply_bias_field(img_2d)
            if np.random.rand() < 0.3:          # Change 2 — Gaussian blur
                img_2d = apply_gaussian_blur(img_2d)
        # ──────────────────────────────────────────────────────────────────────

        # Per-patient normalisation (same as LandmarkDataset)
        mu, std   = _NORM_CACHE.get(img_path, img_vol)
        image_res = cv2.resize(img_2d, (256, 256))
        image_res = (image_res - mu) / std

        # Scale coords to 256×256 space
        x1, y1, x2, y2 = coords
        x1 = x1 * 256 / W_orig;  x2 = x2 * 256 / W_orig
        y1 = y1 * 256 / H_orig;  y2 = y2 * 256 / H_orig
        coords_scaled = np.array([x1, y1, x2, y2], dtype=np.float32)

        # Resize seg mask to 256×256 before augmentation so geometric transforms
        # can be applied to both channels with the same parameters.
        # Pre-round before INTER_NEAREST resize to guard against fractional label
        # values that can appear if the NIfTI was ever resampled with linear interp.
        mask_res = cv2.resize(np.round(mask_2d).astype(np.float32), (256, 256),
                              interpolation=cv2.INTER_NEAREST).astype(np.float32)

        # Augmentation — geometric ops applied identically to image AND mask.
        if self.augment:
            # Horizontal flip
            if np.random.rand() < 0.5:
                image_res        = np.fliplr(image_res).copy()
                mask_res         = np.fliplr(mask_res).copy()
                coords_scaled[0] = 255 - coords_scaled[0]
                coords_scaled[2] = 255 - coords_scaled[2]

            # Vertical flip
            if np.random.rand() < 0.5:
                image_res        = np.flipud(image_res).copy()
                mask_res         = np.flipud(mask_res).copy()
                coords_scaled[1] = 255 - coords_scaled[1]
                coords_scaled[3] = 255 - coords_scaled[3]

            # Rotation — sample M once, apply to both image and mask (Issue 6)
            if np.random.rand() < 0.7:
                image_res, coords_scaled, M = random_rotate(
                    image_res, coords_scaled, max_angle=45
                )
                # Apply the exact same rotation matrix to the seg mask
                H_r, W_r = mask_res.shape
                mask_res = cv2.warpAffine(mask_res, M, (W_r, H_r),
                                          flags=cv2.INTER_NEAREST,
                                          borderMode=cv2.BORDER_REFLECT)

            # Intensity-only augmentations (image only, mask unchanged)
            if np.random.rand() < 0.5:
                image_res = image_res * np.random.uniform(0.8, 1.2) \
                          + np.random.uniform(-0.1, 0.1)
            if np.random.rand() < 0.3:
                image_res = image_res \
                          + np.random.randn(*image_res.shape).astype(np.float32) * 0.05

            # Histogram perturbation — MRI only, simulates scanner histogram shifts
            if np.random.rand() < 0.3:
                image_res = histogram_perturb(image_res)

            # Elastic deformation (appearance only) — same field on image + mask,
            # coordinates are NOT updated (deformation is treated as appearance aug)
            if np.random.rand() < 0.3:
                seg_arg = mask_res if self.in_channels == 2 else None
                deformed_img, deformed_seg = elastic_deform_appearance(
                    image_res, seg_arg, alpha=20, sigma=5,
                )
                image_res = deformed_img
                if deformed_seg is not None:
                    mask_res = deformed_seg

            # Affine scaling — same scale on image + mask, coords updated + clamped
            if np.random.rand() < 0.3:
                seg_in = mask_res if self.in_channels == 2 else None
                out_img, out_seg, scale, pad_sh = random_scale(
                    image_res, seg_in, scale_range=(0.85, 1.15)
                )
                image_res = out_img
                if out_seg is not None:
                    mask_res = out_seg
                # Adjust coords: scale then shift by the crop/pad offset
                if scale > 1.0:
                    sw = (int(256 * scale) - 256) // 2
                    sh = sw
                    coords_scaled[0] = np.clip(coords_scaled[0] * scale - sw, 0, 255)
                    coords_scaled[1] = np.clip(coords_scaled[1] * scale - sh, 0, 255)
                    coords_scaled[2] = np.clip(coords_scaled[2] * scale - sw, 0, 255)
                    coords_scaled[3] = np.clip(coords_scaled[3] * scale - sh, 0, 255)
                else:
                    sh = (256 - int(256 * scale)) // 2
                    sw = sh
                    coords_scaled[0] = np.clip(coords_scaled[0] * scale + sw, 0, 255)
                    coords_scaled[1] = np.clip(coords_scaled[1] * scale + sh, 0, 255)
                    coords_scaled[2] = np.clip(coords_scaled[2] * scale + sw, 0, 255)
                    coords_scaled[3] = np.clip(coords_scaled[3] * scale + sh, 0, 255)

            # Legacy elastic deform with coord tracking (kept from original)
            if np.random.rand() < 0.4:
                image_res, coords_scaled = elastic_deform(
                    image_res, coords_scaled, alpha=15, sigma=4
                )

            # Crop-resize — apply to both
            if np.random.rand() < 0.4:
                cr = np.random.uniform(0.80, 0.95)
                image_res, coords_scaled = random_crop_resize(
                    image_res, coords_scaled, crop_ratio=cr
                )
                H_m, W_m = mask_res.shape
                ch = int(H_m * cr);  cw = int(W_m * cr)
                top  = np.random.randint(0, H_m - ch + 1)
                left = np.random.randint(0, W_m - cw + 1)
                mask_res = cv2.resize(mask_res[top:top+ch, left:left+cw],
                                      (W_m, H_m), interpolation=cv2.INTER_NEAREST)

            # Re-enforce LM1=superior after ALL geometric augmentations (Issue 5)
            if coords_scaled[1] > coords_scaled[3]:
                coords_scaled = np.array([
                    coords_scaled[2], coords_scaled[3],
                    coords_scaled[0], coords_scaled[1],
                ], dtype=np.float32)

        coords_scaled = np.clip(coords_scaled, 0, 255)

        # Build image tensor
        if self.in_channels == 2:
            # Fix 2 (matches rv_landmark_dataset.py and inference_rv.py):
            # Zero the seg channel entirely when RV (label 1) is absent so the
            # model sees the same all-zero signal as at RV-dataset inference time.
            # Normalise by max(slice_max, 3.0) so a full-label slice maps to
            # [0, 1] under the same absolute scale as the RV dataset's /smax.
            if not np.any(mask_res == 1):
                mask_norm = np.zeros_like(mask_res, dtype=np.float32)
            else:
                smax = max(float(mask_res.max()), 3.0)
                mask_norm = (mask_res / smax).astype(np.float32)
            # Seg channel dropout — training only. Forces model to learn from
            # MRI alone on a fraction of batches, improving cross-dataset robustness.
            if self.augment and self.seg_dropout_prob > 0 and \
                    np.random.rand() < self.seg_dropout_prob:
                mask_norm = np.zeros_like(mask_norm)
            image_out = np.stack([image_res.astype(np.float32), mask_norm], axis=0)
        else:
            image_out = np.expand_dims(image_res.astype(np.float32), axis=0)

        heatmaps = coords_to_heatmaps(coords_scaled, (256, 256), sigma=self.sigma)

        return (
            torch.tensor(image_out,     dtype=torch.float32),
            torch.tensor(heatmaps,      dtype=torch.float32),
            torch.tensor(coords_scaled, dtype=torch.float32),
        )
