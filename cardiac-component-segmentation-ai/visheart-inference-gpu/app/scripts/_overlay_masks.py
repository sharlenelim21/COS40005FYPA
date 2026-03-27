#!/usr/bin/env python3
"""
Script to overlay RLE-encoded segmentation masks on original images.

Usage Example:
    python app/scripts/_overlay_masks.py --json results.json --image path/to/image.jpg --output overlays

This script takes a JSON file with RLE-encoded masks from MedSAM inference,
finds the relevant mask for the provided image, and creates a visualization
where the mask is overlaid on the original image with semi-transparent colors.
"""

import os
import json
import argparse
import numpy as np
import cv2
from pathlib import Path


def rle_decode(rle_string, height, width):
    """
    Decode a Run-Length Encoded (RLE) string into a binary mask.

    Args:
        rle_string (str): RLE-encoded mask string (space-separated values)
        height (int): Height of the mask
        width (int): Width of the mask

    Returns:
        np.ndarray: Binary mask as numpy array (0 and 1)
    """
    # Convert the RLE string to a list of integers
    runs = [int(x) for x in rle_string.split()]

    # Initialize an empty mask
    size = height * width
    mask = np.zeros(size, dtype=np.uint8)

    # The encoding alternates between run-starts and run-lengths
    # The first value is where the first run of 1s starts
    # The second value is the length of that run, and so on
    for i in range(0, len(runs), 2):
        start_idx = runs[i]
        if i + 1 < len(runs) and start_idx < size:
            # Ensure we don't go beyond array bounds
            end_idx = min(start_idx + runs[i + 1], size)
            mask[start_idx:end_idx] = 1

    # Reshape the mask to the original dimensions
    return mask.reshape(height, width)


def overlay_masks_on_image(image_path, mask_data, output_path=None):
    """
    Overlay segmentation masks on an original image with class-specific colors.

    Args:
        image_path (str): Path to the original image
        mask_data (dict): Dictionary of class names and RLE strings
        output_path (str, optional): Path to save the visualization

    Returns:
        numpy.ndarray: Image with overlaid masks
    """
    # Read image and get dimensions
    image = cv2.imread(image_path)
    if image is None:
        raise FileNotFoundError(f"Could not read image: {image_path}")

    height, width = image.shape[:2]
    print(f"Image dimensions: {width}x{height}")

    # Create a copy for overlay
    overlay = image.copy()

    # Define colors for different classes (BGR format)
    colors = {
        "lv": (0, 255, 0),  # Green for left ventricle
        "rv": (0, 0, 255),  # Blue for right ventricle
        "myo": (255, 0, 0),  # Red for myocardium
        "manual": (255, 255, 0),  # Yellow for manual mask
    }

    # Process each mask
    for class_name, rle_string in mask_data.items():
        print(f"Processing mask for class: {class_name}")

        # Decode RLE string to binary mask using the corrected function
        binary_mask = rle_decode(rle_string, height, width)

        # Create a colored mask image
        color = colors.get(
            class_name, (255, 255, 255)  # Default white if class not in colors
        )

        # Create a colored mask
        colored_mask = np.zeros_like(image)
        colored_mask[binary_mask == 1] = color

        # Apply the mask with transparency
        alpha = 0.4  # Transparency factor
        mask_pixels = binary_mask == 1
        overlay[mask_pixels] = cv2.addWeighted(
            overlay[mask_pixels], 1 - alpha, colored_mask[mask_pixels], alpha, 0
        )

        # Draw contour around the mask
        contours, _ = cv2.findContours(
            binary_mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )
        cv2.drawContours(overlay, contours, -1, color, 2)

    # Save output if path provided
    if output_path:
        # Check if output_path is a directory
        if os.path.isdir(output_path) or not os.path.splitext(output_path)[1]:
            # If it's a directory or has no extension, append the image filename with _overlay.jpg
            image_filename = os.path.basename(image_path)
            base_name = os.path.splitext(image_filename)[0]
            output_filename = f"{base_name}_overlay.jpg"

            # Join the directory with the new filename
            final_output_path = os.path.join(output_path, output_filename)
        else:
            # If it's a full path with extension, use it directly
            final_output_path = output_path

        # Ensure the directory exists
        os.makedirs(
            (
                os.path.dirname(final_output_path)
                if os.path.dirname(final_output_path)
                else "."
            ),
            exist_ok=True,
        )

        # Save the image with the correct path
        print(f"Saving to: {final_output_path}")
        success = cv2.imwrite(final_output_path, overlay)
        if not success:
            print(
                f"Warning: Failed to save image. Verify that the directory is writable and the extension is valid."
            )
        else:
            print(f"Saved visualization to: {final_output_path}")

    return overlay


def main():
    parser = argparse.ArgumentParser(
        description="Overlay RLE-encoded masks on original images"
    )

    parser.add_argument(
        "--json",
        type=str,
        required=True,
        help="Path to JSON file with RLE-encoded masks",
    )

    parser.add_argument(
        "--image", type=str, required=True, help="Path to the original image"
    )

    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Path to save visualization image (default: adds _overlay suffix)",
    )

    args = parser.parse_args()

    # Get image filename (without path)
    image_filename = os.path.basename(args.image)

    # Set default output path if not specified
    if not args.output:
        output_name = f"{os.path.splitext(image_filename)[0]}_overlay.jpg"
        args.output = os.path.join(os.path.dirname(args.image), output_name)
    # Convert backslashes to forward slashes for consistency across OS
    args.output = args.output.replace("\\", "/")

    # Load JSON data
    with open(args.json, "r") as f:
        json_data = json.load(f)

    # Find the matching entry in the JSON file
    if image_filename in json_data:
        # Check if we have the complex format with boxes and masks
        if (
            isinstance(json_data[image_filename], dict)
            and "masks" in json_data[image_filename]
        ):
            mask_data = json_data[image_filename]["masks"]
        else:
            # Simple format - just the masks
            mask_data = json_data[image_filename]

        # Overlay masks on image
        overlay_masks_on_image(args.image, mask_data, args.output)
        print(f"Processing complete for: {image_filename}")
    else:
        print(f"No masks found for image: {image_filename}")
        print(f"Available images in JSON: {list(json_data.keys())}")


if __name__ == "__main__":
    main()
