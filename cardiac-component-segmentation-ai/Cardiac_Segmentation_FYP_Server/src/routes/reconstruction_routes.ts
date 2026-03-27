import { Request, Response, Router } from "express";
import logger from "../services/logger";
import { startReconstruction } from "../services/reconstruction";
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware";
import {
    jobModel,
    JobStatus,
    readProjectReconstruction,
    projectReconstructionModel,
    readProject,
    IProjectDocument,
    deleteProjectReconstruction
} from "../services/database";
import { isAuth, isAuthAndNotGuest } from "../services/passportjs";
import { extractS3KeyFromUrl, deleteFromS3 } from "../services/s3_handler";
import { generatePresignedGetUrl } from "../utils/s3_presigned_url";
import LogError from "../utils/error_logger";

const router = Router();
const serviceLocation = "ReconstructionRoutes";

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
        const { projectId } = req.params;
        const { reconstructionName, reconstructionDescription, parameters, ed_frame, export_format } = req.body;
        
        logger.info(`${serviceLocation}: Received start 4D reconstruction request for project ${projectId} with ed_frame ${ed_frame}, export_format ${export_format || 'default'} by user ${req.user?.username} with id ${req.user?._id}`);
        
        try {
            const result = await startReconstruction(projectId, req.user, reconstructionName, reconstructionDescription, parameters, ed_frame, export_format);
            if (result.success) {
                res.status(200).json({ message: result.message, uuid: result.uuid });
            } else {
                res.status(500).json({ message: result.message });
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
    const { projectId } = req.params;

    if (!projectId) {
        logger.warn(`${serviceLocation}: Project ID is required to fetch reconstruction results.`);
        return res.status(400).json({ message: "Project ID is required." });
    }
    logger.info(`${serviceLocation}: Received request to fetch reconstruction results for project ID: ${projectId}`);
    try {
        const result = await readProjectReconstruction(projectId);
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
        const reconstructionsWithUrls = await Promise.all(
            result.projectreconstructions.map(async (recon) => {
                let downloadUrl = null;
                
                // Generate presigned URL if mesh file exists
                if (recon.reconstructedMesh?.path) {
                    try {
                        const s3Key = extractS3KeyFromUrl(recon.reconstructedMesh.path);
                        if (s3Key) {
                            const awsBucketName = process.env.AWS_BUCKET_NAME;
                            if (awsBucketName) {
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
                    reconstructionId: recon._id,
                    name: recon.name,
                    description: recon.description,
                    isSaved: recon.isSaved,
                    isAIGenerated: recon.isAIGenerated,
                    meshFormat: recon.meshFormat,
                    meshFileSize: recon.reconstructedMesh?.filesize,
                    downloadUrl, // Presigned URL for download
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

        logger.info(`${serviceLocation}: Successfully fetched ${result.projectreconstructions.length} reconstruction(s) for project ID ${projectId}.`);
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
            jobs: jobs.map((job: any) => {
                let queuePosition = null;
                if (job.status === JobStatus.PENDING) {
                    queuePosition = pendingJobs.findIndex(j => j.uuid === job.uuid) + 1;
                }
                return {
                    jobId: job.uuid,
                    projectId: job.projectid,
                    status: job.status,
                    name: job.segmentationName,
                    description: job.segmentationDescription,
                    queuePosition: queuePosition
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

        const userProjectIds = userProjectsResult.projects.map((p: IProjectDocument) => (p._id as string).toString());
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
        const { projectId } = req.params;
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

export default router;