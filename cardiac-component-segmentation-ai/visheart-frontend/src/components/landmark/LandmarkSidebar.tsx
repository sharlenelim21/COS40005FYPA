"use client";

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useProjectResults } from "@/hooks/useProjectResults";
import { useProject } from "@/context/ProjectContext";
import { computeStrainSeries, computeRvStrainSeries } from "@/lib/landmarkApi";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  MapPin,
  LayoutGrid,
  Activity,
  Brain,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Loader2,
  Upload,
  X,
  AlertCircle,
  Trash2,
  Pencil,
} from "lucide-react";
import {
  LANDMARK_DEFINITIONS,
  getLandmarkCoord,
} from "@/types/landmark";
import type { LandmarkPageState, FramePrediction } from "@/types/landmark";
import { getDummyStrainData, getStrainColor, type StrainType, type RealStrainResult, type RvStrainResult } from "@/components/landmark/StrainVisualization";
import { RegionalStrainByRegion, FullCycleChart, LVSegmentsLegend, buildDummyCycleSeries } from "@/components/landmark/RegionalStrainCharts";
import { DualFrameRangePicker } from "@/components/landmark/DualFrameRangePicker";

/**
 * Everything the sidebar's "Compute strain" card (Strain tab) needs to render
 * and act — state and real compute handlers are owned by the page
 * (landmark-detection/page.tsx) since the bullseye/3D-heart visualization
 * that consumes the same edFrameIdx/esFrameIdx/results also lives there, as a
 * sibling of this sidebar. Bundled into one prop instead of ~18 individual
 * ones passed down through LandmarkSidebar -> StrainTab.
 */
export interface StrainComputeBundle {
  scope: "quick" | "full";
  onScopeChange: (scope: "quick" | "full") => void;
  inputMode: "frames" | "upload";
  onInputModeChange: (mode: "frames" | "upload") => void;
  edFrameIdx: number;
  esFrameIdx: number;
  onEdFrameChange: (value: number) => void;
  onEsFrameChange: (value: number) => void;
  autoFrames: { ed: number; es: number } | null;
  onResetToAuto: () => void;
  /** Frame count for the ED/ES picker — the mask's actual frame count, same
   *  set heart-metrics uses, so the auto-detected ED/ES stay reachable. */
  frameCount: number;
  edFile: File | null;
  esFile: File | null;
  onEdFileChange: (file: File | null) => void;
  onEsFileChange: (file: File | null) => void;
  isComputing: boolean;
  error: string | null;
  hasLandmarkAlignment: boolean;
  strainModel: "unet" | "medsam";
  onComputeFrames: () => void;
  onComputeUpload: () => void;
  /** The stored LV/RV strain result IF it matches the current Quick ED->ES
   *  selection (right model, right frame pair) — null otherwise, including
   *  when nothing has been computed yet or the stored result is a full-cycle
   *  one. Drives the Quick-scope "peak value only" view in the Strain tab. */
  quickLvResult: RealStrainResult | null;
  quickRvResult: RvStrainResult | null;
  /** RV's own metric toggle (GCS/GAS) — GAS has no computation in the
   *  pipeline at all, so selecting it must render as an explicit prototype
   *  state, never fabricated values. */
  rvMetricType: "GCS" | "GAS";
  onRvMetricTypeChange: (type: "GCS" | "GAS") => void;
  /** Reports Full cycle's busy state up to the page, so the main panel can
   *  show a loading state too while "Compute/Recompute all frames" runs
   *  (StrainTab's own seriesBusy is local and the page can't see it otherwise). */
  onFullCycleBusyChange: (busy: boolean) => void;
}

const NAV_ITEMS = [
  { key: "landmarks", icon: MapPin,     label: "Landmarks" },
  { key: "structure", icon: LayoutGrid, label: "Structure" },
  { key: "strain",    icon: Activity,   label: "Strain"    },
] as const;

type TabKey = typeof NAV_ITEMS[number]["key"];
const SIDEBAR_LANDMARK_IDS = new Set(["rv_insertion_1", "rv_insertion_2"]);
const EMPTY_STRING_SET = new Set<string>();

function strainCurveData(type: StrainType, totalFrames: number) {
  const frames = Math.max(totalFrames || 10, 1);
  return Array.from({ length: frames }, (_, frame) => {
    const values = getDummyStrainData(type, frame, frames);
    const average = values.reduce((sum, item) => sum + item.strain, 0) / values.length;
    return {
      frame: frame + 1,
      time: Math.round((frame / Math.max(frames - 1, 1)) * 1200),
      strain: Number(average.toFixed(1)),
    };
  });
}

// Props 
export interface LandmarkSidebarProps {
  state: LandmarkPageState;
  currentPrediction: FramePrediction | null;
  visibleLandmarks: Set<string>;
  replacementFileError: string | null;
  confidentCount?: number;
  onStrainFrameChange?: (frame: number) => void;
  onTabChange?: (tab: "landmarks" | "structure" | "strain") => void;
  activeTab?: "landmarks" | "structure" | "strain";
  activeModel?: "unet" | "medsam";
  onModelChange?: (m: "unet" | "medsam") => void;
  structureVentricle?: "LV" | "RV";
  onStructureVentricleChange?: (v: "LV" | "RV") => void;
  structureStats?: { min: number | null; mean: number | null; max: number | null } | null;
  hasUnsavedLandmarkEdits?: boolean;
  isSavingLandmarks?: boolean;
  onSaveLandmarks?: () => void;
  onToggleLandmark: (id: string) => void;
  currentSliceKey?: string;
  pendingDeletions?: Record<string, number>;
  onDeleteLandmark?: (id: string) => void;
  onUndoDeleteLandmark?: (id: string) => void;
  manuallyDeletedSliceKeys?: Set<string>;
  onTogglePlay: () => void;
  onNextFrame: () => void;
  onPrevFrame: () => void;
  onSliderChange: (frame: number) => void;
  onPlaybackSpeedChange: (fps: number) => void;
  onRerun: () => void;
  onReset: () => void;
  onFileSelect: (file: File | null) => void;
  onClearReplacementFile: () => void;
  showLabels: boolean;
  onToggleShowLabels: () => void;
  editableLandmarks?: boolean;
  onToggleEditableLandmarks?: () => void;
  highlightedLandmarkId?: string | null;
  onHighlightLandmark?: (id: string | null) => void;
  selectedStrainType?: StrainType;
  onStrainTypeChange?: (type: StrainType) => void;
  strainCompute?: StrainComputeBundle;
}

