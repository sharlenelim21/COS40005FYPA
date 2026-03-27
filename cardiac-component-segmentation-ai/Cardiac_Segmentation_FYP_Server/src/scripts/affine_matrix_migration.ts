// File: src/scripts/affine_matrix_migration.ts
// Description: One-time migration script to add affine matrix data to existing projects
// by downloading their original files, extracting the matrix, and updating the database.

import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import logger from '../services/logger';
import LogError from '../utils/error_logger';
import { projectModel, IProjectDocument } from '../services/database';
import { extractS3KeyFromUrl, downloadFromS3 } from '../services/s3_handler';
import { extractNiftiMetadata } from '../utils/nifti_parser';

const serviceLocation = "AffineMigration";

/**
 * Check if migration is needed (for startup optimization)
 * @returns Promise<boolean> - true if migration is needed, false otherwise
 */
export async function isMigrationNeeded(): Promise<boolean> {
    try {
        const countWithoutAffine = await projectModel.countDocuments({
            $or: [
                { affineMatrix: { $exists: false } },
                { affineMatrix: null },
                { affineMatrix: [] },
                { affineMatrix: { $size: 0 } }
            ]
        });

        logger.info(`${serviceLocation}: Found ${countWithoutAffine} projects without affine matrix data.`);
        return countWithoutAffine > 0;
    } catch (error) {
        logger.error(`${serviceLocation}: Error checking if migration is needed:`, error);
        return false; // Assume no migration needed if we can't check
    }
}

/**
 * Migrate projects by downloading S3 files, extracting affine matrices, and updating database
 * This is the actual implementation that performs the migration
 */
export async function runAffineMigration(): Promise<void> {
    const migrationId = uuidv4();
    const tempDir = path.join(__dirname, '..', 'temp_migration', migrationId);

    try {
        logger.info(`${serviceLocation}: Starting affine matrix migration. Migration ID: ${migrationId}`);

        // Create temporary directory for downloads
        await fs.mkdir(tempDir, { recursive: true });
        logger.info(`${serviceLocation}: Created temporary directory: ${tempDir}`);

        // Find all projects without affine matrix
        const projectsWithoutAffine = await projectModel.find({
            $or: [
                { affineMatrix: { $exists: false } },
                { affineMatrix: null },
                { affineMatrix: [] },
                { affineMatrix: { $size: 0 } }
            ]
        }).select('_id name originalfilepath userid').lean();

        logger.info(`${serviceLocation}: Found ${projectsWithoutAffine.length} projects requiring affine matrix migration.`);

        if (projectsWithoutAffine.length === 0) {
            logger.info(`${serviceLocation}: No projects require migration. All projects already have affine matrix data.`);
            return;
        }

        const s3BucketName = process.env.AWS_BUCKET_NAME;
        if (!s3BucketName) {
            throw new Error("AWS_BUCKET_NAME environment variable is not set");
        }

        let successCount = 0;
        let errorCount = 0;

        // Process each project
        for (const project of projectsWithoutAffine) {
            try {
                await migrateProjectAffineMatrix(project, tempDir, s3BucketName);
                successCount++;
                logger.info(`${serviceLocation}: Successfully migrated project ${project._id} (${project.name}). Progress: ${successCount + errorCount}/${projectsWithoutAffine.length}`);
            } catch (error) {
                errorCount++;
                logger.error(`${serviceLocation}: Failed to migrate project ${project._id} (${project.name}): ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        logger.info(`${serviceLocation}: Migration completed. Success: ${successCount}, Errors: ${errorCount}, Total: ${projectsWithoutAffine.length}`);

    } catch (error) {
        LogError(error as Error, serviceLocation, "Error during affine matrix migration");
        throw error;
    } finally {
        // Cleanup temporary directory
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
            logger.info(`${serviceLocation}: Cleaned up temporary directory: ${tempDir}`);
        } catch (cleanupError) {
            logger.warn(`${serviceLocation}: Failed to cleanup temporary directory ${tempDir}: ${cleanupError}`);
        }
    }
}

/**
 * Migrate a single project by downloading its original file and extracting affine matrix
 */
async function migrateProjectAffineMatrix(project: Partial<IProjectDocument>, tempDir: string, s3BucketName: string): Promise<void> {
    const projectId = project._id ? project._id.toString() : '';

    if (!projectId || !project.originalfilepath) {
        logger.info(`Skipping project - missing ID or file path: ${projectId}`);
        return;
    }

    // Extract S3 key from the file path
    const s3Key = extractS3KeyFromUrl(project.originalfilepath);
    if (!s3Key) {
        throw new Error(`Could not extract S3 key from path: ${project.originalfilepath}`);
    }

    // Create temporary file path
    const tempFilePath = path.join(tempDir, `${projectId}_original.nii.gz`);

    try {
        // Download file from S3
        logger.info(`${serviceLocation}: Downloading ${s3Key} for project ${projectId}`);
        await downloadFromS3(s3BucketName, s3Key, tempFilePath);

        // Extract metadata including affine matrix
        logger.info(`${serviceLocation}: Extracting metadata for project ${projectId}`);
        const metadata = await extractNiftiMetadata(tempFilePath);

        if (!metadata.affineMatrix || metadata.affineMatrix.length === 0) {
            throw new Error(`No affine matrix found in metadata for project ${projectId}`);
        }

        // Update project in database
        logger.info(`${serviceLocation}: Updating database for project ${projectId} with affine matrix`);
        await projectModel.updateOne(
            { _id: project._id },
            { $set: { affineMatrix: metadata.affineMatrix } }
        );

        logger.info(`${serviceLocation}: Successfully updated project ${projectId} with affine matrix`);

    } finally {
        // Clean up temporary file
        try {
            await fs.unlink(tempFilePath);
        } catch (unlinkError) {
            logger.warn(`${serviceLocation}: Failed to cleanup temporary file ${tempFilePath}: ${unlinkError}`);
        }
    }
}
