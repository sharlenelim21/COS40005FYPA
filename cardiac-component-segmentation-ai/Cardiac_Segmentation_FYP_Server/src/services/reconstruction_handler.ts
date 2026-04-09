// File: src/services/reconstruction_handler.ts
// Description: Handles 4D cardiac reconstruction processing, TAR creation, and S3 uploads

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import mongoose from "mongoose";
import logger from "./logger";
import { uploadToS3 } from "./s3_handler";
import {
  updateJob,
  createProjectReconstruction,
  readProject,
} from "./database";
import {
  JobStatus,
  IProjectReconstruction,
  MeshFormat,
} from "../types/database_types";
import LogError from "../utils/error_logger";

/**
 * Database transaction wrapper for atomic operations
 */
const withTransaction = async <T>(
  operation: (session: mongoose.ClientSession) => Promise<T>,
  operationName: string
): Promise<T> => {
  const session = await mongoose.startSession();
  
  try {
    let result: T;
    
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    
    logger.info(`${serviceLocation}: Database transaction completed successfully: ${operationName}`);
    return result!;
  } catch (error) {
    logger.error(`${serviceLocation}: Database transaction failed: ${operationName}`, error);
    throw error;
  } finally {
    await session.endSession();
  }
};

const serviceLocation = "ReconstructionHandler";

type ArtifactType = "mesh" | "point_cloud";

export interface ProcessedArtifactFile {
  filename: string;
  originalName: string;
  tempPath: string;
  size: number;
  frameIndex?: number;
  artifactType: ArtifactType;
}

export interface ReconstructionCallbackResult {
  success: boolean;
  message: string;
  reconstructionId?: string;
  error?: string;
}

/**
 * Processes 4D reconstruction callback from GPU server
 * Handles OBJ file validation, TAR creation, S3 upload, and database record creation
 * 
 * @param gpuJobId - GPU job identifier for tracking
 * @param uploadedFiles - Array of OBJ mesh files from GPU processing
 * @param callbackMetadata - GPU result metadata including status and processing info
 * @returns Promise with reconstruction result including success status and reconstruction ID
 */
