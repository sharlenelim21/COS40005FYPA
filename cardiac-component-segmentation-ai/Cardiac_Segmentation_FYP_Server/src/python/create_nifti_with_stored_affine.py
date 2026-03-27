# File: src/python/create_nifti_with_stored_affine.py
# Description: Creates a NIfTI segmentation file from JSON segmentation data and stored metadata,
# using pre-stored affine matrix to avoid downloading original files.

import nibabel as nib
import numpy as np
import json
import sys
import os


# Define your class to integer label mapping
# Ensure these class names match what's in your segmentations.json (e.g., "lvc", "myo", "rv")
# These should align with ComponentBoundingBoxesClass values or your specific class names.
CLASS_TO_LABEL = {
    "lvc": 3,    # Swapped: LVC now gets label 3 (was RV's label)
    "myo": 2,    # Unchanged: Myocardium stays at label 2
    "rv": 1,     # Swapped: RV now gets label 1 (was LVC's label)
    "lv": 3,     # Alias for LVC - updated to match new LVC label
    "manual": 4,  # Example: if you have a "MANUAL" class
    # Add other classes as needed. Background will implicitly be 0.
}


def decode_rle(rle_string, plane_height, plane_width):
    """
    Decodes a Run-Length Encoded string into a 2D numpy mask.
    Assumes RLE string is space-separated pairs of "start_index run_length".
    Indices are for a flattened 1D array (row-major, C-style).
    """
    mask = np.zeros(plane_height * plane_width, dtype=bool)
    if not rle_string or not isinstance(rle_string, str):
        return mask.reshape((plane_height, plane_width))

    try:
        parts = list(map(int, rle_string.split()))
        for i in range(0, len(parts), 2):
            start, length = parts[i], parts[i+1]
            # Basic bounds check for RLE segments
            if start < 0 or start + length > len(mask):
                print(
                    f"Warning: RLE segment start={start}, length={length} is out of bounds for plane size {len(mask)}. Skipping segment.", file=sys.stderr)
                continue
            mask[start:start+length] = True
    except ValueError:
        print(
            f"Warning: Could not parse RLE string parts into integers: '{rle_string}'. Returning empty mask for this RLE.", file=sys.stderr)
        return np.zeros((plane_height, plane_width), dtype=bool)

    return mask.reshape((plane_height, plane_width))


