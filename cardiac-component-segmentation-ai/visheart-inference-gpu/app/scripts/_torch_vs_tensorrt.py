# Script to compare TensorRT and PyTorch model accuracy and performance

import torch
from ultralytics import YOLO
import os
import time
import numpy as np
import cv2
from pathlib import Path
import pandas as pd
import matplotlib.pyplot as plt
import glob

# Model name
model_name = "24April2025-single-stage-usethis"

# Define model paths
model_dir = os.path.join(os.path.dirname(__file__), "..", "models")
pt_path = os.path.join(model_dir, f"{model_name}.pt")
engine_path = os.path.join(model_dir, f"{model_name}.engine")

# Define folders
current_dir = os.path.dirname(os.path.abspath(__file__))
test_folder = os.path.join(current_dir, "test_folder")
results_folder = os.path.join(current_dir, "test_results_folder")


def load_models():
    """Load both PyTorch and TensorRT models"""
    print(f"Loading PyTorch model from: {pt_path}")
    pt_model = YOLO(pt_path)

    print(f"Loading TensorRT model from: {engine_path}")
    trt_model = YOLO(engine_path)

    return pt_model, trt_model


def calculate_iou(box1, box2):
    """Calculate IoU between two bounding boxes"""
    # Extract coordinates
    x1_1, y1_1, x2_1, y2_1 = box1
    x1_2, y1_2, x2_2, y2_2 = box2

    # Calculate intersection area
    x1_i = max(x1_1, x1_2)
    y1_i = max(y1_1, y1_2)
    x2_i = min(x2_1, x2_2)
    y2_i = min(y2_1, y2_2)

    if x2_i < x1_i or y2_i < y1_i:
        return 0.0  # No intersection

    intersection = (x2_i - x1_i) * (y2_i - y1_i)

    # Calculate areas of both boxes
    area1 = (x2_1 - x1_1) * (y2_1 - y1_1)
    area2 = (x2_2 - x1_2) * (y2_2 - y1_2)

    # Calculate IoU
    iou = intersection / (area1 + area2 - intersection)
    return iou


def compare_inference(pt_model, trt_model, image_path):
    """Compare inference results between PyTorch and TensorRT models"""
    # Warm-up runs
    _ = pt_model(image_path, verbose=False)
    _ = trt_model(image_path, verbose=False)

    # Timing for PyTorch
    pt_start = time.time()
    pt_results = pt_model(image_path, verbose=False)
    pt_time = time.time() - pt_start

    # Timing for TensorRT
    trt_start = time.time()
    trt_results = trt_model(image_path, verbose=False)
    trt_time = time.time() - trt_start

    # Extract results
    pt_boxes = pt_results[0].boxes
    trt_boxes = trt_results[0].boxes

    # Compare number of detections
    pt_count = len(pt_boxes)
    trt_count = len(trt_boxes)

     # Calculate IoU if there are detections in both
    iou_values = []
    conf_diffs = []

    if pt_count > 0 and trt_count > 0:
        pt_xyxy = pt_boxes.xyxy.cpu().numpy()
        trt_xyxy = trt_boxes.xyxy.cpu().numpy()
        
        # Compare confidence scores
        pt_conf = pt_boxes.conf.cpu().numpy()
        trt_conf = trt_boxes.conf.cpu().numpy()
        
        # Match each PyTorch box to its best TensorRT match
        for i in range(pt_count):
            best_iou = 0
            best_idx = -1
            
            # Find best matching box in TensorRT detections
            for j in range(trt_count):
                iou = calculate_iou(pt_xyxy[i], trt_xyxy[j])
                if iou > best_iou:
                    best_iou = iou
                    best_idx = j
            
            if best_idx >= 0:
                iou_values.append(best_iou)
                # Calculate confidence difference with best matching box
                conf_diff = abs(pt_conf[i] - trt_conf[best_idx])
                conf_diffs.append(conf_diff)

    mean_iou = np.mean(iou_values) if iou_values else 0
    mean_conf_diff = np.mean(conf_diffs) if conf_diffs else 1.0

    # Save visualization results
    filename = os.path.basename(image_path)

    # Create output directories
    os.makedirs(os.path.join(results_folder, "pytorch"), exist_ok=True)
    os.makedirs(os.path.join(results_folder, "tensorrt"), exist_ok=True)

    # Plot PyTorch results with thinner boxes and smaller font
    for r in pt_results:
        im_array = r.plot(
            line_width=1, font_size=8
        )  # Customize thickness and font size
        output_path = os.path.join(results_folder, "pytorch", filename)
        cv2.imwrite(output_path, im_array)

    # Plot TensorRT results with thinner boxes and smaller font
    for r in trt_results:
        im_array = r.plot(
            line_width=1, font_size=8
        )  # Customize thickness and font size
        output_path = os.path.join(results_folder, "tensorrt", filename)
        cv2.imwrite(output_path, im_array)

    return {
        "image": filename,
        "pytorch_time": pt_time,
        "tensorrt_time": trt_time,
        "speedup": pt_time / trt_time if trt_time > 0 else 0,
        "pytorch_detections": pt_count,
        "tensorrt_detections": trt_count,
        "mean_iou": mean_iou,
        "mean_conf_diff": mean_conf_diff,
    }


