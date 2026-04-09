// File: src/routes/uploadroutes.ts
// Description: Routes for handling file uploads using Multer middleware and Express framework.
// This module defines the routes for uploading files, including a POST route for handling file uploads and a GET route to inform about the expected HTTP method.

import express, { Request, Response } from "express";
import { projectUploadFilter } from "../middleware/uploadmiddleware";
import { saveFileAndPushToS3 } from "../services/project_handler";
import {
  isAuth,
  isAuthAndNotGuest,
  isAuthAndAdmin,
} from "../services/passportjs";
import { readProject, updateProject, readUser, readProjectReconstruction } from "../services/database";
import { FileType } from "../types/database_types"; // Import FileType enum
import { extractS3KeyFromUrl, deleteFromS3, getS3FileSize } from "../services/s3_handler"; // Import S3 URL utility
import { generatePresignedGetUrl } from "../utils/s3_presigned_url"; // Import S3 presigned URL utility
import { deleteProject } from "../services/database"; // Import deleteProject function

import logger from "../services/logger"; // Import Winston Logger
import LogError from "../utils/error_logger"; // Import error logging utility

const serviceLocation = "API(Upload)";
const router = express.Router();

const toSingleString = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

// Get project information route
router.get(
  "/get-project-info/:projectId",
  isAuth,
  async (req: Request, res: Response) => {
    const projectId = toSingleString(req.params.projectId);
    const userId = (req.user as any)?._id;

    if (!projectId) {
      return res
        .status(400)
        .json({ success: false, message: "Missing projectId." });
    }

    try {
      const result = await readProject(projectId, userId);
      if (result.success && result.projects && result.projects.length > 0) {
        const project = result.projects[0];
        return res.status(200).json({
          success: true,
          project: {
            projectId: project._id,
            name: project.name,
            description: project.description,
            isSaved: project.isSaved,
            filesize: project.filesize,
            filetype: project.filetype,
            dimensions: project.dimensions,
            voxelsize: project.voxelsize,
            affineMatrix: project.affineMatrix,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
          },
        });
      } else {
        return res
          .status(404)
          .json({ success: false, message: "Project not found." });
      }
    } catch (error) {
      LogError(error as Error, serviceLocation, "Error fetching project info");
      return res.status(500).json({
        success: false,
        message: "An error occurred while fetching the project information.",
      });
    }
  }
);

// Upload route with PUT method
router.put(
  "/upload-new-project",
  isAuth,
  projectUploadFilter,
  async (req: Request, res: Response) => {
    try {
      // Check for empty files array (might slip through middleware)
      if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
        return res
          .status(400)
          .json({ success: false, message: "No files were uploaded" });
      }

      logger.info(
        `${serviceLocation}: Received file upload request from user ${req.user?.username}`
      );
      await saveFileAndPushToS3(req, res);

      // If reached here but no response was sent, handle it gracefully (should not)
      if (!res.headersSent) {
        logger.warn(
          `${serviceLocation}: No response sent after saveFileAndPushToS3`
        );
        return res.status(500).json({
          success: false,
          message: "Upload processed but no response generated",
        });
      }
    } catch (error) {
      // More specific error handling based on error type
      if (error instanceof TypeError || error instanceof ReferenceError) {
        logger.error(
          `${serviceLocation}: Programming error in upload handler: ${error.message}`
        );
        return res
          .status(500)
          .json({ success: false, message: "Server configuration error" });
      }

      LogError(error as Error, serviceLocation, "Error handling file upload");
      return res.status(500).json({
        success: false,
        message: "An error occurred while processing the upload.",
      });
    }
  }
);

