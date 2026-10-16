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

        voxel_x = float(zooms[0]) if len(zooms) > 0 and zooms[0] > 0 else 1.0
        voxel_y = float(zooms[1]) if len(zooms) > 1 and zooms[1] > 0 else 1.0
        voxel_z = float(zooms[2]) if len(zooms) > 2 and zooms[2] > 0 else None

        # img.affine can be unreliable on some NIfTI files: confirmed live
        # (2026-10, against real uploaded patient data, not just one test
        # set) that files with sform_code set but carrying a plain unit-
        # scale sform matrix, and qform_code unused, make nibabel report
        # affine spacing of (1,1,1) regardless of the file's real spacing --
        # while header.get_zooms() (pixdim) still has the correct values,
        # which is exactly what `zooms` above already is. Every downstream
        # volume computation (compute_heart_metrics_from_rle.py's EDV/ESV/
        # LV mass, and everything indexed from them) reads voxel size from
        # THIS affineMatrix, not from voxelsize below -- so a silently wrong
        # affine here corrupted every absolute/indexed volume for the
        # affected project (confirmed: several real pilot projects came out
        # with EDVI/LVMI 20-100x too small, traced to exactly this). Detect
        # the mismatch and rebuild the affine's scale from the trustworthy
        # zooms, keeping whatever orientation (direction/sign) the original
        # affine still encodes correctly.
        affine = np.array(img.affine, dtype=np.float64)
        affine_spacing = np.sqrt((affine[:3, :3] ** 2).sum(axis=0))
        zoom_spacing = np.array([voxel_x, voxel_y, voxel_z if voxel_z is not None else 1.0])
        if not np.allclose(affine_spacing, zoom_spacing, rtol=0.01, atol=0.01):
            corrected = affine.copy()
            for i in range(3):
                col_norm = affine_spacing[i]
                direction = affine[:3, i] / col_norm if col_norm > 1e-6 else np.eye(3)[:, i]
                corrected[:3, i] = direction * zoom_spacing[i]
            affine = corrected

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
                "x": voxel_x,
                # Default to 1.0mm for missing spatial dimensions
                "y": voxel_y,
                # None for missing z dimension
                "z": voxel_z,
                # None for missing temporal dimension
                "t": float(zooms[3]) if len(zooms) > 3 and zooms[3] > 0 else None
            },
            # Convert numpy array to nested list for JSON serialization
            "affineMatrix": affine.tolist()
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