def process_all_images():
    """Process all images in the test folder and calculate statistics"""
    # Load models
    pt_model, trt_model = load_models()

    # Get all jpg files in the test folder
    image_files = glob.glob(os.path.join(test_folder, "*.jpg"))
    if not image_files:
        print(f"No images found in {test_folder}. Please add test images.")
        return None

    print(f"Found {len(image_files)} images in {test_folder}")

    # Process each image
    results = []
    problematic_images = []  # New list to track problematic images

    for i, image_path in enumerate(image_files):
        print(
            f"Processing image {i+1}/{len(image_files)}: {os.path.basename(image_path)}"
        )
        result = compare_inference(pt_model, trt_model, image_path)
        results.append(result)

        # Flag problematic images (IoU < 0.9 or large confidence difference)
        if result["mean_iou"] < 0.9 or result["mean_conf_diff"] > 0.1:
            problematic_images.append(result)

    # Convert results to DataFrame for easier analysis
    df = pd.DataFrame(results)

    # Calculate aggregate statistics
    avg_speedup = df["speedup"].mean()
    avg_iou = df["mean_iou"].mean()
    avg_conf_diff = df["mean_conf_diff"].mean()
    pytorch_avg_time = df["pytorch_time"].mean()
    tensorrt_avg_time = df["tensorrt_time"].mean()
    detection_diff = (
        df["pytorch_detections"] != df["tensorrt_detections"]
    ).mean() * 100

    # Save results to CSV
    df.to_csv(os.path.join(results_folder, "comparison_results.csv"), index=False)

    # Generate summary statistics
    summary = {
        "Total images": len(image_files),
        "Average PyTorch inference time (s)": pytorch_avg_time,
        "Average TensorRT inference time (s)": tensorrt_avg_time,
        "Average speedup": avg_speedup,
        "Average IoU": avg_iou,
        "Average confidence difference": avg_conf_diff,
        "Detection count mismatch percentage": detection_diff,
        "Problematic images": len(problematic_images),
    }

    # Report problematic images
    if problematic_images:
        print("\n=== PROBLEMATIC IMAGES ===")
        print(
            f"Found {len(problematic_images)} images with IoU < 0.9 or confidence difference > 0.1"
        )

        # Save problematic images to a separate CSV
        problematic_df = pd.DataFrame(problematic_images)
        problematic_df.to_csv(
            os.path.join(results_folder, "problematic_images.csv"), index=False
        )

        # Print details of each problematic image
        for img in problematic_images:
            print(f"Image: {img['image']}")
            print(f"  IoU: {img['mean_iou']:.4f}")
            print(f"  Confidence diff: {img['mean_conf_diff']:.4f}")
            print(f"  PyTorch detections: {img['pytorch_detections']}")
            print(f"  TensorRT detections: {img['tensorrt_detections']}")
            print("")
    else:
        print("\nNo problematic images found! All detections are consistent.")

    # Continue with existing code...
    # Save summary to text file
    os.makedirs(results_folder, exist_ok=True)
    with open(os.path.join(results_folder, "summary.txt"), "w") as f:
        f.write("=== TensorRT vs PyTorch Inference Comparison ===\n\n")
        for key, value in summary.items():
            f.write(
                f"{key}: {value:.4f}\n"
                if isinstance(value, float)
                else f"{key}: {value}\n"
            )

        # Add problematic images section to summary file
        if problematic_images:
            f.write("\n=== PROBLEMATIC IMAGES ===\n")
            for img in problematic_images:
                f.write(
                    f"Image: {img['image']}, IoU: {img['mean_iou']:.4f}, Conf diff: {img['mean_conf_diff']:.4f}\n"
                )

    # Plot speedup histogram
    plt.figure(figsize=(10, 6))
    plt.hist(df["speedup"], bins=20, alpha=0.7)
    plt.title("TensorRT Speedup Distribution")
    plt.xlabel("Speedup Factor")
    plt.ylabel("Number of Images")
    plt.grid(True, alpha=0.3)
    plt.savefig(os.path.join(results_folder, "speedup_histogram.png"))

    # Plot IoU histogram
    plt.figure(figsize=(10, 6))
    plt.hist(df["mean_iou"], bins=20, alpha=0.7)
    plt.title("IoU Distribution Between PyTorch and TensorRT")
    plt.xlabel("IoU")
    plt.ylabel("Number of Images")
    plt.grid(True, alpha=0.3)
    plt.savefig(os.path.join(results_folder, "iou_histogram.png"))

    return summary


def main():
    # Ensure test folder exists
    os.makedirs(test_folder, exist_ok=True)
    os.makedirs(results_folder, exist_ok=True)

    # Process all images
    summary = process_all_images()

    if summary:
        # Print summary
        print("\n=== COMPARISON SUMMARY ===")
        for key, value in summary.items():
            print(
                f"{key}: {value:.4f}" if isinstance(value, float) else f"{key}: {value}"
            )

        print(f"\nDetailed results saved to {results_folder}")
    else:
        print(f"\nPlease add test images to {test_folder} and run the script again.")


if __name__ == "__main__":
    main()