// Route to read/search projects (limited to id, name, filetype, daterange)
router.get(
  "/get-projects-list",
  isAuth,
  async (req: Request, res: Response) => {
    const userId = req.user?._id;

    logger.info(
      `${serviceLocation}: User ${req.user?.username} requested project list.`
    );

    const {
      projectid,
      name,
      filetype: filetypeParam,
      daterange: daterangeParam,
    } = req.query;

    // Helper function to safely parse JSON query parameters
    const tryParseJSON = (value: any) => {
      try {
        return JSON.parse(value as string);
      } catch (error) {
        return undefined;
      }
    };

    try {
      const filetype: FileType[] | undefined = Array.isArray(filetypeParam)
        ? filetypeParam.filter((type): type is FileType =>
            Object.values(FileType).includes(type as FileType)
          )
        : filetypeParam &&
            Object.values(FileType).includes(filetypeParam as FileType)
          ? [filetypeParam as FileType]
          : undefined;

      const daterange: { start?: Date; end?: Date } | undefined =
        tryParseJSON(daterangeParam);

      const result = await readProject(
        projectid as string | undefined,
        userId,
        name as string | undefined,
        undefined, // description - not a filter
        undefined, // isSaved - not a filter
        undefined, // filename - not a filter
        filetype,
        undefined, // filesize - not a filter
        undefined, // filehash - not a filter
        undefined, // datatype - not a filter
        undefined, // dimensions - not a filter
        undefined, // voxelsize - not a filter
        daterange
      );

      if (result.success && result.projects) {
        // Sanitize the projects and fetch reconstruction metadata for each
        const sanitized_results = await Promise.all(
          result.projects.map(async (project) => {
            // Fetch reconstruction data for the project
            let reconstructionMetadata = null;
            try {
              const reconResult = await readProjectReconstruction(String(project._id));
              if (reconResult.success && reconResult.projectreconstructions && reconResult.projectreconstructions.length > 0) {
                // Get the most recent reconstruction
                const latestReconstruction = reconResult.projectreconstructions[0];
                
                // Get tar file size from S3 if available
                let tarFileSize = null;
                if (latestReconstruction.reconstructedMesh?.path) {
                  tarFileSize = await getS3FileSize(latestReconstruction.reconstructedMesh.path);
                }
                
                reconstructionMetadata = {
                  edFrame: latestReconstruction.ed_frame,
                  tarFileSize: tarFileSize || latestReconstruction.reconstructedMesh?.filesize || null,
                  meshFormat: latestReconstruction.meshFormat,
                };
              }
            } catch (reconError) {
              // Log but don't fail if reconstruction fetch fails
              logger.warn(`${serviceLocation}: Error fetching reconstruction for project ${project._id}:`, reconError);
            }

            return {
              projectId: project._id,
              name: project.name,
              description: project.description,
              isSaved: project.isSaved,
              filesize: project.filesize,
              filetype: project.filetype,
              dimensions: project.dimensions,
              voxelsize: project.voxelsize,
              affineMatrix: project.affineMatrix,
              createdAt: project.createdAt,
              updatedAt: project.updatedAt,
              reconstruction: reconstructionMetadata,
            };
          })
        );

        return res.status(200).json({ projects: sanitized_results }); // Return the projects
      } else {
        return res.status(404).json({ message: result.message });
      }
    } catch (error: any) {
      logger.error(
        `${serviceLocation}: Error reading projects - ${error.message}`
      );
      return res.status(500).json({ message: "Failed to retrieve projects." });
    }
  }
);

// Route to read/search projects for admin (all users)
router.get(
  "/get-allusers-with-projects",
  isAuthAndAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await readUser({});

      if (!result.success || !result.users) {
        res.status(404).json({
          fetch: false,
          message: "No users found or error fetching users.",
        });
        return;
      }

      // Fetch projects for each user
      const usersWithProjects = await Promise.all(
        result.users.map(async (user) => {
          const projectResult = await readProject(undefined, user._id);

          return {
            userId: user._id,
            username: user.username, // Include username as you mentioned
            projectCount:
              projectResult.success && projectResult.projects
                ? projectResult.projects.length
                : 0,
            projects:
              projectResult.success && projectResult.projects
                ? projectResult.projects.map((project) => ({
                    projectId: project._id,
                    name: project.name,
                    description: project.description,
                    isSaved: project.isSaved,
                    filesize: project.filesize,
                    filetype: project.filetype,
                    dimensions: project.dimensions,
                    affineMatrix: project.affineMatrix,
                    createdAt: project.createdAt,
                    updatedAt: project.updatedAt,
                  }))
                : [],
          };
        })
      );

      logger.info(`${serviceLocation}: Fetched all users with their projects.`);
      res.status(200).json({
        fetch: true,
        totalUsers: usersWithProjects.length,
        data: usersWithProjects,
      });
    } catch (error: unknown) {
      logger.error(
        `${serviceLocation}: Error fetching users with projects: ${error}`
      );
      res
        .status(500)
        .json({ fetch: false, message: "Internal error during fetch." });
    }
  }
);

// Route to update project name and/or description
router.patch("/update-project", isAuth, async (req: Request, res: Response) => {
  const { projectId, name, description } = req.body;
  const userId = (req.user as any)?._id;

  if (!projectId) {
    return res.status(400).json({ message: "Missing projectId." });
  }
  if (!name && !description) {
    return res
      .status(400)
      .json({ message: "Please provide a name or description to update." });
  }
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized." });
  }

  try {
    const updateFields: { name?: string; description?: string } = {};
    if (name !== undefined) {
      updateFields.name = name;
    }
    if (description !== undefined) {
      updateFields.description = description;
    }

    const result = await updateProject(projectId, updateFields);
    if (result.success) {
      return res
        .status(200)
        .json({ message: "Project details updated successfully." });
    } else {
      return res.status(404).json({ message: result.message });
    }
  } catch (error: any) {
    logger.error(
      `${serviceLocation}: Error updating project ${projectId} - ${error.message}`
    );
    return res
      .status(500)
      .json({ message: "Failed to update project details." });
  }
});

