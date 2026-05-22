import ultralytics
import torch
import os
import numpy as np
from pathlib import Path
import json
import logging
from typing import Dict, List, Union, Tuple, Any
import cv2
from ultralytics.nn.tasks import DetectionModel
import asyncio
import threading
import time

#New: Import device utilities
from app.classes.device_runtime import resolve_device, get_backend


class YoloHandler:
    def __init__(self, model_path):
        self.model_path = model_path
        self.model = None
        #old:
        
        
        #New:
        preferred_device = os.getenv("VISHEART_DEVICE", "auto")
        self.device = resolve_device(preferred_device)
        self.backend = get_backend()

        # Load model synchronously during init - usually OK as it happens once at startup
        self._load_model()

    def _load_model(self):
        # Load the YOLO model from the specified path (synchronous)
        logger = logging.getLogger("visheart")
        model_name = self.model_path.split('/')[-1]
        logger.info(f"Loading YOLO from {model_name} on device {self.device}")
        try:
            torch.serialization.add_safe_globals([DetectionModel])
            self.model = ultralytics.YOLO(self.model_path, task="detect")

            # New: Attempt to move model to the resolved device at load time (ultralytics can also accept device at predict time)
            try:
                self.model.to(str(self.device))
            except Exception:
                # keep non-fatal; fallback to per-call device assignment
                pass 

        except Exception as e:
            logger.error(f"Error loading YOLO model: {e}")
            raise e
        if self.model_path.endswith(".pt"):
            self.model.eval()

    # --- Synchronous internal prediction ---
    def _predict_sync(self, image_batch: List[str]) -> List[Any]:
        """Runs the blocking prediction on a batch."""
        # Ensure model is loaded
        if self.model is None:
            raise RuntimeError("YOLO model is not loaded.")
        print(f"[Thread-{threading.get_ident()}] Running YOLO predict_sync on batch size {len(image_batch)}...")
        start_time = time.time()

        # New: Pass device argument to model.predict() to ensure it runs on the correct device.
        # Ultralytics accepts device as "cpu", "0", "cuda:0", etc.
        device_arg = str(self.device)
        results = self.model(image_batch, verbose=False, device=device_arg)

        # This model call is the blocking part
        #results = self.model(image_batch, verbose=False)
        end_time = time.time()
        print(f"[Thread-{threading.get_ident()}] YOLO predict_sync finished in {end_time - start_time:.3f}s")
        return results
    # --- End Synchronous internal prediction ---

    async def predict(self, image_path):
        """
        Perform inference on a single image asynchronously.
        Offloads the blocking prediction to a thread.
        
        Args:
            image_path: Path to the image file

        Returns:
            dict: Results containing standard format bounding boxes
        """
        # Offload the synchronous prediction
        results_list = await asyncio.to_thread(self._predict_sync, [image_path])
        # Process results (this part is usually fast)
        return self._process_results(results_list, image_path)  # Pass original path

    async def predict_batch(self, images, batch_size=16):
        """
        Perform inference on a batch of images asynchronously.
        Offloads the blocking prediction to threads.
        
        Args:
            images: List of image paths or directory containing images
            batch_size: Batch size for inference

        Returns:
            dict: Results containing standard format bounding boxes for each image
        """
        if isinstance(images, str) and os.path.isdir(images):
            image_paths = [
                os.path.join(images, f)
                for f in os.listdir(images)
                if f.lower().endswith((".png", ".jpg", ".jpeg", ".bmp"))
            ]
        elif isinstance(images, list):
            image_paths = images
        else:
            raise ValueError("Images must be a directory path or list of image paths")

        all_results = {}
        # Process in batches, offloading each batch prediction
        for i in range(0, len(image_paths), batch_size):
            batch_paths = image_paths[i : i + batch_size]
            print(f"Processing batch {i//batch_size + 1}/{(len(image_paths)-1)//batch_size + 1}")

            # Offload synchronous prediction for the current batch
            batch_model_results = await asyncio.to_thread(self._predict_sync, batch_paths)

            # Process results for this batch (fast)
            for idx, result in enumerate(batch_model_results):
                image_path = batch_paths[idx]
                # Use the synchronous processing function here as it doesn't block
                all_results[image_path] = self._process_single_result(result, image_path)

        return all_results

    def _process_results(self, results, source):
        """Process results from model.predict() into standardized format"""
        if isinstance(source, list):
            # Handle batch results
            processed_results = {}
            for i, result in enumerate(results):
                img_path = source[i]  # Get path from original list
                processed_results[img_path] = self._process_single_result(result, img_path)
            return processed_results
        else:
            # Handle single image result - results[0] because _predict_sync returns a list
            return self._process_single_result(results[0], source)

    def _process_single_result(self, result, image_path):
        """Process a single result into standardized format with bounding boxes"""
        boxes = result.boxes
        filename = os.path.basename(image_path)
        if len(boxes) > 0:
            xyxy = boxes.xyxy.cpu().numpy()
            conf = boxes.conf.cpu().numpy()
            cls_ids = boxes.cls.cpu().numpy().astype(int)
            cls_names = [result.names[c] for c in cls_ids]
            detections = []
            for i in range(len(xyxy)):
                detections.append(
                    {
                        "bbox": xyxy[i].tolist(),
                        "confidence": float(conf[i]),
                        "class_id": int(cls_ids[i]),
                        "class_name": cls_names[i],
                    }
                )
        else:
            detections = []
        return {
            "filename": filename,
            "path": str(image_path),
            "detections": detections,
            "detection_count": len(detections),
        }

    def _sanitize_results(self, results):
        """
        Sanitize and sort the detection results to provide a cleaner API response.
        Removes full file paths, simplifies the structure, and sorts by slice numbers.

        Args:
            results: Results dictionary from predict() or predict_batch()

        Returns:
            dict: Simplified and sorted results with filenames as keys and lists of detections as values
        """
        # First, create unsorted sanitized results
        unsorted_sanitized = {}

        # Check if results is a single result or multiple
        if isinstance(results, dict) and any(
            isinstance(v, dict) and "detections" in v for v in results.values()
        ):
            # Handle batch results
            for full_path, result_data in results.items():
                # Extract filename without path
                filename = os.path.basename(full_path)

                # Extract only necessary information from detections
                simplified_detections = []
                for det in result_data["detections"]:
                    simplified_detections.append(
                        {"bbox": det["bbox"], "class_name": det["class_name"]}
                    )

                unsorted_sanitized[filename] = simplified_detections
        else:
            # Handle single result
            filename = os.path.basename(results["path"])
            simplified_detections = []
            for det in results["detections"]:
                simplified_detections.append(
                    {"bbox": det["bbox"], "class_name": det["class_name"]}
                )
            unsorted_sanitized[filename] = simplified_detections

        # Function to extract slice numbers from filename
        def get_slice_numbers(filename):
            # Extract the X_Y part from filename
            try:
                parts = filename.split("_")
                # Make sure we have at least 2 parts
                if len(parts) >= 2:
                    # Try to get the last two parts before the file extension
                    x = int(parts[-2])
                    y = int(parts[-1].split(".")[0])  # Remove file extension
                    return (x, y)
                return (0, 0)  # Default if pattern doesn't match
            except (ValueError, IndexError):
                return (0, 0)  # Default if parsing fails

        # Sort the keys and create a new ordered dictionary
        sorted_items = sorted(
            unsorted_sanitized.items(), key=lambda item: get_slice_numbers(item[0])
        )
        sanitized = dict(sorted_items)

        return sanitized

    async def save_results(self, results, output_path):
        """
        Save detection results to JSON file asynchronously

        Args:
            results: Detection results from predict() or predict_batch()
            output_path: Path to save the results
        """
        # Offload the file I/O operation to a thread to avoid blocking
        await asyncio.to_thread(self._save_results_sync, results, output_path)
    
    def _save_results_sync(self, results, output_path):
        """Synchronous helper for saving results to file"""
        with open(output_path, "w") as f:
            json.dump(self._sanitize_results(results), f, indent=2)
            
    # Provide synchronous version for backward compatibility if needed
    def save_results_sync(self, results, output_path):
        """
        Save detection results to JSON file (synchronous version)
        
        Args:
            results: Detection results from predict() or predict_batch()
            output_path: Path to save the results
        """
        self._save_results_sync(results, output_path)