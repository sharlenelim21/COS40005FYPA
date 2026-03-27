// File: src/services/s3_handler.ts
// Description: This module handles AWS S3 interactions, including uploading files, deleting objects, and extracting S3 keys from URLs.

import { S3Client, PutObjectCommand, PutObjectCommandInput, DeleteObjectCommand, GetObjectCommand, GetObjectCommandOutput, HeadObjectCommand } from "@aws-sdk/client-s3";
import { projectModel } from "../services/database";
import logger from "./logger"; // Import your logger
import fs from "fs";
import { Readable } from "stream";

const serviceLocation = "S3Handler";

// Setup AWS S3 v3 client if STORAGE_MODE is s3
let s3Client: S3Client | null = null;
if (process.env.STORAGE_MODE === "s3") {
  if (!process.env.AWS_REGION) {
    logger.error(`${serviceLocation}: AWS_REGION environment variable is not set. S3 client cannot be initialized.`);
    // You might want to throw an error here or handle this case appropriately
  } else {
    const s3Config: any = {
      region: process.env.AWS_REGION!,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    };

    // MinIO support: override endpoint for local development
    if (process.env.S3_ENDPOINT) {
      s3Config.endpoint = process.env.S3_ENDPOINT;
      s3Config.forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';
      logger.info(`${serviceLocation}: Using custom S3 endpoint: ${process.env.S3_ENDPOINT} (forcePathStyle: ${s3Config.forcePathStyle})`);
    }

    s3Client = new S3Client(s3Config);
    logger.info(`${serviceLocation}: S3Client initialized for region: ${process.env.AWS_REGION}`);

    // Check if S3 client is configured correctly - using an IIFE to allow await
    (async () => {
      try {
        const testKey = `_test/${Date.now()}.txt`;
        await s3Client!.send(new PutObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME!,
          Key: testKey,
          Body: 'test'
        }));

        // Delete the test object right away
        await s3Client!.send(new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME!,
          Key: testKey
        }));

        logger.info(`${serviceLocation}: S3 client connection verified with write test.`);
      } catch (error) {
        logger.error(`${serviceLocation}: Error verifying S3 client connection:`, error);
        s3Client = null;
      }
    })().catch(err => {
      // This catch handles any unhandled promise rejections from the IIFE itself
      logger.error(`${serviceLocation}: Unhandled error in S3 client verification:`, err);
    });
  }
}

// Add a function to delete an S3 object for cleanup
export const deleteFromS3 = async (objectKey: string): Promise<boolean> => {
  if (!s3Client || !process.env.AWS_BUCKET_NAME) {
    logger.error(`${serviceLocation}: Cannot delete from S3: Client or bucket not configured`);
    return false;
  }

  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: objectKey,
    }));
    logger.info(`${serviceLocation}: Successfully deleted ${objectKey} from S3 bucket ${process.env.AWS_BUCKET_NAME}`);
    return true;
  } catch (error) {
    logger.error(`${serviceLocation}: Error deleting ${objectKey} from S3:`, error);
    return false;
  }
};

// Extract S3 key from a full S3 URL
export const extractS3KeyFromUrl = (s3Url: string): string | null => {
  try {
    const url = new URL(s3Url);
    let key = url.pathname;
    if (key.startsWith('/')) {
      key = key.substring(1);
    }
    return key;
  } catch (error) {
    logger.error(`${serviceLocation}: Error extracting key from S3 URL: ${s3Url}`, error);
    return null;
  }
};

// Get file size from S3 using HeadObject
export const getS3FileSize = async (s3Url: string): Promise<number | null> => {
  if (!s3Client || !process.env.AWS_BUCKET_NAME) {
    logger.error(`${serviceLocation}: Cannot get file size from S3: Client or bucket not configured`);
    return null;
  }

  try {
    const s3Key = extractS3KeyFromUrl(s3Url);
    if (!s3Key) {
      logger.error(`${serviceLocation}: Failed to extract S3 key from URL: ${s3Url}`);
      return null;
    }

    const command = new HeadObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: s3Key,
    });

    const response = await s3Client.send(command);
    return response.ContentLength || null;
  } catch (error) {
    logger.error(`${serviceLocation}: Error getting file size for ${s3Url}:`, error);
    return null;
  }
};

