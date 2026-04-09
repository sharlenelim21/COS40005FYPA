import { Document } from "mongoose";

/* Interfaces */
// Enumeration for user roles
/**
 * Defines the possible roles a user can have within the application.
 * @enum {string}
 * @property {string} User - Represents a standard user with basic permissions.
 * @property {string} Admin - Represents an administrator with elevated privileges.
 */
export enum UserRole {
  User = "user",
  Admin = "admin",
  Guest = "guest", // For temporary users
}

/**
 * Defines the structure for a user object as stored in the database, including sensitive information.
 * @interface IUser
 * @property {string} username - The unique username for the user.
 * @property {string} password - The user's hashed password.
 * @property {string} email - The user's unique email address.
 * @property {string} phone - The user's unique phone number.
 * @property {UserRole} role - The role assigned to the user (e.g., User, Admin).
 */
export interface IUser {
  username: string;
  password: string;
  email: string;
  phone: string;
  role: UserRole; // Default to "user" unless specified otherwise
}

/**
 * Defines the structure for a user object that is safe to expose publicly or send to clients.
 * It omits sensitive information like the password hash.
 * @interface IUserSafe
 * @property {string} _id - The unique MongoDB document ID for the user, represented as a string.
 * @property {string} username - The unique username of the user.
 * @property {string} email - The email address of the user.
 * @property {string} phone - The phone number of the user.
 * @property {UserRole} role - The role of the user (e.g., User, Admin).
 * @property {Date} [createdAt] - The date when the user was created (optional).
 * @property {Date} [updatedAt] - The date when the user was last updated (optional).
 */
export interface IUserSafe {
  _id: string; // MongoDB Object ID of the user
  username: string;
  email: string;
  phone: string;
  role: UserRole; // Default to "user" unless specified otherwise
  createdAt?: Date; // Creation date of the user
  updatedAt?: Date; // Last update date of the user
}
// User Model Interface (single user document in the database)
export interface IUserDocument extends IUser, Document {
  createdAt: Date; // Creation date of the user, commented out if extended with mongoose.Document
  updatedAt: Date; // Last update date of the user, commented out if extended with mongoose.Document
}

/*==================================== Project Section begins here =============================================*/
// Enumeration for file types
/**
 * Defines the possible file types for uploaded files.
 * This is used to specify the MIME type of the file.
 * @enum {string}
 * @property {string} NIFTI - Represents a NIfTI file (.nii).
 * @property {string} NIFTI_GZ - Represents a compressed NIfTI file (.nii.gz).
 * @property {string} DICOM - Represents a DICOM file (.dcm).
 * @property {string} NIFTI_CUSTOM - Represents a non-standard, custom MIME type for NIfTI files (.nii).
 * @property {string} NIFTI_GZ_CUSTOM - Represents a non-standard, custom MIME type for compressed NIfTI files (.nii.gz).
 */
export enum FileType {
  NIFTI = "application/octet-stream", // .nii (standard MIME for NIfTI files)
  NIFTI_GZ = "application/gzip", // .nii.gz (standard MIME for gzip-compressed NIfTI files)
  NIFTI_GZ_2 = "application/x-gzip", // .nii.gz alternate variant
  DICOM = "application/dicom", // .dcm (standard MIME for DICOM files)
}

// Enumeration for DataType
/**
 * Defines the possible data types for images.
 * This is used to specify the data type of the image in the project.
 * @enum {string}
 * @property {string} UNKNOWN - Represents an unknown data type.
 * @property {string} FLOAT32 - Represents a 32-bit floating-point number.
 * @property {string} UINT16 - Represents a 16-bit unsigned integer.
 * @property {string} UINT8 - Represents an 8-bit unsigned integer.
 * @property {string} INT16 - Represents a 16-bit signed integer.
 * @property {string} INT32 - Represents a 32-bit signed integer.
 * @property {string} UINT32 - Represents a 32-bit unsigned integer.
 * @property {string} FLOAT64 - Represents a 64-bit floating-point number.
 */
export enum FileDataType {
  UNKNOWN = "unknown", // Used when the data type is not determined.
  FLOAT32 = "float32", // Common for continuous-valued data (e.g., images, scans).
  UINT16 = "uint16", // Common for medical images (e.g., grayscale).
  UINT8 = "uint8", // Common for segmentation masks (often used for binary masks).
  INT16 = "int16", // Common for signed integer data types.
  INT32 = "int32", // Used in some medical imaging formats.
  UINT32 = "uint32", // Used in certain specialized data formats.
  FLOAT64 = "float64", // Less common, but used for high-precision floating point.
}

