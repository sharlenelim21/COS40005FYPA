// File: src/services/inference.ts
// Description: Service layer for initiating local GPU inference.

import { IUserSafe, ProjectCrudResult, segmentationSource, SegmentationModel } from "../types/database_types";
import logger from "./logger";
import { createJob, IJob, JobStatus, readProject, updateJob } from "./database";
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { generatePresignedGetUrl } from "../utils/s3_presigned_url";
import { URL } from 'url';
import { getFreshGPUServerAddress } from "./gpu_auth_client"; // Import fresh GPU server address function

const serviceLocation = "Inference";

const uniqueBaseUrls = (urls: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();

  return urls
    .filter((url): url is string => Boolean(url))
    .map((url) => url.replace(/\/$/, ""))
    .filter((url) => {
      if (seen.has(url)) {
        return false;
      }

      seen.add(url);
      return true;
    });
};

/**
 * Resolve the MedSAM server base URL.
 *
 * Default behavior is local-first to reduce cloud GPU cost:
 * - MEDSAM_USE_LOCALHOST is "true" by default
 * - MEDSAM_LOCAL_BASE_URL defaults to http://127.0.0.1:8001
 *
 * Set MEDSAM_USE_LOCALHOST="false" to use database-configured remote GPU host.
 */
const resolveMedsamBaseUrl = async (): Promise<string | null> => {
  logger.warn("[Inference Debug] Env snapshot", {
    GPU_API_URL: process.env.GPU_API_URL,
    MEDSAM_USE_LOCALHOST: process.env.MEDSAM_USE_LOCALHOST,
    MEDSAM_LOCAL_BASE_URL: process.env.MEDSAM_LOCAL_BASE_URL,
    GPU_SERVER_URL: process.env.GPU_SERVER_URL,
    GPU_SERVER_PORT: process.env.GPU_SERVER_PORT,
    CALLBACK_URL: process.env.CALLBACK_URL,
  });

  const directGpuApiUrl = process.env.GPU_API_URL?.replace(/\/$/, "");
  if (directGpuApiUrl) {
    logger.warn(`[Inference Debug] Using GPU_API_URL: ${directGpuApiUrl}`);
    return directGpuApiUrl;
  }

  const useLocalhost =
    (process.env.MEDSAM_USE_LOCALHOST ?? "true").toLowerCase() !== "false";

  if (useLocalhost) {
    const localUrl = (
      process.env.MEDSAM_LOCAL_BASE_URL ||
      `http://${process.env.GPU_SERVER_URL || "127.0.0.1"}:${process.env.GPU_SERVER_PORT || "8001"}`
    ).replace(/\/$/, "");

    logger.warn(`[Inference Debug] Using localhost-style URL: ${localUrl}`);
    return localUrl;
  }

  const remoteBaseUrl = await getFreshGPUServerAddress();
  logger.warn(`[Inference Debug] Using remote GPU URL: ${remoteBaseUrl}`);
  return remoteBaseUrl ? remoteBaseUrl.replace(/\/$/, "") : null;
};

const resolveMedsamBaseUrlCandidates = async (): Promise<string[]> => {
  const configuredBaseUrl = await resolveMedsamBaseUrl();
  const isDockerGpuAlias = (url?: string | null): boolean =>
    Boolean(url && /^https?:\/\/gpu(?::|\/|$)/i.test(url));

  return uniqueBaseUrls([
    process.env.LOCAL_GPU_API_URL,
    "http://host.docker.internal:8011",
    isDockerGpuAlias(process.env.GPU_API_URL) ? null : process.env.GPU_API_URL,
    isDockerGpuAlias(process.env.MEDSAM_LOCAL_BASE_URL) ? null : process.env.MEDSAM_LOCAL_BASE_URL,
    isDockerGpuAlias(configuredBaseUrl) ? null : configuredBaseUrl,
  ]);
};

