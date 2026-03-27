// This is a type file for the test project page (/project/[projectId])
// This file defines the types used in the project page

/**
 * This defines the type of loading currently being done on the project page.
 * It is used to manage the loading state of different components on the page.
 * Possible values:
 * - "idle": Awaiting next action but not considered complete.
 * - "project": Loading project data from the backend.
 * - "mask": Loading segmentation masks for the project from the backend.
 * - "job": Loading job data for the project from the backend.
 * - "tar-cache": Loading and initializing tar cache for MRI images.
 * - "reconstruction-cache": Loading and initializing reconstruction cache for 4D GLB models.
 * - "done": All loading actions are complete and the page is ready to display content.
 */
export type LoadingStage = "idle" | "project" | "mask" | "job" | "tar-cache" | "reconstruction-cache" | "done";

/**
 * Interface representing the structure of project data.
 * This is used to type the project data as fetched from the backend via the /get-project-data/projectId route.
 * 
 * @interface ProjectData
 * @property {string} projectId - Unique identifier for the project.
 * @property {string} name - Name of the project.
 * @property {string} description - Description of the project.
 * @property {boolean} isSaved - Indicates if the project is saved.
 * @property {number} filesize - Size of the project file in bytes.
 * @property {string} filetype - Type of the project file (e.g., 'vox', 'json').
 * @property {Object} [dimensions] - Optional dimensions of the project.
 * @property {number} dimensions.width - Width of the project.
 * @property {number} dimensions.height - Height of the project.
 * @property {number} [dimensions.slices] - Optional number of slices in the project.
 * @property {number} [dimensions.frames] - Optional number of frames in the project.
 * @property {Object} [voxelsize] - Optional voxel size information.
 * @property {number} voxelsize.x - X dimension of the voxel size.
 * @property {number} voxelsize.y - Y dimension of the voxel size.
 * @property {number} [voxelsize.z] - Optional Z dimension of the voxel size.
 * @property {number} [voxelsize.t] - Optional T dimension of the voxel size.
 * @property {number[][]} [affineMatrix] - Optional 4x4 affine transformation matrix for spatial coordinates.
 * @property {string} [createdAt] - Optional creation date of the project in ISO format.
 * @property {string} [updatedAt] - Optional last updated date of the project in ISO format.
 */
export interface ProjectData {
    projectId: string;
    name: string;
    description: string;
    isSaved: boolean;
    filesize: number;
    filetype: string;
    dimensions?: {
        width: number;
        height: number;
        slices?: number;
        frames?: number;
    };
    voxelsize?: {
        x: number;
        y: number;
        z?: number;
        t?: number;
    };
    affineMatrix?: number[][];
    createdAt?: string;
    updatedAt?: string;
}

/**
 * Enum representing the possible classes for component bounding boxes in segmentation masks.
 * - RV: Right Ventricle
 * - MYO: Myocardium
 * - LVC: Left Ventricle Cavity
 * - MANUAL: Manual Bounding Box drawn by the user (only visible if user manually plots box)
 */
export enum ComponentBoundingBoxesClass {
    RV = "rv",
    MYO = "myo",
    LVC = "lvc",
    MANUAL = "manual",
}

/**
 * Interface representing a single component bounding box within a slice.
 * Used for identifying anatomical structures or manual annotations.
 * 
 * @interface ComponentBoundingBox
 * @property {ComponentBoundingBoxesClass} class - The class of the component (e.g., RV, MYO, LVC, MANUAL).
 * @property {number} confidence - Confidence score for the bounding box (0-1).
 * @property {number} x_min - Minimum X coordinate of the bounding box.
 * @property {number} y_min - Minimum Y coordinate of the bounding box.
 * @property {number} x_max - Maximum X coordinate of the bounding box.
 * @property {number} y_max - Maximum Y coordinate of the bounding box.
 */
export interface ComponentBoundingBox {
    class: ComponentBoundingBoxesClass;
    confidence: number;
    x_min: number;
    y_min: number;
    x_max: number;
    y_max: number;
}

