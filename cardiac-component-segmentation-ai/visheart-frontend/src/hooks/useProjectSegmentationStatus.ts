"use client";

import { useState, useCallback, useEffect } from 'react';
import { segmentationApi } from '@/lib/api';
import { Project } from '@/types/dashboard';

export interface ProjectSegmentationStatus {
  projectId: string;
  hasMasks: boolean;
  loading: boolean;
  error: string | null;
}

/**
 * Hook to efficiently check segmentation status for multiple projects
 * Uses batch API calls to determine if projects have segmentation masks
 */
export function useProjectSegmentationStatus(projects: Project[]) {
  const [statuses, setStatuses] = useState<Record<string, ProjectSegmentationStatus>>({});
  
  const checkAllProjects = useCallback(async () => {
    if (!projects || projects.length === 0) {
      setStatuses({});
      return;
    }

    const projectIds = projects.map(p => p.projectId);

    // Initialize loading states
    const initialStatuses: Record<string, ProjectSegmentationStatus> = {};
    projects.forEach(project => {
      initialStatuses[project.projectId] = {
        projectId: project.projectId,
        hasMasks: false,
        loading: true,
        error: null,
      };
    });
    setStatuses(initialStatuses);

    try {
      console.log('[SegmentationStatus] Batch checking segmentation status for projects:', projectIds);
      
      // Single batch API call instead of multiple individual calls
      const response = await segmentationApi.batchSegmentationStatus(projectIds);
      
      if (!response.success || !response.statuses) {
        throw new Error(response.message || 'Failed to check segmentation status');
      }

      // Update all statuses at once
      const updatedStatuses: Record<string, ProjectSegmentationStatus> = {};
      Object.entries(response.statuses).forEach(([projectId, status]) => {
        const statusData = status as { hasMasks: boolean; maskCount: number };
        updatedStatuses[projectId] = {
          projectId,
          hasMasks: statusData.hasMasks,
          loading: false,
          error: null,
        };
      });

      console.log('[SegmentationStatus] Batch check completed:', {
        total: projectIds.length,
        withMasks: Object.values(updatedStatuses).filter(s => s.hasMasks).length
      });

      setStatuses(updatedStatuses);

    } catch (error) {
      console.error('[SegmentationStatus] Batch check failed:', error);
      
      // Set error state for all projects
      const errorStatuses: Record<string, ProjectSegmentationStatus> = {};
      projectIds.forEach(projectId => {
        errorStatuses[projectId] = {
          projectId,
          hasMasks: false,
          loading: false,
          error: error instanceof Error ? error.message : "Failed to check segmentation status",
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
 * Simplified hook for checking a single project's segmentation status
 */
export function useSingleProjectSegmentationStatus(projectId: string) {
  const [status, setStatus] = useState<ProjectSegmentationStatus>({
    projectId,
    hasMasks: false,
    loading: true,
    error: null,
  });

  const checkStatus = useCallback(async () => {
    setStatus(prev => ({ ...prev, loading: true, error: null }));
    
    try {
      const response = await segmentationApi.getSegmentationResults(projectId);
      const hasMasks = response.success && Array.isArray(response.segmentations) && response.segmentations.length > 0;
      
      setStatus({
        projectId,
        hasMasks,
        loading: false,
        error: null,
      });
    } catch (error) {
      setStatus({
        projectId,
        hasMasks: false,
        loading: false,
        error: error instanceof Error ? error.message : "Failed to check segmentation status",
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