const buildCallbackUrl = (pathName: string): string | null => {
  const configuredCallbackUrl = process.env.CALLBACK_URL;
  if (!configuredCallbackUrl) {
    return null;
  }

  const callbackBaseUrl =
    process.env.LOCAL_CALLBACK_URL ||
    (
      configuredCallbackUrl.includes("visheart-app") ||
      configuredCallbackUrl.includes("://backend") ||
      configuredCallbackUrl.includes("://api")
        ? "http://localhost:5000"
        : configuredCallbackUrl
    );

  return `${callbackBaseUrl.replace(/\/$/, "")}${pathName}`;
};

// Interface for the expected GPU response for direct manual segmentation
interface GpuManualPredictionResponseData {
    uuid?: string; // GPU's internal request/job ID
    status?: string;
    result?: Record<string, {
        boxes: {
            bbox: number[];
            confidence?: number;
            class_id?: number;
            class_name?: string; // Expected to be "manual"
        }[];
        masks: Record<string, string>; // Expecting a key like "manual" with RLE string
    }>;
    error?: string | null;
}

interface UnetApiResponse {
    uuid?: string;
    job_id?: string;
    status?: string;
    message?: string;
    error?: string;
}

const sendInferenceRequestToCloudGpu = async (inferenceData: any, gpuAuthToken: string): Promise<{ success: boolean; jobId?: string; error?: string }> => {
    const medsamBaseUrls = await resolveMedsamBaseUrlCandidates();
    if (medsamBaseUrls.length === 0) {
        logger.error(`${serviceLocation}: MedSAM server URL could not be resolved from local/remote configuration.`);
        return { success: false, error: "MedSAM server URL is not configured." };
    }

    // For debugging: Log the token being used. Mask or remove in production.
    logger.debug(`${serviceLocation}: Attempting to send inference request. Token (first 10 chars): ${gpuAuthToken ? gpuAuthToken.substring(0, 10) + "..." : "undefined"}`);

    if (!gpuAuthToken) {
        logger.error(`${serviceLocation}: gpuAuthToken is missing. Cannot send inference request to local GPU.`);
        return { success: false, error: "Authentication token for local GPU is missing." };
    }

    let lastErrorMessage = "";

    for (const medsamBaseUrl of medsamBaseUrls) {
        const inferenceEndpoint = `${medsamBaseUrl}/inference/v2/medsam-inference`;
        logger.warn(`[Inference Debug] Final endpoint candidate = ${inferenceEndpoint}`);

        try {
            const response = await axios.post(inferenceEndpoint, inferenceData, {
                headers: {
                    Authorization: `Bearer ${gpuAuthToken}`,
                    'Content-Type': 'application/json',
                },
                timeout: 120000, // e.g., 2 minutes, adjust as needed
            });

            // **** THIS IS WHERE YOU LOG THE GPU SERVER'S RESPONSE DATA ****
            // The existing logger.info call here should already be doing this.
            // We log the full response.data object.
            logger.info(`${serviceLocation}: Successfully received response from local GPU for UUID ${inferenceData.uuid}. Status: ${response.status}, Full Response Data:`, response.data);

            // Attempt to extract a job ID from common fields
            // Adjust these fields (job_id, jobId, uuid) based on what your GPU server actually returns
            interface InferenceResponse {
                job_id?: string;
                jobId?: string;
                uuid?: string;
                [key: string]: any; // Allow additional properties if needed
            }

            const responseData = response.data as InferenceResponse;
            const returnedJobId = responseData.job_id || responseData.jobId || responseData.uuid;

            if (response.status === 202 && response.data) { // Or other success statuses like 200, 201
                if (returnedJobId) {
                    logger.info(`${serviceLocation}: GPU Job ID identified: ${returnedJobId} for local UUID ${inferenceData.uuid}.`);
                    return { success: true, jobId: returnedJobId };
                } else {
                    logger.warn(`${serviceLocation}: GPU request successful (Status ${response.status}) for UUID ${inferenceData.uuid}, but no clear Job ID found in response. Response data logged above.`);
                    // Decide if this is still a success for your workflow.
                    // You might still return success and use your internal UUID if the GPU doesn't provide one.
                    return { success: true, jobId: inferenceData.uuid }; // Fallback to internal UUID if no external one
                }
            } else {
                // Handle cases where status might be 2xx but data is not as expected, or status is not 202
                logger.error(`${serviceLocation}: Unexpected successful response from local GPU for UUID ${inferenceData.uuid}. Status: ${response.status}, Data:`, response.data);
                return { success: false, error: `Local GPU responded with status ${response.status} but data was unexpected: ${JSON.stringify(response.data)}` };
            }
        } catch (error: any) {
            logger.error(`${serviceLocation}: Error sending inference request to ${inferenceEndpoint}: ${error.message}`, { error });
            lastErrorMessage = `Error communicating with local GPU: ${error.message}`;
            if (error.response?.status) {
                lastErrorMessage += ` (Status: ${error.response.status})`;
            }
        }
    }

    return { success: false, error: lastErrorMessage || "No GPU endpoint accepted the inference request." };
};