export function LandmarkSidebar({
  state,
  currentPrediction,
  visibleLandmarks,
  replacementFileError,
  confidentCount,
  onStrainFrameChange,
  onTabChange,
  activeTab: activeTabProp,
  activeModel,
  onModelChange,
  structureVentricle = "LV",
  onStructureVentricleChange,
  structureStats,
  hasUnsavedLandmarkEdits,
  isSavingLandmarks,
  onSaveLandmarks,
  onToggleLandmark,
  currentSliceKey,
  pendingDeletions,
  onDeleteLandmark,
  onUndoDeleteLandmark,
  manuallyDeletedSliceKeys,
  onTogglePlay,
  onNextFrame,
  onPrevFrame,
  onSliderChange,
  onPlaybackSpeedChange,
  onRerun,
  onReset,
  onFileSelect,
  onClearReplacementFile,
  showLabels,
  onToggleShowLabels,
  editableLandmarks = false,
  onToggleEditableLandmarks,
  highlightedLandmarkId,
  onHighlightLandmark,
  selectedStrainType = "GCS",
  onStrainTypeChange,
  strainCompute,
}: LandmarkSidebarProps) {
  // Controlled by the page when provided (see activeTab prop) so a remount
  // can't desync the sidebar tab from the page's workspace; otherwise falls
  // back to local state.
  const [localTab, setLocalTab] = useState<TabKey>("landmarks");
  const activeTab: TabKey = activeTabProp ?? localTab;

  // Strain playback runs on its own axis: the cardiac CYCLE (frames), whereas
  // state.currentFrame/totalFrames track SLICES (landmark detection is per
  // slice). Keeping them separate is what fixes playback showing 1/10 on a
  // 30-frame study.
  //
  // The frame index is reported upward (onStrainFrameChange) because the
  // bullseye and 3D heart are rendered by the page, not here — without that
  // they would keep animating on the slice index and disagree with this
  // playback bar.
  const { projectData: sidebarProject } = useProject();
  const strainFrameCount = Math.max(sidebarProject?.dimensions?.frames ?? 0, 1);
  const [strainFrame, setStrainFrame] = useState(0);
  const [strainPlaying, setStrainPlaying] = useState(false);
  useEffect(() => { onStrainFrameChange?.(strainFrame); }, [strainFrame, onStrainFrameChange]);

  // Landmark and strain playback are independent loops (slices vs. frames).
  // Switching tabs pauses BOTH, so a loop started in one tab can't keep running
  // while the user thinks the playback bar in the other tab is what's moving.
  const handleTabChange = useCallback(
    (key: TabKey) => {
      setStrainPlaying(false);
      if (state.isPlaying) onTogglePlay();
      setLocalTab(key);
      onTabChange?.(key);
    },
    [onTabChange, onTogglePlay, state.isPlaying],
  );
  useEffect(() => {
    if (!strainPlaying || strainFrameCount < 2) return;
    const id = setInterval(
      () => setStrainFrame((f) => (f + 1) % strainFrameCount),
      1000 / Math.max(state.playbackFps || 2, 0.5),
    );
    return () => clearInterval(id);
  }, [strainPlaying, strainFrameCount, state.playbackFps]);
  // Keep the index valid if the project's frame count arrives late or changes.
  useEffect(() => {
    setStrainFrame((f) => Math.min(f, strainFrameCount - 1));
  }, [strainFrameCount]);
  const [showCentroid, setShowCentroid] = useState(true);
  const [showRadialLines, setShowRadialLines] = useState(false);
  const [showStrainOverlay, setShowStrainOverlay] = useState(true);
  const [autoAlignAha, setAutoAlignAha] = useState(true);

  const hasPredictions = state.status === "done" && state.predictions.length > 0;
  const isRunning = state.status === "running";

  return (
    <div className="flex flex-col h-full bg-[var(--sidebar)] rounded-r-xl border border-[var(--sidebar-border)] shadow-sm overflow-hidden">

      {/* Tab nav bar — mirrors segmentation-sidebar */}
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-[var(--sidebar-border)] bg-[var(--sidebar-primary)] rounded-tr-xl flex-shrink-0">
        {NAV_ITEMS.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => handleTabChange(key)}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all flex-1 text-left",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              // Active tab gets a solid, clearly darker fill so it reads as
              // selected at a glance (the subtle accent was too close to idle).
              activeTab === key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-primary/10 hover:text-foreground",
            )}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="text-xs font-medium">{label}</span>
          </button>
        ))}
      </div>

      {/* Model indicator strip — mirrors segmentation-sidebar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--sidebar-border)] bg-[var(--sidebar-primary)]/50 flex-shrink-0">
        <Brain className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-[11px] text-muted-foreground">Model:</span>
        <span className="text-[11px] font-semibold text-foreground truncate">
          {state.modelUsed || "UNetResNet34 Landmark"}
        </span>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0",
            hasPredictions
              ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
              : isRunning
              ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400"
              : "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
          )}
        >
          <span
            className={cn(
              "h-1 w-1 rounded-full inline-block",
              hasPredictions ? "bg-green-500" : isRunning ? "bg-blue-500 animate-pulse" : "bg-amber-500",
            )}
          />
          {hasPredictions ? "Active" : isRunning ? "Running" : "Pending"}
        </span>
      </div>

      {hasPredictions && activeTab === "landmarks" && (
        <PlaybackBar
          axisLabel="Slice"
          currentFrame={state.currentFrame}
          totalFrames={state.totalFrames}
          isPlaying={state.isPlaying}
          playbackFps={state.playbackFps}
          confidentCount={confidentCount ?? 0}
          onTogglePlay={onTogglePlay}
          onNextFrame={onNextFrame}
          onPrevFrame={onPrevFrame}
          onSliderChange={onSliderChange}
          onPlaybackSpeedChange={onPlaybackSpeedChange}
        />
      )}

      {/* Scrollable tab content */}
      <div className="flex-1 overflow-y-auto p-4 min-h-0">
        {/* Quick ED->ES has no per-frame cycle to scrub — a single computed
            pair, not an animated series — so the playback bar (and its Play
            button) only makes sense in Full cycle scope, matching the mockup. */}
        {(activeTab === "structure" || (activeTab === "strain" && strainCompute?.scope !== "quick")) && hasPredictions && (
          <div className="-mx-4 -mt-4 mb-4">
            <PlaybackBar
              axisLabel="Frame"
              currentFrame={strainFrame}
              totalFrames={strainFrameCount}
              isPlaying={strainPlaying}
              playbackFps={state.playbackFps}
              confidentCount={confidentCount ?? 0}
              onTogglePlay={() => setStrainPlaying((p) => !p)}
              onNextFrame={() => setStrainFrame((f) => Math.min(f + 1, strainFrameCount - 1))}
              onPrevFrame={() => setStrainFrame((f) => Math.max(f - 1, 0))}
              onSliderChange={(f) => setStrainFrame(Math.max(0, Math.min(f, strainFrameCount - 1)))}
              onPlaybackSpeedChange={onPlaybackSpeedChange}
            />
          </div>
        )}
        {activeTab === "landmarks" && (
          <LandmarksTab
            hasUnsavedLandmarkEdits={hasUnsavedLandmarkEdits}
            isSavingLandmarks={isSavingLandmarks}
            onSaveLandmarks={onSaveLandmarks}
            allPredictions={state.predictions}
            onSliceSelect={onSliderChange}
            prediction={currentPrediction}
            visibleLandmarks={visibleLandmarks}
            onToggleLandmark={onToggleLandmark}
            currentSliceKey={currentSliceKey ?? ""}
            pendingDeletions={pendingDeletions ?? {}}
            onDeleteLandmark={onDeleteLandmark ?? (() => {})}
            onUndoDeleteLandmark={onUndoDeleteLandmark ?? (() => {})}
            manuallyDeletedSliceKeys={manuallyDeletedSliceKeys ?? EMPTY_STRING_SET}
            hasPredictions={hasPredictions}
            currentFrame={state.currentFrame}
            replacementFile={state.replacementFile}
            replacementFileError={replacementFileError}
            onFileSelect={onFileSelect}
            onClearReplacementFile={onClearReplacementFile}
            showLabels={showLabels}
            onToggleShowLabels={onToggleShowLabels}
            showCentroid={showCentroid}
            onToggleShowCentroid={() => setShowCentroid((p) => !p)}
            showRadialLines={showRadialLines}
            onToggleShowRadialLines={() => setShowRadialLines((p) => !p)}
            showStrainOverlay={showStrainOverlay}
            onToggleShowStrainOverlay={() => setShowStrainOverlay((p) => !p)}
            autoAlignAha={autoAlignAha}
            onToggleAutoAlignAha={() => setAutoAlignAha((p) => !p)}
            editableLandmarks={editableLandmarks}
            onToggleEditableLandmarks={onToggleEditableLandmarks}
            highlightedLandmarkId={highlightedLandmarkId}
            onHighlightLandmark={onHighlightLandmark}
            onReset={onReset}
          />
        )}
        {activeTab === "structure" && (
          <StructureTab
            hasPredictions={hasPredictions}
            activeModel={activeModel ?? "unet"}
            onModelChange={onModelChange}
            structureVentricle={structureVentricle}
            onStructureVentricleChange={onStructureVentricleChange}
            structureStats={structureStats}
          />
        )}
        {activeTab === "strain" && (
          <div className="space-y-4">
            <StrainTab
              hasPredictions={hasPredictions}
              currentFrame={strainFrame}
              totalFrames={strainFrameCount}
              selectedStrainType={selectedStrainType}
              onStrainTypeChange={onStrainTypeChange}
              activeModel={activeModel ?? "unet"}
              onModelChange={onModelChange}
              strainCompute={strainCompute}
            />
            {/* Strain-view toggles live here rather than with the landmark
                controls — they affect this tab's rendering, not the points. */}
            {hasPredictions && (
              <DetectionSettingsPanel
                scope="strain"
                showLabels={showLabels}
                onToggleShowLabels={onToggleShowLabels}
                showCentroid={showCentroid}
                onToggleShowCentroid={() => setShowCentroid((p) => !p)}
                showRadialLines={showRadialLines}
                onToggleShowRadialLines={() => setShowRadialLines((p) => !p)}
                showStrainOverlay={showStrainOverlay}
                onToggleShowStrainOverlay={() => setShowStrainOverlay((p) => !p)}
                autoAlignAha={autoAlignAha}
                onToggleAutoAlignAha={() => setAutoAlignAha((p) => !p)}
                editableLandmarks={editableLandmarks}
                onToggleEditableLandmarks={onToggleEditableLandmarks}
              />
            )}
          </div>
        )}
      </div>

    </div>
  );
}