/**
 * Defines the structure for a project record stored in the database.
 * This interface is used to represent a project that contains files and their metadata.
 * @interface IProject
 * @property {string} userid - The unique MongoDB user ID of the user who uploaded the file.
 * @property {string} name - The name of the project.
 * @property {string} originalfilename - The original filename of the uploaded file.
 * @property {string} description - A description of the project (optional).
 * @property {boolean} isSaved - Indicates if the project should be saved.
 * @property {string} filename - The server-renamed filename of the uploaded file, using a format of userid_filehash.nii preferably.
 * @property {FileType} filetype - The MIME type of the file (e.g., image/nifti, application/dicom).
 * @property {number} filesize - The size of the renamed file in bytes.
 * @property {string} filehash - The SHA256 hash of the renamed file.
 * @property {string} basepath - The base path for the file storage (e.g., s3://devel-visheart-s3-bucket/temp/"the-user-id"/"the-user-id"_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3).
 * @property {string} originalfilepath - The original file location (e.g., s3://devel-visheart-s3-bucket/temp/"the-user-id"/"the-user-id"_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3/"the-user-id"_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3.nii.gz).
 * @property {string} extractedfolderpath - The folder where all the extracted JPEGs from NIfTI are saved. (e.g. s3://devel-visheart-s3-bucket/temp/${testUser._id}/${String(testUser._id)}_2630fcede25328c13a15c4dfe6376c068201eb1f8d871736cd8197c2b1463ed3/extracted)
 * @property {string} datatype - The data type of the image (e.g., uint8, float32).
 * @property {object} dimensions - The dimensions of the image.
 * @property {number} dimensions.width - The width of the image in pixels.
 * @property {number} dimensions.height - The height of the image in pixels.
 * @property {number} dimensions.slices - The depth/slices of the image in pixels (for 3D images).
 * @property {number} dimensions.frames - The time/frames dimension (optional, for 4D images).
 * @property {object} voxelsize - The physical size of one voxel, usually in mm.
 * @property {number} voxelsize.x - The size in the x-dimension.
 * @property {number} voxelsize.y - The size in the y-dimension.
 * @property {number} voxelsize.z - The size in the z-dimension (optional).
 * @property {number} voxelsize.t - The size in the t-dimension (optional).
 * @property {number[][]} [affineMatrix] - The 4x4 affine transformation matrix from the NIfTI header (optional, added for export functionality).
 */
export interface IProject {
  // Identifiers
  // _id:  string; // MongoDB Object ID of the project, commented out if extended with mongoose.Document
  userid: string; // MongoDB User ID of the user who uploaded the file
  // User inputs
  name: string; // Name of the project
  originalfilename: string;
  description: string;
  isSaved: boolean; // Indicates if the project is saved in the database
  // File properties
  filename: string; // Server rename - e.g., userid_projid.nii - use new mongoose.Types.ObjectId() to pregenerate before creating document in DB
  filetype: FileType; // MIME type of the file
  filesize: number; // Size of the renamed file in bytes
  filehash: string; // SHA256 hash of the renamed file
  // Location tracking
  basepath: string; // Base path for the file storage (e.g., S3 bucket URL + user + filehash)
  originalfilepath: string; // Original (nifti/dicom) file location (e.g., S3 bucket URL)
  extractedfolderpath: string; // Saves the folder where all the extracted jpeg from nifti are saved. Use naming convention for each extracted jpeg as filename_slice_frame.jpeg
  // File specifics
  datatype: FileDataType; // Data type of the image (e.g., uint8, float32)
  dimensions: {
    width: number; // Width of the image in pixels
    height: number; // Height of the image in pixels
    slices: number; // Depth/Slices of the image in pixels (for 3D images)
    frames?: number; // Time/Frames dimension (optional, for 4D images)
  };

  /** Physical size of one voxel (usually in mm).
   * From NIfTI pixdim = [?, 0.5, 0.5, 1.0, 2.0, 0, 0, 0], first ? and last 3 zeroes are not used,
   * but the 4 numbers are in mm, mm, mm and seconds. */
  voxelsize?: { x: number; y: number; z?: number; t?: number };

