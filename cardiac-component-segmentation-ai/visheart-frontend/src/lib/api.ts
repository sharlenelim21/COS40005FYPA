import axios from "axios";
import { MetricData, S3Metrics, CostData } from "@/types/system-monitor";

// Create a pre-configured instance of axios.
// This is a best practice for managing API calls in a structured way.
if (!process.env.NEXT_PUBLIC_API_URL) {
  console.error(
    "NEXT_PUBLIC_API_URL is not defined in your environment variables.",
  );
  throw new Error("Missing NEXT_PUBLIC_API_URL environment variable");
}

const api = axios.create({
  // Set the base URL for all API requests from your environment variables.
  // This makes it easy to switch between development and production environments.
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  // Crucially, this tells axios to send cookies (like the session ID) with every request.
  // This is essential for session-based authentication with Passport.js.
  withCredentials: true,
  timeout: 30000,
});

// Log the API base URL to the console for debugging purposes.
console.log(`API base URL: ${process.env.NEXT_PUBLIC_API_URL}`);

// Authentication functions
export const authApi = {
  /**
   * Register a new user account
   * @param userData - User registration data containing username, password, email, and phone
   * @returns Promise<ApiResponse> - Registration response with success status and user data
   */
  register: async (userData: {
    username: string;
    password: string;
    email: string;
    phone: string;
  }) => {
    try {
      const response = await api.post("/auth/register", userData);
      return response.data;
    } catch (error) {
      // Rethrow the error for handling by the caller
      throw error;
    }
  },

  /**
   * Upgrade a guest account to a full registered user account
   * @param userData - User registration data containing username, password, email, and phone
   * @returns Promise<ApiResponse> - Registration response with success status and user data
   * @requires User must be authenticated as a guest user
   */
  registerFromGuest: async (userData: {
    username: string;
    password: string;
    email: string;
    phone: string;
  }) => {
    try {
      const response = await api.post("/auth/register-from-guest", userData);
      return response.data;
    } catch (error) {
      // Rethrow the error for handling by the caller
      throw error;
    }
  },

  // Login function that takes username and password
  login: async (username: string, password: string) => {
    try {
      const response = await api.post("/auth/login", { username, password });
      return response.data;
    } catch (error) {
      // Rethrow the error for handling by the caller
      throw error;
    }
  },

  // Guest login function (doesn't need credentials)
  guestLogin: async () => {
    try {
      const response = await api.post("/auth/guest");
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Logout function
  logout: async () => {
    try {
      const response = await api.post("/auth/logout");
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Get current user information
  fetchUser: async () => {
    try {
      const response = await api.get("/auth/fetch");
      return response.data;
    } catch (error: any) {
      // If user is not authenticated (401/403), this is expected behavior when not logged in
      if (error.response?.status === 401 || error.response?.status === 403) {
        // Don't log this as it's expected behavior for unauthenticated users
        return { fetch: false, user: null };
      }
      // For other errors (network issues, server errors), still throw
      throw error;
    }
  },

  // Update user information
  updateUser: async (data: {
    firstName?: string;
    lastName?: string;
    email?: string;
  }) => {
    try {
      const response = await api.post("/auth/update", data);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Update user password
  updatePassword: async (data: {
    currentPassword?: string;
    newPassword?: string;
  }) => {
    try {
      // Map frontend field names to backend field names
      const requestData = {
        old_password: data.currentPassword,
        password: data.newPassword,
      };
      const response = await api.post("/auth/update-password", requestData);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Delete user account
  deleteUser: async () => {
    try {
      const response = await api.post("/auth/delete");
      return response.data;
    } catch (error) {
      throw error;
    }
  },
};

// Project management functions
export const projectApi = {
  // Get all projects for the current user
  getProjects: async () => {
    try {
      const response = await api.get("/project/get-projects-list");
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Get specific project info
  getProjectInfo: async (projectId: string) => {
    try {
      const response = await api.get(`/project/get-project-info/${projectId}`);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Upload new project
  uploadProject: async (formData: FormData) => {
    try {
      const response = await api.put("/project/upload-new-project", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Update project details
  updateProject: async (
    projectId: string,
    name?: string,
    description?: string,
  ) => {
    try {
      const response = await api.patch("/project/update-project", {
        projectId,
        name,
        description,
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Save/unsave project
  saveProject: async (projectId: string, isSaved: boolean) => {
    try {
      const response = await api.patch("/project/save-project", {
        projectId,
        isSaved,
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Delete project
  deleteProject: async (projectId: string) => {
    try {
      const response = await api.delete(
        `/project/user-delete-project/${projectId}`,
      );
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Get presigned URL for project tar file
  getProjectPresignedUrl: async (projectId: string) => {
    try {
      const response = await api.get("/project/get-project-presigned-url", {
        params: { projectId },
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  },
};

// Segmentation functions
export const segmentationApi = {
  // Start segmentation for a project
  startSegmentation: async (projectId: string) => {
    try {
      const response = await api.post(
        `/segmentation/start-segmentation/${projectId}`,
      );
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Get segmentation results for a project
  getSegmentationResults: async (projectId: string) => {
    try {
      const response = await api.get(
        `/segmentation/segmentation-results/${projectId}`,
      );
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Batch get segmentation status for multiple projects
  batchSegmentationStatus: async (projectIds: string[]) => {
    console.log('[API] Batch segmentation status check:', { projectIds });

    try {
      const response = await api.post('/segmentation/batch-segmentation-status', {
        projectIds,
      });

      console.log('[API] Batch segmentation status response:', {
        success: response.data.success,
        statusCount: Object.keys(response.data.statuses || {}).length
      });

      return response.data;
    } catch (error) {
      console.error('[API] Batch segmentation status error:', error);
      throw error;
    }
  },

  // Start manual segmentation
  startManualSegmentation: async (
    projectId: string,
    data: {
      image_name: string;
      bbox: number[];
      segmentationName?: string;
      segmentationDescription?: string;
    },
  ) => {
    try {
      const response = await api.post(
        `/segmentation/start-manual-segmentation/${projectId}`,
        data,
      );
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Save manual segmentation
  saveManualSegmentation: async (
    projectId: string,
    data: {
      name?: string;
      description?: string;
      frames?: any[];
    },
  ) => {
    try {
      const response = await api.put(
        `/segmentation/save-manual-segmentation/${projectId}`,
        data,
      );
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Save AI segmentation
  saveAISegmentation: async (segmentationMaskId: string) => {
    try {
      const response = await api.patch("/segmentation/save-ai-segmentation", {
        segmentationMaskId,
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Get user job status
  getUserJobs: async () => {
    try {
      const response = await api.get("/segmentation/user-check-jobs");
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Export project data
  exportProjectData: async (projectId: string) => {
    try {
      console.log(`[API] Starting export for project: ${projectId}`);

      // First, get the presigned URL from the backend
      const response = await api.get(
        `/segmentation/export-project-data/${projectId}`,
      );

      console.log(`[API] Backend response:`, response.data);

      if (!response.data.success || !response.data.exportPackageUrl) {
        throw new Error(response.data.message || "Export failed - no download URL received");
      }

      // Then download the actual file from the presigned URL
      console.log(`[API] Downloading from presigned URL: ${response.data.exportPackageUrl}`);
      const fileResponse = await fetch(response.data.exportPackageUrl);

      console.log(`[API] File response:`, {
        status: fileResponse.status,
        statusText: fileResponse.statusText,
        headers: Object.fromEntries(fileResponse.headers.entries()),
        ok: fileResponse.ok
      });

      if (!fileResponse.ok) {
        throw new Error(`Failed to download export file: ${fileResponse.status} ${fileResponse.statusText}`);
      }

      const blob = await fileResponse.blob();
      console.log(`[API] Created blob:`, {
        size: blob.size,
        type: blob.type,
        expectedSize: response.data.fileSizeBytes
      });

      // Return both the blob and metadata
      return {
        blob,
        suggestedFilename: response.data.suggestedFilename || `project-${projectId}-export.nii.gz`,
        fileSizeBytes: response.data.fileSizeBytes
      };
    } catch (error) {
      console.error(`[API] Export error:`, error);
      throw error;
    }
  },
};

// Reconstruction functions
export const reconstructionApi = {
  // Start 4D reconstruction for a project
  startReconstruction: async (
    projectId: string,
    data: {
      reconstructionName?: string;
      reconstructionDescription?: string;
      ed_frame?: number;
      export_format?: 'obj' | 'glb'; // User's choice for mesh export format
      parameters?: {
        num_iterations?: number;
        resolution?: number;
        process_all_frames?: boolean;
        debug_save?: boolean;
        debug_dir?: string;
      };
    }
  ) => {
    try {
      const response = await api.post(
        `/reconstruction/start-reconstruction/${projectId}`,
        data
      );
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Get reconstruction results for a project
  getReconstructionResults: async (projectId: string) => {
    try {
      const response = await api.get(
        `/reconstruction/reconstruction-results/${projectId}`
      );
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Batch get reconstruction status for multiple projects
  batchReconstructionStatus: async (projectIds: string[]) => {
    console.log('[API] Batch reconstruction status check:', { projectIds });

    try {
      const response = await api.post('/reconstruction/batch-reconstruction-status', {
        projectIds,
      });

      console.log('[API] Batch reconstruction status response:', {
        success: response.data.success,
        statusCount: Object.keys(response.data.statuses || {}).length
      });

      return response.data;
    } catch (error) {
      console.error('[API] Batch reconstruction status error:', error);
      throw error;
    }
  },

  // Get user reconstruction jobs
  getUserReconstructionJobs: async () => {
    try {
      const response = await api.get("/reconstruction/user-check-jobs");
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Delete all reconstructions for a project
  deleteProjectReconstructions: async (projectId: string) => {
    console.log('[API] Deleting all reconstructions for project:', projectId);
    try {
      const response = await api.delete(
        `/reconstruction/delete-project-reconstructions/${projectId}`
      );
      console.log('[API] Delete reconstructions response:', response.data);
      return response.data;
    } catch (error) {
      console.error('[API] Delete reconstructions error:', error);
      throw error;
    }
  },
};

// Define interfaces for the admin-specific responses
export interface Project {
  _id: string;
  name: string;
  description: string;
  // Add other project fields as necessary
}

export interface UserWithProjects {
  userId: string;
  username: string;
  projectCount: number;
  projects: Project[];
}

export interface GetAllUsersWithProjectsResponse {
  fetch: boolean;
  totalUsers: number;
  data: UserWithProjects[];
}

// Admin functions
export const adminApi = {
  // Get all users with projects (admin only)
  getAllUsersWithProjects:
    async (): Promise<GetAllUsersWithProjectsResponse> => {
      try {
        const response = await api.get("/project/get-allusers-with-projects");
        console.log("Fetched users with projects:", response.data);
        return response.data;
      } catch (error) {
        console.error("Error fetching users with projects:", error);
        throw error;
      }
    },

  // Get all jobs status (admin only)
  getAllJobsStatus: async (page: number = 1, limit: number = 50) => {
    try {
      const response = await api.get(
        `/segmentation/admin-check-all-jobs-status?page=${page}&limit=${limit}`,
      );
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Update user role (admin only)
  updateUserRole: async (username: string, newRole: string) => {
    try {
      const response = await api.post("/auth/update-role", {
        username,
        newrole: newRole,
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Admin route to update any user's information
  adminUpdateUser: async (targetUsername: string, updates: any) => {
    try {
      const response = await api.post("/auth/admin-update-user", {
        targetUsername,
        updates,
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Admin-only route to delete a user by username
  adminDeleteUser: async (usernameToDelete: string) => {
    try {
      const response = await api.post("/auth/admin-delete-user", {
        usernameToDelete,
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Get all users (admin only)
  getAllUsers: async () => {
    try {
      // This endpoint is now GET /auth/users as per the new routes
      const response = await api.get("/auth/users");
      return response.data;
    } catch (error) {
      throw error;
    }
  },
};

// System status functions
export const statusApi = {
  // Get GPU status
  getGpuStatus: async () => {
    try {
      const response = await api.get("/status/gpu-status");
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Get GPU system status (CPU, RAM, Disk)
  getGpuSystemStatus: async () => {
    try {
      const response = await api.get("/status/gpu-system-status");
      return response.data;
    } catch (error) {
      throw error;
    }
  },
};

// GPU configuration functions (admin only)
export const gpuConfigApi = {
  // Get current GPU configuration
  getGpuConfig: async () => {
    try {
      const response = await api.get("/admintools/gpu-config");
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Update GPU configuration
  updateGpuConfig: async (config: {
    host?: string;
    port?: number;
    isHTTPS?: boolean;
    description?: string;
    serverIdForGpuServer?: string;
    gpuServerIdentity?: string;
    gpuServerAuthJwtSecret?: string;
    jwtRefreshInterval?: number;
    jwtLifetimeSeconds?: number;
  }) => {
    try {
      const response = await api.patch("/admintools/gpu-config", config);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Reload GPU configuration from database
  reloadGpuConfig: async () => {
    try {
      const response = await api.post("/admintools/gpu-config/reload");
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  // Test GPU server connection
  testGpuConnection: async () => {
    try {
      const response = await api.post("/admintools/gpu-config/test-connection");
      return response.data;
    } catch (error) {
      throw error;
    }
  },
};

// Sample NIfTI files API
export const sampleNiftiApi = {
  /**
   * Get information about all available sample NIfTI files
   * @returns Promise<SampleNiftiResponse> - Response containing file information
   */
  getFileInfo: async () => {
    try {
      const response = await api.get("/sample-nifti/info");
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  /**
   * Get metadata for a specific NIfTI file
   * @param filename - Name of the NIfTI file
   * @returns Promise<ApiResponse> - Response containing file metadata
   */
  getFileMetadata: async (filename: string) => {
    try {
      const response = await api.get(`/sample-nifti/metadata/${filename}`);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  /**
   * Download a specific NIfTI file
   * @param filename - Name of the NIfTI file to download
   * @returns Promise<Blob> - File blob for download
   */
  downloadFile: async (filename: string): Promise<Blob> => {
    try {
      const response = await api.get(`/sample-nifti/download/${filename}`, {
        responseType: 'blob',
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  },
};

// AWS Analytics
export const analyticsApi = {
  /**
   * Get CPU utilization metrics for the current EC2 instance
   * @returns Promise<MetricData | null> - CPU utilization data with timestamps and values
   */
  getCpuMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/cpu-utilization");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch CPU metrics:", error);
      return null;
    }
  },

  /**
   * Get Network In metrics for the current EC2 instance
   * @returns Promise<MetricData | null> - Network In data with timestamps and values (bytes)
   */
  getNetworkInMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/network-in");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch Network In metrics:", error);
      return null;
    }
  },

  /**
   * Get Network Out metrics for the current EC2 instance
   * @returns Promise<MetricData | null> - Network Out data with timestamps and values (bytes)
   */
  getNetworkOutMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/network-out");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch Network Out metrics:", error);
      return null;
    }
  },

  /**
   * Get Disk Read metrics for the current EC2 instance
   * @returns Promise<MetricData | null> - Disk Read data with timestamps and values (bytes)
   */
  getDiskReadMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/disk-read");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch Disk Read metrics:", error);
      return null;
    }
  },

  /**
   * Get Disk Write metrics for the current EC2 instance
   * @returns Promise<MetricData | null> - Disk Write data with timestamps and values (bytes)
   */
  getDiskWriteMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/disk-write");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch Disk Write metrics:", error);
      return null;
    }
  },

  /**
   * Get ECR Repository Size metrics (legacy - backend repository)
   * @returns Promise<MetricData | null> - ECR Repository Size data with timestamps and values (bytes)
   */
  getEcrRepositorySizeMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/ecr/repository-size");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ECR Repository Size metrics:", error);
      return null;
    }
  },

  /**
   * Get ECR Image Count metrics (legacy - backend repository)
   * @returns Promise<MetricData | null> - ECR Image Count data with timestamps and values (count)
   */
  getEcrImageCountMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/ecr/image-count");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ECR Image Count metrics:", error);
      return null;
    }
  },

  /**
   * Get ECR Backend Repository Size metrics
   * @returns Promise<MetricData | null> - ECR Backend Repository Size data with timestamps and values (bytes)
   */
  getEcrBackendRepositorySizeMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/ecr/backend/repository-size");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ECR Backend Repository Size metrics:", error);
      return null;
    }
  },

  /**
   * Get ECR Backend Image Count metrics
   * @returns Promise<MetricData | null> - ECR Backend Image Count data with timestamps and values (count)
   */
  getEcrBackendImageCountMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/ecr/backend/image-count");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ECR Backend Image Count metrics:", error);
      return null;
    }
  },

  /**
   * Get ECR Frontend Repository Size metrics
   * @returns Promise<MetricData | null> - ECR Frontend Repository Size data with timestamps and values (bytes)
   */
  getEcrFrontendRepositorySizeMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/ecr/frontend/repository-size");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ECR Frontend Repository Size metrics:", error);
      return null;
    }
  },

  /**
   * Get ECR Frontend Image Count metrics
   * @returns Promise<MetricData | null> - ECR Frontend Image Count data with timestamps and values (count)
   */
  getEcrFrontendImageCountMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/ecr/frontend/image-count");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ECR Frontend Image Count metrics:", error);
      return null;
    }
  },

  /**
   * Get ECR Backend Repository Pull Count metrics
   * @returns Promise<MetricData | null> - ECR Backend Repository Pull Count data with timestamps and values (count)
   */
  getEcrBackendRepositoryPullCountMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/ecr/backend/repository-size");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ECR Backend Repository Pull Count metrics:", error);
      return null;
    }
  },

  /**
   * Get ECR Frontend Repository Pull Count metrics
   * @returns Promise<MetricData | null> - ECR Frontend Repository Pull Count data with timestamps and values (count)
   */
  getEcrFrontendRepositoryPullCountMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/ecr/frontend/repository-size");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ECR Frontend Repository Pull Count metrics:", error);
      return null;
    }
  },

  // ===== S3 CloudWatch Metrics =====

  /**
   * Get all S3 metrics for a specific bucket
   * @param bucketName - S3 bucket name
   * @returns Promise<S3Metrics | null> - Complete S3 metrics data
   */
  getAllS3Metrics: async (bucketName: string): Promise<S3Metrics | null> => {
    try {
      if (!bucketName || bucketName.trim() === '') {
        console.error("Bucket name is required for S3 metrics");
        return null;
      }
      const response = await api.get(`/metrics/s3/${encodeURIComponent(bucketName)}/all`);
      // The backend returns S3Metrics directly
      const data = response.data;
      return {
        bucketName: data.bucketName,
        bucketSizeBytes: data.bucketSizeBytes,
        numberOfObjects: data.numberOfObjects,
        allRequests: data.allRequests,
        getRequests: data.getRequests,
        putRequests: data.putRequests
      };
    } catch (error) {
      console.error(`Failed to fetch S3 metrics for bucket ${bucketName}:`, error);
      return null;
    }
  },

  /**
   * Get S3 bucket size metrics
   * @param bucketName - S3 bucket name
   * @returns Promise<MetricData | null> - Bucket size data with timestamps and values (bytes)
   */
  getS3BucketSizeMetrics: async (bucketName: string): Promise<MetricData | null> => {
    try {
      if (!bucketName || bucketName.trim() === '') {
        console.error("Bucket name is required for S3 bucket size metrics");
        return null;
      }
      const response = await api.get(`/metrics/s3/${encodeURIComponent(bucketName)}/bucket-size`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch S3 bucket size metrics for ${bucketName}:`, error);
      return null;
    }
  },

  /**
   * Get S3 number of objects metrics
   * @param bucketName - S3 bucket name
   * @returns Promise<MetricData | null> - Object count data with timestamps and values (count)
   */
  getS3ObjectCountMetrics: async (bucketName: string): Promise<MetricData | null> => {
    try {
      if (!bucketName || bucketName.trim() === '') {
        console.error("Bucket name is required for S3 object count metrics");
        return null;
      }
      const response = await api.get(`/metrics/s3/${encodeURIComponent(bucketName)}/object-count`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch S3 object count metrics for ${bucketName}:`, error);
      return null;
    }
  },

  /**
   * Get S3 all requests metrics
   * @param bucketName - S3 bucket name
   * @returns Promise<MetricData | null> - All requests data with timestamps and values (count)
   */
  getS3AllRequestsMetrics: async (bucketName: string): Promise<MetricData | null> => {
    try {
      if (!bucketName || bucketName.trim() === '') {
        console.error("Bucket name is required for S3 all requests metrics");
        return null;
      }
      const response = await api.get(`/metrics/s3/${encodeURIComponent(bucketName)}/all-requests`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch S3 all requests metrics for ${bucketName}:`, error);
      return null;
    }
  },

  /**
   * Get S3 GET requests metrics
   * @param bucketName - S3 bucket name
   * @returns Promise<MetricData | null> - GET requests data with timestamps and values (count)
   */
  getS3GetRequestsMetrics: async (bucketName: string): Promise<MetricData | null> => {
    try {
      if (!bucketName || bucketName.trim() === '') {
        console.error("Bucket name is required for S3 GET requests metrics");
        return null;
      }
      const response = await api.get(`/metrics/s3/${encodeURIComponent(bucketName)}/get-requests`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch S3 GET requests metrics for ${bucketName}:`, error);
      return null;
    }
  },

  /**
   * Get S3 PUT requests metrics
   * @param bucketName - S3 bucket name
   * @returns Promise<MetricData | null> - PUT requests data with timestamps and values (count)
   */
  getS3PutRequestsMetrics: async (bucketName: string): Promise<MetricData | null> => {
    try {
      if (!bucketName || bucketName.trim() === '') {
        console.error("Bucket name is required for S3 PUT requests metrics");
        return null;
      }
      const response = await api.get(`/metrics/s3/${encodeURIComponent(bucketName)}/put-requests`);
      return response.data;
    } catch (error) {
      console.error(`Failed to fetch S3 PUT requests metrics for ${bucketName}:`, error);
      return null;
    }
  },

  /**
   * List all S3 buckets
   * @returns Promise<{buckets: Array<{Name: string, CreationDate: Date}>} | null> - List of S3 buckets
   */
  getS3Buckets: async (): Promise<{buckets: Array<{Name: string, CreationDate: Date}>} | null> => {
    try {
      const response = await api.get("/metrics/s3/buckets"); // ✅ Fixed: added /buckets
      return response.data;
    } catch (error) {
      console.error("Failed to fetch S3 buckets:", error);
      return null;
    }
  },

  // ===== ALB CloudWatch Metrics =====

  /**
   * Get ALB Request Count metrics
   * @returns Promise<MetricData | null> - Request count data with timestamps and values (count)
   */
  getALBRequestCountMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/alb/request-count");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ALB Request Count metrics:", error);
      return null;
    }
  },

  /**
   * Get ALB Target Response Time metrics
   * @returns Promise<MetricData | null> - Target response time data with timestamps and values (seconds)
   */
  getALBTargetResponseTimeMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/alb/target-response-time");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ALB Target Response Time metrics:", error);
      return null;
    }
  },

  /**
   * Get ALB HTTP 4XX ELB Error Count metrics
   * @returns Promise<MetricData | null> - ELB 4xx error count data with timestamps and values (count)
   */
  getALBHTTP4XXELBMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/alb/http-4xx-elb");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ALB HTTP 4XX ELB Error Count metrics:", error);
      return null;
    }
  },

  /**
   * Get ALB HTTP 4XX Target Error Count metrics
   * @returns Promise<MetricData | null> - Target 4xx error count data with timestamps and values (count)
   */
  getALBHTTP4XXTargetMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/alb/http-4xx-target");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ALB HTTP 4XX Target Error Count metrics:", error);
      return null;
    }
  },

  /**
   * Get ALB Healthy Host Count metrics
   * @returns Promise<MetricData | null> - Healthy host count data with timestamps and values (count)
   */
  getALBHealthyHostCountMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/alb/healthy-hosts");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ALB Healthy Host Count metrics:", error);
      return null;
    }
  },

  /**
   * Get ALB Unhealthy Host Count metrics
   * @returns Promise<MetricData | null> - Unhealthy host count data with timestamps and values (count)
   */
  getALBUnhealthyHostCountMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/alb/unhealthy-hosts");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ALB Unhealthy Host Count metrics:", error);
      return null;
    }
  },

  /**
   * Get ASG Group Min Size metrics
   * @returns Promise<MetricData | null> - ASG Group Min Size data with timestamps and values (count)
   */
  getASGGroupMinSizeMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/asg/min-size");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ASG Group Min Size metrics:", error);
      return null;
    }
  },

  /**
   * Get ASG Group Max Size metrics
   * @returns Promise<MetricData | null> - ASG Group Max Size data with timestamps and values (count)
   */
  getASGGroupMaxSizeMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/asg/max-size");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ASG Group Max Size metrics:", error);
      return null;
    }
  },

  /**
   * Get ASG Group Desired Capacity metrics
   * @returns Promise<MetricData | null> - ASG Group Desired Capacity data with timestamps and values (count)
   */
  getASGGroupDesiredCapacityMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/asg/desired-capacity");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ASG Group Desired Capacity metrics:", error);
      return null;
    }
  },

  /**
   * Get ASG Group In Service Instances metrics
   * @returns Promise<MetricData | null> - ASG Group In Service Instances data with timestamps and values (count)
   */
  getASGGroupInServiceInstancesMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/asg/in-service");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ASG Group In Service Instances metrics:", error);
      return null;
    }
  },

  /**
   * Get ASG Group Pending Instances metrics
   * @returns Promise<MetricData | null> - ASG Group Pending Instances data with timestamps and values (count)
   */
  getASGGroupPendingInstancesMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/asg/pending");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ASG Group Pending Instances metrics:", error);
      return null;
    }
  },

  /**
   * Get ASG Group Total Instances metrics
   * @returns Promise<MetricData | null> - ASG Group Total Instances data with timestamps and values (count)
   */
  getASGGroupTotalInstancesMetrics: async (): Promise<MetricData | null> => {
    try {
      const response = await api.get("/metrics/asg/total");
      return response.data;
    } catch (error) {
      console.error("Failed to fetch ASG Group Total Instances metrics:", error);
      return null;
    }
  },

  /**
   * Get total AWS costs for current month
   * @returns Promise<CostData[] | null> - Array of cost data with service, amount, and unit
   */
  getTotalCosts: async (): Promise<CostData[] | null> => {
    try {
      const response = await api.get("/metrics/billing/total");
      return response.data.data;
    } catch (error) {
      console.error("Failed to fetch total costs:", error);
      return null;
    }
  },

  /**
   * Get AWS costs grouped by service for current month
   * @returns Promise<CostData[] | null> - Array of cost data grouped by service with amount and unit
   */
  getCostsByService: async (): Promise<CostData[] | null> => {
    try {
      const response = await api.get("/metrics/billing/by-service");
      return response.data.data;
    } catch (error) {
      console.error("Failed to fetch costs by service:", error);
      return null;
    }
  }
};

export default api;