import { Request, Response, Router } from "express";
import logger from "../services/logger";
import { startReconstruction } from "../services/reconstruction";
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware";
import {
    jobModel,
    JobStatus,
    readProjectReconstruction,
    readProjectSegmentationMask,
    projectReconstructionModel,
    readProject,
    IProjectDocument,
    deleteProjectReconstruction
} from "../services/database";
import { SegmentationModel } from "../types/database_types";
import { isAuth, isAuthAndNotGuest } from "../services/passportjs";
import { extractS3KeyFromUrl, deleteFromS3 } from "../services/s3_handler";
import { generatePresignedGetUrl } from "../utils/s3_presigned_url";
import LogError from "../utils/error_logger";

const router = Router();
const serviceLocation = "ReconstructionRoutes";

const toSingleString = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

const normalizeSegmentationModel = (value: unknown): "medsam" | "unet" | null => {
    const normalized = (value ?? "").toString().toLowerCase();
    if (normalized === "medsam" || normalized === "unet") {
        return normalized;
    }
    return null;
};

/**
 * Start 4D cardiac reconstruction job
 * Follows the same pattern as segmentation routes - delegates to service layer
 *
 * @route POST /reconstruction/start-4d/:projectId
 * @access Private (authenticated users only)
 */
router.post("/start-reconstruction/:projectId",
    isAuth,
    isAuthAndNotGuest,
    injectGpuAuthToken,
    async (req: Request, res: Response) => {
        const projectId = toSingleString(req.params.projectId);
        if (!projectId) {
            return res.status(400).json({ message: "Project ID is required." });
        }
        const {
            reconstructionName,
            reconstructionDescription,
            parameters,
            ed_frame,
            export_format,
            // segmentationModel: which segmentation result to reconstruct from.
            // Accepted values: "medsam" | "unet" | undefined.
            // Backward-compat: when omitted, the service falls back to the
            // legacy (model-agnostic) selection so older frontends keep working.
            segmentationModel,
        } = req.body;

        logger.info(
            `${serviceLocation}: Received start 4D reconstruction request for project ${projectId} with ed_frame ${ed_frame}, export_format ${export_format || 'default'}, segmentationModel ${segmentationModel || '<none — legacy>'} by user ${req.user?.username} with id ${req.user?._id}`
        );

        try {
            const result = await startReconstruction(
                projectId,
                req.user,
                reconstructionName,
                reconstructionDescription,
                parameters,
                ed_frame,
                export_format,
                segmentationModel
            );
            if (result.success) {
                res.status(200).json({ message: result.message, uuid: result.uuid });
            } else {
                res.status(result.statusCode || 500).json({ message: result.message, reason: result.reason });
            }
        } catch (error: unknown) {
            LogError(error as Error, serviceLocation, "Error starting 4D reconstruction");
            if (!res.headersSent) {
                res.status(500).json({ message: "An unexpected error occurred while starting 4D reconstruction." });
            }
        }
    });

/**
 * Get reconstruction results for a project
 * Follows the exact pattern of /segmentation/segmentation-results/:projectId
 *
 * @route GET /reconstruction/reconstruction-results/:projectId
 * @access Private (authenticated users only)
 */