export const startInference = async (projectId: string, user?: IUserSafe, gpuAuthToken?: string): Promise<{ success: boolean; message: string; uuid?: string }> => {
    logger.info(`${serviceLocation}: Received start inference request for project ${projectId} by user ${user?.username} with id ${user?._id}`);

    if (!gpuAuthToken) {
        logger.error(`${serviceLocation}: GPU authentication token is missing for project ${projectId}. Cannot start inference.`);
        return { success: false, message: "GPU authentication token is missing. Cannot start inference." };
    }

    // Build full callback URL by appending segmentation webhook path to base URL
    const callback_url = buildCallbackUrl("/webhook/gpu-callback");
    if (!callback_url) {
        logger.error(`${serviceLocation}: CALLBACK_URL is not set in environment variables. Cannot start inference for project ${projectId}.`);
        return { success: false, message: "Callback URL not configured for inference." };
    }

    const s3BucketName = process.env.AWS_BUCKET_NAME; // Or S3_BUCKET_NAME
    if (!s3BucketName) {
        logger.error(`${serviceLocation}: AWS_BUCKET_NAME (or S3_BUCKET_NAME) is not set in environment variables. Cannot start inference for project ${projectId}.`);
        return { success: false, message: "S3 bucket configuration is missing." };
    }

    try {
        const projectResult: ProjectCrudResult = await readProject(projectId);
        if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
            logger.warn(`${serviceLocation}: Project with ID ${projectId} not found or error reading project.`);
            return { success: false, message: `Project with ID ${projectId} not found.` };
        }

        const projectData = projectResult.projects[0];

        const s3HttpsUrlForTar = projectData.extractedfolderpath;
        if (!s3HttpsUrlForTar) {
            logger.error(`${serviceLocation}: Project ${projectId} does not have an extractedfolderpath (URL for the .tar file).`);
            return { success: false, message: "Project TAR file URL is missing." };
        }

        let objectKeyForTar: string;
        try {
            const parsedUrl = new URL(s3HttpsUrlForTar);
            objectKeyForTar = parsedUrl.pathname;
            if (objectKeyForTar.startsWith('/')) {
                objectKeyForTar = objectKeyForTar.substring(1);
            }
        } catch (e: any) {
            logger.error(`${serviceLocation}: Invalid S3 URL format in project.extractedfolderpath: ${s3HttpsUrlForTar}`, e);
            return { success: false, message: `Invalid project TAR file URL format: ${e.message}` };
        }

        if (!objectKeyForTar) {
            logger.error(`${serviceLocation}: Could not extract S3 object key from TAR file URL: ${s3HttpsUrlForTar}`);
            return { success: false, message: "Failed to determine S3 object key for TAR file." };
        }

        const dataUrlForGpu = await generatePresignedGetUrl(s3BucketName, objectKeyForTar);
        logger.error("[MedSAM Debug] s3BucketName =", s3BucketName);
        logger.error("[MedSAM Debug] extractedfolderpath =", s3HttpsUrlForTar);
        logger.error("[MedSAM Debug] objectKeyForTar =", objectKeyForTar);
                
        if (!dataUrlForGpu) {
            logger.error(`${serviceLocation}: Failed to generate presigned S3 URL for project ${projectId}, TAR S3 Key: ${objectKeyForTar}`);
            return { success: false, message: "Failed to prepare TAR file URL for inference." };
        }

        const jobUuid = uuidv4();

        const inferenceData = {
            projectId: projectId, // Added projectId to AI inference payload as well for consistency if needed by GPU
            uuid: jobUuid,
            callback_url: callback_url,
            url: dataUrlForGpu,
        };

        // The logger in sendInferenceRequestToCloudGpu will log the full payload.
        // You can add a summary log here if preferred:
        logger.info(`${serviceLocation}: Prepared inference data for project ${projectId}, UUID ${jobUuid}. TAR S3 Key: ${objectKeyForTar}. Callback URL being sent: ${inferenceData.callback_url}`);

        const inferenceResult = await sendInferenceRequestToCloudGpu(inferenceData, gpuAuthToken);

        if (inferenceResult.success && inferenceResult.jobId) {
            const trackedJobUuid = inferenceResult.jobId || jobUuid;
            logger.info(`${serviceLocation}: Inference request sent successfully for project ${projectId}. GPU Job ID: ${inferenceResult.jobId}, Local UUID: ${jobUuid}, Tracked UUID: ${trackedJobUuid}.`);

            const jobData: IJob = {
                userid: user?._id?.toString() || 'unknown',
                projectid: projectId,
                uuid: trackedJobUuid,
                status: JobStatus.PENDING,
                segmentationSource: segmentationSource.AI_INFERENCE
            };
            const jobCreationResult = await createJob(jobData);

            if (jobCreationResult.success) {
                return { success: true, message: `Inference job accepted. UUID: ${trackedJobUuid}`, uuid: trackedJobUuid };
            } else {
                logger.error(`${serviceLocation}: Failed to create job record for ${trackedJobUuid}: ${jobCreationResult.message || 'Unknown error'}`);
                return { success: true, message: `Inference accepted by GPU (Job ID: ${inferenceResult.jobId}), but failed to track job locally. UUID: ${trackedJobUuid}`, uuid: trackedJobUuid };
            }
        } else if (inferenceResult.success) {
            logger.warn(`${serviceLocation}: Inference request reported success for project ${projectId} but no definite Job ID was returned from GPU. Local UUID: ${jobUuid}`);
            return { success: true, message: `Inference request sent for project ${projectId}, but no Job ID was clearly identified from GPU. UUID: ${jobUuid}`, uuid: jobUuid };
        } else {
            logger.error(`${serviceLocation}: Failed to send inference request for project ${projectId}: ${inferenceResult.error}`);
            return { success: false, message: `Failed to start inference: ${inferenceResult.error}` };
        }

    } catch (error: any) {
        logger.error(`${serviceLocation}: Critical error starting inference for project ${projectId}:`, error);
        return { success: false, message: `Error starting inference: ${error.message}` };
    }
};

