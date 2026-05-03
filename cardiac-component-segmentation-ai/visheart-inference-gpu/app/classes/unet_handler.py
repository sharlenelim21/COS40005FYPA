"""
UNet Handler for lazy-loaded model management.

Follows the same caching pattern as MedSamHandler and YoloHandler.
Loads the UNet2D model from checkpoint on first use and caches it for reuse.
"""

import logging
import os
import sys
import torch
from typing import Dict, Any, Optional

# Add parent directory to Python path for imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import device resolution utilities
from app.utils.device_runtime import resolve_device


logger = logging.getLogger("visheart")


class UNetHandler:
    """
    Lazy-loading handler for UNet2D cardiac segmentation model.
    
    Loads the model once on first inference and caches it for all subsequent uses.
    Provides device flexibility (CPU/GPU) and robust error handling.
    """
    
    def __init__(self, model_path: str, device_pref: str = "auto"):
        """
        Initialize UNet handler.
        
        Args:
            model_path (str): Absolute path to UNet checkpoint (.pth file)
            device_pref (str): Device preference ('auto', 'cpu', or 'cuda')
        
        Raises:
            FileNotFoundError: If checkpoint file doesn't exist
            RuntimeError: If model load fails
        """
        if not os.path.isfile(model_path):
            raise FileNotFoundError(
                f"UNet checkpoint not found at: {model_path}\n"
                f"Expected location: visheart-inference-gpu/app/models/unet.pth\n"
                f"Please download or place the unet.pth file in the models directory."
            )
        
        self.model_path = model_path
        self.device = resolve_device(device_pref)
        self.model = None
        self.is_loaded = False
        
        logger.info(f"🔄 UNet handler initialized (device: {self.device}, path: {model_path})")
    
    def _load_model(self) -> None:
        """
        Load UNet2D model from checkpoint. Called once on first inference.
        
        Raises:
            RuntimeError: If model loading or state dict loading fails
        """
        if self.is_loaded and self.model is not None:
            return  # Already loaded
        
        logger.info(f"Loading UNet model from {os.path.basename(self.model_path)} on device {self.device}")
        
        try:
            # Import UNet2D class from the monorepo Python inference script
            from app.dependencies.unet_model_definition import UNet2D
            
            # Create model instance
            self.model = UNet2D(in_ch=1, out_ch=4, pretrained=False).to(self.device)
            self.model.eval()  # Set to evaluation mode
            
            # Load checkpoint weights
            state_dict = torch.load(self.model_path, map_location=self.device)
            
            # Handle different checkpoint formats
            if isinstance(state_dict, dict) and "state_dict" in state_dict:
                state_dict = state_dict["state_dict"]
            elif isinstance(state_dict, dict) and "model_state_dict" in state_dict:
                state_dict = state_dict["model_state_dict"]
            
            # Load with strict=False to allow flexibility in checkpoint format
            missing, unexpected = self.model.load_state_dict(state_dict, strict=False)
            
            if missing:
                logger.warning(f"UNet: missing checkpoint keys: {missing}")
            if unexpected:
                logger.warning(f"UNet: unexpected checkpoint keys: {unexpected}")
            
            self.is_loaded = True
            logger.info("✅ UNet model loaded successfully")
            
        except Exception as e:
            logger.error(f"❌ Failed to load UNet model: {e}")
            raise RuntimeError(f"UNet model loading failed: {e}")
    
    def infer(self, nifti_path: str) -> Dict[str, Any]:
        """
        Run inference on a NIfTI image using the cached UNet model.
        Also performs necessary preprocessing and returns structured output.
        
        This is a lazy wrapper that delegates to the main inference logic.
        Model is loaded on first call and cached for subsequent calls.
        
        Args:
            nifti_path (str): Path to input NIfTI file
        
        Returns:
            Dict with 'success' bool and 'mask' or 'error' field
        """
        # Lazy-load model on first inference
        if not self.is_loaded:
            self._load_model()
        
        # Delegate actual inference to the main inference function
        # This keeps the complex inference logic in one place (unet_inference.py)
        # while the handler just manages model lifecycle
        from app.helpers.unet_inference_api import run_unet_inference_with_model
        
        return run_unet_inference_with_model(nifti_path, self.model, self.device)
