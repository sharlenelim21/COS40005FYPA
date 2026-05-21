// File: src/services/project_handler.ts
// Description: Service layer for handling file upload logic including generating SHA-256 hashes,
// storing file metadata into the database, and preparing file details for response.

import { Request, Response } from "express";
import { uploadToS3 } from "../services/s3_handler";
import { createProject, readProject } from "../services/database";
import { IProject } from "../types/database_types";
import { extractNiftiMetadata } from "../utils/nifti_parser";
import {
  isValidFileFormat,
  computeFileHashStream,
  isS3Storage,
  mapToFileDataType,
} from "../utils/upload_validation";
import path from "path";
import { exec } from "child_process";
import logger from "./logger";
import LogError from "../utils/error_logger";
import fs from "fs";
import AdmZip from "adm-zip";

const serviceLocation = "Project Handler";
const maxFilesPerUpload = 10;

type UploadWorkFile = Express.Multer.File & {
  extractedFromZip?: string;
};

const getMedicalExtension = (filename: string): ".nii" | ".nii.gz" | ".dcm" | null => {
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith(".nii.gz")) return ".nii.gz";
  const ext = path.extname(lowerName);
  if (ext === ".nii" || ext === ".dcm") return ext;
  return null;
};

const isZipFile = (filename: string): boolean => filename.toLowerCase().endsWith(".zip");

const stripMedicalExtension = (filename: string): string => {
  const basename = path.basename(filename);
  if (basename.toLowerCase().endsWith(".nii.gz")) {
    return basename.slice(0, -7);
  }
  return basename.slice(0, basename.length - path.extname(basename).length);
};

const inferMimeType = (filename: string, fallback: string): string => {
  const ext = getMedicalExtension(filename);
  if (ext === ".nii.gz") return "application/x-gzip";
  if (ext === ".nii") return "application/octet-stream";
  if (ext === ".dcm") return "application/dicom";
  return fallback || "application/octet-stream";
};

