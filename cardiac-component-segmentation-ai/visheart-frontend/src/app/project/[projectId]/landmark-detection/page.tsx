"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { Loader2, Scan, Upload, X, AlertCircle, CheckCircle2, ChevronDown } from "lucide-react";

// VisHeart existing UI patterns — same imports as segmentation page
import { useProject } from "@/context/ProjectContext";
import { LoadingProject } from "@/components/project/LoadingProject";
import { ErrorProject } from "@/components/project/ErrorProject";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useLandmarkDetection } from "@/hooks/useLandmarkDetection";
import { LandmarkSidebar } from "@/components/landmark/LandmarkSidebar";
import { LANDMARK_DEFINITIONS, type LandmarkPageState } from "@/types/landmark";

// Dynamic import matching segmentation pattern (avoids SSR canvas issues)
const LandmarkSliceViewer = dynamic(
  () =>
    import("@/components/landmark/LandmarkSliceViewer").then(
      (m) => m.LandmarkSliceViewer,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center w-full h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

const ReconstructionGLBViewer = dynamic(
  () =>
    import("@/components/reconstruction/ReconstructionGLBViewer").then(
      (m) => m.ReconstructionGLBViewer,
    ),
  { ssr: false },
);

const MODEL_OPTIONS = [{ value: "hrnet-lv", label: "HRNet-LV" }] as const;

export default function LandmarkDetectionPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const {
    loading,
    error,
    projectData,
    hasReconstructions,
    reconstructionCacheReady,
    getReconstructionGLB,
    tarCacheReady,
    tarCacheError,
    getMRIImage,
  } = useProject();

  useEffect(() => {
    if (projectData?.name) {
      document.title = `VisHeart | ${projectData.name} - Landmark Detection`;
    } else {
      document.title = "VisHeart | Landmark Detection";
    }
    return () => { document.title = "VisHeart"; };
  }, [projectData?.name]);

  const {
    state,
    fileError,
    uploadProgress,
    currentPrediction,
    handleFileSelect,
    handleRunDetection,
    handleTogglePlay,
    handleNextFrame,
    handlePrevFrame,
    handleSliderChange,
    handleReset,
  } = useLandmarkDetection(projectId);

  //  Model selector 
  const [selectedModel, setSelectedModel] = useState("hrnet-lv");

  //  Landmark visibility (which dots to render) 
  const [visibleLandmarks, setVisibleLandmarks] = useState<Set<string>>(
    new Set(["rv_insertion_1", "rv_insertion_2", "apex", "basal_anterior",
             "basal_inferior", "basal_lateral", "mid_anterior"]),
  );

  const handleToggleLandmark = useCallback((id: string) => {
    setVisibleLandmarks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 3D model for current frame (mirrors segmentation page pattern) 
  const [reconstructionModelUrl, setReconstructionModelUrl] = useState<string | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);

  useEffect(() => {
    if (!hasReconstructions || !reconstructionCacheReady) {
      setReconstructionModelUrl(null);
      return;
    }
    const load = async () => {
      setIsLoadingModel(true);
      try {
        const url = await getReconstructionGLB(state.currentFrame + 1);
        setReconstructionModelUrl(url ?? null);
      } catch {
        setReconstructionModelUrl(null);
      } finally {
        setIsLoadingModel(false);
      }
    };
    load();
  }, [state.currentFrame, hasReconstructions, reconstructionCacheReady, getReconstructionGLB]);

  // Load the MRI frame image from the existing project TAR cache when available.
  // If the cache is not ready yet, LandmarkSliceViewer will fall back to a mock MRI background.
  const [frameImageUrl, setFrameImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadFrameImage = async () => {
      if (!projectData || !tarCacheReady || tarCacheError) {
        setFrameImageUrl(null);
        return;
      }

      try {
        const middleSlice = Math.floor(((projectData.dimensions?.slices || 1) - 1) / 2);
        const url = await getMRIImage(state.currentFrame, middleSlice);
        if (!cancelled) setFrameImageUrl(url ?? null);
      } catch (err) {
        console.warn("[LandmarkDetection] Failed to load MRI frame from cache:", err);
        if (!cancelled) setFrameImageUrl(null);
      }
    };

    loadFrameImage();

    return () => {
      cancelled = true;
    };
  }, [projectData, tarCacheReady, tarCacheError, getMRIImage, state.currentFrame]);

  //  File drag-and-drop 
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  //  AHA alignment placeholder 
  // Sprint 2 W2 D3: wire to real AHA mapping endpoint (EPIC 7, Stefani)
  const handleApplyAlignment = useCallback(() => {
    console.log("[LandmarkPage] Apply AHA-17 alignment — Sprint 2 W2 D3 integration point");
    // TODO: call AHA mapping API here
  }, []);

  //  Guards — mirrors segmentation page pattern 
  if (!projectId) return <ErrorProject error="Project ID is missing." />;
  if (loading !== "done") return <LoadingProject loadingStage={loading} />;
  if (error) return <ErrorProject error={error} />;
  if (!projectData) return <ErrorProject error="No project data available." />;

  const isRunning = state.status === "running" || state.status === "uploading";
  const hasPredictions = state.status === "done" && state.predictions.length > 0;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-background">

      {/*  Top bar — mirrors segmentation page top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-background flex-shrink-0 flex-wrap">

        {/* Project name + status badges */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate text-foreground">
            {projectData.name}
          </span>
          <StatusBadge status={state.status} />
          {hasPredictions && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
              <span className="h-1 w-1 rounded-full bg-blue-500 inline-block" />
              Landmarks Detected
            </span>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Model selector — same dropdown style as segmentation page */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium hidden sm:block">
            Model
          </span>
          <div className="relative">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className={cn(
                "appearance-none pl-3 pr-7 py-1.5 text-xs rounded-lg border border-border",
                "bg-background text-foreground cursor-pointer",
                "focus:outline-none focus:ring-2 focus:ring-ring",
              )}
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Run Detection button — mirrors "Run Segmentation" */}
        <Button
          onClick={handleRunDetection}
          disabled={!state.uploadedFile || isRunning}
          size="sm"
          className="text-xs gap-1.5 shrink-0"
        >
          {isRunning ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {uploadProgress > 0 ? `Uploading ${uploadProgress}%` : "Running…"}
            </>
          ) : (
            <>
              <Scan className="h-3.5 w-3.5" />
              Run Detection
            </>
          )}
        </Button>
      </div>

      {/*  Upload + info strip */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-muted/20 flex-shrink-0 flex-wrap">

        {/* Upload dropzone — compact inline version */}
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors",
            isDragOver
              ? "border-primary bg-primary/5"
              : state.uploadedFile
              ? "border-green-500/50 bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400"
              : "border-dashed border-border hover:border-primary hover:bg-muted/40",
          )}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <Upload className="h-3.5 w-3.5 shrink-0" />
          {state.uploadedFile ? (
            <span className="font-medium truncate max-w-[200px]">
              {state.uploadedFile.name}
            </span>
          ) : (
            <span className="text-muted-foreground">
              Drop .nii / .nii.gz or click to browse
            </span>
          )}
          {state.uploadedFile && (
            <button
              className="ml-1 text-muted-foreground hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); handleReset(); }}
              title="Clear file"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".nii,.nii.gz"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileSelect(f);
            e.target.value = "";
          }}
        />

        {/* File error message */}
        {fileError && (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {fileError}
          </span>
        )}

        {/* Inference error message */}
        {state.error && (
          <span className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {state.error}
          </span>
        )}

        {/* Info cards — mirrors segmentation info strip */}
        <div className="ml-auto flex items-center gap-4 text-[11px] text-muted-foreground">
          <InfoPill label="Dataset" value={`${projectData.dimensions?.width ?? 256}×${projectData.dimensions?.height ?? 256}`} />
          <InfoPill label="Frames" value={hasPredictions ? `${state.totalFrames}` : `${projectData.dimensions?.frames ?? "—"}`} />
          <InfoPill label="Landmarks" value={hasPredictions ? `${visibleLandmarks.size} visible` : "—"} />
          <InfoPill label="Model" value={state.modelUsed || selectedModel} />
        </div>
      </div>

      {/* Main content — mobile: stack, desktop: resizable panels */}

      {/* Mobile layout */}
      <div className="lg:hidden flex-1 overflow-y-auto p-3 space-y-3">
        <MobileUploadPrompt hasPredictions={hasPredictions} isRunning={isRunning} />
        <div className="aspect-square w-full max-w-sm mx-auto">
          <LandmarkSliceViewer
            prediction={currentPrediction}
            currentFrame={state.currentFrame}
            totalFrames={state.totalFrames || 1}
            imageDimensions={state.imageDimensions}
            visibleLandmarks={visibleLandmarks}
            frameImageUrl={frameImageUrl}
          />
        </div>
        <LandmarkSidebar
          state={state}
          currentPrediction={currentPrediction}
          visibleLandmarks={visibleLandmarks}
          onToggleLandmark={handleToggleLandmark}
          onTogglePlay={handleTogglePlay}
          onNextFrame={handleNextFrame}
          onPrevFrame={handlePrevFrame}
          onSliderChange={handleSliderChange}
          onReset={handleReset}
          onApplyAlignment={handleApplyAlignment}
        />
      </div>

      {/* Desktop: 3-column resizable layout — mirrors segmentation page */}
      <div className="hidden lg:block flex-1 min-h-0 p-3">
        <ResizablePanelGroup
          direction="horizontal"
          className="h-full w-full rounded-xl border shadow-sm"
        >
          {/* Left: 3D reconstruction viewer (same as segmentation) */}
          <ResizablePanel defaultSize={30} minSize={0} maxSize={60}>
            <div
              className="w-full bg-background p-4 flex flex-col"
              style={{ height: "calc(100vh - 168px)" }}
            >
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <h3 className="text-sm font-semibold">
                  3D Cardiac Landmark Detection
                </h3>
                {isLoadingModel && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading model…
                  </div>
                )}
              </div>
              <div className="flex-1 min-h-0 max-h-full">
                <ReconstructionGLBViewer
                  modelUrl={reconstructionModelUrl}
                  frame={state.currentFrame + 1}
                  className="w-full h-full"
                />
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Center: 2D slice viewer with landmark overlay */}
          <ResizablePanel defaultSize={45}>
            <div
              className="w-full relative bg-muted/40 p-4 flex flex-col gap-3"
              style={{ height: "calc(100vh - 168px)" }}
            >
              {/* Empty state / loading indicator */}
              {state.status === "idle" && !state.uploadedFile && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground z-10 pointer-events-none">
                  <Upload className="h-10 w-10 opacity-30" />
                  <p className="text-sm">Upload a NIfTI file and run detection to begin.</p>
                </div>
              )}

              {isRunning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/60 backdrop-blur-sm z-10">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">
                    {uploadProgress > 0
                      ? `Uploading… ${uploadProgress}%`
                      : "Running landmark detection…"}
                  </p>
                  {uploadProgress > 0 && (
                    <div className="w-48 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="flex-1 min-h-0">
                <LandmarkSliceViewer
                  prediction={currentPrediction}
                  currentFrame={state.currentFrame}
                  totalFrames={state.totalFrames || 1}
                  imageDimensions={
                    state.imageDimensions.width > 0
                      ? state.imageDimensions
                      : {
                          width: projectData.dimensions?.width || 256,
                          height: projectData.dimensions?.height || 256,
                        }
                  }
                  visibleLandmarks={visibleLandmarks}
                  frameImageUrl={frameImageUrl}
                />
              </div>

              {/* Legend strip below viewer */}
              {hasPredictions && (
                <LandmarkLegend visibleLandmarks={visibleLandmarks} onToggle={handleToggleLandmark} />
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right: Sidebar — mirrors <SegmentationSidebar> placement */}
          <ResizablePanel defaultSize={25} minSize={0} maxSize={50}>
            <div className="h-full w-full bg-background">
              <LandmarkSidebar
                state={state}
                currentPrediction={currentPrediction}
                visibleLandmarks={visibleLandmarks}
                onToggleLandmark={handleToggleLandmark}
                onTogglePlay={handleTogglePlay}
                onNextFrame={handleNextFrame}
                onPrevFrame={handlePrevFrame}
                onSliderChange={handleSliderChange}
                onReset={handleReset}
                onApplyAlignment={handleApplyAlignment}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}

// Sub-components 

function StatusBadge({ status }: { status: LandmarkPageState["status"] }) {
  const configs = {
    idle:      { label: "Ready",     className: "bg-muted text-muted-foreground" },
    uploading: { label: "Uploading", className: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400" },
    running:   { label: "Running",   className: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" },
    done:      { label: "Done",      className: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" },
    error:     { label: "Error",     className: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" },
  } as const;

  const { label, className } = configs[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full",
        className,
      )}
    >
      {status === "running" || status === "uploading" ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      ) : status === "done" ? (
        <CheckCircle2 className="h-2.5 w-2.5" />
      ) : (
        <span className="h-1 w-1 rounded-full bg-current inline-block" />
      )}
      {label}
    </span>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground/60">{label}:</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function LandmarkLegend({
  visibleLandmarks,
  onToggle,
}: {
  visibleLandmarks: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 px-1">
      {LANDMARK_DEFINITIONS.map((def) => (
        <button
          key={def.id}
          onClick={() => onToggle(def.id)}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] transition-all",
            visibleLandmarks.has(def.id)
              ? "border-transparent text-white"
              : "border-border bg-transparent text-muted-foreground opacity-50",
          )}
          style={
            visibleLandmarks.has(def.id)
              ? { backgroundColor: def.color }
              : {}
          }
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: visibleLandmarks.has(def.id) ? "#fff" : def.color }}
          />
          {def.label}
        </button>
      ))}
    </div>
  );
}

function MobileUploadPrompt({
  hasPredictions,
  isRunning,
}: {
  hasPredictions: boolean;
  isRunning: boolean;
}) {
  if (hasPredictions || isRunning) return null;
  return (
    <div className="rounded-xl border border-dashed border-border p-6 flex flex-col items-center gap-2 text-muted-foreground text-sm text-center">
      <Upload className="h-8 w-8 opacity-30" />
      <p>Upload a .nii or .nii.gz file using the bar above, then tap Run Detection.</p>
    </div>
  );
}
