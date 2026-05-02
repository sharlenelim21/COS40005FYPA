import os
import nibabel as nib
import numpy as np
import torch
from torch.utils.data import Dataset
import cv2

from utils.heatmap import coords_to_heatmaps

# ── elastic deformation helper ────────────────────────────────────────────────

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


# ── random crop & resize ──────────────────────────────────────────────────────

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


# ── rotation augmentation ─────────────────────────────────────────────────────

def random_rotate(image, coords, max_angle=45):
    H, W = image.shape
    angle = np.random.uniform(-max_angle, max_angle)
    cx_img, cy_img = W / 2.0, H / 2.0
    M = cv2.getRotationMatrix2D((cx_img, cy_img), angle, 1.0)
    rotated = cv2.warpAffine(image, M, (W, H), flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_REFLECT)
    new_coords = coords.copy()
    for i in range(2):
        px, py = coords[i * 2], coords[i * 2 + 1]
        nx = M[0, 0] * px + M[0, 1] * py + M[0, 2]
        ny = M[1, 0] * px + M[1, 1] * py + M[1, 2]
        new_coords[i * 2]     = np.clip(nx, 0, W - 1)
        new_coords[i * 2 + 1] = np.clip(ny, 0, H - 1)
    return rotated, new_coords


# ── per-patient normalization cache ───────────────────────────────────────────

class _PatientNormCache:
    """
    Lazily compute and cache per-patient (mean, std) so we normalize
    every slice by its volume statistics rather than per-slice statistics.
    """
    def __init__(self):
        self._cache = {}

    def get(self, img_path: str, img_array: np.ndarray):
        if img_path not in self._cache:
            mu  = img_array.mean()
            std = img_array.std() + 1e-8
            self._cache[img_path] = (mu, std)
        return self._cache[img_path]


_NORM_CACHE = _PatientNormCache()


# ── dataset ───────────────────────────────────────────────────────────────────

