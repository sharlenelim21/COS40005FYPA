// FIle: src/utils/upload_helper.ts
// Description: Helper functions for file upload processing including file format validation, hash generation, and storage mode checks.

import { FileDataType } from "../types/database_types";
import fs from "fs";
import crypto from "crypto";
// import * as nifti from 'nifti-reader-js'; 

/**
 * Validates the file format by checking if it ends with `.nii`, `.nii.gz`, or `.dcm`.
 * Supports uncompressed and gzipped NIfTI formats as well as DICOM format.
 *
 * @param filename - The name of the file to validate.
 * @returns True if the file format is valid, false otherwise.
 */
export function isValidFileFormat(filename: string): boolean {
  return (
    filename.endsWith(".nii") || 
    filename.endsWith(".nii.gz") || 
    filename.endsWith(".dcm")
  );
}


export async function computeFileHashStream(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Checks whether the current storage mode is set to local storage.
 *
 * @param storageMode - The configured storage mode (e.g., "local", "s3").
 * @returns True if the storage mode is "local", false otherwise.
 */
export function isLocalStorage(storageMode: string): boolean {
  return storageMode === "local";
}

/**
 * Checks whether the current storage mode is set to AWS S3.
 *
 * @param storageMode - The configured storage mode (e.g., "local", "s3").
 * @returns True if the storage mode is "s3", false otherwise.
 */
export function isS3Storage(storageMode: string): boolean {
  return storageMode === "s3";
}

/**
 * Maps a given string representing a NIfTI data type to the corresponding FileDataType enum.
 * Falls back to FileDataType.UNKNOWN if the type is unrecognized.
 *
 * @param datatype - The string representation of the NIfTI data type (e.g., "float32").
 * @returns The corresponding FileDataType enum value.
 */
export function mapToFileDataType(datatype: string): FileDataType {
  switch (datatype.toLowerCase()) {
    case "float32":
      return FileDataType.FLOAT32;
    case "uint16":
      return FileDataType.UINT16;
    case "uint8":
      return FileDataType.UINT8;
    case "int16":
      return FileDataType.INT16;
    case "int32":
      return FileDataType.INT32;
    case "uint32":
      return FileDataType.UINT32;  
    case "float64":
      return FileDataType.FLOAT64;  
    default:
      return FileDataType.UNKNOWN;
  }
}