router.get("/reconstruction-results/:projectId", isAuth, async (req: Request, res: Response) => {
    const projectId = toSingleString(req.params.projectId);
    const requestStart = Date.now();

    if (!projectId) {
        logger.warn(`${serviceLocation}: Project ID is required to fetch reconstruction results.`);
        return res.status(400).json({ message: "Project ID is required." });
    }
    logger.info(`${serviceLocation}: Received request to fetch reconstruction results for project ID: ${projectId}`);
    try {
        const [result, masksResult] = await Promise.all([
            readProjectReconstruction(projectId),
            readProjectSegmentationMask(projectId),
        ]);

        if (!result.success) {
            if (result.message?.includes("does not exist")) {
                logger.warn(`${serviceLocation}: Project with ID ${projectId} not found when fetching reconstruction results.`);
                return res.status(404).json({ success: false, message: result.message });
            }
            logger.error(`${serviceLocation}: Error reading reconstruction results for project ${projectId}: ${result.message}`);
            return res.status(500).json({ success: false, message: result.message || "Error reading reconstruction results." });
        }
        if (!result.projectreconstructions || result.projectreconstructions.length === 0) {
            logger.info(`${serviceLocation}: No reconstruction results found for project ID ${projectId}.`);
            return res.status(200).json({
                message: "No reconstruction results found for this project.",
                success: false,
                reconstructions: []
            });
        }

        // Generate presigned URLs for each reconstruction's mesh.tar file
        const masksById = new Map<string, { segmentationModel?: string; model_used?: string; name?: string }>();
        if (masksResult.success && masksResult.projectsegmentationmasks) {
            for (const mask of masksResult.projectsegmentationmasks as any[]) {
                masksById.set(String(mask._id), mask);
            }
        }

        logger.info(
            `${serviceLocation}: Loaded reconstruction metadata for project ${projectId} in ${Date.now() - requestStart}ms ` +
            `(reconstructions=${result.projectreconstructions.length}, masks=${masksById.size})`
        );

        const reconstructionsWithUrls = await Promise.all(
            result.projectreconstructions.map(async (recon) => {
                let downloadUrl = null;
                const outputKey = recon.reconstructedMesh?.path
                    ? extractS3KeyFromUrl(recon.reconstructedMesh.path)
                    : null;
                const maskDoc = recon.maskId ? masksById.get(String(recon.maskId)) : undefined;
                const maskName = (maskDoc?.name || "").toLowerCase();
                const inferredModel =
                    normalizeSegmentationModel(recon.segmentationModel) ||
                    normalizeSegmentationModel(maskDoc?.segmentationModel) ||
                    normalizeSegmentationModel(maskDoc?.model_used) ||
                    normalizeSegmentationModel(maskName.includes("unet") ? "unet" : maskName.includes("medsam") ? "medsam" : undefined) ||
                    "unknown";

                // Generate presigned URL if mesh file exists
                if (recon.reconstructedMesh?.path) {
                    try {
                        const s3Key = outputKey;
                        if (s3Key) {
                            const awsBucketName = process.env.AWS_BUCKET_NAME;
                            if (awsBucketName) {
                                logger.info(
                                    `${serviceLocation}: Generating presigned download URL for reconstruction ${recon._id} ` +
                                    `(bucket=${awsBucketName}, key=${s3Key}, originOnly)`
                                );
                                downloadUrl = await generatePresignedGetUrl(
                                    awsBucketName,
                                    s3Key,
                                    3600 // 1 hour expiry
                                );
                                                            }
                        }
                    } catch (urlError) {
                        logger.warn(`${serviceLocation}: Failed to generate presigned URL for reconstruction ${recon._id}: ${(urlError as Error).message}`);
                    }
                }

                return {
                    reconstructionId: String(recon._id),
                    maskId: recon.maskId ? String(recon.maskId) : null,
                    name: recon.name,
                    description: recon.description,
                    status: "completed",
                    isSaved: recon.isSaved,
                    isAIGenerated: recon.isAIGenerated,
                    meshFormat: recon.meshFormat,
                    meshFileSize: recon.reconstructedMesh?.filesize,
                    reconstructedMeshPath: recon.reconstructedMesh?.path || null,
                    outputPath: recon.reconstructedMesh?.path || null,
                    outputKey,
                    tarPath: recon.reconstructedMesh?.path || null,
                    tarKey: outputKey,
                    downloadUrl, // Presigned URL for download
                    tarUrl: downloadUrl,
                    segmentationModel: inferredModel, // Model used for this reconstruction (medsam, unet, etc)
                    ahaVertexLabels: recon.ahaVertexLabels ?? null,
                    frameAhaVertexLabels: recon.frameAhaVertexLabels ?? null,
                    metadata: {
                        edFrameIndex: recon.ed_frame,
                        reconstructionTime: recon.reconstructedMesh?.reconstructionTime,
                        numIterations: recon.reconstructedMesh?.numIterations,
                        resolution: recon.reconstructedMesh?.resolution,
                        filename: recon.reconstructedMesh?.filename,
                        filesize: recon.filesize,
                        filehash: recon.filehash
                    },
                    createdAt: recon.createdAt,
                    updatedAt: recon.updatedAt,
                };
            })
        );

        logger.info(
            `${serviceLocation}: Successfully fetched ${result.projectreconstructions.length} reconstruction(s) for project ID ${projectId} in ${Date.now() - requestStart}ms.`
        );
        return res.status(200).json({ success: true, reconstructions: reconstructionsWithUrls });
    } catch (error) {
        LogError(error as Error, serviceLocation, `Unexpected error fetching reconstruction results for project ${projectId}`);
        return res.status(500).json({ message: "An unexpected error occurred while fetching reconstruction results." });
    }
});