// Route to save project (isSaved = true)
// This route is for updating project status to save, so that cron job would not delete
router.patch(
  "/save-project",
  isAuthAndNotGuest,
  async (req: Request, res: Response) => {
    try {
      const { projectId, isSaved } = req.body;
      const userId = req.user?._id;

      // Check for user authentication
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized. User ID not found.",
        });
      }

      // If projectId and isSaved are not provided, return error
      if (!projectId) {
        return res.status(400).json({
          success: false,
          message: "Missing projectId.",
        });
      }

      if (isSaved === undefined) {
        return res.status(400).json({
          success: false,
          message: "Missing isSaved value.",
        });
      }

      // Check if isSaved is a valid boolean
      if (typeof isSaved !== "boolean") {
        return res.status(400).json({
          success: false,
          message: "isSaved must be a boolean.",
        });
      }

      // Check if projectId is valid and belongs to the user
      const projectExist = await readProject(projectId, userId);

      // Handle case where project doesn't exist or doesn't belong to user
      if (!projectExist.success) {
        return res.status(404).json({
          success: false,
          message:
            projectExist.message || `Error looking up project ${projectId}.`,
        });
      }

      if (!projectExist.projects || projectExist.projects.length === 0) {
        return res.status(404).json({
          success: false,
          message: `Project ${projectId} not found or you don't have access to it.`,
        });
      }

      // Update the project status - pass both projectId and userId for security
      const updateProjectToSaved = await updateProject(
        projectId,
        { isSaved: isSaved } // Update only the isSaved field
      );

      // Handle update result with proper error handling
      if (updateProjectToSaved.success) {
        logger.info(
          `${serviceLocation}: User ${userId} updated project ${projectId} saved status to ${isSaved}`
        );
        return res.status(200).json({
          success: true,
          message: `Project ${projectId} saved status updated to ${isSaved}.`,
        });
      } else {
        // Handle failed update
        return res.status(400).json({
          success: false,
          message:
            updateProjectToSaved.message ||
            `Failed to update saved status for project ${projectId}.`,
        });
      }
    } catch (error) {
      // Catch and log any unexpected errors
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      LogError(
        error instanceof Error ? error : new Error(errorMessage),
        serviceLocation,
        `Error updating project saved status for project ID: ${req.body?.projectId}`
      );

      return res.status(500).json({
        success: false,
        message:
          "An unexpected error occurred while updating the project status.",
      });
    }
  }
);

// Add this endpoint to get presigned URLs for project files
router.get(
  "/get-project-presigned-url",
  isAuth,
  async (req: Request, res: Response) => {
    try {
      const projectId = req.query.projectId as string;
      const userId = (req.user as any)?._id;

      const projectResult = await readProject(projectId, userId);
      if (
        !projectResult.success ||
        !projectResult.projects ||
        projectResult.projects.length === 0
      ) {
        return res
          .status(404)
          .json({ success: false, message: "Project not found" });
      }
      const project = projectResult.projects[0];
      const s3HttpsUrlForTar = project.extractedfolderpath;

      if (!s3HttpsUrlForTar) {
        return res
          .status(404)
          .json({ success: false, message: "Project has no associated file" });
      }

      const objectKey = extractS3KeyFromUrl(s3HttpsUrlForTar);
      if (!objectKey) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid S3 URL format" });
      }

      const presignedUrl = await generatePresignedGetUrl(
        process.env.AWS_BUCKET_NAME!,
        objectKey,
        1800
      );

      if (!presignedUrl) {
        return res.status(500).json({
          success: false,
          message: "Failed to generate presigned URL",
        });
      }

      return res.json({
        success: true,
        presignedUrl,
        expiresAt: Date.now() + 1800 * 1000,
      });
    } catch (error: any) {
      logger.error(
        `${serviceLocation}: Error generating presigned URL: ${error.message}`,
        error
      );
      return res.status(500).json({
        success: false,
        message: "Server error generating presigned URL",
      });
    }
  }
);