/**
 * Interface representing the content of a segmentation mask for a single component.
 * 
 * @interface SegmentationMaskContent
 * @property {ComponentBoundingBoxesClass} class - The class of the segmented component.
 * @property {string} segmentationmaskcontents - RLE-encoded string representing the mask.
 */
export interface SegmentationMaskContent {
    class: ComponentBoundingBoxesClass;
    segmentationmaskcontents: string; // RLE encoded string
}

/**
 * Interface representing a single slice within a frame.
 * Contains bounding boxes and segmentation masks for that slice.
 * 
 * @interface SliceData
 * @property {number} sliceindex - Index of the slice within the frame.
 * @property {ComponentBoundingBox[]} [componentboundingboxes] - Optional array of bounding boxes for this slice.
 * @property {SegmentationMaskContent[]} [segmentationmasks] - Optional array of segmentation masks for this slice.
 */
export interface SliceData {
    sliceindex: number;
    componentboundingboxes?: ComponentBoundingBox[];
    segmentationmasks?: SegmentationMaskContent[];
}

/**
 * Interface representing a single frame in a segmentation mask.
 * Each frame contains multiple slices.
 * 
 * @interface FrameData
 * @property {number} frameindex - Index of the frame.
 * @property {boolean} frameinferred - Whether this frame was inferred/generated.
 * @property {SliceData[]} slices - Array of slice data for this frame.
 */
export interface FrameData {
    frameindex: number;
    frameinferred: boolean;
    slices: SliceData[];
}

/**
 * Base interface for segmentation masks, used by both MedSAM (AI-generated) and editable (manual) masks.
 * 
 * @interface BaseSegmentationMask
 * @property {string} _id - Unique identifier for the segmentation mask.
 * @property {string} projectid - ID of the project this mask belongs to.
 * @property {string} name - Name of the segmentation mask.
 * @property {string} [description] - Optional description of the mask.
 * @property {boolean} isSaved - Whether the mask is saved.
 * @property {boolean} segmentationmaskRLE - Whether the mask uses RLE encoding.
 * @property {boolean} isMedSAMOutput - True if generated by MedSAM, false if manually created.
 * @property {FrameData[]} frames - Array of frame data for the mask.
 */
export interface BaseSegmentationMask {
    _id: string;
    projectid: string;
    name: string;
    description?: string;
    isSaved: boolean;
    segmentationmaskRLE: boolean;
    isMedSAMOutput: boolean;
    frames: FrameData[];
}

/**
 * Interface representing a decoded mask for a project.
 * This is used to store decoded segmentation masks for rendering.
 * Dimensions can be fetched from the project data.
 * @interface DecodedMask
 * @property {DecodedMaskFrameData[]} frames - Array of decoded frame data.
 */
export interface DecodedMask {
    frames: DecodedMaskFrameData[];
}

/**
 * Interface representing a decoded frame of a mask.
 * @interface DecodedMaskFrameData
 * @property {number} frameindex - Index of the frame.
 * @property {DecodedMaskSliceData[]} slices - Array of decoded slice data.
 */
interface DecodedMaskFrameData {
    frameindex: number;
    slices: DecodedMaskSliceData[];
}

/**
 * Interface representing a decoded slice of a mask.
 * @interface DecodedMaskSliceData
 * @property {number} sliceindex - Index of the slice.
 * @property {ComponentBoundingBoxesClass} class - Class of the component (e.g., RV, MYO, LVC).
 * @property {Uint8Array} mask - Decoded mask as a Uint8Array.
 */
interface DecodedMaskSliceData {
    sliceindex: number;
    class: ComponentBoundingBoxesClass;
    mask: Uint8Array; // Decoded mask as a Uint8Array
}

/*==================================== Job Section begins here =============================================*/
/**
 * Job status enum matching backend JobStatus.
 * These values correspond to the database JobStatus enum in the backend.
 * @enum {string}
 * @property {string} PENDING - Job is waiting in the queue to be processed.
 * @property {string} IN_PROGRESS - Job is currently being processed by the GPU server.
 * @property {string} COMPLETED - Job has been completed successfully.
 * @property {string} FAILED - Job has failed during processing.
 */
