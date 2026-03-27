#!/usr/bin/env python3
"""
Batch extract temporal frames from 4D NIfTI files in a folder.

This script processes all NIfTI files in a folder and extracts each temporal frame
from 4D data (along the 4th dimension), saving them as separate 3D files with 
frame numbering to an output folder.

# Extract ALL temporal frames from all files (default behavior)
python batch_extract_frames.py input_folder output_folder

# Extract only the first temporal frame from all files
python batch_extract_frames.py input_folder output_folder --frames 0

# Extract specific temporal frames (0, 2, 3) from all files  
python batch_extract_frames.py input_folder output_folder --frames 0 2 3
"""


import argparse
import sys
import os
import glob
from pathlib import Path
import nibabel as nib
import numpy as np


def find_nifti_files(folder_path):
    """Find all NIfTI files in a folder."""
    nifti_patterns = ['*.nii', '*.nii.gz']
    files = []
    for pattern in nifti_patterns:
        files.extend(glob.glob(os.path.join(folder_path, pattern)))
    return sorted(files)


def extract_temporal_frames(input_path, output_folder, frame_indices=None):
    """
    Extract temporal frames from a 4D NIfTI file.

    Args:
        input_path (str): Path to input NIfTI file
        output_folder (str): Output folder path
        frame_indices (list or None): List of frame indices to extract. If None, extracts all frames.

    Returns:
        list: Paths to the output files
    """
    try:
        # Load the NIfTI file
        print(f"Processing {os.path.basename(input_path)}...")
        img = nib.load(input_path)
        data = img.get_fdata()

        print(f"  Input shape: {data.shape}")

        # Handle different dimensionalities
        if len(data.shape) == 3:
            print("  Input is 3D - treating as single frame")
            total_frames = 1
            if frame_indices is None:
                frames_to_extract = [0]
            else:
                frames_to_extract = [f for f in frame_indices if f == 0]
                if not frames_to_extract:
                    print(
                        "  Warning: No valid frame indices for 3D data (only frame 0 exists)")
                    return []
        elif len(data.shape) == 4:
            total_frames = data.shape[3]  # 4th dimension is time/frames
            if frame_indices is None:
                frames_to_extract = list(
                    range(total_frames))  # Extract all frames
            else:
                # Validate frame indices
                frames_to_extract = [
                    f for f in frame_indices if 0 <= f < total_frames]
                if len(frames_to_extract) != len(frame_indices):
                    invalid_frames = [
                        f for f in frame_indices if f < 0 or f >= total_frames]
                    print(
                        f"  Warning: Invalid frame indices {invalid_frames} (available: 0-{total_frames-1})")
        else:
            raise ValueError(
                f"Unsupported number of dimensions: {len(data.shape)}. Expected 3D or 4D.")

        print(f"  Total temporal frames: {total_frames}")
        print(f"  Extracting frames: {frames_to_extract}")

        # Create base output filename
        base_name = Path(input_path).stem
        if base_name.endswith('.nii'):
            base_name = base_name[:-4]

        output_files = []

        # Extract each requested temporal frame
        for frame_idx in frames_to_extract:
            if len(data.shape) == 3:
                # For 3D data, just copy the whole volume
                frame_data = data
            else:
                # For 4D data, extract the specific temporal frame
                frame_data = data[:, :, :, frame_idx]

            # Create output filename
            output_filename = f"{base_name}_frame_{frame_idx}.nii.gz"
            output_path = os.path.join(output_folder, output_filename)

            # Create new 3D NIfTI image
            new_header = img.header.copy()
            if len(data.shape) == 4:
                # Update header dimensions for 3D output
                new_header['dim'][0] = 3  # Number of dimensions
                new_header['dim'][4] = 1  # Remove time dimension
                # Reset time-related fields
                new_header['pixdim'][4] = 0.0

            frame_img = nib.Nifti1Image(
                frame_data.astype(data.dtype),
                img.affine,
                new_header
            )

            # Save the frame
            nib.save(frame_img, output_path)
            output_files.append(output_path)
            print(f"    Saved temporal frame {frame_idx} -> {output_filename}")

        return output_files

    except Exception as e:
        print(f"  Error processing {input_path}: {str(e)}")
        return []


def main():
    parser = argparse.ArgumentParser(
        description="Batch extract temporal frames from NIfTI files in a folder",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Extract all temporal frames from all 4D NIfTI files in folder
  python batch_extract_frames.py input_folder output_folder

  # Extract only first frame (frame 0) from all files
  python batch_extract_frames.py input_folder output_folder --frames 0

  # Extract specific temporal frames (0, 2, 3) from all files
  python batch_extract_frames.py input_folder output_folder --frames 0 2 3

Note: For a 4D NIfTI with shape (64, 64, 20, 4):
- 64x64 is the spatial resolution
- 20 is the number of slices
- 4 is the number of temporal frames
This script will create 4 separate 3D files (64, 64, 20) named:
original_nifti_frame_0.nii.gz through original_nifti_frame_3.nii.gz
        """
    )

    parser.add_argument('input_folder',
                        help='Input folder containing NIfTI files')
    parser.add_argument('output_folder',
                        help='Output folder for extracted temporal frames')

    parser.add_argument('--frames', type=int, nargs='+',
                        help='Specific temporal frame indices to extract (default: extract all frames)')

    args = parser.parse_args()

    # Check if nibabel is available
    try:
        import nibabel as nib
    except ImportError:
        print("Error: nibabel is required but not installed.")
        print("Install with: pip install nibabel")
        sys.exit(1)

    # Validate input folder
    if not os.path.isdir(args.input_folder):
        print(f"Error: Input folder '{args.input_folder}' does not exist.")
        sys.exit(1)

    # Create output folder if it doesn't exist
    os.makedirs(args.output_folder, exist_ok=True)
    print(f"Output folder: {args.output_folder}")

    # Find NIfTI files
    nifti_files = find_nifti_files(args.input_folder)

    if not nifti_files:
        print(f"No NIfTI files found in '{args.input_folder}'")
        sys.exit(1)

    print(f"Found {len(nifti_files)} NIfTI files:")
    for f in nifti_files:
        print(f"  {os.path.basename(f)}")
    print()

    # Determine frames to extract
    if args.frames:
        frame_indices = args.frames
        print(f"Mode: Extract specific temporal frames {frame_indices}")
    else:
        frame_indices = None  # Extract all frames
        print("Mode: Extract all temporal frames")

    print()

    # Process each file
    total_output_files = 0
    for input_file in nifti_files:
        output_files = extract_temporal_frames(
            input_file, args.output_folder, frame_indices)
        total_output_files += len(output_files)
        print()

    print(
        f"Processing complete! Generated {total_output_files} output files in '{args.output_folder}'")


if __name__ == "__main__":
    main()
