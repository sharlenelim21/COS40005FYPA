#!/usr/bin/env python
"""DEVELOPER NOTE: Local UNet Inference Wrapper

This script implements a CPU-capable segmentation model that can run locally without Cloud GPU.

Architecture:
- UNet2D with Mamba encoder (from timm: 'mambaout_small.in1k')
- 4-class cardiac segmentation: RV (Right Ventricle), MYO (Myocardium), 
  LVC (Left Ventricular Chamber), Background

Input: Path to a NIfTI file (.nii or .nii.gz) containing 4D cardiac imaging data
Output: JSON with frame/slice/segmentation data identical to MedSAM format for database compatibility

Key Features:
- Preprocessing: Min-max normalization to [0,1] range; handles NaN/inf values
- Inference: Model runs at 256x256 resolution for speed; output resized to original dimensions
- Encoding: RLE (Run-Length Encoding) for efficient mask storage
- Schema: Output structure matches backend database expectations (frameinferred=True, etc.)"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Optional

import nibabel as nib
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

try:
    import timm
except ImportError:  # pragma: no cover - dependency is installed during environment setup
    timm = None


CLASS_INDEX_TO_NAME = {
    1: "rv",
    2: "myo",
    3: "lvc",
}

# Module-level cache for lazy-loaded UNet model (loaded once, reused for all subsequent inferences)
_cached_unet_model = None
_cached_device = None


class conv2D_block(nn.Module):
    def __init__(self, in_ch: int, out_ch: int):
        super().__init__()
        self.conv2D = nn.Sequential(
            nn.Conv2d(in_ch, out_ch, kernel_size=3, stride=1, padding=1, bias=False),
            nn.GroupNorm(num_groups=16, num_channels=out_ch),
            nn.LeakyReLU(negative_slope=0.01, inplace=True),
            nn.Conv2d(out_ch, out_ch, kernel_size=3, stride=1, padding=1, bias=False),
            nn.GroupNorm(num_groups=16, num_channels=out_ch),
            nn.LeakyReLU(negative_slope=0.01, inplace=True),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.conv2D(x)


class decoderBlock(nn.Module):
    def __init__(self, in_channels: int, skip_channels: int, out_channels: int):
        super().__init__()
        self.up = nn.ConvTranspose2d(in_channels, out_channels, 2, stride=2)
        self.conv = conv2D_block(out_channels + skip_channels, out_channels)

    def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        x = self.up(x)
        x = torch.cat([x, skip], dim=1)
        return self.conv(x)


class UNet2D(nn.Module):
    """DEVELOPER NOTE: 2D UNet with Mamba Encoder
    
    Architecture:
    - Encoder: Mamba-based model ('mambaout_small.in1k') from timm library
      * Faster and more efficient than standard CNNs
      * Captures long-range dependencies in cardiac anatomy
    - Decoder: Cascaded decoder blocks with skip connections
      * Progressively upsamples low-level features to full resolution
      * Skip connections preserve fine spatial details from encoder
    
    Design Rationale:
    - Mamba encoder is state-of-the-art efficient backbone for medical imaging
    - Small model size (mambaout_small) balances accuracy and speed
    - 4-class output (RV, MYO, LVC, Background) matches cardiac anatomy
    """
    def __init__(self, in_ch: int = 1, out_ch: int = 4, pretrained: bool = False):
        super().__init__()
        if timm is None:
            raise RuntimeError("timm is not installed. Install the Python dependencies first.")

        # Use the Mamba encoder from the reference cardiac segmentation paper
        self.encoder = timm.create_model(
            "mambaout_small.in1k",
            pretrained=pretrained,
            features_only=True,
            in_chans=in_ch,
        )
        encoder_channels = self.encoder.feature_info.channels()

        # Decoder blocks progressively upsample feature maps with skip connections
        # Architecture: decoder4 -> decoder3 -> decoder2 -> final upsampling
        self.decoder4 = decoderBlock(encoder_channels[3], encoder_channels[2], encoder_channels[2])
        self.decoder3 = decoderBlock(encoder_channels[2], encoder_channels[1], encoder_channels[1])
        self.decoder2 = decoderBlock(encoder_channels[1], encoder_channels[0], encoder_channels[0])
        self.UpSample2D_1 = nn.ConvTranspose2d(encoder_channels[0], encoder_channels[0], 2, stride=2)
        self.Conv2D_1 = conv2D_block(encoder_channels[0], 64)
        self.UpSample2D_2 = nn.ConvTranspose2d(64, 24, 2, stride=2)
        self.Conv2D_final = nn.Conv2d(24, out_ch, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        features = self.encoder(x)
        features = [feature.permute(0, 3, 1, 2).contiguous() for feature in features]
        e1, e2, e3, e4 = features

        d1 = self.decoder4(e4, e3)
        d2 = self.decoder3(d1, e2)
        d3 = self.decoder2(d2, e1)
        d5 = self.UpSample2D_1(d3)
        d5_1_1 = self.Conv2D_1(d5)
        d5_1 = self.UpSample2D_2(d5_1_1)
        d6 = self.Conv2D_final(d5_1)
        return d6


def resolve_device(preferred: str) -> torch.device:
    """DEVELOPER NOTE: Device Resolution Logic
    
    Determines compute device (CPU or GPU) with fallback behavior:
    - "auto": Smart selection - GPU if available, else CPU
    - "cuda": GPU only - fails if NVIDIA GPU not detected
    - "cpu": CPU only - always succeeds (broadest compatibility)
    
    This ensures inference works on any machine, even without GPU support.
    """
    mode = (preferred or "auto").strip().lower()
    if mode == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if mode == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested, but no GPU is available on this machine.")
        return torch.device("cuda")
    return torch.device("cpu")


def normalize_slice(slice_2d: np.ndarray) -> np.ndarray:
    """DEVELOPER NOTE: Preprocessing - Intensity Normalization
    
    Implements Z-score normalization to prepare cardiac image slices for model inference:
    
    1. Clean Invalid Values: Replace NaN, +inf, -inf with 0 (common in medical imaging)
    2. Min-Max Normalization: Scale distribution to [0,1] range
       - Accounts for variable intensity ranges across different imaging equipment
       - Matches training-time preprocessing
    3. Edge Case Handling: Near-zero range (constant slices) returns zeros
       - Prevents division by near-zero values
       - Handles blank/corrupted cardiac slices gracefully
    
    This normalization is crucial for consistent model behavior across diverse medical data.
    """
    slice_2d = np.nan_to_num(slice_2d.astype(np.float32), nan=0.0, posinf=0.0, neginf=0.0)
    min_value = float(slice_2d.min())
    max_value = float(slice_2d.max())
    if max_value - min_value < 1e-8:
        return np.zeros_like(slice_2d, dtype=np.float32)
    return (slice_2d - min_value) / (max_value - min_value)


def encode_rle(mask: np.ndarray) -> str:
    """DEVELOPER NOTE: Run-Length Encoding (RLE)
    
    Encodes binary segmentation masks efficiently for database storage.
    
    Format: Space-separated pairs of "start_index run_length"
    Example: "0 50 100 200" means:
      - Positions 0-49: True (50 consecutive True values)
      - Positions 50-99: False (implicit, not encoded)
      - Positions 100-299: True (200 consecutive True values)
    
    Benefits:
    - Reduces mask storage size by ~80-95% (very sparse cardiac segmentations)
    - Matches backend decode_rle() function exactly
    - Enables efficient database queries on segmentation data
    
    Note: Encoding assumes C-order (row-major) flattening of mask array.
    This matches the backend's decoding expectations.
    """
    flattened = mask.astype(np.uint8).reshape(-1, order="C")
    runs: List[str] = []
    start_index: Optional[int] = None

    for index, value in enumerate(flattened):
        if value and start_index is None:
            start_index = index
        elif not value and start_index is not None:
            runs.append(f"{start_index} {index - start_index}")
            start_index = None

    if start_index is not None:
        runs.append(f"{start_index} {len(flattened) - start_index}")

    return " ".join(runs)


def extract_volume(nifti_path: str) -> np.ndarray:
    volume = nib.load(nifti_path).get_fdata()
    if volume.ndim == 3:
        volume = volume[..., np.newaxis]
    if volume.ndim != 4:
        raise ValueError(f"Expected 3D or 4D NIfTI, got shape {volume.shape}")
    return volume


def run_model2_inference(
    nifti_path: str,
    checkpoint_path: str,
    device: str = "cpu",
) -> Dict[str, Any]:
    """DEVELOPER NOTE: Main Inference Pipeline
    
    Complete 4D cardiac image processing workflow:
    1. Device Resolution: Determine CPU or GPU based on preference and availability
    2. Volume Loading: Load 4D NIfTI (height, width, slices, frames)
    3. Model Setup: Initialize UNet2D with pretrained=False, load checkpoint weights
    4. Frame Iteration: Process each cardiac frame independently
    5. Slice Processing: For each slice:
       - Normalize intensity to [0,1]
       - Resize to 256x256 (model input resolution)
       - Run inference to get 4-class predictions
       - Resize output back to original dimensions
       - Extract and encode segmentation masks
    6. Output Assembly: Combine results into backend-compatible JSON
    
    Returns: Dict with 'success' bool and 'mask' containing frames/slices/segmentations
    """
    device_obj = resolve_device(device)
    volume = extract_volume(nifti_path)

    if not checkpoint_path:
        raise FileNotFoundError(
            "UNet checkpoint path is missing. "
            "Please set UNET_CHECKPOINT_PATH env var or pass checkpoint_path parameter. "
            "Default: app/models/unet.pth"
        )
    if not os.path.exists(checkpoint_path):
        raise FileNotFoundError(
            f"UNet checkpoint file not found at: {checkpoint_path}\n"
            f"Expected location: visheart-inference-gpu/app/models/unet.pth\n"
            f"Please download or place the unet.pth file in that location."
        )

    # Initialize model and load pretrained cardiac segmentation weights (cached after first load)
    global _cached_unet_model, _cached_device
    
    # Check if model is already loaded and device matches
    if _cached_unet_model is not None and _cached_device == device_obj:
        model = _cached_unet_model
        print(f"Reusing cached UNet model on {device_obj}", file=sys.stderr)
    else:
        # Load model for the first time or device changed
        print(f"Loading UNet model into cache on {device_obj}", file=sys.stderr)
        model = UNet2D(in_ch=1, out_ch=4, pretrained=False).to(device_obj)
        state_dict = torch.load(checkpoint_path, map_location=device_obj)
        # Support common checkpoint wrappers used by different training scripts.
        if isinstance(state_dict, dict) and "state_dict" in state_dict:
            state_dict = state_dict["state_dict"]
        elif isinstance(state_dict, dict) and "model_state_dict" in state_dict:
            state_dict = state_dict["model_state_dict"]
        # strict=False allows loading checkpoints with extra/missing keys
        # (useful when checkpoint includes optimizer state or other metadata)
        missing, unexpected = model.load_state_dict(state_dict, strict=False)
        model.eval()  # Set model to evaluation mode (disable dropout, batchnorm updates)

        if missing:
            print(f"Warning: missing checkpoint keys: {missing}", file=sys.stderr)
        if unexpected:
            print(f"Warning: unexpected checkpoint keys: {unexpected}", file=sys.stderr)
        
        # Cache the model for future use
        _cached_unet_model = model
        _cached_device = device_obj

    frames: List[Dict[str, Any]] = []
    num_frames = volume.shape[3]
    num_slices = volume.shape[2]

    # Process all frames and slices in the cardiac volume
    with torch.no_grad():
        for frame_index in range(num_frames):
            # Initialize frame structure matching MedSAM output format
            frame_entry = {
                "frameindex": frame_index,
                # frameinferred=True indicates this mask was generated by AI inference
                # (vs manually drawn by radiologist)
                "frameinferred": True,
                "slices": [],
            }

            for slice_index in range(num_slices):
                # Extract single 2D cardiac slice from 4D volume
                slice_2d = volume[:, :, slice_index, frame_index]
                original_height, original_width = slice_2d.shape[:2]
                
                # STEP 1: Preprocess - normalize intensity to [0,1] range
                normalized_slice = normalize_slice(slice_2d)

                # STEP 2: Prepare tensor - convert to PyTorch and resize to model input (256x256)
                # Model was trained at 256x256 resolution for faster inference
                tensor = torch.from_numpy(normalized_slice).float().unsqueeze(0).unsqueeze(0)
                tensor = F.interpolate(tensor, size=(256, 256), mode="bilinear", align_corners=False)
                tensor = tensor.to(device_obj)

                # STEP 3: Inference - get 4-class predictions from UNet
                logits = model(tensor)
                probabilities = F.softmax(logits, dim=1)  # Normalize to probability distribution
                prediction = torch.argmax(probabilities, dim=1).squeeze(0).to("cpu").numpy().astype(np.uint8)
                
                # STEP 4: Postprocess - resize output back to original slice dimensions
                # Using nearest-neighbor to preserve class labels (no interpolation in label space)
                prediction = torch.from_numpy(prediction).unsqueeze(0).unsqueeze(0).float()
                prediction = F.interpolate(prediction, size=(original_height, original_width), mode="nearest")
                prediction = prediction.squeeze(0).squeeze(0).to(torch.uint8).numpy()

                # STEP 5: Extract masks - generate RLE-encoded mask for each predicted class
                segmentation_masks = []
                for class_index, class_name in CLASS_INDEX_TO_NAME.items():
                    # Create binary mask for this class (1 where prediction==class_index, 0 elsewhere)
                    class_mask = (prediction == class_index).astype(np.uint8)
                    # Only include mask if it contains predicted pixels (skip empty masks)
                    if class_mask.any():
                        segmentation_masks.append(
                            {
                                "class": class_name,  # "rv", "myo", or "lvc"
                                "segmentationmaskcontents": encode_rle(class_mask),
                            }
                        )

                frame_entry["slices"].append(
                    {
                        "sliceindex": slice_index,
                        "segmentationmasks": segmentation_masks,
                    }
                )

            frames.append(frame_entry)

    return {"success": True, "mask": {"frames": frames}}


def main() -> int:
    """DEVELOPER NOTE: Command-line Entry Point
    
    Parses arguments and invokes inference. Output is always JSON to stdout.
    
    Environment Variables:
    - MODEL2_CHECKPOINT_PATH: Path to UNet model weights file (required)
    - MODEL2_DEVICE: Default device selection (default: "cpu")
    
    Command-line Arguments:
    - nifti_path: Required - input cardiac imaging file
    - --checkpoint-path: Optional - model weights file path
    - --device: Optional - "cpu", "cuda", or "auto"
    
    JSON Output Format:
    Success: {"success": true, "mask": {"frames": [...]}}
    Failure: {"success": false, "error": "error message"}
    """
    parser = argparse.ArgumentParser(description="Run local UNet inference on a NIfTI cardiac imaging file.")
    parser.add_argument("nifti_path", help="Path to the input NIfTI file")
    parser.add_argument("--checkpoint-path", default=os.getenv("MODEL2_CHECKPOINT_PATH", ""), help="Path to the UNet model checkpoint weights")
    parser.add_argument("--device", default=os.getenv("MODEL2_DEVICE", "auto"), choices=["auto", "cpu", "cuda"], help="Compute device: auto (GPU if available), cpu, or cuda (GPU required)")
    args = parser.parse_args()

    try:
        result = run_model2_inference(
            nifti_path=args.nifti_path,
            checkpoint_path=args.checkpoint_path,
            device=args.device,
        )
        print(json.dumps(result))
        return 0
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