/**
 * Check all reconstruction jobs for current user
 * Matches segmentation pattern: /segmentation/user-check-jobs
 *
 * @route GET /reconstruction/user-check-jobs
 * @access Private (authenticated users only)
 */
router.get("/user-check-jobs", isAuth, async (req: Request, res: Response) => {
    const userId = req.user?._id;
    logger.info(`${serviceLocation}: Fetching all reconstruction jobs for user ${req.user?.username}`);

    try {
        const reconstructionJobFilter = {
            userid: userId,
            $or: [
                { model_used: "4d_reconstruction" },
                { segmentationName: /^4D Reconstruction/i },
                { message: /4D reconstruction/i },
                { result: /GPU Job ID/i }
            ]
        };
        const jobs = await jobModel.find(reconstructionJobFilter).sort({ createdAt: -1 }).limit(20);
        const pendingJobs = await jobModel.find({
            ...reconstructionJobFilter,
            status: JobStatus.PENDING
        }).sort({ createdAt: 1 });
        const activeJobCount = await jobModel.countDocuments({
            ...reconstructionJobFilter,
            status: { $in: [JobStatus.PENDING, JobStatus.IN_PROGRESS] }
        });

        return res.status(200).json({
            success: true,
            activeJobCount,
            totalJobs: jobs.length,
            jobs: jobs.map((job: any) => {
                let queuePosition = null;
                if (job.status === JobStatus.PENDING) {
                    queuePosition = pendingJobs.findIndex(j => j.uuid === job.uuid) + 1;
                }
                return {
                    jobId: job.uuid,
                    projectId: job.projectid,
                    maskId: (job as any).maskId || null,
                    segmentationModel: (job as any).segmentationModel || null,
                    status: job.status,
                    name: job.segmentationName,
                    description: job.segmentationDescription,
                    queuePosition: queuePosition,
                    message: job.message || "",
                    createdAt: (job as any).createdAt?.toISOString?.() || null,
                    updatedAt: (job as any).updatedAt?.toISOString?.() || null
                };
            })
        });
    } catch (error: unknown) {
        LogError(error as Error, serviceLocation, `Error fetching reconstruction jobs for user ${userId}`);
        return res.status(500).json({
            success: false,
            message: "An error occurred while fetching reconstruction jobs"
        });
    }
});

/**
 * Batch endpoint for checking reconstruction status of multiple projects
 * Matches segmentation pattern: /segmentation/batch-segmentation-status
 *
 * @route POST /reconstruction/batch-reconstruction-status
 * @access Private (authenticated users only)
 */
router.post("/batch-reconstruction-status", isAuth, async (req: Request, res: Response) => {
    const { projectIds } = req.body;
    const userId = req.user?._id;

    logger.info(`${serviceLocation}: Batch reconstruction status check for ${projectIds?.length || 0} projects by user ${req.user?.username}`);

    if (!userId) {
        logger.warn(`${serviceLocation}: User ID not found in request.`);
        return res.status(401).json({
            success: false,
            message: "Authentication required."
        });
    }

    if (!projectIds || !Array.isArray(projectIds) || projectIds.length === 0) {
        logger.warn(`${serviceLocation}: Invalid or empty projectIds array in batch reconstruction status request.`);
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
            logger.warn(`${serviceLocation}: User ${userId} attempted to check reconstruction status for unauthorized projects: ${unauthorizedProjects.join(', ')}`);
            return res.status(403).json({
                success: false,
                message: "Access denied to some requested projects."
            });
        }

        // 2. Batch query reconstruction results using MongoDB aggregation
        const reconstructionResults = await projectReconstructionModel.aggregate([
            {
                $match: {
                    projectid: { $in: projectIds }
                }
            },
            {
                $group: {
                    _id: "$projectid",
                    reconstructionCount: { $sum: 1 },
                    hasReconstructions: { $sum: { $cond: [{ $ne: ["$reconstructedMesh", null] }, 1, 0] } }
                }
            }
        ]);

        // 3. Build response object with status for each project
        const statusMap: Record<string, { hasReconstructions: boolean; reconstructionCount: number }> = {};

        // Initialize all projects as having no reconstructions
        projectIds.forEach((projectId: string) => {
            statusMap[projectId] = { hasReconstructions: false, reconstructionCount: 0 };
        });

        // Update with actual results
        reconstructionResults.forEach((result: { _id: string; reconstructionCount: number; hasReconstructions: number }) => {
            statusMap[result._id] = {
                hasReconstructions: result.hasReconstructions > 0,
                reconstructionCount: result.reconstructionCount
            };
        });

        logger.info(`${serviceLocation}: Successfully processed batch reconstruction status for ${projectIds.length} projects. Found reconstructions for ${reconstructionResults.length} projects.`);

        return res.status(200).json({
            success: true,
            statuses: statusMap
        });

    } catch (error: unknown) {
        LogError(error as Error, serviceLocation, `Error in batch reconstruction status check for user ${userId}`);
        return res.status(500).json({
            success: false,
            message: "An error occurred while checking reconstruction status."
        });
    }
});