class LandmarkDataset(Dataset):
    def __init__(
        self,
        image_dir,
        mask_dir,
        slice_axis=2,
        augment=False,
        sigma=8,
        min_landmark_dist=30,
        min_slice_variance=0.01,
    ):
        self.image_dir          = image_dir
        self.mask_dir           = mask_dir
        self.slice_axes         = [slice_axis] if isinstance(slice_axis, int) else slice_axis
        self.augment            = augment
        self.sigma              = sigma
        self.min_landmark_dist  = min_landmark_dist
        self.min_slice_variance = min_slice_variance

        self.samples = self._build_samples()

        if len(self.samples) == 0:
            raise RuntimeError("No valid samples found.")

        axis_str = f"axis={self.slice_axes[0]}" if len(self.slice_axes) == 1 else f"axes={self.slice_axes}"
        print(f"OK Total valid samples: {len(self.samples)}  [{axis_str}]")

    def set_sigma(self, sigma):
        self.sigma = sigma

    def original_size(self, idx):
        _, _, _, H_orig, W_orig, _ = self.samples[idx]
        return H_orig, W_orig

    def coords_to_original(self, idx, coords_256):
        H_orig, W_orig = self.original_size(idx)
        coords = np.array(coords_256, dtype=np.float32)
        coords[0] *= W_orig / 256.0
        coords[1] *= H_orig / 256.0
        coords[2] *= W_orig / 256.0
        coords[3] *= H_orig / 256.0
        return coords

    def _build_samples(self):
        samples = []
        files   = sorted([f for f in os.listdir(self.image_dir) if f.endswith(".nii.gz")])

        for fname in files:
            img_path  = os.path.join(self.image_dir, fname)
            mask_path = os.path.join(self.mask_dir,  fname)

            if not os.path.exists(mask_path):
                continue

            img  = nib.load(img_path).get_fdata()
            mask = nib.load(mask_path).get_fdata()

            if img.shape != mask.shape:
                continue

            for axis in self.slice_axes:
                n_slices = img.shape[axis]

                for i in range(n_slices):
                    mask_2d = np.take(mask, i, axis=axis)
                    if np.sum(mask_2d > 0) < 2:
                        continue
                    coords = self._extract_points(mask_2d)
                    if coords is None:
                        continue

                    H_2d, W_2d = mask_2d.shape
                    dist = np.linalg.norm(
                        [coords[2] - coords[0], coords[3] - coords[1]]
                    ) * 256 / max(H_2d, W_2d)
                    if dist < self.min_landmark_dist:
                        continue

                    img_2d   = np.take(img, i, axis=axis)
                    mu_s     = img_2d.mean()
                    std_s    = img_2d.std() + 1e-8
                    img_norm = (img_2d - mu_s) / std_s
                    if img_norm.var() < self.min_slice_variance:
                        continue

                    samples.append((fname, i, coords, H_2d, W_2d, axis))

        return samples

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        fname, slice_idx, coords, H_orig, W_orig, axis = self.samples[idx]

        img_path = os.path.join(self.image_dir, fname)
        img      = nib.load(img_path).get_fdata().astype(np.float32)

        mu, std = _NORM_CACHE.get(img_path, img)

        image_2d      = np.take(img, slice_idx, axis=axis)
        image_resized = cv2.resize(image_2d, (256, 256))
        image_resized = (image_resized - mu) / std

        x1, y1, x2, y2 = coords
        x1 = x1 * 256 / W_orig;  x2 = x2 * 256 / W_orig
        y1 = y1 * 256 / H_orig;  y2 = y2 * 256 / H_orig
        coords_scaled = np.array([x1, y1, x2, y2], dtype=np.float32)

        if self.augment:
            if np.random.rand() < 0.5:
                image_resized    = np.fliplr(image_resized).copy()
                coords_scaled[0] = 255 - coords_scaled[0]
                coords_scaled[2] = 255 - coords_scaled[2]
            if np.random.rand() < 0.5:
                image_resized    = np.flipud(image_resized).copy()
                coords_scaled[1] = 255 - coords_scaled[1]
                coords_scaled[3] = 255 - coords_scaled[3]
            if np.random.rand() < 0.7:
                image_resized, coords_scaled = random_rotate(
                    image_resized, coords_scaled, max_angle=45
                )
            if np.random.rand() < 0.5:
                image_resized = image_resized * np.random.uniform(0.8, 1.2) \
                              + np.random.uniform(-0.1, 0.1)
            if np.random.rand() < 0.3:
                image_resized = image_resized \
                              + np.random.randn(*image_resized.shape).astype(np.float32) * 0.05
            if np.random.rand() < 0.4:
                image_resized, coords_scaled = elastic_deform(
                    image_resized, coords_scaled, alpha=15, sigma=4
                )
            if np.random.rand() < 0.4:
                image_resized, coords_scaled = random_crop_resize(
                    image_resized, coords_scaled, crop_ratio=np.random.uniform(0.80, 0.95)
                )

        coords_scaled = np.clip(coords_scaled, 0, 255)
        image_resized = np.expand_dims(image_resized, axis=0)

        heatmaps = coords_to_heatmaps(coords_scaled, (256, 256), sigma=self.sigma)

        return (
            torch.tensor(image_resized, dtype=torch.float32),
            torch.tensor(heatmaps,      dtype=torch.float32),
            torch.tensor(coords_scaled, dtype=torch.float32),
        )

    def _extract_points(self, mask):
        pts = np.argwhere(mask > 0)
        if len(pts) < 2:
            return None
        dists = np.linalg.norm(pts[:, None] - pts[None, :], axis=-1)
        i, j  = np.unravel_index(np.argmax(dists), dists.shape)
        p1, p2 = pts[i], pts[j]

        if p1[0] > p2[0]:   # p1[0] is row index (y); smaller = more superior
            p1, p2 = p2, p1

        return np.array([p1[1], p1[0], p2[1], p2[0]], dtype=np.float32)
