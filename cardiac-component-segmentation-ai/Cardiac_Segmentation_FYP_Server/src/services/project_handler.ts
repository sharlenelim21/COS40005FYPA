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

const serviceLocation = "Project Handler";

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

  for (const file of files) {
    const { originalname, mimetype, size, path: filePath } = file;

    let newFilePath: string | undefined;
    let jpegOutputDir: string | undefined;
    let actualTarFilePath: string | undefined;
    let storedPath: string | undefined;

    // Should not fall here due to Multer
    try {
      if (!isValidFileFormat(originalname)) {
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

      let fileExtension = path.extname(originalname).toLowerCase();
      if (originalname.toLowerCase().endsWith(".nii.gz")) {
        fileExtension = ".nii.gz";
      }
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
      const pythonCommand = `python "${pythonScriptPath}" "${newFilePath}" "${jpegOutputDir}" "${(actualTarFilePath || "").replace('.tar', '')}" "${userId}" "${String(filehash)}"`;
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
        name: projectName || originalname,
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
        return res.status(500).json({
          success: false,
          error: result?.message || "An unknown error occurred.",
        });
      }

      uploadedProjects.push(project);
    } catch (error) {
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

  return res.status(200).json({
    message: "Projects uploaded and processed successfully.",
    projects: uploadedProjects.map(p => ({
      id: p.userid,
      name: p.name,
      originalfilename: p.originalfilename
    }))
  });
};

