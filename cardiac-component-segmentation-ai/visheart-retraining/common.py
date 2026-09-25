"""Shared helpers for the retraining tools. Imports the training copy's code; never modifies it."""
import hashlib
import os
import sys
from pathlib import Path

DEFAULT_V2_ROOT = Path(os.environ.get(
    "VISHEART_V2_ROOT", r"E:\Jy\Unet\2023_FRGS_HeartDigitalTwin\segmentation\v2-unet"))


def import_v2(v2_root=DEFAULT_V2_ROOT):
    """Return (UNet2D, preprocess module) from the training copy (plan F5)."""
    root = str(Path(v2_root).resolve())
    if root not in sys.path:
        sys.path.insert(0, root)
    from models.unet2d import UNet2D
    from utils import preprocess
    return UNet2D, preprocess


def sha256_file(path, chunk=1 << 20):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(chunk), b""):
            digest.update(block)
    return digest.hexdigest()


def load_state_dict(path):
    """Plain state_dict (unet.pth, train_runner.py:264) or wrapped (last_checkpoint.pth, :120-127)."""
    import torch
    obj = torch.load(path, map_location="cpu", weights_only=True)  # never unpickle arbitrary objects
    if isinstance(obj, dict) and "model_state_dict" in obj:
        return obj["model_state_dict"]
    return obj


def build_model(v2_root=DEFAULT_V2_ROOT, checkpoint=None):
    """UNet2D without network access; strict load so a key mismatch fails instead of hiding."""
    UNet2D, _ = import_v2(v2_root)
    model = UNet2D(in_channels=1, num_classes=4, pretrained_encoder=False)
    if checkpoint:
        model.load_state_dict(load_state_dict(checkpoint), strict=True)
    return model