const sendUnetInferenceRequestToApi = async (
    inferenceData: {
        url: string;
        uuid: string;
        callbackUrl: string;
        segmentationModel: SegmentationModel.UNET;
        device?: "cpu" | "cuda" | "auto";
        checkpointPath?: string;
    },
    gpuAuthToken: string
): Promise<{ success: boolean; jobId?: string; status?: string; error?: string }> => {
    const unetBaseUrls = await resolveMedsamBaseUrlCandidates();
    if (unetBaseUrls.length === 0) {
        logger.error(`${serviceLocation}: UNET API server URL could not be resolved from local/remote configuration.`);
        return { success: false, error: "UNET API server URL is not configured." };
    }

    if (!gpuAuthToken) {
        logger.error(`${serviceLocation}: gpuAuthToken is missing. Cannot send UNET API inference request.`);
        return { success: false, error: "Authentication token for UNET API is missing." };
    }

    let lastErrorMessage = "";

    for (const unetBaseUrl of unetBaseUrls) {
      const endpoint = `${unetBaseUrl}/inference/v2/unet-inference`;
      logger.warn(`[Inference Debug] Final UNET endpoint candidate = ${endpoint}`);

      try {
          const response = await axios.post<UnetApiResponse>(
            endpoint,
            {
                url: inferenceData.url,
                uuid: inferenceData.uuid,
                callback_url: inferenceData.callbackUrl,
                segmentation_model: inferenceData.segmentationModel,
                device: inferenceData.device || "auto",
                checkpoint_path: inferenceData.checkpointPath,
            },
            {
                headers: {
                    Authorization: `Bearer ${gpuAuthToken}`,
                    "Content-Type": "application/json",
                },
                // Submission call only; processing happens asynchronously in GPU service.
                timeout: 30 * 1000,
            }
          );

          if (response.status === 202 && response.data) {
              return {
                  success: true,
                  jobId: response.data.job_id || response.data.uuid || inferenceData.uuid,
                  status: response.data.status || "queued",
              };
          }

          return {
              success: false,
              error: response.data?.error || `UNET API returned unexpected response (status ${response.status}).`,
          };
      } catch (error: any) {
          logger.error(`${serviceLocation}: Error sending UNET inference request to ${endpoint}: ${error.message}`, { error });
          lastErrorMessage = `Error communicating with UNET API: ${error.message}`;
          if (error.response?.status) {
              lastErrorMessage += ` (Status: ${error.response.status})`;
          }
      }
    }

    return { success: false, error: lastErrorMessage || "No UNET API endpoint accepted the inference request." };
};