const cleanupPath = (targetPath: string | undefined): void => {
  if (targetPath && fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
};

const cleanupPaths = (paths: string[]): void => {
  paths.forEach(cleanupPath);
};

const prepareUploadFiles = (files: Express.Multer.File[], userId: string): { workFiles: UploadWorkFile[]; cleanupDirs: string[] } => {
  const workFiles: UploadWorkFile[] = [];
  const cleanupDirs: string[] = [];

  for (const file of files) {
    if (!isZipFile(file.originalname)) {
      workFiles.push(file);
      continue;
    }

    const extractionDir = path.join(
      path.dirname(file.path),
      `zip_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    );
    fs.mkdirSync(extractionDir, { recursive: true });
    cleanupDirs.push(extractionDir);

    try {
      const zip = new AdmZip(file.path);
      const entries = zip.getEntries();
      let extractedCount = 0;

      for (const entry of entries) {
        if (entry.isDirectory) continue;

        const entryBaseName = path.basename(entry.entryName);
        if (!entryBaseName || entryBaseName.startsWith(".")) continue;
        if (!getMedicalExtension(entryBaseName)) continue;

        if (workFiles.length >= maxFilesPerUpload) {
          throw new Error(`ZIP upload contains more than ${maxFilesPerUpload} supported medical files.`);
        }

        const safeName = entryBaseName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const extractedPath = path.join(extractionDir, `${extractedCount + 1}-${safeName}`);
        const data = entry.getData();
        if (data.length === 0) continue;

        fs.writeFileSync(extractedPath, data);
        extractedCount += 1;

        workFiles.push({
          ...file,
          fieldname: "files",
          originalname: entryBaseName,
          encoding: file.encoding,
          mimetype: inferMimeType(entryBaseName, file.mimetype),
          destination: extractionDir,
          filename: path.basename(extractedPath),
          path: extractedPath,
          size: data.length,
          extractedFromZip: file.originalname,
        });
      }

      if (extractedCount === 0) {
        throw new Error("ZIP upload did not contain any supported .nii, .nii.gz, or .dcm files.");
      }
    } finally {
      cleanupPath(file.path);
    }
  }

  return { workFiles, cleanupDirs };
};

export const saveFileAndPushToS3 = async (req: Request, res: Response) => {
  // With fields configuration, files are now in req.files.files
  const files = req.files && 'files' in req.files ? req.files.files : [];
  const userId = (req.user as any)?._id;

  // Should not fall here due to Multer
  if (!files || files.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No files uploaded."
    });
  }

  // Should not fall here due to isAuth
  if (!userId) {
    return res.status(400).json({
      success: false,
      message: "Missing userId."
    });
  }


  // Get user-provided fields
  const projectName = req.body.name || '';
  const description = req.body.description || '';

  logger.info(`${serviceLocation}: Processing upload with name: "${projectName}", description: "${description.substring(0, 30)}${description.length > 30 ? '...' : ''}"`);

  const uploadedProjects: IProject[] = [];
  const storageMode = process.env.STORAGE_MODE || "local";
  let filesToProcess: UploadWorkFile[] = [];
  let extractionCleanupDirs: string[] = [];

  try {
    const prepared = prepareUploadFiles(files, String(userId));
    filesToProcess = prepared.workFiles;
    extractionCleanupDirs = prepared.cleanupDirs;
  } catch (error) {
    files.forEach((file) => cleanupPath(file.path));
    return res.status(400).json({
      success: false,
      message: (error as Error).message || "Could not extract ZIP upload.",
    });
  }

  for (const file of filesToProcess) {
    const { originalname, mimetype, size, path: filePath } = file;

    let newFilePath: string | undefined;
    let jpegOutputDir: string | undefined;
    let actualTarFilePath: string | undefined;
    let storedPath: string | undefined;

    // Should not fall here due to Multer
    try {
      if (!isValidFileFormat(originalname)) {
        cleanupPaths(extractionCleanupDirs);
        return res.status(400).json({
          success: false,
          error: "Invalid file format. Only .nii, .nii.gz, or .dcm allowed.",
        });
      }

      // Compute file hash early
      const filehash = await computeFileHashStream(filePath);

      // NEW: Check if a project with this file hash already exists for this user
      const existingProjectResult = await readProject(
        undefined,  // projectId - not searching by ID
        userId,     // userId - filter by current user
        undefined,  // name - not searching by name
        undefined,  // description - not searching by description
        undefined,  // isSaved - not filtering by saved status
        undefined,  // filename - not searching by filename
        undefined,  // filetype - not filtering by file type
        undefined,  // filesize - not filtering by file size
        filehash,    // filehash - filter by the computed hash
        undefined,  // datatype - not filtering by data type
        undefined,  // dimensions - not filtering by dimensions
        undefined,  // voxelSize - not filtering by voxel size
        undefined,  // creationDate - not filtering by creation date
      );

      // If a project with this file hash already exists for this user
      if (existingProjectResult.success && existingProjectResult.projects && existingProjectResult.projects.length > 0) {
        logger.warn(`${serviceLocation}: File with hash ${filehash} already exists for user ${userId}`);

        // Clean up the temporary file
        fs.unlinkSync(filePath);
        cleanupPaths(extractionCleanupDirs);

        return res.status(409).json({
          success: false,
          error: "A project with this file already exists.",
          existingProject: {
            id: existingProjectResult.projects[0]._id,
            name: existingProjectResult.projects[0].name
          }
        });
      }

      // Continue with file processing if no duplicate was found
      logger.info(`${serviceLocation}: No duplicate found for file hash ${filehash}. Proceeding with upload.`);

      const fileExtension = getMedicalExtension(originalname) ?? path.extname(originalname).toLowerCase();
      const newFileName = `${userId}_${filehash}${fileExtension}`;
      newFilePath = path.join(path.dirname(filePath), newFileName);
      fs.renameSync(filePath, newFilePath);

      const generatedFilename = `${userId}_${filehash}${fileExtension}`;

      let niftiMetadata: any = {};
      try {
        niftiMetadata = await extractNiftiMetadata(newFilePath);
      } catch (error: unknown) {
        LogError(error as Error, serviceLocation, "Error extracting NIfTI metadata.");
        niftiMetadata = {};
      }

      let niiFileS3Url = "";
      let tarFileS3Url = "";
      let s3KeyPrefix = "";

      if (isS3Storage(storageMode)) {
        s3KeyPrefix = `source_nifti/${userId}/`;
        // Upload only once
        niiFileS3Url = await uploadToS3(fs.createReadStream(newFilePath), userId, filehash, fileExtension, s3KeyPrefix);
        storedPath = `s3://${process.env.AWS_BUCKET_NAME}/${s3KeyPrefix}`;
      } else {
        storedPath = newFilePath;
        // For local storage, create a local URL or path format
        niiFileS3Url = `file://${newFilePath}`;
      }

      // Create a temporary directory for JPEG files
      jpegOutputDir = path.join(__dirname, '..', 'temp_jpeg', `${userId}_${filehash}`);
      fs.mkdirSync(jpegOutputDir, { recursive: true });

      // Construct the command to execute the Python script to convert to JPEGs
      const pythonScriptPath = path.join(__dirname, '..', 'python', 'convert_to_jpeg.py');
      const pythonCmd = process.env.PYTHON_CMD || "python3";
      const pythonCommand = `"${pythonCmd}" "${pythonScriptPath}" "${newFilePath}" "${jpegOutputDir}" "${(actualTarFilePath || "").replace('.tar', '')}" "${userId}" "${String(filehash)}"`;
      try {
        const { stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
          exec(pythonCommand, { maxBuffer: 1024 * 1024 * 10 }, async (error, stdout, stderr) => {
            if (error) {
              LogError(error as Error, serviceLocation, `Error extracting JPEG conversion script - ${stderr}.`);
              reject(new Error(`JPEG conversion failed: ${stderr}`));
              return;
            }
            logger.info(`${serviceLocation}: JPEG conversion script stdout:`, stdout);
            const tarPathMatch = stdout.match(/TAR_FILE_PATH:(.*)/);
            if (tarPathMatch && tarPathMatch[1]) {
              actualTarFilePath = tarPathMatch[1].trim();

              // Wait a bit for file to be fully written to prevent race condition
              await new Promise(resolve => setTimeout(resolve, 500));
            }
            resolve({ stdout, stderr });
          });
        });

        if (!actualTarFilePath || !fs.existsSync(actualTarFilePath)) {
          LogError(new Error("TAR file path not found or file does not exist"), serviceLocation, "TAR file path extraction failed.");
          tarFileS3Url = "";
        } else {
          // Verify file exists and has content before reading
          const stats = fs.statSync(actualTarFilePath);
          if (stats.size === 0) {
            LogError(new Error("TAR file is empty"), serviceLocation, "TAR file is empty.");
            tarFileS3Url = "";
          } else {
            const tarFile = fs.createReadStream(actualTarFilePath);
            tarFileS3Url = await uploadToS3(tarFile, userId, filehash, '.tar', s3KeyPrefix); // Upload TAR to the user's folder
          }
        }
      } catch (error: unknown) {
        LogError(error as Error, serviceLocation, "Error during JPEG conversion or archiving.");
        tarFileS3Url = "";
      } finally {
        // Clean up based on actual paths if needed
        if (jpegOutputDir && fs.existsSync(jpegOutputDir)) {
          fs.rmSync(jpegOutputDir, { recursive: true, force: true });
        }
        if (actualTarFilePath && fs.existsSync(actualTarFilePath)) {
          fs.rmSync(actualTarFilePath, { force: true });
        }
        if (newFilePath && fs.existsSync(newFilePath)) {
          fs.unlinkSync(newFilePath);
        }
      }

      const project: IProject = {
        userid: String(userId),
        name: filesToProcess.length === 1 && projectName ? projectName : stripMedicalExtension(originalname),
        originalfilename: originalname,
        description: description || "",
        isSaved: false,
        filename: generatedFilename,
        filetype: mimetype as any,
        filesize: size,
        filehash: filehash,
        basepath: storedPath!,
        originalfilepath: niiFileS3Url,
        extractedfolderpath: tarFileS3Url,
        datatype: mapToFileDataType(niftiMetadata.datatype),
        dimensions: {
          width: niftiMetadata.dimensions.width ?? 0,
          height: niftiMetadata.dimensions.height ?? 0,
          slices: niftiMetadata.dimensions.slices ?? 0,
          frames: niftiMetadata.dimensions.frames ?? 0,
        },
        voxelsize: {
          x: niftiMetadata.voxelsize.x ?? 1.0,  // Default to 1.0mm if not provided (required field)
          y: niftiMetadata.voxelsize.y ?? 1.0,  // Default to 1.0mm if not provided (required field)
          ...(niftiMetadata.voxelsize.z && niftiMetadata.voxelsize.z > 0 ? { z: niftiMetadata.voxelsize.z } : {}),
          ...(niftiMetadata.voxelsize.t && niftiMetadata.voxelsize.t > 0 ? { t: niftiMetadata.voxelsize.t } : {}),
        },
        affineMatrix: niftiMetadata.affineMatrix && niftiMetadata.affineMatrix.length > 0 ? niftiMetadata.affineMatrix : undefined,
      };

      const result = await createProject(
        project.userid,
        project.name,
        project.originalfilename,
        project.description,
        project.isSaved,
        project.filename,
        project.filetype,
        project.filesize,
        project.filehash,
        project.basepath,
        project.originalfilepath,
        project.extractedfolderpath,
        project.datatype,
        project.dimensions,
        project.voxelsize,
        project.affineMatrix,
      );

      if (!result.success) {
        cleanupPaths(extractionCleanupDirs);
        return res.status(500).json({
          success: false,
          error: result?.message || "An unknown error occurred.",
        });
      }

      uploadedProjects.push({
        ...project,
        _id: (result as any).project?._id,
      } as any);
    } catch (error) {
      cleanupPaths(extractionCleanupDirs);
      return res.status(500).json({ message: "Processing failed.", error: (error as Error).message });
    } finally {
      // Ensure cleanup happens even if there's an error
      if (jpegOutputDir && fs.existsSync(jpegOutputDir)) {
        fs.rmSync(jpegOutputDir, { recursive: true, force: true });
      }
      if (actualTarFilePath && fs.existsSync(actualTarFilePath)) {
        fs.rmSync(actualTarFilePath, { force: true });
      }
      if (newFilePath && fs.existsSync(newFilePath)) {
        fs.unlinkSync(newFilePath);
      }
    }
  }

  cleanupPaths(extractionCleanupDirs);

  return res.status(200).json({
    message: "Projects uploaded and processed successfully.",
    projects: uploadedProjects.map(p => ({
      id: String((p as any)._id || ""),
      projectId: String((p as any)._id || ""),
      name: p.name,
      originalfilename: p.originalfilename
    }))
  });
};

