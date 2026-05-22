"use client";

import React, { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
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
  Settings2,
  Brain,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Upload,
  X,
  AlertCircle,
  RefreshCw,
  Download,
  FileText,
} from "lucide-react";
import {
  LANDMARK_DEFINITIONS,
  getLandmarkCoord,
} from "@/types/landmark";
import type { LandmarkPageState, FramePrediction } from "@/types/landmark";
import { getDummyStrainData, getStrainColor, type StrainType } from "@/components/landmark/StrainVisualization";

const NAV_ITEMS = [
  { key: "landmarks", icon: MapPin,    label: "Landmarks" },
  { key: "strain",    icon: Activity,  label: "Strain"    },
  { key: "settings",  icon: Settings2, label: "Settings"  },
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
  const [activeTab, setActiveTab] = useState<TabKey>("landmarks");
  const handleTabChange = useCallback((key: TabKey) => setActiveTab(key), []);
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
              activeTab === key
                ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)] shadow-sm"
                : "hover:bg-primary/20 text-[var(--sidebar-foreground)]",
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

      {/* Playback controls */}
      {hasPredictions && (
        <PlaybackBar
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
          />
        )}
        {activeTab === "strain" && (
          <StrainTab
            hasPredictions={hasPredictions}
            currentFrame={state.currentFrame}
            totalFrames={state.totalFrames}
            selectedStrainSegment={selectedStrainSegment}
            selectedStrainType={selectedStrainType}
          />
        )}
        {activeTab === "settings" && (
          <SettingsTab
            hasPredictions={hasPredictions}
            onRerun={onRerun}
            onReset={onReset}
            modelUsed={state.modelUsed || "UNetResNet34 Landmark"}
            totalFrames={state.totalFrames}
          />
        )}
      </div>

      {/* Bottom action buttons */}
      {hasPredictions && (
        <div className="p-4 border-t border-[var(--sidebar-border)] flex flex-col gap-2 flex-shrink-0">
          <Button
            size="sm"
            className="w-full text-xs gap-1.5"
            onClick={onRerun}
            variant="outline"
          >
            Re-run Detection
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
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
}: {
  currentFrame: number;
  totalFrames: number;
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

        {/* Frame counter */}
        <span className="text-[10px] text-muted-foreground font-mono shrink-0 tabular-nums">
          {currentFrame + 1}/{totalFrames}
        </span>
      </div>

      {/* Playback mode label */}
      <p className="text-[10px] text-muted-foreground text-center">
        {confidentCount >= 2
          ? `Playing ${confidentCount} confident slices`
          : "Playing all slices"}
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
    tip = model_used === "2ch" ? "High confidence (seg-guided)" : "High confidence";
  } else {
    color = "bg-orange-400";
    tip = "Low confidence prediction";
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
}: {
  prediction: FramePrediction | null;
  visibleLandmarks: Set<string>;
  onToggleLandmark: (id: string) => void;
  hasPredictions: boolean;
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
}) {
  const settings = [
    { label: "Show landmark labels", checked: showLabels, onCheckedChange: onToggleShowLabels },
    { label: "Move/edit landmarks", checked: editableLandmarks, onCheckedChange: onToggleEditableLandmarks },
  ];

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
        Detection Settings
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
  const [selectedStrainType, setSelectedStrainType] = useState<StrainType>(externalStrainType ?? "GCS");
  const frameCount = Math.max(totalFrames || 10, 1);
  const curveData = selectedStrainSegment
    ? Array.from({ length: frameCount }, (_, frame) => {
        const segment = getDummyStrainData(selectedStrainType, frame, frameCount)
          .find((item) => item.segment === selectedStrainSegment);
        return {
          frame: frame + 1,
          time: Math.round((frame / Math.max(frameCount - 1, 1)) * 1200),
          strain: segment?.strain ?? 0,
        };
      })
    : strainCurveData(selectedStrainType, frameCount);
  const segmentValues = getDummyStrainData(selectedStrainType, currentFrame, frameCount);
  const selectedSegmentValue = selectedStrainSegment
    ? segmentValues.find((item) => item.segment === selectedStrainSegment)
    : null;
  const currentAverage = segmentValues.reduce((sum, item) => sum + item.strain, 0) / segmentValues.length;
  const peakValue = selectedStrainType === "GRS"
    ? Math.max(...curveData.map((item) => item.strain))
    : Math.min(...curveData.map((item) => item.strain));
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
              : "Dummy preview values"}, frame {currentFrame + 1}/{frameCount}
          </p>
        </div>
        <span className="rounded-md border border-border bg-background px-2 py-1 text-[10px] font-mono text-muted-foreground">
          {currentTime} ms
        </span>
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

      <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/20 p-1">
        {(["GRS", "GCS", "GLS"] as const).map((type) => (
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
          label={`Current ${selectedStrainType}`}
          value={`${currentAverage > 0 ? "+" : ""}${currentAverage.toFixed(1)}%`}
          strainType={selectedStrainType}
          valueNumber={currentAverage}
        />
        <StrainMetricCard
          label={`Peak ${selectedStrainType}`}
          value={`${peakValue > 0 ? "+" : ""}${peakValue.toFixed(1)}%`}
          strainType={selectedStrainType}
          valueNumber={peakValue}
        />
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
            {selectedStrainSegment ? `Segment ${selectedStrainSegment}` : "Global"} {selectedStrainType} Curve
          </h4>
          <span className="text-[10px] text-muted-foreground">Time (ms)</span>
        </div>
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
      </div>

      <div className="rounded-lg border border-border bg-background">
        <div className="border-b border-border px-3 py-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
            Segment Values
          </h4>
        </div>
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-border">
              {segmentValues.map((segment) => (
                <tr key={segment.segment} className="hover:bg-muted/40">
                  <td className="px-3 py-2 text-muted-foreground">{segment.segment}</td>
                  <td className="px-2 py-2">{segment.label}</td>
                  <td
                    className="px-3 py-2 text-right font-mono"
                    style={{ color: getStrainColor(segment.strain, selectedStrainType) }}
                  >
                    {segment.strain > 0 ? "+" : ""}{segment.strain.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
        <Button
          variant="outline"
          size="sm"
          className="text-xs gap-1.5"
          onClick={() => alert("Strain report export is a placeholder until real strain values are connected.")}
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
function SettingsTab({
  hasPredictions,
  onRerun,
  onReset,
  modelUsed,
  totalFrames,
}: {
  hasPredictions: boolean;
  onRerun: () => void;
  onReset: () => void;
  modelUsed: string;
  totalFrames: number;
}) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-foreground">Settings</h3>

      <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
          Inference Summary
        </h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <span className="text-muted-foreground">Model</span>
          <span className="text-right font-medium text-foreground truncate">{modelUsed}</span>
          <span className="text-muted-foreground">Frames</span>
          <span className="text-right font-medium text-foreground">{totalFrames || "Not detected"}</span>
          <span className="text-muted-foreground">Status</span>
          <span className={cn("text-right font-medium", hasPredictions ? "text-green-600" : "text-amber-600")}>
            {hasPredictions ? "Active" : "Pending"}
          </span>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-background p-3">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
          Workflow
        </h4>
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs gap-2"
          onClick={onRerun}
          disabled={!hasPredictions}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Re-run Detection (bypass cache)
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={onReset}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset Page
        </Button>
      </div>
    </div>
  );
}