/**
 * Delete all reconstructions for a project
 * Designed for workflow where masks are re-edited - only keep 1 reconstruction at a time
 * Deletes both database records and S3 mesh files
 *
 * @route DELETE /reconstruction/delete-project-reconstructions/:projectId
 * @access Private (authenticated users only, project owner)
 */
router.delete("/delete-project-reconstructions/:projectId",
    isAuth,
    isAuthAndNotGuest,
    async (req: Request, res: Response) => {
        const projectId = toSingleString(req.params.projectId);
        const userId = (req.user as any)?._id?.toString();

        logger.info(`${serviceLocation}: Received request to delete all reconstructions for project ${projectId} by user ${req.user?.username}`);

        if (!userId) {
            logger.warn(`${serviceLocation}: User ID not found in request.`);
            return res.status(401).json({
                success: false,
                message: "Authentication required."
            });
        }

        if (!projectId) {
            logger.warn(`${serviceLocation}: Project ID is required to delete reconstructions.`);
            return res.status(400).json({
                success: false,
                message: "Project ID is required."
            });
        }

        try {
            // 1. Verify user owns the project
            const projectResult = await readProject(projectId, userId);
            if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
                logger.warn(`${serviceLocation}: User ${userId} does not have access to project ${projectId} or project not found.`);
                return res.status(403).json({
                    success: false,
                    message: "Access denied or project not found."
                });
            }

            // 2. Get all reconstructions for this project
            const reconstructionsResult = await readProjectReconstruction(projectId);
            if (!reconstructionsResult.success || !reconstructionsResult.projectreconstructions || reconstructionsResult.projectreconstructions.length === 0) {
                logger.info(`${serviceLocation}: No reconstructions found for project ${projectId}.`);
                return res.status(200).json({
                    success: true,
                    message: "No reconstructions to delete.",
                    deletedCount: 0
                });
            }

            const reconstructions = reconstructionsResult.projectreconstructions;
            logger.info(`${serviceLocation}: Found ${reconstructions.length} reconstruction(s) to delete for project ${projectId}.`);

            // 3. Delete S3 files first (mesh tar files)
            const s3DeletePromises = reconstructions.map(async (recon) => {
                if (recon.reconstructedMesh?.path) {
                    const s3Key = extractS3KeyFromUrl(recon.reconstructedMesh.path);
                    if (s3Key) {
                        logger.info(`${serviceLocation}: Deleting S3 mesh file: ${s3Key}`);
                        const deleteSuccess = await deleteFromS3(s3Key);
                        if (!deleteSuccess) {
                            logger.warn(`${serviceLocation}: Failed to delete S3 file ${s3Key} for reconstruction ${recon._id}`);
                        }
                        return deleteSuccess;
                    }
                }
                return true; // No file to delete
            });

            await Promise.all(s3DeletePromises);

            // 4. Delete database records
            let deletedCount = 0;
            const dbDeletePromises = reconstructions.map(async (recon) => {
                const reconstructionId = recon._id?.toString();
                if (reconstructionId) {
                    const deleteResult = await deleteProjectReconstruction(reconstructionId);
                    if (deleteResult.success) {
                        deletedCount++;
                        logger.info(`${serviceLocation}: Deleted reconstruction ${reconstructionId} from database.`);
                    } else {
                        logger.warn(`${serviceLocation}: Failed to delete reconstruction ${reconstructionId}: ${deleteResult.message}`);
                    }
                    return deleteResult.success;
                }
                return false;
            });

            await Promise.all(dbDeletePromises);

            logger.info(`${serviceLocation}: Successfully deleted ${deletedCount} reconstruction(s) for project ${projectId}.`);

            return res.status(200).json({
                success: true,
                message: `Successfully deleted ${deletedCount} reconstruction(s).`,
                deletedCount
            });

        } catch (error: unknown) {
            LogError(error as Error, serviceLocation, `Error deleting reconstructions for project ${projectId}`);
            return res.status(500).json({
                success: false,
                message: "An error occurred while deleting reconstructions."
            });
        }
    });