export enum JobStatus {
    PENDING = "pending",
    IN_PROGRESS = "in_progress",
    COMPLETED = "completed",
    FAILED = "failed",
}

/**
 * Segmentation source enum matching backend segmentationSource.
 * Indicates the source/method used to generate the segmentation.
 * @enum {string}
 * @property {string} AI_INFERENCE - Segmentation generated by AI inference (e.g., MedSAM).
 * @property {string} MANUAL_INFERENCE - Segmentation generated by manual user input.
 */
export enum SegmentationSource {
    AI_INFERENCE = "ai_inference",
    MANUAL_INFERENCE = "manual_inference",
}

/**
 * Interface representing a single job as stored in the backend database.
 * This corresponds to the IJob interface from the backend database types.
 * 
 * @interface Job
 * @property {string} jobId - Unique identifier for the job (uuid field from backend).
 * @property {string} userId - ID of the user who created the job.
 * @property {string} projectId - ID of the project associated with the job.
 * @property {JobStatus} status - Current status of the job.
 * @property {string} [result] - Optional result of the job (e.g., success message, output data).
 * @property {string} [message] - Optional error message if the job fails or status message.
 * @property {string} [segmentationName] - Optional user-defined name for the resulting segmentation.
 * @property {string} [segmentationDescription] - Optional user-defined description for the resulting segmentation.
 * @property {SegmentationSource} [segmentationSource] - Optional source of the segmentation.
 * @property {string} [createdAt] - Optional creation timestamp in ISO format.
 * @property {string} [updatedAt] - Optional last update timestamp in ISO format.
 */
export interface Job {
    jobId: string; // Maps to 'uuid' in backend
    userId: string; // Maps to 'userid' in backend
    projectId: string; // Maps to 'projectid' in backend
    status: JobStatus;
    result?: string;
    message?: string;
    segmentationName?: string;
    segmentationDescription?: string;
    segmentationSource?: SegmentationSource;
    createdAt?: string;
    updatedAt?: string;
}

/**
 * Interface for individual job data returned from /segmentation/user-check-jobs endpoint.
 * This is a simplified version of the Job interface containing only the essential fields
 * that are returned by the user jobs API endpoint.
 * 
 * @interface UserJob
 * @property {string} jobId - Unique identifier for the job (job.uuid from backend).
 * @property {string} projectId - ID of the project associated with the job (job.projectid from backend).
 * @property {JobStatus} status - Current status of the job (job.status from backend).
 * @property {number | null} queuePosition - Position in queue if status is PENDING, null otherwise.
 */
export interface UserJob {
    jobId: string;
    projectId: string;
    status: JobStatus;
    queuePosition: number | null;
}

/**
 * Interface for the complete response from /segmentation/user-check-jobs endpoint.
 * This matches the exact structure returned by the backend API.
 * 
 * @interface UserJobsResponse
 * @property {boolean} success - Indicates if the request was successful.
 * @property {number} activeJobCount - Count of jobs with PENDING or IN_PROGRESS status.
 * @property {number} totalJobs - Total number of jobs returned (up to 20).
 * @property {UserJob[]} jobs - Array of user's jobs.
 */
export interface UserJobsResponse {
    success: boolean;
    activeJobCount: number;
    totalJobs: number;
    jobs: UserJob[];
}

/**
 * Interface for error response from job-related API endpoints.
 * 
 * @interface JobErrorResponse
 * @property {false} success - Always false for error responses.
 * @property {string} message - Error message describing what went wrong.
 */
export interface JobErrorResponse {
    success: false;
    message: string;
}

/**
 * Union type for job API responses that can either succeed or fail.
 */
export type JobApiResponse = UserJobsResponse | JobErrorResponse;
/*==================================== Job Section ends here ===============================================*/

