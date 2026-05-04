"use client";

import dynamic from "next/dynamic";
import { Loader2, RefreshCw } from "lucide-react";
import { useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

// Backend integration
import { segmentationApi } from "@/lib/api";
import { createFramesStructureFromEditableMasks } from "@/lib/decode-RLE";
import { LoadingProject } from "@/components/project/LoadingProject";
import { ErrorProject } from "@/components/project/ErrorProject";
import { SegmentationSidebar } from "@/components/segmentation/segmentation-sidebar";
import type { AnatomicalLabel, HistoryEntry, DrawingTool } from "@/types/segmentation";
import { generateMaskKey } from "@/types/segmentation";
import type * as ProjectTypes from "@/types/project";
import { useProject } from "@/context/ProjectContext";
import { useSegmentationHistory } from "@/hooks/useSegmentationHistory";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { ReconstructionGLBViewer } from "@/components/reconstruction/ReconstructionGLBViewer";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGpuStatus } from "@/lib/dashboard-hooks";

export type SegmentationModelId = "medsam" | "unet";

const MODEL_OPTIONS: { value: SegmentationModelId; label: string }[] = [
  { value: "medsam", label: "MedSam" },
  { value: "unet", label: "Unet" },
];

const isValidModel = (v: string | null): v is SegmentationModelId =>
  v === "medsam" || v === "unet";

const ImageCanvas = dynamic(() => import("@/components/segmentation/image-canvas").then((mod) => mod.ImageCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full">
      <Loader2 className="w-8 h-8 animate-spin" />
    </div>
  ),
});

