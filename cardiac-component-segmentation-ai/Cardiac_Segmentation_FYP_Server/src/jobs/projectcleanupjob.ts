import { projectModel, projectSegmentationMaskModel, deleteProject, readProjectReconstruction } from "../services/database";
import { cleanupUserS3Storage, deleteFromS3, extractS3KeyFromUrl } from "../services/s3_handler";
import logger from "../services/logger";

/**
 * Handles the save/unsave logic for user projects and segmentation masks.
 * - Updates `isSaved` for projects and segmentation masks.
 * - Deletes unsaved projects and segmentation masks (and their associated S3 files).
 *
 * @async
 * @function handleUserSaveUnsave
 * @param {string} userId - The ID of the user whose projects and masks are being processed.
 * @param {boolean} isSaved - The `isSaved` status to apply. If `false`, unsaved data will be deleted.
 * @returns {Promise<void>}
 */
export const handleUserSaveUnsave = async (userId: string, isSaved: boolean): Promise<void> => {
  const serviceLocation = "Projectcleanupjob";
  try {
    logger.info(`${serviceLocation}: Starting save/unsave process for user ${userId} with isSaved=${isSaved}.`);

    // Step 1: Find all projects for the user
    const userProjects = await projectModel.find({ userid: userId }).lean();
    if (!userProjects || userProjects.length === 0) {
      logger.info(`${serviceLocation}: No projects found for user ${userId}.`);
      return;
    }

    // Step 2: Process each project
    for (const project of userProjects) {
      if (isSaved) {
        // Update `isSaved` to true for the project and its segmentation masks
        project.isSaved = true;
        await projectModel.updateOne({ _id: project._id }, { $set: { isSaved: true } });
        // Also update all associated segmentation masks to isSaved = true (which has no effect currently in the new frontend)
        await projectSegmentationMaskModel.updateMany({ projectid: project._id }, { $set: { isSaved: true } });
        logger.info(`${serviceLocation}: Marked project ${project._id} and its segmentation masks as saved.`);
      } else if (!project.isSaved) {
        // If `isSaved = false`, delete the project and its associated data
        logger.info(`${serviceLocation}: Deleting unsaved project ${project._id} and its associated data.`);

        // Step 2.1: Delete the S3 files for this specific project
        let s3CleanupSuccess = true;
        const s3Failures = [];

        if (project.originalfilepath) {
          const originalKey = extractS3KeyFromUrl(project.originalfilepath);
          if (originalKey) {
            const success = await deleteFromS3(originalKey);
            if (!success) {
              s3CleanupSuccess = false;
              s3Failures.push(`original file: ${originalKey}`);
              logger.error(`${serviceLocation}: Failed to delete original S3 file for project ${project._id}: ${originalKey}`);
            }
          }
        }

        if (project.extractedfolderpath) {
          const extractedKey = extractS3KeyFromUrl(project.extractedfolderpath);
          if (extractedKey) {
            const success = await deleteFromS3(extractedKey);
            if (!success) {
              s3CleanupSuccess = false;
              s3Failures.push(`extracted files: ${extractedKey}`);
              logger.error(`${serviceLocation}: Failed to delete extracted S3 file for project ${project._id}: ${extractedKey}`);
            }
          }
        }

        // Step 2.1.5: Delete reconstruction mesh tar files
        try {
          const reconstructionsResult = await readProjectReconstruction(project._id.toString());
          if (reconstructionsResult.success && reconstructionsResult.projectreconstructions) {
            for (const recon of reconstructionsResult.projectreconstructions) {
              if (recon.reconstructedMesh?.path) {
                const reconKey = extractS3KeyFromUrl(recon.reconstructedMesh.path);
                if (reconKey) {
                  logger.info(`${serviceLocation}: Deleting reconstruction mesh file for project ${project._id}: ${reconKey}`);
                  const success = await deleteFromS3(reconKey);
                  if (!success) {
                    s3CleanupSuccess = false;
                    s3Failures.push(`reconstruction mesh: ${reconKey}`);
                    logger.error(`${serviceLocation}: Failed to delete reconstruction S3 file for project ${project._id}: ${reconKey}`);
                  }
                }
              }
            }
          }
        } catch (reconError) {
          logger.error(`${serviceLocation}: Error fetching reconstructions during cleanup for project ${project._id}:`, reconError);
          // Don't fail the entire cleanup if reconstruction fetch fails
        }

        // Step 2.2: Only delete the project if S3 cleanup was successful
        if (s3CleanupSuccess) {
          const deleteResult = await deleteProject(project._id.toString());
          if (deleteResult.success) {
            logger.info(`${serviceLocation}: Successfully deleted project ${project._id} and its S3 files.`);
          } else {
            logger.error(`${serviceLocation}: S3 cleanup succeeded but failed to delete project ${project._id} from database: ${deleteResult.message}`);
          }
        } else {
          logger.error(`${serviceLocation}: Skipping database deletion for project ${project._id} due to S3 cleanup failures: ${s3Failures.join(', ')}`);
          logger.warn(`${serviceLocation}: Project ${project._id} remains in database to prevent orphaned S3 files. Manual cleanup may be required.`);
        }
      }
    }

    logger.info(`${serviceLocation}: Save/unsave process completed for user ${userId}.`);
  } catch (error) {
    logger.error(`${serviceLocation}: Error during save/unsave process for user ${userId}:`, error);
  }
};