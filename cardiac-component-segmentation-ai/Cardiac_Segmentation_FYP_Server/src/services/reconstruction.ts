// File: src/services/reconstruction.ts
// Description: Service layer for initiating 4D reconstruction process, including GPU service communication.

import { IUserSafe, ProjectCrudResult, IProjectSegmentationMask, SegmentationModel } from "../types/database_types";
import logger from "./logger";
import { jobModel, readProject, readProjectReconstruction, readProjectSegmentationMask } from "./database";
import { v4 as uuidv4 } from 'uuid';
import { createJob, IJob, JobStatus, updateJob } from "../services/database";
import axios from 'axios';
import { generatePresignedGetUrlForInternalService } from "../utils/s3_presigned_url";
import { URL } from 'url';  // ADDED URL import for S3 URL parsing
import { getFreshGPUServerAddress, getCurrentToken } from "./gpu_auth_client";
import { generateAISegmentationForReconstruction } from "./segmentation_export";

const serviceLocation = 'Reconstruction';

/**
 * Resolve which segmentation model a mask document belongs to.
 * Mirrors the frontend's `inferDocModel` so a doc whose explicit
 * `segmentationModel` field was lost in transit is still classified
 * correctly via the webhook's name templates.
 *
 * Returns "medsam" | "unet" | null. Never guesses.
 */
const inferMaskModel = (
    mask: IProjectSegmentationMask
): "medsam" | "unet" | null => {
    const tag = (
        (mask as any).segmentationModel ||
        (mask as any).model_used ||
        ""
    )
        .toString()
        .toLowerCase();
    if (tag === "medsam" || tag === "unet") return tag;

    const name = (mask.name || "").toString().toLowerCase();
    if (name.includes("unet")) return "unet";
    if (name.includes("medsam")) return "medsam";
    // Do not guess "medsam" for generic names like "ai output" or "manual edit" —
    // these patterns predate per-model tagging and could belong to either model.
    // Without an explicit tag or model word in the name, the origin is unknown.
    return null;
};

const normalizeStoredModel = (value: unknown): "medsam" | "unet" | null => {
    const normalized = (value ?? "").toString().toLowerCase();
    if (normalized === "medsam" || normalized === "unet") {
        return normalized;
    }
    return null;
};

/**
 * Sends 4D reconstruction request to the configured GPU server
 * Communicates with GPU inference server to start cardiac reconstruction processing
 * 
 * @param reconstructionData - Reconstruction parameters and data URLs
 * @param gpuAuthToken - JWT token for GPU server authentication
 * @returns Promise with success status and GPU job ID
 */
const sendReconstructionRequestToCloudGpu = async (
    reconstructionData: {
        url: string;  
        uuid: string;
        callback_url: string;
        ed_frame_index: number; 
        num_iterations?: number;  
        resolution?: number;
        process_all_frames?: boolean;
        debug_save?: boolean;    
        debug_dir?: string;
    },
    gpuAuthToken: string
): Promise<{ success: boolean; jobId?: string; error?: string }> => {
    // Get GPU server configuration
    const cloudGpuBaseUrl = await getFreshGPUServerAddress();
    if (!cloudGpuBaseUrl) {
        logger.error(`${serviceLocation}: GPU server configuration not available`);
        return { success: false, error: "GPU service URL not configured." };
    }

    // Validate GPU authentication token
    if (!gpuAuthToken) {
        logger.error(`${serviceLocation}: gpuAuthToken is missing. Cannot send 4D reconstruction request to GPU service.`);
        return { success: false, error: "Authentication token for GPU service is missing." };
    }

    const reconstructionEndpoint = `${cloudGpuBaseUrl}/inference/v2/4d-reconstruction`;

    try {
        const response = await axios.post(reconstructionEndpoint, reconstructionData, {
            headers: {
                Authorization: `Bearer ${gpuAuthToken}`,
                'Content-Type': 'application/json',
                'X-Job-ID': reconstructionData.uuid
            },
            timeout: 120000, // 2 minute timeout for request submission
        });

        // Extract job ID from GPU response
        logger.info(`${serviceLocation}: Received response from GPU for UUID ${reconstructionData.uuid}, Status: ${response.status}`);

        // Attempt to extract a job ID from common response fields
        interface ReconstructionResponse {
            job_id?: string;
            jobId?: string;
            uuid?: string;
            [key: string]: any; // Allow additional properties if needed
        }

        const responseData = response.data as ReconstructionResponse;
        const returnedJobId = responseData.job_id || responseData.jobId || responseData.uuid;

        if (response.status === 202 && response.data) {
            if (returnedJobId) {
                logger.info(`${serviceLocation}: GPU accepted reconstruction job: ${returnedJobId}`);
                return { success: true, jobId: returnedJobId };
            } else {
                logger.warn(`${serviceLocation}: GPU accepted request but no Job ID returned, using UUID fallback`);
                return { success: true, jobId: reconstructionData.uuid };
            }
        } else {
            const gpuError = response.data?.error || `GPU service responded with status ${response.status}.`;
            logger.error(`${serviceLocation}: Error from GPU service: ${gpuError}`, response.data);
            return { success: false, error: `GPU service error: ${gpuError}` };
        }
    } catch (error: any) {
        logger.error(`${serviceLocation}: Error sending 4D reconstruction request to ${reconstructionEndpoint}: ${error.message}`, { error });
        let errorMessage = `Error communicating with GPU service: ${error.message}`;
        if (error.response?.status) {
            errorMessage += ` (Status: ${error.response.status})`;
        }
        return { success: false, error: errorMessage };
    }
};