export async function processReconstructionCallback(
  gpuJobId: string,
  meshFiles: Express.Multer.File[],
  pointCloudFiles: Express.Multer.File[],
  callbackMetadata: any
): Promise<ReconstructionCallbackResult> {
  try {
    // Check for duplicate callback processing
    const { readJob } = await import("./database");
    const existingJob = await readJob(gpuJobId);
    if (existingJob.success && existingJob.job?.status === JobStatus.COMPLETED) {
      logger.warn(`${serviceLocation}: Duplicate callback detected for completed job ${gpuJobId}`);
      return {
        success: false,
        message: "Job already completed, ignoring duplicate callback"
      };
    }

    // Extract GPU metadata and validate status
    const safeMeshFiles = meshFiles || [];
    const safePointCloudFiles = pointCloudFiles || [];
    const safeUploadedFiles = [...safeMeshFiles, ...safePointCloudFiles];
    const { status, result: gpuResult, error: gpuErrorDetail } = callbackMetadata;
    
    logger.info(`${serviceLocation}: Processing reconstruction callback - Job: ${gpuJobId}, Files: ${safeUploadedFiles.length}, Status: ${status}`);

    if (status !== "completed" && status !== "success" && status !== "reconstruction_completed") {
      logger.warn(`${serviceLocation}: GPU job ${gpuJobId} failed with status: ${status}`);
      
      // Update job status to failed
      await updateJob(gpuJobId, {
        status: JobStatus.FAILED,
        message: `GPU reconstruction failed: ${gpuErrorDetail || status}`
      });

      return {
        success: false,
        message: `GPU job completed with status: ${status}`,
        error: String(gpuErrorDetail || 'Unknown GPU error')
      };
    }

    // Validate GPU metadata and uploaded files
    const validationTarget = gpuResult || callbackMetadata;
    const metadataValidation = validateMetadata(validationTarget, gpuJobId);
    if (!metadataValidation.success) {
      logger.error(`${serviceLocation}: Metadata validation failed: ${metadataValidation.message}`);
      
      // Update job status to failed
      await updateJob(gpuJobId, {
        status: JobStatus.FAILED,
        message: `Metadata validation failed: ${metadataValidation.message}`
      });
      
      return metadataValidation;
    }

    const validationResult = validateArtifactFiles(safeMeshFiles, safePointCloudFiles, gpuJobId);
    if (!validationResult.success) {
      logger.error(`${serviceLocation}: File validation failed: ${validationResult.message}`);
      
      // Update job status to failed
      await updateJob(gpuJobId, {
        status: JobStatus.FAILED,
        message: `File validation failed: ${validationResult.message}`
      });
      
      // Cleanup any uploaded files even on validation failure
      if (safeUploadedFiles.length > 0) {
        try {
          const processedFiles = await processArtifactFiles(safeUploadedFiles, gpuJobId);
          await cleanupTempFiles(processedFiles, '');
        } catch (cleanupError) {
          logger.warn(`${serviceLocation}: Failed to cleanup files after validation failure: ${(cleanupError as Error).message}`);
        }
      }
      
      return validationResult;
    }

    // Process OBJ mesh files and extract project information
    const processedFiles = await processArtifactFiles(safeUploadedFiles, gpuJobId);
    const processedMeshFiles = processedFiles.filter(file => file.artifactType === "mesh");
    const { userId, filehash, projectId, maskId } = await getProjectDetails(gpuJobId);
    
    // Create TAR archive containing all mesh frames
    const tarResult = await createReconstructionTar(processedFiles, userId, filehash, gpuJobId);
    if (!tarResult.success) {
      // Update job status to failed
      await updateJob(gpuJobId, {
        status: JobStatus.FAILED,
        message: `TAR creation failed: ${tarResult.message}`
      });
      
      // Cleanup processed files even on TAR creation failure
      await cleanupTempFiles(processedFiles, '');
      
      return tarResult;
    }

    // Upload TAR to S3 using same structure as project files
    let reconstructionFileS3Url: string;
    let tarStream: fsSync.ReadStream | null = null;
    try {
      tarStream = fsSync.createReadStream(tarResult.tarPath!);
      const s3KeyPrefix = `source_nifti/${userId}/`;  // Same as project files
      
      // Add error handler to stream
      tarStream.on('error', (streamError) => {
        logger.error(`${serviceLocation}: Stream error during S3 upload: ${streamError.message}`);
      });
      
      reconstructionFileS3Url = await uploadToS3(
        tarStream,
        userId,
        filehash,
        '_mesh.tar',
        s3KeyPrefix
      );
      
      logger.info(`${serviceLocation}: Uploaded reconstruction TAR to S3`);
    } catch (error) {
      logger.error(`${serviceLocation}: S3 upload failed: ${(error as Error).message}`);
      
      // Update job status to failed
      await updateJob(gpuJobId, {
        status: JobStatus.FAILED,
        message: `S3 upload failed: ${(error as Error).message}`
      });
      
      // Ensure stream is properly closed
      if (tarStream && !tarStream.destroyed) {
        tarStream.destroy();
      }
      
      // Clean up temporary files and TAR file on S3 upload failure
      await cleanupTempFiles(processedFiles, tarResult.tarPath!);
      
      return {
        success: false,
        message: `S3 upload failed: ${(error as Error).message}`
      };
    } finally {
      // Ensure stream is always closed
      if (tarStream && !tarStream.destroyed) {
        tarStream.destroy();
      }
    }

    // Create database reconstruction record with atomic transaction
    let dbResult: { success: boolean; message: string; reconstructionId?: string } = { success: false, message: "" };
    
    try {
      // Perform all database operations in a single atomic transaction
      dbResult = await withTransaction(async (session) => {
        // 1. Update job to IN_PROGRESS to prevent duplicate processing
        const jobUpdateResult = await updateJob(gpuJobId, {
          status: JobStatus.IN_PROGRESS,
          message: "Creating reconstruction record"
        });
        
        if (!jobUpdateResult.success) {
          throw new Error(`Failed to update job status: ${jobUpdateResult.message}`);
        }
        
        // 2. Create reconstruction record
        const reconstructionResult = await createReconstructionRecord(
          gpuJobId,
          projectId,
          userId,
          filehash,
          gpuResult,
          processedMeshFiles,
          tarResult.tarSize!,
          reconstructionFileS3Url,
          maskId
        );
        
        if (!reconstructionResult.success) {
          throw new Error(`Failed to create reconstruction record: ${reconstructionResult.message}`);
        }
        
        // 3. Update job status to completed
        const completionResult = await updateJob(gpuJobId, {
          status: JobStatus.COMPLETED,
          result: JSON.stringify({
            reconstruction_created: true,
            reconstruction_id: reconstructionResult.reconstructionId,
            tar_file_path: tarResult.tarPath,
            s3_url: reconstructionFileS3Url
          }),
          message: "4D reconstruction processed successfully"
        });
        
        if (!completionResult.success) {
          throw new Error(`Failed to update job completion: ${completionResult.message}`);
        }
        
        return reconstructionResult;
      }, `Reconstruction creation for job ${gpuJobId}`);
      
    } catch (transactionError) {
      logger.error(`${serviceLocation}: Atomic transaction failed for job ${gpuJobId}: ${(transactionError as Error).message}`);
      
      // Rollback S3 upload since database transaction failed
      try {
        const { deleteFromS3 } = await import("./s3_handler");
        const s3Key = reconstructionFileS3Url.split('/').slice(-1)[0]; // Extract key from URL
        await deleteFromS3(s3Key);
        logger.info(`${serviceLocation}: Successfully rolled back S3 upload after transaction failure`);
      } catch (rollbackError) {
        logger.error(`${serviceLocation}: Failed to rollback S3 upload: ${(rollbackError as Error).message}`);
      }
      
      // Mark job as failed
      try {
        await updateJob(gpuJobId, {
          status: JobStatus.FAILED,
          message: `Transaction failed: ${(transactionError as Error).message}`
        });
      } catch (jobUpdateError) {
        logger.error(`${serviceLocation}: Failed to mark job as failed: ${(jobUpdateError as Error).message}`);
      }
      
      // Cleanup temporary files even on database transaction failure
      await cleanupTempFiles(processedFiles, tarResult.tarPath!);
      
      return {
        success: false,
        message: `Database transaction failed: ${(transactionError as Error).message}`
      };
    }

    // Cleanup temporary files
    await cleanupTempFiles(processedFiles, tarResult.tarPath!);

    logger.info(`${serviceLocation}: Reconstruction completed successfully - Job: ${gpuJobId}, ID: ${dbResult.reconstructionId}`);
    return {
      success: true,
      message: "4D reconstruction processed successfully",
      reconstructionId: dbResult.reconstructionId
    };

  } catch (error) {
    // Update job status to failed on unexpected error
    try {
      await updateJob(gpuJobId, {
        status: JobStatus.FAILED,
        message: `Unexpected error processing reconstruction callback: ${(error as Error).message}`
      });
    } catch (updateError) {
      logger.error(`${serviceLocation}: Failed to update job status after error for job ${gpuJobId}:`, updateError);
    }

    // Cleanup any temporary files that may have been created
    try {
      const safeFiles = [...(meshFiles || []), ...(pointCloudFiles || [])];
      if (safeFiles.length > 0) {
        const processedFiles = await processArtifactFiles(safeFiles, gpuJobId);
        await cleanupTempFiles(processedFiles, '');
      }
    } catch (cleanupError) {
      logger.warn(`${serviceLocation}: Failed to cleanup files after unexpected error: ${(cleanupError as Error).message}`);
    }

    LogError(
      error as Error,
      serviceLocation,
      `Unexpected error processing reconstruction callback for job ${gpuJobId}`
    );
    return {
      success: false,
      message: "Unexpected error occurred during reconstruction processing",
      error: (error as Error).message
    };
  }
}

