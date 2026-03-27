# File: app/helpers/inference_helpers.py
# Description: This file contains helper functions for processing inference results, including filtering detections, encoding masks, and sorting results. This file is imported into the inference_jobs.py file.


from collections import defaultdict
import os
from typing import List, Dict

def filter_detections(detections):
    """
    Filter detections to keep at most 3 unique classes with highest confidence

    Args:
        detections (list): List of detection dictionaries

    Returns:
        list: Filtered list of detections
    """
    if not detections:
        return []

    # Group detections by class name
    class_groups = defaultdict(list)
    for det in detections:
        class_groups[det["class_name"]].append(det)

    # Get the highest confidence detection for each class
    top_detections_by_class = []
    for class_name, group in class_groups.items():
        # Sort by confidence (descending)
        group.sort(key=lambda x: x["confidence"], reverse=True)
        # Keep the highest confidence detection for each class
        top_detections_by_class.append(group[0])

    # Sort by confidence across classes
    top_detections_by_class.sort(key=lambda x: x["confidence"], reverse=True)

    # Limit to top 3 classes
    return top_detections_by_class[:3]


def encode_and_name_masks(filename, masks, medsam_handler):
    """
    Encode masks using RLE format and name them according to the convention

    Args:
        filename (str): Original image filename
        masks (dict): Dictionary of masks with class names as keys
        medsam_handler (MedSamHandler): Instance of MedSamHandler to use for RLE encoding

    Returns:
        dict: Dictionary of RLE-encoded masks with proper naming
    """
    # Extract user_id, hash_id, frame, and slice from filename
    # Expected format: {user_id}_{hash_id}_{frame}_{slice}.{ext}
    parts = os.path.splitext(filename)[0].split("_")

    if len(parts) >= 4:
        user_id = parts[0]
        hash_id = parts[1]
        frame = parts[2]
        slice_num = parts[3]
    else:
        # If filename doesn't match expected format, use original name
        user_id = "unknown"
        hash_id = "unknown"
        frame = "0"
        slice_num = "0"

    # Encode masks and generate output filenames
    result = {}

    for class_name, mask in masks.items():
        # Encode mask using RLE
        rle_encoded = medsam_handler.encode_rle(mask)

        # Store encoded mask with filename
        result[class_name] = rle_encoded

    return result


def sort_medsam_results(results):
    """
    Sort MedSAM results by slice numbers extracted from filenames.

    Args:
        results: Dictionary with filenames as keys and mask results as values

    Returns:
        dict: Sorted dictionary with consistent ordering
    """

    # Function to extract slice numbers from filename (same as in YoloHandler)
    def get_slice_numbers(filename):
        # Extract the X_Y part from filename
        try:
            parts = filename.split("_")
            # Make sure we have at least 2 parts
            if len(parts) >= 2:
                # Try to get the last two parts before the file extension
                x = int(parts[-2]) if parts[-2].isdigit() else 0
                y_part = parts[-1].split(".")[0]  # Remove file extension
                y = int(y_part) if y_part.isdigit() else 0
                return (x, y)
            return (0, 0)  # Default if pattern doesn't match
        except (ValueError, IndexError):
            return (0, 0)  # Default if parsing fails

    # Sort the keys and create a new ordered dictionary
    sorted_items = sorted(results.items(), key=lambda item: get_slice_numbers(item[0]))
    return dict(sorted_items)
