/**
 * File: src/routes/webhook_routes.ts
 * Description: Webhook endpoints for GPU server callbacks and AI inference result processing
 * 
 * Handles two main types of callbacks:
 * 1. AI segmentation results from MedSAM processing
 * 2. 4D reconstruction mesh files from cardiac reconstruction processing
 */
import express, { Request, Response, NextFunction } from "express";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import multer from "multer";
import logger from "../services/logger"; // Import Winston Logger
import {
  updateJob,
  readJob,
  createProjectSegmentationMask,
  createProjectReconstruction,
  readProject,
} from "../services/database"; // Import database function to update job status
import {
  JobStatus,
  IProjectSegmentationMask,
  ComponentBoundingBoxesClass,
  CRUDOperation,
  IJob,
  IProjectSegmentationMaskDocument,
  IProjectReconstruction,
  MeshFormat,
} from "../types/database_types"; // Import JobStatus enum and IJob type
import LogError from "../utils/error_logger";
import { v4 as uuidv4 } from "uuid"; // For generating new _id for the manual mask
import { gpuObjUploadFilter } from "../middleware/uploadmiddleware";
import { processReconstructionCallback } from "../services/reconstruction_handler";

const serviceLocation = "InferenceCallback(Webhook)";
const router = express.Router();

/**
 * Pre-processing middleware for webhook requests
 * Validates content type and logs essential request information
 */
const preMulterLogging = (req: Request, res: Response, next: NextFunction) => {
  const jobId = req.headers['x-job-id'];
  const contentType = req.headers['content-type'] || '';
  
  logger.info(`${serviceLocation}: Processing webhook callback (Job ID: ${jobId})`);
  
  // Validate multipart content for file uploads
  if (!contentType.includes('multipart/form-data')) {
    logger.warn(`${serviceLocation}: Non-multipart content type: ${contentType}`);
  }
  
  next();
};

/**
 * Multer error handler for file upload processing
 * Provides appropriate error responses for different upload failure types
 */
const handleMulterError = (error: any, req: Request, res: Response, next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    logger.error(`${serviceLocation}: File upload error - ${error.code}: ${error.message}`);
    
    return res.status(400).json({
      error: 'File upload error',
      code: error.code,
      message: error.message
    });
  } else if (error) {
    logger.error(`${serviceLocation}: Request processing error: ${error.message}`);
    return res.status(500).json({
      error: 'Server error during file processing',
      message: error.message
    });
  }
  
  next();
};

// Helper function for deep copying frames data
const deepCopyFrames = (
  frames: IProjectSegmentationMaskDocument["frames"]
): IProjectSegmentationMaskDocument["frames"] => {
  return JSON.parse(JSON.stringify(frames));
};

