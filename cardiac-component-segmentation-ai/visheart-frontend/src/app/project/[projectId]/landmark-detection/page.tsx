"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import {
  Loader2,
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
import type { LandmarkMaskOverlay } from "@/components/landmark/LandmarkSliceViewer";
import { AHA_SEGMENT_COLORS, LANDMARK_DEFINITIONS } from "@/types/landmark";
import { ANATOMICAL_LABELS, type AnatomicalLabel } from "@/types/segmentation";
import type { LandmarkPageState } from "@/types/landmark";
import { segmentationApi } from "@/lib/api";
import type { BullseyeData } from "@/types/project";

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

const MODEL_OPTIONS = [
  { value: "unetresnet34-landmark", label: "UNetResNet34" },
] as const;

type ModelId = typeof MODEL_OPTIONS[number]["value"];

const AHA_SEGMENTS = [
  "Basal Anterior",
  "Basal Anteroseptal",
  "Basal Inferoseptal",
  "Basal Inferior",
  "Basal Inferolateral",
  "Basal Anterolateral",
  "Mid Anterior",
  "Mid Anteroseptal",
  "Mid Inferoseptal",
  "Mid Inferior",
  "Mid Inferolateral",
  "Mid Anterolateral",
  "Apical Anterior",
  "Apical Septal",
  "Apical Inferior",
  "Apical Lateral",
  "Apex",
] as const;

