// File: src/routes/sample_nifti.ts
// Description: Routes for serving sample NIfTI files information and static file access

import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import logger from '../services/logger';
import LogError from '../utils/error_logger';

const router = express.Router();
const serviceLocation = 'API(SampleNifti)';

const toSingleString = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

// Define the sample NIfTI directory path
const sampleNiftiDir = path.join(__dirname, '../../public/sample_nifti');

interface NiftiFileInfo {
    filename: string;
    size: number;
    sizeFormatted: string;
    modifiedDate: string;
    downloadUrl: string;
}

/**
 * Format bytes to display in MB
 */
const formatBytes = (bytes: number): string => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
};

/**
 * Get information about all NIfTI files in the sample directory
 */
router.get('/info', async (req: Request, res: Response) => {
    try {
        logger.info(`${serviceLocation}: Getting sample NIfTI files information`);

        // Check if sample directory exists
        if (!fs.existsSync(sampleNiftiDir)) {
            logger.error(`${serviceLocation}: Sample NIfTI directory not found at ${sampleNiftiDir}`);
            return res.status(404).json({
                success: false,
                message: 'Sample NIfTI directory not found'
            });
        }

        // Read directory contents
        const files = fs.readdirSync(sampleNiftiDir);

        // Filter for .nii.gz files and get file information
        const niftiFiles: NiftiFileInfo[] = [];

        for (const file of files) {
            if (file.endsWith('.nii.gz')) {
                const filePath = path.join(sampleNiftiDir, file);
                try {
                    const stats = fs.statSync(filePath);
                    niftiFiles.push({
                        filename: file,
                        size: stats.size,
                        sizeFormatted: formatBytes(stats.size),
                        modifiedDate: stats.mtime.toISOString(),
                        downloadUrl: `/sample-nifti/download/${file}`
                    });
                } catch (error) {
                    logger.warn(`${serviceLocation}: Could not get stats for file ${file}: ${error}`);
                    // Continue with other files even if one fails
                }
            }
        }

        // Sort files by filename for consistent ordering
        niftiFiles.sort((a, b) => a.filename.localeCompare(b.filename));

        logger.info(`${serviceLocation}: Found ${niftiFiles.length} sample NIfTI files`);

        return res.status(200).json({
            success: true,
            message: `Found ${niftiFiles.length} sample NIfTI files`,
            data: {
                totalFiles: niftiFiles.length,
                files: niftiFiles
            }
        });

    } catch (error) {
        LogError(error instanceof Error ? error : new Error(String(error)), serviceLocation, 'Failed to get sample NIfTI files information');
        return res.status(500).json({
            success: false,
            message: 'Internal server error while retrieving file information'
        });
    }
});

/**
 * Download a specific NIfTI file
 */
router.get('/download/:filename', async (req: Request, res: Response) => {
    try {
        const filename = toSingleString(req.params.filename);

        // Validate filename
        if (!filename || !filename.endsWith('.nii.gz')) {
            return res.status(400).json({
                success: false,
                message: 'Invalid filename. Must be a .nii.gz file.'
            });
        }

        // Security check: prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            logger.warn(`${serviceLocation}: Potential directory traversal attempt with filename: ${filename}`);
            return res.status(400).json({
                success: false,
                message: 'Invalid filename format'
            });
        }

        const filePath = path.join(sampleNiftiDir, filename);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            logger.warn(`${serviceLocation}: Requested file not found: ${filename}`);
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }

        // Get file stats
        const stats = fs.statSync(filePath);

        // Set appropriate headers for download
        res.setHeader('Content-Type', 'application/gzip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day

        logger.info(`${serviceLocation}: Serving file ${filename} (${formatBytes(stats.size)})`);

        // Stream the file
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);

        fileStream.on('error', (error) => {
            LogError(error, serviceLocation, `Error streaming file ${filename}`);
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    message: 'Error streaming file'
                });
            }
        });

    } catch (error) {
        LogError(error instanceof Error ? error : new Error(String(error)), serviceLocation, `Failed to serve file ${req.params.filename}`);
        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: 'Internal server error while serving file'
            });
        }
    }
});

/**
 * Get metadata for a specific file
 */
router.get('/metadata/:filename', async (req: Request, res: Response) => {
    try {
        const filename = toSingleString(req.params.filename);

        // Validate filename
        if (!filename || !filename.endsWith('.nii.gz')) {
            return res.status(400).json({
                success: false,
                message: 'Invalid filename. Must be a .nii.gz file.'
            });
        }

        // Security check: prevent directory traversal
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            return res.status(400).json({
                success: false,
                message: 'Invalid filename format'
            });
        }

        const filePath = path.join(sampleNiftiDir, filename);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                message: 'File not found'
            });
        }

        // Get file stats
        const stats = fs.statSync(filePath);

        const fileInfo: NiftiFileInfo = {
            filename: filename,
            size: stats.size,
            sizeFormatted: formatBytes(stats.size),
            modifiedDate: stats.mtime.toISOString(),
            downloadUrl: `/sample-nifti/download/${filename}`
        };

        logger.info(`${serviceLocation}: Retrieved metadata for file ${filename}`);

        return res.status(200).json({
            success: true,
            message: 'File metadata retrieved successfully',
            data: fileInfo
        });

    } catch (error) {
        LogError(error instanceof Error ? error : new Error(String(error)), serviceLocation, `Failed to get metadata for file ${req.params.filename}`);
        return res.status(500).json({
            success: false,
            message: 'Internal server error while retrieving file metadata'
        });
    }
});

export default router;