/**
 * Delete one reconstruction result by ID.
 *
 * @route DELETE /reconstruction/delete-reconstruction/:projectId/:reconstructionId
 * @access Private (authenticated users only, project owner)
 */
router.delete("/delete-reconstruction/:projectId/:reconstructionId",
    isAuth,
    isAuthAndNotGuest,
    async (req: Request, res: Response) => {
        const projectId = toSingleString(req.params.projectId);
        const reconstructionId = toSingleString(req.params.reconstructionId);
        const userId = (req.user as any)?._id?.toString();

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required."
            });
        }

        if (!projectId || !reconstructionId) {
            return res.status(400).json({
                success: false,
                message: "Project ID and reconstruction ID are required."
            });
        }

        try {
            const projectResult = await readProject(projectId, userId);
            if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
                logger.warn(`${serviceLocation}: User ${userId} does not have access to project ${projectId} or project not found.`);
                return res.status(403).json({
                    success: false,
                    message: "Access denied or project not found."
                });
            }

            const reconstructionsResult = await readProjectReconstruction(projectId);
            const reconstruction = reconstructionsResult.projectreconstructions?.find(
                (recon) => recon._id?.toString() === reconstructionId
            );

            if (!reconstruction) {
                return res.status(404).json({
                    success: false,
                    message: "Reconstruction not found for this project."
                });
            }

            if (reconstruction.reconstructedMesh?.path) {
                const s3Key = extractS3KeyFromUrl(reconstruction.reconstructedMesh.path);
                if (s3Key) {
                    const deleteSuccess = await deleteFromS3(s3Key);
                    if (!deleteSuccess) {
                        logger.warn(`${serviceLocation}: Failed to delete S3 file ${s3Key} for reconstruction ${reconstructionId}`);
                    }
                }
            }

            const deleteResult = await deleteProjectReconstruction(reconstructionId);
            if (!deleteResult.success) {
                return res.status(500).json({
                    success: false,
                    message: deleteResult.message || "Failed to delete reconstruction."
                });
            }

            return res.status(200).json({
                success: true,
                message: "Reconstruction deleted successfully.",
                deletedCount: 1
            });
        } catch (error: unknown) {
            LogError(error as Error, serviceLocation, `Error deleting reconstruction ${reconstructionId} for project ${projectId}`);
            return res.status(500).json({
                success: false,
                message: "An error occurred while deleting reconstruction."
            });
        }
    });

/**
 * Delete reconstruction for a specific segmentation model
 * Allows deleting MedSAM or UNet reconstruction independently
 *
 * @route DELETE /reconstruction/delete-model-reconstruction/:projectId
 * @query segmentationModel - The model to delete (medsam|unet)
 * @access Private (authenticated users only, project owner)
 */