export default function SegmentationResultsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { processingUnit } = useGpuStatus();
  const isGpuMode = processingUnit.gpuAvailable;

  const {
    loading,
    error,
    projectData,
    decodedMasks: contextDecodedMasks,
    undecodedMasks,
    hasMasks,
    segmentationError,
    tarCacheReady,
    tarCacheError,
    updateContextMasks,
    hasReconstructions,
    reconstructionCacheReady,
    getReconstructionGLB,
  } = useProject();

  useEffect(() => {
    if (projectData?.name) {
      document.title = `VisHeart | ${projectData.name} - Segmentation`;
    } else {
      document.title = "VisHeart | Segmentation Editor";
    }
    
    return () => {
      document.title = "VisHeart";
    };
  }, [projectData?.name]);

  const [masksInitialized, setMasksInitialized] = useState(false);
  const [localDecodedMasks, setLocalDecodedMasks] = useState<Record<string, Uint8Array> | null>(null);

  const decodedMasks = localDecodedMasks || contextDecodedMasks;
  const setDecodedMasks = setLocalDecodedMasks;

  const safeDecodedMasks = decodedMasks || {};

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log("[Segmentation Debug] Data flow check:", {
        contextMasks: contextDecodedMasks ? Object.keys(contextDecodedMasks).length : 0,
        localMasks: localDecodedMasks ? Object.keys(localDecodedMasks).length : 0,
        finalMasks: decodedMasks ? Object.keys(decodedMasks).length : 0,
        masksInitialized,
        tarCacheReady,
        tarCacheError
      });
    }
  }, [contextDecodedMasks, localDecodedMasks, decodedMasks, masksInitialized, tarCacheReady, tarCacheError]);

  // UI state
  const [activeLabel, setActiveLabel] = useState<AnatomicalLabel>("lvc");
  const [tool, setTool] = useState<DrawingTool>("brush");
  const [brushSize, setBrushSize] = useState<number>(10);
  const [opacity, setOpacity] = useState<number>(1);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [currentSlice, setCurrentSlice] = useState(0);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [resetTrigger, setResetTrigger] = useState<number>(0);
  const [revertDialogOpen, setRevertDialogOpen] = useState(false);
  const [runSegmentationLoading, setRunSegmentationLoading] = useState(false);
  const [runSegmentationError, setRunSegmentationError] = useState<string | null>(null);
  const [runSegmentationSuccess, setRunSegmentationSuccess] = useState<string | null>(null);
  const modelSessionKey = `selectedModel_${projectId}`;

  const [selectedModel, setSelectedModel] = useState<SegmentationModelId>("medsam");

  useEffect(() => {
    try {
      const storedModel =
        localStorage.getItem(modelSessionKey) ?? sessionStorage.getItem(modelSessionKey);

      if (isValidModel(storedModel)) {
        setSelectedModel(storedModel);
      }
    } catch {
      // ignore sessionStorage read errors
    }
  }, [modelSessionKey]);

  // Enforce CPU-safe model selection: MedSAM is only available in NVIDIA GPU mode.
  useEffect(() => {
    if (isGpuMode) return;
    if (selectedModel !== "medsam") return;

    setSelectedModel("unet");
    try {
      localStorage.setItem(modelSessionKey, "unet");
      sessionStorage.setItem(modelSessionKey, "unet");
    } catch {
      // ignore storage write errors
    }
  }, [isGpuMode, selectedModel, modelSessionKey]);

  const handleModelSelect = useCallback((value: SegmentationModelId) => {
    if (!isGpuMode && value === "medsam") {
      setRunSegmentationError("This model is only available with NVIDIA GPU.");
      return;
    }

    setSelectedModel(value);
    try {
      localStorage.setItem(modelSessionKey, value);
      sessionStorage.setItem(modelSessionKey, value);
    } catch {
      // ignore storage write errors
    }
    setRunSegmentationError(null);
    setRunSegmentationSuccess(
      `${MODEL_OPTIONS.find((o) => o.value === value)?.label} selected successfully.`
    );
  }, [isGpuMode, modelSessionKey]);

  const [reconstructionModelUrl, setReconstructionModelUrl] = useState<string | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);

  useEffect(() => {
    if (!hasReconstructions || !reconstructionCacheReady) {
      setReconstructionModelUrl(null);
      return;
    }

    const loadModel = async () => {
      setIsLoadingModel(true);
      try {
        console.log(`[Segmentation 3D] Loading model for frame ${currentFrame}...`);
        const url = await getReconstructionGLB(currentFrame + 1);
        if (url) {
          console.log(`[Segmentation 3D] ✅ Loaded model for frame ${currentFrame}`);
          setReconstructionModelUrl(url);
        } else {
          console.warn(`[Segmentation 3D] ❌ No model URL for frame ${currentFrame}`);
          setReconstructionModelUrl(null);
        }
      } catch (error) {
        console.error(`[Segmentation 3D] Error loading model:`, error);
        setReconstructionModelUrl(null);
      } finally {
        setIsLoadingModel(false);
      }
    };

    loadModel();
  }, [currentFrame, hasReconstructions, reconstructionCacheReady, getReconstructionGLB]);

  const handleReset = useCallback(() => {
    setZoomLevel(1);
    setResetTrigger(prev => prev + 1);
  }, []);

  const handleRunSegmentation = useCallback(async () => {
    if (!projectId || runSegmentationLoading) return;

    setRunSegmentationLoading(true);
    setRunSegmentationError(null);
    setRunSegmentationSuccess(null);

    try {
      const detectedMode = isGpuMode ? "gpu" : "cpu";
      const effectiveModel: SegmentationModelId = isGpuMode ? selectedModel : "unet";

      try {
        localStorage.setItem(modelSessionKey, effectiveModel);
        sessionStorage.setItem(modelSessionKey, effectiveModel);
      } catch {
        // ignore storage write errors
      }

      console.log("[Segmentation] Run request mode/model:", {
        processingUnit,
        detectedMode,
        selectedModel,
        effectiveModel,
        requestPayload: { segmentationModel: effectiveModel, deviceType: "auto" },
      });

      const response = await segmentationApi.startSegmentation(projectId, effectiveModel, "auto");

      setRunSegmentationSuccess(
        `${MODEL_OPTIONS.find((o) => o.value === effectiveModel)?.label} segmentation started successfully.`
      );

      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error: any) {
      const errorMsg =
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        "Failed to start segmentation";

      console.error("[Segmentation] ❌ Full error:", error);
      console.error("[Segmentation] ❌ Response data:", error?.response?.data);
      console.error("[Segmentation] ❌ Status:", error?.response?.status);
      console.error("[Segmentation] ❌ projectId:", projectId);
      console.error("[Segmentation] ❌ selectedModel:", selectedModel);

      setRunSegmentationError(errorMsg);
    } finally {
      setRunSegmentationLoading(false);
    }
  }, [projectId, selectedModel, runSegmentationLoading, modelSessionKey, isGpuMode, processingUnit]);

  const {
    currentHistory,
    currentStep: currentHistoryStep,
    canUndo,
    canRedo,
    createEntry: createHistoryEntry,
    addToHistory,
    navigateToStep: handleHistoryStepChange,
    initialize: initializeHistory,
    clear: handleHistoryClear
  } = useSegmentationHistory({
    currentFrame,
    currentSlice,
    decodedMasks
  });

  const canClear = useMemo(() => !!decodedMasks, [decodedMasks]);

  const [visibleMasks, setVisibleMasks] = useState<Set<AnatomicalLabel>>(new Set(["lvc", "rv", "myo"]));

  const calculateMaskChanges = useCallback(
    (oldMasks: Record<string, Uint8Array>, newMasks: Record<string, Uint8Array>, label: string): HistoryEntry["maskChanges"] => {
      const editableMaskKey = generateMaskKey(currentFrame, currentSlice, label as AnatomicalLabel);
      const oldMask = oldMasks[editableMaskKey];
      const newMask = newMasks[editableMaskKey];

      if (!newMask) return undefined;

      let added = 0;
      let removed = 0;

      const maskLength = newMask.length;
      for (let i = 0; i < maskLength; i++) {
        const oldPixel = oldMask ? oldMask[i] || 0 : 0;
        const newPixel = newMask[i] || 0;

        if (oldPixel === 0 && newPixel > 0) added++;
        if (oldPixel > 0 && newPixel === 0) removed++;
      }

      return { added, removed, label: label as AnatomicalLabel };
    },
    [currentFrame, currentSlice],
  );

  const updateMasksWithHistory = useCallback(
    (newMasks: Record<string, Uint8Array>, actionType: HistoryEntry["type"] = "brush", description?: string) => {
      if (!decodedMasks) return;

      const maskChanges = calculateMaskChanges(decodedMasks, newMasks, activeLabel);
      
      const newEntry = createHistoryEntry(
        actionType, 
        description || `${actionType} action on ${activeLabel.toUpperCase()}`, 
        decodedMasks,
        maskChanges, 
        activeLabel
      );

      addToHistory(newEntry);

      setDecodedMasks(newMasks);
      setHasUnsavedChanges(true);

      console.log(`[Segmentation] Updated history for current frame/slice`);
    },
    [decodedMasks, activeLabel, createHistoryEntry, addToHistory, calculateMaskChanges, setDecodedMasks],
  );

  const canvasDimensions = useMemo(() => {
    const dbWidth = projectData?.dimensions?.width || 512;
    const dbHeight = projectData?.dimensions?.height || 512;

    return {
      width: dbWidth,
      height: dbHeight,
    };
  }, [projectData?.dimensions]);

  const restoreMasksFromHistory = useCallback((entry: HistoryEntry | null) => {
    if (!entry || !entry.masksSnapshot || !decodedMasks) return;

    const currentFrameSlicePrefix = `editable_frame_${currentFrame}_slice_${currentSlice}_`;
    const mergedMasks = { ...decodedMasks };

    for (const key of Object.keys(mergedMasks)) {
      if (key.startsWith(currentFrameSlicePrefix) && !(key in entry.masksSnapshot)) {
        delete mergedMasks[key];
        console.log(`[Segmentation] Removed mask ${key} (not in snapshot)`);
      }
    }

    for (const [key, maskData] of Object.entries(entry.masksSnapshot)) {
      if (key.startsWith(currentFrameSlicePrefix) && maskData) {
        try {
          mergedMasks[key] = new Uint8Array(maskData as ArrayLike<number>);
        } catch (error) {
          console.error(`[Segmentation] Failed to restore mask ${key}:`, error);
        }
      }
    }

    setDecodedMasks(mergedMasks);
    setHasUnsavedChanges(true);
  }, [decodedMasks, currentFrame, currentSlice, setDecodedMasks]);

  const handleHistoryStepChangeWithMasks = useCallback((step: number) => {
    console.log(`[Segmentation] Navigating to history step ${step}`);
    const entry = handleHistoryStepChange(step);
    if (entry) {
      restoreMasksFromHistory(entry);
      console.log(`[Segmentation] Successfully navigated to history step ${step}`);
    }
    return entry;
  }, [handleHistoryStepChange, restoreMasksFromHistory]);

  const handleUndo = useCallback(() => {
    if (!canUndo || !decodedMasks) return;
    
    const previousEntry = handleHistoryStepChangeWithMasks(currentHistoryStep - 1);
    if (previousEntry) {
      console.log(`[Segmentation] Undo operation completed`);
    }
  }, [canUndo, decodedMasks, handleHistoryStepChangeWithMasks, currentHistoryStep]);

  const handleRedo = useCallback(() => {
    if (!canRedo || !decodedMasks) return;
    
    const nextEntry = handleHistoryStepChangeWithMasks(currentHistoryStep + 1);
    if (nextEntry) {
      console.log(`[Segmentation] Redo operation completed`);
    }
  }, [canRedo, decodedMasks, handleHistoryStepChangeWithMasks, currentHistoryStep]); 
  const handleClear = useCallback(() => {
    if (!decodedMasks) return;

    const newMasks = { ...decodedMasks };
    const editableMaskKey = generateMaskKey(currentFrame, currentSlice, activeLabel);

    if (newMasks[editableMaskKey]) {
      newMasks[editableMaskKey] = new Uint8Array(newMasks[editableMaskKey].length);
      updateMasksWithHistory(newMasks, "clear", `Cleared ${activeLabel.toUpperCase()} editable mask`);
    }
  }, [decodedMasks, currentFrame, currentSlice, activeLabel, updateMasksWithHistory]);

  const handleHistoryCheckpoint = useCallback(() => {
    if (!decodedMasks) return;

    const existingCheckpoints = currentHistory.filter((entry) => entry.type === "checkpoint").length;
    const nextCheckpointNum = existingCheckpoints + 1;

    updateMasksWithHistory(decodedMasks, "checkpoint", `Manual checkpoint #${nextCheckpointNum} created`);
  }, [decodedMasks, currentHistory, updateMasksWithHistory]);

  const handleSave = useCallback(async () => {
    if (!decodedMasks || !projectId || isSaving) return;
    
    setIsSaving(true);
    try {
      const editableMasks = Object.entries(decodedMasks)
        .filter(([key]) => key.startsWith("editable_"))
        .reduce(
          (acc, [key, data]) => {
            acc[key] = data;
            return acc;
          },
          {} as Record<string, Uint8Array>,
        );

      console.log("[Segmentation] Saving editable masks:", Object.keys(editableMasks));

      const frames = createFramesStructureFromEditableMasks(editableMasks);

      console.log("[Segmentation] Converted to backend frames format:", frames);

      if (frames.length > 0 && frames[0].slices && frames[0].slices.length > 0) {
        const firstMask = frames[0].slices[0].segmentationmasks?.[0];
        if (firstMask) {
          console.log("[RLE Test] First mask RLE string:", firstMask.segmentationmaskcontents);
          console.log("[RLE Test] RLE string length:", firstMask.segmentationmaskcontents.length);
        }
      }

      await segmentationApi.saveManualSegmentation(projectId, {
        name: `Manual Segmentation - ${new Date().toISOString()}`,
        description: "Manually edited segmentation masks with RLE encoding",
        frames: frames,
        model: selectedModel,
      });

      console.log("[Segmentation] Successfully saved masks to backend");

      updateContextMasks(decodedMasks);

      setHasUnsavedChanges(false);
      setLocalDecodedMasks(null); 

      console.log("[Segmentation] Successfully saved and updated context with optimistic approach");
    } catch (err) {
      console.error("Failed to save editable masks:", err);
    } finally {
      setIsSaving(false);
    }
  }, [decodedMasks, projectId, isSaving, updateContextMasks]);

  const handleRevertToAI = useCallback(async () => {
    if (!projectId || isSaving || !undecodedMasks) return;

    setIsSaving(true);
    try {
      const aiMask = undecodedMasks.find((mask: ProjectTypes.BaseSegmentationMask) => mask.isMedSAMOutput === true);
      const editableMask = undecodedMasks.find((mask: ProjectTypes.BaseSegmentationMask) => mask.isMedSAMOutput === false);

      if (!aiMask || !editableMask) {
        console.error("[Segmentation] Could not find AI or editable mask");
        alert("Could not find masks to revert. Please try again.");
        return;
      }

      console.log("[Segmentation] Reverting to AI mask:", {
        aiMaskId: aiMask._id,
        editableMaskId: editableMask._id,
        frameCount: aiMask.frames?.length || 0,
      });

      const revertData = {
        frames: aiMask.frames, 
      };

      await segmentationApi.saveManualSegmentation(projectId, revertData);

      console.log("[Segmentation] ✅ Successfully reverted to AI mask");

      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (err) {
      console.error("[Segmentation] ❌ Error reverting to AI mask:", err);
      alert("Failed to revert to AI mask. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [projectId, isSaving, undecodedMasks]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === 's') {
        event.preventDefault(); 
        
        if (hasUnsavedChanges && !isSaving) {
          console.log('[Segmentation] Ctrl+S shortcut triggered - saving changes...');
          handleSave();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasUnsavedChanges, isSaving, handleSave]);

  const handleHistoryExport = useCallback(() => {
    console.log("Export triggered from page level");
  }, []);

  useEffect(() => {
    if (contextDecodedMasks && !masksInitialized) {
      console.log("[Segmentation] Initializing history with context masks");
      initializeHistory(contextDecodedMasks);
      setMasksInitialized(true);
    }
  }, [contextDecodedMasks, masksInitialized, initializeHistory]);

  useEffect(() => {
    if (masksInitialized && decodedMasks) {
      console.log(`[Segmentation] Auto-initializing history for new frame/slice if needed`);
      initializeHistory(decodedMasks);
    }
  }, [currentFrame, currentSlice, masksInitialized, decodedMasks, initializeHistory]);

  if (!projectId) return <ErrorProject error="Project ID is missing." />;
  if (loading !== "done") return <LoadingProject loadingStage={loading} />;
  if (error) return <ErrorProject error={error} />;
  if (segmentationError && !hasMasks) return <ErrorProject error={segmentationError} />;
  if (!projectData || (!contextDecodedMasks && !isSaving)) {
    return <ErrorProject error="No data available" />;
  }
  if (isSaving && !contextDecodedMasks) {
    return <LoadingProject loadingStage="mask" />;
  }

  return (
    <div className="h-full w-full bg-background flex flex-col">

      {/* AI Model Selector Bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-background shrink-0 flex-wrap">
        {/* Icon + label */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.75a6 6 0 1 1 4.5 11.25M9.75 3.75A6 6 0 0 0 3.75 9.75M9.75 3.75 3.75 9.75m10.5 0a6 6 0 0 1-4.5 11.25M14.25 9.75A6 6 0 0 1 20.25 15" />
            </svg>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">AI Model</p>
            <p className="text-xs font-medium text-foreground leading-tight mt-0.5">Select segmentation model</p>
          </div>
        </div>

        {/* Dropdown */}
        <Select
            value={selectedModel}
          onValueChange={(value: string) => handleModelSelect(value as SegmentationModelId)}
          >
          <SelectTrigger
            size="sm"
            className="min-w-[160px] rounded-xl bg-background px-3 text-sm shadow-sm hover:bg-muted/40"
            aria-label="Select segmentation model"
          >
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent className="rounded-xl p-1.5 shadow-lg">
            {MODEL_OPTIONS.map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                disabled={!isGpuMode && opt.value === "medsam"}
                className="rounded-lg py-2"
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!isGpuMode && (
          <span className="text-xs text-muted-foreground">
            This model is only available with NVIDIA GPU.
          </span>
        )}

        {/* Status badge */}
        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 border border-green-200 dark:border-green-800">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
          Ready to segment
        </span>

        {/* Confirmation text */}
        <span className="text-xs text-muted-foreground">
          Using: <strong className="text-foreground font-medium">
            {MODEL_OPTIONS.find((o) => o.value === selectedModel)?.label}
          </strong>
        </span>

        {/* Run Segmentation Button */}
        <button
          onClick={handleRunSegmentation}
          disabled={runSegmentationLoading}
          className="ml-auto px-3 py-1.5 text-sm font-medium rounded-md bg-black text-white hover:bg-black/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 dark:bg-white dark:text-black dark:hover:bg-white/90"
        >
          {runSegmentationLoading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 0 1-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              Run Segmentation
            </>
          )}
        </button> 

        {/* Error message */}
        {runSegmentationError && (
          <div className="text-xs text-red-600 dark:text-red-400 ml-auto">
            {runSegmentationError}
          </div>
        )}

        {/* Success message */}
        {runSegmentationSuccess && (
          <div className="w-full text-xs text-green-600 dark:text-green-400 mt-1">
            {runSegmentationSuccess}
          </div>
        )}
      </div>

      {/* Main segmentation layout */}
      <div className="flex-1 min-h-0 overflow-hidden">
      {/* Mobile: Stack vertically */}
      <div className="lg:hidden w-full h-full p-4 flex flex-col gap-4">
        <div className="flex-1 relative bg-muted/40 rounded-xl border shadow-sm p-4 flex items-center justify-center overflow-hidden">
          <ImageCanvas
            projectData={projectData}
            decodedMasks={safeDecodedMasks}
            onMaskUpdate={updateMasksWithHistory}
            currentFrame={currentFrame}
            currentSlice={currentSlice}
            onFrameChange={setCurrentFrame}
            onSliceChange={setCurrentSlice}
            width={canvasDimensions.width}
            height={canvasDimensions.height}
            activeLabel={activeLabel}
            visibleMasks={visibleMasks}
            tool={tool}
            brushSize={brushSize}
            opacity={opacity}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
            resetTrigger={resetTrigger}
            selectedModel={selectedModel}
          />
        </div>
        
        <div className="w-full bg-background rounded-xl border shadow-sm">
          <SegmentationSidebar
            projectData={projectData}
            decodedMasks={safeDecodedMasks}
            tool={tool}
            setTool={setTool}
            brushSize={brushSize}
            setBrushSize={setBrushSize}
            opacity={opacity}
            setOpacity={setOpacity}
            activeLabel={activeLabel}
            setActiveLabel={setActiveLabel}
            visibleMasks={visibleMasks}
            setVisibleMasks={setVisibleMasks}
            handleUndo={handleUndo}
            handleRedo={handleRedo}
            handleClear={handleClear}
            canUndo={canUndo}
            canRedo={canRedo}
            canClear={canClear}
            hasUnsavedChanges={hasUnsavedChanges}
            isSaving={isSaving}
            onSave={handleSave}
            currentFrame={currentFrame}
            currentSlice={currentSlice}
            totalFrames={projectData.dimensions?.frames || 1}
            totalSlices={projectData.dimensions?.slices || 1}
            historyData={currentHistory}
            currentHistoryStep={currentHistoryStep}
            onHistoryStepChange={handleHistoryStepChangeWithMasks}
            onHistoryClear={handleHistoryClear}
            onHistoryExport={handleHistoryExport}
            onHistoryCheckpoint={handleHistoryCheckpoint}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
            onReset={handleReset}
            selectedModel={selectedModel}
            onModelChange={handleModelSelect}
            isModelActive={hasMasks}
            isModelRunning={runSegmentationLoading}
          />
        </div>
      </div>

      {/* Desktop: Resizable panels */}
      <div className="hidden lg:block w-full h-full p-3">
        <ResizablePanelGroup 
          direction="horizontal" 
          className="h-full w-full rounded-xl border shadow-sm"
        >
          {/* Canvas Panel with horizontal split for 3D viewer */}
          <ResizablePanel defaultSize={70} minSize={20}>
            <ResizablePanelGroup direction="horizontal">
              {/* 3D Viewer (Left)*/}
              <>
                <ResizablePanel defaultSize={35} minSize={0} maxSize={70}>
                  <div className="w-full bg-background p-4 flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
                    <div className="flex items-center justify-between mb-2 flex-shrink-0">
                      <h3 className="text-sm font-semibold">3D Reconstruction of Left Ventricle Myocardium</h3>
                      {isLoadingModel && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading model...
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-h-0 max-h-full">
                      <ReconstructionGLBViewer
                        modelUrl={reconstructionModelUrl}
                        frame={currentFrame + 1}
                        className="w-full h-full"
                      />
                    </div>
                  </div>
                </ResizablePanel>

                <ResizableHandle withHandle />
              </>

              {/* 2D Canvas (Right) */}
              <ResizablePanel defaultSize={65}>
                <div className="w-full relative bg-muted/40 p-4 flex items-center justify-center" style={{ height: 'calc(100vh - 120px)' }}>
                  <ImageCanvas
                    projectData={projectData}
                    decodedMasks={safeDecodedMasks}
                    onMaskUpdate={updateMasksWithHistory}
                    currentFrame={currentFrame}
                    currentSlice={currentSlice}
                    onFrameChange={setCurrentFrame}
                    onSliceChange={setCurrentSlice}
                    width={canvasDimensions.width}
                    height={canvasDimensions.height}
                    activeLabel={activeLabel}
                    visibleMasks={visibleMasks}
                    tool={tool}
                    brushSize={brushSize}
                    opacity={opacity}
                    zoomLevel={zoomLevel}
                    setZoomLevel={setZoomLevel}
                    resetTrigger={resetTrigger}
                    selectedModel={selectedModel}
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Sidebar Panel */}
          <ResizablePanel defaultSize={30} minSize={0} maxSize={80}>
            <div className="h-full w-full bg-background">
              <SegmentationSidebar
                projectData={projectData}
                decodedMasks={safeDecodedMasks}
                tool={tool}
                setTool={setTool}
                brushSize={brushSize}
                setBrushSize={setBrushSize}
                opacity={opacity}
                setOpacity={setOpacity}
                activeLabel={activeLabel}
                setActiveLabel={setActiveLabel}
                visibleMasks={visibleMasks}
                setVisibleMasks={setVisibleMasks}
                handleUndo={handleUndo}
                handleRedo={handleRedo}
                handleClear={handleClear}
                canUndo={canUndo}
                canRedo={canRedo}
                canClear={canClear}
                hasUnsavedChanges={hasUnsavedChanges}
                isSaving={isSaving}
                onSave={handleSave}
                onRevert={() => setRevertDialogOpen(true)}
                currentFrame={currentFrame}
                currentSlice={currentSlice}
                totalFrames={projectData.dimensions?.frames || 1}
                totalSlices={projectData.dimensions?.slices || 1}
                historyData={currentHistory}
                currentHistoryStep={currentHistoryStep}
                onHistoryStepChange={handleHistoryStepChangeWithMasks}
                onHistoryClear={handleHistoryClear}
                onHistoryExport={handleHistoryExport}
                onHistoryCheckpoint={handleHistoryCheckpoint}
                zoomLevel={zoomLevel}
                setZoomLevel={setZoomLevel}
                onReset={handleReset}
                selectedModel={selectedModel}
                onModelChange={handleModelSelect}
                isModelActive={hasMasks}
                isModelRunning={runSegmentationLoading}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Revert to AI Confirmation Dialog */}
      <AlertDialog open={revertDialogOpen} onOpenChange={setRevertDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Masks to AI Segmentation?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                This will replace <strong>all your manual edits</strong> with the original AI-generated segmentation masks for &quot;{projectData?.name}&quot;.
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
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleRevertToAI} 
              disabled={isSaving}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              {isSaving ? (
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
    </div>
  );
}
