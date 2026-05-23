"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { useProject } from "@/context/ProjectContext";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// API
import { projectApi, segmentationApi, reconstructionApi } from "@/lib/api";
import { useGpuStatus } from "@/lib/dashboard-hooks";

// UI Components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

// Icons
import { 
  Play, 
  Eye, 
  Edit, 
  Save, 
  X, 
  RefreshCw, 
  Database, 
  CheckCircle, 
  XCircle, 
  Clock, 
  AlertCircle, 
  Image as ImageIcon, 
  Activity, 
  Layers, 
  Sparkles,
  Box,
  Crosshair,
  ChevronRight,
  Trash2
} from "lucide-react";

// Custom components
import { NoProjectFound } from "@/components/project/NoProjectFound";
import { ErrorProject } from "@/components/project/ErrorProject";
import { LoadingProject } from "@/components/project/LoadingProject";
import { ShowForUser, ShowForRegisteredUser } from "@/components/RoleGuard";
import { AffineMatrixDisplay } from "@/components/ui/AffineMatrixDisplay";
import { ReconstructionConfigDialog, ReconstructionConfig } from "@/components/reconstruction/ReconstructionConfigDialog";

// Types
import * as ProjectTypes from "@/types/project";

const ACTIVE_JOB_STALE_MS = 30 * 60 * 1000;

const isActiveRecentJob = (job: ProjectTypes.UserJob): boolean => {
  if (job.status !== ProjectTypes.JobStatus.PENDING && job.status !== ProjectTypes.JobStatus.IN_PROGRESS) {
    return false;
  }

  const lastUpdate = job.updatedAt || job.createdAt;
  if (!lastUpdate) {
    return true;
  }

  const lastUpdateTime = new Date(lastUpdate).getTime();
  if (Number.isNaN(lastUpdateTime)) {
    return true;
  }

  return Date.now() - lastUpdateTime < ACTIVE_JOB_STALE_MS;
};

const isActiveSegmentationJob = isActiveRecentJob;
const isActiveReconstructionJob = isActiveRecentJob;