router.delete("/delete-model-reconstruction/:projectId",
    isAuth,
    isAuthAndNotGuest,
    async (req: Request, res: Response) => {
        const projectId = toSingleString(req.params.projectId);
        const segmentationModel = toSingleString(req.query.segmentationModel as string | string[]);
        const userId = (req.user as any)?._id?.toString();

        logger.info(`${serviceLocation}: Received request to delete ${segmentationModel} reconstruction for project ${projectId} by user ${req.user?.username}`);

        if (!userId) {
            logger.warn(`${serviceLocation}: User ID not found in request.`);
            return res.status(401).json({
                success: false,
                message: "Authentication required."
            });
        }

        if (!projectId) {
            logger.warn(`${serviceLocation}: Project ID is required to delete reconstruction.`);
            return res.status(400).json({
                success: false,
                message: "Project ID is required."
            });
        }

        if (!segmentationModel || (segmentationModel !== 'medsam' && segmentationModel !== 'unet')) {
            logger.warn(`${serviceLocation}: Invalid segmentationModel parameter: ${segmentationModel}`);
            return res.status(400).json({
                success: false,
                message: "Invalid segmentationModel. Must be 'medsam' or 'unet'."
            });
        }

        try {
            // 1. Verify user owns the project
            const projectResult = await readProject(projectId, userId);
            if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
                logger.warn(`${serviceLocation}: User ${userId} does not have access to project ${projectId} or project not found.`);
                return res.status(403).json({
                    success: false,
                    message: "Access denied or project not found."
                });
            }

            // 2. Get all reconstructions and filter by model
            const reconstructionsResult = await readProjectReconstruction(projectId);
            if (!reconstructionsResult.success || !reconstructionsResult.projectreconstructions) {
                logger.info(`${serviceLocation}: No reconstructions found for project ${projectId}.`);
                return res.status(200).json({
                    success: true,
                    message: `No ${segmentationModel} reconstructions to delete.`,
                    deletedCount: 0
                });
            }

            // Filter reconstructions to only those matching the requested model
            const modelReconstructions = reconstructionsResult.projectreconstructions.filter(recon => {
                const reconModel = (recon.segmentationModel || 'unknown').toLowerCase();
                return reconModel === segmentationModel;
            });

            if (modelReconstructions.length === 0) {
                logger.info(`${serviceLocation}: No ${segmentationModel} reconstructions found for project ${projectId}.`);
                return res.status(200).json({
                    success: true,
                    message: `No ${segmentationModel} reconstructions to delete.`,
                    deletedCount: 0
                });
            }

            logger.info(`${serviceLocation}: Found ${modelReconstructions.length} ${segmentationModel} reconstruction(s) to delete for project ${projectId}.`);

            // 3. Delete S3 files first (mesh tar files)
            const s3DeletePromises = modelReconstructions.map(async (recon) => {
                if (recon.reconstructedMesh?.path) {
                    const s3Key = extractS3KeyFromUrl(recon.reconstructedMesh.path);
                    if (s3Key) {
                        logger.info(`${serviceLocation}: Deleting S3 mesh file for ${segmentationModel}: ${s3Key}`);
                        const deleteSuccess = await deleteFromS3(s3Key);
                        if (!deleteSuccess) {
                            logger.warn(`${serviceLocation}: Failed to delete S3 file ${s3Key} for reconstruction ${recon._id}`);
                        }
                        return deleteSuccess;
                    }
                }
                return true;
            });

            await Promise.all(s3DeletePromises);

            // 4. Delete database records
            let deletedCount = 0;
            const dbDeletePromises = modelReconstructions.map(async (recon) => {
                const reconstructionId = recon._id?.toString();
                if (reconstructionId) {
                    const deleteResult = await deleteProjectReconstruction(reconstructionId);
                    if (deleteResult.success) {
                        deletedCount++;
                        logger.info(`${serviceLocation}: Deleted ${segmentationModel} reconstruction ${reconstructionId} from database.`);
                    } else {
                        logger.warn(`${serviceLocation}: Failed to delete reconstruction ${reconstructionId}: ${deleteResult.message}`);
                    }
                    return deleteResult.success;
                }
                return false;
            });

            await Promise.all(dbDeletePromises);

            logger.info(`${serviceLocation}: Successfully deleted ${deletedCount} ${segmentationModel} reconstruction(s) for project ${projectId}.`);

            const modelTag = segmentationModel === "medsam" ? SegmentationModel.MEDSAM : SegmentationModel.UNET;
            const clearedJobsResult = await jobModel.updateMany(
                {
                    projectid: projectId,
                    segmentationModel: modelTag,
                    model_used: "4d_reconstruction",
                    status: { $in: [JobStatus.PENDING, JobStatus.IN_PROGRESS] },
                },
                {
                    $set: {
                        status: JobStatus.FAILED,
                        message: "Reconstruction deleted by user before job completed.",
                    },
                }
            );
            if (clearedJobsResult.modifiedCount > 0) {
                logger.info(`${serviceLocation}: Cleared ${clearedJobsResult.modifiedCount} pending/in-progress ${segmentationModel} job(s) for project ${projectId}.`);
            }

            return res.status(200).json({
                success: true,
                message: `Successfully deleted ${deletedCount} ${segmentationModel} reconstruction(s).`,
                deletedCount,
                clearedJobCount: clearedJobsResult.modifiedCount
            });

        } catch (error: unknown) {
            LogError(error as Error, serviceLocation, `Error deleting ${segmentationModel} reconstructions for project ${projectId}`);
            return res.status(500).json({
                success: false,
                message: "An error occurred while deleting reconstruction."
            });
        }
    });

export default router;
