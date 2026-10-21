export interface Project {
    projectId: string;
    name: string;
    description: string;
    isSaved: boolean;
    filesize: number;
    filetype: string;
    dimensions: {
      width: number;
      height: number;
      depth: number;
      slices?: number;
      frames?: number;
    };
    affineMatrix?: number[][];
    /** Clinical Assistants this project has been shared with, and how much each may do
     *  (Doctor/Admin view only). */
    assignedAssistants?: {
      userId: string;
      mode: "run" | "view_only";
      instructions?: string;
      assignedByUserId: string;
      assignedAt: string;
    }[];
    /** Present only in a Clinical Assistant's own "assigned to me" list — their own grant on
     *  this project. */
    assignmentMode?: "run" | "view_only";
    assignmentInstructions?: string | null;
    createdAt: string;
    updatedAt: string;
    reconstruction?: {
      edFrame: number;
      tarFileSize: number | null;
      meshFormat: string;
    } | null;
  }
  
  export interface Job {
    jobId: string;
    projectId: string;
    status: string;
    message: string;
    createdAt: string;
    progress?: number | null;
  }
  
  export interface UserStats {
    projectCount: number;
    totalFileSize: number;
    completedSegmentations: number;
    completedReconstructions: number;
    pendingJobs: number;
  }
  
  export interface SystemStats {
    totalUsers: number;
    totalProjects: number;
    pendingJobs: number;
    completedJobs: number;
    failedJobs: number;
  }
  