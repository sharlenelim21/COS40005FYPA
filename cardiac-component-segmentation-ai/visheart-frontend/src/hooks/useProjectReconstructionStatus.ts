"use client";

import { useState, useCallback, useEffect } from 'react';
import { reconstructionApi } from '@/lib/api';
import { Project } from '@/types/dashboard';

export interface ProjectReconstructionStatus {
  projectId: string;
  hasReconstructions: boolean;
  reconstructionCount?: number;
  loading: boolean;
  error: string | null;
}

/**
 * Hook to efficiently check reconstruction status for multiple projects
 * Uses batch API calls to determine if projects have 4D reconstructions
 */
export function useProjectReconstructionStatus(projects: Project[]) {
  const [statuses, setStatuses] = useState<Record<string, ProjectReconstructionStatus>>({});
  
  const checkAllProjects = useCallback(async () => {
    if (!projects || projects.length === 0) {
      setStatuses({});
      return;
    }

    const projectIds = projects.map(p => p.projectId);

    // Initialize loading states
    const initialStatuses: Record<string, ProjectReconstructionStatus> = {};
    projects.forEach(project => {
      initialStatuses[project.projectId] = {
        projectId: project.projectId,
        hasReconstructions: false,
        loading: true,
        error: null,
      };
    });
    setStatuses(initialStatuses);

    try {
      console.log('[ReconstructionStatus] Batch checking reconstruction status for projects:', projectIds);
      
      // Single batch API call instead of multiple individual calls
      const response = await reconstructionApi.batchReconstructionStatus(projectIds);
      
      if (!response.success || !response.statuses) {
        throw new Error(response.message || 'Failed to check reconstruction status');
      }

      // Update all statuses at once
      const updatedStatuses: Record<string, ProjectReconstructionStatus> = {};
      Object.entries(response.statuses).forEach(([projectId, status]) => {
        const statusData = status as { hasReconstructions: boolean; reconstructionCount: number };
        updatedStatuses[projectId] = {
          projectId,
          hasReconstructions: statusData.hasReconstructions,
          reconstructionCount: statusData.reconstructionCount,
          loading: false,
          error: null,
        };
      });

      console.log('[ReconstructionStatus] Batch check completed:', {
        total: projectIds.length,
        withReconstructions: Object.values(updatedStatuses).filter(s => s.hasReconstructions).length
      });

      setStatuses(updatedStatuses);

    } catch (error) {
      console.error('[ReconstructionStatus] Batch check failed:', error);
      
      // Set error state for all projects
      const errorStatuses: Record<string, ProjectReconstructionStatus> = {};
      projectIds.forEach(projectId => {
        errorStatuses[projectId] = {
          projectId,
          hasReconstructions: false,
          loading: false,
          error: error instanceof Error ? error.message : "Failed to check reconstruction status",
        };
      });
      
      setStatuses(errorStatuses);
    }
  }, [projects]);

  useEffect(() => {
    checkAllProjects();
  }, [checkAllProjects]);

  return {
    statuses,
    refresh: checkAllProjects,
    isLoading: Object.values(statuses).some(status => status.loading),
  };
}

/**
 * Simplified hook for checking a single project's reconstruction status
 */
export function useSingleProjectReconstructionStatus(projectId: string) {
  const [status, setStatus] = useState<ProjectReconstructionStatus>({
    projectId,
    hasReconstructions: false,
    loading: true,
    error: null,
  });

  const checkStatus = useCallback(async () => {
    setStatus(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const response = await reconstructionApi.getReconstructionResults(projectId);
      const hasReconstructions = response.success && Array.isArray(response.reconstructions) && response.reconstructions.length > 0;
      const reconstructionCount = hasReconstructions ? response.reconstructions.length : 0;
      
      setStatus({
        projectId,
        hasReconstructions,
        reconstructionCount,
        loading: false,
        error: null,
      });
    } catch (error) {
      setStatus({
        projectId,
        hasReconstructions: false,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to check reconstruction status",
      });
    }
  }, [projectId]);

  useEffect(() => {
    if (projectId) {
      checkStatus();
    }
  }, [checkStatus, projectId]);

  return {
    status,
    refresh: checkStatus,
  };
}