router.delete(
  "/user-delete-project/:projectId",
  isAuthAndNotGuest,
  async (req: Request, res: Response) => {
    const projectId = toSingleString(req.params.projectId);
    const userId = req.user?._id;

    logger.info(
      `${serviceLocation}: Received request to delete project ID ${projectId} by user ${userId}`
    ); // CORRECTED

    if (!projectId) {
      return res
        .status(400)
        .json({ success: false, message: "Project ID is required." });
    }
    if (!userId) {
      // This should ideally be caught by isAuthAndNotGuest, but as a safeguard:
      return res
        .status(401)
        .json({ success: false, message: "Unauthorized. User ID not found." });
    }

    try {
      // Read the project to verify ownership and get S3 paths
      const projectResult = await readProject(projectId, userId.toString());

      if (
        !projectResult.success ||
        !projectResult.projects ||
        projectResult.projects.length === 0
      ) {
        logger.warn(
          `${serviceLocation}: Project ${projectId} not found or user ${userId} does not have access. Message: ${projectResult.message}`
        ); // CORRECTED
        return res.status(404).json({
          success: false,
          message:
            projectResult.message || "Project not found or access denied.",
        });
      }
      const projectToDelete = projectResult.projects[0];

      // Delete associated files from S3
      const s3BucketName = process.env.AWS_BUCKET_NAME;
      if (!s3BucketName) {
        logger.error(
          `${serviceLocation}: S3_BUCKET_NAME is not configured. Cannot delete S3 files for project ${projectId}.`
        ); // CORRECTED
        // Decide if you want to proceed with DB deletion or halt. For now, halting.
        return res.status(500).json({
          success: false,
          message: "Server configuration error: S3 bucket not set.",
        });
      }

      const s3KeysToDelete: string[] = [];
      
      // 1. Add project's original NIfTI file
      if (projectToDelete.originalfilepath) {
        const key = extractS3KeyFromUrl(projectToDelete.originalfilepath);
        if (key) s3KeysToDelete.push(key);
      }
      
      // 2. Add project's extracted JPEG frames tar
      if (projectToDelete.extractedfolderpath) {
        // This might be a TAR file of JPEGs
        const key = extractS3KeyFromUrl(projectToDelete.extractedfolderpath);
        if (key) s3KeysToDelete.push(key);
      }

      // 3. Add reconstruction mesh tar files
      try {
        const reconstructionsResult = await readProjectReconstruction(projectId);
        if (reconstructionsResult.success && reconstructionsResult.projectreconstructions) {
          for (const recon of reconstructionsResult.projectreconstructions) {
            if (recon.reconstructedMesh?.path) {
              const key = extractS3KeyFromUrl(recon.reconstructedMesh.path);
              if (key) {
                logger.info(`${serviceLocation}: Adding reconstruction mesh file to deletion queue: ${key}`);
                s3KeysToDelete.push(key);
              }
            }
          }
        }
      } catch (reconError) {
        LogError(
          reconError as Error,
          serviceLocation,
          `Error fetching reconstructions for project ${projectId} during deletion. Continuing with other S3 files.`
        );
      }

      for (const s3Key of s3KeysToDelete) {
        try {
          logger.info(
            `${serviceLocation}: Deleting S3 object: s3://${s3BucketName}/${s3Key} for project ${projectId}`
          ); // CORRECTED
          await deleteFromS3(s3Key); // Pass only the S3 key as required
        } catch (s3Error) {
          LogError(
            s3Error as Error,
            serviceLocation,
            `Failed to delete S3 object ${s3Key} for project ${projectId}. Continuing with DB deletion.`
          ); // CORRECTED
          // Decide if an S3 deletion failure should halt the process.
        }
      }

      // Delete the project from the database (this will cascade delete segmentation masks)
      const deleteDbResult = await deleteProject(projectId);

      if (!deleteDbResult.success) {
        logger.error(
          `${serviceLocation}: Failed to delete project ${projectId} from database. Message: ${deleteDbResult.message}`
        ); // CORRECTED
        return res.status(500).json({
          success: false,
          message:
            deleteDbResult.message || "Failed to delete project from database.",
        });
      }

      logger.info(
        `${serviceLocation}: Successfully deleted project ${projectId} and its associated data for user ${userId}.`
      ); // CORRECTED
      return res.status(200).json({
        success: true,
        message: "Project and associated data deleted successfully.",
      });
    } catch (error) {
      LogError(
        error as Error,
        serviceLocation,
        `Error deleting project ${projectId}`
      ); // CORRECTED
      return res.status(500).json({
        success: false,
        message: "An unexpected error occurred while deleting the project.",
      });
    }
  }
);

