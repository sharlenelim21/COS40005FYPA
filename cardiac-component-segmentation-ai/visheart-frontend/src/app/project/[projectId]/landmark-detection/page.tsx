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

const MODEL_OPTIONS = [
  { value: "unetresnet34-landmark", label: "UNetResNet34 Model" },
] as const;

type ModelId = typeof MODEL_OPTIONS[number]["value"];

export default function LandmarkDetectionPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();

  const {
    loading,
    error,
    projectData,
    decodedMasks,
    getMRIImage,
    tarCacheReady,
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
      frames: projectData?.dimensions?.frames,
      slices: projectData?.dimensions?.slices,
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

  // AHA alignment 
  const handleApplyAlignment = useCallback(() => {
    if (process.env.NODE_ENV === "development") {
      console.log("[LandmarkPage] AHA-17 alignment — Sprint 2 W2 D3 integration point");
    }
  }, []);

  const [showLabels, setShowLabels] = useState(true);
  const [frameImageUrl, setFrameImageUrl] = useState<string | null>(null);

  const currentSlice = currentPrediction?.slice_id ?? Math.floor((projectData?.dimensions?.slices ?? 1) / 2);
  const currentImageFrame = currentPrediction?.frame_id ?? state.currentFrame;
  const usesSlicePlayback = (projectData?.dimensions?.frames ?? 0) <= 1 && (projectData?.dimensions?.slices ?? 0) > 1;

  useEffect(() => {
    let cancelled = false;
    if (!projectData || !tarCacheReady) {
      setFrameImageUrl(null);
      return;
    }

    getMRIImage(currentImageFrame, currentSlice)
      .then((url) => {
        if (!cancelled) setFrameImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFrameImageUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [getMRIImage, currentImageFrame, currentSlice, projectData, tarCacheReady]);

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
            label={usesSlicePlayback ? "Slices" : "Frames"}
            value={
              hasPredictions
                ? String(state.totalFrames)
                : String(usesSlicePlayback ? projectData.dimensions?.slices ?? "—" : projectData.dimensions?.frames ?? "—")
            }
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
          onClick={() => {
            if (hasPredictions) handleRerunDetection(selectedModel);
            else handleRunDetection(selectedModel);
          }}
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
            decodedMasks={decodedMasks}
            currentSlice={currentSlice}
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
                <h3 className="text-sm font-semibold text-foreground">
                  AHA 17-Segment Bullseye
                </h3>
              </div>
              <div className="flex-1 min-h-0 rounded-lg border bg-muted/20 p-4">
                <AhaBullseyeChart />
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
                  frameImageUrl={frameImageUrl}
                  decodedMasks={decodedMasks}
                  currentSlice={currentSlice}
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

const AHA_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6",
  "#f43f5e", "#fb923c", "#facc15", "#4ade80", "#2dd4bf", "#60a5fa",
  "#e11d48", "#ea580c", "#ca8a04", "#16a34a", "#0d9488",
] as const;

function AhaBullseyeChart() {
  const cx = 180;
  const cy = 180;
  const rings = [
    { inner: 122, outer: 160, count: 6, offset: -90, start: 0 },
    { inner: 84, outer: 122, count: 6, offset: -90, start: 6 },
    { inner: 42, outer: 84, count: 4, offset: -45, start: 12 },
  ];

  return (
    <div className="flex h-full min-h-[360px] flex-col">
      <div className="flex flex-1 items-center justify-center">
        <svg viewBox="0 0 360 360" role="img" aria-label="AHA 17-segment bullseye chart" className="h-full max-h-[520px] w-full">
          {rings.flatMap((ring) =>
            Array.from({ length: ring.count }, (_, index) => {
              const startAngle = ring.offset + (360 / ring.count) * index;
              const endAngle = startAngle + 360 / ring.count;
              const segmentIndex = ring.start + index;
              const labelAngle = ((startAngle + endAngle) / 2) * (Math.PI / 180);
              const labelRadius = (ring.inner + ring.outer) / 2;

              return (
                <g key={segmentIndex}>
                  <path
                    d={describeArcSegment(cx, cy, ring.inner, ring.outer, startAngle, endAngle)}
                    fill={AHA_COLORS[segmentIndex]}
                    stroke="hsl(var(--background))"
                    strokeWidth="2"
                  />
                  <text
                    x={cx + labelRadius * Math.cos(labelAngle)}
                    y={cy + labelRadius * Math.sin(labelAngle)}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-white text-[13px] font-semibold"
                  >
                    {segmentIndex + 1}
                  </text>
                  <title>{`${segmentIndex + 1}. ${AHA_SEGMENTS[segmentIndex]}`}</title>
                </g>
              );
            }),
          )}
          <circle cx={cx} cy={cy} r="42" fill={AHA_COLORS[16]} stroke="hsl(var(--background))" strokeWidth="2" />
          <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" className="fill-white text-[14px] font-semibold">17</text>
          <title>17. Apex</title>
          <text x={cx} y="26" textAnchor="middle" className="fill-muted-foreground text-[12px] font-medium">Anterior</text>
          <text x={cx} y="346" textAnchor="middle" className="fill-muted-foreground text-[12px] font-medium">Inferior</text>
          <text x="28" y={cy} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[12px] font-medium">Septal</text>
          <text x="332" y={cy} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[12px] font-medium">Lateral</text>
        </svg>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {AHA_SEGMENTS.map((segment, index) => (
          <div key={segment} className="flex min-w-0 items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: AHA_COLORS[index] }} />
            <span className="truncate">{index + 1}. {segment}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function describeArcSegment(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  const startOuter = polarToCartesian(cx, cy, outerRadius, endAngle);
  const endOuter = polarToCartesian(cx, cy, outerRadius, startAngle);
  const startInner = polarToCartesian(cx, cy, innerRadius, startAngle);
  const endInner = polarToCartesian(cx, cy, innerRadius, endAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M", startOuter.x, startOuter.y,
    "A", outerRadius, outerRadius, 0, largeArcFlag, 0, endOuter.x, endOuter.y,
    "L", startInner.x, startInner.y,
    "A", innerRadius, innerRadius, 0, largeArcFlag, 1, endInner.x, endInner.y,
    "Z",
  ].join(" ");
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
  const angleInRadians = angleInDegrees * (Math.PI / 180);

  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
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
