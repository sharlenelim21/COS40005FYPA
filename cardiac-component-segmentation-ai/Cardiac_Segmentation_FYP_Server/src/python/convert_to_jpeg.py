import sys
import os
import nibabel as nib
import matplotlib.image as mpimg  # Using direct image module instead of plt
import pydicom
import tarfile  # Using tarfile module instead of subprocess
import numpy as np

def normalize_image(img_data):
    """Normalize image data to 0-255 range for better JPEG quality"""
    min_val = np.min(img_data)
    max_val = np.max(img_data)
    if max_val > min_val:
        return ((img_data - min_val) / (max_val - min_val) * 255).astype(np.uint8)
    return img_data

def convert_nifti_to_jpeg(input_file, output_dir, user_id, file_hash):
    try:
        img = nib.load(input_file)
        data = img.get_fdata()
        os.makedirs(output_dir, exist_ok=True)
        total_slices = data.shape[2]
        total_frames = data.shape[3] if len(data.shape) == 4 else 0

        print(f"Processing NIfTI file: {input_file} with {total_slices} slices and {total_frames} frames.")

        if len(data.shape) == 4:
            for frame_idx in range(data.shape[3]):
                for slice_idx in range(data.shape[2]):
                    output_path = os.path.join(output_dir, f"{user_id}_{file_hash}_{frame_idx}_{slice_idx}.jpg")
                    slice_data = normalize_image(data[:, :, slice_idx, frame_idx])
                    mpimg.imsave(output_path, slice_data, cmap='gray')
                print(f"Converted all {total_slices} slices for frame {frame_idx}.")
        else:
            for slice_idx in range(data.shape[2]):
                output_path = os.path.join(output_dir, f"{user_id}_{file_hash}_0_{slice_idx}.jpg")
                slice_data = normalize_image(data[:, :, slice_idx])
                mpimg.imsave(output_path, slice_data, cmap='gray')
            print(f"Converted all {total_slices} slices (no frames).")
        print(f"Successfully converted NIfTI file: {input_file} to JPEGs in {output_dir}")
    except Exception as e:
        print(f"Error converting NIfTI file {input_file}: {e}", file=sys.stderr)
        sys.exit(1)

def convert_dicom_to_jpeg(input_file, output_dir, user_id, file_hash):
    try:
        ds = pydicom.dcmread(input_file)
        pixel_array = ds.pixel_array
        os.makedirs(output_dir, exist_ok=True)
        num_frames = pixel_array.shape[0] if len(pixel_array.shape) == 3 else 1

        print(f"Processing DICOM file: {input_file} with {num_frames} frames.")

        if len(pixel_array.shape) == 3:
            for frame_idx in range(pixel_array.shape[0]):
                slice_idx = frame_idx
                output_path = os.path.join(output_dir, f"{user_id}_{file_hash}_{frame_idx}_{slice_idx}.jpg")
                frame_data = normalize_image(pixel_array[frame_idx])
                mpimg.imsave(output_path, frame_data, cmap='gray')
            print(f"Converted all {num_frames} frames to JPEGs.")
        else:
            output_path = os.path.join(output_dir, f"{user_id}_{file_hash}_0_0.jpg")
            image_data = normalize_image(pixel_array)
            mpimg.imsave(output_path, image_data, cmap='gray')
            print("Converted single-frame DICOM to JPEG.")
        print(f"Successfully converted DICOM file: {input_file} to JPEGs in {output_dir}")
    except Exception as e:
        print(f"Error converting DICOM file {input_file}: {e}", file=sys.stderr)
        sys.exit(1)

def bundle_to_tar(output_dir, tar_file):
    """Create a tar archive using Python's tarfile module instead of subprocess"""
    try:
        with tarfile.open(tar_file, 'w') as tar:
            # Add each file in the output directory to the tar
            for filename in os.listdir(output_dir):
                file_path = os.path.join(output_dir, filename)
                if os.path.isfile(file_path) and filename.endswith('.jpg'):  # Only add JPEG files
                    # Use arcname to avoid including the full path in the archive
                    tar.add(file_path, arcname=filename)
        
        # Ensure file is fully written to disk before announcing completion
        try:
            with open(tar_file, 'rb') as f:
                os.fsync(f.fileno())
        except:
            pass  # Fallback if fsync fails
            
        print(f"Bundled files into {tar_file}")
        print(f"TAR_FILE_PATH:{os.path.abspath(tar_file)}")
    except Exception as e:
        print(f"Error creating tarball {tar_file}: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 6:
        print("Usage: python convert_to_jpeg.py input_file output_dir tar_file user_id file_hash", file=sys.stderr)
        sys.exit(1)
        
    input_file = sys.argv[1]
    output_dir = sys.argv[2]
    tar_file = sys.argv[3]  # Path to the output .tar file
    user_id = sys.argv[4]   # User ID
    file_hash = sys.argv[5] # Project ID

    print(f"Starting conversion of {input_file} for user {user_id}, project {file_hash}.")

    if input_file.endswith((".nii", ".nii.gz")):
        convert_nifti_to_jpeg(input_file, output_dir, user_id, file_hash)
    elif input_file.endswith(".dcm"):
        convert_dicom_to_jpeg(input_file, output_dir, user_id, file_hash)
    else:
        print("Unsupported file type.", file=sys.stderr)
        sys.exit(1)

    # Bundle the converted files into a .tar file
    tar_file_base = f"{user_id}_{file_hash}_jpegs.tar"
    
    # Create TAR file in parent directory, not inside output_dir
    parent_dir = os.path.dirname(output_dir)
    tar_file_path = os.path.join(parent_dir, tar_file_base)
    
    bundle_to_tar(output_dir, tar_file_path)
    print(f"Files converted and bundled into {tar_file_path}")