router.delete(
  "/admin-delete-project/:projectId",
  isAuthAndAdmin,
  async (req: Request, res: Response) => {
    const projectId = toSingleString(req.params.projectId);
    const adminUserId = req.user?._id; // For logging who performed the action

    logger.info(
      `${serviceLocation}: ADMIN ${adminUserId} initiated request to delete project ID ${projectId}`
    ); // CORRECTED

    if (!projectId) {
      // This check is technically redundant due to path parameter, but good practice
      return res
        .status(400)
        .json({ success: false, message: "Project ID is required." });
    }

    try {
      // Read the project to get S3 paths (no ownership check needed for admin)
      // The readProject function can be called with only projectId for admin scenarios
      const projectResult = await readProject(projectId);

      if (
        !projectResult.success ||
        !projectResult.projects ||
        projectResult.projects.length === 0
      ) {
        logger.warn(
          `${serviceLocation}: Admin ${adminUserId} attempted to delete non-existent project ${projectId}. Message: ${projectResult.message}`
        ); // CORRECTED
        return res.status(404).json({
          success: false,
          message: projectResult.message || `Project ${projectId} not found.`, // CORRECTED
        });
      }
      const projectToDelete = projectResult.projects[0];

      // Delete associated files from S3
      const s3BucketName = process.env.AWS_BUCKET_NAME;
      if (!s3BucketName) {
        logger.error(
          `${serviceLocation}: S3_BUCKET_NAME is not configured. Admin ${adminUserId} cannot delete S3 files for project ${projectId}.`
        ); // CORRECTED
        return res.status(500).json({
          success: false,
          message: "Server configuration error: S3 bucket not set.",
        });
      }

      const s3KeysToDelete: string[] = [];
      
      // 1. Add project's original NIfTI file
      if (projectToDelete.originalfilepath) {
        const key = extractS3KeyFromUrl(projectToDelete.originalfilepath);
        if (key) s3KeysToDelete.push(key);
      }
      
      // 2. Add project's extracted JPEG frames tar
      if (projectToDelete.extractedfolderpath) {
        // This might be a TAR file of JPEGs
        const key = extractS3KeyFromUrl(projectToDelete.extractedfolderpath);
        if (key) s3KeysToDelete.push(key);
      }

      // 3. Add reconstruction mesh tar files
      try {
        const reconstructionsResult = await readProjectReconstruction(projectId);
        if (reconstructionsResult.success && reconstructionsResult.projectreconstructions) {
          for (const recon of reconstructionsResult.projectreconstructions) {
            if (recon.reconstructedMesh?.path) {
              const key = extractS3KeyFromUrl(recon.reconstructedMesh.path);
              if (key) {
                logger.info(`${serviceLocation}: Admin ${adminUserId} adding reconstruction mesh file to deletion queue: ${key}`);
                s3KeysToDelete.push(key);
              }
            }
          }
        }
      } catch (reconError) {
        LogError(
          reconError as Error,
          serviceLocation,
          `Admin ${adminUserId} error fetching reconstructions for project ${projectId} during deletion. Continuing with other S3 files.`
        );
      }

      for (const s3Key of s3KeysToDelete) {
        try {
          logger.info(
            `${serviceLocation}: Admin ${adminUserId} deleting S3 object: s3://${s3BucketName}/${s3Key} for project ${projectId}`
          ); // CORRECTED
          await deleteFromS3(s3Key); // deleteFromS3 expects only the key
        } catch (s3Error) {
          LogError(
            s3Error as Error,
            serviceLocation,
            `Admin ${adminUserId} failed to delete S3 object ${s3Key} for project ${projectId}. Continuing with DB deletion.`
          ); // CORRECTED
        }
      }

      // Delete the project from the database (this will cascade delete segmentation masks)
      const deleteDbResult = await deleteProject(projectId);

      if (!deleteDbResult.success) {
        logger.error(
          `${serviceLocation}: Admin ${adminUserId} failed to delete project ${projectId} from database. Message: ${deleteDbResult.message}`
        ); // CORRECTED
        return res.status(500).json({
          success: false,
          message:
            deleteDbResult.message ||
            `Failed to delete project ${projectId} from database.`, // CORRECTED
        });
      }

      logger.info(
        `${serviceLocation}: Admin ${adminUserId} successfully deleted project ${projectId} and its associated data.`
      ); // CORRECTED
      return res.status(200).json({
        success: true,
        message: `Project ${projectId} and associated data deleted successfully by admin.`, // CORRECTED
      });
    } catch (error) {
      LogError(
        error as Error,
        serviceLocation,
        `Admin ${adminUserId} encountered error deleting project ${projectId}`
      ); // CORRECTED
      return res.status(500).json({
        success: false,
        message:
          "An unexpected error occurred while admin was deleting the project.",
      });
    }
  }
);

export default router;