router.post("/gpu-callback", async (req: Request, res: Response) => {
  logger.info(
    `${serviceLocation}: Received callback from Cloud GPU. Headers:`,
    req.headers,
    "Body:",
    req.body
  );

  const gpuJobId = req.headers["x-job-id"] as string | undefined;

  if (gpuJobId) {
    logger.info(
      `${serviceLocation}: Cloud GPU Job ID received in header: ${gpuJobId}`
    );
  } else {
    logger.error(
      `${serviceLocation}: Cloud GPU Job ID (X-Job-ID) not found in request headers. Body:`,
      req.body
    );
    return res.status(400).json("Missing Cloud GPU Job ID in headers");
  }

  const jobReadResult = await readJob(gpuJobId);
  if (!jobReadResult.success || !jobReadResult.job) {
    logger.error(
      `${serviceLocation}: Job with GPU Job ID ${gpuJobId} not found in database. Reason: ${jobReadResult.message || "Job not found"}`
    );
    return res
      .status(404)
      .json({ message: `Job with GPU Job ID ${gpuJobId} not found` });
  }
  // const job = jobReadResult.job; // Get the full job object // Not directly used, currentJob is used later

  const { status, result: gpuResult, error: gpuErrorDetail } = req.body;

  if (!status) {
    logger.error(
      `${serviceLocation}: Callback missing status for job UUID ${gpuJobId}.`
    );
    return res.status(400).json({ message: "Missing status in callback body" });
  }

  let jobStatus: JobStatus;
  let jobMessage: string | undefined = gpuErrorDetail
    ? typeof gpuErrorDetail === "string"
      ? gpuErrorDetail
      : JSON.stringify(gpuErrorDetail)
    : undefined;

  if (status === "completed" || status === "success") {
    jobStatus = JobStatus.COMPLETED;
  } else if (status === "failed") {
    jobStatus = JobStatus.FAILED;
  } else if (status === "processing") {
    jobStatus = JobStatus.IN_PROGRESS;
  } else {
    logger.warn(
      `${serviceLocation}: Unknown status received: ${status}. Defaulting to PENDING.`
    );
    jobStatus = JobStatus.PENDING;
    if (!jobMessage) jobMessage = `Unknown status received from GPU: ${status}`;
  }

  try {
    const jobUpdatePayload: Partial<IJob> = {
      status: jobStatus,
      result: gpuResult
        ? typeof gpuResult === "string"
          ? gpuResult
          : JSON.stringify(gpuResult)
        : undefined,
      message: jobMessage,
    };

    const updateResult = await updateJob(gpuJobId, jobUpdatePayload);

    if (!updateResult.success || !updateResult.job) {
      logger.error(
        `${serviceLocation}: Failed to update job with GPU Job ID ${gpuJobId}. Reason: ${updateResult.message || "Job not found after update"}`
      );
      return res
        .status(500)
        .json({
          message: `Failed to update job status or retrieve job after update: ${updateResult.message}`,
        });
    }
    logger.info(
      `${serviceLocation}: Successfully updated job with GPU Job ID ${gpuJobId} to status ${jobStatus}.`
    );

    if (
      jobStatus === JobStatus.COMPLETED &&
      gpuResult &&
      typeof gpuResult === "object" &&
      Object.keys(gpuResult).length > 0
    ) {
      const currentJob = updateResult.job;
      if (!currentJob) {
        logger.error(
          `${serviceLocation}: Job with UUID ${gpuJobId} not found after update during webhook processing.`
        );
        return res
          .status(404)
          .json({ message: `Job ${gpuJobId} not found after update.` });
      }
      const projectId = currentJob.projectid;

      logger.info(
        `${serviceLocation}: Processing structured segmentation results for job ${gpuJobId}, project ${projectId}. Segmentation source from job: ${currentJob.segmentationSource}`
      );

      const aiSegmentationSet: Partial<IProjectSegmentationMask> = {
        projectid: projectId,
        name:
          currentJob.segmentationName ||
          `AI Output - Job ${gpuJobId.substring(0, 8)}`,
        description:
          currentJob.segmentationDescription ||
          `AI segmentation results from job ${gpuJobId}`,
        isSaved: false,
        segmentationmaskRLE: true,
        isMedSAMOutput: true, // Explicitly true for AI output
        frames: [],
      };

      const framesDataMap = new Map<
        number,
        {
          frameindex: number;
          frameinferred: boolean;
          slices: Map<
            number,
            {
              sliceindex: number;
              componentboundingboxes: any[];
              segmentationmasks: any[];
            }
          >;
        }
      >();

      const mapGpuClassNameToEnum = (
        gpuClassName: string | undefined
      ): ComponentBoundingBoxesClass | undefined => {
        if (!gpuClassName) return undefined;
        const lowerGpuClassName = gpuClassName.toLowerCase();
        if (lowerGpuClassName === "rv") return ComponentBoundingBoxesClass.RV;
        if (lowerGpuClassName === "myo") return ComponentBoundingBoxesClass.MYO;
        if (lowerGpuClassName === "lvc" || lowerGpuClassName === "lv")
          return ComponentBoundingBoxesClass.LVC;
        logger.warn(
          `${serviceLocation}: Unknown GPU class name "${gpuClassName}" received for job ${gpuJobId}. Cannot map to enum.`
        );
        return undefined;
      };

      for (const [imageFilename, segmentationData] of Object.entries(
        gpuResult as Record<string, any>
      )) {
        if (typeof segmentationData !== "object" || segmentationData === null) {
          logger.warn(
            `${serviceLocation}: Invalid segmentation data for ${imageFilename} in job ${gpuJobId}. Skipping.`
          );
          continue;
        }

        const filenameParts = imageFilename.replace(/\.jpg$/i, "").split("_");
        let frameNumber: number | undefined;
        let sliceNumber: number | undefined;

        if (filenameParts.length >= 2) {
          const potentialSlice = parseInt(
            filenameParts[filenameParts.length - 1],
            10
          );
          const potentialFrame = parseInt(
            filenameParts[filenameParts.length - 2],
            10
          );
          if (!isNaN(potentialSlice) && !isNaN(potentialFrame)) {
            sliceNumber = potentialSlice;
            frameNumber = potentialFrame;
          } else {
            logger.warn(
              `${serviceLocation}: Could not parse frame/slice numbers from filename parts for ${imageFilename} in job ${gpuJobId}`
            );
          }
        }

        if (frameNumber === undefined || sliceNumber === undefined) {
          logger.warn(
            `${serviceLocation}: Could not parse valid frame/slice from filename ${imageFilename} for job ${gpuJobId}. Skipping entry.`
          );
          continue;
        }

        if (!framesDataMap.has(frameNumber)) {
          framesDataMap.set(frameNumber, {
            frameindex: frameNumber,
            frameinferred: true,
            slices: new Map(),
          });
        }
        const currentFrameData = framesDataMap.get(frameNumber)!;

        if (!currentFrameData.slices.has(sliceNumber)) {
          currentFrameData.slices.set(sliceNumber, {
            sliceindex: sliceNumber,
            componentboundingboxes: [],
            segmentationmasks: [],
          });
        }
        const currentSliceData = currentFrameData.slices.get(sliceNumber)!;

        if (segmentationData.boxes && Array.isArray(segmentationData.boxes)) {
          for (const box of segmentationData.boxes) {
            if (
              box &&
              typeof box === "object" &&
              box.bbox &&
              Array.isArray(box.bbox) &&
              box.bbox.length === 4
            ) {
              const mappedClass = mapGpuClassNameToEnum(box.class_name);
              if (mappedClass) {
                currentSliceData.componentboundingboxes.push({
                  class: mappedClass,
                  confidence:
                    typeof box.confidence === "number" ? box.confidence : 0,
                  x_min: box.bbox[0],
                  y_min: box.bbox[1],
                  x_max: box.bbox[2],
                  y_max: box.bbox[3],
                });
              } else {
                logger.warn(
                  `${serviceLocation}: Skipping box for ${imageFilename} due to unmappable class "${box.class_name}" in job ${gpuJobId}.`
                );
              }
            } else {
              logger.warn(
                `${serviceLocation}: Invalid box data for ${imageFilename}, class ${box?.class_name} in job ${gpuJobId}. Skipping box.`
              );
            }
          }
        }

        if (
          segmentationData.masks &&
          typeof segmentationData.masks === "object"
        ) {
          for (const [className, rleString] of Object.entries(
            segmentationData.masks
          )) {
            if (typeof rleString === "string") {
              const mappedClass = mapGpuClassNameToEnum(className);
              if (mappedClass) {
                currentSliceData.segmentationmasks.push({
                  class: mappedClass,
                  segmentationmaskcontents: rleString,
                });
              } else {
                logger.warn(
                  `${serviceLocation}: Skipping RLE mask for ${imageFilename} due to unmappable class "${className}" in job ${gpuJobId}.`
                );
              }
            } else {
              logger.warn(
                `${serviceLocation}: Invalid RLE string for ${imageFilename}, class ${className} in job ${gpuJobId}. Skipping mask.`
              );
            }
          }
        }
      }

      aiSegmentationSet.frames = Array.from(framesDataMap.values())
        .map((f) => ({
          ...f,
          slices: Array.from(f.slices.values()).sort(
            (a, b) => a.sliceindex - b.sliceindex
          ),
        }))
        .sort((a, b) => a.frameindex - b.frameindex);

      if (aiSegmentationSet.frames.length > 0) {
        const aiCreationResult = await createProjectSegmentationMask(
          aiSegmentationSet as IProjectSegmentationMask
        );
        if (
          aiCreationResult.success &&
          aiCreationResult.projectsegmentationmask
        ) {
          logger.info(
            `${serviceLocation}: Successfully created AI segmentation mask document for job ${gpuJobId}, project ${projectId}. Mask ID: ${aiCreationResult.projectsegmentationmask._id}`
          );

          // Now create the editable manual mask
          const manualSegmentationSet: IProjectSegmentationMask = {
            // _id: uuidv4(), // REMOVE THIS LINE - Let Mongoose generate the ObjectId
            projectid: projectId,
            name: `Manual Edit - ${currentJob.segmentationName || `Job ${gpuJobId.substring(0, 8)}`}`,
            description: `Editable manual segmentation, based on AI output from job ${gpuJobId}`,
            isSaved: false,
            segmentationmaskRLE: true,
            isMedSAMOutput: false, // Explicitly false for manual/editable mask
            frames: deepCopyFrames(
              aiCreationResult.projectsegmentationmask.frames
            ), // Deep copy frames from AI mask
          };

          const manualCreationResult = await createProjectSegmentationMask(
            manualSegmentationSet
          );
          if (
            manualCreationResult.success &&
            manualCreationResult.projectsegmentationmask
          ) {
            logger.info(
              `${serviceLocation}: Successfully created editable manual segmentation mask for project ${projectId}. AI Mask ID: ${aiCreationResult.projectsegmentationmask._id}, Manual Mask ID: ${manualCreationResult.projectsegmentationmask._id}`
            );
          } else {
            logger.error(
              `${serviceLocation}: Failed to create editable manual segmentation mask for project ${projectId} after AI mask creation. Reason: ${manualCreationResult.message}`
            );
            // Log this error, but don't fail the whole callback if AI mask was created.
          }
        } else {
          logger.error(
            `${serviceLocation}: Failed to create AI segmentation mask document for job ${gpuJobId}. Reason: ${aiCreationResult.message}`
          );
        }
      } else {
        logger.warn(
          `${serviceLocation}: No parsable frame/slice data found in GPU result for job ${gpuJobId}. Skipping structured segmentation storage.`
        );
      }
    }

    return res
      .status(200)
      .json({ message: "Callback processed, job status updated." });
  } catch (dbError) {
    LogError(
      dbError as Error,
      serviceLocation,
      `Unexpected error while processing webhook for GPU Job ID ${gpuJobId}`
    );
    return res
      .status(500)
      .json({ message: "Unexpected error occurred while processing webhook" });
  }
});