  /** 4x4 affine transformation matrix from NIfTI header.
   * This matrix defines the spatial relationship between voxel coordinates and world coordinates.
   * Added for export functionality to avoid re-downloading files. */
  affineMatrix?: number[][];

  // Based on mongoose timestamp
  createdAt?: Date; // Creation date of the project
  updatedAt?: Date; // Last update date of the project
}
// Project Model Interface (single project document in the database)
export interface IProjectDocument extends IProject, Document {}

// Enumeration for component bounding box classes
/**
 * Defines the possible classes for component bounding boxes in segmentation masks.
 * @enum {string}
 * @property {string} rv - Represents the right ventricle.
 * @property {string} myo - Represents the myocardium.
 * @property {string} lvc - Represents the left ventricle cavity.
 * @property {string} MANUAL - Represents a manually generated segmentation class.
 */
export enum ComponentBoundingBoxesClass {
  RV = "rv",
  MYO = "myo",
  LVC = "lvc",
  MANUAL = "manual", // Added for manual segmentations from GPU
}

/**
 * Defines the structure for a project's segmentation masks.
 * This is a child of IProject and references back to the project it belongs to.
 * Stores the segmentation masks for a project as well as the component bounding boxes used to input into MedSAM for segmentation.
 * This interface is used to store the segmentation masks for a project.
 * @interface IProjectSegmentationMask
 * @property {string} projectid - The unique MongoDB project ID of the project to which the segmentation mask belongs.
 * @property {string} name - The name of the segmentation mask.
 * @property {string} description - A description of the segmentation mask (optional).
 * @property {boolean} isSaved - Indicates if the segmentation mask should be saved.
 * @property {boolean} segmentationmaskRLE - Indicates if the mask is in RLE format (optional).
 * @property {boolean} isMedSAMOutput - Indicates if the segmentation mask is a MedSAM output (should not delete if its the output of MedSAM).
 * @property {object[]} frames - An array of frame objects, each containing slice information.
 * @property {boolean} frames.frameinferred - Indicates if the frame has been inferred (user must manually run MedSAM on it)
 * @property {number} frames.frameindex - The index of the frame (0-based).
 * @property {object[]} frames.slices - An array of slice objects, each containing segmentation mask information.
 * @property {number} frames.slices.sliceindex - The index of the slice (0-based).
 * @property {object[]} frames.slices.componentboundingboxes - An array of component bounding box objects (optional).
 * @property {string} frames.slices.componentboundingboxes.class - The class of the component for the slices (e.g., rv, myo, lvc).
 * @property {number} frames.slices.componentboundingboxes.x_min - The X coordinate of the minimum bounding box corner.
 * @property {number} frames.slices.componentboundingboxes.y_min - The Y coordinate of the minimum bounding box corner.
 * @property {number} frames.slices.componentboundingboxes.x_max - The X coordinate of the maximum bounding box corner.
 * @property {number} frames.slices.componentboundingboxes.y_max - The Y coordinate of the maximum bounding box corner.
 * @property {object[]} frames.slices.segmentationmasks - An array of segmentation mask objects (optional).
 * @property {string} frames.slices.segmentationmasks.class - The class of the component for the masks and should tally with bboxes (e.g., rv, myo, lvc).
 * @property {string} frames.slices.segmentationmasks.segmentationmaskcontents - The contents of the segmentation mask (e.g., RLE format).
 */
export interface IProjectSegmentationMask {
  // Identifiers
  _id?: any; // Allow _id to be compatible with the transformed object for new segmentations
  projectid: string; // MongoDB Project ID of the project to which the segmentation mask belongs
  // User inputs
  name: string; // Name of the segmentation mask
  description?: string; // Description of the segmentation mask
  model?: string; // Segmentation model used (e.g., 'existing_model', 'model_2')
  isSaved: boolean; // Indicates if the segmentation mask is saved in the database
  segmentationmaskRLE: boolean; // Indicates if the mask is in RLE format
  isMedSAMOutput: boolean; // Indicates if the segmentation mask is a MedSAM output (should not delete if its the output of MedSAM)
  // Properties of the bounding box coordinates used to input into MedSAM for segmentation
  // If the segmentation mask is a single frame, there will be only one entry in the frames array
  frames: {
    frameindex: number; // The index of the frame (0-based)
    // Since GPU limitaion, predict on only one frame at a time, this is a record
    frameinferred: boolean; // Indicates if the frame has been inferred
    slices: {
      sliceindex: number; // The index of the slice (0-based)
      componentboundingboxes?: {
        class: ComponentBoundingBoxesClass; // Class of the component (e.g., rv, myo, lvc)
        confidence: number; // Confidence score of the bounding box
        x_min: number; // X coordinate of the minimum bounding box corner
        y_min: number; // Y coordinate of the minimum bounding box corner
        x_max: number; // X coordinate of the maximum bounding box corner
        y_max: number; // Y coordinate of the maximum bounding box corner
      }[];
      segmentationmasks?: {
        class: ComponentBoundingBoxesClass; // Class of the component (e.g., rv, myo, lvc)
        segmentationmaskcontents: string;
      }[];
    }[];
  }[];
}
// Segmentation Mask Model Interface (single segmentation mask document in the database)
export interface IProjectSegmentationMaskDocument
  extends IProjectSegmentationMask,
    Document {
  _id: any; // Ensure _id is part of the document type
}

