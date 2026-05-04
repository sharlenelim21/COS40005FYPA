import importlib.util
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

import nibabel as nib
import numpy as np
import torch


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _resolve_unetresnet34_dir() -> Path:
    configured = os.getenv("LANDMARK_REPO_PATH")
    if configured:
        return Path(configured).resolve()
    return _repo_root() / "UNETRESNET34"


def _resolve_checkpoint(checkpoint_path: str | None) -> Path:
    candidates = [
        checkpoint_path,
        os.getenv("LANDMARK_CHECKPOINT_PATH"),
        str(_resolve_unetresnet34_dir() / "checkpoints" / "best_model.pth"),
        str(
            _resolve_unetresnet34_dir()
            / "checkpoints"
            / "2026-04-30_11-06-15"
            / "best_model.pth"
        ),
        str(
            Path(__file__).resolve().parents[1]
            / "models"
            / "landmark"
            / "best_model.pth"
        ),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return Path(candidate).resolve()
    nested_matches = sorted(
        (_resolve_unetresnet34_dir() / "checkpoints").glob("**/best_model.pth"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if nested_matches:
        return nested_matches[0].resolve()
    raise FileNotFoundError(
        "Could not find landmark checkpoint. Set LANDMARK_CHECKPOINT_PATH or place "
        "best_model.pth in UNETRESNET34/checkpoints/."
    )


def _load_landmark_module():
    repo_dir = _resolve_unetresnet34_dir()
    inference_path = repo_dir / "inference.py"
    if not inference_path.exists():
        raise FileNotFoundError(f"UNETRESNET34 inference.py not found at {inference_path}")

    repo_str = str(repo_dir)
    if repo_str not in sys.path:
        sys.path.insert(0, repo_str)

    spec = importlib.util.spec_from_file_location(
        "visheart_unetresnet34_landmark", inference_path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load landmark inference module from {inference_path}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _normalise_device(device: str | None) -> torch.device:
    if device == "cuda":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device == "cpu":
        return torch.device("cpu")
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def _use_tta(torch_device: torch.device) -> bool:
    configured = os.getenv("LANDMARK_USE_TTA", "").strip().lower()
    if configured in ("1", "true", "yes", "on"):
        return True
    if configured in ("0", "false", "no", "off"):
        return False
    return torch_device.type == "cuda"


def run_landmark_inference_from_nifti(
    nifti_path: str,
    device: str = "auto",
    checkpoint_path: str | None = None,
) -> Dict[str, Any]:
    module = _load_landmark_module()
    checkpoint = _resolve_checkpoint(checkpoint_path)
    torch_device = _normalise_device(device)
    use_tta = _use_tta(torch_device)
    model = module.load_model(str(checkpoint), torch_device)

    nii = nib.load(nifti_path)
    data = nii.get_fdata().astype(np.float32)

    frame_slices: List[tuple[int, int, np.ndarray]] = []
    if data.ndim == 4:
        input_frames = data.shape[3]
        input_slices = data.shape[2]
        for frame_id in range(input_frames):
            for slice_id in range(input_slices):
                frame_slices.append((frame_id, slice_id, data[:, :, slice_id, frame_id]))
    elif data.ndim == 3:
        input_frames = 1
        input_slices = data.shape[2]
        for slice_id in range(input_slices):
            frame_slices.append((0, slice_id, data[:, :, slice_id]))
    else:
        raise ValueError(f"Unsupported NIfTI shape for landmark detection: {data.shape}")

    if not frame_slices:
        raise ValueError(f"No frames/slices found for landmark detection: {data.shape}")

    predictions: List[Dict[str, Any]] = []
    height, width = frame_slices[0][2].shape
    for frame_id, slice_id, image_2d in frame_slices:
        coords, _ = module.predict_landmarks(
            image_2d,
            model=model,
            device=torch_device,
            use_tta=use_tta,
        )
        predictions.append(
            {
                "frame_id": frame_id,
                "slice_id": slice_id,
                "rv_insertion_1": [float(coords[0]), float(coords[1])],
                "rv_insertion_2": [float(coords[2]), float(coords[3])],
            }
        )

    return {
        "success": True,
        "landmarks": {
            "predictions": predictions,
            "total_frames": len(predictions),
            "input_frames": int(input_frames),
            "total_slices": int(input_slices),
            "selected_slice": None,
            "model_used": "UNetResNet34 Landmark",
            "image_dimensions": {
                "width": int(width),
                "height": int(height),
            },
        },
    }
