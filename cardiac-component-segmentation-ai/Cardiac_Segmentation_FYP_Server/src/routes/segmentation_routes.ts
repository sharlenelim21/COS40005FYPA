import { Request, Response, Router } from "express";
import logger from "../services/logger";
import { startInference, startModel2Inference } from "../services/inference";
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware";
import { computeBullseyeFromMaskDoc, computeHeartMetricsFromMaskDoc, computeHealthStatusFromMetrics, generateNiftiAndComputeBullseye, computeDiseaseSimilarityFromMetrics } from "../services/segmentation_export";
import {
    readProjectSegmentationMask,
    updateProjectSegmentationMask,
    updateProject,
    readProject,
    jobModel,
    userModel,
    JobStatus,
    projectSegmentationMaskModel,
    projectLandmarkModel
} from "../services/database";
import { isAuth, isAuthAndAdmin, isAuthAndNotGuest } from "../services/passportjs";
import LogError from "../utils/error_logger";
import { ComponentBoundingBoxesClass, IProjectSegmentationMask, IProjectDocument, IProjectSegmentationMaskDocument, SegmentationModel } from "../types/database_types";
import fs from 'fs-extra'; // Use fs-extra for easier directory handling and tar extraction
import path from 'path';
import { exec } from 'child_process';
import axios from 'axios'; // Simplified Axios import
import { v4 as uuidv4 } from 'uuid';
import { generatePresignedGetUrlForBrowser, generatePresignedGetUrlForInternalService } from "../utils/s3_presigned_url";
import { extractS3KeyFromUrl, downloadFromS3, uploadMaskToS3 } from "../services/s3_handler";
import { getFreshGPUServerAddress, getCurrentToken } from "../services/gpu_auth_client"; // Import fresh GPU server address function

const router = Router();
const serviceLocation = "SegmentationRoutes";

const resolveMedsamServerBaseUrl = async (): Promise<string | null> => {
    const useLocalhost = (process.env.MEDSAM_USE_LOCALHOST ?? "true").toLowerCase() !== "false";
    if (useLocalhost) {
        const configuredBaseUrl =
            process.env.MEDSAM_LOCAL_BASE_URL ||
            process.env.LOCAL_GPU_API_URL ||
            process.env.GPU_API_URL;

        if (configuredBaseUrl) {
            return configuredBaseUrl.replace(/\/$/, "");
        }

        return `http://${process.env.GPU_SERVER_URL || "127.0.0.1"}:${process.env.GPU_SERVER_PORT || "8001"}`;
    }

    const remoteBaseUrl = await getFreshGPUServerAddress();
    return remoteBaseUrl ? remoteBaseUrl.replace(/\/$/, "") : null;
};

const toSingleString = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

interface GpuManualInferenceResponse {
    uuid: string;
    status: string;
    result?: Record<string, {
        boxes: {
            bbox: number[];
            confidence?: number;
            class_id?: number;
            class_name?: string;
        }[];
        masks: Record<string, string>;
    }>;
    error?: string | null;
    message?: string;
}

router.post("/start-segmentation/:projectId",
    isAuth,
    injectGpuAuthToken,
    async (req: Request, res: Response) => {
        console.log("=== LOCAL BACKEND HIT /start-segmentation ===");
        const projectId = toSingleString(req.params.projectId);
        if (!projectId) {
            return res.status(400).json({ message: "Project ID is required." });
        }

        const segmentationModel = req.body?.segmentationModel || SegmentationModel.MEDSAM;
        // DEVELOPER NOTE: deviceType is only used by the UNET API inference path.
        // Supported values: "cpu", "cuda" (for NVIDIA GPU), or "auto" (GPU if available, else CPU).
        // For MEDSAM, the local GPU service resolves its own runtime device.
        const modelDevice = typeof req.body?.deviceType === "string" ? req.body.deviceType : "auto";
        logger.info(
            `${serviceLocation}: Received start inference request for project ${projectId} by user ${req.user?.username} with id ${req.user?._id}. model=${segmentationModel}, device=${modelDevice}`
        );

        try {
            if (segmentationModel === SegmentationModel.UNET) {
                // DEVELOPER NOTE: New Added UNET API inference path
                // - Uses FastAPI endpoint on the GPU inference service
                // - Shares remote API architecture style with MedSAM
                // - Uses gpuAuthToken for backend-to-GPU authentication
                const resultFromApi = await startModel2Inference(projectId, req.user, res.locals.gpuAuthToken, {
                    deviceType: modelDevice as "cpu" | "cuda" | "auto" | undefined,
                });
                if (resultFromApi.success) {
                    return res.status(200).json({ message: resultFromApi.message, uuid: resultFromApi.uuid });
                }
                return res.status(500).json({ message: resultFromApi.message });
            }

            if (segmentationModel !== SegmentationModel.MEDSAM) {
                return res.status(400).json({ error: "Unknown segmentation model" });
            }

            // DEVELOPER NOTE: MEDSAM inference path
            // - Sends inference request to the configured GPU service
            // - Requires valid gpuAuthToken (injected by injectGpuAuthToken middleware)
            // - Callback URL is used by GPU server to post results back
            // - deviceType parameter is ignored for MEDSAM (GPU type is managed by remote server)
            const result = await startInference(projectId, req.user, res.locals.gpuAuthToken);
            if (result.success) {
                return res.status(200).json({ message: result.message, uuid: result.uuid });
            }
            return res.status(500).json({ message: result.message });
        } catch (error: unknown) {
            LogError(error as Error, serviceLocation, "Error starting inference");
            if (!res.headersSent) {
                res.status(500).json({ message: "An unexpected error occurred while starting inference." });
            }
        }
    });

router.get("/segmentation-results/:projectId", isAuth, async (req: Request, res: Response) => {
    const projectId = toSingleString(req.params.projectId);

    if (!projectId) {
        logger.warn(`${serviceLocation}: Project ID is required to fetch segmentation masks.`);
        return res.status(400).json({ message: "Project ID is required." });
    }
    logger.info(`${serviceLocation}: Received request to fetch segmentation masks for project ID: ${projectId}`);
    try {
        const result = await readProjectSegmentationMask(projectId);
        if (!result.success) {
            if (result.message?.includes("does not exist")) {
                logger.warn(`${serviceLocation}: Project with ID ${projectId} not found when fetching segmentation masks.`);
                return res.status(404).json({ success: false, message: result.message });
            }
            logger.error(`${serviceLocation}: Error reading segmentation masks for project ${projectId}: ${result.message}`);
            return res.status(500).json({ success: false, message: result.message || "Error reading segmentation masks." });
        }
        if (!result.projectsegmentationmasks || result.projectsegmentationmasks.length === 0) {
            logger.info(`${serviceLocation}: No segmentation masks found for project ID ${projectId}.`);
            return res.status(200).json({
                message: "No segmentation masks found for this project.",
                success: false,
                segmentations: []
            });
        }
        logger.info(`${serviceLocation}: Successfully fetched ${result.projectsegmentationmasks.length} segmentation mask(s) for project ID ${projectId}.`);
        return res.status(200).json({ success: true, segmentations: result.projectsegmentationmasks });
    } catch (error) {
        LogError(error as Error, serviceLocation, `Unexpected error fetching segmentation masks for project ${projectId}`);
        return res.status(500).json({ message: "An unexpected error occurred while fetching segmentation masks." });
    }
});

