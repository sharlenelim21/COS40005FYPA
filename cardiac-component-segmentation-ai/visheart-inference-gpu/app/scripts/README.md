# VisHeart Inference GPU Utility Scripts

This directory contains utility scripts for the VisHeart inference GPU system. These scripts are used for model management, testing, visualization, and system verification.

## Model Management Scripts

### _yolo_to_tensorrt.py

Converts YOLO models from PyTorch (.pt) format to TensorRT (.engine) format for accelerated inference on NVIDIA GPUs.

**Usage:**
```bash
python app/scripts/_yolo_to_tensorrt.py
```

This script automatically processes the `24April2025-single-stage-usethis.pt` model from the models directory and creates the corresponding TensorRT engine file.

## Inference Testing Scripts

### _test_medsam_inference.py

Tests the YOLO+MedSAM inference pipeline on local images, applying both chamber detection and segmentation.

**Usage:**
```bash
python app/scripts/_test_medsam_inference.py --images <image_folder> --output <results_folder> --yolo_model <yolo_model_path> --medsam_model <medsam_model_path> [options]
```

**Parameters:**
- `--images`: Directory containing test images
- `--output`: Directory where results will be saved
- `--yolo_model`: Path to YOLO model (.pt, .onnx, or .engine)
- `--medsam_model`: Path to MedSAM model checkpoint (.pth)
- `--device`: Device for inference (default: 'cuda:0')
- `--yolo_batch_size`: Batch size for YOLO inference (default: 4)
- `--no-visualize`: Disable saving overlay visualization images

**Output:**
- Saves segmentation masks in the `masks` subdirectory
- Saves visualization overlays in the `overlays` subdirectory
- Provides performance metrics including execution times

### _test_bbox_inference_pipeline.py

Tests the bounding box detection pipeline using a presigned URL as input.

**Usage:**
```bash
python app/scripts/_test_bbox_inference_pipeline.py
```

## Performance Testing Scripts

### _torch_vs_tensorrt.py

Compares inference performance between PyTorch and TensorRT implementations of the YOLO model.

**Usage:**
```bash
python app/scripts/_torch_vs_tensorrt.py
```

**Output:**
- Saves comparison results to the `test_results_folder` directory
- Generates IoU histograms and summary statistics
- Creates a `summary.txt` file with performance metrics

## Visualization Tools

### _overlay_masks.py

Visualizes RLE-encoded segmentation masks on original images with color-coded overlays.

**Usage:**
```bash
python app/scripts/_overlay_masks.py --json <results_json> --image <image_path> [--output <output_path>]
```

**Parameters:**
- `--json`: Path to JSON file containing RLE-encoded masks
- `--image`: Path to the original image
- `--output`: Path to save visualization (default: adds _overlay suffix to original image)

The script supports both JSON formats from batch and manual inference endpoints.

### _interactive_medsam_ui.py

GUI tool for downloading images from presigned URLs, drawing manual bounding boxes, and generating segmentation masks using the manual inference endpoint.

**Usage:**
```bash
python app/scripts/_interactive_medsam_ui.py
```

**Features:**
- URL input for accessing S3 tar archives
- Image selection and display
- Interactive bounding box drawing
- One-click segmentation using the manual inference endpoint
- Visualization and export of results

## System Verification Scripts

### _version_checks.py

Verifies all required Python packages are installed and checks CUDA availability in PyTorch.

**Usage:**
```bash
python app/scripts/_version_checks.py
```

**Checks:**
- Presence and version of required packages
- CUDA availability and version
- TensorRT integration status

## Notes

- Scripts prefixed with underscore (`_`) are utility scripts not meant to be imported as modules
- All scripts should be run from the root directory of the project
- GPU acceleration requires NVIDIA CUDA 11.8 and compatible drivers