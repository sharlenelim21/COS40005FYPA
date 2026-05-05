"use client";

import { useState, useEffect, useCallback } from "react";
import { projectApi, segmentationApi, adminApi, statusApi } from "@/lib/api";
import { Project, Job, SystemStats, UserStats } from "@/types/dashboard";

export function useGpuStatus() {
  const [processingUnit, setProcessingUnit] = useState<{
    serviceOnline: boolean;
    gpuAvailable: boolean;
    mode: "gpu" | "cpu" | "unknown";
    status: "online" | "offline" | "degraded" | "timeout" | "unknown";
    message: string;
  }>({
    serviceOnline: false,
    gpuAvailable: false,
    mode: "unknown",
    status: "unknown",
    message: "Checking processing unit...",
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchGpuStatus = useCallback(async () => {
    console.log("🔄 [useGpuStatus] Starting processing unit status fetch...");
    setIsLoading(true);

    try {
      const response = await statusApi.getGpuStatus();
      console.log("✅ [useGpuStatus] Processing unit status response:", response);

      const serviceOnline = Boolean(response.serviceOnline ?? response.status === "online");
      const gpuAvailable = Boolean(response.gpuAvailable ?? response.details?.gpuAvailable);
      const mode = (response.mode ?? (gpuAvailable ? "gpu" : "cpu")) as "gpu" | "cpu" | "unknown";

      let finalStatus: "online" | "offline" | "degraded" | "timeout" = "offline";

      // Check for timeout indicators in response
      const hasTimeoutCode = response.details?.code === "ETIMEDOUT";
      const hasTimeoutMessage = response.message?.toLowerCase?.().includes?.("timeout") ||
                               response.details?.includes?.("timeout");
      
      if (hasTimeoutCode || hasTimeoutMessage) {
        console.log("⏰ [useGpuStatus] Backend reported timeout - code:", response.details?.code, "message:", response.message);
        finalStatus = "timeout";
      } else if (serviceOnline && gpuAvailable) {
        console.log("✅ [useGpuStatus] NVIDIA GPU is available");
        finalStatus = "online";
      } else if (serviceOnline) {
        console.log("🟡 [useGpuStatus] Processing service online, CPU mode active");
        finalStatus = "degraded";
      } else {
        console.log("❌ [useGpuStatus] Processing service offline - status:", response.status);
        finalStatus = "offline";
      }
      
      console.log("📊 [useGpuStatus] Final processing unit state:", {
        serviceOnline,
        gpuAvailable,
        mode,
        status: finalStatus,
      });
      setProcessingUnit({
        serviceOnline,
        gpuAvailable,
        mode,
        status: finalStatus,
        message: response.message || "Processing unit status updated",
      });
    } catch (error: any) {
      console.error("❌ [useGpuStatus] Error fetching processing unit status:", error);
      
      // Check if the error itself indicates a timeout
      if (error?.code === "ETIMEDOUT" || error?.message?.toLowerCase?.().includes?.("timeout")) {
        console.log("⏰ [useGpuStatus] Network timeout detected in catch block");
        setProcessingUnit({
          serviceOnline: false,
          gpuAvailable: false,
          mode: "unknown",
          status: "timeout",
          message: "Processing unit status request timed out",
        });
      } else {
        console.log("💀 [useGpuStatus] Setting status to offline due to error");
        setProcessingUnit({
          serviceOnline: false,
          gpuAvailable: false,
          mode: "unknown",
          status: "offline",
          message: "Processing unit status unavailable",
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGpuStatus();
  }, [fetchGpuStatus]);

  return { processingUnit, isLoading, refresh: fetchGpuStatus };
}

export function useUserProjects(enabled = true) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    if (!enabled) {
      setProjects([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await projectApi.getProjects();
      setProjects(response.projects || []);
    } catch (error: any) {
      const isUnauthorized = error?.response?.status === 401;
      if (!isUnauthorized) {
        console.error("Error fetching projects:", error);
      }
      setProjects([]);
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  return { projects, isLoading, refresh: fetchProjects };
}

export function useUserJobs(enabled = true) {
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    if (!enabled) {
      setRecentJobs([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await segmentationApi.getUserJobs();
      setRecentJobs(response.jobs?.slice(0, 5) || []);
    } catch (error: any) {
      const isUnauthorized = error?.response?.status === 401;
      if (!isUnauthorized) {
        console.error("Error fetching jobs:", error);
      }
      setRecentJobs([]);
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  return { recentJobs, isLoading, refresh: fetchJobs };
}

export function useSystemStats(isAdmin: boolean) {
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSystemStats = useCallback(async () => {
    if (!isAdmin) {
      setSystemStats(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const response = await adminApi.getAllJobsStatus();
      // Assuming you have other endpoints for totalUsers and totalProjects
      setSystemStats({
        totalUsers: 0,
        totalProjects: 0,
        pendingJobs: response.stats.pending,
        completedJobs: response.stats.completed,
        failedJobs: response.stats.failed,
      });
    } catch (error) {
      console.error("Error fetching system stats:", error);
      setSystemStats(null);
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchSystemStats();
  }, [fetchSystemStats]);

  return { systemStats, isLoading, refresh: fetchSystemStats };
}

export function useUserStats(projects: Project[], recentJobs: Job[]) {
  const [userStats, setUserStats] = useState<UserStats | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      if (projects.length === 0 && recentJobs.length === 0) {
        return;
      }

      const pendingJobsCount = recentJobs.filter(
        (job) => job.status === "pending",
      ).length;
      
      // Calculate total file size including mesh files from reconstructions
      const totalFileSize = projects.reduce((sum, project) => {
        let projectTotal = sum + project.filesize;
        
        // Add reconstruction mesh file size if available
        if (project.reconstruction && project.reconstruction.tarFileSize) {
          projectTotal += project.reconstruction.tarFileSize;
        }
        
        return projectTotal;
      }, 0);

      // Count completed segmentations by checking actual mask data
      let completedSegmentations = 0;
      let completedReconstructions = 0;
      
      if (projects.length > 0) {
        try {
          const projectIds = projects.map((p) => p.projectId);
          
          // Fetch segmentation status
          const segmentationResponse = await segmentationApi.batchSegmentationStatus(projectIds);
          if (segmentationResponse.success && segmentationResponse.statuses) {
            // Count projects that have segmentation masks
            completedSegmentations = Object.values(segmentationResponse.statuses as Record<string, { hasMasks: boolean; maskCount: number }>).filter(
              (status) => status.hasMasks
            ).length;
          }
          
          // Fetch reconstruction status
          const { reconstructionApi } = await import("@/lib/api");
          const reconstructionResponse = await reconstructionApi.batchReconstructionStatus(projectIds);
          if (reconstructionResponse.success && reconstructionResponse.statuses) {
            // Count projects that have reconstructions
            completedReconstructions = Object.values(reconstructionResponse.statuses as Record<string, { hasReconstructions: boolean; reconstructionCount: number }>).filter(
              (status) => status.hasReconstructions
            ).length;
          }
        } catch (error) {
          console.error("Error fetching segmentation/reconstruction status for stats:", error);
          // Fallback: count as 0 if API call fails
          completedSegmentations = 0;
          completedReconstructions = 0;
        }
      }

      setUserStats({
        projectCount: projects.length,
        totalFileSize,
        completedSegmentations,
        completedReconstructions,
        pendingJobs: pendingJobsCount,
      });
    };

    fetchStats();
  }, [projects, recentJobs]);

  return userStats;
}