/**
 * DEVELOPER NOTE: Main Entry Point for UNET API Segmentation
 * 
 * This function orchestrates the UNET API inference workflow:
 * 1. Validates project exists and has source NIfTI data
 * 2. Creates a job record for tracking (same pattern as MedSAM)
 * 3. Creates a presigned NIfTI URL
 * 4. Calls FastAPI UNET endpoint (CPU/GPU selected by deviceType)
 * 5. Returns immediately after remote job acceptance
 * 6. Result persistence is handled by existing webhook callback flow
 * 
 * KEY CHARACTERISTICS:
 * - Uses backend-to-backend API call (same architecture style as MedSAM)
 * - Requires gpuAuthToken for FastAPI authorization
 * - Keeps output mapping and DB schema identical to existing MedSAM-compatible storage
 * 
 * @param projectId - The cardiac imaging project identifier
 * @param user - Authenticated user information for auditing
 * @param gpuAuthToken - Auth token injected by middleware for GPU/FastAPI access
 * @param modelConfig - Optional configuration for device and checkpoint location
 * @returns Result object with success status and job UUID
 */
export async function startModel2Inference(
    projectId: string,
    user?: IUserSafe,
    gpuAuthToken?: string,
    modelConfig?: {
        deviceType?: "cpu" | "cuda" | "auto";
        checkpointPath?: string;
    }
): Promise<{ success: boolean; message: string; uuid?: string }> {
    logger.info(
        `${serviceLocation}: Received UNET inference request for project ${projectId} by user ${user?.username} with id ${user?._id}`
    );

    if (!gpuAuthToken) {
        logger.error(`${serviceLocation}: GPU authentication token is missing for project ${projectId}. Cannot start UNET API inference.`);
        return { success: false, message: "GPU authentication token is missing. Cannot start UNET inference." };
    }

    try {
        const projectResult = await readProject(projectId);
        if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
            logger.warn(`${serviceLocation}: Project with ID ${projectId} not found or error reading project for UNET inference.`);
            return { success: false, message: `Project with ID ${projectId} not found.` };
        }

        const projectData = projectResult.projects[0];
        const niftiS3Url = projectData.originalfilepath;
        const s3BucketName = process.env.AWS_BUCKET_NAME;
        const callbackBaseUrl = process.env.CALLBACK_URL;

        if (!niftiS3Url || !s3BucketName || !callbackBaseUrl) {
            logger.error(`${serviceLocation}: Missing NIfTI source path or AWS bucket configuration for UNET inference on project ${projectId}.`);
            return { success: false, message: "Project NIfTI source or callback URL is missing." };
        }

        let s3Key = "";
        try {
            const parsedUrl = new URL(niftiS3Url);
            s3Key = parsedUrl.pathname.startsWith("/") ? parsedUrl.pathname.substring(1) : parsedUrl.pathname;
        } catch (error: any) {
            logger.error(`${serviceLocation}: Invalid NIfTI S3 URL format for project ${projectId}: ${niftiS3Url}`, error);
            return { success: false, message: `Invalid NIfTI source URL: ${error.message}` };
        }

        if (!s3Key) {
            logger.error(`${serviceLocation}: Could not extract S3 key from originalfilepath: ${niftiS3Url}`);
            return { success: false, message: "Could not determine the NIfTI file path." };
        }

        const niftiPresignedUrl = await generatePresignedGetUrl(s3BucketName, s3Key);
        logger.info("[UNET Debug] niftiPresignedUrl prepared", { projectId, s3Key });
        
        if (!niftiPresignedUrl) {
            logger.error(`${serviceLocation}: Failed to generate presigned NIfTI URL for UNET inference on project ${projectId}.`);
            return { success: false, message: "Failed to prepare NIfTI URL for UNET inference." };
        }

        const callbackUrl = buildCallbackUrl("/webhook/gpu-callback");
        if (!callbackUrl) {
            return { success: false, message: "Callback URL not configured for UNET inference." };
        }

        // DEVELOPER NOTE: Create job record for tracking (identical to MedSAM pattern)
        // This allows both segmentation models to be tracked in the same job system
        // Job status progresses: PENDING -> COMPLETED/FAILED
        const jobUuid = uuidv4();
        const jobData: IJob = {
            userid: user?._id?.toString() || 'unknown',
            projectid: projectId,
            uuid: jobUuid,
            status: JobStatus.PENDING,
            segmentationSource: segmentationSource.AI_INFERENCE,
            segmentationModel: SegmentationModel.UNET,
        };
        const jobCreationResult = await createJob(jobData);
        if (!jobCreationResult.success) {
            logger.error(`${serviceLocation}: Failed to create UNET job record for project ${projectId}: ${jobCreationResult.message || 'Unknown error'}`);
            return { success: false, message: `Failed to create UNET job record: ${jobCreationResult.message || 'Unknown error'}` };
        }

        // NOTE: Checkpoint path is OPTIONAL and owned by the GPU service.
        // If not provided here, GPU service will resolve it portably using its env var
        // (UNET_CHECKPOINT_PATH, defaults to app/models/unet.pth).
        // This allows the system to work on any machine without hardcoded paths.
        const inferenceResult = await sendUnetInferenceRequestToApi(
            {
                url: niftiPresignedUrl,
                uuid: jobUuid,
                callbackUrl,
                segmentationModel: SegmentationModel.UNET,
                device: modelConfig?.deviceType || "auto",
                checkpointPath: modelConfig?.checkpointPath,
            },
            gpuAuthToken
        );

        if (!inferenceResult.success) {
            await updateJob(jobUuid, {
                status: JobStatus.FAILED,
                message: inferenceResult.error || "UNET inference failed.",
            });
            return {
                success: false,
                message: `UNET inference failed: ${inferenceResult.error || 'Unknown error'}`,
            };
        }

        return {
            success: true,
            message: `UNET inference job accepted (${inferenceResult.status || "queued"}).`,
            uuid: jobUuid,
        };

    } catch (error: any) {
        logger.error(`${serviceLocation}: Critical error starting UNET inference for project ${projectId}:`, error);
        return { success: false, message: `Error starting UNET inference: ${error.message}` };
    }
}