/**
 * Validate GPU callback metadata for expected mesh generation
 */
function validateMetadata(
  metadata: any,
  gpuJobId: string
): ReconstructionCallbackResult {
  try {
    // Validate metadata structure exists
    if (!metadata || typeof metadata !== 'object') {
      logger.error(`${serviceLocation}: Invalid or missing metadata for job ${gpuJobId}`);
      return {
        success: false,
        message: "Invalid or missing callback metadata"
      };
    }

    // Check for error messages in metadata first
    const errorMessage = metadata?.error || metadata?.error_message;
    if (errorMessage) {
      logger.error(`${serviceLocation}: GPU metadata contains error message for job ${gpuJobId}: ${errorMessage}`);
      return {
        success: false,
        message: `GPU server reported error: ${errorMessage}`
      };
    }

    // Validate required GPU result fields
    const requiredFields = ['ed_frame_index', 'total_frames'];
    for (const field of requiredFields) {
      if (metadata[field] === undefined && metadata.result?.[field] === undefined) {
        logger.warn(`${serviceLocation}: Missing required field ${field} in metadata for job ${gpuJobId}`);
      }
    }
    
    // Check if metadata indicates mesh files should be present
    const totalMeshFiles = metadata?.total_mesh_files || metadata?.result?.total_mesh_files;
    const totalMeshSize = metadata?.total_mesh_size || metadata?.result?.total_mesh_size;
    
    if (typeof totalMeshFiles === 'number' && totalMeshFiles === 0) {
      logger.warn(`${serviceLocation}: No mesh files generated for job ${gpuJobId}`);
      return {
        success: false,
        message: "Reconstruction completed but generated no mesh files. This may indicate insufficient input data or processing failure."
      };
    }
    
    return { success: true, message: "Metadata validation successful" };
    
  } catch (error) {
    logger.error(`${serviceLocation}: Error validating metadata for job ${gpuJobId}:`, error);
    return {
      success: false,
      message: "Failed to validate metadata structure",
      error: (error as Error).message
    };
  }
}

