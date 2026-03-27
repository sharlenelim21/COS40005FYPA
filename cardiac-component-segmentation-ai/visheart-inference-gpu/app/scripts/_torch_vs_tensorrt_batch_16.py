import ultralytics
import torch
import os
import numpy as np
from pathlib import Path
import json
from typing import Dict, List, Union, Tuple, Any
import cv2


class YoloHandler:
    def __init__(self, model_path):
        self.model_path = model_path
        self.model = None
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.load_model()
        
    def load_model(self):
        # Load the YOLO model from the specified path
        print(f"Loading model from {self.model_path} on device {self.device}")
        try:
            self.model = ultralytics.YOLO(self.model_path, task="detect")
        except Exception as e:
            print(f"Error loading model: {e}")
            raise e
        # If self.model_path is a .pt file, set to evaluate mode
        if self.model_path.endswith(".pt"):
            self.model.eval()
            
    def predict(self, image_path):
        """
        Perform inference on a single image and return standardized bounding boxes
        
        Args:
            image_path: Path to the image file
            
        Returns:
            dict: Results containing standard format bounding boxes
        """
        results = self.model(image_path, verbose=False)
        return self._process_results(results, image_path)
    
    def predict_batch(self, images, batch_size=16):
        """
        Perform inference on a batch of images
        
        Args:
            images: List of image paths or directory containing images
            batch_size: Batch size for inference
            
        Returns:
            dict: Results containing standard format bounding boxes for each image
        """
        # Handle directory input
        if isinstance(images, str) and os.path.isdir(images):
            image_paths = [
                os.path.join(images, f) for f in os.listdir(images) 
                if f.lower().endswith(('.png', '.jpg', '.jpeg', '.bmp'))
            ]
        elif isinstance(images, list):
            image_paths = images
        else:
            raise ValueError("Images must be a directory path or list of image paths")
            
        # Process in batches for memory efficiency
        all_results = {}
        for i in range(0, len(image_paths), batch_size):
            batch = image_paths[i:i+batch_size]
            print(f"Processing batch {i//batch_size + 1}/{(len(image_paths)-1)//batch_size + 1}")
            
            # Run inference
            results = self.model(batch, verbose=False)
            
            # Process each result
            for idx, result in enumerate(results):
                image_path = batch[idx]
                all_results[image_path] = self._process_single_result(result, image_path)
                
        return all_results
    
    def _process_results(self, results, source):
        """Process results from model.predict() into standardized format"""
        if isinstance(source, list):
            # Handle batch results
            processed_results = {}
            for i, result in enumerate(results):
                img_path = source[i]
                processed_results[img_path] = self._process_single_result(result, img_path)
            return processed_results
        else:
            # Handle single image result
            return self._process_single_result(results[0], source)
    
    def _process_single_result(self, result, image_path):
        """Process a single result into standardized format with bounding boxes"""
        boxes = result.boxes
        
        # Get file name without extension
        filename = os.path.basename(image_path)
        
        # Convert boxes to standard format (x1, y1, x2, y2)
        if len(boxes) > 0:
            # Get the xyxy format (xmin, ymin, xmax, ymax)
            xyxy = boxes.xyxy.cpu().numpy()
            
            # Get confidence scores
            conf = boxes.conf.cpu().numpy()
            
            # Get class ids
            cls_ids = boxes.cls.cpu().numpy().astype(int)
            
            # Get class names
            cls_names = [result.names[c] for c in cls_ids]
            
            detections = []
            for i in range(len(xyxy)):
                detections.append({
                    "bbox": xyxy[i].tolist(),  # [x1, y1, x2, y2]
                    "confidence": float(conf[i]),
                    "class_id": int(cls_ids[i]),
                    "class_name": cls_names[i]
                })
        else:
            detections = []
            
        # Return standardized format
        return {
            "filename": filename,
            "path": str(image_path),
            "detections": detections,
            "detection_count": len(detections)
        }
    
    def save_results(self, results, output_path):
        """
        Save detection results to JSON file
        
        Args:
            results: Detection results from predict() or predict_batch()
            output_path: Path to save the results
        """
        with open(output_path, 'w') as f:
            json.dump(results, f, indent=2)
            
    def visualize_detections(self, image_path, detections, output_path=None, 
                            line_width=2, font_size=1):
        """
        Visualize detections on an image
        
        Args:
            image_path: Path to the image
            detections: Detection results for this image
            output_path: Path to save the visualization (None for display only)
            line_width: Width of bounding box lines
            font_size: Size of text
        """
        # Load image
        image = cv2.imread(image_path)
        
        # Draw each detection
        for det in detections["detections"]:
            x1, y1, x2, y2 = [int(coord) for coord in det["bbox"]]
            label = f"{det['class_name']} {det['confidence']:.2f}"
            
            # Draw rectangle
            cv2.rectangle(image, (x1, y1), (x2, y2), (0, 255, 0), line_width)
            
            # Draw label background
            text_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, font_size, 1)[0]
            cv2.rectangle(image, (x1, y1-text_size[1]-5), 
                         (x1+text_size[0], y1), (0, 255, 0), -1)
            
            # Draw text
            cv2.putText(image, label, (x1, y1-5), 
                       cv2.FONT_HERSHEY_SIMPLEX, font_size, (0, 0, 0), 1)
        
        # Save or display
        if output_path:
            cv2.imwrite(output_path, image)
            return output_path
        else:
            return image