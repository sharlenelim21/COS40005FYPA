import json
import sys
import os
import nibabel as nib
import numpy as np

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


def create_nifti_from_segmentations(segmentations_json_path, original_nifti_path, output_nifti_path, plane_height_for_rle, plane_width_for_rle):
    try:
        original_img = nib.load(original_nifti_path)
        original_header = original_img.header
        affine = original_img.affine
        img_shape = original_img.shape  # (dim0, dim1, slices, frames_or_none)

        print(f"Original NIfTI dimensions: {img_shape}")
        print(
            f"Plane dimensions for RLE decoding: Height={plane_height_for_rle}, Width={plane_width_for_rle}")

        is_4d = len(img_shape) == 4
        num_frames_nifti = img_shape[3] if is_4d else 1
        num_slices_nifti = img_shape[2] if len(img_shape) > 2 else 1

        # Ensure plane_height_for_rle and plane_width_for_rle match the NIfTI's first two dimensions if they are to be used directly
        # For NIfTI, shape is typically (W, H, D, T) or (H, W, D, T) depending on convention and library.
        # Nibabel usually gives (dim_x, dim_y, dim_z, dim_t)
        # If project.dimensions.height = shape[0] and project.dimensions.width = shape[1] from extract_metadata.py,
        # then plane_height_for_rle should be shape[0] and plane_width_for_rle should be shape[1].
        # This script assumes the passed plane_height_for_rle and plane_width_for_rle are correct for RLE.

        segmentation_data = np.zeros(img_shape, dtype=np.uint8)

        with open(segmentations_json_path, 'r') as f:
            all_segmentation_sets = json.load(f)

        if not all_segmentation_sets:
            print(
                "Warning: No segmentation sets found in JSON. Output NIfTI will be empty.", file=sys.stderr)
        else:
            # Process the first segmentation set (adjust if multiple sets need merging/selection)
            segmentation_set = all_segmentation_sets[0]

            for frame_obj in segmentation_set.get("frames", []):
                frame_idx = frame_obj.get("frameindex", 0)
                if frame_idx >= num_frames_nifti:
                    print(
                        f"Warning: Frame index {frame_idx} from JSON exceeds NIfTI frames {num_frames_nifti}. Skipping.", file=sys.stderr)
                    continue

                for slice_obj in frame_obj.get("slices", []):
                    slice_idx = slice_obj.get("sliceindex", 0)
                    if slice_idx >= num_slices_nifti:
                        print(
                            f"Warning: Slice index {slice_idx} from JSON exceeds NIfTI slices {num_slices_nifti}. Skipping.", file=sys.stderr)
                        continue

                    current_slice_label_mask = np.zeros(
                        (plane_height_for_rle, plane_width_for_rle), dtype=np.uint8)

                    for mask_entry in slice_obj.get("segmentationmasks", []):
                        # Ensure lowercase for map lookup
                        class_name = str(mask_entry.get("class", "")).lower()
                        rle_string = mask_entry.get("segmentationmaskcontents")

                        label = CLASS_TO_LABEL.get(class_name)
                        if label is None:
                            # print(f"Info: Class '{class_name}' not in CLASS_TO_LABEL map for frame {frame_idx}, slice {slice_idx}. Skipping.", file=sys.stderr)
                            continue
                        if rle_string is None or rle_string == "":
                            # print(f"Info: Missing or empty RLE for class '{class_name}', frame {frame_idx}, slice {slice_idx}. Skipping.", file=sys.stderr)
                            continue

                        try:
                            class_mask_2d = decode_rle(
                                rle_string, plane_height_for_rle, plane_width_for_rle)
                            # Higher labels overwrite lower if overlap
                            current_slice_label_mask[class_mask_2d] = label
                        except Exception as e_rle:
                            print(
                                f"Error decoding RLE for class '{class_name}', frame {frame_idx}, slice {slice_idx}: {e_rle}", file=sys.stderr)

                    # Assign the 2D label mask to the correct place in the 3D/4D volume
                    # Ensure the dimensions of current_slice_label_mask match the NIfTI plane
                    if current_slice_label_mask.shape[0] != img_shape[0] or current_slice_label_mask.shape[1] != img_shape[1]:
                        print(
                            f"Warning: Mismatch between RLE plane dimensions ({current_slice_label_mask.shape}) and NIfTI plane ({img_shape[0]}, {img_shape[1]}) for slice {slice_idx}, frame {frame_idx}. Attempting to resize.", file=sys.stderr)

                        # Resize/pad the mask to match NIfTI dimensions
                        target_shape = (img_shape[0], img_shape[1])
                        resized_mask = np.zeros(target_shape, dtype=np.uint8)

                        # Calculate the minimum overlap region
                        min_height = min(
                            current_slice_label_mask.shape[0], target_shape[0])
                        min_width = min(
                            current_slice_label_mask.shape[1], target_shape[1])

                        # Copy the overlapping region
                        resized_mask[:min_height,
                                     :min_width] = current_slice_label_mask[:min_height, :min_width]
                        current_slice_label_mask = resized_mask

                        print(
                            f"Resized mask from {current_slice_label_mask.shape} to {target_shape}", file=sys.stderr)

                    if is_4d:
                        # Assumes (H, W) order for RLE plane
                        segmentation_data[..., slice_idx,
                                          frame_idx] = current_slice_label_mask
                    else:  # 3D
                        # Assumes (H, W) order for RLE plane
                        segmentation_data[...,
                                          slice_idx] = current_slice_label_mask

        new_header = original_header.copy()
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

        seg_nifti_img = nib.Nifti1Image(
            segmentation_data, affine, header=new_header)
        nib.save(seg_nifti_img, output_nifti_path)

        print(f"Successfully created segmentation NIfTI: {output_nifti_path}")
        print(f"NIFTI_FILE_PATH:{os.path.abspath(output_nifti_path)}")

    except Exception as e:
        print(
            f"Error creating NIfTI from segmentations: {str(e)}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    if len(sys.argv) != 6:
        print("Usage: python create_nifti_from_segmentations.py <segmentations_json_path> <original_nifti_path> <output_nifti_path> <plane_height_for_rle> <plane_width_for_rle>", file=sys.stderr)
        sys.exit(1)

    segmentations_json_path_arg = sys.argv[1]
    original_nifti_path_arg = sys.argv[2]
    output_nifti_path_arg = sys.argv[3]
    try:
        plane_height_arg = int(sys.argv[4])
        plane_width_arg = int(sys.argv[5])
    except ValueError:
        print("Error: plane_height_for_rle and plane_width_for_rle must be integers.", file=sys.stderr)
        sys.exit(1)

    create_nifti_from_segmentations(segmentations_json_path_arg, original_nifti_path_arg,
                                    output_nifti_path_arg, plane_height_arg, plane_width_arg)