// Enumeration for 3D reconstruction source methods
/**
 * Defines the possible sources for 3D reconstruction generation.
 * @enum {string}
// Enumeration for 4D Mesh Formats
/**
 * Defines the possible 3D mesh file formats for cardiac reconstruction outputs.
 * @enum {string}
 * @property {string} OBJ - Wavefront OBJ format - text-based, widely supported
 * @property {string} PLY - Stanford PLY format - supports both ASCII and binary
 * @property {string} GLB - Binary glTF format - optimized for web rendering
 * @property {string} GLTF - Text-based glTF format - JSON with embedded or external resources
 * @property {string} STL - STereoLithography format - common for 3D printing
 */
export enum MeshFormat {
  NPZ = "npz",   // .npz - NumPy archive format (default AI SDF output)
  OBJ = "obj",   // .obj - Wavefront OBJ, text-based, widely supported
  PLY = "ply",   // .ply - Stanford PLY, supports color and normals
  GLB = "glb",   // .glb - Binary glTF, optimized for web/AR/VR
  GLTF = "gltf", // .gltf - Text glTF, JSON format with external assets
  STL = "stl",   // .stl - STereoLithography, common for 3D printing
}

/**
 * Defines the structure for a project's 4D reconstruction results.
 * This is a simplified interface for AI SDF-based cardiac reconstruction.
 * Stores a single mesh file generated from segmentation masks via GPU server.
 * @interface IProjectReconstruction
 * @property {string} projectid - The unique MongoDB project ID of the project to which the 4D reconstruction belongs.
 * @property {string} [maskId] - The MongoDB SegmentationMask ID that this reconstruction was generated from (optional for GPU-generated reconstructions).
 * @property {string} name - The name of the 4D reconstruction.
 * @property {string} [description] - A description of the 4D reconstruction (optional).
 * @property {number} ed_frame - The end-diastole frame number for reconstruction (default: 1).
 * @property {boolean} isSaved - Indicates if the 4D reconstruction should be saved.
 * @property {boolean} isAIGenerated - Indicates if the reconstruction is AI-generated (should not delete if it's AI output).
 * @property {MeshFormat} meshFormat - The format of the 4D mesh file (npz, obj, glb, etc.).
 * @property {string} filename - Server-generated reconstruction filename (e.g., projectid_reconstructionid_4d).
 * @property {number} filesize - Size of the reconstruction file in bytes.
 * @property {string} filehash - SHA256 hash of the reconstruction file for integrity.
 * @property {string} basepath - Base path for reconstruction storage (e.g., s3://bucket/reconstructions/projectid/reconstructionid).
 * @property {string} reconstructionfolderpath - Folder where the reconstruction file is stored (e.g., basepath/).
 * @property {object} reconstructedMesh - Information about the 4D reconstruction mesh file.
 * @property {string} reconstructedMesh.path - S3 path to the mesh file.
 * @property {string} reconstructedMesh.filename - Mesh filename (e.g., projectid_reconstructionid_4d.npz).
 * @property {number} reconstructedMesh.filesize - Size of mesh file in bytes.
 * @property {string} reconstructedMesh.hash - SHA256 hash of mesh file.
 * @property {string} reconstructedMesh.format - Mesh file format (npz, obj, glb).
 * @property {string} [reconstructedMesh.meshData] - Base64 encoded mesh data from GPU callback (optional).
 * @property {number} [reconstructedMesh.reconstructionTime] - Time taken for reconstruction in seconds (optional).
 * @property {number} [reconstructedMesh.numIterations] - Number of iterations used in SDF reconstruction (optional).
 * @property {number} [reconstructedMesh.resolution] - Resolution of the reconstruction grid (optional).
 * @property {Date} [createdAt] - Timestamp when the reconstruction record was created (automatically managed by Mongoose).
 * @property {Date} [updatedAt] - Timestamp when the reconstruction record was last updated (automatically managed by Mongoose).
 */
