import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import logger from './logger';

const execAsync = promisify(exec);

interface MeshConversionResult {
  success: boolean;
  objFilePath?: string;
  objContent?: string;
  error?: string;
  stats?: {
    inputSize: number;
    outputSize: number;
    processingTime: number;
  };
}

/**
 * Ensure temp_mesh directory exists
 */
const ensureTempMeshDirExists = (): string => {
  const tempMeshDir = path.join(__dirname, '..', 'temp_mesh');
  if (!fs.existsSync(tempMeshDir)) {
    fs.mkdirSync(tempMeshDir, { recursive: true });
    logger.info(`MeshProcessor: Created temp_mesh directory at: ${tempMeshDir}`);
  }
  return tempMeshDir;
};

/**
 * Create a temporary directory for the job
 */
const createJobTempDir = (jobId: string): string => {
  const tempMeshDir = ensureTempMeshDirExists();
  const jobTempDir = path.join(tempMeshDir, jobId);
  
  if (!fs.existsSync(jobTempDir)) {
    fs.mkdirSync(jobTempDir, { recursive: true });
    logger.info(`MeshProcessor: Created job temp directory: ${jobTempDir}`);
  }
  
  return jobTempDir;
};

/**
 * Clean up temporary directory and all its contents
 */
const cleanupTempDir = async (tempDir: string, jobId: string): Promise<void> => {
  try {
    if (fs.existsSync(tempDir)) {
      // Remove all files in the directory
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        fs.unlinkSync(filePath);
        logger.debug(`MeshProcessor: Deleted temp file: ${filePath}`);
      }
      
      // Remove the directory
      fs.rmdirSync(tempDir);
      logger.info(`MeshProcessor: Cleaned up temp directory for job ${jobId}: ${tempDir}`);
    }
  } catch (error) {
    logger.warn(`MeshProcessor: Failed to cleanup temp directory ${tempDir} for job ${jobId}:`, error);
  }
};

/**
 * Convert Base64 NPZ mesh data to OBJ format using temporary file processing
 * 
 * @param base64NpzData - Base64 encoded NPZ mesh data from GPU server
 * @param jobId - Job ID for temporary directory organization
 * @param userId - User ID for filename generation (optional, uses jobId if not provided)
 * @param filehash - Project file hash for filename generation (optional, uses jobId if not provided)
 * @param frameIndex - Frame index for filename generation (optional, defaults to 0)
 * @returns Promise<MeshConversionResult>
 */
