import torch
import torch.nn.functional as F
import numpy as np
import cv2
import os
import gc
import time
import asyncio # Import asyncio
import threading # Optional: For logging thread ID
import warnings
import logging
from segment_anything import sam_model_registry
from typing import Dict, List, Tuple, Any, Optional
from skimage import io # skimage.io is synchronous

class MedSamHandler:
    def __init__(self, model_path):
        """
        Initialize the MedSAM handler with model path

        Args:
            model_path (str): Path to MedSAM model weights (.pth)
        """
        self.model_path = model_path
        self.model = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self._load_model() # Sync load during init is fine
        self.inference_count = 0
        self.cleanup_frequency = 5

    def _load_model(self):
        """Load the MedSAM model from the specified path"""
        logger = logging.getLogger("visheart")
        logger.info(f"Loading MedSAM from {self.model_path.split('/')[-1]} on device {self.device}")
        
        try:
            self._clear_gpu_memory()
            
            # Temporarily suppress specific warnings during model loading
            with warnings.catch_warnings():
                warnings.filterwarnings("ignore", category=FutureWarning, message=".*torch.load.*weights_only.*")
                self.model = sam_model_registry["vit_b"](checkpoint=self.model_path)
            
            self.model = self.model.to(self.device)
            self.model.eval()
        except Exception as e:
            logger.error(f"Error loading MedSAM model: {e}")
            raise e

    def _clear_gpu_memory(self):
        """Clear GPU memory to prevent fragmentation"""
        if torch.cuda.is_available():
            with torch.cuda.device(self.device):
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
                gc.collect()

    # Preprocessing might be fast enough, but can be offloaded if needed
    def _preprocess_image_sync(self, img_np):
        """Synchronous preprocessing logic."""
        if img_np is None: 
            raise ValueError("Input image is None")
            
        # Convert grayscale to RGB if needed
        if len(img_np.shape) == 2: 
            img_3c = np.repeat(img_np[:, :, None], 3, axis=-1)
        elif img_np.shape[2] == 4:  # Handle RGBA
            img_3c = cv2.cvtColor(img_np, cv2.COLOR_RGBA2RGB)
        else: 
            img_3c = img_np
            
        H, W, _ = img_3c.shape
        
        # Resize to 1024x1024 using cv2
        img_1024 = cv2.resize(img_3c, (1024, 1024), interpolation=cv2.INTER_LINEAR)
        
        # Normalize pixel values to [0, 1] range
        img_1024_normalized = img_1024.astype(np.float32) / 255.0
        
        # Convert to PyTorch tensor format (B, C, H, W)
        img_1024_tensor = (
            torch.tensor(img_1024_normalized)
            .float()
            .permute(2, 0, 1)
            .unsqueeze(0)
            .to(self.device) # Move to device here
        )
        return img_1024_tensor, img_3c, H, W

    # segment_with_box remains synchronous, called by the blocking helper
    @torch.no_grad()
    def _segment_with_box(self, img_embed, box_1024, H, W):
        """
        Generate a segmentation mask using MedSAM from an image embedding and a bounding box
        """
        try:
            box_torch = torch.as_tensor(box_1024, dtype=torch.float, device=self.device)
            if len(box_torch.shape) == 2:  # If shape is (1, 4)
                box_torch = box_torch[:, None, :]  # Add prompt dimension -> (1, 1, 4)

            # Encode the prompt
            sparse_embeddings, dense_embeddings = self.model.prompt_encoder(
                points=None,
                boxes=box_torch,
                masks=None,
            )

            # Decode the mask
            low_res_logits, _ = self.model.mask_decoder(
                image_embeddings=img_embed,
                image_pe=self.model.prompt_encoder.get_dense_pe(),
                sparse_prompt_embeddings=sparse_embeddings,
                dense_prompt_embeddings=dense_embeddings,
                multimask_output=False,
            )

            # Upsample mask
            low_res_pred = torch.sigmoid(low_res_logits)
            low_res_pred = F.interpolate(
                low_res_pred,
                size=(H, W),
                mode="bilinear",
                align_corners=False,
            )

            # Convert to numpy array and threshold
            medsam_seg = low_res_pred.squeeze().cpu().numpy()
            medsam_seg = (medsam_seg > 0.5).astype(np.uint8)
            
            # Clean up tensors explicitly
            del box_torch, sparse_embeddings, dense_embeddings, low_res_logits, low_res_pred
            
            return medsam_seg
            
        except Exception as e:
            print(f"Error in _segment_with_box: {e}")
            raise e

    # Synchronous helper for blocking inference part
    @torch.no_grad()
    def _run_blocking_inference(self, img_tensor_device, bboxes_data, H, W):
        """Runs the core MedSAM inference (blocking). Expects tensor on correct device."""
        # print(f"[Thread-{threading.get_ident()}] Running MedSAM blocking inference...")
        start_time = time.time()
        # 1. Image Encoding (Blocking)
        # Assuming img_tensor_device is already on self.device
        image_embedding = self.model.image_encoder(img_tensor_device)
        torch.cuda.synchronize() # Explicit sync point after heavy operation

        masks = {}
        # 2. Loop through boxes and decode masks (Blocking)
        for data in bboxes_data:
            box_1024 = data["box_1024"]
            class_name = data["class_name"]
            # Call the synchronous segmentation function
            mask = self._segment_with_box(image_embedding, box_1024, H, W)
            torch.cuda.synchronize() # Explicit sync point after mask generation
            masks[class_name] = mask

        del image_embedding # Cleanup
        # torch.cuda.empty_cache() # Optional

        end_time = time.time()
        # print(f"[Thread-{threading.get_ident()}] MedSAM blocking inference finished in {end_time - start_time:.3f}s")
        return masks

    # --- Modified async generate_mask ---
    async def generate_mask(self, image_path, bboxes):
        """
        Generate masks asynchronously, offloading I/O and Inference.
        
        Args:
            image_path (str): Path to the image file
            bboxes (list): List of dictionaries with bounding boxes and class names

        Returns:
            dict: Dictionary of masks with class names as keys
        """
        # --- 1. Offload Image Reading (Blocking I/O) ---
        try:
            print(f"Reading image: {image_path}")
            img_np = await asyncio.to_thread(io.imread, image_path)
            if img_np is None:
                 raise ValueError(f"Failed to load image {image_path}")
        except Exception as e:
            raise ValueError(f"Failed to load image {image_path}: {str(e)}") from e

        # --- 2. Preprocess (Sync but likely fast, keep in async path) ---
        # This also moves tensor to the correct device
        try:
            img_tensor_device, img_3c, H, W = self._preprocess_image_sync(img_np)
            del img_np # Free numpy memory
        except Exception as e:
             print(f"Error during preprocessing in generate_mask: {e}")
             raise e

        # --- 3. Prepare data for thread ---
        bboxes_data_for_thread = []
        for det in bboxes:
            bbox = det["bbox"]
            class_name = det["class_name"]
            box_np = np.array([bbox]) # Shape (1, 4)
            # Scale box coordinates
            box_1024 = box_np / np.array([W, H, W, H]) * 1024
            bboxes_data_for_thread.append({"box_1024": box_1024, "class_name": class_name})

        # --- 4. Offload Blocking Inference ---
        masks = {}
        try:
            self.inference_count += 1 # Manage count in async path
            if self.inference_count % self.cleanup_frequency == 0:
                self._clear_gpu_memory() # Manage cleanup in async path

            # Run the synchronous inference function in a thread
            masks = await asyncio.to_thread(
                self._run_blocking_inference,
                img_tensor_device, # Pass tensor already on device
                bboxes_data_for_thread,
                H,
                W
            )
        except Exception as e:
            print(f"Error during threaded inference execution: {e}")
            # Consider clearing GPU memory on error
            self._clear_gpu_memory()
            raise e
        finally:
            # --- 5. Cleanup ---
            del img_tensor_device # Cleanup tensor
            torch.cuda.empty_cache() # Explicit cleanup

        return masks

    def encode_rle(self, mask):
        """
        Encode binary mask using Run-Length Encoding (RLE)

        Args:
            mask: Binary mask as numpy array (0 and 1)

        Returns:
            str: RLE-encoded mask
        """
        pixels = mask.flatten()
        pixels = np.concatenate([[0], pixels, [0]])
        runs = np.where(pixels[1:] != pixels[:-1])[0] + 1
        runs[1::2] -= runs[::2]
        return " ".join(str(x) for x in runs)