// Command to run the script:
// npx ts-node src/tests/test_nifti_extract.ts

import path from 'path';
import { extractNiftiMetadata } from '../utils/nifti_parser';

async function test() {
  // Update with a real local path to your .nii or .nii.gz file
  const samplePath = path.resolve("C:\\Users\\Clarissa\\OneDrive - Swinburne University Of Technology Sarawak Campus\\Pictures\\testing\\patient005_4d.nii.gz");

  try {
    const metadata = await extractNiftiMetadata(samplePath);
    console.log('Metadata extracted successfully:\n', metadata);
  } catch (error) {
    console.error('Failed to extract metadata:', error);
  }
}

test();