/**
 * Validate uploaded mesh files (OBJ or GLB) with enhanced debugging
 */
function validateArtifactFiles(
  meshFiles: Express.Multer.File[],
  pointCloudFiles: Express.Multer.File[],
  gpuJobId: string
): ReconstructionCallbackResult {
  const safeMeshFiles = meshFiles || [];
  const safePointCloudFiles = pointCloudFiles || [];

  if (safeMeshFiles.length === 0) {
    logger.error(`${serviceLocation}: No mesh files (.obj or .glb) received for job ${gpuJobId}`);
    return {
      success: false,
      message: "No mesh files received in reconstruction callback. The reconstruction may have failed to generate mesh output or encountered an error during processing."
    };
  }

  const totalMeshSize = safeMeshFiles.reduce((sum, f) => sum + f.size, 0);
  const totalPointCloudSize = safePointCloudFiles.reduce((sum, f) => sum + f.size, 0);
  const meshFormat = safeMeshFiles[0].originalname.toLowerCase().endsWith('.glb') ? 'GLB' : 'OBJ';
  logger.info(`${serviceLocation}: Validated ${safeMeshFiles.length} ${meshFormat} files (${Math.round(totalMeshSize / 1024 / 1024)} MB total), point clouds: ${safePointCloudFiles.length} (${Math.round(totalPointCloudSize / 1024 / 1024)} MB total)`);
  
  return { success: true, message: "Files validated successfully" };
}

