// File: src/utils/nifti_parser.ts
// Description: Utility function to extract metadata from NIfTI files using a Python script. This is useful for handling medical imaging data in the NIfTI format.

import { execFile } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import LogError from './error_logger';

const serviceLocation = "NIfTI Parser";

const execFileAsync = promisify(execFile);

// Path to the Python script that extracts metadata.
// NOTE: deliberately '..', '..', 'src', 'python' (matching every other caller
// in this codebase, e.g. segmentation_routes.ts's create_nifti_* calls), NOT
// '..', 'python'. At runtime __dirname is dist/utils, so '..', 'python' would
// resolve to dist/python -- a copy baked into the Docker image at build time,
// NOT the src/python bind mount docker-compose.yml maps into the container.
// Confirmed live (2026-10): dist/python/extract_metadata.py still had the old
// unit-scale-affine bug long after src/python/extract_metadata.py was fixed,
// because this one path silently pointed at the stale baked-in copy instead
// of the live-edited source -- every fix to this script was a no-op for real
// uploads until this path itself was corrected.
const PYTHON_SCRIPT = path.join(__dirname, '..', '..', 'src', 'python', 'extract_metadata.py');

/**
 * Interface describing the structure of metadata extracted from a NIfTI file.
 */
export interface INiftiMetadata {
    datatype: string; // Data type of the image (e.g., float32, int16, etc.)
    dimensions: {
        width: number | null;   // Number of pixels in the x-direction
        height: number | null;  // Number of pixels in the y-direction
        slices: number | null;  // Number of slices in the z-direction (depth)
        frames: number | null;  // Number of time frames (for 4D imaging data)
    };
    voxelsize: {
        x: number | null; // Voxel size in the x-direction (mm)
        y: number | null; // Voxel size in the y-direction (mm)
        z: number | null; // Voxel size in the z-direction (mm)
        t: number | null; // Time resolution, if applicable (e.g., seconds per frame)
    };
    affineMatrix: number[][]; // 4x4 affine transformation matrix from NIfTI header
}

/**
 * Calls a Python script to extract metadata from a NIfTI file.
 * This method uses Node's `child_process` to execute a Python script and parse the JSON output.
 *
 * @param niftiPath - The local or temporary file path to the NIfTI (.nii or .nii.gz) file.
 * @returns A Promise resolving to an object of type `INiftiMetadata`, containing image dimensions and voxel size.
 */
export async function extractNiftiMetadata(niftiPath: string): Promise<INiftiMetadata> {
    try {
        // Execute the Python script with the given NIfTI path
        const { stdout } = await execFileAsync('python3', [PYTHON_SCRIPT, niftiPath]);
        // Parse and return the metadata JSON output from the Python script
        const parsed: INiftiMetadata = JSON.parse(stdout);
        return parsed;
  
    } catch (error: unknown) {
        // Log an error if metadata extraction fails
        LogError(error as Error, serviceLocation, "Error extracting metadata from NIfTI file");
  
        // Return a fallback object with default values to ensure robustness
        return {
            datatype: 'unknown',
            dimensions: {
            width: null,
            height: null,
            slices: null,
            frames: null,
            },
            voxelsize: {
            x: null,
            y: null,
            z: null,
            t: null,
            },
            affineMatrix: [], // Empty array as fallback for affine matrix
        };
    }
  }