/**
 * Initiates 4D cardiac reconstruction process for a project
 * Validates editable segmentation masks, generates NIfTI data, and submits to GPU server
 * 
 * @param projectId - Database ID of the project to reconstruct
 * @param user - User initiating the reconstruction (for permissions and tracking)
 * @param reconstructionName - Optional name for the reconstruction job
 * @param reconstructionDescription - Optional description for the reconstruction
 * @param parameters - Reconstruction parameters (iterations, resolution, etc.)
 * @param ed_frame - End-diastolic frame number (1-based)
 * @param export_format - Export format for mesh files ('glb' or 'obj')
 * @returns Promise with success status, message, and job UUID
 */
export const startReconstruction = async (
    projectId: string,
    user?: IUserSafe,
    reconstructionName?: string,
    reconstructionDescription?: string,
    parameters?: any,
    ed_frame?: number,
    export_format?: string,
    segmentationModel?: string
): Promise<{ success: boolean; message: string; uuid?: string; statusCode?: number }> => {
    // Normalise the requested segmentation model. Allowed values:
    //   "medsam" — only MedSAM-tagged editable masks
    //   "unet"   — only UNet-tagged editable masks
    //   undefined / anything else — legacy fallback (whatever editable
    //                              mask comes first; matches old behavior).
    const requestedModel: "medsam" | "unet" | null =
        typeof segmentationModel === "string"
            ? (segmentationModel.toLowerCase() === "medsam"
                ? "medsam"
                : segmentationModel.toLowerCase() === "unet"
                ? "unet"
                : null)
            : null;

    logger.info(
        `${serviceLocation}: Starting 4D reconstruction for project ${projectId} by user ${user?.username} with export_format: ${export_format || 'default'}, requestedModel: ${requestedModel ?? "<none — legacy>"}`
    );
    
    // Get current GPU authentication token
    const gpuAuthToken = getCurrentToken();
    if (!gpuAuthToken) {
        logger.error(`${serviceLocation}: GPU authentication token is missing for project ${projectId}. Cannot start 4D reconstruction.`);
        return { success: false, message: "GPU authentication token is missing. Cannot start 4D reconstruction." };
    }
    
    // Build full callback URL by appending reconstruction webhook path to base URL
    const callback_base_url = process.env.CALLBACK_URL;
    if (!callback_base_url) {
        logger.error(`${serviceLocation}: CALLBACK_URL is not set in environment variables. Cannot start reconstruction for project ${projectId}.`);
        return { success: false, message: "Callback URL not configured for reconstruction." };
    }
    const callback_url = `${callback_base_url.replace(/\/$/, '')}/webhook/gpu-reconstruction-callback`;

    const s3BucketName = process.env.AWS_BUCKET_NAME;
    if (!s3BucketName) {
        logger.error(`${serviceLocation}: AWS_BUCKET_NAME is not set in environment variables. Cannot start reconstruction for project ${projectId}.`);
        return { success: false, message: "S3 bucket configuration is missing." };
    }

    try {
        // Validate project exists and user has access
        const projectResult: ProjectCrudResult = await readProject(projectId);
        if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
            logger.warn(`${serviceLocation}: Project with ID ${projectId} not found or error reading project.`);
            return { success: false, message: `Project with ID ${projectId} not found.` };
        }

        const projectData = projectResult.projects[0];

        if (projectData.userid !== user?._id) {
            logger.warn(`${serviceLocation}: User ${user?._id} denied access to project ${projectId} for 4D reconstruction.`);
            return { success: false, message: "Access denied to this project" };
        }

        if (requestedModel) {
            const existingReconstructions = await readProjectReconstruction(projectId);
            if (existingReconstructions.success && existingReconstructions.projectreconstructions) {
                const matchingReconstruction = existingReconstructions.projectreconstructions.find(
                    (reconstruction) =>
                        normalizeStoredModel(reconstruction.segmentationModel) === requestedModel,
                );

                if (matchingReconstruction) {
                    const modelLabel = requestedModel === "medsam" ? "MedSAM" : "UNet";
                    return {
                        success: false,
                        statusCode: 409,
                        message: `A 4D reconstruction already exists for ${modelLabel}. Delete it before creating a new one.`,
                    };
                }
            }

            const blockingJob = await jobModel.findOne({
                projectid: projectId,
                segmentationModel: requestedModel === "medsam"
                    ? SegmentationModel.MEDSAM
                    : SegmentationModel.UNET,
                status: { $in: [JobStatus.PENDING, JobStatus.IN_PROGRESS] },
                model_used: "4d_reconstruction",
            }).lean();

            if (blockingJob) {
                const modelLabel = requestedModel === "medsam" ? "MedSAM" : "UNet";
                return {
                    success: false,
                    statusCode: 409,
                    message: `A 4D reconstruction already exists for ${modelLabel}. Delete it before creating a new one.`,
                };
            }
        }

        // Validate that project has segmentation masks (required for 4D reconstruction)
        const hasMasksResult = await readProjectSegmentationMask(projectId);
        if (!hasMasksResult.projectsegmentationmasks || hasMasksResult.projectsegmentationmasks.length === 0) {
            logger.warn(`${serviceLocation}: No segmentation masks found for project ${projectId}. 4D reconstruction requires completed segmentation.`);
            return { success: false, message: "4D reconstruction requires completed segmentation masks. Please complete segmentation before starting reconstruction." };
        }

        logger.info(`${serviceLocation}: Found ${hasMasksResult.projectsegmentationmasks.length} segmentation mask(s) for project ${projectId}. Proceeding with 4D reconstruction.`);

        // Filter for editable/manual masks (isMedSAMOutput: false) — reconstruction uses user-edited masks for accuracy.
        const allEditableMasks = hasMasksResult.projectsegmentationmasks.filter(
            mask => mask.isMedSAMOutput === false
        );

        if (allEditableMasks.length === 0) {
            logger.warn(
                `${serviceLocation}: No editable segmentation masks found for project ${projectId}. 4D reconstruction requires editable masks (user-refined segmentation).`
            );
            return {
                success: false,
                message:
                    "4D reconstruction requires editable segmentation masks. Please complete or refine segmentation before starting reconstruction.",
            };
        }

        // Per-model scoping. If the caller specified a segmentationModel,
        // restrict the candidate set to docs that resolve to that model.
        // If no candidates match (e.g. caller asked for UNet but project
        // only has MedSAM), refuse — do NOT silently fall back to the
        // other model. Callers expecting a specific model must get that
        // model or an explicit failure.
        let editableMasks = allEditableMasks;
        if (requestedModel) {
            const scoped = allEditableMasks.filter(
                m => inferMaskModel(m) === requestedModel
            );
            if (scoped.length === 0) {
                const availableModels = Array.from(
                    new Set(
                        allEditableMasks
                            .map(m => inferMaskModel(m))
                            .filter((x): x is "medsam" | "unet" => !!x)
                    )
                );
                logger.warn(
                    `${serviceLocation}: No editable masks tagged for model "${requestedModel}" in project ${projectId}. Available editable models: [${availableModels.join(", ") || "none-resolved"}].`
                );
                return {
                    success: false,
                    message: `No cached ${requestedModel.toUpperCase()} segmentation found for this project. Available: ${availableModels.length ? availableModels.map(m => m.toUpperCase()).join(", ") : "none"}.`,
                };
            }
            editableMasks = scoped;
        }

        const firstEditableMask = editableMasks[0];
        const maskId = firstEditableMask._id?.toString();
        const resolvedModelForChosenMask = inferMaskModel(firstEditableMask);
        const persistedSegmentationModel = requestedModel ?? resolvedModelForChosenMask ?? undefined;
        logger.info(
            `${serviceLocation}: Using editable segmentation mask ID ${maskId} (resolvedModel=${resolvedModelForChosenMask ?? "<unresolved>"}) for reconstruction of project ${projectId}. Candidates after model scoping: ${editableMasks.length}, total editable in project: ${allEditableMasks.length}, requestedModel: ${requestedModel ?? "<none — legacy>"}`
        );

        // Validate ed_frame parameter if provided
        if (ed_frame !== undefined) {
            if (!Number.isInteger(ed_frame) || ed_frame < 1) {
                logger.warn(`${serviceLocation}: Invalid ed_frame value ${ed_frame} for project ${projectId}. Must be a positive integer >= 1.`);
                return { success: false, message: `Invalid end-diastole frame number: ${ed_frame}. Must be a positive integer >= 1.` };
            }
            
            // Strict validation against actual project frame count
            if (projectData.dimensions?.frames && ed_frame > projectData.dimensions.frames) {
                logger.warn(`${serviceLocation}: ed_frame ${ed_frame} exceeds project ${projectId} frame count of ${projectData.dimensions.frames}.`);
                return { success: false, message: `End-diastole frame ${ed_frame} exceeds project frame count of ${projectData.dimensions.frames}.` };
            }
            
        }

        // Generate segmentation NIfTI file directly (no HTTP call needed)
        logger.info(`${serviceLocation}: Reconstruction started - generating segmentation NIfTI for project ${projectId}`);
        
        const segmentationResult = await generateAISegmentationForReconstruction(
            projectId,
            user?._id,
            requestedModel ?? undefined
        );
        
        if (!segmentationResult.success || !segmentationResult.s3Key) {
            logger.error(`${serviceLocation}: Failed to generate segmentation NIfTI for project ${projectId}: ${segmentationResult.message}`);
            return { success: false, message: `Failed to generate segmentation data: ${segmentationResult.message}` };
        }

        // Generate fresh presigned URL for the GPU (with longer expiration)
        const dataUrlForGpu = await generatePresignedGetUrlForInternalService(s3BucketName, segmentationResult.s3Key, 3600); // 1 hour
        
        if (!dataUrlForGpu) {
            logger.error(`${serviceLocation}: Failed to generate presigned URL for segmentation file: ${segmentationResult.s3Key}`);
            return { success: false, message: "Failed to prepare segmentation file for GPU access." };
        }

        logger.info(`${serviceLocation}: Reconstruction saving output - generated segmentation NIfTI for project ${projectId}. File size: ${segmentationResult.fileSizeBytes} bytes, S3 Key: ${segmentationResult.s3Key}`);

        // Generate job UUID
        const jobUuid = uuidv4();

        // Determine mesh format: user choice > environment variable > default to GLB
        let meshFormat = 'glb'; // Default
        if (export_format) {
            // User explicitly chose format via wizard
            meshFormat = export_format.toLowerCase() === 'obj' ? 'obj' : 'glb';
            logger.info(`${serviceLocation}: Using user-selected mesh export format: ${meshFormat}`);
        } else if (process.env.RECONSTRUCTION_MESH_FORMAT) {
            // Fallback to environment variable
            meshFormat = process.env.RECONSTRUCTION_MESH_FORMAT.toLowerCase() === 'obj' ? 'obj' : 'glb';
            logger.info(`${serviceLocation}: Using environment-configured mesh export format: ${meshFormat}`);
        } else {
            logger.info(`${serviceLocation}: Using default mesh export format: ${meshFormat}`);
        }

        // Prepare reconstruction request payload - match GPU server schema
        const reconstructionPayload = {
            url: dataUrlForGpu,  // Presigned URL for segmentation data
            uuid: jobUuid,
            callback_url: callback_url,  
            ed_frame_index: (ed_frame || 1) - 1,  // Convert 1-based ed_frame to 0-based ed_frame_index for GPU
            num_iterations: parameters?.num_iterations || 50,  // Flattened parameters
            resolution: parameters?.resolution || 128,
            process_all_frames: parameters?.process_all_frames ?? true,  // Enable 4D processing by default
            export_format: meshFormat,  // NEW: Send mesh format to GPU (obj or glb)
            debug_save: parameters?.debug_save || parameters?.debug || false,  // Support both debug and debug_save
            debug_dir: parameters?.debug_dir || "/tmp/4d_reconstruction_debug"
        };

        // Log reconstruction parameters for monitoring with FULL payload details
        logger.info(`${serviceLocation}: Submitting 4D reconstruction for project ${projectId}:`, {
            uuid: jobUuid,
            ed_frame: ed_frame || 1,
            ed_frame_index: reconstructionPayload.ed_frame_index,
            process_all_frames: reconstructionPayload.process_all_frames,
            num_iterations: reconstructionPayload.num_iterations,
            resolution: reconstructionPayload.resolution,
            s3Key: segmentationResult.s3Key,
            fileSizeBytes: segmentationResult.fileSizeBytes,
            callbackUrl: callback_url,
            urlPrefix: dataUrlForGpu?.substring(0, 100) + '...'
        });

        // Send reconstruction request to GPU server BEFORE creating job record
        const reconstructionResult = await sendReconstructionRequestToCloudGpu(reconstructionPayload, gpuAuthToken);

        if (reconstructionResult.success && reconstructionResult.jobId) {
            logger.info(`${serviceLocation}: Callback sent - reconstruction request sent successfully for project ${projectId}. GPU Job ID: ${reconstructionResult.jobId}, Local UUID: ${jobUuid}.`);

            // Create job record AFTER successful GPU submission
            const jobData: Partial<IJob> = {
                userid: user?._id,
                projectid: projectId,
                maskId,
                uuid: jobUuid,
                status: JobStatus.PENDING,  // Set to PENDING since GPU already accepted
                result: `GPU Job ID: ${reconstructionResult.jobId}${maskId ? `, Mask ID: ${maskId}` : ''}${persistedSegmentationModel ? `, Segmentation Model: ${persistedSegmentationModel}` : ''}`,
                message: "4D reconstruction submitted to GPU server",
                segmentationName: reconstructionName || `4D Reconstruction - ${new Date().toISOString()}`,
                segmentationDescription: reconstructionDescription || "4D cardiac reconstruction using SDF model",
                model_used: "4d_reconstruction",
                segmentationModel: persistedSegmentationModel === "medsam"
                    ? SegmentationModel.MEDSAM
                    : persistedSegmentationModel === "unet"
                    ? SegmentationModel.UNET
                    : undefined
            };

            const jobCreationResult = await createJob(jobData as IJob);

            if (jobCreationResult.success) {
                return { success: true, message: `4D reconstruction job accepted. UUID: ${jobUuid}`, uuid: jobUuid };
            } else {
                logger.error(`${serviceLocation}: Failed to create job record for ${jobUuid}: ${jobCreationResult.message || 'Unknown error'}`);
                return { success: true, message: `4D reconstruction accepted by GPU (Job ID: ${reconstructionResult.jobId}), but failed to track job locally. UUID: ${jobUuid}`, uuid: jobUuid };
            }
        } else if (reconstructionResult.success) {
            logger.warn(`${serviceLocation}: 4D reconstruction request reported success for project ${projectId} but no definite Job ID was returned from GPU. Local UUID: ${jobUuid}`);
            return { success: true, message: `4D reconstruction request sent for project ${projectId}, but no Job ID was clearly identified from GPU. UUID: ${jobUuid}`, uuid: jobUuid };
        } else {
            logger.error(`${serviceLocation}: Failed to send 4D reconstruction request for project ${projectId}: ${reconstructionResult.error}`);
            return { success: false, message: `Failed to start 4D reconstruction: ${reconstructionResult.error}` };
        }

    } catch (error: any) {
        logger.error(`${serviceLocation}: Critical error starting 4D reconstruction for project ${projectId}:`, error);
        return { success: false, message: `Error starting 4D reconstruction: ${error.message}` };
    }
};