export const convertNpzToObjTempFile = async (
  base64NpzData: string,
  jobId: string,
  userId?: string,
  filehash?: string,
  frameIndex: number = 0
): Promise<MeshConversionResult> => {
  const startTime = Date.now();
  const serviceLocation = "MeshProcessor";
  
  // Create job-specific temp directory
  let jobTempDir: string = '';
  let npzFilePath: string = '';
  let objFilePath: string = '';
  
  try {
    // Validate input
    if (!base64NpzData || typeof base64NpzData !== 'string') {
      return {
        success: false,
        error: 'Invalid Base64 NPZ data provided'
      };
    }

    const inputSize = base64NpzData.length;
    logger.info(`${serviceLocation}: Converting NPZ to OBJ for job ${jobId}. Input size: ${inputSize} chars`);

    // Setup temporary directory and file paths
    jobTempDir = createJobTempDir(jobId);
    
    // Generate filenames using userId_filehash_frame format if available, otherwise fallback to jobId
    let npzFilename: string;
    let objFilename: string;
    
    if (userId && filehash) {
      npzFilename = `${userId}_${filehash}_${frameIndex}.npz`;
      objFilename = `${userId}_${filehash}_${frameIndex}.obj`;
      logger.info(`${serviceLocation}: Using structured filename for job ${jobId}: ${objFilename}`);
    } else {
      npzFilename = `${jobId}_mesh.npz`;
      objFilename = `${jobId}_mesh.obj`;
      logger.warn(`${serviceLocation}: Missing userId or filehash for job ${jobId}, using fallback filename: ${objFilename}`);
    }
    
    npzFilePath = path.join(jobTempDir, npzFilename);
    objFilePath = path.join(jobTempDir, objFilename);

    // 1. Decode Base64 and write NPZ file
    try {
      const npzBuffer = Buffer.from(base64NpzData, 'base64');
      fs.writeFileSync(npzFilePath, npzBuffer);
      logger.info(`${serviceLocation}: Wrote NPZ file for job ${jobId}: ${npzFilePath} (${npzBuffer.length} bytes)`);
    } catch (error) {
      await cleanupTempDir(jobTempDir, jobId);
      return {
        success: false,
        error: `Failed to decode Base64 or write NPZ file: ${error}`
      };
    }

    // 2. Convert NPZ to OBJ using Python script
    const pythonScript = path.join(__dirname, '../python/convert_npz_to_obj.py');
    
    // Verify Python script exists
    if (!fs.existsSync(pythonScript)) {
      await cleanupTempDir(jobTempDir, jobId);
      return {
        success: false,
        error: `Python conversion script not found at ${pythonScript}`
      };
    }

    try {
      const command = `python "${pythonScript}" "${npzFilePath}" "${objFilePath}" --verbose`;
      logger.info(`${serviceLocation}: Executing Python conversion for job ${jobId}: ${command}`);
      
      const { stdout, stderr } = await execAsync(command, {
        cwd: path.dirname(pythonScript),
        timeout: 60000 // 60 second timeout
      });
      
      // Log Python script output
      if (stderr) {
        logger.info(`${serviceLocation}: Python script output for job ${jobId}: ${stderr}`);
      }
      if (stdout) {
        logger.debug(`${serviceLocation}: Python script stdout for job ${jobId}: ${stdout}`);
      }
      
    } catch (execError: any) {
      await cleanupTempDir(jobTempDir, jobId);
      return {
        success: false,
        error: `Python conversion failed: ${execError.message}\nStderr: ${execError.stderr}\nStdout: ${execError.stdout}`
      };
    }

    // 3. Verify OBJ file was created and read its content
    if (!fs.existsSync(objFilePath)) {
      await cleanupTempDir(jobTempDir, jobId);
      return {
        success: false,
        error: `OBJ file was not created at expected path: ${objFilePath}`
      };
    }

    let objContent: string;
    let outputSize: number;
    
    try {
      objContent = fs.readFileSync(objFilePath, 'utf-8');
      outputSize = objContent.length;
      
      if (outputSize === 0) {
        await cleanupTempDir(jobTempDir, jobId);
        return {
          success: false,
          error: `Generated OBJ file is empty`
        };
      }
      
    } catch (readError) {
      await cleanupTempDir(jobTempDir, jobId);
      return {
        success: false,
        error: `Failed to read generated OBJ file: ${readError}`
      };
    }

    const processingTime = Date.now() - startTime;
    logger.info(`${serviceLocation}: Successfully converted NPZ to OBJ for job ${jobId}. Processing time: ${processingTime}ms, Input: ${inputSize} chars, Output: ${outputSize} chars`);

    return {
      success: true,
      objFilePath,
      objContent,
      stats: {
        inputSize,
        outputSize,
        processingTime
      }
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error(`${serviceLocation}: Unexpected error during NPZ conversion for job ${jobId}:`, error);
    
    // Attempt cleanup even on unexpected error
    if (jobTempDir) {
      await cleanupTempDir(jobTempDir, jobId);
    }
    
    return {
      success: false,
      error: `Unexpected error: ${error}`,
      stats: {
        inputSize: base64NpzData?.length || 0,
        outputSize: 0,
        processingTime
      }
    };
  }
};

/**
 * Clean up temporary files after successful processing
 * Call this after OBJ file is uploaded to S3 or processed
 */
export const cleanupMeshTempFiles = async (jobId: string): Promise<void> => {
  const jobTempDir = path.join(__dirname, '..', 'temp_mesh', jobId);
  await cleanupTempDir(jobTempDir, jobId);
};