export interface IProjectReconstruction {
  // Identifiers
  _id?: any; // Allow _id to be compatible with the transformed object for new reconstructions
  projectid: string; // MongoDB Project ID of the project to which the 4D reconstruction belongs
  maskId?: string; // MongoDB SegmentationMask ID that this reconstruction was generated from (optional for GPU-generated reconstructions)
  
  // User inputs
  name: string; // Name of the 4D reconstruction
  description?: string; // Description of the 4D reconstruction
  ed_frame: number; // End-diastole frame number for reconstruction (default: 1)
  isSaved: boolean; // Indicates if the 4D reconstruction is saved in the database
  isAIGenerated: boolean; // Indicates if the reconstruction is AI-generated (should not delete if it's AI output)
  meshFormat: MeshFormat; // Format of the 4D mesh file
  
  // File properties 
  filename: string; // Server-generated reconstruction filename (e.g., projectid_reconstructionid_4d)
  filesize: number; // Size of the reconstruction file in bytes
  filehash: string; // SHA256 hash of the reconstruction file for integrity
  
  // Location tracking
  basepath: string; // Base path for reconstruction storage (e.g., s3://bucket/reconstructions/projectid/reconstructionid)
  reconstructionfolderpath: string; // Folder where the reconstruction file is stored (e.g., basepath/)
  
  // 4D Reconstruction Mesh - single mesh file from AI SDF model
  reconstructedMesh: {
    path: string; // S3 path to the mesh file
    filename: string; // Mesh filename (e.g., projectid_reconstructionid_4d.npz)
    filesize: number; // Size of mesh file in bytes
    hash: string; // SHA256 hash of mesh file
    format: string; // Mesh file format (npz, obj, glb)
    meshData?: string; // Base64 encoded mesh data from GPU callback (optional)
    reconstructionTime?: number; // Time taken for reconstruction in seconds (optional)
    numIterations?: number; // Number of iterations used in SDF reconstruction (optional)
    resolution?: number; // Resolution of the reconstruction grid (optional)
  };
  
  // Based on mongoose timestamp
  createdAt?: Date; // Creation timestamp
  updatedAt?: Date; // Last update timestamp
}

// 3D Reconstruction Model Interface (single reconstruction document in the database)
export interface IProjectReconstructionDocument
  extends IProjectReconstruction,
    Document {
  _id: any; // Ensure _id is part of the document type
}

/*==================================== Project Section ends here =============================================*/
/*==================================== Job Queue Section starts here =========================================*/
// Enumeration for job statuses
export enum JobStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  FAILED = "failed",
}

export enum segmentationSource {
  AI_INFERENCE = "ai_inference", // Segmentation generated by AI inference
  MANUAL_INFERENCE = "manual_inference", // Segmentation generated by manual inference
}

export interface IJob {
  userid: string; // ID of the user who created the job
  projectid: string; // ID of the project associated with the job
  uuid: string; // UUID of the job (for tracking purposes)
  status: JobStatus; // Current status of the job (e.g., pending, in_progress, completed, failed)
  result?: string; // Result of the job (e.g., path to the output file, success message, etc.)
  message?: string; // Optional error message if the job fails
  segmentationName?: string; // Optional user-defined name for the resulting segmentation
  segmentationDescription?: string; // Optional user-defined description for the resulting segmentation
  segmentationSource?: segmentationSource; // Source of the image for segmentation
}
export interface IJobDocument extends IJob, Document {}

/*==================================== Job Queue Section ends here ===========================================*/
/* Database Functions */
/**
 * Enumerates the types of CRUD (Create, Read, Update, Delete) operations,
 * plus an 'AUTHENTICATE' operation specific to user login.
 * Used in the result objects of database functions to indicate the action performed.
 * @enum {string}
 * General CRUD operations:
 * @property {string} CREATE - Represents a create operation.
 * @property {string} READ - Represents a read operation.
 * @property {string} UPDATE - Represents an update operation.
 * @property {string} DELETE - Represents a delete operation.
 * Auxiliary operations:
 * User:
 * @property {string} AUTHENTICATE - Represents an authentication operation. Specifically for PassportJS integration.
 * Project:
 */
