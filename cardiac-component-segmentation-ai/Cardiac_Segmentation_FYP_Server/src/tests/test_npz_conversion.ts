import { convertNpzToObjTempFile, cleanupMeshTempFiles } from '../services/mesh_processor';
import { v4 as uuidv4 } from 'uuid';
import logger from '../services/logger';

/**
 * Test NPZ to OBJ conversion using real webhook data
 * Run this with: npx ts-node src/tests/test_npz_conversion.ts
 */
async function testNPZConversion() {
  console.log('🧪 Testing NPZ to OBJ Conversion...\n');
  
  // Real mesh data from Svix webhook payload
  const testMeshData = "UEsDBBQAAAAIAAAAIAAAACrcIQAL6QIAAJgHAAAJAAAAdmVydGljZXMubnB5jVRtb9MwEH6Xf4EFagqy3SQmH8raBhgaGlNg"; // truncated for display
  
  // Test parameters
  const testJobId = uuidv4();
  const testUserId = "66f5a0123456789abcdef012"; // Example user ID
  const testFilehash = "a1b2c3d4e5f6789012345678901234567890abcd"; // Example file hash
  const testFrameIndex = 0;
  
  console.log(`Test Job ID: ${testJobId}`);
  console.log(`Test File Pattern: ${testUserId}_${testFilehash}_${testFrameIndex}.obj\n`);
  
  try {
    const startTime = Date.now();
    
    // Test the conversion
    const result = await convertNpzToObjTempFile(
      testMeshData,
      testJobId,
      testUserId,
      testFilehash, 
      testFrameIndex
    );
    
    const endTime = Date.now();
    
    console.log('Conversion Results:');
    console.log(`Success: ${result.success}`);
    console.log(`Processing Time: ${endTime - startTime}ms`);
    
    if (result.success) {
      console.log(`NPZ → OBJ conversion successful!`);
      console.log(`OBJ File Path: ${result.objFilePath}`);
      console.log(`OBJ Content Length: ${result.objContent?.length} characters`);
      console.log(`Input Size: ${result.stats?.inputSize} chars`);
      console.log(`Output Size: ${result.stats?.outputSize} chars`);
      
      // Show first few lines of OBJ content
      if (result.objContent) {
        const lines = result.objContent.split('\n').slice(0, 10);
        console.log('\nFirst 10 lines of OBJ file:');
        lines.forEach((line, i) => console.log(`${i + 1}: ${line}`));
      }
      
      // Clean up test files
      console.log('\nCleaning up test files...');
      await cleanupMeshTempFiles(testJobId);
      console.log('Cleanup complete!');
      
    } else {
      console.log(`NPZ → OBJ conversion failed:`);
      console.log(`Error: ${result.error}`);
    }
    
  } catch (error) {
    console.log(`Test failed with error:`);
    console.error(error);
    
    // Attempt cleanup even on error
    try {
      await cleanupMeshTempFiles(testJobId);
    } catch (cleanupError) {
      console.log('Cleanup also failed:', cleanupError);
    }
  }
}