/**
 * GPU reconstruction callback endpoint for 4D cardiac mesh processing
 * Accepts OBJ/GLB mesh files and JSON metadata from GPU server reconstruction
 * 
 * Processing Flow:
 * 1. Receives multipart upload with .obj/.glb mesh files and .json metadata
 * 2. Parses metadata from uploaded JSON file or form fields
 * 3. Processes mesh files for reconstruction record creation
 * 4. Delegates to reconstruction handler for TAR creation and S3 upload
 */
// Store recent callback requests to prevent duplicate processing
const recentCallbacks = new Map<string, number>();
const CALLBACK_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Clean up old callback tracking entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [jobId, timestamp] of recentCallbacks.entries()) {
    if (now - timestamp > CALLBACK_TIMEOUT) {
      recentCallbacks.delete(jobId);
    }
  }
}, 60000); // Clean every minute

router.post("/gpu-reconstruction-callback", preMulterLogging, gpuObjUploadFilter, handleMulterError, async (req: Request, res: Response) => {
  const uploadedFiles = (req.files as Express.Multer.File[]) || [];
  const gpuJobId = req.headers["x-job-id"] as string | undefined;

  // Validate required job ID
  if (!gpuJobId) {
    logger.error(`${serviceLocation}: Missing X-Job-ID header in reconstruction callback`);
    return res.status(400).json({ message: "Missing Cloud GPU Job ID in headers" });
  }

  // Check for recent duplicate callback
  const now = Date.now();
  const lastCallback = recentCallbacks.get(gpuJobId);
  if (lastCallback && (now - lastCallback) < 30000) { // 30 second window
    logger.warn(`${serviceLocation}: Duplicate callback detected for job ${gpuJobId}, ignoring`);
    return res.status(409).json({ message: "Duplicate callback detected, request ignored" });
  }
  
  // Track this callback
  recentCallbacks.set(gpuJobId, now);

  // Filter files by type for processing - support both OBJ and GLB formats
  const meshFiles = uploadedFiles.filter(f => {
    const fname = f.originalname.toLowerCase();
    return fname.endsWith('.obj') || fname.endsWith('.glb');
  });
  const jsonFiles = uploadedFiles.filter(f => f.originalname.toLowerCase().endsWith('.json'));
  
  logger.info(`${serviceLocation}: Processing reconstruction callback - Job: ${gpuJobId}, Mesh files: ${meshFiles.length}, JSON files: ${jsonFiles.length}`);

  if (meshFiles.length === 0) {
    logger.warn(`${serviceLocation}: No mesh files (.obj/.glb) found in reconstruction callback for job ${gpuJobId}`);
  }

  // Parse metadata from uploaded JSON file or form fields
  let callbackMetadata;
  try {
    // Priority 1: Parse from uploaded JSON metadata file
    if (jsonFiles.length > 0) {
      const metadataFile = jsonFiles[0];
      const fs = await import('fs');
      const metadataContent = await fs.promises.readFile(metadataFile.path, 'utf-8');
      callbackMetadata = JSON.parse(metadataContent);
      logger.info(`${serviceLocation}: Parsed metadata from JSON file: ${metadataFile.originalname}`);
    }
    // Priority 2: Parse from form field 'metadata'
    else if (req.body.metadata) {
      if (typeof req.body.metadata === 'string') {
        callbackMetadata = JSON.parse(req.body.metadata);
      } else {
        callbackMetadata = req.body.metadata;
      }
      logger.info(`${serviceLocation}: Parsed metadata from form field`);
    }
    // Priority 3: Construct from individual form fields (legacy support)
    else if (req.body.uuid && req.body.status !== undefined) {
      callbackMetadata = {
        uuid: req.body.uuid,
        status: req.body.status,
        result: req.body.result,
        error: req.body.error
      };
      
      // Parse result if it's a JSON string
      if (typeof req.body.result === 'string') {
        try {
          callbackMetadata.result = JSON.parse(req.body.result);
        } catch {
          // Keep as string if parsing fails
        }
      }
      
      logger.info(`${serviceLocation}: Constructed metadata from form fields`);
    }
    else {
      throw new Error(`No valid metadata source found. Expected JSON file, 'metadata' field, or individual fields (uuid, status)`);
    }
    
  } catch (e) {
    logger.error(`${serviceLocation}: Failed to parse callback metadata for job ${gpuJobId}: ${(e as Error).message}`);
    return res.status(400).json({ 
      message: "Invalid callback metadata structure",
      error: (e as Error).message
    });
  }

  try {
    // Validate files before processing
    if (meshFiles.length === 0) {
      const expectedFiles = callbackMetadata?.result?.total_mesh_files || callbackMetadata?.total_mesh_files;
      if (expectedFiles > 0) {
        logger.error(`${serviceLocation}: Expected ${expectedFiles} mesh files but received none for job ${gpuJobId}`);
      }
    }
    
    // Log any unexpected file types (not .obj, .glb, or .json)
    const nonMeshFiles = uploadedFiles.filter(f => {
      const fname = f.originalname.toLowerCase();
      return !fname.endsWith('.obj') && !fname.endsWith('.glb') && !fname.endsWith('.json');
    });
    if (nonMeshFiles.length > 0) {
      logger.warn(`${serviceLocation}: Unexpected file types in callback: ${nonMeshFiles.map(f => f.originalname).join(', ')}`);
    }
    
    // Process reconstruction through service layer
    const result = await processReconstructionCallback(gpuJobId, meshFiles, callbackMetadata);
    
    if (result.success) {
      logger.info(`${serviceLocation}: Successfully processed reconstruction callback - Job: ${gpuJobId}, Reconstruction: ${result.reconstructionId}`);
      return res.status(200).json({ 
        message: result.message,
        reconstructionId: result.reconstructionId 
      });
    } else {
      logger.error(`${serviceLocation}: Reconstruction callback failed - Job: ${gpuJobId}, Error: ${result.message}`);
      return res.status(500).json({ 
        message: result.message,
        error: result.error 
      });
    }
  } catch (error) {
    logger.error(`${serviceLocation}: Unexpected error in reconstruction callback - Job: ${gpuJobId}, Error: ${(error as Error).message}`);
    
    LogError(
      error as Error,
      serviceLocation,
      `Reconstruction callback processing failed for job ${gpuJobId}`
    );
    
    return res.status(500).json({ 
      message: "Unexpected error occurred while processing reconstruction callback",
      error: (error as Error).message,
      jobId: gpuJobId
    });
  }
});

export default router;