/**
 * Process uploaded artifacts and extract metadata
 */
async function processArtifactFiles(
  uploadedFiles: Express.Multer.File[],
  gpuJobId: string
): Promise<ProcessedArtifactFile[]> {
  const processedFiles: ProcessedArtifactFile[] = [];
  
  // Create job-specific directory for file isolation
  const jobTempDir = path.join("src/temp_mesh/", `job_${gpuJobId}`);
  await fs.mkdir(jobTempDir, { recursive: true });
  
  for (const file of uploadedFiles) {
    // Extract frame index from filename if present (e.g., frame_001.obj, heart_frame_2.obj)
    const frameMatch = file.originalname.match(/frame[_-]?(\d+)/i);
    const frameIndex = frameMatch ? parseInt(frameMatch[1], 10) : undefined;
    
    // Move file to job-specific directory
    const isolatedPath = path.join(jobTempDir, file.filename);
    await fs.rename(file.path, isolatedPath);
    
    processedFiles.push({
      filename: file.filename,
      originalName: file.originalname,
      tempPath: isolatedPath,
      size: file.size,
      frameIndex: frameIndex,
      artifactType: file.originalname.toLowerCase().endsWith('.obj') || file.originalname.toLowerCase().endsWith('.glb')
        ? "mesh"
        : "point_cloud",
    });
  }
  
  logger.info(`${serviceLocation}: Processed ${processedFiles.length} artifacts for job ${gpuJobId} in isolated directory`);
  return processedFiles;
}

/**
 * Extracts project details and mask ID from job record
 * Retrieves userId, filehash, projectId from database and extracts maskId from job result
 * 
 * @param gpuJobId - GPU job identifier
 * @returns Promise with project details including extracted mask ID
 */
async function getProjectDetails(gpuJobId: string): Promise<{ userId: string; filehash: string; projectId: string; maskId?: string }> {
  // Get job details first
  const { readJob } = await import("./database");
  const jobResult = await readJob(gpuJobId);
  
  if (!jobResult.success || !jobResult.job) {
    throw new Error(`Job ${gpuJobId} not found`);
  }
  
  const projectId = jobResult.job.projectid;
  
  // Extract mask ID from job result if present
  let maskId: string | undefined;
  if (jobResult.job.result) {
    const maskIdMatch = jobResult.job.result.match(/Mask ID: ([a-fA-F0-9]{24})/);
    if (maskIdMatch) {
      maskId = maskIdMatch[1];
    }
  }
  
  // Get project details - readProject returns projects (plural), not project (singular)
  const projectResult = await readProject(projectId);
  if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
    throw new Error(`Project ${projectId} not found for job ${gpuJobId}`);
  }

  // Get the first project from the results array
  const project = projectResult.projects[0];
  const userId = project.userid;
  const filehash = project.filehash;

  if (!userId || !filehash) {
    throw new Error(`Missing userId (${userId}) or filehash (${filehash}) for job ${gpuJobId}`);
  }

  return { userId, filehash, projectId, maskId };
}

/**
 * Create TAR bundle from mesh files (OBJ or GLB) following naming convention
 */
