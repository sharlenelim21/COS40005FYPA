"use client";

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useProjectResults } from "@/hooks/useProjectResults";
import { useProject } from "@/context/ProjectContext";
import { computeStrainSeries } from "@/lib/landmarkApi";
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
  Activity,
  Brain,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Upload,
  X,
  AlertCircle,
  Download,
  FileText,
} from "lucide-react";
import {
  LANDMARK_DEFINITIONS,
  getLandmarkCoord,
} from "@/types/landmark";
import type { LandmarkPageState, FramePrediction } from "@/types/landmark";
import { getDummyStrainData, getStrainColor, type StrainType } from "@/components/landmark/StrainVisualization";
import { RegionalStrainByRegion, FullCycleChart, LVSegmentsLegend, buildDummyCycleSeries } from "@/components/landmark/RegionalStrainCharts";

// Two tabs, split by what they operate on: landmark points (per slice) and
// strain (per cardiac frame). The former Settings tab was removed — its
// inference summary and Re-run button both already exist in the page header,
// leaving only Reset Page, which now lives with the landmark controls.
const NAV_ITEMS = [
  { key: "landmarks", icon: MapPin,   label: "Landmarks" },
  { key: "strain",    icon: Activity, label: "Strain"    },
] as const;

type TabKey = typeof NAV_ITEMS[number]["key"];
const SIDEBAR_LANDMARK_IDS = new Set(["rv_insertion_1", "rv_insertion_2"]);

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
  /**
   * Reports the Strain tab's cardiac-cycle frame so the page's bullseye and 3D
   * heart can follow strain playback. Distinct from the slice index in `state`.
   */
  onStrainFrameChange?: (frame: number) => void;
  /**
   * Reports the active tab so the page can switch the whole workspace, not just
   * this sidebar: Landmarks shows the MRI viewer alone, Strain shows the
   * bullseye and 3D heart.
   */
  onTabChange?: (tab: "landmarks" | "strain") => void;
  /**
   * Controls the active tab from the page. The page remounts this sidebar when
   * the workspace changes (the resizable group is keyed on it), which would
   * otherwise reset internal tab state back to "landmarks" and desync the two
   * panels. Passing it in keeps them in lockstep.
   */
  activeTab?: "landmarks" | "strain";

  onToggleLandmark: (id: string) => void;
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
  selectedStrainSegment?: number | null;
  selectedStrainType?: StrainType;
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
  onToggleLandmark,
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
  selectedStrainSegment,
  selectedStrainType = "GCS",
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

      {/* Playback controls — fixed above the scroll area for Landmarks/Settings.
          For Strain, it scrolls away with the tab content instead (see below):
          fixed playback bar + our sticky graph card would otherwise stack two
          pinned elements and cover the segment labels underneath.

          AXIS: the Landmarks tab steps through SLICES — landmark detection runs
          per slice, so state.totalFrames (from the model's result) is a slice
          count despite the name. The Strain tab steps through FRAMES (the
          cardiac cycle) instead; see the strain PlaybackBar below. */}
      {hasPredictions && activeTab !== "strain" && (
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
        {activeTab === "strain" && hasPredictions && (
          <div className="-mx-4 -mt-4 mb-4">
            {/* Strain is a property of the cardiac CYCLE, so this steps through
                frames (e.g. 1/30) — not slices like the Landmarks tab. */}
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
            prediction={currentPrediction}
            visibleLandmarks={visibleLandmarks}
            onToggleLandmark={onToggleLandmark}
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
        {activeTab === "strain" && (
          <div className="space-y-4">
            <StrainTab
              hasPredictions={hasPredictions}
              currentFrame={strainFrame}
              totalFrames={strainFrameCount}
              selectedStrainSegment={selectedStrainSegment}
              selectedStrainType={selectedStrainType}
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
          aria-label="Previous frame"
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
          aria-label="Next frame"
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
        aria-label="Frame scrubber"
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
/** Small coloured dot + tooltip for per-slice prediction quality. */
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
  prediction,
  visibleLandmarks,
  onToggleLandmark,
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
  prediction: FramePrediction | null;
  visibleLandmarks: Set<string>;
  onToggleLandmark: (id: string) => void;
  hasPredictions: boolean;
  /** Reset Page — relocated here from the removed Settings tab. */
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
            Frame {currentFrame + 1}
          </span>
        </div>
      </div>

      {/* Landmark rows */}
      <div className="space-y-1">
        {LANDMARK_DEFINITIONS.filter((def) => SIDEBAR_LANDMARK_IDS.has(def.id)).map((def) => {
          const coord = getLandmarkCoord(prediction, def.id);
          const isVisible = visibleLandmarks.has(def.id);
          const hasCoord  = !!coord;

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
              {/* Visibility pill */}
              <span
                className={cn(
                  "text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0",
                  isVisible
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {isVisible ? "on" : "off"}
              </span>
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

function StrainTab({
  hasPredictions,
  currentFrame,
  totalFrames,
  selectedStrainSegment,
  selectedStrainType: externalStrainType,
}: {
  hasPredictions: boolean;
  currentFrame: number;
  totalFrames: number;
  selectedStrainSegment?: number | null;
  selectedStrainType?: StrainType;
}) {
  const router = useRouter();
  const { projectId } = useParams<{ projectId: string }>();
  const [selectedStrainType, setSelectedStrainType] = useState<StrainType>(
    externalStrainType && externalStrainType !== ("GLS" as string) ? externalStrainType : "GRS"
  );
  const [curveView, setCurveView] = useState<"global" | "region" | "cycle">("global");
  const [labelsView, setLabelsView] = useState<"lvSegments" | "values">("lvSegments");
  const [hoverSeg, setHoverSeg] = useState<number | null>(null);
  const frameCount = Math.max(totalFrames || 10, 1);

  // Stored per-model strain (ED→ES) and the optional full-cycle series. Each
  // segmentation model is its own mask document, so `strainModel` is a display
  // selector over already-computed results — switching never recomputes.
  const [strainModel, setStrainModel] = useState<"unet" | "medsam">("unet");
  const {
    strain: realStrain,
    strainSeries: realSeries,
    available: modelAvailable,
    setModel: setResultsModel,
    autoEdFrame,
  } = useProjectResults(projectId);
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
    setSeriesError(null);
    try {
      await computeStrainSeries(projectId, edIndex, strainModel);
      // Stored on the mask — reload so every consumer picks it up.
      window.location.reload();
    } catch (err: any) {
      setSeriesError(err?.response?.data?.error ?? err?.message ?? "Strain series failed.");
    } finally {
      setSeriesBusy(false);
    }
  }, [projectId, realStrain, realSeries, strainModel, autoEdFrame]);
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
        let value: number;
        if (selectedStrainSegment) {
          const seg = segs.find((s) => s.segment === selectedStrainSegment);
          value = ((seg as any)?.[strainKey] ?? 0) as number;
        } else {
          const vals = segs
            .map((s) => (s as any)[strainKey])
            .filter((v: unknown): v is number => typeof v === "number");
          value = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        }
        return {
          frame: f.frameIndex + 1,
          time: Math.round((i / Math.max(n - 1, 1)) * 1200),
          strain: Number(value.toFixed(1)),
        };
      });
    }
    if (selectedStrainSegment) {
      return Array.from({ length: frameCount }, (_, frame) => {
        const segment = getDummyStrainData(selectedStrainType, frame, frameCount)
          .find((item) => item.segment === selectedStrainSegment);
        return {
          frame: frame + 1,
          time: Math.round((frame / Math.max(frameCount - 1, 1)) * 1200),
          strain: segment?.strain ?? 0,
        };
      });
    }
    return strainCurveData(selectedStrainType, frameCount);
  }, [realSeries, strainKey, selectedStrainSegment, selectedStrainType, frameCount]);
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
  const selectedSegmentValue = selectedStrainSegment
    ? segmentValues.find((item) => item.segment === selectedStrainSegment)
    : null;
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Strain Results</h3>
          <p className="text-[10px] text-muted-foreground">
            {selectedSegmentValue
              ? `Segment ${selectedSegmentValue.segment}: ${selectedSegmentValue.label}`
              : usingRealSeries ? "Computed strain (per-frame)"
              : usingRealStrain ? "Computed strain (ED→ES)"
              : "Dummy preview values"}, frame {currentFrame + 1}/{frameCount}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* UNet and MedSAM segment differently, so their strain differs —
              each model's result is stored on its own mask document. */}
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
          <span className="rounded-md border border-border bg-background px-2 py-1 text-[10px] font-mono text-muted-foreground">
            {currentTime} ms
          </span>
        </div>
      </div>

      {selectedSegmentValue && (
        <div className="rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">Selected from 2D chart</span>
            <span className="font-mono" style={{ color: getStrainColor(selectedSegmentValue.strain, selectedStrainType) }}>
              {selectedSegmentValue.strain > 0 ? "+" : ""}{selectedSegmentValue.strain.toFixed(1)}%
            </span>
          </div>
          <p className="mt-1 text-muted-foreground">
            The vertical marker below shows this frame on the global {selectedStrainType} curve.
          </p>
        </div>
      )}

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
              ? "Recomputing… one pass per frame"
              : `Recompute all frames with current landmarks (${strainModel === "unet" ? "UNet" : "MedSAM"})`}
          </Button>
          {seriesError && <p className="mt-1 text-[9px] text-destructive">{seriesError}</p>}
        </div>
      )}

      {/* Full-cycle strain is opt-in: it costs one GPU pass per frame, so it is
          not chained automatically after the ED→ES compute. Shown until a series
          exists for the selected model. */}
      {/* Full-cycle strain: one GPU pass per frame, so it is opt-in rather than
          chained after the ED→ES compute. Always available — a recompute is
          needed after landmark edits, and after any pipeline change that adds
          new per-frame fields. The stale banner above covers the landmark case. */}
      {!strainIsStale && (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-2.5">
          <p className="text-[10px] leading-snug text-muted-foreground">
            {usingRealSeries
              ? `Full-cycle strain computed for ${realSeries!.frames.length} frames${
                  realSeries!.computed_at
                    ? ` on ${new Date(realSeries!.computed_at).toLocaleDateString()}`
                    : ""
                }.`
              : usingRealStrain
              ? "Only the ED→ES strain is stored for this model — the curves below are a preview shape."
              : "No strain computed for this model yet — values below are a dummy preview."}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-7 w-full text-[10px]"
            disabled={seriesBusy}
            onClick={runStrainSeries}
          >
            {seriesBusy
              ? "Computing… one pass per frame"
              : `${usingRealSeries ? "Recompute" : "Compute"} all frames (${strainModel === "unet" ? "UNet" : "MedSAM"})`}
          </Button>
          {seriesError && <p className="mt-1 text-[9px] text-destructive">{seriesError}</p>}
        </div>
      )}

      <div className="sticky top-0 z-10 rounded-lg border border-border bg-background p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
            {curveView === "global"
              ? `${selectedStrainSegment ? `Segment ${selectedStrainSegment}` : "Global"} ${selectedStrainType} Curve`
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
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="time"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  domain={selectedStrainType === "GRS" ? [0, 42] : [-26, 2]}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--border))" }}
                  formatter={(value) => [`${Number(value).toFixed(1)}%`, selectedStrainType]}
                  labelFormatter={(label) => `${label} ms`}
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid hsl(var(--border))",
                    background: "hsl(var(--popover))",
                    color: "hsl(var(--popover-foreground))",
                    fontSize: 12,
                  }}
                />
                <ReferenceLine
                  x={currentTime}
                  stroke="hsl(var(--primary))"
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

      <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5"
          onClick={() => router.push(`/project/${projectId}/report`)}
        >
          <Download className="h-3.5 w-3.5" />
          Report
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5"
          onClick={() => alert("Strain CSV export is a placeholder.")}
        >
          <FileText className="h-3.5 w-3.5" />
          Data
        </Button>
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
}: {
  label: string;
  value: string;
  strainType: StrainType;
  valueNumber: number;
}) {
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
