// File: src/services/segmentation_export.ts
// Description: Service layer for segmentation NIfTI export functionality - extracted from routes for reuse.

import { IProjectSegmentationMask, IProjectDocument } from "../types/database_types";
import { readProject, readProjectSegmentationMask } from "./database";
import { generatePresignedGetUrl } from "../utils/s3_presigned_url";
import { uploadMaskToS3, downloadFromS3, extractS3KeyFromUrl } from "./s3_handler";
import logger from "./logger";
import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

const serviceLocation = 'SegmentationExport';

/**
 * Generates a segmentation NIfTI file specifically for 4D reconstruction
 * Uses editable masks (user-refined segmentation) for better reconstruction accuracy
 * 
 * @param projectId - The project ID to generate segmentation NIfTI for
 * @param userId - The user ID (for access validation)
 * @returns Promise with success status, S3 URL, and metadata
 */
export const generateAISegmentationForReconstruction = async (
    projectId: string, 
    userId?: string
): Promise<{ 
    success: boolean; 
    message?: string; 
    s3Url?: string; 
    fileSizeBytes?: number;
    s3Key?: string;
}> => {
    const tempExportId = uuidv4();
    const baseTempDir = path.join(__dirname, '..', 'temp_exports', tempExportId);
    const segmentationsJsonPath = path.join(baseTempDir, 'segmentations.json');
    const localOutputSegmentationNiftiPath = path.join(baseTempDir, `reconstruction_${tempExportId}.nii.gz`);

        logger.info(`${serviceLocation}: Generating AI segmentation NIfTI for project ${projectId}`);    try {
        const s3BucketName = process.env.AWS_BUCKET_NAME;
        if (!s3BucketName) {
            return { success: false, message: "AWS S3 bucket configuration is missing." };
        }

        await fs.ensureDir(baseTempDir);

        // 1. Validate segmentation masks exist
        const hasMasksResult = await readProjectSegmentationMask(projectId);
        if (!hasMasksResult.projectsegmentationmasks || hasMasksResult.projectsegmentationmasks.length === 0) {
            return { success: false, message: "No segmentation masks found. Run AI segmentation first for reconstruction." };
        }

        // 2. Read Project Details (including dimensions and original NIfTI path)
        const projectResult = await readProject(projectId, userId);
        if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
            logger.warn(`${serviceLocation}: Project ${projectId} not found or user ${userId} does not have access.`);
            return { success: false, message: "Project not found or access denied." };
        }
        
        const project: IProjectDocument = projectResult.projects[0];

        if (!project.dimensions || project.dimensions.width == null || project.dimensions.height == null) {
            logger.error(`${serviceLocation}: Project ${projectId} is missing critical dimension data (width/height).`);
            return { success: false, message: "Project is missing critical dimension data." };
        }

        const planeHeightForRLE = project.dimensions.height;
        const planeWidthForRLE = project.dimensions.width;

        // 3. Select the best reconstruction mask set.
        // Prefer the editable mask, but fall back to the AI mask if the editable export is missing myocardium labels.
        const editableMask = hasMasksResult.projectsegmentationmasks!.find(mask => mask.isMedSAMOutput === false);
        const aiMask = hasMasksResult.projectsegmentationmasks!.find(mask => mask.isMedSAMOutput === true);

        const maskHasMyocardium = (mask?: IProjectSegmentationMask) =>
            !!mask?.frames?.some(frame =>
                frame.slices?.some(slice =>
                    slice.segmentationmasks?.some(entry => String(entry.class).toLowerCase() === "myo")
                )
            );

        let segmentationsToProcess: IProjectSegmentationMask[] = [];
        let exportMask: IProjectSegmentationMask | undefined;
        if (editableMask && maskHasMyocardium(editableMask)) {
            segmentationsToProcess = [editableMask];
            exportMask = editableMask;
            logger.info(`${serviceLocation}: Using editable mask for reconstruction`);
        } else if (aiMask && maskHasMyocardium(aiMask)) {
            segmentationsToProcess = [aiMask];
            exportMask = aiMask;
            logger.warn(`${serviceLocation}: Editable mask has no myocardium labels; falling back to AI mask for reconstruction`);
        } else if (editableMask) {
            logger.error(`${serviceLocation}: No myocardium (myo/label 2) found in editable or AI masks for project ${projectId}`);
            return { success: false, message: "Reconstruction requires myocardium labels in the segmentation masks. Please re-run segmentation or verify the saved masks." };
        } else {
            logger.error(`${serviceLocation}: No editable mask found for project ${projectId}`);
            return { success: false, message: "No editable segmentation mask available for reconstruction. Please complete or refine segmentation first." };
        }

        if (!exportMask) {
            throw new Error("Editable mask not found for this segmentation export");
        }

        // Write segmentation data for Python processing
        await fs.writeJson(segmentationsJsonPath, segmentationsToProcess, { spaces: 2 });
        
        // Log segmentation data being processed
        const maskStructure = {
            maskId: exportMask._id,
            frameCount: exportMask.frames?.length || 0,
            isMedSAMOutput: exportMask.isMedSAMOutput,
            firstFrameIndex: exportMask.frames?.[0]?.frameindex,
            lastFrameIndex: exportMask.frames?.[exportMask.frames.length - 1]?.frameindex
        };
        logger.info(`${serviceLocation}: Segmentation mask structure for project ${projectId}: ${JSON.stringify(maskStructure)}`);
        
        // Log detailed class distribution across frames for debugging
        const classDistribution: Record<string, number> = {};
        let totalMasks = 0;
        exportMask.frames?.forEach(frame => {
            frame.slices?.forEach(slice => {
                slice.segmentationmasks?.forEach(mask => {
                    const className = mask.class || 'unknown';
                    classDistribution[className] = (classDistribution[className] || 0) + 1;
                    totalMasks++;
                });
            });
        });
        const classInfo = {
            classes: classDistribution,
            totalMasks,
            hasLVC: !!classDistribution['LVC'],
            hasMYO: !!classDistribution['MYO'],
            hasRV: !!classDistribution['RV']
        };
        logger.info(`${serviceLocation}: Segmentation class distribution for project ${projectId}: ${JSON.stringify(classInfo)}`);

        // 4. Generate NIfTI using Python script
        let pythonScriptPath: string;
        let pythonCommand: string;

        if (project.affineMatrix && Array.isArray(project.affineMatrix) && project.affineMatrix.length > 0) {
            // Use stored affine matrix approach (faster, no S3 download required)
            pythonScriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'create_nifti_with_stored_affine.py');

            const affineMatrixFile = path.join(baseTempDir, 'affine_matrix.json');
            const dimensionsFile = path.join(baseTempDir, 'dimensions.json');

            await fs.writeJson(affineMatrixFile, project.affineMatrix, { spaces: 2 });
            await fs.writeJson(dimensionsFile, project.dimensions, { spaces: 2 });
            
            // Log critical NIfTI generation parameters
            const niftiParams = {
                dimensions: project.dimensions,
                planeWidth: planeWidthForRLE,
                planeHeight: planeHeightForRLE,
                affineMatrixShape: `${project.affineMatrix.length}x${project.affineMatrix[0]?.length}`,
                expectedShape: project.dimensions.frames 
                    ? `(${project.dimensions.height}, ${project.dimensions.width}, ${project.dimensions.slices}, ${project.dimensions.frames})`
                    : `(${project.dimensions.height}, ${project.dimensions.width}, ${project.dimensions.slices})`
            };
            logger.info(`${serviceLocation}: NIfTI generation parameters for project ${projectId}: ${JSON.stringify(niftiParams)}`);

            pythonCommand = `python3 "${pythonScriptPath}" "${segmentationsJsonPath}" "${localOutputSegmentationNiftiPath}" "${affineMatrixFile}" "${dimensionsFile}" "uint8" ${planeHeightForRLE} ${planeWidthForRLE}`;
        } else {
            // Use download and extract approach (legacy)
            logger.info(`${serviceLocation}: No stored affine matrix found for reconstruction of project ${projectId}. Using download approach.`);

            pythonScriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'create_nifti_segmentation.py');
            const s3Url = project.extractedfolderpath;

            if (!s3Url) {
                return { success: false, message: "Project has no associated S3 file path." };
            }

            pythonCommand = `python3 "${pythonScriptPath}" "${segmentationsJsonPath}" "${localOutputSegmentationNiftiPath}" ${planeWidthForRLE} ${planeHeightForRLE} "${s3Url}"`;
        }

        logger.info(`${serviceLocation}: Saving output - executing Python script for reconstruction NIfTI generation of project ${projectId}`);
        logger.debug(`${serviceLocation}: Python command: ${pythonCommand}`);

        const pythonResult = await new Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }>((resolve) => {
            exec(pythonCommand, (error, stdout, stderr) => {
                if (error) {
                    logger.error(`${serviceLocation}: Python script execution failed for reconstruction of project ${projectId}: ${error.message}`);
                    logger.error(`${serviceLocation}: Python stderr: ${stderr}`);
                    resolve({ success: false, error: error.message, stderr });
                } else {
                    logger.info(`${serviceLocation}: Python script completed successfully for reconstruction of project ${projectId}`);
                    if (stdout) {
                        logger.info(`${serviceLocation}: Python stdout: ${stdout}`);
                    }
                    if (stderr) {
                        logger.warn(`${serviceLocation}: Python stderr (warnings): ${stderr}`);
                    }
                    resolve({ success: true, stdout, stderr });
                }
            });
        });

        if (!pythonResult.success) {
            return { success: false, message: `NIfTI generation failed for reconstruction: ${pythonResult.error}` };
        }

        // 5. Check if the output file was created
        const outputExists = await fs.pathExists(localOutputSegmentationNiftiPath);
        if (!outputExists) {
            logger.error(`${serviceLocation}: Expected NIfTI output file not created for reconstruction of project ${projectId}: ${localOutputSegmentationNiftiPath}`);
            return { success: false, message: "NIfTI file was not generated successfully for reconstruction." };
        }

        const fileStats = await fs.stat(localOutputSegmentationNiftiPath);
        logger.info(`${serviceLocation}: Successfully generated reconstruction NIfTI for project ${projectId}. File size: ${fileStats.size} bytes`);

        // 6. Upload to S3
        const fileStream = fs.createReadStream(localOutputSegmentationNiftiPath);
        const uploadedUrl = await uploadMaskToS3(
            fileStream,
            userId || 'system',
            tempExportId,
            '.nii.gz',
            'reconstruction_nifti/',
            `reconstruction_${projectId}_${tempExportId}.nii.gz`
        );

        // Extract S3 key from the returned URL
        const s3Key = extractS3KeyFromUrl(uploadedUrl);
        if (!s3Key) {
            logger.error(`${serviceLocation}: Failed to extract S3 key from uploaded URL: ${uploadedUrl}`);
            return { success: false, message: "Failed to extract S3 key after upload." };
        }

        logger.info(`${serviceLocation}: Saving output - successfully uploaded reconstruction NIfTI to S3`);

        // Generate presigned URL for GPU server access
        const presignedUrl = await generatePresignedGetUrl(s3BucketName, s3Key, 3600);
        
        return {
            success: true,
            message: "AI segmentation NIfTI generated successfully for reconstruction.",
            s3Key: s3Key,
            s3Url: presignedUrl || undefined,
            fileSizeBytes: fileStats.size
        };

    } catch (error: any) {
        logger.error(`${serviceLocation}: Error generating AI segmentation NIfTI for reconstruction of project ${projectId}:`, error);
        return { success: false, message: `Error generating AI segmentation NIfTI for reconstruction: ${error.message}` };
    } finally {
        // Clean up temporary files
        if (await fs.pathExists(baseTempDir)) {
            await fs.remove(baseTempDir);
        }
    }
};