router.post("/start-manual-segmentation/:projectId",
    isAuth,
    injectGpuAuthToken,
    async (req: Request, res: Response) => {
        const projectId = toSingleString(req.params.projectId);
        if (!projectId) {
            return res.status(400).json({ success: false, message: "Project ID is required." });
        }
        const userId = req.user?._id;
        const {
            image_name,
            bbox,
            segmentationName,
            segmentationDescription
        } = req.body;

        logger.info(`${serviceLocation}: Received new start MANUAL segmentation request for project ${projectId}, image ${image_name} by user ${req.user?.username} with id ${userId}`);

        if (!image_name || typeof image_name !== 'string') {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${projectId} is missing or has invalid 'image_name'.`);
            return res.status(400).json({ success: false, message: "Missing or invalid 'image_name' in request body." });
        }
        if (!bbox || !Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(coord => typeof coord === 'number')) {
            logger.warn(`${serviceLocation}: Manual segmentation request for project ${projectId}, image ${image_name} has invalid 'bbox'.`);
            return res.status(400).json({ success: false, message: "Invalid 'bbox' in request body. Expected an array of 4 numbers." });
        }
        if (!userId) {
            logger.warn(`${serviceLocation}: Unauthorized manual segmentation request for project ${projectId}. User not found.`);
            return res.status(401).json({ success: false, message: "Unauthorized. User not identified." });
        }

        try {
            logger.debug(`${serviceLocation}: Fetching project details for ${projectId} to get S3 URL.`);
            const projectResult = await readProject(projectId, userId.toString());
            if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
                logger.warn(`${serviceLocation}: Project ${projectId} not found or user ${userId} does not have access.`);
                return res.status(404).json({ success: false, message: "Project not found or access denied." });
            }
            const project = projectResult.projects[0];
            const s3HttpsUrlForTar = project.extractedfolderpath;
            if (!s3HttpsUrlForTar) {
                logger.warn(`${serviceLocation}: Project ${projectId} has no associated S3 file (extractedfolderpath missing).`);
                return res.status(404).json({ success: false, message: "Project has no associated file for segmentation." });
            }
            const objectKey = extractS3KeyFromUrl(s3HttpsUrlForTar);
            if (!objectKey) {
                logger.error(`${serviceLocation}: Invalid S3 URL format for project ${projectId}: ${s3HttpsUrlForTar}`);
                return res.status(500).json({ success: false, message: "Internal error: Invalid S3 URL format." });
            }
            const awsBucketName = process.env.AWS_BUCKET_NAME;
            if (!awsBucketName) {
                logger.error(`${serviceLocation}: AWS_BUCKET_NAME environment variable is not set.`);
                return res.status(500).json({ success: false, message: "Server configuration error: AWS bucket name missing." });
            }
            const presignedUrl = await generatePresignedGetUrlForInternalService(awsBucketName, objectKey, 1800);
            if (!presignedUrl) {
                logger.error(`${serviceLocation}: Failed to generate presigned URL for project ${projectId}, object ${objectKey}.`);
                return res.status(500).json({ success: false, message: "Failed to generate presigned URL." });
            }
            logger.info(`${serviceLocation}: Generated presigned URL for project ${projectId}.`);

            const gpuRequestId = uuidv4();

            const medsamBaseUrl = await resolveMedsamServerBaseUrl();
            if (!medsamBaseUrl) {
                logger.error(`${serviceLocation}: MedSAM server URL could not be resolved from local/remote configuration.`);
                return res.status(500).json({ success: false, message: "Server configuration error: MedSAM server details missing." });
            }

            const gpuServerUrl = `${medsamBaseUrl}/inference/v2/medsam-inference-manual`;
            logger.info(`${serviceLocation}: Sending request to GPU server ${gpuServerUrl} for image ${image_name} with UUID ${gpuRequestId}.`);
            const gpuServerPayload = { url: presignedUrl, uuid: gpuRequestId, image_name: image_name, bbox: bbox };

            const gpuResponse = await axios.post<GpuManualInferenceResponse>(gpuServerUrl, gpuServerPayload, {
                headers: {
                    'Authorization': `Bearer ${res.locals.gpuAuthToken}`,
                    'Content-Type': 'application/json',
                },
                timeout: 60000
            });

            logger.info(`${serviceLocation}: Received response from GPU server for UUID ${gpuResponse.data.uuid}, status ${gpuResponse.data.status}.`);

            if (gpuResponse.data.status !== "completed" || !gpuResponse.data.result) {
                const gpuErrorMsg = gpuResponse.data.error || gpuResponse.data.message || "Unknown GPU error";
                logger.error(`${serviceLocation}: GPU server returned status ${gpuResponse.data.status} or no result. Error: ${gpuErrorMsg}`);
                return res.status(500).json({ success: false, message: `GPU processing failed: ${gpuErrorMsg}` });
            }

            const gpuResultForImage = gpuResponse.data.result[image_name];
            if (!gpuResultForImage) {
                logger.error(`${serviceLocation}: GPU server response did not contain results for the requested image_name ${image_name}. Result keys: ${Object.keys(gpuResponse.data.result || {})}`);
                return res.status(500).json({ success: false, message: "GPU server response missing data for the image." });
            }

            let frameIndex = 0;
            let sliceIndex = 0;
            try {
                const nameParts = image_name.split('.')[0].split('_');
                if (nameParts.length >= 2) {
                    sliceIndex = parseInt(nameParts[nameParts.length - 1], 10);
                    frameIndex = parseInt(nameParts[nameParts.length - 2], 10);
                    if (isNaN(sliceIndex) || isNaN(frameIndex)) {
                        logger.warn(`${serviceLocation}: Could not parse valid frame/slice indices from ${image_name}. Defaulting to 0,0.`);
                        sliceIndex = 0; frameIndex = 0;
                    }
                } else {
                    logger.warn(`${serviceLocation}: image_name ${image_name} format not parsable for frame/slice. Defaulting to 0,0.`);
                }
            } catch (parseError) {
                logger.warn(`${serviceLocation}: Error parsing frame/slice from ${image_name}. Defaulting to 0,0. Error: ${parseError}`);
                sliceIndex = 0; frameIndex = 0;
            }

            const componentBoundingBoxes = gpuResultForImage.boxes.map(box => ({
                class: box.class_name === "manual" ? ComponentBoundingBoxesClass.MANUAL : (box.class_name as ComponentBoundingBoxesClass),
                confidence: box.confidence !== undefined ? box.confidence : 1,
                x_min: box.bbox[0],
                y_min: box.bbox[1],
                x_max: box.bbox[2],
                y_max: box.bbox[3]
            }));

            const segmentationMasks = Object.entries(gpuResultForImage.masks).map(([className, rleString]) => ({
                class: className === "manual" ? ComponentBoundingBoxesClass.MANUAL : (className as ComponentBoundingBoxesClass),
                segmentationmaskcontents: rleString
            }));

            const transformedSegmentationId = uuidv4();
            const transformedSegmentation: IProjectSegmentationMask = {
                _id: transformedSegmentationId,
                projectid: projectId,
                name: segmentationName || `Manual Segmentation - ${image_name}`,
                description: segmentationDescription || `Manually segmented region for ${image_name} using bbox: ${JSON.stringify(bbox)}`,
                isSaved: false,
                segmentationmaskRLE: true,
                isMedSAMOutput: false,
                frames: [{
                    frameindex: frameIndex,
                    frameinferred: true,
                    slices: [{
                        sliceindex: sliceIndex,
                        componentboundingboxes: componentBoundingBoxes,
                        segmentationmasks: segmentationMasks
                    }]
                }]
            };

            logger.info(`${serviceLocation}: Successfully transformed GPU result for project ${projectId}, image ${image_name}.`);
            res.status(200).json({ segmentations: [transformedSegmentation] });

        } catch (error: unknown) {
            LogError(error instanceof Error ? error : new Error(String(error)), serviceLocation, `Error in new start-manual-segmentation for project ${projectId}, image ${image_name}`);
            let errorMessage = "An unexpected error occurred while processing manual segmentation.";

            if (axios.isAxiosError(error)) {
                if (error.response) {
                    const responseData = error.response.data as Partial<GpuManualInferenceResponse>;
                    errorMessage = responseData?.error || responseData?.message || error.message || "Error from GPU server.";
                    logger.error(
                        `${serviceLocation}: Axios error - ${errorMessage}, ` +
                        `Status: ${error.response.status}, ` +
                        `Response Data: ${JSON.stringify(error.response.data)}`
                    );
                } else if (error.request) {
                    errorMessage = `No response received from GPU server: ${error.message}`;
                    logger.error(`${serviceLocation}: Axios error - ${errorMessage} (no response). Request details might be in error.config.`);
                } else {
                    errorMessage = `Error setting up request to GPU server: ${error.message}`;
                    logger.error(`${serviceLocation}: Axios error - ${errorMessage} (request setup).`);
                }
            } else if (error instanceof Error) {
                errorMessage = error.message;
            }

            if (!res.headersSent) {
                res.status(500).json({ success: false, message: errorMessage });
            }
        }
    });

router.get("/user-check-jobs", isAuth, async (req: Request, res: Response) => {
    const userId = req.user?._id;
    logger.info(`${serviceLocation}: Fetching all jobs for user ${req.user?.username}`);
    try {
        const jobs = await jobModel.find({ userid: userId }).sort({ createdAt: -1 }).limit(20);
        const pendingJobs = await jobModel.find({ status: JobStatus.PENDING }).sort({ createdAt: 1 });
        const activeJobCount = await jobModel.countDocuments({
            userid: userId,
            status: { $in: [JobStatus.PENDING, JobStatus.IN_PROGRESS] }
        });
        return res.status(200).json({
            success: true,
            activeJobCount,
            totalJobs: jobs.length,
            jobs: jobs.map(job => {
                let queuePosition = null;
                if (job.status === JobStatus.PENDING) {
                    queuePosition = pendingJobs.findIndex(j => j.uuid === job.uuid) + 1;
                }
                return {
                    jobId: job.uuid,
                    projectId: job.projectid,
                    status: job.status,
                    queuePosition: queuePosition,
                    message: job.message || "",
                    segmentationModel: job.segmentationModel || job.model_used || null,
                    createdAt: (job as any).createdAt?.toISOString?.() || null,
                    updatedAt: (job as any).updatedAt?.toISOString?.() || null
                };
            })
        });
    } catch (error: unknown) {
        LogError(error as Error, serviceLocation, `Error fetching jobs for user ${userId}`);
        return res.status(500).json({
            success: false,
            message: "An error occurred while fetching jobs"
        });
    }
});

router.get("/admin-check-all-jobs-status", isAuthAndAdmin, async (req: Request, res: Response) => {
    logger.info(`${serviceLocation}: Admin ${req.user?.username} requesting all system jobs`);
    try {
        const pendingCount = await jobModel.countDocuments({ status: JobStatus.PENDING });
        const processingCount = await jobModel.countDocuments({ status: JobStatus.IN_PROGRESS });
        const completedCount = await jobModel.countDocuments({ status: JobStatus.COMPLETED });
        const failedCount = await jobModel.countDocuments({ status: JobStatus.FAILED });
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;
        const jobs = await jobModel.find().sort({ createdAt: -1 }).skip(skip).limit(limit);
        const userIds = [...new Set(jobs.map(job => job.userid))];
        const users = await userModel.find({ _id: { $in: userIds } }).select('_id username');
        const userMap: Record<string, string> = {};
        users.forEach(user => {
            userMap[String(user._id)] = user.username;
        });
        return res.status(200).json({
            success: true,
            stats: {
                total: pendingCount + processingCount + completedCount + failedCount,
                pending: pendingCount,
                processing: processingCount,
                completed: completedCount,
                failed: failedCount
            },
            pagination: {
                page,
                limit,
                totalPages: Math.ceil((pendingCount + processingCount + completedCount + failedCount) / limit)
            },
            jobs: jobs.map(job => ({
                jobId: job.uuid,
                projectId: job.projectid,
                userId: job.userid,
                username: userMap[job.userid] || 'Unknown',
                status: job.status,
                message: job.message || ""
            }))
        });
    } catch (error: unknown) {
        LogError(error as Error, serviceLocation, `Admin error fetching all jobs: ${error instanceof Error ? error.message : String(error)}`);
        return res.status(500).json({
            success: false,
            message: "An error occurred while fetching all jobs"
        });
    }
});

router.patch("/save-ai-segmentation", isAuthAndNotGuest, async (req: Request, res: Response) => {
    try {
        const { segmentationMaskId } = req.body;
        const userId = (req.user)?._id;
        logger.info(`${serviceLocation}: Received request to mark AI segmentation mask ${segmentationMaskId} as saved by user ${userId}.`);
        if (!userId) {
            logger.warn(`${serviceLocation}: Unauthorized attempt to save AI segmentation. User ID not found.`);
            return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
        }
        if (!segmentationMaskId) {
            logger.warn(`${serviceLocation}: Missing segmentationMaskId for saving AI segmentation.`);
            return res.status(400).json({ success: false, message: "Missing segmentationMaskId." });
        }
        const maskResult = await readProjectSegmentationMask(segmentationMaskId);
        if (!maskResult.success || !maskResult.projectsegmentationmask) {
            logger.warn(`${serviceLocation}: AI Segmentation mask ${segmentationMaskId} not found. Message: ${maskResult.message}`);
            return res.status(404).json({ success: false, message: maskResult.message || "Segmentation mask not found." });
        }
        const projectId = maskResult.projectsegmentationmask.projectid;
        logger.debug(`${serviceLocation}: Updating AI segmentation mask ${segmentationMaskId} to isSaved: true.`);
        const segmentationDbUpdateResult = await updateProjectSegmentationMask(segmentationMaskId, { isSaved: true });
        if (!segmentationDbUpdateResult.success || !segmentationDbUpdateResult.projectsegmentationmask) {
            logger.error(`${serviceLocation}: Failed to update AI segmentation mask ${segmentationMaskId} status in database. Message: ${segmentationDbUpdateResult.message}`);
            return res.status(400).json({ success: false, message: segmentationDbUpdateResult.message || "Failed to update segmentation mask status in database." });
        }
        logger.info(`${serviceLocation}: Successfully updated AI segmentation mask ${segmentationMaskId} to isSaved: true in DB.`);
        logger.debug(`${serviceLocation}: Checking save status of parent project ${projectId} for AI segmentation mask ${segmentationMaskId}.`);
        const projectResult = await readProject(projectId, userId.toString());
        if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
            logger.warn(`${serviceLocation}: Could not find project ${projectId} to check/update save status after saving AI segmentation mask ${segmentationMaskId}.`);
        } else {
            const project = projectResult.projects[0];
            if (!project.isSaved) {
                logger.info(`${serviceLocation}: Parent project ${projectId} is not saved. Updating its status to saved.`);
                const updateProjectResult = await updateProject(projectId, { isSaved: true });
                if (!updateProjectResult.success) {
                    logger.warn(`${serviceLocation}: Failed to update project ${projectId} save status. Message: ${updateProjectResult.message}`);
                } else {
                    logger.info(`${serviceLocation}: Parent project ${projectId} save status successfully updated to true.`);
                }
            } else {
                logger.info(`${serviceLocation}: Parent project ${projectId} was already saved.`);
            }
        }
        logger.info(`${serviceLocation}: User ${userId} successfully marked AI segmentation mask ${segmentationMaskId} as saved. DB status updated.`);
        return res.status(200).json({
            success: true,
            message: "AI Segmentation mask marked as saved successfully.",
            segmentation: segmentationDbUpdateResult.projectsegmentationmask
        });
    } catch (error) {
        const segmentationMaskIdBody = req.body?.segmentationMaskId || "unknown";
        const errorMessage = error instanceof Error ? error.message : String(error);
        LogError(error instanceof Error ? error : new Error(errorMessage), serviceLocation, `Error marking AI segmentation mask as saved: ${segmentationMaskIdBody}`);
        return res.status(500).json({ success: false, message: "An unexpected error occurred while saving the AI segmentation." });
    }
}
);

function mergeFramesData(
    existingFrames: IProjectSegmentationMaskDocument['frames'] | undefined,
    requestedFramesPayload: IProjectSegmentationMaskDocument['frames']
): IProjectSegmentationMaskDocument['frames'] {
    const baseFrames = existingFrames ? JSON.parse(JSON.stringify(existingFrames)) : [];
    const framesMap = new Map<number, IProjectSegmentationMaskDocument['frames'][0]>();

    for (const frame of baseFrames) {
        framesMap.set(frame.frameindex, frame);
    }

    for (const reqFrame of requestedFramesPayload) {
        const dbFrame = framesMap.get(reqFrame.frameindex);

        if (!dbFrame) {
            framesMap.set(reqFrame.frameindex, JSON.parse(JSON.stringify(reqFrame)));
            continue;
        }

        if (reqFrame.frameinferred !== undefined) {
            dbFrame.frameinferred = reqFrame.frameinferred;
        }

        if (reqFrame.slices !== undefined) {
            const slicesMap = new Map<number, IProjectSegmentationMaskDocument['frames'][0]['slices'][0]>();
            const currentSlicesOfDbFrame = Array.isArray(dbFrame.slices) ? dbFrame.slices : [];
            for (const slice of currentSlicesOfDbFrame) {
                slicesMap.set(slice.sliceindex, slice);
            }

            for (const reqSlice of reqFrame.slices) {
                const dbSlice = slicesMap.get(reqSlice.sliceindex);
                if (dbSlice) {
                    if (reqSlice.componentboundingboxes !== undefined) {
                        dbSlice.componentboundingboxes = JSON.parse(JSON.stringify(reqSlice.componentboundingboxes));
                    }
                    if (reqSlice.segmentationmasks !== undefined) {
                        dbSlice.segmentationmasks = JSON.parse(JSON.stringify(reqSlice.segmentationmasks));
                    }
                } else {
                    slicesMap.set(reqSlice.sliceindex, JSON.parse(JSON.stringify(reqSlice)));
                }
            }
            dbFrame.slices = Array.from(slicesMap.values()).sort((a, b) => a.sliceindex - b.sliceindex);
        }
    }
    return Array.from(framesMap.values()).sort((a, b) => a.frameindex - b.frameindex);
}

router.put("/save-manual-segmentation/:projectId",
    isAuthAndNotGuest,
    async (req: Request, res: Response) => {
        const projectId = toSingleString(req.params.projectId);
        const userId = req.user?._id;
        const { name, description, frames: framesFromBody, model } = req.body as {
            name?: string;
            description?: string;
            frames?: IProjectSegmentationMask['frames'];
            model?: string;
        };

        logger.info(`${serviceLocation}: Received request to update manual segmentation for project ${projectId} by user ${userId}`);

        if (!userId) {
            logger.warn(`${serviceLocation}: Unauthorized attempt to save manual segmentation for project ${projectId}. User not found.`);
            return res.status(401).json({ success: false, message: "Unauthorized. User not identified." });
        }

        if (!projectId) {
            logger.warn(`${serviceLocation}: Project ID is required to update manual segmentation.`);
            return res.status(400).json({ success: false, message: "Project ID is required." });
        }

        if (name === undefined && description === undefined && framesFromBody === undefined) {
            logger.warn(`${serviceLocation}: Missing or empty segmentation data in request body for project ${projectId}.`);
            return res.status(400).json({ success: false, message: "No updatable segmentation data provided in request body." });
        }

        try {
            const masksResult = await readProjectSegmentationMask(projectId);

            if (!masksResult.success || !masksResult.projectsegmentationmasks) {
                if (masksResult.message?.includes("does not exist")) {
                    logger.warn(`${serviceLocation}: Project ${projectId} not found when attempting to update manual segmentation.`);
                    return res.status(404).json({ success: false, message: `Project ${projectId} not found.` });
                }
                logger.error(`${serviceLocation}: Error reading segmentation masks for project ${projectId}: ${masksResult.message}`);
                return res.status(500).json({ success: false, message: masksResult.message || "Error finding segmentation masks." });
            }

            // Scope the editable-mask lookup to the model the request is
            // targeting. With per-model Manual docs (one for MedSAM, one for
            // UNET), a plain `!isMedSAMOutput` filter would non-deterministically
            // pick whichever doc happens to come first and overwrite the
            // wrong model's edits. We prefer an exact `segmentationModel`
            // match; if the request omits `model` or no model-tagged doc
            // exists (legacy data from before the per-model split), fall
            // back to the first non-AI doc to preserve old behavior.
            const requestedModel =
                typeof model === "string" ? model.toLowerCase() : undefined;
            const candidateMasks = masksResult.projectsegmentationmasks.filter(
                mask => !mask.isMedSAMOutput
            );
            const modelMatchedMask = requestedModel
                ? candidateMasks.find(mask => {
                      const tag = (
                          (mask as any).segmentationModel ||
                          (mask as any).model_used ||
                          ""
                      )
                          .toString()
                          .toLowerCase();
                      return tag === requestedModel;
                  })
                : undefined;
            const editableMask = (modelMatchedMask || candidateMasks[0]) as
                | IProjectSegmentationMaskDocument
                | undefined;

            if (!editableMask || !editableMask._id) {
                logger.warn(`${serviceLocation}: No editable (isMedSAMOutput: false) segmentation mask found for project ${projectId} (requestedModel=${requestedModel ?? "<none>"}).`);
                return res.status(404).json({ success: false, message: "No editable segmentation mask found for this project." });
            }

            logger.info(`${serviceLocation}: Found editable segmentation mask with ID ${editableMask._id} for project ${projectId} (requestedModel=${requestedModel ?? "<none>"}, matchedByModel=${!!modelMatchedMask}).`);

            const updatePayload: Partial<IProjectSegmentationMask> & { model?: string } = {
                isSaved: true,
            };

            if (name !== undefined) {
                updatePayload.name = name;
            } else {
                updatePayload.name = editableMask.name;
            }

            if (description !== undefined) {
                updatePayload.description = description;
            } else {
                updatePayload.description = editableMask.description;
            }

            if (model !== undefined) {
                updatePayload.model = model;
            }

            if (framesFromBody !== undefined) {
                if (Array.isArray(framesFromBody)) {
                    updatePayload.frames = mergeFramesData(editableMask.frames, framesFromBody);
                } else {
                    logger.warn(`${serviceLocation}: 'frames' provided in body but is not an array for project ${projectId}. Preserving existing frames.`);
                    updatePayload.frames = editableMask.frames;
                }
            } else {
                updatePayload.frames = editableMask.frames;
            }

            const segmentationDbUpdateResult = await updateProjectSegmentationMask(
                editableMask._id.toString(),
                updatePayload as Partial<IProjectSegmentationMaskDocument>
            );

            if (!segmentationDbUpdateResult.success || !segmentationDbUpdateResult.projectsegmentationmask) {
                logger.error(`${serviceLocation}: Failed to update manual segmentation mask ${editableMask._id} in database. Message: ${segmentationDbUpdateResult.message}`);
                return res.status(500).json({ success: false, message: segmentationDbUpdateResult.message || "Failed to update segmentation mask." });
            }

            logger.info(`${serviceLocation}: Successfully updated manual segmentation mask ${editableMask._id} for project ${projectId}.`);

            const projectResult = await readProject(projectId, userId.toString());
            if (projectResult.success && projectResult.projects && projectResult.projects.length > 0) {
                const project = projectResult.projects[0];
                if (!project.isSaved) {
                    logger.info(`${serviceLocation}: Parent project ${projectId} is not saved. Updating its status to saved.`);
                    const updateProjectResult = await updateProject(projectId, { isSaved: true });
                    if (!updateProjectResult.success) {
                        logger.warn(`${serviceLocation}: Failed to update project ${projectId} save status. Message: ${updateProjectResult.message}`);
                    } else {
                        logger.info(`${serviceLocation}: Parent project ${projectId} save status successfully updated to true.`);
                    }
                } else {
                    logger.info(`${serviceLocation}: Parent project ${projectId} was already saved.`);
                }
            } else {
                logger.warn(`${serviceLocation}: Could not find project ${projectId} to check/update save status after updating manual segmentation.`);
            }

            return res.status(200).json({
                success: true,
                message: "Manual segmentation updated and saved successfully.",
                segmentation: segmentationDbUpdateResult.projectsegmentationmask
            });

        } catch (error: unknown) {
            LogError(error instanceof Error ? error : new Error(String(error)), serviceLocation, `Error updating manual segmentation for project ${projectId}`);
            if (!res.headersSent) {
                res.status(500).json({ success: false, message: "An unexpected error occurred while updating manual segmentation." });
            }
        }
    });

// Route to export project data as a NIfTI segmentation mask
router.get("/export-project-data/:projectId", isAuth, async (req: Request, res: Response) => {
    const projectId = toSingleString(req.params.projectId);
    const userId = req.user?._id;
    const serviceLocationExport = `${serviceLocation}/exportProjectDataNifti`;
    const tempExportId = uuidv4();
    const baseTempDir = path.join(__dirname, '..', 'temp_exports', tempExportId);
    const segmentationsJsonPath = path.join(baseTempDir, 'segmentations.json');
    const localOutputSegmentationNiftiPath = path.join(baseTempDir, `segmentation_output_${tempExportId}.nii.gz`);

    logger.info(`${serviceLocationExport}: Request to export NIfTI segmentation for project ${projectId} by user ${userId}. Temp ID: ${tempExportId}`);

    if (!projectId) {
        return res.status(400).json({ success: false, message: "Project ID is required." });
    }

    // If project does not have segmentation mask, throw error 
    const hasMasksResult = await readProjectSegmentationMask(projectId);
    // Check if masks actually exist - reject export if no masks available
    if (!hasMasksResult.projectsegmentationmasks || hasMasksResult.projectsegmentationmasks.length === 0) {
        logger.warn(`${serviceLocationExport}: No segmentation masks found for project ${projectId}. Export requires completed segmentation.`);
        return res.status(400).json({
            success: false,
            message: "Export requires completed segmentation masks. Please complete segmentation before exporting."
        });
    }

    logger.info(`${serviceLocationExport}: Found ${hasMasksResult.projectsegmentationmasks.length} segmentation mask(s) for project ${projectId}. Proceeding with export.`);

    try {
        await fs.ensureDir(baseTempDir);

        // 1. Read Project Details (including dimensions and original NIfTI path)
        const projectResult = await readProject(projectId, userId);
        if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
            logger.warn(`${serviceLocationExport}: Project ${projectId} not found or user ${userId} does not have access. Message: ${projectResult.message}`);
            return res.status(404).json({ success: false, message: projectResult.message || "Project not found or access denied." });
        }
        const project: IProjectDocument = projectResult.projects[0]; // IProject should be imported

        if (!project.dimensions || project.dimensions.width == null || project.dimensions.height == null) {
            logger.error(`${serviceLocationExport}: Project ${projectId} is missing critical dimension data (width/height). Cannot proceed with NIfTI export.`);
            return res.status(500).json({ success: false, message: "Project is missing critical dimension data." });
        }
        const planeHeightForRLE = project.dimensions.height;
        const planeWidthForRLE = project.dimensions.width;

        // 2. Read All Segmentation Masks and create segmentations.json
        // Note: We already validated masks exist in the early check above
        const segmentationMasksResult = await readProjectSegmentationMask(projectId);
        let segmentationsToProcess: IProjectSegmentationMask[] = [];

        // Optional model query param (medsam | unet) — prefer an editable mask
        // tagged with that model; fall back to first editable; fall back to first mask.
        const requestedExportModel = typeof req.query.model === "string"
            ? req.query.model.toLowerCase()
            : undefined;

        const editableMasks = segmentationMasksResult.projectsegmentationmasks!.filter(
            mask => mask.isMedSAMOutput === false
        );

        const modelMatchedMask = requestedExportModel
            ? editableMasks.find(mask => {
                  const tag = (
                      (mask as any).segmentationModel ||
                      (mask as any).model_used ||
                      ""
                  ).toString().toLowerCase();
                  return tag === requestedExportModel;
              })
            : undefined;

        const chosenMask = modelMatchedMask ?? editableMasks[0] ?? segmentationMasksResult.projectsegmentationmasks![0];

        logger.info(
            `${serviceLocationExport}: Exporting mask for project ${projectId} ` +
            `(requestedModel=${requestedExportModel ?? "<none>"}, ` +
            `matchedByModel=${!!modelMatchedMask}, ` +
            `maskId=${(chosenMask as any)?._id ?? "<unknown>"}).`
        );
        segmentationsToProcess = [chosenMask];

        await fs.writeJson(segmentationsJsonPath, segmentationsToProcess, { spaces: 2 });
        logger.info(`${serviceLocationExport}: Created segmentations.json for project ${projectId} at ${segmentationsJsonPath}`);

        // 4. Call Python script to create the segmentation NIfTI
        // Check if we have stored affine matrix to avoid downloading original file
        let pythonScriptPath: string;
        let pythonCommand: string;

        if (project.affineMatrix && Array.isArray(project.affineMatrix) && project.affineMatrix.length > 0) {
            // Use stored affine matrix approach (no download needed)
            logger.info(`${serviceLocationExport}: Using stored affine matrix for project ${projectId} - no download required.`);

            pythonScriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'create_nifti_with_stored_affine.py');

            // Write JSON arguments to temporary files to avoid command line escaping issues
            const affineMatrixFile = path.join(baseTempDir, 'affine_matrix.json');
            const dimensionsFile = path.join(baseTempDir, 'dimensions.json');

            await fs.writeJson(affineMatrixFile, project.affineMatrix);
            await fs.writeJson(dimensionsFile, project.dimensions);

            const datatype = project.datatype || 'uint8';

            pythonCommand = `python "${pythonScriptPath}" "${segmentationsJsonPath}" "${localOutputSegmentationNiftiPath}" "${affineMatrixFile}" "${dimensionsFile}" "${datatype}" "${planeHeightForRLE}" "${planeWidthForRLE}"`;
        } else {
            // Fallback to original approach (download and extract from file)
            logger.info(`${serviceLocationExport}: No stored affine matrix found for project ${projectId}. Using original file download approach.`);

            // Download original file first
            const tempOriginalNiftiPath = path.join(baseTempDir, `original_${tempExportId}.nii.gz`);
            const s3BucketName = process.env.AWS_BUCKET_NAME;
            if (!project.originalfilepath || !s3BucketName) {
                logger.error(`${serviceLocationExport}: Original NIfTI file path or S3 bucket name missing for project ${projectId}.`);
                return res.status(500).json({ success: false, message: "Configuration error: Missing original NIfTI path or S3 bucket." });
            }

            const originalNiftiS3Key = extractS3KeyFromUrl(project.originalfilepath);
            if (!originalNiftiS3Key) {
                logger.error(`${serviceLocationExport}: Could not extract S3 key from originalfilepath: ${project.originalfilepath}`);
                return res.status(500).json({ success: false, message: "Configuration error: Invalid original NIfTI S3 URL." });
            }

            logger.info(`${serviceLocationExport}: Downloading original NIfTI ${originalNiftiS3Key} to ${tempOriginalNiftiPath}`);
            await downloadFromS3(s3BucketName, originalNiftiS3Key, tempOriginalNiftiPath);

            pythonScriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'create_nifti_from_segmentations.py');
            pythonCommand = `python "${pythonScriptPath}" "${segmentationsJsonPath}" "${tempOriginalNiftiPath}" "${localOutputSegmentationNiftiPath}" "${planeHeightForRLE}" "${planeWidthForRLE}"`;
        }

        logger.info(`${serviceLocationExport}: Executing Python script: ${pythonCommand}`);
        await new Promise<void>((resolve, reject) => {
            exec(pythonCommand, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
                if (error) {
                    logger.error(`${serviceLocationExport}: Python script error for project ${projectId}: ${stderr || error.message}`);
                    return reject(new Error(`NIfTI creation failed: ${stderr || error.message}`));
                }
                logger.info(`${serviceLocationExport}: Python script stdout for project ${projectId}: ${stdout}`);
                if (stderr) logger.warn(`${serviceLocationExport}: Python script stderr for project ${projectId}: ${stderr}`);

                const niftiPathMatch = stdout.match(/NIFTI_FILE_PATH:(.*)/);
                if (!niftiPathMatch || !niftiPathMatch[1] || !fs.existsSync(niftiPathMatch[1].trim())) {
                    return reject(new Error(`Output NIfTI path not found in Python script output or file does not exist. Output: ${stdout}`));
                }
                resolve();
            });
        });

        // 5. Upload the generated segmentation NIfTI to S3
        let baseExportName = project.name.replace(/[^a-zA-Z0-9_.-]+/g, '_');
        if (project.originalfilename) {
            const originalName = project.originalfilename;
            let base = path.basename(originalName, path.extname(originalName));
            if (originalName.toLowerCase().endsWith(".nii.gz")) {
                base = path.basename(originalName, ".nii.gz");
            }
            baseExportName = base.replace(/[^a-zA-Z0-9_.-]+/g, '_');
        }
        const suggestedNiftiFilename = `${baseExportName}_segmentation.nii.gz`;
        logger.info(`${serviceLocationExport}: Suggested filename for export NIfTI: ${suggestedNiftiFilename}`);

        const exportNiftiFileStream = fs.createReadStream(localOutputSegmentationNiftiPath);
        // This call expects uploadMaskToS3 to take 6 arguments
        const exportS3Url = await uploadMaskToS3(
            exportNiftiFileStream, // 1. fileStream
            userId || 'system',    // 2. userId
            tempExportId,          // 3. fileId
            '.nii.gz',             // 4. fileExtension
            `project_segmentations_nifti/${projectId}/`, // 5. s3KeyPrefix
            suggestedNiftiFilename // 6. suggestedFilename 
        );

        if (!exportS3Url) {
            throw new Error("Failed to upload segmentation NIfTI to S3 or get S3 URL.");
        }

        // 6. Generate Presigned URL for the uploaded NIfTI
        const finalS3Key = extractS3KeyFromUrl(exportS3Url);
        if (!finalS3Key) {
            throw new Error(`Could not extract S3 key from the uploaded export URL: ${exportS3Url}`);
        }

        // Get file size for debugging before cleanup
        const fileStat = await fs.stat(localOutputSegmentationNiftiPath);
        logger.info(`${serviceLocationExport}: NIfTI file created with size: ${fileStat.size} bytes`);

        const s3BucketName = process.env.AWS_BUCKET_NAME;
        if (!s3BucketName) {
            throw new Error("AWS_BUCKET_NAME environment variable is not set");
        }

        const presignedExportUrl = await generatePresignedGetUrlForBrowser(s3BucketName, finalS3Key, 3600);

        if (!presignedExportUrl) {
            throw new Error("Failed to generate presigned URL for the segmentation NIfTI.");
        }

        logger.info(`${serviceLocationExport}: Successfully prepared NIfTI segmentation for project ${projectId}. Presigned URL: ${presignedExportUrl}`);
        return res.status(200).json({
            success: true,
            message: "NIfTI segmentation exported successfully.",
            projectId: project._id,
            projectName: project.name,
            exportPackageUrl: presignedExportUrl,
            exportPackageUrlExpiresAt: Date.now() + (3600 * 1000),
            exportContentType: "application/gzip",
            fileSizeBytes: fileStat.size,
            suggestedFilename: suggestedNiftiFilename
        });

    } catch (error) {
        LogError(error as Error, serviceLocationExport, `Error exporting NIfTI segmentation for project ${projectId}`);
        return res.status(500).json({
            success: false,
            message: "An unexpected error occurred while exporting NIfTI segmentation."
        });
    } finally {
        if (await fs.pathExists(baseTempDir)) {
            logger.info(`${serviceLocationExport}: Cleaning up temporary export directory ${baseTempDir} for project ${projectId}`);
            await fs.remove(baseTempDir);
        }
    }
});

// Batch endpoint for checking segmentation status of multiple projects
router.post("/batch-segmentation-status", isAuth, async (req: Request, res: Response) => {
    const { projectIds } = req.body;
    const userId = req.user?._id;

    logger.info(`${serviceLocation}: Batch segmentation status check for ${projectIds?.length || 0} projects by user ${req.user?.username}`);

    if (!userId) {
        logger.warn(`${serviceLocation}: User ID not found in request.`);
        return res.status(401).json({
            success: false,
            message: "Authentication required."
        });
    }

    if (!projectIds || !Array.isArray(projectIds) || projectIds.length === 0) {
        logger.warn(`${serviceLocation}: Invalid or empty projectIds array in batch segmentation status request.`);
        return res.status(400).json({
            success: false,
            message: "projectIds array is required and must not be empty."
        });
    }

    // Limit batch size to prevent abuse
    if (projectIds.length > 50) {
        logger.warn(`${serviceLocation}: Batch size too large: ${projectIds.length} projects requested.`);
        return res.status(400).json({
            success: false,
            message: "Batch size limited to 50 projects per request."
        });
    }

    try {
        // 1. Verify user owns all requested projects
        const userProjectsResult = await readProject(undefined, userId.toString());
        if (!userProjectsResult.success || !userProjectsResult.projects) {
            logger.error(`${serviceLocation}: Failed to fetch user projects for batch status check.`);
            return res.status(500).json({
                success: false,
                message: "Failed to verify project ownership."
            });
        }

        const userProjectIds = userProjectsResult.projects.map((p: IProjectDocument) => String(p._id));
        const unauthorizedProjects = projectIds.filter((id: string) => !userProjectIds.includes(id));

        if (unauthorizedProjects.length > 0) {
            logger.warn(`${serviceLocation}: User ${userId} attempted to check segmentation status for unauthorized projects: ${unauthorizedProjects.join(', ')}`);
            return res.status(403).json({
                success: false,
                message: "Access denied to some requested projects."
            });
        }

        // 2. Batch query segmentation masks using MongoDB aggregation
        const segmentationResults = await projectSegmentationMaskModel.aggregate([
            {
                $match: {
                    projectid: { $in: projectIds }
                }
            },
            {
                $group: {
                    _id: "$projectid",
                    maskCount: { $sum: 1 },
                    hasMasks: { $sum: { $cond: [{ $gt: ["$frames", []] }, 1, 0] } }
                }
            }
        ]);

        // 3. Build response object with status for each project
        const statusMap: Record<string, { hasMasks: boolean; maskCount: number }> = {};

        // Initialize all projects as having no masks
        projectIds.forEach((projectId: string) => {
            statusMap[projectId] = { hasMasks: false, maskCount: 0 };
        });

        // Update with actual results
        segmentationResults.forEach((result: { _id: string; maskCount: number; hasMasks: number }) => {
            statusMap[result._id] = {
                hasMasks: result.hasMasks > 0,
                maskCount: result.maskCount
            };
        });

        logger.info(`${serviceLocation}: Successfully processed batch segmentation status for ${projectIds.length} projects. Found masks for ${segmentationResults.length} projects.`);

        return res.status(200).json({
            success: true,
            statuses: statusMap
        });

    } catch (error: unknown) {
        LogError(error as Error, serviceLocation, `Error in batch segmentation status check for user ${userId}`);
        return res.status(500).json({
            success: false,
            message: "An error occurred while checking segmentation status."
        });
    }
});

// ── POST /segmentation/compute-strain-from-frames ────────────────────────────
// Decodes ED and ES frames from the stored RLE segmentation, generates NIfTI
// files via Python, and proxies them to the GPU /bullseye/compute-strain.
router.post("/compute-strain-from-frames", isAuth, async (req: Request, res: Response) => {
    const userId = (req.user as any)?._id?.toString();
    const { projectId, edFrameIndex, esFrameIndex, modelType } = req.body;

    if (!projectId || edFrameIndex === undefined || esFrameIndex === undefined) {
        return res.status(400).json({ error: "projectId, edFrameIndex, esFrameIndex required" });
    }
    if (edFrameIndex === esFrameIndex) {
        return res.status(400).json({ error: "ED and ES frame indices must be different" });
    }

    const tempId = uuidv4();
    const baseTempDir = path.join(__dirname, '..', 'temp_exports', `strain_frames_${tempId}`);

    try {
        // 1. Verify project access
        const projectResult = await readProject(projectId, userId);
        if (!projectResult.success || !projectResult.projects?.length) {
            return res.status(403).json({ error: "Project not found or access denied." });
        }
        const project = projectResult.projects[0] as IProjectDocument;
        const W = project.dimensions?.width;
        const H = project.dimensions?.height;
        if (!W || !H) {
            return res.status(400).json({ error: "Project is missing dimension data." });
        }

        // 2. Find the editable segmentation mask matching the requested model with the most frames
        const allMasks = await projectSegmentationMaskModel.find({
            projectid: projectId,
            segmentationModel: modelType ?? "unet",
            isMedSAMOutput: false,
            "frames.0": { $exists: true },
        }).lean();

        if (!allMasks || allMasks.length === 0) {
            return res.status(404).json({ error: `No ${modelType ?? "unet"} segmentation mask with stored frames found for this project. Run ${modelType ?? "unet"} segmentation first.` });
        }

        const maskDoc = allMasks.reduce((best: any, m: any) =>
            (m.frames?.length ?? 0) > (best.frames?.length ?? 0) ? m : best
        );

        logger.info(`${serviceLocation}: compute-strain-from-frames maskDoc found: id=${maskDoc._id} totalFrames=${maskDoc.frames?.length} frameIndices=${(maskDoc.frames as any[])?.map((f: any) => f.frameindex).join(',')}`);

        logger.info(`${serviceLocation}: compute-strain-from-frames looking for edFrameIndex=${edFrameIndex} esFrameIndex=${esFrameIndex} in ${maskDoc.frames?.length} stored frames`);
        const frames = (maskDoc as any).frames ?? [];
        const edFrame = frames.find((f: any) => f.frameindex === edFrameIndex);
        const esFrame = frames.find((f: any) => f.frameindex === esFrameIndex);
        if (!edFrame) {
            logger.error(`${serviceLocation}: Frame ${edFrameIndex} not found. Available: ${(maskDoc.frames as any[])?.map((f: any) => f.frameindex).join(',')}`);
            return res.status(404).json({ error: `Frame ${edFrameIndex} not found in stored segmentation` });
        }
        if (!esFrame) {
            logger.error(`${serviceLocation}: Frame ${esFrameIndex} not found. Available: ${(maskDoc.frames as any[])?.map((f: any) => f.frameindex).join(',')}`);
            return res.status(404).json({ error: `Frame ${esFrameIndex} not found in stored segmentation` });
        }

        // 3. GPU connection
        const gpuBaseUrl = await getFreshGPUServerAddress();
        const token = getCurrentToken();
        if (!gpuBaseUrl || !token) {
            return res.status(503).json({ error: "GPU service unavailable." });
        }

        await fs.ensureDir(baseTempDir);

        // 4. Generate NIfTI for each frame via Python (same pattern as recomputeBullseyeWithLandmarks)
        const buildNIfTI = async (frame: any, label: string): Promise<string> => {
            const niftiPath = path.join(baseTempDir, `${label}_${tempId}.nii.gz`);
            const segJsonPath = path.join(baseTempDir, `${label}_${tempId}.json`);

            // Wrap the single frame in the mask doc shape the Python script expects.
            // frameindex is reset to 0 so Python places data at slot 0.
            // project.dimensions.frames is overridden to 1 so the Python script creates a
            // 1-frame NIfTI (not a 25-frame one with 24 empty frames), which would distort strain.
            const singleFrameDoc = { ...frame, frameindex: 0 };
            const singleFrameMaskDoc = { ...maskDoc, frames: [singleFrameDoc] };
            await fs.writeJson(segJsonPath, [singleFrameMaskDoc], { spaces: 2 });

            let pythonCommand: string;
            if (project.affineMatrix && Array.isArray(project.affineMatrix) && project.affineMatrix.length > 0) {
                const affineFile = path.join(baseTempDir, `affine_${label}.json`);
                const dimsFile   = path.join(baseTempDir, `dims_${label}.json`);
                await fs.writeJson(affineFile, project.affineMatrix, { spaces: 2 });
                await fs.writeJson(dimsFile,   { width: W, height: H, slices: project.dimensions?.slices ?? 0, frames: 1 }, { spaces: 2 });
                logger.info(`${serviceLocation}: compute-strain-from-frames [${label}] seg JSON frames=${singleFrameMaskDoc.frames.length} frameindex=${singleFrameDoc.frameindex} dimsFrames=1`);
                const scriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'create_nifti_with_stored_affine.py');
                pythonCommand = `python3 "${scriptPath}" "${segJsonPath}" "${niftiPath}" "${affineFile}" "${dimsFile}" "uint8" ${H} ${W}`;
            } else {
                const s3Url = (project as any).extractedfolderpath;
                if (!s3Url) throw new Error(`Project ${projectId} has no affine matrix and no S3 URL`);
                const scriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'create_nifti_from_segmentations.py');
                pythonCommand = `python3 "${scriptPath}" "${segJsonPath}" "${niftiPath}" ${W} ${H} "${s3Url}"`;
            }

            await new Promise<void>((resolve, reject) => {
                exec(pythonCommand, (error, stdout, stderr) => {
                    if (stdout) logger.info(`${serviceLocation}: Python [${label}] stdout: ${stdout.trim()}`);
                    if (stderr) logger.warn(`${serviceLocation}: Python [${label}] stderr: ${stderr.trim()}`);
                    if (error) reject(new Error(`NIfTI generation failed for ${label}: ${stderr || error.message}`));
                    else resolve();
                });
            });

            if (!(await fs.pathExists(niftiPath))) {
                throw new Error(`NIfTI file not produced for ${label}`);
            }
            return niftiPath;
        };

        const [edPath, esPath] = await Promise.all([
            buildNIfTI(edFrame, "ed"),
            buildNIfTI(esFrame, "es"),
        ]);

        // 5. Look up landmark coords for automatic alignment. Prefer a saved,
        // user-edited landmark doc (isModelOutput: false) scoped to the same
        // segmentation model the strain request is using; fall back to the
        // raw GPU job result if the user has never saved landmark edits for
        // this model. This mirrors segmentation masks preferring the
        // editable doc over the raw AI output.
        const extractCoord = (lm: any): { x: number; y: number } | null => {
            if (!lm) return null;
            if (typeof lm.x === "number" && typeof lm.y === "number") return { x: lm.x, y: lm.y };
            if (Array.isArray(lm) && lm.length >= 2) return { x: lm[0], y: lm[1] };
            return null;
        };

        let lm1: { x: number; y: number } | null = null;
        let lm2: { x: number; y: number } | null = null;

        // Landmark edits are shared across segmentation models (one editable doc
        // per project) — a corrected RV insertion point is an anatomical image
        // location, not a per-model value. So we do NOT filter by segmentationModel
        // here; that would miss the user's edits whenever the active strain model
        // differs from the model that was active when the doc was last saved.
        // (The segmentation MASK input above IS still per-model — only the
        // landmark alignment points are shared.)
        const savedLandmarkDoc = await projectLandmarkModel
            .findOne({ projectid: projectId, isModelOutput: false })
            .sort({ updatedAt: -1 })
            .lean();

        if (savedLandmarkDoc) {
            // Average rv_insertion_1 / rv_insertion_2 points across every frame/slice,
            // matching the GPU's own unconditional-mean avg_lm1/avg_lm2 aggregation
            // (visheart-inference-gpu/app/helpers/landmark_inference_api.py lines 410-432).
            const lm1Points: { x: number; y: number }[] = [];
            const lm2Points: { x: number; y: number }[] = [];
            for (const frame of (savedLandmarkDoc as any).frames ?? []) {
                for (const slice of frame.slices ?? []) {
                    for (const point of slice.landmarks ?? []) {
                        if (point.key === "rv_insertion_1") lm1Points.push({ x: point.x, y: point.y });
                        if (point.key === "rv_insertion_2") lm2Points.push({ x: point.x, y: point.y });
                    }
                }
            }
            const mean = (points: { x: number; y: number }[]): { x: number; y: number } | null =>
                points.length
                    ? { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length }
                    : null;
            lm1 = mean(lm1Points);
            lm2 = mean(lm2Points);
            logger.info(`${serviceLocation}: compute-strain-from-frames using saved landmark edits (doc ${savedLandmarkDoc._id}) for project ${projectId}.`);
        }

        if (!lm1 || !lm2) {
            const landmarkJob = await jobModel
                .findOne({ projectid: projectId, model_used: /landmark/i, status: JobStatus.COMPLETED, result: { $exists: true, $ne: null } })
                .sort({ updatedAt: -1 })
                .lean();
            const lmResult = landmarkJob?.result
                ? (typeof landmarkJob.result === "string" ? JSON.parse(landmarkJob.result) : landmarkJob.result)
                : null;
            lm1 = lm1 ?? extractCoord(lmResult?.avg_lm1);
            lm2 = lm2 ?? extractCoord(lmResult?.avg_lm2);
        }

        // 6. POST both NIfTI files to GPU
        const FormDataNode = require("form-data");
        const form = new FormDataNode();
        form.append("ed_file", fs.createReadStream(edPath), { filename: "ed.nii.gz", contentType: "application/gzip" });
        form.append("es_file", fs.createReadStream(esPath), { filename: "es.nii.gz", contentType: "application/gzip" });
        if (lm1) {
            form.append("rv_insertion_1_x", String(lm1.x));
            form.append("rv_insertion_1_y", String(lm1.y));
        }
        if (lm2) {
            form.append("rv_insertion_2_x", String(lm2.x));
            form.append("rv_insertion_2_y", String(lm2.y));
        }

        const gpuRes = await axios.post(`${gpuBaseUrl}/bullseye/compute-strain`, form, {
            headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
            timeout: 120000,
        });

        // 7. Clean up and return
        await fs.remove(baseTempDir);

        // Persist the strain result on the mask doc so the strain page can reload
        // it instead of recomputing on every visit (mirrors bullseye/heartMetrics).
        // Keyed by the ED/ES frames + model used so the frontend can tell whether
        // a stored result matches the currently-selected frames. Best-effort:
        // a failed write never fails the request.
        //
        // Also backfill heartMetrics.measurements.PeakGRS/PeakGCS from the strain
        // peaks (they were null placeholders — the metrics module doesn't compute
        // strain), so the flat measurements block downstream consumers read is
        // complete. Then auto-fire the disease-similarity assessment now that both
        // halves of its input (volumes + strain peaks) exist — no manual trigger.
        try {
            const gGRS = typeof gpuRes.data?.global_grs === "number" ? gpuRes.data.global_grs : null;
            const gGCS = typeof gpuRes.data?.global_gcs === "number" ? gpuRes.data.global_gcs : null;

            const setFields: Record<string, any> = {
                strain: {
                    ...gpuRes.data,
                    edFrameIndex,
                    esFrameIndex,
                    segmentationModel: modelType ?? "unet",
                    source: "frames",
                    computed_at: new Date().toISOString(),
                },
                updatedAt: new Date(),
            };
            // Backfill measurements.PeakGRS/GCS ONLY when this strain was computed
            // at the auto-detected ED/ES frames (heartMetrics.ed_frame/es_frame).
            // Strain peaks are only meaningful between the true ED and ES; writing
            // arbitrary-frame peaks here would (a) mislead any consumer reading
            // heartMetrics.measurements and (b) defeat the similarity guard, which
            // falls back to hm.PeakGRS. So: frames match → write the peaks; frames
            // don't match → write null (keep the field honest). Only touch it when
            // heart metrics already exist, so we don't create a partial object.
            const hmForBackfill = (maskDoc as any).heartMetrics;
            if (hmForBackfill?.measurements) {
                const framesMatch =
                    typeof hmForBackfill.ed_frame === "number" && typeof hmForBackfill.es_frame === "number" &&
                    edFrameIndex === hmForBackfill.ed_frame && esFrameIndex === hmForBackfill.es_frame;
                setFields["heartMetrics.measurements.PeakGRS"] = framesMatch ? gGRS : null;
                setFields["heartMetrics.measurements.PeakGCS"] = framesMatch ? gGCS : null;
                if (!framesMatch) {
                    logger.info(`${serviceLocation}: Strain frames (ED=${edFrameIndex},ES=${esFrameIndex}) != auto ED/ES (${hmForBackfill.ed_frame}/${hmForBackfill.es_frame}) — NOT backfilling peaks into measurements (kept null).`);
                }
            }

            const updatedMask = await projectSegmentationMaskModel.findByIdAndUpdate(
                maskDoc._id.toString(),
                { $set: setFields },
                { new: true },
            ).lean();
            logger.info(`${serviceLocation}: Stored strain on mask ${maskDoc._id} — global_grs=${gGRS} global_gcs=${gGCS} edFrame=${edFrameIndex} esFrame=${esFrameIndex}`);

            // Auto-chain disease similarity if heart metrics are present (otherwise
            // it will run when the user triggers it, or after metrics are computed).
            const simMeasurements = assembleSimilarityMeasurements(updatedMask);
            if (simMeasurements) {
                computeDiseaseSimilarityFromMetrics(maskDoc._id.toString(), simMeasurements).catch((simErr: any) => {
                    logger.warn(`${serviceLocation}: Auto disease-similarity after strain failed for mask ${maskDoc._id}: ${simErr?.message}`);
                });
                logger.info(`${serviceLocation}: Auto-fired disease similarity for mask ${maskDoc._id} after strain compute.`);

                // Re-fire Health Status too — strain has just backfilled
                // measurements.PeakGRS/PeakGCS (when frames matched), so the
                // rule engine can now emit Peak GCS / Peak GRS evidence
                // instead of listing them under features_missing. The health-
                // status service fetches measurements fresh, so this picks up
                // the values we just $set-wrote.
                computeHealthStatusFromMetrics(maskDoc._id.toString()).catch((hsErr: any) => {
                    logger.warn(`${serviceLocation}: Auto health-status after strain failed for mask ${maskDoc._id}: ${hsErr?.message}`);
                });
                logger.info(`${serviceLocation}: Auto-fired health status for mask ${maskDoc._id} after strain compute.`);
            } else {
                logger.info(`${serviceLocation}: Skipped auto disease-similarity for mask ${maskDoc._id} — heart metrics not computed yet.`);
            }
        } catch (persistErr: any) {
            logger.warn(`${serviceLocation}: Failed to persist strain / chain similarity on mask ${maskDoc._id}: ${persistErr?.message}`);
        }

        logger.info(`${serviceLocation}: Strain from frames computed for project ${projectId} edFrame=${edFrameIndex} esFrame=${esFrameIndex}`);
        return res.status(200).json({
            ...gpuRes.data,
            edFrameIndex,
            esFrameIndex,
            source: "frames",
        });

    } catch (err: any) {
        await fs.remove(baseTempDir).catch(() => {});
        logger.error(`${serviceLocation}: compute-strain-from-frames failed for project ${projectId}: ${err?.message} | GPU response: ${JSON.stringify(err?.response?.data)}`);
        return res.status(500).json({ error: err?.response?.data?.detail ?? err?.message ?? "Strain from frames failed." });
    }
});

// Trigger bullseye computation for a single mask from its stored RLE data.
// POST /segmentation/trigger-bullseye/:maskId
router.post("/trigger-bullseye/:maskId", isAuth, async (req: Request, res: Response) => {
    const userId = (req.user as any)?._id?.toString();
    const maskId = Array.isArray(req.params.maskId) ? req.params.maskId[0] : req.params.maskId;

    try {
        const maskDoc = await projectSegmentationMaskModel.findById(maskId).lean();
        if (!maskDoc) {
            return res.status(404).json({ success: false, message: "Mask not found." });
        }

        const projectResult = await readProject(maskDoc.projectid?.toString(), userId);
        if (!projectResult.success || !projectResult.projects?.length) {
            return res.status(403).json({ success: false, message: "Project not found or access denied." });
        }

        const project = projectResult.projects[0] as IProjectDocument;
        const W = project.dimensions?.width;
        const H = project.dimensions?.height;
        if (!W || !H) {
            return res.status(400).json({ success: false, message: "Project is missing dimension data." });
        }

        const frames = (maskDoc as any).frames ?? [];
        if (!frames.length) {
            return res.status(400).json({ success: false, message: "Mask has no frame data." });
        }

        // Respond immediately and run computation async.
        // GPU-primary (landmark-aware when a completed landmark job exists),
        // with computeBullseyeAndStore's own internal fallback to the
        // subprocess RLE path if the GPU is unreachable.
        res.json({ success: true, message: "Bullseye computation started." });

        generateNiftiAndComputeBullseye(maskDoc, project, maskId).catch((err: any) => {
            logger.warn(`SegmentationRoutes: trigger-bullseye async error for mask ${maskId}: ${err?.message}`);
        });

    } catch (error: unknown) {
        LogError(error as Error, serviceLocation, `Error triggering bullseye for mask ${maskId}`);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, message: "An unexpected error occurred." });
        }
    }
});

// Trigger heart-metrics computation (volumes / EF / LV mass) for a single mask
// from its stored RLE data + the project's stored affine matrix.
// POST /segmentation/trigger-heart-metrics/:maskId
router.post("/trigger-heart-metrics/:maskId", isAuth, async (req: Request, res: Response) => {
    const userId = (req.user as any)?._id?.toString();
    const maskId = Array.isArray(req.params.maskId) ? req.params.maskId[0] : req.params.maskId;

    try {
        const maskDoc = await projectSegmentationMaskModel.findById(maskId).lean();
        if (!maskDoc) {
            return res.status(404).json({ success: false, message: "Mask not found." });
        }

        const projectResult = await readProject(maskDoc.projectid?.toString(), userId);
        if (!projectResult.success || !projectResult.projects?.length) {
            return res.status(403).json({ success: false, message: "Project not found or access denied." });
        }

        const project = projectResult.projects[0] as IProjectDocument;
        const W = project.dimensions?.width;
        const H = project.dimensions?.height;
        if (!W || !H) {
            return res.status(400).json({ success: false, message: "Project is missing dimension data." });
        }

        // Heart metrics need spacing → the project's affine is required. Fail loudly
        // rather than silently producing garbage.
        if (!project.affineMatrix || !Array.isArray(project.affineMatrix) || project.affineMatrix.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Project has no stored affine matrix — cannot compute physical volumes.",
            });
        }

        const frames = (maskDoc as any).frames ?? [];
        if (!frames.length) {
            return res.status(400).json({ success: false, message: "Mask has no frame data." });
        }

        // Respond immediately and run computation async — same pattern as trigger-bullseye.
        res.json({ success: true, message: "Heart-metrics computation started." });

        computeHeartMetricsFromMaskDoc(maskId, frames, W, H, project.affineMatrix).catch((err: any) => {
            logger.warn(`SegmentationRoutes: trigger-heart-metrics async error for mask ${maskId}: ${err?.message}`);
        });

    } catch (error: unknown) {
        LogError(error as Error, serviceLocation, `Error triggering heart metrics for mask ${maskId}`);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, message: "An unexpected error occurred." });
        }
    }
});

/**
 * Assemble the flat measurements block a disease-similarity run needs, reading
 * everything from the mask document:
 *   EF/EDV/ESV/StrokeVolume ← heartMetrics.measurements (volumes)
 *   PeakGRS/PeakGCS         ← strain.global_grs / strain.global_gcs (strain peaks)
 * An optional bodyPeaks override wins over the persisted strain (used when the
 * caller has fresher peaks in hand). Returns null when heart metrics are missing.
 */
function assembleSimilarityMeasurements(
    maskDoc: any,
    bodyPeaks?: { PeakGRS?: number | null; PeakGCS?: number | null },
): {
    EF: number | null; EDV: number | null; ESV: number | null;
    StrokeVolume: number | null; PeakGRS: number | null; PeakGCS: number | null;
} | null {
    const hm = maskDoc?.heartMetrics?.measurements;
    if (!hm) return null;

    const strain = maskDoc?.strain;
    const bodyGRS = typeof bodyPeaks?.PeakGRS === "number" ? bodyPeaks.PeakGRS : null;
    const bodyGCS = typeof bodyPeaks?.PeakGCS === "number" ? bodyPeaks.PeakGCS : null;

    // Strain peaks are only physiologically meaningful when measured between the
    // TRUE end-diastole and end-systole frames. Heart metrics auto-detects those
    // (ED = largest LV cavity, ES = smallest — heartMetrics.ed_frame/es_frame).
    // Only trust the persisted strain peaks when they were computed at those exact
    // frames; otherwise they came from an arbitrary user-picked pair and would
    // give an unreliable similarity result, so we drop them and let similarity run
    // on the volume features alone (honest, rather than fabricating peaks).
    const hmDoc = maskDoc?.heartMetrics;
    const strainAtCorrectFrames =
        strain &&
        typeof hmDoc?.ed_frame === "number" && typeof hmDoc?.es_frame === "number" &&
        strain.edFrameIndex === hmDoc.ed_frame &&
        strain.esFrameIndex === hmDoc.es_frame;
    const strainGRS = strainAtCorrectFrames && typeof strain?.global_grs === "number" ? strain.global_grs : null;
    const strainGCS = strainAtCorrectFrames && typeof strain?.global_gcs === "number" ? strain.global_gcs : null;

    return {
        EF:           hm.EF ?? null,
        EDV:          hm.EDV ?? null,
        ESV:          hm.ESV ?? null,
        StrokeVolume: hm.StrokeVolume ?? null,
        // Prefer explicit body override → strain peaks (only if computed at the
        // auto ED/ES) → any value already on heartMetrics (usually null).
        PeakGRS:      bodyGRS ?? strainGRS ?? hm.PeakGRS ?? null,
        PeakGCS:      bodyGCS ?? strainGCS ?? hm.PeakGCS ?? null,
    };
}

// Trigger Disease Pattern Similarity Assessment (NOT a diagnosis) for a single
// mask. Compares the mask's measurements against literature-derived NOR/HCM/DCM
// reference profiles. Volume metrics (EF/EDV/ESV/SV) come from stored
// heartMetrics.measurements; PeakGRS/PeakGCS come from the persisted strain
// result (strain.global_grs/global_gcs) — or from the request body if supplied.
// POST /segmentation/trigger-disease-similarity/:maskId
//   body (optional): { PeakGRS?: number, PeakGCS?: number }
router.post("/trigger-disease-similarity/:maskId", isAuth, async (req: Request, res: Response) => {
    const userId = (req.user as any)?._id?.toString();
    const maskId = Array.isArray(req.params.maskId) ? req.params.maskId[0] : req.params.maskId;

    try {
        const maskDoc = await projectSegmentationMaskModel.findById(maskId).lean();
        if (!maskDoc) {
            return res.status(404).json({ success: false, message: "Mask not found." });
        }

        const projectResult = await readProject(maskDoc.projectid?.toString(), userId);
        if (!projectResult.success || !projectResult.projects?.length) {
            return res.status(403).json({ success: false, message: "Project not found or access denied." });
        }

        const measurements = assembleSimilarityMeasurements(maskDoc, req.body);
        if (!measurements) {
            return res.status(400).json({
                success: false,
                message: "Heart metrics not computed for this mask yet — run trigger-heart-metrics first.",
            });
        }

        // Respond immediately and run computation async — same pattern as the
        // other trigger routes.
        res.json({ success: true, message: "Disease similarity computation started." });

        computeDiseaseSimilarityFromMetrics(maskId, measurements).catch((err: any) => {
            logger.warn(`SegmentationRoutes: trigger-disease-similarity async error for mask ${maskId}: ${err?.message}`);
        });

    } catch (error: unknown) {
        LogError(error as Error, serviceLocation, `Error triggering disease similarity for mask ${maskId}`);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, message: "An unexpected error occurred." });
        }
    }
});

// Trigger the rule-based Health Status computation for a single mask.
// Reads heartMetrics.measurements + heartMetrics.warnings off the mask doc
// and stores healthStatus back on the same doc. Mirrors trigger-disease-
// similarity 1:1 — no request body (this module has no external inputs
// beyond the mask itself), 200 response, async compute.
// POST /segmentation/trigger-health-status/:maskId
router.post("/trigger-health-status/:maskId", isAuth, async (req: Request, res: Response) => {
    const userId = (req.user as any)?._id?.toString();
    const maskId = Array.isArray(req.params.maskId) ? req.params.maskId[0] : req.params.maskId;

    try {
        const maskDoc = await projectSegmentationMaskModel.findById(maskId).lean();
        if (!maskDoc) {
            return res.status(404).json({ success: false, message: "Mask not found." });
        }

        // Project access check — same as trigger-disease-similarity.
        const projectResult = await readProject(maskDoc.projectid?.toString(), userId);
        if (!projectResult.success || !projectResult.projects?.length) {
            return res.status(403).json({ success: false, message: "Project not found or access denied." });
        }

        const hm: any = (maskDoc as any).heartMetrics;
        if (!hm || !hm.measurements) {
            return res.status(400).json({
                success: false,
                message: "Heart metrics not computed for this mask yet — run trigger-heart-metrics first.",
            });
        }

        // Respond immediately and run the compute async — same pattern as the
        // other trigger routes.
        res.json({ success: true, message: "Health-status computation started." });

        computeHealthStatusFromMetrics(maskId).catch((err: any) => {
            logger.warn(`SegmentationRoutes: trigger-health-status async error for mask ${maskId}: ${err?.message}`);
        });

    } catch (error: unknown) {
        LogError(error as Error, serviceLocation, `Error triggering health status for mask ${maskId}`);
        if (!res.headersSent) {
            return res.status(500).json({ success: false, message: "An unexpected error occurred." });
        }
    }
});

export default router;