export default function LandmarkDetectionPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const {
    loading,
    error,
    projectData,
    decodedMasks,
    getMRIImage,
  } = useProject();

  useEffect(() => {
    const name = projectData?.name;
    document.title = name
      ? `VisHeart | ${name} — Landmark Detection`
      : "VisHeart | Landmark Detection";
    return () => { document.title = "VisHeart"; };
  }, [projectData?.name]);

  const [selectedModel, setSelectedModel] = useState<ModelId>("unetresnet34-landmark");

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
    handlePlaybackSpeedChange,
    handleReset,
  } = useLandmarkDetection(
    projectId,
    {
      width:  projectData?.dimensions?.width,
      height: projectData?.dimensions?.height,
    },
  );

  // Bullseye data
  const [bullseyeData, setBullseyeData] = useState<BullseyeData | null | undefined>(undefined);
  const [bullseyeLoading, setBullseyeLoading] = useState(true);

  const fetchBullseye = useCallback(async () => {
    setBullseyeLoading(true);
    try {
      const res = await segmentationApi.getSegmentationResults(projectId);
      const mask = (res.segmentations as Array<{ isMedSAMOutput: boolean; bullseye?: BullseyeData }>)
        ?.find((m) => !m.isMedSAMOutput);
      setBullseyeData(mask?.bullseye ?? null);
    } catch {
      setBullseyeData(null);
    } finally {
      setBullseyeLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchBullseye();
  }, [fetchBullseye]);

  // Landmark dot visibility
  const [visibleLandmarks, setVisibleLandmarks] = useState<Set<string>>(
    () => new Set(LANDMARK_DEFINITIONS.map((d) => d.id)),
  );

  const handleToggleLandmark = useCallback((id: string) => {
    setVisibleLandmarks((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // AHA alignment
  const [ahaAlignmentAngle, setAhaAlignmentAngle] = useState<number | null>(null);

  // Refetch bullseye after detection finishes; clear alignment on new run
  const prevStatus = useRef(state.status);
  useEffect(() => {
    if (prevStatus.current !== state.status) {
      if (state.status === "running") {
        setAhaAlignmentAngle(null);
      }
      if (prevStatus.current === "running" && state.status === "done") {
        fetchBullseye();
      }
    }
    prevStatus.current = state.status;
  }, [state.status, fetchBullseye]);

  const handleApplyAlignment = useCallback(() => {
    if (!currentPrediction) return;
    const { rv_insertion_1, rv_insertion_2 } = currentPrediction;
    if (!rv_insertion_1 || !rv_insertion_2) return;

    const rvMidX = (rv_insertion_1[0] + rv_insertion_2[0]) / 2;
    const rvMidY = (rv_insertion_1[1] + rv_insertion_2[1]) / 2;

    const dims =
      state.imageDimensions.width > 0
        ? state.imageDimensions
        : { width: projectData?.dimensions?.width ?? 256, height: projectData?.dimensions?.height ?? 256 };
    const cx = dims.width / 2;
    const cy = dims.height / 2;

    // Angle from LV centroid to RV midpoint = Septal direction.
    // SVG Y-axis is flipped, so negate dy to get standard math coords.
    const septalAngleDeg = (Math.atan2(-(rvMidY - cy), rvMidX - cx) * 180) / Math.PI;

    // Anterior is 90° CCW from Septal in standard CMR convention.
    // The chart default has Anterior at -90° (top), so the offset is
    // (septalAngleDeg + 90) relative to that default top position.
    const offset = septalAngleDeg + 90;
    setAhaAlignmentAngle(offset);
  }, [currentPrediction, state.imageDimensions, projectData?.dimensions]);

  const handleResetAlignment = useCallback(() => {
    setAhaAlignmentAngle(null);
  }, []);

  const [showLabels, setShowLabels] = useState(true);
  const [frameImageUrl, setFrameImageUrl] = useState<string | null>(null);

  const isRunning     = state.status === "running";
  const hasPredictions = state.status === "done" && state.predictions.length > 0;

  const imageDimensions =
    state.imageDimensions.width > 0
      ? state.imageDimensions
      : {
          width:  projectData?.dimensions?.width  ?? 256,
          height: projectData?.dimensions?.height ?? 256,
        };

  const currentImageFrame = currentPrediction?.frame_id ?? state.currentFrame;
  const currentImageSlice = currentPrediction?.slice_id ?? 0;

  useEffect(() => {
    let cancelled = false;

    async function loadFrameImage() {
      if (!hasPredictions) {
        setFrameImageUrl(null);
        return;
      }

      const cachedUrl = await getMRIImage(currentImageFrame, currentImageSlice);
      if (cancelled) return;

      setFrameImageUrl(
        cachedUrl ??
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000"}/api/projects/${projectId}/images/frame_${currentImageFrame}_slice_${currentImageSlice}.jpeg`,
      );
    }

    loadFrameImage();
    return () => {
      cancelled = true;
    };
  }, [hasPredictions, getMRIImage, currentImageFrame, currentImageSlice, projectId]);

  const currentMaskOverlays = useMemo<LandmarkMaskOverlay[]>(() => {
    if (!decodedMasks || !hasPredictions) return [];

    const overlays: LandmarkMaskOverlay[] = [];
    for (const label of ANATOMICAL_LABELS) {
      const frameSlice = `_frame_${currentImageFrame}_slice_${currentImageSlice}_`;
      const directKeys = [
        `editable_frame_${currentImageFrame}_slice_${currentImageSlice}_${label}`,
        `medSamOutput_frame_${currentImageFrame}_slice_${currentImageSlice}_${label}`,
      ];
      const matchedKey =
        directKeys.find((key) => decodedMasks[key]) ??
        Object.keys(decodedMasks).find(
          (key) => key.includes(frameSlice) && key.toLowerCase().endsWith(`_${label}`),
        );
      const mask = matchedKey ? decodedMasks[matchedKey] : null;

      if (mask) {
        overlays.push({ label: label as AnatomicalLabel, mask });
      }
    }

    return overlays;
  }, [decodedMasks, hasPredictions, currentImageFrame, currentImageSlice]);

  if (loading !== "done") return <LoadingProject loadingStage={loading} />;
  if (error || !projectData) return <ErrorProject error={error ?? undefined} />;

  // Render 
  return (
    <div className="flex flex-col bg-background" style={{ height: "calc(100vh - 64px)" }}>
      <header className="flex items-center gap-3 px-4 py-2 border-b border-border bg-background flex-shrink-0 flex-wrap">

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
            frameImageUrl={frameImageUrl}
            maskOverlays={currentMaskOverlays}
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
            onPlaybackSpeedChange={handlePlaybackSpeedChange}
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
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    AHA 17-Segment Bullseye
                  </h3>
                  {ahaAlignmentAngle !== null && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                      <span className="h-1 w-1 rounded-full bg-emerald-500 inline-block" />
                      AHA Aligned
                    </span>
                  )}
                </div>
                {ahaAlignmentAngle !== null && (
                  <button
                    type="button"
                    onClick={handleResetAlignment}
                    className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors shrink-0"
                  >
                    Reset Orientation
                  </button>
                )}
              </div>
              <AhaBullseyePanel
                bullseyeData={bullseyeData}
                loading={bullseyeLoading}
                referenceAngleDeg={ahaAlignmentAngle ?? 0}
                frameCount={
                  (projectData?.dimensions?.frames && projectData.dimensions.frames > 0)
                    ? projectData.dimensions.frames
                    : (projectData?.dimensions?.slices && projectData.dimensions.slices > 0)
                    ? projectData.dimensions.slices
                    : 1
                }
                isAligned={ahaAlignmentAngle !== null}
              />
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
                  frameImageUrl={frameImageUrl}
                  maskOverlays={currentMaskOverlays}
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
                onPlaybackSpeedChange={handlePlaybackSpeedChange}
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

function rdYlGn(t: number): string {
  // Red (0) → Yellow (0.5) → Green (1)
  const r = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
  const g = t < 0.5 ? t * 2 : 1;
  const ri = Math.round(r * 255);
  const gi = Math.round(g * 255);
  return `rgb(${ri},${gi},0)`;
}

function segmentColor(value: number, min: number, max: number): string {
  if (max === min) return AHA_SEGMENT_COLORS[0];
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return rdYlGn(t);
}

function AhaBullseyePanel({
  bullseyeData,
  loading,
  referenceAngleDeg = 0,
  frameCount = 1,
  isAligned = false,
}: {
  bullseyeData: BullseyeData | null | undefined;
  loading: boolean;
  referenceAngleDeg?: number;
  frameCount?: number;
  isAligned?: boolean;
}) {
  return (
    <div className="flex-1 min-h-0 rounded-lg border border-border bg-background p-3 flex flex-col overflow-hidden">
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-xs">Loading bullseye…</span>
          </div>
        </div>
      ) : !isAligned ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-4">
          <Heart className="h-8 w-8 text-muted-foreground opacity-25" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Apply AHA-17 Alignment to view polar maps
          </p>
          <div className="w-full pt-3 border-t border-border">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-4 gap-y-2">
              {AHA_SEGMENTS.map((label, index) => (
                <div key={label} className="flex items-center gap-2 min-w-0 text-[11px] text-muted-foreground">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: AHA_SEGMENT_COLORS[index] }} />
                  <span className="truncate">{index + 1}. {label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : !bullseyeData ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
          <AlertCircle className="h-6 w-6 text-muted-foreground opacity-50" />
          <p className="text-xs text-muted-foreground">
            Run reconstruction first to generate bullseye data
          </p>
        </div>
      ) : (
        <>
          <p className="text-[10px] text-muted-foreground mb-2 flex-shrink-0">
            {frameCount} frame{frameCount !== 1 ? "s" : ""}
          </p>
          <BullseyeFrameGrid
            bullseyeData={bullseyeData}
            frameCount={frameCount}
            referenceAngleDeg={referenceAngleDeg}
          />
          {/* Shared color scale legend */}
          <div className="flex-shrink-0 pt-2 border-t border-border mt-2 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground tabular-nums">{bullseyeData.stats.min.toFixed(1)}</span>
              <div
                className="flex-1 h-3 rounded-full"
                style={{
                  background: "linear-gradient(to right, #d73027, #fc8d59, #fee08b, #d9ef8b, #91cf60, #1a9850)",
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              />
              <span className="text-[10px] text-muted-foreground tabular-nums">{bullseyeData.stats.max.toFixed(1)}</span>
            </div>
            <p className="text-center text-[10px] text-muted-foreground">Wall Thickness (px)</p>
          </div>
          {/* Stats row */}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 pb-1 flex-shrink-0">
            <span>Min: <span className="font-mono font-semibold text-white">{bullseyeData.stats.min.toFixed(2)}</span></span>
            <span className="text-zinc-600">|</span>
            <span>Mean: <span className="font-mono font-semibold text-white">{bullseyeData.stats.mean.toFixed(2)}</span></span>
            <span className="text-zinc-600">|</span>
            <span>Max: <span className="font-mono font-semibold text-white">{bullseyeData.stats.max.toFixed(2)}</span></span>
          </div>
          {bullseyeData.stats.n_nan > 0 && (
            <p className="text-[10px] text-amber-600 dark:text-amber-400 pb-1 flex-shrink-0">
              ⚠ {bullseyeData.stats.n_nan} segment{bullseyeData.stats.n_nan > 1 ? "s" : ""} missing data
            </p>
          )}
          {/* Segment legend */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-4 gap-y-1 pt-1 flex-shrink-0">
            {bullseyeData.segment_metadata.map((seg) => (
              <div key={seg.idx} className="flex items-center gap-2 min-w-0 text-[11px] text-muted-foreground">
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: segmentColor(seg.value, bullseyeData.stats.min, bullseyeData.stats.max) }}
                />
                <span className="truncate" title={`${seg.name}: ${seg.value.toFixed(2)} px`}>
                  {seg.idx}. {seg.name}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BullseyeFrameGrid({
  bullseyeData,
  frameCount,
  referenceAngleDeg,
}: {
  bullseyeData: BullseyeData;
  frameCount: number;
  referenceAngleDeg: number;
}) {
  return (
    <div className="flex-1 overflow-y-auto min-h-0 bg-zinc-900/30 rounded-lg p-2">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 pb-1">
        {Array.from({ length: frameCount }, (_, i) => (
          <div key={i} className="flex flex-col items-center p-2 rounded-xl bg-zinc-800/40 border border-zinc-700/30">
            <div className="flex items-center justify-center mb-1">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-zinc-700/80 text-zinc-100 border border-zinc-600">
                Frame {i + 1}
              </span>
            </div>
            <AhaBullseyeChart
              bullseyeData={bullseyeData}
              referenceAngleDeg={referenceAngleDeg}
              size={240}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function AhaBullseyeChart({
  bullseyeData,
  referenceAngleDeg = 0,
  size = 300,
}: {
  bullseyeData: BullseyeData;
  referenceAngleDeg?: number;
  size?: number;
}) {
  const center = 150;
  const basalOuter = 118;
  const basalInner = 88;
  const midInner = 58;
  const apicalInner = 30;
  const { segment_values, stats, segment_metadata } = bullseyeData;

  // Cardinal label positions rotate with the reference angle.
  const anteriorPt  = polarPoint(center, 135, -90 + referenceAngleDeg);
  const septalPt    = polarPoint(center, 135,   0 + referenceAngleDeg);
  const lateralPt   = polarPoint(center, 135, 180 + referenceAngleDeg);
  const inferiorPt  = polarPoint(center, 135,  90 + referenceAngleDeg);

  return (
    <svg
      viewBox="0 0 300 300"
      role="img"
      aria-label="AHA 17-segment bullseye chart"
      style={{ width: size, height: size }}
      className="h-auto w-full"
    >
      <text x={anteriorPt.x} y={anteriorPt.y} textAnchor="middle" fontSize="11" fontWeight="600" fill="rgba(255,255,255,0.85)">
        Anterior
      </text>
      <text x={septalPt.x} y={septalPt.y} textAnchor="middle" fontSize="11" fontWeight="600" fill="rgba(255,255,255,0.85)">
        Septal
      </text>
      <text x={lateralPt.x} y={lateralPt.y} textAnchor="middle" fontSize="11" fontWeight="600" fill="rgba(255,255,255,0.85)">
        Lateral
      </text>
      <text x={inferiorPt.x} y={inferiorPt.y} textAnchor="middle" fontSize="11" fontWeight="600" fill="rgba(255,255,255,0.85)">
        Inferior
      </text>

      {Array.from({ length: 6 }, (_, index) => (
        <BullseyeSegment
          key={`basal-${index}`}
          index={index}
          center={center}
          innerRadius={basalInner}
          outerRadius={basalOuter}
          startAngle={-90 + index * 60 + referenceAngleDeg}
          endAngle={-90 + (index + 1) * 60 + referenceAngleDeg}
          value={segment_values[index]}
          tooltip={segment_metadata[index]}
          min={stats.min}
          max={stats.max}
        />
      ))}
      {Array.from({ length: 6 }, (_, index) => (
        <BullseyeSegment
          key={`mid-${index}`}
          index={index + 6}
          center={center}
          innerRadius={midInner}
          outerRadius={basalInner}
          startAngle={-90 + index * 60 + referenceAngleDeg}
          endAngle={-90 + (index + 1) * 60 + referenceAngleDeg}
          value={segment_values[index + 6]}
          tooltip={segment_metadata[index + 6]}
          min={stats.min}
          max={stats.max}
        />
      ))}
      {Array.from({ length: 4 }, (_, index) => (
        <BullseyeSegment
          key={`apical-${index}`}
          index={index + 12}
          center={center}
          innerRadius={apicalInner}
          outerRadius={midInner}
          startAngle={-90 + index * 90 + referenceAngleDeg}
          endAngle={-90 + (index + 1) * 90 + referenceAngleDeg}
          value={segment_values[index + 12]}
          tooltip={segment_metadata[index + 12]}
          min={stats.min}
          max={stats.max}
        />
      ))}
      <circle
        cx={center}
        cy={center}
        r={apicalInner}
        fill={segmentColor(segment_values[16], stats.min, stats.max)}
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="0.8"
      >
        <title>{segment_metadata[16]?.name}: {segment_values[16]?.toFixed(2)} px</title>
      </circle>
      <text
        x={center}
        y={center - 2}
        textAnchor="middle"
        dominantBaseline="auto"
        fontSize="9"
        fontWeight="600"
        fill="white"
        style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.9))" }}
      >
        17
      </text>
      <text
        x={center}
        y={center + 9}
        textAnchor="middle"
        dominantBaseline="auto"
        fontSize="8"
        fontWeight="600"
        fill="white"
        style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.9))" }}
      >
        {segment_values[16].toFixed(1)}
      </text>
    </svg>
  );
}

function BullseyeSegment({
  index,
  center,
  innerRadius,
  outerRadius,
  startAngle,
  endAngle,
  value,
  tooltip,
  min,
  max,
}: {
  index: number;
  center: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
  value: number;
  tooltip: { name: string; value: number } | undefined;
  min: number;
  max: number;
}) {
  const midAngle = (startAngle + endAngle) / 2;
  const labelRadius = (innerRadius + outerRadius) / 2;
  const label = polarPoint(center, labelRadius, midAngle);
  const fill = segmentColor(value, min, max);

  const radialWidth = outerRadius - innerRadius;
  const showValue = radialWidth >= 20;

  return (
    <g>
      <path
        d={annularSectorPath(center, innerRadius, outerRadius, startAngle, endAngle)}
        fill={fill}
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="0.8"
      >
        {tooltip && (
          <title>{tooltip.name}: {tooltip.value.toFixed(2)} px</title>
        )}
      </path>
      <text
        x={label.x}
        y={label.y + (showValue ? 0 : 4)}
        textAnchor="middle"
        dominantBaseline="auto"
        fontSize="9"
        fontWeight="600"
        fill="white"
        style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.9))" }}
      >
        {index + 1}
      </text>
      {showValue && (
        <text
          x={label.x}
          y={label.y + 11}
          textAnchor="middle"
          dominantBaseline="auto"
          fontSize="8"
          fontWeight="600"
          fill="white"
          style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.9))" }}
        >
          {value.toFixed(1)}
        </text>
      )}
    </g>
  );
}

function polarPoint(center: number, radius: number, angleDegrees: number) {
  const angle = (angleDegrees * Math.PI) / 180;
  return {
    x: center + radius * Math.cos(angle),
    y: center + radius * Math.sin(angle),
  };
}

function annularSectorPath(
  center: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  const outerStart = polarPoint(center, outerRadius, startAngle);
  const outerEnd = polarPoint(center, outerRadius, endAngle);
  const innerEnd = polarPoint(center, innerRadius, endAngle);
  const innerStart = polarPoint(center, innerRadius, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

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