async function createReconstructionTar(
  processedFiles: ProcessedArtifactFile[],
  userId: string,
  filehash: string,
  gpuJobId: string
): Promise<{ success: boolean; message: string; tarPath?: string; tarSize?: number }> {
  try {
    // Use job-specific naming to prevent collisions
    const timestamp = Date.now();
    const tarFilename = `${userId}_${filehash}_${gpuJobId.substring(0, 8)}_${timestamp}_mesh.tar`;
    const tarPath = path.join("src/temp_mesh/", tarFilename);
    const tempTarPath = `${tarPath}.tmp`; // Atomic creation using temp file
    
    const meshCount = processedFiles.filter(f => f.artifactType === "mesh").length;
    const pointCloudCount = processedFiles.filter(f => f.artifactType === "point_cloud").length;
    logger.info(`${serviceLocation}: Creating TAR bundle with ${meshCount} mesh files and ${pointCloudCount} point cloud files`);
    
    // Comprehensive mesh file validation (OBJ or GLB)
    for (const file of processedFiles) {
      if (!fsSync.existsSync(file.tempPath)) {
        throw new Error(`Mesh file not found: ${file.tempPath}`);
      }
      
      // Validate file is not empty
      const stats = await fs.stat(file.tempPath);
      if (stats.size === 0) {
        throw new Error(`Mesh file is empty: ${file.tempPath}`);
      }
      
      // Format-specific validation
      const isGlb = file.tempPath.toLowerCase().endsWith('.glb');
      const isObj = file.tempPath.toLowerCase().endsWith('.obj');
      const isNpy = file.tempPath.toLowerCase().endsWith('.npy');
      const isPly = file.tempPath.toLowerCase().endsWith('.ply');
      
      if (isObj) {
        // OBJ format validation: check for vertices and faces
        const fileContent = await fs.readFile(file.tempPath, 'utf-8');
        if (!fileContent.includes('v ') && !fileContent.includes('f ')) {
          throw new Error(`Invalid OBJ file format: ${file.tempPath}`);
        }
      } else if (isGlb) {
        // GLB format validation: check for glTF magic number (0x46546C67 = "glTF")
        const buffer = await fs.readFile(file.tempPath);
        if (buffer.length < 12) {
          throw new Error(`GLB file too small to be valid: ${file.tempPath}`);
        }
        const magic = buffer.readUInt32LE(0);
        if (magic !== 0x46546C67) {
          throw new Error(`Invalid GLB file format (missing glTF magic number): ${file.tempPath}`);
        }
      } else if (isNpy) {
        const buffer = await fs.readFile(file.tempPath);
        if (buffer.length < 6 || buffer[0] !== 0x93 || buffer.toString('ascii', 1, 6) !== 'NUMPY') {
          throw new Error(`Invalid NPY file format: ${file.tempPath}`);
        }
      } else if (isPly) {
        const header = await fs.readFile(file.tempPath, 'utf-8');
        if (!header.startsWith('ply')) {
          throw new Error(`Invalid PLY file format: ${file.tempPath}`);
        }
      } else {
        throw new Error(`Unknown artifact file format: ${file.tempPath}`);
      }
    }
    
    // Build TAR command with all mesh files from job-specific directory - create temp file first for atomicity
    const meshFileNames = processedFiles.map(f => path.basename(f.tempPath));
    const jobTempDir = path.dirname(processedFiles[0].tempPath); // All files should be in same job dir
    const tarCommand = `tar -cf "${tempTarPath}" -C "${jobTempDir}" ${meshFileNames.map(name => `"${name}"`).join(' ')}`;
    
    try {
      execSync(tarCommand, { stdio: 'pipe' });
      
      // Atomically move temp file to final location
      await fs.rename(tempTarPath, tarPath);
    } catch (cmdError) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempTarPath);
      } catch {}
      logger.error(`${serviceLocation}: TAR command failed for job ${gpuJobId}:`, cmdError);
      throw new Error(`TAR command execution failed: ${(cmdError as Error).message}`);
    }
    
    // Get TAR file size and validate
    if (!fsSync.existsSync(tarPath)) {
      throw new Error('TAR file was not created');
    }
    
    const tarBuffer = await fs.readFile(tarPath);
    const tarSize = tarBuffer.length;
    
    if (tarSize === 0) {
      throw new Error('TAR file created but is empty (0 bytes)');
    }
    
    logger.info(`${serviceLocation}: TAR bundle created: ${Math.round(tarSize / 1024 / 1024)} MB`);
    
    return {
      success: true,
      message: "TAR bundle created successfully",
      tarPath,
      tarSize
    };
    
  } catch (error) {
    logger.error(`${serviceLocation}: Failed to create TAR bundle for job ${gpuJobId}:`, {
      error: error,
      message: (error as Error).message,
      stack: (error as Error).stack,
      processedFilesCount: processedFiles.length,
      processedFiles: processedFiles.map(f => ({ originalName: f.originalName, tempPath: f.tempPath, exists: fsSync.existsSync(f.tempPath) }))
    });
    return {
      success: false,
      message: `Failed to create required TAR bundle: ${(error as Error).message}`
    };
  }
}

