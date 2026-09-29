"""Shared helpers for the retraining tools. Imports the training copy's code; never modifies it."""
import hashlib
import os
import sys
from pathlib import Path

WINDOWS_UNET_ROOT = r"E:\Jy\Unet"
# The inference service's models folder in this repository: the original unet.pth and the active slot.
REPO_MODELS = Path(__file__).resolve().parent.parent / "visheart-inference-gpu" / "app" / "models"


def default_unet_root(env=None, os_name=None, home=None):
    """Where the retraining data lives: VISHEART_UNET_ROOT, else E:\\Jy\\Unet on Windows and ~/visheart-unet elsewhere."""
    env = os.environ if env is None else env
    if env.get("VISHEART_UNET_ROOT"):
        return Path(env["VISHEART_UNET_ROOT"])
    if (os_name or os.name) == "nt":
        return Path(WINDOWS_UNET_ROOT)
    return Path(home or Path.home()) / "visheart-unet"


def default_v2_root(root, env=None):
    """The v2-unet training copy: VISHEART_V2_ROOT, else inside the data root."""
    env = os.environ if env is None else env
    if env.get("VISHEART_V2_ROOT"):
        return Path(env["VISHEART_V2_ROOT"])
    return Path(root) / "2023_FRGS_HeartDigitalTwin" / "segmentation" / "v2-unet"


def default_frozen_index(root, env=None):
    """The frozen-set index: VISHEART_FROZEN_SLICES, else in the data root's versions folder."""
    env = os.environ if env is None else env
    if env.get("VISHEART_FROZEN_SLICES"):
        return Path(env["VISHEART_FROZEN_SLICES"])
    return Path(root) / "versions" / "frozen_slices.npz"


UNET_ROOT = default_unet_root()
DEFAULT_V2_ROOT = default_v2_root(UNET_ROOT)


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