// This function is for direct synchronous GPU prediction if needed, not used by the job-based startManualInference below.
const getDirectGpuManualPrediction = async (
    inferenceData: {
        uuid: string;
        callback_url: string;
        url: string;
        image_name: string;
        bbox: number[];
        projectId?: string; // Added projectId here if GPU needs it
    },
    gpuAuthToken: string
): Promise<{
    success: boolean;
    data?: {
        imageNameFromGpu: string;
        rleString: string;
        bboxFromGpu: number[];
        confidenceFromGpu?: number;
    };
    error?: string
}> => {
    const serviceLocationDirectGpu = `${serviceLocation}_DirectGpuManualPrediction`;

    const medsamBaseUrl = await resolveMedsamBaseUrl();
    if (!medsamBaseUrl) {
        logger.error(`${serviceLocationDirectGpu}: MedSAM server URL could not be resolved from local/remote configuration.`);
        return { success: false, error: "MedSAM server URL is not configured." };
    }

    const inferenceEndpoint = `${medsamBaseUrl}/inference/v2/medsam-inference-manual`;

    logger.info(`${serviceLocationDirectGpu}: Sending direct manual prediction request to ${inferenceEndpoint} for image ${inferenceData.image_name}, internal UUID ${inferenceData.uuid}`);
    logger.debug(`${serviceLocationDirectGpu}: Payload for GPU:`, inferenceData);

    try {
        const response = await axios.post<GpuManualPredictionResponseData>(inferenceEndpoint, inferenceData, {
            headers: {
                'Authorization': `Bearer ${gpuAuthToken}`,
                'Content-Type': 'application/json',
            },
            timeout: 60000,
        });

        logger.debug(`${serviceLocationDirectGpu}: Received response from local GPU. Status: ${response.status}, Data:`, response.data);

        if (response.status === 200 && response.data && response.data.result) {
            const resultKeys = Object.keys(response.data.result);
            if (resultKeys.length === 0) {
                logger.error(`${serviceLocationDirectGpu}: GPU response successful but 'result' object is empty.`);
                return { success: false, error: "GPU returned no result data." };
            }
            const imageNameFromGpu = resultKeys[0];
            const imageData = response.data.result[imageNameFromGpu];

            if (!imageData || !imageData.masks || !imageData.boxes || imageData.boxes.length === 0) {
                logger.error(`${serviceLocationDirectGpu}: GPU response for image ${imageNameFromGpu} is missing masks or boxes.`);
                return { success: false, error: "GPU response missing critical segmentation data." };
            }

            const rleString = imageData.masks["manual"];
            const firstBox = imageData.boxes[0];
            const bboxFromGpu = firstBox.bbox;
            const confidenceFromGpu = firstBox.confidence;

            if (!rleString) {
                logger.error(`${serviceLocationDirectGpu}: RLE string for 'manual' class not found in GPU response for image ${imageNameFromGpu}. Masks available: ${Object.keys(imageData.masks).join(', ')}`);
                return { success: false, error: "RLE string for 'manual' class not found in GPU response." };
            }
            if (!bboxFromGpu || bboxFromGpu.length !== 4) {
                logger.error(`${serviceLocationDirectGpu}: Bounding box not found or invalid in GPU response for image ${imageNameFromGpu}.`);
                return { success: false, error: "Bounding box not found or invalid in GPU response." };
            }

            logger.info(`${serviceLocationDirectGpu}: Successfully processed direct prediction for image ${imageNameFromGpu}.`);
            return { success: true, data: { imageNameFromGpu, rleString, bboxFromGpu, confidenceFromGpu } };

        } else {
            const gpuError = response.data?.error || `Local GPU responded with status ${response.status}.`;
            logger.error(`${serviceLocationDirectGpu}: Error from local GPU: ${gpuError}`, response.data);
            return { success: false, error: `Local GPU error: ${gpuError}` };
        }
    } catch (error: any) {
        logger.error(`${serviceLocationDirectGpu}: Error sending direct prediction request to ${inferenceEndpoint}: ${error.message}`, { errorDetail: error });
        let errorMessage = `Error communicating with local GPU: ${error.message}`;
        if (error.response && error.response.status) {
            errorMessage += ` (Status: ${error.response.status})`;
        }
        return { success: false, error: errorMessage };
    }
};

// Helper to parse frame/slice from image name
const parseImageNameIndicesForService = (imageName: string): { frameIndex: number | null, sliceIndex: number | null } => {
    const nameWithoutExtension = imageName.substring(0, imageName.lastIndexOf('.')) || imageName;
    const parts = nameWithoutExtension.split('_');
    if (parts.length >= 2) {
        const sliceIndex = parseInt(parts[parts.length - 1], 10);
        const frameIndex = parseInt(parts[parts.length - 2], 10);
        if (!isNaN(sliceIndex) && !isNaN(frameIndex)) {
            return { frameIndex, sliceIndex };
        }
    }
    logger.warn(`${serviceLocation}: Could not parse frame/slice indices from image name in service: ${imageName}`);
    return { frameIndex: null, sliceIndex: null };
};

