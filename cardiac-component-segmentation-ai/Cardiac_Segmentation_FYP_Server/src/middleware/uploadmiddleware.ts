import multer, { StorageEngine } from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { Request, Response } from "express";
import { FileType } from "../types/database_types";
import logger from '../services/logger';

const serviceLocation = "UploadMiddleware";

dotenv.config();

// Function to create the temporary upload directory if it doesn't exist
const ensureTempUploadDirExists = (): void => {
  const tempUploadDir = "src/temp_upload/";
  if (!fs.existsSync(tempUploadDir)) {
    fs.mkdirSync(tempUploadDir, { recursive: true });
    logger.info(`${serviceLocation}: Temporary upload directory created at: ${tempUploadDir}`);
  }
};

// Call the function when this module is loaded
ensureTempUploadDirExists();

// Allowed Extensions and MIME types
const allowedExtensions = [".nii", ".nii.gz", ".dcm"];

// File Type Enum Mappings to MIME types (adjust as per your FileType enum definition)
// This mapping assumes FileType enum values are the expected MIME types.
const fileTypeToMimeMappings: Record<string, string> = {
  [FileType.NIFTI]: "application/octet-stream",
  [FileType.NIFTI_GZ]: "application/x-gzip",
  [FileType.DICOM]: "application/dicom",
};

// Multer Storage Engine (Use local storage unless S3 is enabled)
const storage: StorageEngine = multer.diskStorage({
  destination: (req, file, cb) => {
    // Always use a temporary local folder first, even for S3 uploads.
    // The actual S3 upload happens in the route handler after multer processing.
    cb(null, "src/temp_upload/");
  },
  filename: (req, file, cb) => {
    try {
      // Sanitize original filename to prevent path traversal attacks
      const sanitizedOriginal = path.basename(file.originalname);

      // Use name from form if provided, otherwise use the original filename
      const userFilename = req.body.name || path.parse(sanitizedOriginal).name;

      let ext = path.extname(sanitizedOriginal).toLowerCase();
      // Special handling for '.nii.gz'
      if (sanitizedOriginal.toLowerCase().endsWith(".nii.gz")) {
        ext = ".nii.gz";
      }

      // Create a unique filename with timestamp
      const timestamp = Date.now();
      const safeName = userFilename.replace(/[^a-zA-Z0-9_-]/g, '_');
      cb(null, `${safeName}-${timestamp}${ext}`);
    } catch (error) {
      logger.error(`${serviceLocation}: Error generating filename`, error);
      cb(error as Error, "");
    }
  },
});

// File Filter
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  let ext = path.extname(file.originalname).toLowerCase();
  // Special handling for '.nii.gz'
  if (file.originalname.toLowerCase().endsWith(".nii.gz")) {
    ext = ".nii.gz";
  }

  if (!allowedExtensions.includes(ext)) {
    return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", `Invalid file extension: ${ext}. Allowed: ${allowedExtensions.join(', ')}`));
  }

  // MIME type validation based on your FileType enum or direct mapping
  // This part might need adjustment based on how you define/use FileType enum
  // For example, if FileType.NIFTI maps directly to "application/octet-stream"
  let expectedMimeType: string | undefined;
  if (ext === ".nii") expectedMimeType = fileTypeToMimeMappings[FileType.NIFTI];
  else if (ext === ".nii.gz") expectedMimeType = fileTypeToMimeMappings[FileType.NIFTI_GZ];
  else if (ext === ".dcm") expectedMimeType = fileTypeToMimeMappings[FileType.DICOM];

  // The 'file.mimetype' provided by multer might not always be perfect for specialized files like .nii
  // If precise MIME type matching is critical and multer's detection is insufficient,
  // you might need more sophisticated type detection or rely more on the extension.
  // For now, this provides a basic check.
  if (expectedMimeType && file.mimetype !== expectedMimeType) {
    logger.warn(`${serviceLocation}: MIME type mismatch for ${file.originalname}. Expected: ${expectedMimeType}, Got: ${file.mimetype}. Proceeding based on extension.`);
    // You could choose to reject here:
    // return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", `Invalid file mimetype for ${ext}. Expected ${expectedMimeType}, got ${file.mimetype}`));
  }

  cb(null, true);
};

// When in upload route, this middleware will filter files based on the defined storage and file filter.
export const projectUploadFilter = multer({
  storage,
  limits: {
    fileSize: 200 * 1024 * 1024 * 1024, // 200 GB limit
    files: 10 // Maximum 10 files per request
  },
  fileFilter,
}).fields([
  // Define allowed fields for the multipart form
  { name: 'files', maxCount: 1 },  // File field
  { name: 'name', maxCount: 1 },    // Project name field
  { name: 'description', maxCount: 1 }  // Project description field
]);

/**
 * File filter for GPU server reconstruction callback files
 * Accepts OBJ/GLB mesh files and JSON metadata from GPU processing
 */
const objFileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  
  // Accept OBJ/GLB mesh files and JSON metadata from GPU server
  if (ext === '.obj' || ext === '.glb' || ext === '.json') {
    return cb(null, true);
  }
  
  // Reject unsupported file types
  logger.warn(`${serviceLocation}: Rejected file with extension ${ext}: ${file.originalname}`);
  const error = new multer.MulterError("LIMIT_UNEXPECTED_FILE", `Invalid file extension: ${ext}. Only .obj, .glb, and .json files allowed for GPU callbacks.`);
  return cb(error);
};

/**
 * Ensures temporary mesh directory exists for GPU callback file processing
 */
const ensureTempMeshDirExists = (): void => {
  const tempMeshDir = "src/temp_mesh/";
  if (!fs.existsSync(tempMeshDir)) {
    fs.mkdirSync(tempMeshDir, { recursive: true });
  }
};

// Initialize mesh directory
ensureTempMeshDirExists();

/**
 * Multer middleware for GPU server reconstruction callback files
 * Handles OBJ mesh files and JSON metadata with optimized storage configuration
 */
export const gpuObjUploadFilter = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      // Store GPU callback files in dedicated mesh directory
      cb(null, "src/temp_mesh/");
    },
    filename: (req, file, cb) => {
      // Generate unique filename with timestamp to prevent conflicts
      const timestamp = Date.now();
      const sanitizedBasename = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
      const sanitizedFilename = `gpu_callback_${timestamp}_${sanitizedBasename}`;
      cb(null, sanitizedFilename);
    },
  }),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB limit per individual file (increased from previous)
    files: 50, // Maximum 50 files per reconstruction (support multi-frame)
    parts: 100, // Maximum form parts
    fieldSize: 10 * 1024 * 1024 // 10MB for individual form fields
  },
  fileFilter: objFileFilter,
}).any(); // Accept files with any field name from multipart/form-data