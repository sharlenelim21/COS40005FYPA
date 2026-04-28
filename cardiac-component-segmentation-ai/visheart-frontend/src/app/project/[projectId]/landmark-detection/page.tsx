"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Loader2,
  ArrowLeft,
  Scan,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Heart,
} from "lucide-react";

import { useProject } from "@/context/ProjectContext";
import { LoadingProject } from "@/components/project/LoadingProject";
import { ErrorProject } from "@/components/project/ErrorProject";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useLandmarkDetection } from "@/hooks/useLandmarkDetection";
import { LandmarkSidebar } from "@/components/landmark/LandmarkSidebar";
import { LANDMARK_DEFINITIONS } from "@/types/landmark";
import type { LandmarkPageState } from "@/types/landmark";

const LandmarkSliceViewer = dynamic(
  () => import("@/components/landmark/LandmarkSliceViewer").then((m) => m.LandmarkSliceViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center w-full h-full bg-black rounded-lg">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    ),
  },
);

const ReconstructionGLBViewer = dynamic(
  () => import("@/components/reconstruction/ReconstructionGLBViewer").then((m) => m.ReconstructionGLBViewer),
  { ssr: false },
);

const MODEL_OPTIONS = [
  { value: "hrnet-lv", label: "HRNet-LV" },
] as const;

type ModelId = typeof MODEL_OPTIONS[number]["value"];