export enum CRUDOperation {
  CREATE = "create",
  READ = "read",
  UPDATE = "update",
  DELETE = "delete",
  /**
   * AUTHENTICATE is used for user authentication operations and is not a standard CRUD operation,
   * but it is included here for consistency in reporting operation types, especially for PassportJS integration.
   */
  AUTHENTICATE = "authenticate",
  // Project specific operations

  // // Project Segmentation Mask specific operations
  // UPDATE_SINGLE_SLICE = "update_single_slice", // Update a single slice in the segmentation mask
  // UPDATE_SINGLE_FRAME = "update_single_frame", // Update a single frame in the segmentation mask
}
// Define result type for user CRUD operations
/**
 * Defines the standard structure for the result object returned by user-related database operations
 * (create, read, update, delete, authenticate).
 * @interface UserCrudResult
 * @property {boolean} success - Indicates whether the operation completed successfully.
 * @property {CRUDOperation} operation - The type of operation that was performed (e.g., CREATE, READ).
 * @property {IUserSafe} [user] - The resulting user object (sanitized), typically included on successful CREATE, UPDATE, or AUTHENTICATE operations.
 * @property {IUserSafe[]} [users] - An array of user objects (sanitized), typically included on successful READ operations. Can be empty if no users match the criteria.
 * @property {string} [message] - An optional message providing more details, especially in case of failure (e.g., validation error, user not found) or warnings.
 */
export interface UserCrudResult {
  success: boolean; // Indicates whether the operation was successful
  operation: CRUDOperation; // The type of operation performed (CREATE, READ, UPDATE, DELETE)
  user?: IUserSafe; // The created or updated user document (applicable for CREATE and UPDATE operations)
  users?: IUserSafe[]; // Array of user documents (applicable for READ operation)
  message?: string; // Message if error/warning occurred (applicable for all operations)
}

// Define result type for project CRUD operations
/**
 * Defines the standard structure for the result object returned by project-related database operations
 * (create, read, update, delete).
 * @interface ProjectCrudResult
 * @property {boolean} success - Indicates whether the operation completed successfully.
 * @property {CRUDOperation} operation - The type of operation that was performed (e.g., CREATE, READ).
 * @property {IProjectDocument} [project] - The resulting project object, typically included on successful CREATE or UPDATE operations.
 * @property {IProjectDocument[]} [projects] - An array of project objects, typically included on successful READ operations. Can be empty if no projects match the criteria.
 * @property {string} [message] - An optional message providing more details, especially in case of failure (e.g., validation error, project not found) or warnings.
 */
export interface ProjectCrudResult {
  success: boolean; // Indicates whether the operation was successful
  operation: CRUDOperation; // The type of operation performed (CREATE, READ, UPDATE, DELETE)
  project?: IProjectDocument; // The created or updated project document (applicable for CREATE and UPDATE operations)
  projects?: IProjectDocument[]; // Array of project documents (applicable for READ operation)
  message?: string; // Message if error/warning occurred (applicable for all operations)
}

/**
 * Defines the standard structure for the result object returned by project segmentation mask-related database operations
 * (create, read, update, delete).
 * @interface ProjectSegmentationMaskCrudResult
 * @property {boolean} success - Indicates whether the operation completed successfully.
 * @property {CRUDOperation} operation - The type of operation that was performed (e.g., CREATE, READ).
 * @property {IProjectSegmentationMaskDocument} [projectsegmentationmask] - The resulting segmentation mask object, typically included on successful CREATE or UPDATE operations.
 * @property {IProjectSegmentationMaskDocument[]} [projectsegmentationmasks] - An array of segmentation mask objects, typically included on successful READ operations. Can be empty if no segmentation masks match the criteria.
 * @property {string} [message] - An optional message providing more details, especially in case of failure (e.g., validation error, segmentation mask not found) or warnings.
 */
export interface ProjectSegmentationMaskCrudResult {
  success: boolean; // Indicates whether the operation was successful
  operation: CRUDOperation; // The type of operation performed (CREATE, READ, UPDATE, DELETE)
  projectsegmentationmask?: IProjectSegmentationMaskDocument; // The created or updated segmentation mask document (applicable for CREATE and UPDATE operations)
  projectsegmentationmasks?: IProjectSegmentationMaskDocument[]; // Array of segmentation mask documents (applicable for READ operation)
  message?: string; // Message if error/warning occurred (applicable for all operations)
}

