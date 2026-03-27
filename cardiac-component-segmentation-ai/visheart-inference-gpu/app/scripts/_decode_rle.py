"""
Script to decode RLE-encoded segmentation masks from MedSAM inference results.

Usage Example:
   # Save only masks
    python app/scripts/_decode_rle.py --input results.json --output mask_images --height 512 --width 512

    # Save both masks and bounding boxes
    python app/scripts/_decode_rle.py --input results.json --output mask_images --save-boxes

This script takes the JSON output from the /medsam-inference endpoint and converts
the RLE-encoded masks back into binary PNG images.
"""

import os
import json
import numpy as np
import argparse
from pathlib import Path
import cv2


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


def decode_rle_masks(input_json, output_dir, image_size=(512, 512), save_boxes=False):
    """
    Decode RLE-encoded masks from JSON to PNG files.

    Args:
        input_json (str): Path to JSON file with RLE-encoded masks
        output_dir (str): Directory to save output PNG files
        image_size (tuple): Default size for mask images if not specified
        save_boxes (bool): Whether to save bounding box data along with masks
    """
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)

    # Load the JSON data
    with open(input_json, "r") as f:
        results_data = json.load(f)

    print(f"Processing {len(results_data)} images")
    
    # Track stats for summary
    total_boxes_found = 0
    total_boxes_saved = 0

    # Process each image
    for image_filename, result_data in results_data.items():
        print(f"Processing image: {image_filename}")
        
        # Print the structure of the data for debugging
        if save_boxes:
            print(f"  Data structure: {list(result_data.keys()) if isinstance(result_data, dict) else 'not a dict'}")

        # Check if we have the new format (with boxes and masks)
        if isinstance(result_data, dict) and "masks" in result_data:
            class_masks = result_data["masks"]
            boxes = result_data.get("boxes", [])
            if save_boxes:
                print(f"  Found {len(boxes)} boxes in new format")
                total_boxes_found += len(boxes)
        else:
            # Fallback to old format where result_data is directly the masks
            class_masks = result_data
            boxes = []
            if save_boxes:
                print("  Using legacy format (no boxes available)")

        # Extract identifiers from filename
        parts = os.path.splitext(image_filename)[0].split("_")
        if len(parts) >= 4:
            user_id, hash_id, frame, slice_num = parts[:4]
        else:
            user_id = "unknown"
            hash_id = "unknown"
            frame = "0"
            slice_num = "0"

        # Save bounding box data if requested and available
        if save_boxes and boxes:
            box_filename = f"{user_id}_{hash_id}_{frame}_{slice_num}_boxes.json"
            box_path = os.path.join(output_dir, box_filename)
            with open(box_path, "w") as f:
                json.dump(boxes, f, indent=2)
            print(f"  - Saved bounding boxes to {box_filename}")
            total_boxes_saved += 1
            
            # Also save a visualization of the boxes on a blank image
            try:
                height, width = image_size
                box_viz = np.zeros((height, width, 3), dtype=np.uint8)
                
                # Draw each box with a different color based on class
                colors = {
                    'lv': (0, 255, 0),   # Green for left ventricle
                    'rv': (0, 0, 255),   # Blue for right ventricle
                    'myo': (255, 0, 0)   # Red for myocardium
                }
                
                for box in boxes:
                    # Extract box coordinates
                    x1, y1, x2, y2 = [int(coord) for coord in box['bbox']]
                    
                    # Get class name and color
                    class_name = box.get('class_name', 'unknown')
                    color = colors.get(class_name, (255, 255, 255))
                    
                    # Draw rectangle
                    cv2.rectangle(box_viz, (x1, y1), (x2, y2), color, 2)
                    
                    # Add label
                    conf = box.get('confidence', 0)
                    label = f"{class_name}: {conf:.2f}"
                    cv2.putText(box_viz, label, (x1, y1-5), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
                
                # Save visualization
                viz_filename = f"{user_id}_{hash_id}_{frame}_{slice_num}_boxes_viz.png"
                viz_path = os.path.join(output_dir, viz_filename)
                cv2.imwrite(viz_path, box_viz)
                print(f"  - Saved box visualization to {viz_filename}")
            except Exception as e:
                print(f"  - Error creating box visualization: {e}")

        # Process each class mask for this image
        for class_name, rle_string in class_masks.items():
            print(f"  - Decoding {class_name} mask")

            # Decode the RLE string to a binary mask
            height, width = image_size
            try:
                mask = rle_decode(rle_string, height, width)

                # Convert binary mask to 8-bit (0-255) image
                mask_image = (mask * 255).astype(np.uint8)

                # Generate output filename using the same naming convention
                output_filename = (
                    f"{user_id}_{hash_id}_{frame}_{slice_num}_{class_name}.png"
                )
                output_path = os.path.join(output_dir, output_filename)

                # Save the mask as a PNG file
                cv2.imwrite(output_path, mask_image)
                print(f"    Saved: {output_filename}")

            except Exception as e:
                print(f"    Error decoding mask for {class_name}: {e}")

    # Print summary
    print(f"Finished processing. Masks saved to: {output_dir}")
    if save_boxes:
        print(f"Box statistics: Found {total_boxes_found} boxes across {total_boxes_saved} images")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Decode RLE-encoded masks to PNG images"
    )

    parser.add_argument(
        "--input",
        type=str,
        required=True,
        help="Path to JSON file with RLE-encoded masks",
    )

    parser.add_argument(
        "--output",
        type=str,
        default="mask_images",
        help="Directory to save output PNG files",
    )

    parser.add_argument(
        "--height",
        type=int,
        default=512,
        help="Height of the mask images (default: 512)",
    )

    parser.add_argument(
        "--width",
        type=int,
        default=512,
        help="Width of the mask images (default: 512)",
    )

    parser.add_argument(
        "--save-boxes",
        action="store_true",
        help="Save bounding box data along with masks",
    )

    args = parser.parse_args()

    decode_rle_masks(
        args.input,
        args.output,
        image_size=(args.height, args.width),
        save_boxes=args.save_boxes,
    )