"""
generate_test_nifti.py
======================
Builds the same synthetic 128x128x10 mask used in test_bullseye_analysis.py
and saves it as test_bullseye.nii.gz in the GPU service working directory.

Run from the visheart-inference-gpu/ directory:
    python tools/generate_test_nifti.py

Expected output:
    Saved test_bullseye.nii.gz  shape=(128, 128, 10)  classes=[0 2 3]
"""

from __future__ import annotations
import os
import sys
import numpy as np
import nibabel as nib

# Resolve the GPU service working directory (parent of tools/)
_HERE     = os.path.dirname(os.path.abspath(__file__))
_SVC_ROOT = os.path.dirname(_HERE)


def make_synthetic_mask(
    H: int = 128,
    W: int = 128,
    N: int = 10,
    cx: float = 64.0,
    cy: float = 64.0,
    inner_r: float = 15.0,
    outer_r: float = 25.0,
    thin_outer_r: float = 18.0,
    thin_angle_start: float = 45.0,
    thin_angle_end: float = 135.0,
    thin_slices: tuple[int, ...] = (6, 7, 8),
) -> np.ndarray:
    """
    Identical to the function in UNETRESNET34/test_bullseye_analysis.py.
    Produces a (H, W, N) uint8 mask:
        class 0 — background
        class 2 — myocardium (ring inner_r ≤ r ≤ outer_r)
        class 3 — LV cavity  (r < inner_r)
    In thin_slices the angular sector [thin_angle_start, thin_angle_end)
    has its outer myocardium carved away to simulate wall thinning.
    """
    yy, xx = np.mgrid[0:H, 0:W]
    dist      = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    angle_map = np.degrees(np.arctan2(yy - cy, xx - cx)) % 360.0

    mask_3d = np.zeros((H, W, N), dtype=np.uint8)
    for s in range(N):
        m = np.zeros((H, W), dtype=np.uint8)
        m[dist < inner_r]                        = 3
        m[(dist >= inner_r) & (dist <= outer_r)] = 2
        if s in thin_slices:
            in_sector = (angle_map >= thin_angle_start) & (angle_map < thin_angle_end)
            in_outer  = (dist > thin_outer_r) & (dist <= outer_r)
            m[in_sector & in_outer] = 0
        mask_3d[:, :, s] = m

    return mask_3d


def main() -> None:
    out_path = os.path.join(_SVC_ROOT, "test_bullseye.nii.gz")

    mask = make_synthetic_mask()
    img  = nib.Nifti1Image(mask, affine=np.eye(4))
    nib.save(img, out_path)

    classes = np.unique(mask)
    print(f"Saved {out_path}  shape={mask.shape}  classes={classes}")


if __name__ == "__main__":
    main()