// Modified Upload to S3 function to include a key prefix using AWS SDK v3
export const uploadToS3 = async (
  fileStream: fs.ReadStream,
  userId: string,
  fileHash: string,
  fileExtension: string,
  keyPrefix: string,
): Promise<string> => {
  if (!s3Client) {
    logger.error(`${serviceLocation}: AWS S3 client is not configured. Cannot upload to S3.`);
    throw new Error("AWS S3 client is not configured.");
  }
  if (!process.env.AWS_BUCKET_NAME) {
    logger.error(`${serviceLocation}: AWS_BUCKET_NAME environment variable is not set. Cannot upload to S3.`);
    throw new Error("AWS_BUCKET_NAME is not configured.");
  }

  const generatedFilename = `${keyPrefix}${userId}_${fileHash}${fileExtension}`;

  let contentType: string;
  switch (fileExtension.toLowerCase()) { // ensure consistent casing for extension check
    case '.nii':
      contentType = 'application/octet-stream';
      break;
    case '.nii.gz':
      contentType = 'application/x-gzip';
      break;
    case '.dcm':
      contentType = 'application/dicom';
      break;
    case '.tar':
      contentType = 'application/x-tar';
      break;
    default:
      contentType = 'application/octet-stream'; // Fallback to a generic type
      break;
  }

  const commandInput: PutObjectCommandInput = {
    Bucket: process.env.AWS_BUCKET_NAME!,
    Key: generatedFilename,
    Body: fileStream,
    ContentType: contentType,
  };

  const command = new PutObjectCommand(commandInput);

  try {
    await s3Client.send(command);
    logger.info(`${serviceLocation}: Successfully uploaded ${generatedFilename} to S3 bucket ${process.env.AWS_BUCKET_NAME}`);

    // Construct the S3 file location URL
    const region = process.env.AWS_REGION;
    const bucketName = process.env.AWS_BUCKET_NAME;

    // Handle potential regional differences in S3 URL format, especially for us-east-1
    let location;
    if (region === "us-east-1") {
      location = `https://${bucketName}.s3.amazonaws.com/${generatedFilename}`;
    } else {
      location = `https://${bucketName}.s3.${region}.amazonaws.com/${generatedFilename}`;
    }
    return location;
  } catch (error) {
    // Close the file stream in case of an error
    if (!fileStream.closed && !fileStream.destroyed) {
      fileStream.destroy();
    }

    logger.error(`${serviceLocation}: Error uploading to S3: ${generatedFilename}`, error);
    throw new Error(
      error instanceof Error
        ? `Error uploading to S3: ${error.message}`
        : "Error uploading to S3: Unknown error occurred"
    );
  }
};

export const cleanupUserS3Storage = async (userId: string): Promise<void> => {
  const serviceLocation = "S3Handler - Cleanup User S3 Storage";
  try {
    logger.info(`${serviceLocation}: Starting S3 cleanup for user ${userId}.`);

    // Step 1: Find only unsaved projects for the user
    const projects = await projectModel.find({ userid: userId, isSaved: false }).lean();
    if (!projects || projects.length === 0) {
      logger.info(`${serviceLocation}: No unsaved projects found for user ${userId}.`);
      return;
    }

    // Step 2: Collect all S3 keys from the projects
    const s3Keys: string[] = [];
    for (const project of projects) {
      if (project.originalfilepath) {
        const key = extractS3KeyFromUrl(project.originalfilepath);
        if (key) s3Keys.push(key);
      }
      if (project.extractedfolderpath) {
        const key = extractS3KeyFromUrl(project.extractedfolderpath);
        if (key) s3Keys.push(key);
      }
    }

    // Step 3: Delete all S3 files
    for (const key of s3Keys) {
      const success = await deleteFromS3(key);
      if (!success) {
        logger.warn(`${serviceLocation}: Failed to delete S3 file with key ${key}.`);
      }
    }

    logger.info(`${serviceLocation}: S3 cleanup completed for user ${userId}.`);
  } catch (error) {
    logger.error(`${serviceLocation}: Error during S3 cleanup for user ${userId}:`, error);
  }
};

/**
 * Uploads a segmentation mask (JSON string content) to S3.
 * @param bucketName The S3 bucket name.
 * @param key The full S3 object key (path and filename).
 * @param body The JSON string content to upload.
 * @param contentType The content type of the object (e.g., 'application/json').
 * @returns Promise<void>
 * @throws Error if the upload fails.
 */
export async function uploadSegMaskToS3(
  bucketName: string,
  key: string,
  fileBuffer: Buffer,
  contentType: string
): Promise<void> {
  const serviceLocation = "S3Handler_UploadImage";
  logger.info(`${serviceLocation}: Attempting to upload image to S3. Bucket: ${bucketName}, Key: ${key}`);

  if (!bucketName) {
    throw new Error("S3_BUCKET_NAME is not configured.");
  }

  const params: PutObjectCommandInput = {
    Bucket: bucketName,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
    // ACL: 'private', // Optional: Set ACL
  };

  try {
    const command = new PutObjectCommand(params);
    if (!s3Client) {
      throw new Error("AWS S3 client is not configured.");
    }
    await s3Client.send(command);
    logger.info(`${serviceLocation}: Successfully uploaded image to s3://${bucketName}/${key}`);
  } catch (error) {
    logger.error(`${serviceLocation}: Failed to upload image to S3. Bucket: ${bucketName}, Key: ${key}`, error);
    throw error;
  }
}