// Define result type for project 3D reconstruction CRUD operations
/**
 * Defines the standard structure for the result object returned by project 3D reconstruction-related database operations
 * (create, read, update, delete).
 * @interface ProjectReconstructionCrudResult
 * @property {boolean} success - Indicates whether the operation completed successfully.
 * @property {CRUDOperation} operation - The type of operation that was performed (e.g., CREATE, READ).
 * @property {IProjectReconstructionDocument} [projectreconstruction] - The resulting 3D reconstruction object, typically included on successful CREATE or UPDATE operations.
 * @property {IProjectReconstructionDocument[]} [projectreconstructions] - An array of 3D reconstruction objects, typically included on successful READ operations. Can be empty if no reconstructions match the criteria.
 * @property {string} [message] - An optional message providing more details, especially in case of failure (e.g., validation error, reconstruction not found) or warnings.
 */
export interface ProjectReconstructionCrudResult {
  success: boolean; // Indicates whether the operation was successful
  operation: CRUDOperation; // The type of operation performed (CREATE, READ, UPDATE, DELETE)
  projectreconstruction?: IProjectReconstructionDocument; // The created or updated 3D reconstruction document (applicable for CREATE and UPDATE operations)
  projectreconstructions?: IProjectReconstructionDocument[]; // Array of 3D reconstruction documents (applicable for READ operation)
  message?: string; // Message if error/warning occurred (applicable for all operations)
}

// Define result type for job CRUD operations
export interface JobCrudResult {
  success: boolean; // Indicates whether the operation was successful
  operation: CRUDOperation; // The type of operation performed (CREATE, READ, UPDATE, DELETE)
  job?: IJobDocument; // The created or updated job document (applicable for CREATE and UPDATE operations)
  jobs?: IJobDocument[]; // Array of job documents (applicable for READ operation)
  message?: string; // Message if error/warning occurred (applicable for all operations)
}


/*===================================== Administrative Tool Section begins here =============================================*/
/*===================================== GPU Section begins here =============================================*/

/**
 * Represents a GPU host configuration for connecting to a remote GPU server.
 *
 * @interface IGPUHost
 * @property {string} host - The hostname or IP address of the GPU server.
 * @property {number} port - The port number on which the GPU server is running.
 * @property {boolean} [isHTTPS] - Optional flag to indicate if the connection should use HTTPS (default is false).
 * @property {string} description - A description of the GPU host configuration.
 * @property {string} changedBy - The user id of the person who last changed the GPU host configuration.
 */
export interface IGPUHost {
  host: string; // The hostname or IP address of the GPU server
  port: number; // The port number on which the GPU server is running
  isHTTPS?: boolean; // Optional flag to indicate if the connection should use HTTPS (default is false)
  gpuServerAuthJwtSecret: string; // JWT secret for authenticating with the GPU server
  serverIdForGpuServer: string; // The identifier for this Node.js server instance/service. Used as the 'subject' (`sub`) and 'issuer' (`iss`) claims within the generated JWT to identify who the token represents and who issued it.
  gpuServerIdentity: string; // The identifier representing the intended recipient (audience) of the generated JWTs, which is the GPU/FastAPI server itself. Used in the 'audience' (`aud`) claim.
  jwtRefreshInterval: number; // The interval in milliseconds at which the JWT should be refreshed
  jwtLifetimeSeconds: number; // The lifetime of the JWT in seconds
  description?: string; // A description of the GPU host configuration
  setBy: string; // The user id of the person who last changed the GPU host configuration
}
export interface IGPUHostDocument extends IGPUHost, Document {
  createdAt: Date; // Creation date of the GPU host configuration, commented out if extended
  updatedAt: Date; // Last update date of the GPU host configuration, commented out if extended
}

// Define result type for GPU host CRUD operations
export interface GPUHostCrudResult {
  success: boolean; // Indicates whether the operation was successful
  operation: CRUDOperation; // The type of operation performed (CREATE, READ, UPDATE, DELETE)
  gpuHost?: IGPUHostDocument; // The created or updated GPU host configuration (applicable for CREATE and UPDATE operations)
  message?: string; // Message if error/warning occurred (applicable for all operations)
}

/*===================================== GPU Section ends here =============================================*/
/*===================================== Administrative Tool Section ends here =============================================*/