function ProjectPageInner() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlight = searchParams.get("highlight"); // "reconstruction" | "landmark" | "segmentation" | null
  const { loading, projectData, error, hasMasks, undecodedMasks, jobs, reconstructionJobs, jobsError, refreshMasks, refreshJobs, refreshReconstructionJobs, hasReconstructions, reconstructionMetadata, reconstructionResults, reconstructionsByModel, refreshReconstructions, clearProjectCache, clearReconstructionCache } = useProject();
  // Glow "Start AI Segmentation" when there are no masks and no active jobs
  const glowStartSegmentation = loading === "done" && !hasMasks && (jobs ?? []).filter(j => j.status === ProjectTypes.JobStatus.PENDING || j.status === ProjectTypes.JobStatus.IN_PROGRESS).length === 0;

  // Glow "Edit Segmentation Masks" when masks just finished processing on this page
  // (hasMasks flipped true while user was here) OR via ?highlight=segmentation URL param
  const [glowEditMasks, setGlowEditMasks] = useState(false);
  const prevHadMasksRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (loading !== "done") return;
    const prev = prevHadMasksRef.current;
    // Only glow when masks transition from absent → present (segmentation just finished)
    if (prev === false && hasMasks) {
      setGlowEditMasks(true);
    }
    prevHadMasksRef.current = hasMasks;
  }, [hasMasks, loading]);
  // Also honor URL param on initial load
  useEffect(() => {
    if (highlight === "segmentation") setGlowEditMasks(true);
  }, [highlight]);
  const { processingUnit } = useGpuStatus();

  // Update page title dynamically
  useEffect(() => {
    if (projectData?.name) {
      document.title = `VisHeart | ${projectData.name}`;
    } else {
      document.title = "VisHeart | Project";
    }
    
    return () => {
      document.title = "VisHeart";
    };
  }, [projectData?.name]);

  // Local state for editing
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [editedDescription, setEditedDescription] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Segmentation state
  const [isStartingSegmentation, setIsStartingSegmentation] = useState(false);
  const [segmentationError, setSegmentationError] = useState<string | null>(null);

  // Revert to AI state
  const [revertDialogOpen, setRevertDialogOpen] = useState(false);
  const [isReverting, setIsReverting] = useState(false);

  // Reconstruction state
  const [showReconstructionDialog, setShowReconstructionDialog] = useState(false);
  const [isStartingReconstruction, setIsStartingReconstruction] = useState(false);
  const [reconstructionError, setReconstructionError] = useState<string | null>(null);
  const [isDeletingReconstruction, setIsDeletingReconstruction] = useState(false);
  const [deleteReconstructionDialogOpen, setDeleteReconstructionDialogOpen] = useState(false);

  // Per-model reconstruction state
  const [selectedModelForCreation, setSelectedModelForCreation] = useState<"medsam" | "unet" | null>(null);
  const [selectedReconstructionForDeletion, setSelectedReconstructionForDeletion] = useState<any | null>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [deleteModelDialogOpen, setDeleteModelDialogOpen] = useState(false);

  // Reconstruction-source model availability — mirrors the segmentation
  // page's `inferDocModel` so a doc whose explicit `segmentationModel`
  // field was lost still resolves via name pattern. Only EDITABLE
  // (`isMedSAMOutput === false`) docs count, because reconstruction
  // consumes user-refined masks. Returns up to two entries — one per
  // model that has a usable editable mask in this project.
  const availableReconstructionModels = useMemo<Array<"medsam" | "unet">>(() => {
    if (!undecodedMasks || undecodedMasks.length === 0) return [];
    const inferDocModel = (m: any): "medsam" | "unet" | null => {
      const name = ((m?.name || "") + "").toLowerCase();
      if (name.includes("unet")) return "unet";
      if (name.includes("medsam")) return "medsam";
      // Do not guess "medsam" for generic names — they predate per-model tagging
      // and could belong to UNet on CPU environments.
      const tag = ((m?.segmentationModel || m?.model_used || "") + "").toLowerCase();
      if (tag === "medsam" || tag === "unet") return tag;
      return null;
    };
    const found = new Set<"medsam" | "unet">();
    for (const m of undecodedMasks) {
      if ((m as any).isMedSAMOutput !== false) continue; // editable only
      const resolved = inferDocModel(m);
      if (resolved) found.add(resolved);
    }
    return Array.from(found);
  }, [undecodedMasks]);

  // Default the dialog's model selection to whatever the user picked
  // most recently on the segmentation page (sessionStorage), but only
  // if that model actually has a cached editable mask. Otherwise fall
  // back to the first available model (handled in the dialog itself).
  const defaultReconstructionModel = useMemo<"medsam" | "unet" | undefined>(() => {
    if (!projectId) return undefined;
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(`selectedModel_${projectId}`);
    } catch {
      // ignore storage read errors
    }
    const candidate = stored === "medsam" || stored === "unet" ? stored : undefined;
    if (candidate && availableReconstructionModels.includes(candidate)) {
      return candidate;
    }
    return availableReconstructionModels[0];
  }, [projectId, availableReconstructionModels]);

  // Delete state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Local project data (for optimistic updates after editing)
  const [localProjectName, setLocalProjectName] = useState<string | null>(null);
  const [localProjectDescription, setLocalProjectDescription] = useState<string | null>(null);

  // Polling state
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconstructionPollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Helper function to check if we should poll for masks
  const shouldPollForMasks = useCallback((): boolean => {
    // Poll if: no masks exist AND there are jobs (indicating segmentation might be in progress)
    return !hasMasks && jobs !== null && jobs.length > 0 && loading === "done";
  }, [hasMasks, jobs, loading]);

  // Polling effect - check for masks every 1 minute when conditions are met
  useEffect(() => {
    const startPolling = () => {
      if (shouldPollForMasks()) {
        console.log("[Project] Starting mask polling - no masks found but jobs exist");

        pollIntervalRef.current = setInterval(async () => {
          if (shouldPollForMasks()) {
            console.log("[Project] Polling for masks...");
            try {
              await refreshMasks();
            } catch (error) {
              console.error("[Project] Error during mask polling:", error);
            }
          } else {
            // Stop polling if conditions no longer met
            if (pollIntervalRef.current) {
              console.log("[Project] Stopping mask polling - masks found or no jobs");
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
          }
        }, 5000); // Poll every 5 seconds
      }
    };

    const stopPolling = () => {
      if (pollIntervalRef.current) {
        console.log("[Project] Stopping mask polling");
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };

    // Start or stop polling based on conditions
    if (shouldPollForMasks()) {
      startPolling();
    } else {
      stopPolling();
    }

    // Cleanup function
    return () => {
      stopPolling();
    };
  }, [shouldPollForMasks, refreshMasks]);

  // Helper function to check if we should poll for reconstructions
  const shouldPollForReconstructions = useCallback((): boolean => {
    // Poll while any active reconstruction job exists, even if one model already has a reconstruction.
    return reconstructionJobs !== null && reconstructionJobs.some(isActiveReconstructionJob) && loading === "done";
  }, [reconstructionJobs, loading]);

  // Polling effect - check for reconstructions every 1 minute when conditions are met
  useEffect(() => {
    const startPolling = () => {
      if (shouldPollForReconstructions()) {
        console.log("[Project] Starting reconstruction polling - no reconstructions found but jobs exist");

        reconstructionPollIntervalRef.current = setInterval(async () => {
          if (shouldPollForReconstructions()) {
            console.log("[Project] Polling for reconstructions...");
            try {
              await refreshReconstructions();
            } catch (error) {
              console.error("[Project] Error during reconstruction polling:", error);
            }
          } else {
            // Stop polling if conditions no longer met
            if (reconstructionPollIntervalRef.current) {
              console.log("[Project] Stopping reconstruction polling - reconstructions found or no jobs");
              clearInterval(reconstructionPollIntervalRef.current);
              reconstructionPollIntervalRef.current = null;
            }
          }
        }, 5000); // Poll every 5 seconds
      }
    };

    const stopPolling = () => {
      if (reconstructionPollIntervalRef.current) {
        console.log("[Project] Stopping reconstruction polling");
        clearInterval(reconstructionPollIntervalRef.current);
        reconstructionPollIntervalRef.current = null;
      }
    };

    // Start or stop polling based on conditions
    if (shouldPollForReconstructions()) {
      startPolling();
    } else {
      stopPolling();
    }

    // Cleanup function
    return () => {
      stopPolling();
    };
  }, [shouldPollForReconstructions, refreshReconstructions]);

  // Check if there are any active jobs (memoized for use in effects)
  const hasActiveJobs = useMemo(() => 
    (jobs || []).some(isActiveSegmentationJob),
    [jobs]
  );

  // Check if there are any active reconstruction jobs (memoized for use in effects)
  const hasActiveReconstructionJobs = useMemo(() => 
    (reconstructionJobs || []).some(isActiveReconstructionJob),
    [reconstructionJobs]
  );

  // Clear starting state when segmentation jobs appear
  useEffect(() => {
    if (isStartingSegmentation && hasActiveJobs) {
      console.log("[Project] Segmentation job detected - clearing starting state");
      setIsStartingSegmentation(false);
    }
  }, [isStartingSegmentation, hasActiveJobs]);

  // Clear starting state when reconstruction jobs appear
  useEffect(() => {
    if (isStartingReconstruction && hasActiveReconstructionJobs) {
      console.log("[Project] Reconstruction job detected - clearing starting state");
      setIsStartingReconstruction(false);
    }
  }, [isStartingReconstruction, hasActiveReconstructionJobs]);

  // Debug logging for reconstruction jobs state changes
  useEffect(() => {
    console.log("[Project] Reconstruction jobs state changed:", {
      reconstructionJobs,
      hasActiveReconstructionJobs,
      isStartingReconstruction
    });
  }, [reconstructionJobs, hasActiveReconstructionJobs, isStartingReconstruction]);

  // Refresh reconstruction metadata when active reconstruction jobs finish.
  const prevHadActiveReconstructionJobsRef = useRef<boolean>(false);
  useEffect(() => {
    const prev = prevHadActiveReconstructionJobsRef.current;
    if (prev && !hasActiveReconstructionJobs) {
      refreshReconstructions().catch((err) => {
        console.warn("[Project] Failed to refresh reconstructions after job completion:", err);
      });
    }
    prevHadActiveReconstructionJobsRef.current = hasActiveReconstructionJobs;
  }, [hasActiveReconstructionJobs, refreshReconstructions]);

  const goToReconstructionViewer = useCallback((model?: "medsam" | "unet" | "unknown", reconstructionId?: string) => {
    const params = new URLSearchParams();
    if (model) {
      params.set("model", model);
    }
    if (reconstructionId) {
      params.set("reconstructionId", reconstructionId);
    }
    const query = params.toString();
    router.push(`/project/${projectId}/standalone-4d-viewer${query ? `?${query}` : ""}`);
  }, [projectId, router]);

  const handleOpenReconstruction = useCallback(() => {
    setReconstructionError(null);
    setSelectedModelForCreation(null);
    setShowReconstructionDialog(true);
  }, []);

  const reconstructionRows = useMemo(() => {
    const rowsSource =
      reconstructionResults && reconstructionResults.length > 0
        ? reconstructionResults
        : Object.values(reconstructionsByModel || {});
    const rows = rowsSource.filter(
      (recon: any) => !!recon?.reconstructionId // eslint-disable-line @typescript-eslint/no-explicit-any
    ) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any

    if (rows.length === 0 && reconstructionMetadata?.reconstructionId) {
      rows.push({
        ...reconstructionMetadata,
        segmentationModel: reconstructionMetadata.segmentationModel || "unknown",
      });
    }

    return rows.sort((a, b) => {
      const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      return bTime - aTime;
    });
  }, [reconstructionMetadata, reconstructionResults, reconstructionsByModel]);

  const existing4DModels = useMemo(() => {
    const models = new Set<"medsam" | "unet">();
    for (const reconstruction of reconstructionRows) {
      const normalized = ((reconstruction?.segmentationModel || "") + "").toLowerCase();
      if (normalized === "medsam" || normalized === "unet") {
        models.add(normalized);
      }
    }
    return models;
  }, [reconstructionRows]);

  const existing4DByModel = useMemo(() => {
    const map: Partial<Record<"medsam" | "unet", string>> = {};
    for (const reconstruction of reconstructionRows) {
      const normalized = ((reconstruction?.segmentationModel || "") + "").toLowerCase();
      if ((normalized === "medsam" || normalized === "unet") && reconstruction?.reconstructionId) {
        map[normalized] = reconstruction.reconstructionId;
      }
    }
    return map;
  }, [reconstructionRows]);

  // Missing projectId handling
  if (!projectId) return <NoProjectFound message="Project ID is missing." />;

  // Loading state
  if (loading !== "done") return <LoadingProject loadingStage={loading} />;

  // Error states
  if (error) return <ErrorProject error={error} />;

  if (!projectData) return <ErrorProject error="Project data not available" />;

  // Initialize edit fields when starting to edit
  const handleStartEdit = () => {
    setEditedName(currentProjectName);
    setEditedDescription(currentProjectDescription);
    setIsEditing(true);
    setUpdateError(null);
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedName("");
    setEditedDescription("");
    setUpdateError(null);
  };

  // Save project updates
  const handleSaveEdit = async () => {
    if (!editedName.trim()) {
      setUpdateError("Project name is required");
      return;
    }

    setIsUpdating(true);
    setUpdateError(null);

    // Store the new values for optimistic update
    const newName = editedName.trim();
    const newDescription = editedDescription.trim();

    // Optimistic update
    setLocalProjectName(newName);
    setLocalProjectDescription(newDescription);

    try {
      await projectApi.updateProject(projectId, newName, newDescription);

      // Success - exit editing mode
      setIsEditing(false);
      setEditedName("");
      setEditedDescription("");
      console.log("Project updated successfully");
    } catch (error: unknown) {
      console.error("Error updating project:", error);

      // Error - revert the optimistic update
      setLocalProjectName(projectData.name);
      setLocalProjectDescription(projectData.description || "");

      setUpdateError((error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to update project");
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle delete project
  const handleDeleteProject = () => {
    setDeleteDialogOpen(true);
  };

  // Confirm delete project
  const confirmDeleteProject = async () => {
    setIsDeleting(true);
    try {
      await projectApi.deleteProject(projectId);
      await clearProjectCache();
      await clearReconstructionCache();
      // Success - redirect to dashboard
      router.push("/dashboard");
    } catch (error) {
      console.error("Error deleting project:", error);
      alert("Failed to delete project. Please try again.");
      setDeleteDialogOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  // Start segmentation
  const handleStartSegmentation = async () => {
    setIsStartingSegmentation(true);
    setSegmentationError(null);

    try {
      console.log('[Project] Start segmentation button clicked - current jobs state:', { jobs });
      console.log('[Project] jobsError:', jobsError);

      // CPU-safe default: only choose MedSAM when GPU is explicitly online.
      const detectedMode = processingUnit.gpuAvailable ? "gpu" : "cpu";
      const selectedModel: "medsam" | "unet" =
        detectedMode === "gpu" ? "medsam" : "unet";

      console.log("[Project] Start AI Segmentation mode/model:", {
        processingUnit,
        detectedMode,
        selectedModel,
      });

      await segmentationApi.startSegmentation(
        projectId,
        selectedModel,
        "auto"
      );
      
      // Wait a moment for the backend to create the job, then refresh
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Refresh jobs to detect the new segmentation job
      await refreshJobs();
      
      console.log("[Project] ✅ Segmentation job started successfully - polling will check for completion");
    } catch (error: unknown) {
      console.error("Error starting segmentation:", error);
      setSegmentationError((error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to start segmentation");
      setIsStartingSegmentation(false);
    }
  };

  // Handle revert to AI mask
  const handleRevertToAI = async () => {
    console.log("[Project] Reverting editable mask to AI-generated mask");
    setIsReverting(true);

    try {
      // 1. Find AI mask and editable mask
      const aiMask = undecodedMasks?.find(mask => mask.isMedSAMOutput === true);
      const editableMask = undecodedMasks?.find(mask => mask.isMedSAMOutput === false);

      if (!aiMask || !editableMask) {
        console.error("[Project] Could not find AI or editable mask");
        alert("Could not find masks to revert. Please try again.");
        return;
      }

      // 2. Copy AI mask's frames to editable mask
      const revertData = {
        frames: aiMask.frames, // Full frame array with slices and RLE data
      };

      console.log("[Project] Copying AI mask frames to editable mask:", {
        aiMaskId: aiMask._id,
        editableMaskId: editableMask._id,
        frameCount: aiMask.frames?.length || 0,
      });

      // 3. Use existing saveManualSegmentation API
      await segmentationApi.saveManualSegmentation(projectId, revertData);

      console.log("[Project] ✅ Successfully reverted to AI mask");

      // 4. Reload window to show updated masks
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error: unknown) {
      console.error("[Project] ❌ Error reverting to AI mask:", error);
      alert(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message || 
        "Failed to revert to AI mask. Please try again."
      );
    } finally {
      setIsReverting(false);
      setRevertDialogOpen(false);
    }
  };

  // Handle start reconstruction
  const handleStartReconstruction = async (config: ReconstructionConfig) => {
    console.log("[Project] Starting 4D reconstruction with config:", config);

    if (existing4DModels.has(config.segmentationModel)) {
      const modelLabel = config.segmentationModel === "medsam" ? "MedSAM" : "UNet";
      setReconstructionError(`A 4D reconstruction already exists for ${modelLabel}. Delete it before creating a new one.`);
      return;
    }

    setSelectedModelForCreation(config.segmentationModel);

    setIsStartingReconstruction(true);
    setReconstructionError(null);

    try {
      await reconstructionApi.startReconstruction(projectId, {
        reconstructionName: `4D Cardiac Reconstruction (${config.segmentationModel.toUpperCase()}) - ${projectData.name}`,
        reconstructionDescription: `Generated via configuration wizard from ${config.segmentationModel.toUpperCase()} segmentation`,
        ed_frame: config.edFrame, // Pass 1-based ED frame from user selection
        export_format: config.exportFormat, // Pass user's format choice to backend
        // Tell the backend exactly which model's editable mask to consume.
        segmentationModel: config.segmentationModel,
        parameters: {
          num_iterations: config.numIterations,
          resolution: config.resolution,
          process_all_frames: true,
        },
      });

      console.log("[Project] ✅ Reconstruction job started successfully on backend");
      
      // Close dialog
      setShowReconstructionDialog(false);
      goToReconstructionViewer(config.segmentationModel);
      
      // Poll for the job to appear - retry up to 5 times with 1 second delay
      console.log("[Project] 🔄 Polling for reconstruction job to appear...");
      let jobFound = false;
      for (let i = 0; i < 5 && !jobFound; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log(`[Project] 🔍 Polling attempt ${i + 1}/5...`);
        
        await refreshReconstructionJobs();
        
        // Check if job appeared in the context
        // Note: We can't directly check reconstructionJobs here because state updates are async
        // The effect will handle clearing isStartingReconstruction when the job appears
      }
      
      console.log("[Project] ✅ Job polling complete - effect will clear loading state when job detected");
      
      // Keep showing loading state until the job appears
      // The loading state will be cleared by the effect when hasActiveReconstructionJobs becomes true
    } catch (error: unknown) {
      console.error("[Project] ❌ Error starting reconstruction:", error);
      setReconstructionError(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message || 
        "Failed to start reconstruction"
      );
      setIsStartingReconstruction(false);
    }
  };

  // Handle delete reconstructions
  const handleDeleteReconstructions = async () => {
    console.log("[Project] Deleting all reconstructions for project:", projectId);
    setIsDeletingReconstruction(true);

    try {
      const reconstructionApi = await import("@/lib/api").then(m => m.reconstructionApi);
      
      const result = await reconstructionApi.deleteProjectReconstructions(projectId);
      
      console.log("[Project] ✅ Reconstructions deleted successfully:", result);
      
      // Close dialog
      setDeleteReconstructionDialogOpen(false);
      
      // Refresh reconstructions to update UI
      await refreshReconstructions();
      
      // Reload page to update storage stats
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error: unknown) {
      console.error("[Project] ❌ Error deleting reconstructions:", error);
      alert(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message || 
        "Failed to delete reconstructions. Please try again."
      );
    } finally {
      setIsDeletingReconstruction(false);
    }
  };

  const handleDeleteModelReconstruction = async () => {
    if (!selectedReconstructionForDeletion?.reconstructionId) return;

    console.log("[Project] Deleting reconstruction:", selectedReconstructionForDeletion.reconstructionId);
    setIsDeletingReconstruction(true);

    try {
      const result = await reconstructionApi.deleteReconstruction(
        projectId,
        selectedReconstructionForDeletion.reconstructionId
      );

      console.log("[Project] Reconstruction deleted successfully:", result);
      setDeleteModelDialogOpen(false);
      setSelectedReconstructionForDeletion(null);
      await refreshReconstructions();
    } catch (error: unknown) {
      console.error("[Project] ❌ Error deleting model reconstruction:", error);
      alert(
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        "Failed to delete reconstruction. Please try again."
      );
    } finally {
      setIsDeletingReconstruction(false);
    }
  };

  // Get job statistics
  const jobCounts = (jobs || []).reduce(
    (acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    },
    {} as Record<ProjectTypes.JobStatus, number>,
  );

  // Get editable mask (the one users interact with)
  const editableMask = undecodedMasks?.find((mask) => !mask.isMedSAMOutput);
  const maskIsSaved = editableMask?.isSaved || false;

  // Use local state if available (for optimistic updates), otherwise use project data
  const currentProjectName = localProjectName !== null ? localProjectName : projectData.name;
  const currentProjectDescription = localProjectDescription !== null ? localProjectDescription : projectData.description || "";

  const formatReconstructionModel = (model: unknown) => {
    const normalized = (model ?? "").toString().toLowerCase();
    if (normalized === "medsam") return "MedSAM";
    if (normalized === "unet") return "UNet";
    return "Legacy / Unknown";
  };

  const formatDateTime = (value?: string) => {
    if (!value) return "N/A";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "N/A";
    return date.toLocaleString();
  };

  const formatFileSize = (value?: number) => {
    if (!value) return "N/A";
    return `${(value / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Header Section */}
      <div className="border-b bg-gradient-to-r from-background via-muted/20 to-background">
        <div className="container mx-auto px-6 py-8">
          <Button 
            variant="ghost" 
            onClick={() => router.push("/dashboard")} 
            className="mb-4 -ml-2"
          >
            ← Back to Dashboard
          </Button>
          
          <div className="flex items-start justify-between">
            {/* Project Title & Info */}
            <div className="flex items-start gap-6">
              <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-red-500/20 to-pink-500/20 flex items-center justify-center border-2 border-red-500/30">
                <Database className="h-8 w-8 text-red-500" />
              </div>
              
              <div className="space-y-2">
                {isEditing ? (
                  <div className="space-y-2">
                    <Input 
                      value={editedName} 
                      onChange={(e) => setEditedName(e.target.value)} 
                      placeholder="Project name" 
                      className="text-2xl font-bold h-12"
                    />
                    {updateError && (
                      <Alert variant="destructive" className="w-fit">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{updateError}</AlertDescription>
                      </Alert>
                    )}
                  </div>
                ) : (
                  <h1 className="text-4xl font-bold tracking-tight">{currentProjectName}</h1>
                )}
                
                {isEditing ? (
                  <Textarea 
                    value={editedDescription} 
                    onChange={(e) => setEditedDescription(e.target.value)} 
                    placeholder="Project description (optional)" 
                    rows={2}
                    className="resize-none text-sm"
                  />
                ) : (
                  <p className="text-muted-foreground max-w-2xl">
                    {currentProjectDescription || "No description provided."}
                  </p>
                )}
                
                <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
                  <span className="font-mono">{projectId}</span>
                  <Separator orientation="vertical" className="h-3" />
                  <span>{projectData.dimensions?.frames || 0} frames</span>
                  <span>·</span>
                  <span>{projectData.dimensions?.slices || 0} slices</span>
                  <span>·</span>
                  <span>{(projectData.filesize / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              </div>
            </div>

            {/* Edit Controls */}
            <ShowForRegisteredUser>
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleCancelEdit} disabled={isUpdating}>
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveEdit} disabled={isUpdating || !editedName.trim()}>
                    {isUpdating ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    {isUpdating ? "Saving..." : "Save"}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={handleStartEdit}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={handleDeleteProject}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                </div>
              )}
            </ShowForRegisteredUser>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8 space-y-6">
        {/* Compact Processing Pipeline */}
        <div className="bg-muted/30 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Activity className="h-4 w-4" />
              <span>Progress</span>
            </div>
            <div className="flex items-center gap-4">
              {/* Step 1: Dataset */}
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-green-100 dark:bg-green-950/30 border border-green-500 flex items-center justify-center">
                  <Database className="h-4 w-4 text-green-600" />
                </div>
                <div className="hidden sm:block">
                  <p className="text-xs font-medium">Dataset</p>
                  <p className="text-xs text-muted-foreground">Complete</p>
                </div>
              </div>

              <ChevronRight className="h-4 w-4 text-muted-foreground" />

              {/* Step 2: Segmentation */}
              <div className="flex items-center gap-2">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center border ${
                  hasMasks 
                    ? 'bg-green-100 dark:bg-green-950/30 border-green-500' 
                    : hasActiveJobs
                    ? 'bg-blue-100 dark:bg-blue-950/30 border-blue-500 animate-pulse'
                    : 'bg-muted border-muted-foreground/30'
                }`}>
                  <Layers className={`h-4 w-4 ${
                    hasMasks ? 'text-green-600' : hasActiveJobs ? 'text-blue-600' : 'text-muted-foreground'
                  }`} />
                </div>
                <div className="hidden sm:block">
                  <p className="text-xs font-medium">Segmentation</p>
                  <p className="text-xs text-muted-foreground">
                    {hasMasks ? 'Complete' : hasActiveJobs ? 'Processing' : 'Pending'}
                  </p>
                </div>
              </div>

              <ChevronRight className="h-4 w-4 text-muted-foreground" />

              {/* Step 3: Reconstruction */}
              <div className="flex items-center gap-2">
                <div className={`h-8 w-8 rounded-full flex items-center justify-center border ${
                  hasReconstructions 
                    ? 'bg-green-100 dark:bg-green-950/30 border-green-500' 
                    : hasActiveReconstructionJobs
                    ? 'bg-blue-100 dark:bg-blue-950/30 border-blue-500 animate-pulse'
                    : hasMasks
                    ? 'bg-amber-100 dark:bg-amber-950/30 border-amber-500'
                    : 'bg-muted border-muted-foreground/30'
                }`}>
                  <Box className={`h-4 w-4 ${
                    hasReconstructions ? 'text-green-600' : hasActiveReconstructionJobs ? 'text-blue-600' : hasMasks ? 'text-amber-600' : 'text-muted-foreground'
                  }`} />
                </div>
                <div className="hidden sm:block">
                  <p className="text-xs font-medium">4D Model</p>
                  <p className="text-xs text-muted-foreground">
                    {hasReconstructions ? 'Complete' : hasActiveReconstructionJobs ? 'Processing' : hasMasks ? 'Available' : 'Locked'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Left Column - Main Actions */}
          <div className="xl:col-span-2 space-y-6">
            
            {/* STATE 1: No Masks, No Reconstructions - Get Started */}
            {!hasMasks && !hasReconstructions && (
              <Card className="border-2 border-primary/20">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Play className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle>Get Started</CardTitle>
                      <p className="text-sm text-muted-foreground">Begin processing your cardiac imaging data</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <TooltipProvider>
                    <div className="grid gap-3">
                      {/* Preview Action */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild variant="outline" size="lg" className="justify-start h-auto py-4">
                            <Link href={`/project/${projectId}/preview`}>
                              <div className="flex items-center gap-3 w-full">
                                <Eye className="h-5 w-5 text-muted-foreground" />
                                <div className="text-left flex-1">
                                  <p className="font-semibold">Preview Dataset</p>
                                  <p className="text-xs text-muted-foreground">View your MRI images before processing</p>
                                </div>
                              </div>
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Browse through all frames and slices of your dataset</p>
                        </TooltipContent>
                      </Tooltip>

                      {/* Start Segmentation Action */}
                      <ShowForUser fallback={null}>
                        {hasActiveJobs ? (
                          <Button disabled variant="secondary" size="lg" className="justify-start h-auto py-4">
                            <div className="flex items-center gap-3 w-full">
                              <RefreshCw className="h-5 w-5 animate-spin" />
                              <div className="text-left flex-1">
                                <p className="font-semibold">Segmentation in Progress</p>
                                <p className="text-xs text-muted-foreground">Check the Processing Jobs panel for updates</p>
                              </div>
                            </div>
                          </Button>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                onClick={handleStartSegmentation}
                                disabled={isStartingSegmentation}
                                size="lg"
                                className={`justify-start h-auto py-4 transition-all duration-300 ${glowStartSegmentation || highlight === "segmentation-start" ? "ring-2 ring-primary ring-offset-2 animate-pulse shadow-lg shadow-primary/30" : ""}`}
                              >
                                <div className="flex items-center gap-3 w-full">
                                  {isStartingSegmentation ? (
                                    <RefreshCw className="h-5 w-5 animate-spin" />
                                  ) : (
                                    <Sparkles className="h-5 w-5" />
                                  )}
                                  <div className="text-left flex-1">
                                    <p className="font-semibold">
                                      {isStartingSegmentation ? 'Starting Segmentation...' : 'Start AI Segmentation'}
                                    </p>
                                    <p className="text-xs opacity-90">
                                      Generate cardiac segmentation masks automatically
                                    </p>
                                  </div>
                                </div>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Uses AI to automatically detect and segment cardiac structures</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </ShowForUser>
                    </div>
                  </TooltipProvider>

                  {segmentationError && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{segmentationError}</AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}

            {/* STATE 2: Has Masks, No Reconstructions - Refine & Reconstruct */}
            {hasMasks && !hasReconstructions && (
              <Card className="border-2 border-green-500/20">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <CardTitle>Segmentation Complete</CardTitle>
                      <p className="text-sm text-muted-foreground">Refine your masks or create 3D models</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <TooltipProvider>
                    <div className="grid gap-3">
                      {/* Preview Dataset */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild variant="outline" size="lg" className="justify-start h-auto py-4">
                            <Link href={`/project/${projectId}/preview`}>
                              <div className="flex items-center gap-3 w-full">
                                <Eye className="h-5 w-5 text-muted-foreground" />
                                <div className="text-left flex-1">
                                  <p className="font-semibold">Preview Dataset</p>
                                  <p className="text-xs text-muted-foreground">View raw MRI images without masks. Optimized for quick previewing and navigation.</p>
                                </div>
                              </div>
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Browse through all frames and slices of your dataset</p>
                        </TooltipContent>
                      </Tooltip>

                      {/* Edit Segmentation */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild size="lg" variant={glowEditMasks ? "default" : "outline"} className={`justify-start h-auto py-4 transition-all duration-300 ${glowEditMasks ? "animate-pulse shadow-lg" : ""}`}>
                            <Link href={`/project/${projectId}/segmentation`}>
                              <div className="flex items-center gap-3 w-full">
                                <Edit className="h-5 w-5 text-primary" />
                                <div className="text-left flex-1">
                                  <p className="font-semibold">Edit Segmentation Masks</p>
                                  <p className="text-xs text-muted-foreground">
                                    Refine with brush tools and manual adjustments
                                  </p>
                                </div>
                              </div>
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Manually adjust and refine AI-generated segmentation masks</p>
                        </TooltipContent>
                      </Tooltip>

                      {/* Landmark Detection */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild size="lg" variant={highlight === "landmark" ? "default" : "outline"} className={`justify-start h-auto py-4 transition-all duration-300 ${highlight === "landmark" ? "animate-pulse shadow-lg" : ""}`}>
                            <Link href={`/project/${projectId}/landmark-detection`}>
                              <div className="flex items-center gap-3 w-full">
                                <Crosshair className="h-5 w-5 text-primary" />
                                <div className="text-left flex-1">
                                  <p className="font-semibold">Landmark Detection</p>
                                  <p className="text-xs text-muted-foreground">
                                    Detect landmarks, preview strain, and export reports
                                  </p>
                                </div>
                              </div>
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Run landmark detection, view strain previews, and export a PDF report</p>
                        </TooltipContent>
                      </Tooltip>

                      {/* Start Reconstruction */}
                      {hasActiveReconstructionJobs ? (
                        <Button disabled variant="secondary" size="lg" className="justify-start h-auto py-4">
                          <div className="flex items-center gap-3 w-full">
                            <RefreshCw className="h-5 w-5 animate-spin" />
                            <div className="text-left flex-1">
                              <p className="font-semibold">Reconstruction in Progress</p>
                              <p className="text-xs text-muted-foreground">Your 4D model is being generated - this may take several minutes</p>
                            </div>
                          </div>
                        </Button>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              onClick={() => handleOpenReconstruction()}
                              size="lg"
                              variant={highlight === "reconstruction" ? "default" : "outline"}
                              className={`justify-start h-auto py-4 transition-all duration-300 ${highlight === "reconstruction" ? "animate-pulse shadow-lg" : ""}`}
                              disabled={isStartingReconstruction}
                            >
                              <div className="flex items-center gap-3 w-full">
                                {isStartingReconstruction ? (
                                  <RefreshCw className="h-5 w-5 animate-spin" />
                                ) : (
                                  <Sparkles className="h-5 w-5" />
                                )}
                                <div className="text-left flex-1">
                                  <p className="font-semibold">
                                    {isStartingReconstruction 
                                      ? 'Starting Reconstruction...' 
                                      : 'Create 4D Reconstruction'}
                                  </p>
                                  <p className="text-xs opacity-90">
                                    Generate model-scoped 4D meshes from segmentation
                                  </p>
                                </div>
                              </div>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Build animated 4D cardiac models for visualization and analysis</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </TooltipProvider>

                  {reconstructionError && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{reconstructionError}</AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}

            {/* STATE 3: Has Masks AND Reconstructions - Full Pipeline Complete */}
            {hasMasks && hasReconstructions && (
              <Card className="border-2 border-blue-500/20">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <Box className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <CardTitle>Pipeline Complete</CardTitle>
                      <p className="text-sm text-muted-foreground">All processing stages finished</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <TooltipProvider>
                    <div className="grid gap-3">
                      {/* Preview Dataset */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild variant="outline" size="lg" className="justify-start h-auto py-4">
                            <Link href={`/project/${projectId}/preview`}>
                              <div className="flex items-center gap-3 w-full">
                                <Eye className="h-5 w-5 text-muted-foreground" />
                                <div className="text-left flex-1">
                                  <p className="font-semibold">Preview Dataset</p>
                                  <p className="text-xs text-muted-foreground">View raw MRI images without masks</p>
                                </div>
                              </div>
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Browse through all frames and slices of your dataset</p>
                        </TooltipContent>
                      </Tooltip>

                      {/* Edit Segmentation */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild size="lg" variant={glowEditMasks ? "default" : "outline"} className={`justify-start h-auto py-4 transition-all duration-300 ${glowEditMasks ? "animate-pulse shadow-lg" : ""}`}>
                            <Link href={`/project/${projectId}/segmentation`}>
                              <div className="flex items-center gap-3 w-full">
                                <Edit className="h-5 w-5 text-primary" />
                                <div className="text-left flex-1">
                                  <p className="font-semibold">Edit Segmentation Masks</p>
                                  <p className="text-xs text-muted-foreground">
                                    Refine and update segmentation data
                                  </p>
                                </div>
                              </div>
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Update masks to regenerate 3D models</p>
                        </TooltipContent>
                      </Tooltip>

                      {/* Landmark Detection */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button asChild size="lg" variant={highlight === "landmark" ? "default" : "outline"} className={`justify-start h-auto py-4 transition-all duration-300 ${highlight === "landmark" ? "animate-pulse shadow-lg" : ""}`}>
                            <Link href={`/project/${projectId}/landmark-detection`}>
                              <div className="flex items-center gap-3 w-full">
                                <Crosshair className="h-5 w-5 text-primary" />
                                <div className="text-left flex-1">
                                  <p className="font-semibold">Landmark Detection</p>
                                  <p className="text-xs text-muted-foreground">
                                    Detect landmarks, preview strain, and export reports
                                  </p>
                                </div>
                              </div>
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Run landmark detection, view strain previews, and export a PDF report</p>
                        </TooltipContent>
                      </Tooltip>

                      {/* Start Reconstruction */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            onClick={() => handleOpenReconstruction()}
                            size="lg"
                            variant="outline"
                            className={`justify-start h-auto py-4 transition-all duration-300 ${highlight === "reconstruction" ? "ring-2 ring-primary ring-offset-2 animate-pulse shadow-lg shadow-primary/30" : ""}`}
                            disabled={isStartingReconstruction}
                          >
                            <div className="flex items-center gap-3 w-full">
                              {isStartingReconstruction ? (
                                <RefreshCw className="h-5 w-5 animate-spin" />
                              ) : (
                                <Sparkles className="h-5 w-5" />
                              )}
                              <div className="text-left flex-1">
                                <p className="font-semibold">
                                  {isStartingReconstruction ? "Starting Reconstruction..." : "Create 4D Reconstruction"}
                                </p>
                                <p className="text-xs opacity-90">Generate model-scoped 4D meshes from segmentation</p>
                              </div>
                            </div>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Build animated 4D cardiac models for visualization and analysis</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </TooltipProvider>
                </CardContent>
              </Card>
            )}

            {/* Technical Specifications - Always Visible, Redesigned */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
                  Dataset Information
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* Dimensions */}
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Dimensions</p>
                    <p className="text-sm font-mono">
                      {projectData.dimensions?.width} × {projectData.dimensions?.height}
                    </p>
                  </div>
                  
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Frames</p>
                    <p className="text-sm font-semibold">{projectData.dimensions?.frames || 0}</p>
                  </div>
                  
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Slices</p>
                    <p className="text-sm font-semibold">{projectData.dimensions?.slices || 0}</p>
                  </div>
                  
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">File Size</p>
                    <p className="text-sm font-semibold">{(projectData.filesize / 1024 / 1024).toFixed(2)} MB</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Voxel X</p>
                    <p className="text-sm font-mono">{projectData.voxelsize?.x || 0} mm</p>
                  </div>
                  
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Voxel Y</p>
                    <p className="text-sm font-mono">{projectData.voxelsize?.y || 0} mm</p>
                  </div>
                  
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Voxel Z</p>
                    <p className="text-sm font-mono">{projectData.voxelsize?.z || 0} mm</p>
                  </div>
                  
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Temporal</p>
                    <p className="text-sm font-mono">{projectData.voxelsize?.t || 0} ms</p>
                  </div>
                </div>

                <Separator className="my-4" />

                {/* Affine Matrix - Collapsible */}
                <AffineMatrixDisplay 
                  affineMatrix={projectData.affineMatrix} 
                  compact={true}
                  title="Spatial Transform Matrix"
                />
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Status Panels */}
          <div className="space-y-6">
            {/* Masks Section - Redesigned */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    Segmentation
                  </CardTitle>
                  {hasMasks && (
                    <Badge variant={maskIsSaved ? "default" : "secondary"}>
                      {maskIsSaved ? "Saved" : "Unsaved"}
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {hasMasks ? (
                  <div className="space-y-4">
                    {/* Status Indicator */}
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                      <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-green-900 dark:text-green-100">Masks Available</p>
                        <p className="text-xs text-muted-foreground">Ready for editing and reconstruction</p>
                      </div>
                    </div>

                    {/* Reset Masks Button */}
                    <ShowForRegisteredUser>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setRevertDialogOpen(true)}
                              disabled={isReverting}
                              className="w-full text-xs"
                            >
                              <RefreshCw className="h-3.5 w-3.5 mr-2" />
                              Reset Masks
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Reset all edits and restore original AI-generated masks</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </ShowForRegisteredUser>
                  </div>
                ) : (
                  <div className="text-center py-6 space-y-2">
                    <div className="w-12 h-12 mx-auto rounded-lg bg-muted/50 flex items-center justify-center">
                      <Layers className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">No Masks Yet</p>
                      <p className="text-xs text-muted-foreground">Start segmentation above</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Reconstruction Details Section - result/history only */}
            {hasReconstructions && reconstructionRows.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Box className="h-4 w-4" />
                      4D Reconstruction
                    </CardTitle>
                    <Badge variant="default">{reconstructionRows.length} Available</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {reconstructionRows.map((recon) => {
                    const model = (recon.segmentationModel || "unknown").toString().toLowerCase();
                    const viewModel = model === "medsam" || model === "unet" ? model : "unknown";
                    const edFrame = recon.metadata?.edFrameIndex ?? recon.ed_frame ?? 1;
                    const resolution = recon.metadata?.resolution;
                    const iterations = recon.metadata?.numIterations;
                    const processingTime = recon.metadata?.reconstructionTime;

                    return (
                      <div key={recon.reconstructionId} className="rounded-lg border p-4 space-y-3">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold truncate">{recon.name || "4D Reconstruction"}</p>
                              <Badge variant="outline">{formatReconstructionModel(model)}</Badge>
                              <Badge variant="secondary">{recon.status || "Ready"}</Badge>
                            </div>
                            <div className="grid gap-3 text-sm sm:grid-cols-2">
                              <div>
                                <p className="text-xs text-muted-foreground">Segmentation Model Used</p>
                                <p>{formatReconstructionModel(model)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Updated</p>
                                <p>{formatDateTime(recon.updatedAt || recon.createdAt)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">ED Frame</p>
                                <p className="font-mono">Frame {edFrame}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Export Format</p>
                                <p className="font-mono uppercase">{recon.meshFormat || "GLB"}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Size</p>
                                <p>{formatFileSize(recon.meshFileSize)}</p>
                              </div>
                              {(resolution || iterations) && (
                                <div>
                                  <p className="text-xs text-muted-foreground">Resolution / Iterations</p>
                                  <p className="font-mono">
                                    {resolution ? `${resolution}^3` : "N/A"} / {iterations ?? "N/A"}
                                  </p>
                                </div>
                              )}
                              {processingTime && (
                                <div>
                                  <p className="text-xs text-muted-foreground">Processing Time</p>
                                  <p>{processingTime.toFixed(1)}s</p>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 lg:justify-end">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    onClick={() => goToReconstructionViewer(viewModel, recon.reconstructionId)}
                                  >
                                    <Eye className="h-4 w-4 mr-2" />
                                    View 4D
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Interactive 3D viewer with animation controls</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <ShowForRegisteredUser>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setSelectedReconstructionForDeletion(recon);
                                  setDeleteModelDialogOpen(true);
                                }}
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </Button>
                            </ShowForRegisteredUser>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}


            {/* Jobs Section - Redesigned */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Processing Jobs
                  </CardTitle>
                  {jobs && jobs.length > 0 && <Badge variant="secondary">{jobs.length}</Badge>}
                </div>
              </CardHeader>
              <CardContent>
                {jobsError ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-xs">{jobsError}</AlertDescription>
                  </Alert>
                ) : jobs && jobs.length > 0 ? (
                  <div className="space-y-3">
                    {/* Job Status Summary */}
                    <div className="grid grid-cols-2 gap-2">
                      {jobCounts[ProjectTypes.JobStatus.IN_PROGRESS] > 0 && (
                        <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                          <div className="flex items-center gap-1.5">
                            <RefreshCw className="h-3.5 w-3.5 text-blue-600 animate-spin" />
                            <div>
                              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100">{jobCounts[ProjectTypes.JobStatus.IN_PROGRESS]}</p>
                              <p className="text-xs text-muted-foreground">Running</p>
                            </div>
                          </div>
                        </div>
                      )}
                      {jobCounts[ProjectTypes.JobStatus.PENDING] > 0 && (
                        <div className="p-2 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800">
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-yellow-600" />
                            <div>
                              <p className="text-sm font-semibold text-yellow-900 dark:text-yellow-100">{jobCounts[ProjectTypes.JobStatus.PENDING]}</p>
                              <p className="text-xs text-muted-foreground">Pending</p>
                            </div>
                          </div>
                        </div>
                      )}
                      {jobCounts[ProjectTypes.JobStatus.COMPLETED] > 0 && (
                        <div className="p-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                          <div className="flex items-center gap-1.5">
                            <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                            <div>
                              <p className="text-sm font-semibold text-green-900 dark:text-green-100">{jobCounts[ProjectTypes.JobStatus.COMPLETED]}</p>
                              <p className="text-xs text-muted-foreground">Done</p>
                            </div>
                          </div>
                        </div>
                      )}
                      {jobCounts[ProjectTypes.JobStatus.FAILED] > 0 && (
                        <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
                          <div className="flex items-center gap-1.5">
                            <XCircle className="h-3.5 w-3.5 text-red-600" />
                            <div>
                              <p className="text-sm font-semibold text-red-900 dark:text-red-100">{jobCounts[ProjectTypes.JobStatus.FAILED]}</p>
                              <p className="text-xs text-muted-foreground">Failed</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Job List - Compact */}
                    <ScrollArea className="h-32">
                      <div className="space-y-2">
                        {jobs.slice(0, 5).map((job, index) => (
                          <div key={job.jobId || index} className="flex items-center gap-2 p-2 border rounded text-xs">
                            {job.status === ProjectTypes.JobStatus.PENDING && <Clock className="h-3 w-3 text-yellow-600 flex-shrink-0" />}
                            {job.status === ProjectTypes.JobStatus.IN_PROGRESS && <RefreshCw className="h-3 w-3 text-blue-600 animate-spin flex-shrink-0" />}
                            {job.status === ProjectTypes.JobStatus.COMPLETED && <CheckCircle className="h-3 w-3 text-green-600 flex-shrink-0" />}
                            {job.status === ProjectTypes.JobStatus.FAILED && <XCircle className="h-3 w-3 text-red-600 flex-shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">Segmentation</p>
                              <p className="text-muted-foreground truncate">{job.jobId}</p>
                            </div>
                            <Badge 
                              variant={
                                job.status === ProjectTypes.JobStatus.COMPLETED ? "default" : 
                                job.status === ProjectTypes.JobStatus.FAILED ? "destructive" : 
                                "secondary"
                              }
                              className="text-xs"
                            >
                              {job.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                ) : (
                  <div className="text-center py-6 space-y-2">
                    <div className="w-12 h-12 mx-auto rounded-lg bg-muted/50 flex items-center justify-center">
                      <Activity className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">No Jobs</p>
                      <p className="text-xs text-muted-foreground">
                        {hasMasks ? 'All processing complete' : 'No processing started'}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Reconstruction Configuration Dialog */}
      <ReconstructionConfigDialog
        open={showReconstructionDialog}
        onOpenChange={setShowReconstructionDialog}
        onStart={handleStartReconstruction}
        isLoading={isStartingReconstruction}
        totalFrames={projectData?.dimensions?.frames || 1}
        availableModels={availableReconstructionModels}
        blockedModels={Array.from(existing4DModels)}
        defaultSelectedModel={selectedModelForCreation || defaultReconstructionModel}
        gpuAvailable={processingUnit.gpuAvailable}
        existingReconstructionsByModel={existing4DByModel}
        onViewReconstruction={goToReconstructionViewer}
      />

      {/* Delete Model Reconstruction Confirmation Dialog */}
      <AlertDialog open={deleteModelDialogOpen} onOpenChange={setDeleteModelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete 4D Reconstruction
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                Are you sure you want to delete &quot;{selectedReconstructionForDeletion?.name || "this 4D reconstruction"}&quot; for &quot;{currentProjectName}&quot;?
              </p>
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <p className="text-sm text-amber-900 dark:text-amber-100">
                  <strong>Note:</strong> This will permanently delete only this selected 4D result. Other reconstruction results, if present, will remain unchanged.
                </p>
              </div>
              <p className="font-semibold text-sm">This action cannot be undone.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingReconstruction}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteModelReconstruction}
              disabled={isDeletingReconstruction || !selectedReconstructionForDeletion?.reconstructionId}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingReconstruction ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Project Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              Are you sure you want to delete &quot;{currentProjectName}&quot;?
              <br />
              <span className="text-muted-foreground text-sm italic">
                This will permanently delete the project and all associated data including segmentation results and 4D reconstructions.
              </span>
              <br />
              <span className="font-semibold">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDeleteProject} 
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Permanently"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revert to AI Confirmation Dialog */}
      <AlertDialog open={revertDialogOpen} onOpenChange={setRevertDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Masks to AI Segmentation?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                This will replace <strong>all your manual edits</strong> with the original AI-generated segmentation masks for &quot;{currentProjectName}&quot;.
              </p>
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <p className="text-sm text-amber-900 dark:text-amber-100">
                  <strong>Warning:</strong> Any brush edits, refinements, or manual adjustments you&apos;ve made will be permanently lost.
                </p>
              </div>
              <p className="font-semibold text-sm">This action cannot be undone.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReverting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleRevertToAI} 
              disabled={isReverting}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              {isReverting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reset Masks
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function ProjectPage() {
  return (
    <Suspense fallback={null}>
      <ProjectPageInner />
    </Suspense>
  );
}