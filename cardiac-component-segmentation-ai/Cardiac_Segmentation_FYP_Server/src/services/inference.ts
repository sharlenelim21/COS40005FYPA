// File: src/services/inference.ts
// Description: Service layer for initiating the inference process, including Cloud GPU communication.

import { IUserSafe, ProjectCrudResult, segmentationSource } from "../types/database_types";
import logger from "./logger";
import { readProject } from "./database";
import { v4 as uuidv4 } from 'uuid';
import { createJob, IJob, JobStatus } from "../services/database";
import axios from 'axios';
import { generatePresignedGetUrl } from "../utils/s3_presigned_url";
import { URL } from 'url';
import { getFreshGPUServerAddress } from "./gpu_auth_client"; // Import fresh GPU server address function

const serviceLocation = "Inference";

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

const sendInferenceRequestToCloudGpu = async (inferenceData: any, gpuAuthToken: string): Promise<{ success: boolean; jobId?: string; error?: string }> => {
    // Get fresh GPU server configuration from database
    const cloudGpuBaseUrl = await getFreshGPUServerAddress();
    if (!cloudGpuBaseUrl) {
        logger.info(`${serviceLocation}: Currently configured Cloud GPU URL: ${cloudGpuBaseUrl}`);
        logger.error(`${serviceLocation}: GPU server configuration is not available from database.`);
        return { success: false, error: "Cloud GPU URL not configured." };
    }

    // For debugging: Log the token being used. Mask or remove in production.
    logger.debug(`${serviceLocation}: Attempting to send inference request. Token (first 10 chars): ${gpuAuthToken ? gpuAuthToken.substring(0, 10) + "..." : "undefined"}`);

    if (!gpuAuthToken) {
        logger.error(`${serviceLocation}: gpuAuthToken is missing. Cannot send inference request to Cloud GPU.`);
        return { success: false, error: "Authentication token for Cloud GPU is missing." };
    }

    const inferenceEndpoint = `${cloudGpuBaseUrl}/inference/v2/medsam-inference`; // Adjust the endpoint as needed

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
        logger.info(`${serviceLocation}: Successfully received response from Cloud GPU for UUID ${inferenceData.uuid}. Status: ${response.status}, Full Response Data:`, response.data);

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
            logger.error(`${serviceLocation}: Unexpected successful response from Cloud GPU for UUID ${inferenceData.uuid}. Status: ${response.status}, Data:`, response.data);
            return { success: false, error: `Cloud GPU responded with status ${response.status} but data was unexpected: ${JSON.stringify(response.data)}` };
        }
    } catch (error: any) {
        logger.error(`${serviceLocation}: Error sending inference request to ${inferenceEndpoint}: ${error.message}`, { error });
        let errorMessage = `Error communicating with Cloud GPU: ${error.message}`;
        if (error.response?.status) {
            errorMessage += ` (Status: ${error.response.status})`;
        }
        return { success: false, error: errorMessage };
    }
};

export const startInference = async (projectId: string, user?: IUserSafe, gpuAuthToken?: string): Promise<{ success: boolean; message: string; uuid?: string }> => {
    logger.info(`${serviceLocation}: Received start inference request for project ${projectId} by user ${user?.username} with id ${user?._id}`);

    if (!gpuAuthToken) {
        logger.error(`${serviceLocation}: GPU authentication token is missing for project ${projectId}. Cannot start inference.`);
        return { success: false, message: "GPU authentication token is missing. Cannot start inference." };
    }

    // Build full callback URL by appending segmentation webhook path to base URL
    const callback_base_url = process.env.CALLBACK_URL;
    if (!callback_base_url) {
        logger.error(`${serviceLocation}: CALLBACK_URL is not set in environment variables. Cannot start inference for project ${projectId}.`);
        return { success: false, message: "Callback URL not configured for inference." };
    }
    const callback_url = `${callback_base_url.replace(/\/$/, '')}/webhook/gpu-callback`;

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
            logger.info(`${serviceLocation}: Inference request sent successfully for project ${projectId}. GPU Job ID: ${inferenceResult.jobId}, Local UUID: ${jobUuid}.`);

            const jobData: IJob = {
                userid: user?._id?.toString() || 'unknown',
                projectid: projectId,
                uuid: jobUuid,
                status: JobStatus.PENDING,
                segmentationSource: segmentationSource.AI_INFERENCE
            };
            const jobCreationResult = await createJob(jobData);

            if (jobCreationResult.success) {
                return { success: true, message: `Inference job accepted. UUID: ${jobUuid}`, uuid: jobUuid };
            } else {
                logger.error(`${serviceLocation}: Failed to create job record for ${jobUuid}: ${jobCreationResult.message || 'Unknown error'}`);
                return { success: true, message: `Inference accepted by GPU (Job ID: ${inferenceResult.jobId}), but failed to track job locally. UUID: ${jobUuid}`, uuid: jobUuid };
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

    // Get fresh GPU server configuration from database
    const cloudGpuBaseUrl = await getFreshGPUServerAddress();
    if (!cloudGpuBaseUrl) {
        logger.error(`${serviceLocationDirectGpu}: GPU server configuration is not available from database.`);
        return { success: false, error: "Cloud GPU URL not configured." };
    }

    const inferenceEndpoint = `${cloudGpuBaseUrl}/inference/v2/medsam-inference-manual`;

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

        logger.debug(`${serviceLocationDirectGpu}: Received response from Cloud GPU. Status: ${response.status}, Data:`, response.data);

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
            const gpuError = response.data?.error || `Cloud GPU responded with status ${response.status}.`;
            logger.error(`${serviceLocationDirectGpu}: Error from Cloud GPU: ${gpuError}`, response.data);
            return { success: false, error: `Cloud GPU error: ${gpuError}` };
        }
    } catch (error: any) {
        logger.error(`${serviceLocationDirectGpu}: Error sending direct prediction request to ${inferenceEndpoint}: ${error.message}`, { errorDetail: error });
        let errorMessage = `Error communicating with Cloud GPU: ${error.message}`;
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