def create_nifti_with_stored_affine(segmentations_json_path, output_nifti_path,
                                    affine_matrix, dimensions, datatype, plane_height_for_rle, plane_width_for_rle):
    """
    Creates a NIfTI segmentation file using stored metadata instead of downloading original file.

    Args:
        segmentations_json_path: Path to JSON file containing segmentation data
        output_nifti_path: Path where the output NIfTI file should be saved
        affine_matrix: 4x4 affine transformation matrix as nested list
        dimensions: Dict with width, height, slices, frames
        datatype: String representing the original data type
        plane_height_for_rle: Height for RLE decoding
        plane_width_for_rle: Width for RLE decoding
    """
    try:
        # Convert affine matrix from nested list to numpy array
        affine = np.array(affine_matrix, dtype=np.float64)

        if affine.shape != (4, 4):
            raise ValueError(
                f"Invalid affine matrix shape: {affine.shape}. Expected (4, 4).")

        # Extract dimensions
        img_width = dimensions.get('width', 0)
        img_height = dimensions.get('height', 0)
        img_slices = dimensions.get('slices', 0)
        img_frames = dimensions.get('frames', 0)
        
        # Load segmentation data FIRST to determine actual frame count
        with open(segmentations_json_path, 'r') as f:
            all_segmentation_sets = json.load(f)
        
        # Determine the actual number of frames from segmentation data
        actual_frames_in_segmentation = 0
        if all_segmentation_sets and len(all_segmentation_sets) > 0:
            segmentation_set = all_segmentation_sets[0]
            frames_list = segmentation_set.get("frames", [])
            if frames_list:
                # Get the maximum frame index + 1 (since indices are 0-based)
                frame_indices = [f.get("frameindex", 0) for f in frames_list]
                actual_frames_in_segmentation = max(frame_indices) + 1 if frame_indices else 1
        
        # Use the maximum of project frames or actual segmentation frames
        # This ensures we create 4D NIfTI even if project.frames is missing/wrong
        final_frame_count = max(img_frames, actual_frames_in_segmentation)
        
        # Determine shape based on dimensions
        # NIfTI convention: shape is (height, width, slices, frames) for numpy arrays
        # ALWAYS create 4D if we have any frame data in segmentation
        is_4d = final_frame_count > 0
        if is_4d:
            img_shape = (img_height, img_width, img_slices, final_frame_count)
        else:
            img_shape = (img_height, img_width, img_slices)

        print(f"Creating NIfTI with dimensions: {img_shape}")
        print(f"Plane dimensions for RLE decoding: Height={plane_height_for_rle}, Width={plane_width_for_rle}")
        print(f"Project frames: {img_frames}, Segmentation frames: {actual_frames_in_segmentation}, Final: {final_frame_count}")
        print(f"Is 4D: {is_4d}, Frames: {final_frame_count if is_4d else 'N/A'}")

        # Initialize segmentation data array
        segmentation_data = np.zeros(img_shape, dtype=np.uint8)

        # Process segmentation data (already loaded above)
        if not all_segmentation_sets:
            print(
                "Warning: No segmentation sets found in JSON. Output NIfTI will be empty.", file=sys.stderr)
        else:
            # Process the first segmentation set (adjust if multiple sets need merging/selection)
            segmentation_set = all_segmentation_sets[0]

            for frame_obj in segmentation_set.get("frames", []):
                frame_idx = frame_obj.get("frameindex", 0)
                if frame_idx >= final_frame_count and is_4d:
                    print(
                        f"Warning: Frame index {frame_idx} from JSON exceeds NIfTI frames {final_frame_count}. Skipping.", file=sys.stderr)
                    continue

                for slice_obj in frame_obj.get("slices", []):
                    slice_idx = slice_obj.get("sliceindex", 0)
                    if slice_idx >= img_slices:
                        print(
                            f"Warning: Slice index {slice_idx} from JSON exceeds NIfTI slices {img_slices}. Skipping.", file=sys.stderr)
                        continue

                    current_slice_label_mask = np.zeros(
                        (plane_height_for_rle, plane_width_for_rle), dtype=np.uint8)

                    for mask_entry in slice_obj.get("segmentationmasks", []):
                        # Ensure lowercase for map lookup
                        class_name = str(mask_entry.get("class", "")).lower()
                        rle_string = mask_entry.get("segmentationmaskcontents")

                        label = CLASS_TO_LABEL.get(class_name)
                        if label is None:
                            print(
                                f"Warning: Unknown class '{class_name}'. Skipping segmentation mask.", file=sys.stderr)
                            continue

                        if rle_string is None or rle_string == "":
                            print(
                                f"Warning: Empty RLE string for class '{class_name}'. Skipping.", file=sys.stderr)
                            continue

                        try:
                            decoded_mask = decode_rle(
                                rle_string, plane_height_for_rle, plane_width_for_rle)
                            # Apply label where mask is True, keeping existing higher priority labels
                            current_slice_label_mask[decoded_mask & (
                                current_slice_label_mask == 0)] = label
                        except Exception as e_rle:
                            print(
                                f"Warning: Error decoding RLE for class '{class_name}': {e_rle}. Skipping.", file=sys.stderr)
                            continue

                    # Ensure the dimensions of current_slice_label_mask match the expected plane dimensions
                    # The mask should have shape (plane_height_for_rle, plane_width_for_rle)
                    # which corresponds to (img_height, img_width) in the original image
                    if current_slice_label_mask.shape[0] != img_height or current_slice_label_mask.shape[1] != img_width:
                        print(
                            f"Warning: Slice mask dimensions {current_slice_label_mask.shape} do not match NIfTI dimensions ({img_height}, {img_width}). Attempting resize.", file=sys.stderr)
                        # Simple resize - you might want to use proper image resampling here
                        current_slice_label_mask = np.resize(
                            current_slice_label_mask, (img_height, img_width))

                    # Assign the 2D label mask to the correct place in the 3D/4D volume
                    if is_4d:
                        segmentation_data[:, :, slice_idx,
                                          frame_idx] = current_slice_label_mask
                    else:
                        segmentation_data[:, :,
                                          slice_idx] = current_slice_label_mask

        # Create NIfTI header based on original datatype
        if datatype.lower() in ['uint8', 'int8']:
            nifti_dtype = np.uint8
        elif datatype.lower() in ['uint16', 'int16']:
            nifti_dtype = np.uint16
        elif datatype.lower() in ['uint32', 'int32']:
            nifti_dtype = np.uint32
        elif datatype.lower() in ['float32']:
            nifti_dtype = np.float32
        elif datatype.lower() in ['float64']:
            nifti_dtype = np.float64
        else:
            print(
                f"Warning: Unknown datatype '{datatype}', defaulting to uint8", file=sys.stderr)
            nifti_dtype = np.uint8

        # Create new NIfTI header
        new_header = nib.Nifti1Header()
        # Segmentation masks are typically uint8
        new_header.set_data_dtype(np.uint8)
        new_header['cal_max'] = float(
            np.max(segmentation_data)) if segmentation_data.size > 0 else 0.0
        new_header['cal_min'] = float(
            np.min(segmentation_data)) if segmentation_data.size > 0 else 0.0
        new_header['scl_slope'] = 1.0
        new_header['scl_inter'] = 0.0

        # Consider setting intent codes if appropriate (e.g., NIFTI_INTENT_LABEL)
        # new_header['intent_code'] = 1002 # Example for NIFTI_INTENT_LABEL
        # new_header['intent_name'] = b'Segmentation' # Needs to be bytes

        # Create and save NIfTI image
        seg_nifti_img = nib.Nifti1Image(
            segmentation_data, affine, header=new_header)
        nib.save(seg_nifti_img, output_nifti_path)
        
        # Log label statistics for debugging
        unique_labels = np.unique(segmentation_data)
        label_counts = {int(label): int(np.sum(segmentation_data == label)) for label in unique_labels}
        print(f"Successfully created segmentation NIfTI: {output_nifti_path}")
        print(f"NIFTI_FILE_PATH:{os.path.abspath(output_nifti_path)}")
        print(f"Unique labels in NIfTI: {unique_labels.tolist()}")
        print(f"Label distribution: {label_counts}")
        print(f"Has label 3 (LVC): {3 in unique_labels}")
        print(f"Has label 2 (MYO): {2 in unique_labels}")
        print(f"Has label 1 (RV): {1 in unique_labels}")

    except Exception as e:
        print(
            f"Error creating NIfTI from segmentations with stored affine: {str(e)}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) != 8:
        print("Usage: python create_nifti_with_stored_affine.py <segmentations_json_path> <output_nifti_path> <affine_matrix_file> <dimensions_file> <datatype> <plane_height_for_rle> <plane_width_for_rle>", file=sys.stderr)
        sys.exit(1)

    segmentations_json_path_arg = sys.argv[1]
    output_nifti_path_arg = sys.argv[2]
    affine_matrix_file_arg = sys.argv[3]
    dimensions_file_arg = sys.argv[4]
    datatype_arg = sys.argv[5]

    try:
        plane_height_arg = int(sys.argv[6])
        plane_width_arg = int(sys.argv[7])
    except (ValueError, IndexError):
        print("Error: plane_height_for_rle and plane_width_for_rle must be integers.", file=sys.stderr)
        sys.exit(1)

    try:
        # Read JSON from files
        with open(affine_matrix_file_arg, 'r') as f:
            affine_matrix = json.load(f)
        with open(dimensions_file_arg, 'r') as f:
            dimensions = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Error reading JSON files: {str(e)}", file=sys.stderr)
        sys.exit(1)

    create_nifti_with_stored_affine(
        segmentations_json_path_arg,
        output_nifti_path_arg,
        affine_matrix,
        dimensions,
        datatype_arg,
        plane_height_arg,
        plane_width_arg
    )