// Playback bar 
function PlaybackBar({
  currentFrame,
  totalFrames,
  isPlaying,
  playbackFps,
  confidentCount,
  onTogglePlay,
  onNextFrame,
  onPrevFrame,
  onSliderChange,
  onPlaybackSpeedChange,
  axisLabel = "Frame",
}: {
  currentFrame: number;
  totalFrames: number;
  /** What the counter steps through — "Slice" for landmarks, "Frame" for strain. */
  axisLabel?: string;
  isPlaying: boolean;
  playbackFps: number;
  confidentCount: number;
  onTogglePlay: () => void;
  onNextFrame: () => void;
  onPrevFrame: () => void;
  onSliderChange: (f: number) => void;
  onPlaybackSpeedChange: (fps: number) => void;
}) {
  const speedOptions = [0.5, 1, 2, 4];

  return (
    <div className="px-4 py-3 border-b border-[var(--sidebar-border)] space-y-2 flex-shrink-0">
      <div className="flex items-center gap-2">
        {/* Prev */}
        <button
          type="button"
          onClick={onPrevFrame}
          disabled={currentFrame === 0}
          className="p-1.5 rounded-md hover:bg-muted/50 disabled:opacity-30 transition-colors shrink-0"
          aria-label={`Previous ${axisLabel.toLowerCase()}`}
        >
          <SkipBack className="h-4 w-4" />
        </button>

        {/* Play / Pause */}
        <button
          type="button"
          onClick={onTogglePlay}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors"
          aria-label={isPlaying ? "Pause playback" : "Play frames"}
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {isPlaying ? "Pause" : "Play"}
        </button>

        {/* Next */}
        <button
          type="button"
          onClick={onNextFrame}
          disabled={currentFrame >= totalFrames - 1}
          className="p-1.5 rounded-md hover:bg-muted/50 disabled:opacity-30 transition-colors shrink-0"
          aria-label={`Next ${axisLabel.toLowerCase()}`}
        >
          <SkipForward className="h-4 w-4" />
        </button>

        {/* Position counter — axis depends on the tab (slices vs. frames) */}
        <span className="text-[10px] text-muted-foreground font-mono shrink-0 tabular-nums">
          {currentFrame + 1}/{totalFrames}
        </span>
      </div>

      {/* Playback mode label */}
      <p className="text-[10px] text-muted-foreground text-center">
        {axisLabel === "Slice" ? "Stepping through slices" : "Playing the cardiac cycle"}
      </p>

      {/* Slider */}
      <input
        type="range"
        min={0}
        max={Math.max(totalFrames - 1, 0)}
        value={currentFrame}
        onChange={(e) => onSliderChange(Number(e.target.value))}
        className="w-full h-1.5 accent-primary cursor-pointer"
        aria-label={`${axisLabel} scrubber`}
      />

      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Speed
        </span>
        <div className="grid grid-cols-4 gap-1 rounded-lg border border-border bg-background p-1">
          {speedOptions.map((fps) => (
            <button
              key={fps}
              type="button"
              onClick={() => onPlaybackSpeedChange(fps)}
              className={cn(
                "min-w-10 rounded-md px-1.5 py-1 text-[10px] font-medium tabular-nums transition-colors",
                stateSpeedClass(fps, playbackFps),
              )}
              aria-label={`Set playback speed to ${fps} frames per second`}
            >
              {fps} fps
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function stateSpeedClass(fps: number, currentFps?: number) {
  return currentFps === fps
    ? "bg-primary text-primary-foreground"
    : "text-muted-foreground hover:bg-muted hover:text-foreground";
}

// Landmarks tab
function RemovedRowCountdown({ deletedAt }: { deletedAt: number }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, 5 - Math.floor((Date.now() - deletedAt) / 1000)));

  useEffect(() => {
    setRemaining(Math.max(0, 5 - Math.floor((Date.now() - deletedAt) / 1000)));
    const id = setInterval(() => {
      setRemaining(Math.max(0, 5 - Math.floor((Date.now() - deletedAt) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, [deletedAt]);

  return (
    <span className="text-[9px] font-mono tabular-nums text-muted-foreground shrink-0" aria-live="polite">
      {remaining}s
    </span>
  );
}

function SliceConfidenceDot({
  flag,
  confidence,
  model_used,
}: {
  flag?: "normal" | "collapsed_to_mean";
  confidence?: "high" | "low";
  model_used?: "2ch" | "1ch_fallback";
}) {
  if (!flag && !confidence) return null;

  let color: string;
  let tip: string;

  if (flag === "collapsed_to_mean") {
    color = "bg-zinc-400";
    tip = "Landmarks too close — mean point used";
  } else if (confidence === "high") {
    color = "bg-green-500";
    tip = model_used === "2ch" ? "High confidence (seg-guided 2ch)" : "High confidence (MRI-only 1ch)";
  } else {
    color = "bg-orange-400";
    tip = `Low confidence — ${model_used === "2ch" ? "seg-guided 2ch" : "MRI-only 1ch"}`;
  }

  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full shrink-0", color)}
      title={tip}
      aria-label={tip}
    />
  );
}

function LandmarksTab({
  hasUnsavedLandmarkEdits,
  isSavingLandmarks,
  onSaveLandmarks,
  allPredictions,
  onSliceSelect,
  prediction,
  visibleLandmarks,
  onToggleLandmark,
  currentSliceKey,
  pendingDeletions,
  onDeleteLandmark,
  onUndoDeleteLandmark,
  manuallyDeletedSliceKeys,
  hasPredictions,
  currentFrame,
  replacementFile,
  replacementFileError,
  onFileSelect,
  onClearReplacementFile,
  showLabels,
  onToggleShowLabels,
  showCentroid,
  onToggleShowCentroid,
  showRadialLines,
  onToggleShowRadialLines,
  showStrainOverlay,
  onToggleShowStrainOverlay,
  autoAlignAha,
  onToggleAutoAlignAha,
  editableLandmarks,
  onToggleEditableLandmarks,
  highlightedLandmarkId,
  onHighlightLandmark,
  onReset,
}: {
  hasUnsavedLandmarkEdits?: boolean;
  isSavingLandmarks?: boolean;
  onSaveLandmarks?: () => void;
  allPredictions?: FramePrediction[];
  onSliceSelect?: (slice: number) => void;
  prediction: FramePrediction | null;
  visibleLandmarks: Set<string>;
  onToggleLandmark: (id: string) => void;
  currentSliceKey: string;
  pendingDeletions: Record<string, number>;
  onDeleteLandmark: (id: string) => void;
  onUndoDeleteLandmark: (id: string) => void;
  manuallyDeletedSliceKeys: Set<string>;
  hasPredictions: boolean;
  onReset?: () => void;
  currentFrame: number;
  replacementFile: File | null;
  replacementFileError: string | null;
  onFileSelect: (f: File | null) => void;
  onClearReplacementFile: () => void;
  showLabels: boolean;
  onToggleShowLabels: () => void;
  showCentroid: boolean;
  onToggleShowCentroid: () => void;
  showRadialLines: boolean;
  onToggleShowRadialLines: () => void;
  showStrainOverlay: boolean;
  onToggleShowStrainOverlay: () => void;
  autoAlignAha: boolean;
  onToggleAutoAlignAha: () => void;
  editableLandmarks: boolean;
  onToggleEditableLandmarks?: () => void;
  highlightedLandmarkId?: string | null;
  onHighlightLandmark?: (id: string | null) => void;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  if (!hasPredictions) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-muted-foreground text-sm gap-3 py-8">
        <MapPin className="h-8 w-8 opacity-25" />
        <p className="text-sm leading-snug">
          Landmark detection starts automatically when this page opens.
        </p>
        {/* Optional replacement file section */}
        <div className="w-full pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground mb-2">
            Or use a different MRI file:
          </p>
          <ReplacementFileRow
            replacementFile={replacementFile}
            replacementFileError={replacementFileError}
            fileInputRef={fileInputRef}
            onFileSelect={onFileSelect}
            onClearReplacementFile={onClearReplacementFile}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Save landmark edits — lives in the Landmarks tab so it's next to the
          editing controls. Pulses (ring + animation) while there are unsaved
          edits so the user knows where to click; disabled/quiet otherwise. */}
      {onSaveLandmarks && (
        <Button
          size="sm"
          onClick={onSaveLandmarks}
          disabled={!hasUnsavedLandmarkEdits || isSavingLandmarks}
          className={cn(
            "w-full gap-1.5 text-xs transition-all",
            hasUnsavedLandmarkEdits && !isSavingLandmarks &&
              "animate-pulse ring-2 ring-primary/60 ring-offset-1",
          )}
        >
          {isSavingLandmarks ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
          ) : hasUnsavedLandmarkEdits ? (
            "● Save landmark edits"
          ) : (
            "Landmarks saved"
          )}
        </Button>
      )}

      {/* Section header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Detected Landmarks</h3>
        <div className="flex items-center gap-1.5">
          <SliceConfidenceDot
            flag={prediction?.flag}
            confidence={prediction?.confidence}
            model_used={prediction?.model_used}
          />
          <span className="text-xs text-muted-foreground tabular-nums">
            Slice {currentFrame + 1}
          </span>
        </div>
      </div>

      {/* Per-slice confidence overview. The single dot above only describes the
          slice currently in view, so there was no way to see which slices the
          detector was unsure about without scrubbing through all of them. This
          strip shows every slice at once and doubles as a jump target. */}
      {allPredictions && allPredictions.length > 1 && (
        <div className="rounded-lg border border-border bg-muted/20 p-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Slice confidence
            </span>
            <span className="text-[9px] text-muted-foreground">
              {allPredictions.filter((p) => p.confidence === "high").length}/{allPredictions.length} confident
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {allPredictions.map((p, i) => {
              const isCurrent = i === currentFrame;
              const color =
                p.flag === "collapsed_to_mean" ? "bg-zinc-400"
                : p.confidence === "high" ? "bg-green-500"
                : p.confidence === "low" ? "bg-orange-400"
                : "bg-muted-foreground/30";
              const tip =
                p.flag === "collapsed_to_mean" ? "Landmarks too close — mean point used"
                : p.confidence === "high" ? "High confidence"
                : p.confidence === "low" ? "Low confidence"
                : "No confidence reported";
              const wasManuallyEdited = manuallyDeletedSliceKeys.has(`${p.frame_id}:${p.slice_id ?? 0}`);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => onSliceSelect?.(i)}
                  title={wasManuallyEdited ? `Slice ${i + 1} — ${tip} — landmark manually removed` : `Slice ${i + 1} — ${tip}`}
                  className={cn(
                    "relative flex h-5 w-5 items-center justify-center rounded text-[8px] font-medium transition-all",
                    color,
                    isCurrent ? "ring-2 ring-primary ring-offset-1" : "opacity-70 hover:opacity-100",
                    p.confidence === "high" || p.flag === "collapsed_to_mean" ? "text-white" : "text-white",
                  )}
                >
                  {i + 1}
                  {wasManuallyEdited && (
                    <Pencil
                      className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-background p-[1px] text-foreground shadow"
                      aria-hidden
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-2 text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" />High</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-400" />Low</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-zinc-400" />Mean-collapsed</span>
          </div>
        </div>
      )}

      {/* Landmark rows */}
      <div className="space-y-1">
        {LANDMARK_DEFINITIONS.filter((def) => SIDEBAR_LANDMARK_IDS.has(def.id)).map((def) => {
          const coord = getLandmarkCoord(prediction, def.id);
          const isVisible = visibleLandmarks.has(def.id);
          const hasCoord  = !!coord;
          const deletedAt = pendingDeletions[`${currentSliceKey}:${def.id}`];

          if (deletedAt !== undefined) {
            return (
              <div
                key={def.id}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-dashed border-border/60 bg-transparent text-left"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 text-xs text-muted-foreground">
                  {def.label} removed from Slice {currentFrame + 1}
                </span>
                <RemovedRowCountdown deletedAt={deletedAt} />
                <button
                  type="button"
                  onClick={() => onUndoDeleteLandmark(def.id)}
                  className="text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  Undo
                </button>
              </div>
            );
          }

          return (
            <button
              key={def.id}
              type="button"
              onClick={() => onToggleLandmark(def.id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-all",
                isVisible && hasCoord
                  ? "border-border bg-background hover:bg-muted/40"
                  : !hasCoord
                  ? "border-dashed border-border/40 bg-transparent opacity-40 cursor-default"
                  : "border-border/50 bg-transparent opacity-55",
              )}
              disabled={!hasCoord}
              aria-pressed={isVisible}
            >
              {/* Color dot */}
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{
                  backgroundColor: def.color,
                  boxShadow: isVisible ? `0 0 0 1px ${def.color}50` : "none",
                }}
              />
              {/* Label */}
              <span className="flex-1 text-xs font-medium truncate">
                {def.label}
              </span>
              {/* Coords */}
              {hasCoord ? (
                <span className="text-[10px] text-muted-foreground font-mono tabular-nums shrink-0">
                  {coord![0]}, {coord![1]}
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground/40 shrink-0">—</span>
              )}
              {onHighlightLandmark && (
                <span
                  className={cn(
                    "text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0",
                    highlightedLandmarkId === def.id
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                      : "bg-muted text-muted-foreground",
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    onHighlightLandmark(highlightedLandmarkId === def.id ? null : def.id);
                  }}
                  title={highlightedLandmarkId === def.id ? "Remove highlight" : "Highlight this landmark"}
                >
                  {highlightedLandmarkId === def.id ? "clear" : "focus"}
                </span>
              )}
              {hasCoord && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteLandmark(def.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      onDeleteLandmark(def.id);
                    }
                  }}
                  className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  title={`Delete ${def.label} from this slice`}
                  aria-label={`Delete ${def.label} from this slice`}
                >
                  <Trash2 className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Optional replacement file (collapsed, secondary) */}
      <DetectionSettingsPanel
        showLabels={showLabels}
        onToggleShowLabels={onToggleShowLabels}
        showCentroid={showCentroid}
        onToggleShowCentroid={onToggleShowCentroid}
        showRadialLines={showRadialLines}
        onToggleShowRadialLines={onToggleShowRadialLines}
        showStrainOverlay={showStrainOverlay}
        onToggleShowStrainOverlay={onToggleShowStrainOverlay}
        autoAlignAha={autoAlignAha}
        onToggleAutoAlignAha={onToggleAutoAlignAha}
        editableLandmarks={editableLandmarks}
        onToggleEditableLandmarks={onToggleEditableLandmarks}
      />

      <div className="pt-3 border-t border-border">
        <p className="text-[11px] text-muted-foreground mb-2">Replace MRI file (optional):</p>
        <ReplacementFileRow
          replacementFile={replacementFile}
          replacementFileError={replacementFileError}
          fileInputRef={fileInputRef}
          onFileSelect={onFileSelect}
          onClearReplacementFile={onClearReplacementFile}
        />
      </div>

      {/* Moved here when the Settings tab was removed — its other contents
          (inference summary, Re-run) already exist in the page header. */}
      {onReset && (
        <div className="pt-3 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="w-full gap-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onReset}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Page
          </Button>
        </div>
      )}
    </div>
  );
}

function DetectionSettingsPanel({
  showLabels,
  onToggleShowLabels,
  showCentroid,
  onToggleShowCentroid,
  showRadialLines,
  onToggleShowRadialLines,
  showStrainOverlay,
  onToggleShowStrainOverlay,
  autoAlignAha,
  onToggleAutoAlignAha,
  editableLandmarks,
  onToggleEditableLandmarks,
  scope = "landmarks",
}: {
  showLabels: boolean;
  onToggleShowLabels: () => void;
  showCentroid: boolean;
  onToggleShowCentroid: () => void;
  showRadialLines: boolean;
  onToggleShowRadialLines: () => void;
  showStrainOverlay: boolean;
  onToggleShowStrainOverlay: () => void;
  autoAlignAha: boolean;
  onToggleAutoAlignAha: () => void;
  editableLandmarks: boolean;
  onToggleEditableLandmarks?: () => void;
  /** Which tab is rendering this — decides which toggles are relevant. */
  scope?: "landmarks" | "strain";
}) {
  // Split by what each toggle actually affects: landmark point display/editing
  // vs. the strain overlay and AHA segment alignment.
  const settings =
    scope === "strain"
      ? [
          { label: "Show strain overlay", checked: showStrainOverlay, onCheckedChange: onToggleShowStrainOverlay },
          { label: "Auto-align AHA segments", checked: autoAlignAha, onCheckedChange: onToggleAutoAlignAha },
          { label: "Show radial lines", checked: showRadialLines, onCheckedChange: onToggleShowRadialLines },
          { label: "Show centroid", checked: showCentroid, onCheckedChange: onToggleShowCentroid },
        ]
      : [
          { label: "Show landmark labels", checked: showLabels, onCheckedChange: onToggleShowLabels },
          { label: "Move/edit landmarks", checked: editableLandmarks, onCheckedChange: onToggleEditableLandmarks },
        ];

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
        {scope === "strain" ? "Display Settings" : "Detection Settings"}
      </h3>
      <div className="space-y-2">
        {settings.map((setting) => (
          <div key={setting.label} className="flex items-center justify-between gap-3">
            <span className="text-xs text-foreground">{setting.label}</span>
            <Switch
              checked={setting.checked}
              onCheckedChange={setting.onCheckedChange}
              disabled={!setting.onCheckedChange}
              aria-label={setting.label}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function ReplacementFileRow({
  replacementFile,
  replacementFileError,
  fileInputRef,
  onFileSelect,
  onClearReplacementFile,
}: {
  replacementFile: File | null;
  replacementFileError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (f: File | null) => void;
  onClearReplacementFile: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <input
        ref={fileInputRef}
        type="file"
        accept=".nii,.nii.gz"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          onFileSelect(f);
          e.target.value = "";
        }}
      />

      {replacementFile ? (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-green-500/40 bg-green-50 dark:bg-green-950/20 text-xs text-green-700 dark:text-green-400">
          <Upload className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate font-medium">{replacementFile.name}</span>
          <button
            type="button"
            onClick={onClearReplacementFile}
            className="shrink-0 text-green-600 hover:text-green-800 dark:hover:text-green-200"
            aria-label="Clear replacement file"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg border border-dashed border-border hover:border-primary hover:bg-muted/30 text-xs text-muted-foreground transition-colors"
        >
          <Upload className="h-3.5 w-3.5 shrink-0" />
          <span>Browse .nii / .nii.gz…</span>
        </button>
      )}

      {replacementFileError && (
        <div className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {replacementFileError}
        </div>
      )}
    </div>
  );
}

/**
 * Busy label for the compute buttons. The backend runs the whole series in one
 * request (one GPU pass per frame), so there's no per-frame progress to stream —
 * we show a spinner + the frame count so the wait is understood, not a bare
 * "Computing…". `verb` is "Computing" or "Recomputing".
 */
function ComputeBusyLabel({ verb, frames }: { verb: string; frames: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Loader2 className="h-3 w-3 animate-spin" />
      {verb} {frames} frames… (one GPU pass each)
    </span>
  );
}

/** UNet/MedSAM selector for the strain tab. UNet is marked recommended. */
function ModelToggle({
  strainModel,
  setStrainModel,
  modelAvailable,
}: {
  strainModel: "unet" | "medsam";
  setStrainModel: (m: "unet" | "medsam") => void;
  modelAvailable: Record<"unet" | "medsam", boolean>;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-background p-0.5">
      {(["unet", "medsam"] as const).map((m) => (
        <button
          key={m}
          type="button"
          disabled={!modelAvailable[m]}
          onClick={() => setStrainModel(m)}
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
            strainModel === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            !modelAvailable[m] && "cursor-not-allowed opacity-40",
          )}
          title={
            !modelAvailable[m]
              ? "No results stored for this model"
              : m === "unet"
              ? "UNet — recommended (more accurate wall boundaries)"
              : undefined
          }
        >
          {m === "unet" ? "UNet ★" : "MedSAM"}
        </button>
      ))}
    </div>
  );
}

function StructureStatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-2 py-2 text-center">
      <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-xs font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function StructureTab({
  hasPredictions,
  activeModel,
  onModelChange,
  structureVentricle,
  onStructureVentricleChange,
  structureStats,
}: {
  hasPredictions: boolean;
  activeModel: "unet" | "medsam";
  onModelChange?: (m: "unet" | "medsam") => void;
  structureVentricle: "LV" | "RV";
  onStructureVentricleChange?: (v: "LV" | "RV") => void;
  structureStats?: { min: number | null; mean: number | null; max: number | null } | null;
}) {
  if (!hasPredictions) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-muted-foreground text-sm gap-3 py-8">
        <LayoutGrid className="h-8 w-8 opacity-25" />
        <p className="text-sm leading-snug">
          Landmark detection starts automatically; the wall-thickness bullseye appears when results are ready.
        </p>
      </div>
    );
  }

  const isLv = structureVentricle === "LV";
  const unit = isLv ? "mm" : "mm²";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">Structure</h3>
        <div className="inline-flex rounded-md border border-border bg-background p-0.5">
          {(["unet", "medsam"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModelChange?.(m)}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                activeModel === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {m === "unet" ? "UNet ★" : "MedSAM"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/20 p-1">
        {(["LV", "RV"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onStructureVentricleChange?.(v)}
            className={cn(
              "rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
              structureVentricle === v
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {v}
          </button>
        ))}
      </div>

      {!isLv ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center">
          <LayoutGrid className="mx-auto h-7 w-7 opacity-25" />
          <p className="mt-2 text-xs text-muted-foreground">
            RV structural view coming soon — cavity-area data isn&apos;t computed by the backend yet.
          </p>
        </div>
      ) : structureStats && structureStats.mean != null ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <StructureStatTile label="Min" value={structureStats.min != null ? `${structureStats.min.toFixed(1)} ${unit}` : "—"} />
            <StructureStatTile label="Mean" value={`${structureStats.mean.toFixed(1)} ${unit}`} />
            <StructureStatTile label="Max" value={structureStats.max != null ? `${structureStats.max.toFixed(1)} ${unit}` : "—"} />
          </div>
          <p className="text-[9px] text-muted-foreground leading-relaxed">
            AHA 17-segment wall thickness — a single computed snapshot, not a per-frame cycle metric.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          No wall-thickness bullseye computed yet for {activeModel === "unet" ? "UNet" : "MedSAM"}.
        </p>
      )}
    </div>
  );
}

function StrainTab({
  hasPredictions,
  currentFrame,
  totalFrames,
  selectedStrainType: externalStrainType,
  onStrainTypeChange,
  activeModel,
  onModelChange,
  strainCompute,
}: {
  hasPredictions: boolean;
  currentFrame: number;
  totalFrames: number;
  selectedStrainType?: StrainType;
  onStrainTypeChange?: (type: StrainType) => void;
  activeModel: "unet" | "medsam";
  onModelChange?: (m: "unet" | "medsam") => void;
  strainCompute?: StrainComputeBundle;
}) {
  const router = useRouter();
  const { projectId } = useParams<{ projectId: string }>();
  // Controlled by the page when provided, so the sidebar's GRS/GCS choice is
  // the single source of truth the main panel's bullseye/3D heart also reads
  // — no more independent local toggle that could drift out of sync with it.
  const [localStrainType, setLocalStrainType] = useState<StrainType>("GRS");
  const selectedStrainType: StrainType =
    externalStrainType && externalStrainType !== ("GLS" as string) ? externalStrainType : localStrainType;
  const setSelectedStrainType = onStrainTypeChange ?? setLocalStrainType;
  const [curveView, setCurveView] = useState<"global" | "region" | "cycle">("global");
  const [labelsView, setLabelsView] = useState<"lvSegments" | "values">("lvSegments");
  const [hoverSeg, setHoverSeg] = useState<number | null>(null);
  const frameCount = Math.max(totalFrames || 10, 1);

  // Model is owned by the page (URL-backed activeModel), so the strain tab and
  // the bullseye panel always agree and a reload restores the same model. The
  // toggle here just asks the page to switch — no local model state.
  const strainModel = activeModel;
  const setStrainModel = (m: "unet" | "medsam") => onModelChange?.(m);
  const {
    strain: realStrain,
    strainSeries: realSeries,
    rvStrain: realRvStrain,
    rvStrainSeries: realRvSeries,
    available: modelAvailable,
    setModel: setResultsModel,
    autoEdFrame,
  } = useProjectResults(projectId);
  // LV/RV toggle for the results panel below — RV has no GRS/GCS split or
  // region/cycle chart parity with LV yet, so it gets a simpler dedicated panel.
  const [ventricleView, setVentricleView] = useState<"LV" | "RV">("LV");
  useEffect(() => { setResultsModel(strainModel); }, [strainModel, setResultsModel]);

  const strainKey = selectedStrainType === "GRS" ? "grs" : "gcs";

  /**
   * Per-frame series in the chart's shape. Real data when the strain-series
   * route has been run for this model; otherwise the dummy preview, which the
   * UI labels explicitly so the two are never confused.
   */
  const cycleSeries = useMemo(() => {
    if (realSeries?.frames?.length) {
      return realSeries.frames.map((f) =>
        (f.segments ?? []).map((s) => ({
          segment: s.segment,
          label: s.label,
          strain: ((s as any)[strainKey] ?? 0) as number,
        })),
      );
    }
    return buildDummyCycleSeries(selectedStrainType, frameCount);
  }, [realSeries, strainKey, selectedStrainType, frameCount]);

  const usingRealSeries = !!realSeries?.frames?.length;
  const usingRealStrain = !!realStrain?.segments?.length;
  // Stamped by the backend when landmarks are saved after a strain compute.
  const strainIsStale = !!(realSeries?.staleSince || realStrain?.staleSince);

  // Full-cycle strain: one GPU call per frame, so it's opt-in rather than
  // automatic. ED comes from the stored ED→ES result when available.
  const [seriesBusy, setSeriesBusy] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const runStrainSeries = useCallback(async () => {
    if (!projectId) return;
    // ED must be the true end-diastole (largest LV cavity) — it is the reference
    // every frame is measured against. Prefer the frames a previous strain run
    // used, then heart-metrics' auto-detected ED. Falling back to frame 0 makes
    // the whole series meaningless (frame 0 is rarely ED), so only do so as a
    // last resort.
    const edIndex =
      realStrain?.edFrameIndex ??
      realSeries?.edFrameIndex ??
      autoEdFrame ??
      0;
    setSeriesBusy(true);
    strainCompute?.onFullCycleBusyChange(true);
    setSeriesError(null);
    try {
      // Fire LV and RV series together — one button, both computed. Independent
      // GPU calls, so a failure in one shouldn't lose the other.
      const [lvOutcome, rvOutcome] = await Promise.allSettled([
        computeStrainSeries(projectId, edIndex, strainModel),
        computeRvStrainSeries(projectId, edIndex, strainModel),
      ]);
      if (lvOutcome.status === "rejected" && rvOutcome.status === "rejected") {
        const err: any = lvOutcome.reason;
        setSeriesError(err?.response?.data?.error ?? err?.message ?? "Strain series failed.");
        return;
      }
      // Stored on the mask — reload so every consumer picks it up.
      window.location.reload();
    } finally {
      setSeriesBusy(false);
      strainCompute?.onFullCycleBusyChange(false);
    }
  }, [projectId, realStrain, realSeries, strainModel, autoEdFrame, strainCompute]);

  const usingRealRvSeries = !!realRvSeries?.frames?.length;
  const usingRealRvStrain = !!realRvStrain?.regions?.length;

  /** Global RV strain curve, mirroring `curveData`'s "global" shape for LV. */
  const rvCurveData = useMemo(() => {
    if (!realRvSeries?.frames?.length) return [];
    const n = realRvSeries.frames.length;
    return realRvSeries.frames.map((f, i) => ({
      frame: f.frameIndex + 1,
      time: Math.round((i / Math.max(n - 1, 1)) * 1200),
      strain: Number((f.global_rv_strain ?? 0).toFixed(1)),
    }));
  }, [realRvSeries]);

  /** Per-region RV values at the frame being viewed (falls back to the peak
   *  frame, then to the single ED→ES result — same preference order as LV's
   *  `segmentValues`). */
  const rvRegionValues = useMemo(() => {
    if (realRvSeries?.frames?.length) {
      const frame =
        realRvSeries.frames.find((f) => f.frameIndex === currentFrame) ??
        realRvSeries.frames.find((f) => f.frameIndex === realRvSeries.peakFrameIndex);
      if (frame?.regions?.length) {
        return frame.regions.map((r) => ({ segment: r.region, label: r.label, strain: r.strain ?? 0 }));
      }
    }
    if (realRvStrain?.regions?.length) {
      return realRvStrain.regions.map((r) => ({ segment: r.region, label: r.label, strain: r.strain ?? 0 }));
    }
    return [];
  }, [realRvSeries, realRvStrain, currentFrame]);

  const rvCurrentAverage = rvRegionValues.length
    ? rvRegionValues.reduce((sum, r) => sum + r.strain, 0) / rvRegionValues.length
    : 0;

  /** Peak = most negative global RV strain across the cycle (most shrinkage). */
  const rvPeakValue = useMemo(() => {
    if (realRvSeries?.frames?.length) {
      const globals = realRvSeries.frames
        .map((f) => f.global_rv_strain)
        .filter((v): v is number => typeof v === "number");
      if (globals.length) return Math.min(...globals);
    }
    return typeof realRvStrain?.global_rv_strain === "number" ? realRvStrain.global_rv_strain : 0;
  }, [realRvSeries, realRvStrain]);
  /**
   * Global curve: one point per frame. When a segment is selected the curve
   * tracks that segment; otherwise it is the mean across all 17. Uses the
   * measured per-frame series when available, falling back to the dummy shape
   * only when nothing has been computed (the UI labels which is showing).
   *
   * `time` is a nominal ms position across the cycle — the pipeline does not
   * store acquisition timing, so it is derived from the frame index.
   */
  const curveData = useMemo(() => {
    if (realSeries?.frames?.length) {
      const n = realSeries.frames.length;
      return realSeries.frames.map((f, i) => {
        const segs = f.segments ?? [];
        const vals = segs
          .map((s) => (s as any)[strainKey])
          .filter((v: unknown): v is number => typeof v === "number");
        const value = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        return {
          frame: f.frameIndex + 1,
          time: Math.round((i / Math.max(n - 1, 1)) * 1200),
          strain: Number(value.toFixed(1)),
        };
      });
    }
    return strainCurveData(selectedStrainType, frameCount);
  }, [realSeries, strainKey, selectedStrainType, frameCount]);
  // Prefer the frame the user is scrubbing to (needs the series); fall back to
  // the single ED→ES result, then to the dummy preview.
  const segmentValues = useMemo(() => {
    if (realSeries?.frames?.length) {
      const frame =
        realSeries.frames.find((f) => f.frameIndex === currentFrame) ??
        realSeries.frames.find((f) => f.frameIndex === realSeries.peakFrameIndex);
      if (frame?.segments?.length) {
        return frame.segments.map((s) => ({
          segment: s.segment,
          label: s.label,
          strain: ((s as any)[strainKey] ?? 0) as number,
        }));
      }
    }
    if (realStrain?.segments?.length) {
      return realStrain.segments.map((s) => ({
        segment: s.segment,
        label: s.label,
        strain: ((s as any)[strainKey] ?? 0) as number,
      }));
    }
    return getDummyStrainData(selectedStrainType, currentFrame, frameCount);
  }, [realSeries, realStrain, strainKey, currentFrame, selectedStrainType, frameCount]);
  // "Current" = mean across segments at the frame being viewed.
  const currentAverage = segmentValues.reduce((sum, item) => sum + item.strain, 0) / segmentValues.length;

  /**
   * "Peak" = the extreme over the whole cycle. Prefer measured values:
   *   1. strainSeries — the true peak across every computed frame
   *   2. strain       — the single ED→ES global peak (what disease similarity
   *                     and health status consume, so the panels agree)
   *   3. the dummy curve, when nothing has been computed
   * GRS peaks positive (thickening), GCS negative (shortening).
   */
  const peakValue = useMemo(() => {
    const isGRS = selectedStrainType === "GRS";
    if (realSeries?.frames?.length) {
      const globals = realSeries.frames
        .map((f) => (isGRS ? f.global_grs : f.global_gcs))
        .filter((v): v is number => typeof v === "number");
      if (globals.length) return isGRS ? Math.max(...globals) : Math.min(...globals);
    }
    const single = isGRS ? realStrain?.global_grs : realStrain?.global_gcs;
    if (typeof single === "number") return single;
    return isGRS
      ? Math.max(...curveData.map((item) => item.strain))
      : Math.min(...curveData.map((item) => item.strain));
  }, [realSeries, realStrain, selectedStrainType, curveData]);
  const currentTime = curveData[Math.min(currentFrame, curveData.length - 1)]?.time ?? 0;

  if (!hasPredictions) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-muted-foreground text-sm gap-3 py-8">
        <Activity className="h-8 w-8 opacity-25" />
        <p className="text-sm leading-snug">
          Landmark detection starts automatically; strain curves appear when results are ready.
        </p>
      </div>
    );
  }

  // Nothing computed for THIS model yet → empty state (no dummy charts). Only the
  // model toggle + compute card; results appear only for a model that was run.
  if (!usingRealSeries && !usingRealStrain && !usingRealRvSeries && !usingRealRvStrain) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium text-foreground">Strain Results</h3>
            <p className="text-[10px] text-muted-foreground">No strain computed for this model</p>
          </div>
          <ModelToggle strainModel={strainModel} setStrainModel={setStrainModel} modelAvailable={modelAvailable} />
        </div>
        {strainCompute && (
          <ComputeStrainCard
            strainCompute={strainCompute}
            seriesBusy={seriesBusy}
            seriesError={seriesError}
            onRunFullCycle={runStrainSeries}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Strain Results</h3>
          <p className="text-[10px] text-muted-foreground">
            {strainCompute?.scope === "quick"
              ? "Quick result — single ED→ES pair"
              : `${usingRealSeries ? "Computed strain (per-frame)"
                  : usingRealStrain ? "Computed strain (ED→ES)"
                  : "Dummy preview values"}, frame ${currentFrame + 1}/${frameCount}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* UNet and MedSAM segment differently, so their strain differs —
              each model's result is stored on its own mask document. */}
          <ModelToggle strainModel={strainModel} setStrainModel={setStrainModel} modelAvailable={modelAvailable} />
          {strainCompute?.scope !== "quick" && (
            <span className="rounded-md border border-border bg-background px-2 py-1 text-[10px] font-mono text-muted-foreground">
              {currentTime} ms
            </span>
          )}
        </div>
      </div>

      {strainCompute && (
        <ComputeStrainCard
          strainCompute={strainCompute}
          seriesBusy={seriesBusy}
          seriesError={seriesError}
          onRunFullCycle={runStrainSeries}
        />
      )}

      {strainCompute && strainCompute.scope === "quick" ? (
        /* Quick ED->ES: a single computed pair for both chambers — show LV
           and RV side by side instead of the LV/RV + per-chamber metric
           toggles below (those are for Full cycle's charts/curves, which
           don't exist here), with one flat toggle to pick what colors the
           main panel's bullseye/3D heart. */
        <QuickCombinedStrainView
          strainCompute={strainCompute}
          selectedStrainType={selectedStrainType}
          onStrainTypeChange={setSelectedStrainType}
        />
      ) : (
      <>
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/20 p-1">
        {(["LV", "RV"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVentricleView(v)}
            className={cn(
              "rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
              ventricleView === v
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {v}
          </button>
        ))}
      </div>

      {ventricleView === "RV" ? (
        <RvStrainPanel
          usingRealRvSeries={usingRealRvSeries}
          usingRealRvStrain={usingRealRvStrain}
          rvCurveData={rvCurveData}
          rvRegionValues={rvRegionValues}
          rvCurrentAverage={rvCurrentAverage}
          rvPeakValue={rvPeakValue}
          currentTime={currentTime}
          strainCompute={strainCompute}
          seriesBusy={seriesBusy}
        />
      ) : (
      <>
      {/* GRS/GCS — button style, single source of truth for both this tab and
          the main panel's bullseye/3D heart (no separate toggle there anymore). */}
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/20 p-1">
        {(["GRS", "GCS"] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => setSelectedStrainType(type)}
            className={cn(
              "rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
              selectedStrainType === type
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {type}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StrainMetricCard
          label={
            usingRealSeries ? `Current ${selectedStrainType}`
            : usingRealStrain ? `Mean ${selectedStrainType} (ED→ES)`
            : `Current ${selectedStrainType} (preview)`
          }
          value={`${currentAverage > 0 ? "+" : ""}${currentAverage.toFixed(1)}%`}
          strainType={selectedStrainType}
          valueNumber={currentAverage}
          loading={seriesBusy}
        />
        <StrainMetricCard
          label={
            usingRealSeries ? `Peak ${selectedStrainType}`
            : usingRealStrain ? `Peak ${selectedStrainType} (ED→ES)`
            : `Peak ${selectedStrainType} (preview)`
          }
          value={`${peakValue > 0 ? "+" : ""}${peakValue.toFixed(1)}%`}
          strainType={selectedStrainType}
          valueNumber={peakValue}
          loading={seriesBusy}
        />
      </div>

      {/* Landmarks define the AHA segment alignment, so editing them invalidates
          previously-computed strain. The backend stamps `staleSince` on save
          rather than auto-recomputing (the series is one GPU pass per frame). */}
      {strainIsStale && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5">
          <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-400">
            <span className="font-semibold">Landmarks edited</span> since this strain was computed —
            the segment alignment has changed, so these values are out of date.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-7 w-full text-[10px]"
            disabled={seriesBusy}
            onClick={runStrainSeries}
          >
            {seriesBusy
              ? <ComputeBusyLabel verb="Recomputing" frames={frameCount} />
              : `Recompute all frames with current landmarks (${strainModel === "unet" ? "UNet" : "MedSAM"})`}
          </Button>
          {seriesError && <p className="mt-1 text-[9px] text-destructive">{seriesError}</p>}
        </div>
      )}

      <div className="sticky top-0 z-10 rounded-lg border border-border bg-background p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
            {curveView === "global"
              ? `Global ${selectedStrainType} Curve`
              : curveView === "region"
              ? "By Region"
              : "Full Cycle — All Segments"}
          </h4>
          {curveView === "global" && (
            <span className="text-[10px] text-muted-foreground">
              {usingRealSeries ? `${realSeries!.frames.length} frames` : "Preview"}
            </span>
          )}
        </div>
        <div className="mb-2 grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/20 p-0.5">
          {([
            ["global", "Global"],
            ["region", "By Region"],
            ["cycle", "Full Cycle"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setCurveView(key)}
              className={cn(
                "rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors",
                curveView === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {curveView === "global" && (
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={curveData} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="time"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  domain={selectedStrainType === "GRS" ? [0, 42] : [-26, 2]}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip
                  cursor={{ stroke: "var(--border)" }}
                  formatter={(value) => [`${Number(value).toFixed(1)}%`, selectedStrainType]}
                  labelFormatter={(label) => `${label} ms`}
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--popover)",
                    color: "var(--popover-foreground)",
                    fontSize: 12,
                  }}
                />
                <ReferenceLine
                  x={currentTime}
                  stroke="var(--primary)"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                />
                <Line
                  type="monotone"
                  dataKey="strain"
                  stroke={selectedStrainType === "GRS" ? "#22c55e" : "#f87171"}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {curveView === "region" && (
          <RegionalStrainByRegion series={cycleSeries} />
        )}

        {curveView === "cycle" && (
          <div className="w-full overflow-x-auto">
            <FullCycleChart series={cycleSeries} strainType={selectedStrainType} width={480} height={240} highlightSeg={hoverSeg} />
          </div>
        )}

        {curveView !== "global" && !usingRealSeries && (
          <p className="mt-2 text-[9px] text-muted-foreground">
            {usingRealStrain
              ? "Preview curve shape — only the ED→ES strain is stored for this model."
              : "Dummy preview values — no strain computed for this model yet."}
          </p>
        )}
      </div>

      {curveView === "global" ? (
        <div className="rounded-lg border border-border bg-background">
          <div className="border-b border-border px-3 py-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">Segment Values</h4>
          </div>
          <SegmentValuesTable segmentValues={segmentValues} strainType={selectedStrainType} />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-background">
          <div className="grid grid-cols-2 gap-1 border-b border-border p-1">
            {([
              ["lvSegments", "LV Segments"],
              ["values", "Segment Values"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setLabelsView(key)}
                className={cn(
                  "rounded-md px-1.5 py-1.5 text-[10px] font-medium transition-colors",
                  labelsView === key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {labelsView === "lvSegments" ? (
            <div className="p-2">
              <LVSegmentsLegend series={cycleSeries} highlightSeg={hoverSeg} onHoverSeg={setHoverSeg} size="sm" columns={1} />
            </div>
          ) : (
            <SegmentValuesTable segmentValues={segmentValues} strainType={selectedStrainType} />
          )}
        </div>
      )}
      </>
      )}
      </>
      )}
    </div>
  );
}

/**
 * Quick ED->ES's sidebar content — a single computed pair for BOTH chambers,
 * so instead of the LV/RV ventricle toggle + per-chamber GRS/GCS or GCS/GAS
 * toggle (which exist for Full cycle's charts/curves, not applicable here),
 * this shows both chambers' values together with one flat toggle that picks
 * what colors the main panel's bullseye/3D heart.
 */
function QuickCombinedStrainView({
  strainCompute: sc,
  selectedStrainType,
  onStrainTypeChange,
}: {
  strainCompute: StrainComputeBundle;
  selectedStrainType: StrainType;
  onStrainTypeChange: (type: StrainType) => void;
}) {
  const lv = sc.quickLvResult;
  const rv = sc.quickRvResult;

  const fmtPct = (v: number | null | undefined) => (v == null ? "N/A" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
  const fmtMm = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(2)} mm`);

  const flatOptions: { key: string; label: string; active: boolean; onClick: () => void }[] = [
    { key: "lv-grs", label: "LV GRS", active: selectedStrainType === "GRS", onClick: () => onStrainTypeChange("GRS") },
    { key: "lv-gcs", label: "LV GCS", active: selectedStrainType === "GCS", onClick: () => onStrainTypeChange("GCS") },
    { key: "rv-gcs", label: "RV GCS", active: sc.rvMetricType === "GCS", onClick: () => sc.onRvMetricTypeChange("GCS") },
    { key: "rv-gas", label: "RV GAS", active: sc.rvMetricType === "GAS", onClick: () => sc.onRvMetricTypeChange("GAS") },
  ];

  return (
    <div className="space-y-3">
      {/* Flat 4-way toggle — only changes what colors the main panel's
          bullseye/3D heart; both stat blocks below are always shown together. */}
      <div className="grid grid-cols-4 gap-1 rounded-lg border border-border bg-muted/20 p-1">
        {flatOptions.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={opt.onClick}
            className={cn(
              "rounded-md px-1 py-1.5 text-[9.5px] font-medium transition-colors",
              opt.active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-background p-3 space-y-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">LV Global Strain</h4>
        {lv ? (
          <div className="grid grid-cols-2 gap-2">
            <StrainMetricCard label="Peak GRS" value={fmtPct(lv.global_grs)} strainType="GRS" valueNumber={lv.global_grs ?? 0} loading={sc.isComputing} />
            <StrainMetricCard label="Peak GCS" value={fmtPct(lv.global_gcs)} strainType="GCS" valueNumber={lv.global_gcs ?? 0} loading={sc.isComputing} />
            <PlainMetricTile label={`Frame ${(lv.edFrameIndex ?? 0) + 1} WT`} value={fmtMm(lv.ed_wt_mean_mm)} loading={sc.isComputing} />
            <PlainMetricTile label={`Frame ${(lv.esFrameIndex ?? 0) + 1} WT`} value={fmtMm(lv.es_wt_mean_mm)} loading={sc.isComputing} />
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground">Not computed for the current ED/ES pair yet — use Compute ED → ES above.</p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-background p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
            Prototype
          </span>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">RV Global Strain</h4>
        </div>
        <div className="flex items-start gap-1.5 rounded-md border border-dashed border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
          <p className="text-[9px] leading-snug text-amber-800 dark:text-amber-300">
            RV metrics are still prototype and in progress — GCS is computed but not yet validated against a
            reference range, and GAS/cavity area have no computation at all. Every value below is labeled
            Prototype until that work is done.
          </p>
        </div>
        {rv ? (
          <div className="grid grid-cols-2 gap-2">
            <StrainMetricCard label="Peak GCS" value={fmtPct(rv.global_rv_strain)} strainType="GCS" valueNumber={rv.global_rv_strain ?? 0} loading={sc.isComputing} />
            <PlainMetricTile label="Peak GAS" value="—" />
            <PlainMetricTile label={`Frame ${(rv.edFrameIndex ?? 0) + 1} area`} value="—" />
            <PlainMetricTile label={`Frame ${(rv.esFrameIndex ?? 0) + 1} area`} value="—" />
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground">Not computed for the current ED/ES pair yet — use Compute ED → ES above.</p>
        )}
      </div>
    </div>
  );
}

/** Neutral (no color-coding) stat tile — for values that aren't a strain %
 *  (wall thickness in mm, cavity area), where StrainMetricCard's GRS/GCS
 *  color mapping wouldn't mean anything. */
function PlainMetricTile({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      {loading ? (
        <div className="mt-1.5 h-5 w-16 animate-pulse rounded bg-muted-foreground/20" />
      ) : (
        <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      )}
    </div>
  );
}

/**
 * Sidebar "Compute strain" card — matches structure_strain_mockup.html's
 * compact layout (Quick ED→ES vs Full cycle scope toggle; Choose-frames vs
 * Upload-masks sub-toggle in Quick mode) while running the SAME real logic
 * that used to live in the main panel's StrainPreviewPanel toolbar/drawer:
 * the ED/ES picker, the auto-vs-custom-frame warning that gates whether
 * peaks feed Disease Similarity/Health Status, real file upload, and the
 * two real backend calls (strainCompute.onComputeFrames/onComputeUpload).
 * "Full cycle" reuses StrainTab's own runStrainSeries — kept where it
 * already lives rather than moved, since it already works.
 */
function ComputeStrainCard({
  strainCompute: sc,
  seriesBusy,
  seriesError,
  onRunFullCycle,
}: {
  strainCompute: StrainComputeBundle;
  seriesBusy: boolean;
  seriesError: string | null;
  onRunFullCycle: () => void;
}) {
  const edRef = React.useRef<HTMLInputElement>(null);
  const esRef = React.useRef<HTMLInputElement>(null);
  const isQuick = sc.scope === "quick";

  return (
    <div className="rounded-lg border border-border bg-muted/10 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
          Compute strain
        </span>
        <span className="text-[8px] text-muted-foreground/70">LV + RV together</span>
      </div>

      {/* Scope toggle — Quick ED→ES (single pair) vs Full cycle (every frame) */}
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/20 p-0.5">
        {(["quick", "full"] as const).map((scope) => (
          <button
            key={scope}
            type="button"
            onClick={() => sc.onScopeChange(scope)}
            className={cn(
              "rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
              sc.scope === scope
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            {scope === "quick" ? "Quick ED→ES" : "Full cycle"}
          </button>
        ))}
      </div>

      {isQuick ? (
        <>
          {/* Choose frames / Upload masks sub-toggle */}
          <div className="inline-flex w-fit rounded-lg border border-border bg-muted/20 p-0.5 text-[10px]">
            <button
              type="button"
              onClick={() => sc.onInputModeChange("frames")}
              className={cn(
                "rounded-md px-2 py-1 font-medium transition-colors",
                sc.inputMode === "frames"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              Choose frames
            </button>
            <button
              type="button"
              onClick={() => sc.onInputModeChange("upload")}
              className={cn(
                "rounded-md px-2 py-1 font-medium transition-colors",
                sc.inputMode === "upload"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              Upload masks (LV only)
            </button>
          </div>

          {sc.inputMode === "frames" ? (
            <div className="flex flex-col gap-2">
              <p className="text-[9px] text-muted-foreground leading-relaxed">
                Select any two frames from the stored segmentation to compute LV and RV strain between them.
                {sc.hasLandmarkAlignment && <span className="text-green-600 ml-1">Landmark alignment will be applied automatically.</span>}
              </p>

              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-muted-foreground">{sc.frameCount} frames</span>
                <DualFrameRangePicker
                  min={0}
                  max={Math.max(0, sc.frameCount - 1)}
                  edValue={sc.edFrameIdx}
                  esValue={sc.esFrameIdx}
                  onEdChange={sc.onEdFrameChange}
                  onEsChange={sc.onEsFrameChange}
                />
              </div>

              {sc.edFrameIdx === sc.esFrameIdx && (
                <p className="text-[10px] text-destructive">ED and ES frames must be different.</p>
              )}

              {/* Peak strain is only physiologically meaningful between the TRUE
                  end-diastole and end-systole. When the picker is moved off the
                  auto-detected pair the backend deliberately withholds the peaks
                  from heartMetrics (and therefore from disease similarity and
                  health status) — surface that here so the omission isn't silent. */}
              {sc.autoFrames && (sc.edFrameIdx !== sc.autoFrames.ed || sc.esFrameIdx !== sc.autoFrames.es) && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
                  <p className="text-[9px] leading-relaxed text-amber-700 dark:text-amber-400">
                    <span className="font-semibold">Custom frames.</span>{" "}
                    Computing {sc.edFrameIdx + 1}→{sc.esFrameIdx + 1} instead of the auto-detected{" "}
                    {sc.autoFrames.ed + 1}→{sc.autoFrames.es + 1} ({sc.strainModel === "unet" ? "UNet" : "MedSAM"}).
                    Strain will still be computed for inspection, but the peaks will{" "}
                    <span className="font-semibold">not</span> feed Disease Similarity or Health
                    Status — those need the true ED/ES pair.
                  </p>
                  <button
                    type="button"
                    onClick={sc.onResetToAuto}
                    className="mt-1 text-[9px] font-medium text-amber-800 underline underline-offset-2 hover:no-underline dark:text-amber-300"
                  >
                    Reset to auto-detected frames
                  </button>
                </div>
              )}

              {sc.autoFrames && sc.edFrameIdx === sc.autoFrames.ed && sc.esFrameIdx === sc.autoFrames.es && (
                <p className="text-[9px] leading-relaxed text-emerald-700 dark:text-emerald-400">
                  Using the auto-detected ED/ES ({sc.autoFrames.ed + 1}→{sc.autoFrames.es + 1}) — peaks
                  will feed Disease Similarity and Health Status.
                </p>
              )}

              <p className="text-[8.5px] leading-relaxed text-muted-foreground">
                Values are indicative only — auto-segmentation masks have limited wall boundary accuracy. For
                clinical accuracy, use Upload Masks with manually verified masks.
              </p>

              {sc.error && (
                <p className="text-[9px] text-destructive rounded bg-destructive/10 px-2 py-1">{sc.error}</p>
              )}

              <button
                type="button"
                disabled={sc.edFrameIdx === sc.esFrameIdx || sc.frameCount <= 1 || sc.isComputing}
                onClick={sc.onComputeFrames}
                className="w-full rounded-md bg-primary px-3 py-1.5 text-[10px] font-semibold text-primary-foreground disabled:opacity-50 transition-colors hover:bg-primary/90"
              >
                {sc.isComputing ? (
                  <span className="inline-flex items-center justify-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Computing…</span>
                ) : "Compute ED → ES"}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-[9px] text-muted-foreground leading-relaxed">
                Any NIfTI segmentation mask (.nii or .nii.gz) with classes 0=background, 1=RV, 2=myocardium,
                3=LV cavity. Computes LV strain only — use &quot;Choose frames&quot; for RV.
                {sc.hasLandmarkAlignment && <span className="text-green-600 ml-1">Landmark alignment will be applied automatically.</span>}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[8px] text-muted-foreground mb-1">End-Diastole (ED)</p>
                  <input ref={edRef} type="file" accept=".nii,.nii.gz" className="sr-only"
                    onChange={(e) => sc.onEdFileChange(e.target.files?.[0] ?? null)} />
                  <button type="button" onClick={() => edRef.current?.click()}
                    className={cn(
                      "w-full flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[9px] font-medium transition-colors",
                      sc.edFile ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400"
                                : "border-dashed border-border bg-background text-muted-foreground hover:bg-muted/50"
                    )}>
                    <Upload className="h-3 w-3 shrink-0" />
                    <span className="truncate">{sc.edFile ? sc.edFile.name : "Choose ED .nii/.gz"}</span>
                  </button>
                </div>
                <div>
                  <p className="text-[8px] text-muted-foreground mb-1">End-Systole (ES)</p>
                  <input ref={esRef} type="file" accept=".nii,.nii.gz" className="sr-only"
                    onChange={(e) => sc.onEsFileChange(e.target.files?.[0] ?? null)} />
                  <button type="button" onClick={() => esRef.current?.click()}
                    className={cn(
                      "w-full flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[9px] font-medium transition-colors",
                      sc.esFile ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400"
                                : "border-dashed border-border bg-background text-muted-foreground hover:bg-muted/50"
                    )}>
                    <Upload className="h-3 w-3 shrink-0" />
                    <span className="truncate">{sc.esFile ? sc.esFile.name : "Choose ES .nii/.gz"}</span>
                  </button>
                </div>
              </div>
              {sc.error && (
                <p className="text-[9px] text-destructive rounded bg-destructive/10 px-2 py-1">{sc.error}</p>
              )}
              <button
                type="button"
                disabled={!sc.edFile || !sc.esFile || sc.isComputing}
                onClick={sc.onComputeUpload}
                className={cn(
                  "w-full rounded-md px-3 py-1.5 text-[10px] font-semibold transition-colors",
                  (!sc.edFile || !sc.esFile || sc.isComputing)
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {sc.isComputing ? (
                  <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Computing…</span>
                ) : "Compute Strain"}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[8.5px] leading-relaxed text-muted-foreground">
            Uses the auto-detected ED frame as reference — no frame picker or upload needed for the full cycle.
          </p>
          <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={seriesBusy} onClick={onRunFullCycle}>
            {seriesBusy ? <ComputeBusyLabel verb="Computing" frames={sc.frameCount} /> : `Compute all frames (${sc.strainModel === "unet" ? "UNet" : "MedSAM"})`}
          </Button>
          {seriesError && <p className="text-[9px] text-destructive">{seriesError}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * RV side of the Strain Results panel — deliberately simpler than the LV
 * panel above it (no GRS/GCS split, no region/cycle chart views, no 3D
 * heart): RV strain is a single cavity-radius measure per region, not a
 * 17-segment wall-thickness field, so there's less structure to visualize.
 * Reuses getStrainColor(..., "GCS") for coloring since RV strain shares
 * GCS's "more negative is healthier" convention.
 */
/** AHA-style label set for RV's prototype 9-segment breakdown — there is no
 *  real per-region time series at this granularity yet (the real pipeline
 *  only produces the 6 basal/mid free-wall regions in rvRegionValues), so
 *  this exists purely to preview the eventual layout, sharing LV's
 *  RegionalStrainByRegion/FullCycleChart components (they only care about
 *  segment numbers/labels/values, not that they're LV-specific). */
const RV_DUMMY_SEGMENT_LABELS = [
  "Basal Anterior", "Basal Lateral", "Basal Inferior",
  "Mid Anterior", "Mid Lateral", "Mid Inferior",
  "Apical Anterior", "Apical Lateral", "Apical Inferior",
];
function buildDummyRvCycleSeries(totalFrames: number): { segment: number; label: string; strain: number }[][] {
  const frames = Math.max(totalFrames || 9, 2);
  return Array.from({ length: frames }, (_, f) => {
    const wobble = Math.sin((f / Math.max(frames - 1, 1)) * Math.PI);
    return RV_DUMMY_SEGMENT_LABELS.map((label, i) => ({
      segment: i + 1,
      label,
      strain: Number((-13 - i * 1.1 - wobble * 6).toFixed(1)),
    }));
  });
}

function RvStrainPanel({
  usingRealRvSeries,
  usingRealRvStrain,
  rvCurveData,
  rvRegionValues,
  rvCurrentAverage,
  rvPeakValue,
  currentTime,
  strainCompute,
  seriesBusy,
}: {
  usingRealRvSeries: boolean;
  usingRealRvStrain: boolean;
  rvCurveData: { frame: number; time: number; strain: number }[];
  rvRegionValues: { segment: number; label: string; strain: number }[];
  rvCurrentAverage: number;
  rvPeakValue: number;
  currentTime: number;
  strainCompute?: StrainComputeBundle;
  seriesBusy: boolean;
}) {
  const rvMetricType = strainCompute?.rvMetricType ?? "GCS";
  const isGas = rvMetricType === "GAS";
  const [rvCurveView, setRvCurveView] = useState<"global" | "region" | "cycle">("global");

  // A 9-segment prototype series, illustrative for both metrics: real GCS
  // only has the 6-region breakdown in rvRegionValues (used for "Global"
  // below); GAS has no computation at all, so it's dummy everywhere.
  const dummyFrameCount = rvCurveData.length || 30;
  const dummyRvSeries = useMemo(() => buildDummyRvCycleSeries(dummyFrameCount), [dummyFrameCount]);
  const dummyRvGlobalCurve = useMemo(
    () => dummyRvSeries.map((frameSegs, i) => ({
      frame: i + 1,
      time: rvCurveData[i]?.time ?? Math.round((i / Math.max(dummyRvSeries.length - 1, 1)) * 1200),
      strain: Number((frameSegs.reduce((sum, d) => sum + d.strain, 0) / frameSegs.length).toFixed(1)),
    })),
    [dummyRvSeries, rvCurveData],
  );

  return (
    <div className="space-y-4">
      {/* GCS/GAS — button toggle, mirrors LV's GRS/GCS toggle. Controls both
          this panel's content and the main panel's RV bullseye coloring. */}
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/20 p-1">
        {(["GCS", "GAS"] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => strainCompute?.onRvMetricTypeChange(type)}
            className={cn(
              "rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
              rvMetricType === type
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {type}
          </button>
        ))}
      </div>

      <div className="flex items-start gap-1.5 rounded-md border border-dashed border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
        <span className="mt-0.5 shrink-0 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
          Prototype
        </span>
        <p className="text-[9.5px] leading-snug text-amber-800 dark:text-amber-300">
          {isGas
            ? "RV GAS has no computation in this pipeline yet — every value below is a placeholder, not a measurement."
            : "RV GCS is still prototype and in progress — computed, but not validated against a reference range yet."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StrainMetricCard
          label={isGas ? "Prototype — Current GAS" : `Prototype — ${usingRealRvSeries ? "Current GCS" : usingRealRvStrain ? "GCS (ED→ES)" : "GCS"}`}
          value={isGas ? "—" : `${rvCurrentAverage.toFixed(1)}%`}
          strainType="GCS"
          valueNumber={isGas ? 0 : rvCurrentAverage}
          loading={!isGas && seriesBusy}
        />
        <StrainMetricCard
          label={isGas ? "Prototype — Peak GAS" : "Prototype — Peak GCS"}
          value={isGas ? "—" : `${rvPeakValue.toFixed(1)}%`}
          strainType="GCS"
          valueNumber={isGas ? 0 : rvPeakValue}
          loading={!isGas && seriesBusy}
        />
      </div>

      {!isGas && !usingRealRvSeries && (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-2.5">
          <p className="text-[10px] leading-snug text-muted-foreground">
            {usingRealRvStrain
              ? "Only the ED→ES RV strain is stored — compute all frames for a full-cycle curve."
              : "No RV strain computed for this model yet."}
          </p>
        </div>
      )}

      {/* Global / By Region / Full Cycle — same structure as LV. Global uses
          the real per-frame curve for GCS; By Region and Full Cycle are an
          illustrative 9-segment prototype for both metrics (GAS is dummy
          everywhere, including Global). */}
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
            {rvCurveView === "global"
              ? (isGas ? "Prototype — Global GAS Curve" : "Global GCS Curve")
              : rvCurveView === "region"
              ? "Prototype — By Region (9 segments)"
              : "Prototype — Full Cycle (9 segments)"}
          </h4>
          {rvCurveView === "global" && (
            <span className="text-[10px] text-muted-foreground">
              {isGas ? "Dummy preview" : usingRealRvSeries ? `${rvCurveData.length} frames` : "Preview"}
            </span>
          )}
        </div>
        <div className="mb-2 grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/20 p-0.5">
          {([
            ["global", "Global"],
            ["region", "By Region"],
            ["cycle", "Full Cycle"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setRvCurveView(key)}
              className={cn(
                "rounded-md px-1.5 py-1 text-[10px] font-medium transition-colors",
                rvCurveView === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {rvCurveView === "global" && (isGas || usingRealRvSeries) && (
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={isGas ? dummyRvGlobalCurve : rvCurveData} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="time" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                  domain={["dataMin - 5", "dataMax + 5"]}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip
                  cursor={{ stroke: "var(--border)" }}
                  formatter={(value) => [`${Number(value).toFixed(1)}%`, isGas ? "RV GAS (dummy)" : "RV GCS"]}
                  labelFormatter={(label) => `${label} ms`}
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--popover)",
                    color: "var(--popover-foreground)",
                    fontSize: 12,
                  }}
                />
                <ReferenceLine x={currentTime} stroke="var(--primary)" strokeDasharray="4 4" ifOverflow="extendDomain" />
                <Line type="monotone" dataKey="strain" stroke={isGas ? "#f59e0b" : "#38bdf8"} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        {rvCurveView === "global" && !isGas && !usingRealRvSeries && (
          <p className="py-4 text-center text-[10px] text-muted-foreground">No RV strain computed for this model yet.</p>
        )}

        {rvCurveView === "region" && <RegionalStrainByRegion series={dummyRvSeries} />}

        {rvCurveView === "cycle" && (
          <div className="w-full overflow-x-auto">
            <FullCycleChart series={dummyRvSeries} strainType="GCS" width={480} height={240} />
          </div>
        )}

        {rvCurveView !== "global" && (
          <p className="mt-2 text-[9px] text-amber-700 dark:text-amber-400">
            Prototype — illustrative 9-segment breakdown, not backed by a real per-region computation yet.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-background">
        <div className="border-b border-border px-3 py-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
            {rvCurveView === "global" ? "Region Values" : "Prototype — Segment Values"}
          </h4>
        </div>
        {rvCurveView === "global" ? (
          isGas ? (
            <p className="p-3 text-[10px] text-muted-foreground">Switch to RV GCS for computed (still prototype) region values.</p>
          ) : rvRegionValues.length ? (
            <SegmentValuesTable segmentValues={rvRegionValues} strainType="GCS" />
          ) : (
            <p className="p-3 text-[10px] text-muted-foreground">No RV region data yet.</p>
          )
        ) : (
          <SegmentValuesTable segmentValues={dummyRvSeries[0] ?? []} strainType="GCS" />
        )}
      </div>
    </div>
  );
}

function SegmentValuesTable({
  segmentValues,
  strainType,
}: {
  segmentValues: { segment: number; label: string; strain: number }[];
  strainType: StrainType;
}) {
  return (
    <div className="max-h-56 overflow-y-auto">
      <table className="w-full text-xs">
        <tbody className="divide-y divide-border">
          {segmentValues.map((segment) => (
            <tr key={segment.segment} className="hover:bg-muted/40">
              <td className="px-3 py-2 text-muted-foreground">{segment.segment}</td>
              <td className="px-2 py-2">{segment.label}</td>
              <td
                className="px-3 py-2 text-right font-mono"
                style={{ color: getStrainColor(segment.strain, strainType) }}
              >
                {segment.strain > 0 ? "+" : ""}{segment.strain.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StrainMetricCard({
  label,
  value,
  strainType,
  valueNumber,
  loading,
}: {
  label: string;
  value: string;
  strainType: StrainType;
  valueNumber: number;
  /** Recompute in progress — shows a pulsing placeholder instead of the
   *  (now-stale) value, for both Quick and Full cycle recomputes. */
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <p className="text-[10px] text-muted-foreground">{label}</p>
        <div className="mt-1.5 h-5 w-16 animate-pulse rounded bg-muted-foreground/20" />
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p
        className="mt-1 text-lg font-semibold"
        style={{ color: getStrainColor(valueNumber, strainType) }}
      >
        {value}
      </p>
    </div>
  );
}

// Settings