/**
 * Creates database record for completed 4D reconstruction
 * Extracts metadata from GPU result and creates comprehensive reconstruction record
 * 
 * @param gpuJobId - GPU job identifier for tracking
 * @param projectId - Database project ID
 * @param userId - User who initiated the reconstruction
 * @param filehash - Original file hash for consistency
 * @param gpuResult - GPU processing result metadata
 * @param processedFiles - Array of processed mesh files
 * @param tarSize - Size of TAR archive in bytes
 * @param reconstructionFileS3Url - S3 URL of uploaded TAR file
 * @param maskId - ID of segmentation mask used for reconstruction
 * @returns Promise with creation result and reconstruction ID
 */
async function createReconstructionRecord(
  gpuJobId: string,
  projectId: string,
  userId: string,
  filehash: string,
  gpuResult: any,
  processedFiles: ProcessedArtifactFile[],
  tarSize: number,
  reconstructionFileS3Url: string,
  maskId?: string
): Promise<{ success: boolean; message: string; reconstructionId?: string }> {
  try {
    // Check for existing reconstruction from this GPU job to prevent duplicates
    const { readProjectReconstruction } = await import("./database");
    const existingRecons = await readProjectReconstruction(projectId);
    
    if (existingRecons.success && existingRecons.projectreconstructions) {
      const duplicateRecon = existingRecons.projectreconstructions.find(recon => 
        recon.description?.includes(gpuJobId.substring(0, 8))
      );
      
      if (duplicateRecon) {
        logger.warn(`${serviceLocation}: Reconstruction already exists for job ${gpuJobId}: ${duplicateRecon._id}`);
        return {
          success: false,
          message: `Reconstruction already exists for this job: ${duplicateRecon._id}`
        };
      }
    }
    // Extract and validate GPU metadata
    const rawEdFrameIndex = gpuResult.ed_frame_index !== undefined ? gpuResult.ed_frame_index : 0;
    const totalFrames = gpuResult.total_frames || processedFiles.length || 1;
    
    // Validate and correct frame index bounds
    let edFrameIndex = rawEdFrameIndex;
    if (typeof rawEdFrameIndex !== 'number' || rawEdFrameIndex < 0) {
      logger.warn(`${serviceLocation}: Invalid ED frame index, using default 0`);
      edFrameIndex = 0;
    } else if (processedFiles.length > 0 && rawEdFrameIndex >= processedFiles.length) {
      logger.warn(`${serviceLocation}: ED frame index exceeds available frames, using last frame`);
      edFrameIndex = Math.max(0, processedFiles.length - 1);
    } else if (rawEdFrameIndex >= totalFrames) {
      logger.warn(`${serviceLocation}: ED frame index exceeds total frames, using last frame`);
      edFrameIndex = Math.max(0, totalFrames - 1);
    }
    
    // Generate reconstruction metadata
    const reconstructionName = `4D Reconstruction - Job ${gpuJobId.substring(0, 8)}`;
    const reconstructionDescription = `4D cardiac reconstruction: ${processedFiles.length} frames, ED frame ${edFrameIndex + 1}`;
    const finalFilename = `${userId}_${filehash}_mesh.tar`;
    
    // Detect mesh format from uploaded files
    const firstMeshFile = processedFiles[0];
    const detectedFormat = firstMeshFile.originalName.toLowerCase().endsWith('.glb') ? MeshFormat.GLB : MeshFormat.OBJ;
    logger.info(`${serviceLocation}: Detected mesh format: ${detectedFormat}`);
    
    // Generate basepath following same pattern as projects
    const s3KeyPrefix = `source_nifti/${userId}/`;
    const basepath = `s3://${process.env.AWS_BUCKET_NAME}/${s3KeyPrefix}`;
    
    const reconstructionData: Partial<IProjectReconstruction> = {
      projectid: projectId,
      maskId: maskId, 
      name: reconstructionName,
      description: reconstructionDescription,
      ed_frame: edFrameIndex + 1,
      isSaved: false,
      isAIGenerated: true,
      meshFormat: detectedFormat,  // CHANGED: Detect from file extension (OBJ or GLB)
      filename: finalFilename,
      filesize: tarSize,
      filehash: filehash,
      basepath: basepath,
      reconstructionfolderpath: reconstructionFileS3Url,
      reconstructedMesh: {
        path: reconstructionFileS3Url,
        filename: finalFilename,
        filesize: tarSize,
        hash: filehash,
        format: "tar",
        reconstructionTime: gpuResult.reconstruction_time,
        numIterations: gpuResult.num_iterations,
        resolution: gpuResult.resolution
      },
    };

    const createResult = await createProjectReconstruction(reconstructionData as IProjectReconstruction);

    if (createResult.success && createResult.projectreconstruction) {
      logger.info(`${serviceLocation}: Created reconstruction record: ${createResult.projectreconstruction._id}`);
      return {
        success: true,
        message: "Reconstruction record created successfully",
        reconstructionId: createResult.projectreconstruction._id.toString()
      };
    } else {
      logger.error(`${serviceLocation}: Failed to create reconstruction record: ${createResult.message}`);
      return {
        success: false,
        message: `Failed to create reconstruction record: ${createResult.message}`
      };
    }
  } catch (error) {
    logger.error(`${serviceLocation}: Error creating reconstruction record for job ${gpuJobId}:`, error);
    return {
      success: false,
      message: `Database error: ${(error as Error).message}`
    };
  }
}