export default function LandmarkDetectionPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();

  const {
    loading,
    error,
    projectData,
    hasReconstructions,
    reconstructionCacheReady,
    getReconstructionGLB,
  } = useProject();

  useEffect(() => {
    const name = projectData?.name;
    document.title = name
      ? `VisHeart | ${name} — Landmark Detection`
      : "VisHeart | Landmark Detection";
    return () => { document.title = "VisHeart"; };
  }, [projectData?.name]);

  const [selectedModel, setSelectedModel] = useState<ModelId>("hrnet-lv");

  const {
    state,
    replacementFileError,
    currentPrediction,
    handleRunDetection,
    handleRerunDetection,
    handleFileSelect,
    handleClearReplacementFile,
    handleTogglePlay,
    handleNextFrame,
    handlePrevFrame,
    handleSliderChange,
    handleReset,
  } = useLandmarkDetection(
    projectId,
    {
      width:  projectData?.dimensions?.width,
      height: projectData?.dimensions?.height,
    },
  );

  // Landmark dot visibility
  const [visibleLandmarks, setVisibleLandmarks] = useState<Set<string>>(
    () => new Set(LANDMARK_DEFINITIONS.map((d) => d.id)),
  );

  const handleToggleLandmark = useCallback((id: string) => {
    setVisibleLandmarks((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // 3D model loading (mirrors segmentation page exactly) 
  const [reconstructionModelUrl, setReconstructionModelUrl] = useState<string | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);

  useEffect(() => {
    if (!hasReconstructions || !reconstructionCacheReady) {
      setReconstructionModelUrl(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setIsLoadingModel(true);
      try {
        const url = await getReconstructionGLB(state.currentFrame);
        if (!cancelled) setReconstructionModelUrl(url ?? null);
      } catch {
        if (!cancelled) setReconstructionModelUrl(null);
      } finally {
        if (!cancelled) setIsLoadingModel(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [state.currentFrame, hasReconstructions, reconstructionCacheReady, getReconstructionGLB]);

  // AHA alignment 
  const handleApplyAlignment = useCallback(() => {
    if (process.env.NODE_ENV === "development") {
      console.log("[LandmarkPage] AHA-17 alignment — Sprint 2 W2 D3 integration point");
    }
  }, []);

  const [showLabels, setShowLabels] = useState(true);

  if (loading !== "done") return <LoadingProject loadingStage={loading} />;
  if (error || !projectData) return <ErrorProject error={error ?? undefined} />;

  const isRunning     = state.status === "running";
  const hasPredictions = state.status === "done" && state.predictions.length > 0;

  const imageDimensions =
    state.imageDimensions.width > 0
      ? state.imageDimensions
      : {
          width:  projectData.dimensions?.width  ?? 256,
          height: projectData.dimensions?.height ?? 256,
        };

  // Render 
  return (
    <div className="flex flex-col bg-background" style={{ height: "calc(100vh - 64px)" }}>
      <header className="flex items-center gap-3 px-4 py-2 border-b border-border bg-background flex-shrink-0 flex-wrap">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/project/${projectId}`)}
          className="gap-2 shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Project
        </Button>

        {/* Project name + badges */}
        <div className="flex items-center gap-2 min-w-0">
          <Heart className="h-4 w-4 text-rose-500 shrink-0" aria-hidden />
          <span className="text-sm font-medium truncate">{projectData.name}</span>
          <StatusBadge status={state.status} />
          {hasPredictions && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
              <span className="h-1 w-1 rounded-full bg-blue-500 inline-block" />
              Landmarks Detected
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Info pills */}
        <div className="hidden md:flex items-center gap-4 text-[11px] text-muted-foreground">
          <InfoPill
            label="Dataset"
            value={`${projectData.dimensions?.width ?? 256}×${projectData.dimensions?.height ?? 256}`}
          />
          <InfoPill
            label="Frames"
            value={hasPredictions ? String(state.totalFrames) : String(projectData.dimensions?.frames ?? "—")}
          />
          {hasPredictions && (
            <InfoPill label="Model" value={state.modelUsed} />
          )}
        </div>

        {/* Model selector */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium hidden sm:block">
            Model
          </span>
          <Select
            value={selectedModel}
            onValueChange={(value: string) => setSelectedModel(value as ModelId)}
            disabled={isRunning}
          >
            <SelectTrigger
              size="sm"
              className="min-w-[150px] rounded-xl bg-background px-3 text-xs shadow-sm hover:bg-muted/40"
              aria-label="Select landmark detection model"
            >
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent className="rounded-xl p-1.5 shadow-lg">
              {MODEL_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="rounded-lg py-2 text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Run Detection — primary CTA */}
        <Button
          size="sm"
          className="text-xs gap-1.5 shrink-0"
          onClick={() => handleRunDetection(selectedModel)}
          disabled={isRunning}
        >
          {isRunning ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Detecting…
            </>
          ) : hasPredictions ? (
            <>
              <RefreshCw className="h-3.5 w-3.5" />
              Re-run
            </>
          ) : (
            <>
              <Scan className="h-3.5 w-3.5" />
              Run Detection
            </>
          )}
        </Button>
      </header>
      {state.error && (
        <div
          className="flex items-center gap-2 px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-sm text-destructive flex-shrink-0"
          role="alert"
        >
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="flex-1">{state.error}</span>
          <button
            type="button"
            className="text-xs underline hover:no-underline"
            onClick={() => handleRunDetection(selectedModel)}
          >
            Try again
          </button>
        </div>
      )}

      {/* Mobile layout */}
      <div className="lg:hidden flex-1 overflow-y-auto p-3 space-y-3">
        {/* Mobile: full-width viewer */}
        <div className="aspect-square w-full">
          <LandmarkSliceViewer
            prediction={currentPrediction}
            currentFrame={state.currentFrame}
            totalFrames={state.totalFrames || projectData.dimensions?.frames || 1}
            imageDimensions={imageDimensions}
            visibleLandmarks={visibleLandmarks}
            showLabels={showLabels}
          />
        </div>

        {/* Mobile: landmarks in view */}
        {hasPredictions && (
          <LandmarkLegend
            visibleLandmarks={visibleLandmarks}
            onToggle={handleToggleLandmark}
          />
        )}

        {/* Mobile: Sidebar content as flat stack */}
        <div className="rounded-xl border border-border overflow-hidden">
          <LandmarkSidebar
            state={state}
            currentPrediction={currentPrediction}
            visibleLandmarks={visibleLandmarks}
            replacementFileError={replacementFileError}
            onToggleLandmark={handleToggleLandmark}
            onTogglePlay={handleTogglePlay}
            onNextFrame={handleNextFrame}
            onPrevFrame={handlePrevFrame}
            onSliderChange={handleSliderChange}
            onRerun={() => handleRerunDetection(selectedModel)}
            onReset={handleReset}
            onApplyAlignment={handleApplyAlignment}
            onFileSelect={handleFileSelect}
            onClearReplacementFile={handleClearReplacementFile}
            showLabels={showLabels}
            onToggleShowLabels={() => setShowLabels((p) => !p)}
          />
        </div>
      </div>

      {/* Desktop: 3-panel resizable layout */}
      <div className="hidden lg:block flex-1 min-h-0 p-3">
        <ResizablePanelGroup
          direction="horizontal"
          className="h-full w-full rounded-xl border shadow-sm"
        >
          <ResizablePanel defaultSize={28} minSize={0} maxSize={55}>
            <div className="w-full bg-background p-4 flex flex-col" style={{ height: "calc(100vh - 120px)" }}>
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <h3 className="text-sm font-semibold text-foreground">
                  3D Cardiac Landmark Detection
                </h3>
                {isLoadingModel && (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading…
                  </span>
                )}
              </div>
              <div className="flex-1 min-h-0">
                <ReconstructionGLBViewer
                  modelUrl={reconstructionModelUrl}
                  frame={state.currentFrame + 1}
                  className="w-full h-full"
                />
              </div>
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* CENTER: 2D MRI slice viewer + landmark overlay */}
          <ResizablePanel defaultSize={47}>
            <div
              className="w-full relative bg-muted/40 p-4 flex flex-col gap-3"
              style={{ height: "calc(100vh - 120px)" }}
            >
              {state.status === "idle" && !isRunning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 pointer-events-none">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className="p-4 rounded-full bg-muted/60">
                      <Scan className="h-8 w-8 text-muted-foreground opacity-50" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Ready to detect landmarks
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Press <strong>Run Detection</strong> to analyse this project&apos;s MRI data.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {isRunning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/70 backdrop-blur-sm z-20 rounded-lg">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <div className="text-center">
                    <p className="text-sm font-medium">Running landmark detection…</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      This may take a moment
                    </p>
                  </div>
                </div>
              )}

              {/* Main slice viewer */}
              <div className="flex-1 min-h-0">
                <LandmarkSliceViewer
                  prediction={currentPrediction}
                  currentFrame={state.currentFrame}
                  totalFrames={state.totalFrames || projectData.dimensions?.frames || 1}
                  imageDimensions={imageDimensions}
                  visibleLandmarks={visibleLandmarks}
                  showLabels={showLabels}
                />
              </div>

              {hasPredictions && (
                <div className="flex items-center gap-3 pb-2">
                  <div className="min-w-0 flex-1">
                    <LandmarkLegend
                      visibleLandmarks={visibleLandmarks}
                      onToggle={handleToggleLandmark}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowLabels((p) => !p)}
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-lg border border-border bg-background px-3 py-1.5",
                      "text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted/60",
                    )}
                  >
                    {showLabels ? "Hide labels" : "Show labels"}
                  </button>
                </div>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* RIGHT: Sidebar */}
          <ResizablePanel defaultSize={25} minSize={0} maxSize={50}>
            <div className="h-full w-full">
              <LandmarkSidebar
                state={state}
                currentPrediction={currentPrediction}
                visibleLandmarks={visibleLandmarks}
                replacementFileError={replacementFileError}
                onToggleLandmark={handleToggleLandmark}
                onTogglePlay={handleTogglePlay}
                onNextFrame={handleNextFrame}
                onPrevFrame={handlePrevFrame}
                onSliderChange={handleSliderChange}
                onRerun={() => handleRerunDetection(selectedModel)}
                onReset={handleReset}
                onApplyAlignment={handleApplyAlignment}
                onFileSelect={handleFileSelect}
                onClearReplacementFile={handleClearReplacementFile}
                showLabels={showLabels}
                onToggleShowLabels={() => setShowLabels((p) => !p)}
              />
            </div>
          </ResizablePanel>

        </ResizablePanelGroup>
      </div>
    </div>
  );
}

// Local sub-components  

function StatusBadge({ status }: { status: LandmarkPageState["status"] }) {
  const map = {
    idle:    { label: "Ready",     cls: "bg-muted text-muted-foreground" },
    running: { label: "Running",   cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400" },
    done:    { label: "Complete",  cls: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" },
    error:   { label: "Error",     cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" },
  } as const;

  const { label, cls } = map[status];

  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full", cls)}>
      {status === "running" ? (
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
    <div className="flex items-center gap-1 tabular-nums">
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
    <div className="flex flex-wrap gap-1.5 px-1" role="group" aria-label="Landmark visibility">
      {LANDMARK_DEFINITIONS.map((def) => {
        const on = visibleLandmarks.has(def.id);
        return (
          <button
            key={def.id}
            type="button"
            onClick={() => onToggle(def.id)}
            aria-pressed={on}
            className={cn(
              "flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium transition-all",
              on
                ? "border-transparent text-white"
                : "border-border bg-transparent text-muted-foreground/60",
            )}
            style={on ? { backgroundColor: def.color } : {}}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: on ? "rgba(255,255,255,0.8)" : def.color }}
            />
            {def.label}
          </button>
        );
      })}
    </div>
  );
}
