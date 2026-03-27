# https://docs.ultralytics.com/integrations/tensorrt/
# This script converts a YOLO model to TensorRT format.

import torch
from ultralytics import YOLO
import os
import shutil

# Model name
model_name = "24April2025-single-stage-usethis"

# Load the YOLO model
model_path = os.path.join(os.path.dirname(__file__), "..", "models", f"{model_name}.pt")
model = YOLO(model_path)

# Export the model to TensorRT format
model.export(format="engine", dynamic=True, batch=16, half=True, simplify=True, verbose=True)

# Fixed 640x640 input size
# model.export(format="engine", dynamic=False, imgsz=640, batch=16, half=True, simplify=True, verbose=True)