/**
 * Cleans up temporary artifact files and TAR archive after processing
 * Removes individual artifacts and TAR bundle from temp directories
 * 
 * @param processedFiles - Array of processed artifact files to clean up
 * @param tarPath - Path to TAR archive file to remove
 */
async function cleanupTempFiles(processedFiles: ProcessedArtifactFile[], tarPath: string): Promise<void> {
  try {
    // Clean up job-specific directory if it exists
    if (processedFiles.length > 0) {
      const jobTempDir = path.dirname(processedFiles[0].tempPath);
      try {
        // Remove entire job directory to clean up all files
        await fs.rm(jobTempDir, { recursive: true, force: true });
        logger.info(`${serviceLocation}: Cleaned up job directory: ${jobTempDir}`);
      } catch (dirError) {
        logger.warn(`${serviceLocation}: Failed to remove job directory: ${jobTempDir}`);
        
        // Fallback: clean up individual files
        for (const artifactFile of processedFiles) {
          try {
            await fs.unlink(artifactFile.tempPath);
          } catch (fileError) {
            logger.warn(`${serviceLocation}: Failed to delete temp file: ${artifactFile.tempPath}`);
          }
        }
      }
    }
    
    // Clean up TAR file
    if (tarPath) {
      try {
        await fs.unlink(tarPath);
        logger.info(`${serviceLocation}: Cleaned up TAR file: ${tarPath}`);
      } catch (tarError) {
        logger.warn(`${serviceLocation}: Failed to delete TAR file: ${tarPath}`);
      }
    }
  } catch (cleanupError) {
    logger.warn(`${serviceLocation}: Cleanup failed: ${(cleanupError as Error).message}`);
  }
}