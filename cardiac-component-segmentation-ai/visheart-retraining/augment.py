"""Training transforms with the BUG-008 correction: no 90-degree rotations and no flips.

BUG-008: RandRotate90d and RandFlipd taught the model that every rotation and mirror image of a short-axis
heart is valid anatomy, erasing the orientation prior that RV localisation depends on. This keeps the
intensity augmentation of V2/utils/preprocess.py:build_train_transforms and replaces the geometric part with
small rotations and mild zoom. The slices are 2D, so the in-plane angle is range_x; range_z would be a
silent no-op (measured in the BUG-008 note).
"""
from monai.transforms import (
    Compose,
    RandAdjustContrastd,
    RandGaussianNoised,
    RandRotated,
    RandShiftIntensityd,
    RandZoomd,
    Resized,
    ScaleIntensityd,
    ToTensord,
)

MAX_ROTATION_RADIANS = 0.26  # about 15 degrees: patient positioning, not an upside-down heart


def build_corrected_train_transforms(spatial_size=(256, 256)):
    return Compose(
        [
            ScaleIntensityd(keys=["image"]),
            Resized(keys=["image"], spatial_size=spatial_size, mode="area"),
            Resized(keys=["mask"], spatial_size=spatial_size, mode="nearest"),
            RandRotated(keys=["image", "mask"], range_x=MAX_ROTATION_RADIANS, prob=0.5,
                        mode=["bilinear", "nearest"], padding_mode="zeros"),
            RandZoomd(keys=["image", "mask"], min_zoom=0.9, max_zoom=1.1, prob=0.3, mode=["area", "nearest"]),
            RandShiftIntensityd(keys=["image"], offsets=0.1, prob=0.5),
            RandAdjustContrastd(keys=["image"], gamma=(0.9, 1.1), prob=0.5),
            RandGaussianNoised(keys=["image"], mean=0.0, std=0.01, prob=0.3),
            ToTensord(keys=["image", "mask"]),
        ]
    )
