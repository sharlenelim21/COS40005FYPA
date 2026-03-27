# File: src/python/extract_metadata.py
# Description: Extracts metadata from a NIfTI file with optimized performance for local files.

import nibabel as nib
import json
import sys
import numpy as np


def extract_nifti_metadata(nifti_path):
    """
    Extract metadata from a NIfTI file (.nii or .nii.gz) with optimized performance.
    Only reads the header without loading the entire data array into memory.
    """
    try:
        # Load only the header without loading the full data array
        img = nib.load(nifti_path, mmap=True)
        header = img.header
        shape = img.shape
        zooms = header.get_zooms()

        # Determine data type in a more robust way
        data_dtype = str(header.get_data_dtype())

        # Build metadata dictionary with proper type conversions
        metadata = {
            "datatype": data_dtype,
            "dimensions": {
                "width": int(shape[1]) if len(shape) > 1 else 0,
                "height": int(shape[0]) if len(shape) > 0 else 0,
                "slices": int(shape[2]) if len(shape) > 2 else 0,
                "frames": int(shape[3]) if len(shape) > 3 else 0
            },
            "voxelsize": {
                # Default to 1.0mm for missing spatial dimensions
                "x": float(zooms[0]) if len(zooms) > 0 and zooms[0] > 0 else 1.0,
                # Default to 1.0mm for missing spatial dimensions
                "y": float(zooms[1]) if len(zooms) > 1 and zooms[1] > 0 else 1.0,
                # None for missing z dimension
                "z": float(zooms[2]) if len(zooms) > 2 and zooms[2] > 0 else None,
                # None for missing temporal dimension
                "t": float(zooms[3]) if len(zooms) > 3 and zooms[3] > 0 else None
            },
            # Convert numpy array to nested list for JSON serialization
            "affineMatrix": img.affine.tolist()
        }

        return metadata
    except Exception as e:
        raise Exception(f"Failed to extract metadata: {str(e)}")


# Entry point: optimized for local file processing
if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps(
            {"error": "Usage: python extract_metadata.py <path_to_nifti>"}))
        sys.exit(1)

    input_path = sys.argv[1]

    try:
        # Extract metadata directly from local file
        extracted_metadata = extract_nifti_metadata(input_path)

        # Output the metadata in JSON format with no whitespace for faster parsing
        print(json.dumps(extracted_metadata))
    except Exception as e:
        # Return error in consistent JSON format
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