export const downloadFromS3 = async (bucketName: string, key: string, downloadPath: string): Promise<void> => {
  if (!s3Client) {
    logger.error(`${serviceLocation}: AWS S3 client is not configured. Cannot download from S3.`);
    throw new Error("AWS S3 client is not configured.");
  }
  const getObjectParams = {
    Bucket: bucketName,
    Key: key,
  };
  try {
    const command = new GetObjectCommand(getObjectParams);
    const data: GetObjectCommandOutput = await s3Client.send(command);

    if (data.Body instanceof Readable) {
      // Explicitly type bodyStream as Readable after the instanceof check.
      // This helps TypeScript understand it's a Node.js stream with pipe/on methods.
      const bodyStream: Readable = data.Body;
      const fileStream = fs.createWriteStream(downloadPath);

      await new Promise<void>((resolve, reject) => {
        // Handle errors from the S3 body stream
        bodyStream.on("error", (err) => {
          logger.error(`S3Handler: Error from S3 body stream for key ${key}:`, err);
          // Attempt to destroy the file stream to prevent leaks or partial files
          if (!fileStream.destroyed) {
            // Pass the error to destroy to signal the cause
            fileStream.destroy(err instanceof Error ? err : new Error(String(err)));
          }
          reject(err);
        });

        // Handle errors on the file write stream
        fileStream.on("error", (err) => {
          logger.error(`S3Handler: Error writing to file stream for ${downloadPath}:`, err);
          // The source stream (bodyStream) might still be flowing.
          // Node's pipe automatically handles unpiping on error/finish of the destination.
          reject(err);
        });

        fileStream.on("finish", () => {
          resolve();
        });

        bodyStream.pipe(fileStream);
      });
      logger.info(`S3Handler: File ${key} downloaded successfully to ${downloadPath}.`);
    } else if (data.Body) {
      // data.Body exists but is not a Node.js Readable stream
      // (e.g., it might be a ReadableStream or Blob in a browser-like environment, though unlikely here)
      const bodyType = Object.prototype.toString.call(data.Body);
      logger.error(`S3Handler: S3 object body for ${key} is not a Node.js Readable stream. Actual type/class: ${bodyType}`);
      throw new Error("S3 object body is not a Node.js Readable stream.");
    } else {
      throw new Error(`S3 object body is undefined for key ${key}.`);
    }
  } catch (error) {
    logger.error(`S3Handler: Error downloading file ${key} from S3: ${error}`);
    throw error;
  }
};
export const uploadMaskToS3 = async (
  fileStream: fs.ReadStream | Readable, // 1
  userId: string,                       // 2
  fileId: string,                       // 3
  fileExtension: string,                // 4
  s3KeyPrefix: string,                  // 5
  suggestedFilename?: string            // 6 (optional)
): Promise<string> => {
  if (!s3Client) {
    logger.error(`${serviceLocation}: AWS S3 client is not configured. Cannot upload mask to S3.`);
    throw new Error("AWS S3 client is not configured.");
  }
  const bucketName = process.env.AWS_BUCKET_NAME; // This comes from your .env file
  if (!bucketName) {
    throw new Error("AWS_BUCKET_NAME environment variable is not set.");
  }

  // Define the S3 key prefix internally
  const segMaskS3KeyPrefix = "seg_mask/";
  // If you wanted to include userId: const segMaskS3KeyPrefix = `seg_mask/${userId}/`;

  // Construct the full S3 key using the internal prefix
  const s3Key = `${segMaskS3KeyPrefix}${fileId}${fileExtension}`;

  const putObjectParams: PutObjectCommandInput = {
    Bucket: bucketName,
    Key: s3Key,
    Body: fileStream,
    ContentType: fileExtension === '.tar.gz' ? 'application/gzip'
      : (fileExtension === '.tar' ? 'application/x-tar'
        : (fileExtension === '.nii.gz' ? 'application/gzip'
          : 'application/octet-stream')),
  };

  if (suggestedFilename) {
    const encodedFilename = encodeURIComponent(suggestedFilename).replace(/'/g, "%27");
    putObjectParams.ContentDisposition = `attachment; filename*=UTF-8''${encodedFilename}`;
  }

  try {
    const command = new PutObjectCommand(putObjectParams);
    await s3Client.send(command);

    const region = process.env.AWS_REGION || 'ap-southeast-1'; // AWS_REGION from .env
    let fileUrl;
    if (region === "us-east-1") {
      fileUrl = `https://${bucketName}.s3.amazonaws.com/${s3Key}`;
    } else {
      fileUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${s3Key}`;
    }
    logger.info(`S3Handler: File uploaded successfully to S3: ${fileUrl}`);
    return fileUrl;
  } catch (error) {
    logger.error(`S3Handler: Error uploading file to S3 key ${s3Key}: ${error}`);
    if (fileStream instanceof Readable && !fileStream.destroyed) {
      fileStream.destroy();
    }
    throw error;
  }
};