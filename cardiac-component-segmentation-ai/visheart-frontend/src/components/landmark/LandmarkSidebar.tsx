"use client";

import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import type { FramePrediction } from "@/types/landmark";
import {
  LANDMARK_DEFINITIONS,
  getLandmarkCoord,
  AHA_SEGMENT_COLORS,
} from "@/types/landmark";
import type { LandmarkPageState } from "@/types/landmark";

const NAV_ITEMS = [
  { key: "landmarks", icon: MapPin,    label: "Landmarks" },
  { key: "strain",    icon: Activity,  label: "Strain"    },
  { key: "settings",  icon: Settings2, label: "Settings"  },
] as const;

type TabKey = typeof NAV_ITEMS[number]["key"];

interface LandmarkSidebarProps {
  state: LandmarkPageState;
  currentPrediction: FramePrediction | null;
  visibleLandmarks: Set<string>;
  onToggleLandmark: (id: string) => void;
  onTogglePlay: () => void;
  onNextFrame: () => void;
  onPrevFrame: () => void;
  onSliderChange: (frame: number) => void;
  onReset: () => void;
  onApplyAlignment: () => void;
}

export function LandmarkSidebar({
  state,
  currentPrediction,
  visibleLandmarks,
  onToggleLandmark,
  onTogglePlay,
  onNextFrame,
  onPrevFrame,
  onSliderChange,
  onReset,
  onApplyAlignment,
}: LandmarkSidebarProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("landmarks");
  const handleTabChange = useCallback((key: TabKey) => setActiveTab(key), []);
  const hasPredictions = state.status === "done" && state.predictions.length > 0;

  return (
    <div className="flex flex-col h-full bg-[var(--sidebar)] rounded-r-xl border border-[var(--sidebar-border)] shadow-sm">

      {/* Top tab nav — matches SegmentationSidebar exactly */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--sidebar-border)] bg-[var(--sidebar-primary)] rounded-tr-xl">
        {NAV_ITEMS.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all flex-1",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              activeTab === key
                ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)] shadow-sm"
                : "hover:bg-primary/20 text-[var(--sidebar-foreground)]",
            )}
            onClick={() => handleTabChange(key)}
            type="button"
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="text-xs font-medium">{label}</span>
          </button>
        ))}
      </div>

      {/* Model indicator strip — mirrors SegmentationSidebar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--sidebar-border)] bg-[var(--sidebar-primary)]/50">
        <Brain className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-[11px] text-muted-foreground">Model:</span>
        <span className="text-[11px] font-semibold text-foreground truncate">
          {state.modelUsed || "HRNet-LV"}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 shrink-0">
          <span className="h-1 w-1 rounded-full bg-green-500 inline-block" />
          {state.status === "done" ? "Ready" : "Sprint 2"}
        </span>
      </div>

      {/* Playback controls strip */}
      {hasPredictions && (
        <PlaybackControls
          currentFrame={state.currentFrame}
          totalFrames={state.totalFrames}
          isPlaying={state.isPlaying}
          onTogglePlay={onTogglePlay}
          onNextFrame={onNextFrame}
          onPrevFrame={onPrevFrame}
          onSliderChange={onSliderChange}
        />
      )}

      {/* Scrollable content  */}
      <div className="flex-1 flex flex-col p-4 overflow-y-auto">
        {activeTab === "landmarks" && (
          <LandmarksPanel
            prediction={currentPrediction}
            visibleLandmarks={visibleLandmarks}
            onToggleLandmark={onToggleLandmark}
            hasPredictions={hasPredictions}
            currentFrame={state.currentFrame}
          />
        )}
        {activeTab === "strain" && (
          <StrainPanel hasPredictions={hasPredictions} />
        )}
        {activeTab === "settings" && (
          <SettingsPanel onReset={onReset} />
        )}
      </div>

      {/* Action buttons (bottom, full-width)  */}
      {hasPredictions && (
        <div className="p-4 border-t border-[var(--sidebar-border)] flex flex-col gap-2">
          <Button
            className="w-full text-xs"
            onClick={onApplyAlignment}
          >
            Apply AHA-17 Alignment ↗
          </Button>
          <Button variant="outline" size="sm" className="w-full text-xs">
            Export Landmarks
          </Button>
        </div>
      )}
    </div>
  );
}

// Playback controls strip 
function PlaybackControls({
  currentFrame,
  totalFrames,
  isPlaying,
  onTogglePlay,
  onNextFrame,
  onPrevFrame,
  onSliderChange,
}: {
  currentFrame: number;
  totalFrames: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onNextFrame: () => void;
  onPrevFrame: () => void;
  onSliderChange: (f: number) => void;
}) {
  return (
    <div className="px-4 py-3 border-b border-[var(--sidebar-border)] space-y-2">
      {/* Controls row */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={onPrevFrame}
          disabled={currentFrame === 0}
          className="p-1.5 rounded-md hover:bg-muted/50 disabled:opacity-30 transition-colors"
          title="Previous frame"
        >
          <SkipBack className="h-4 w-4" />
        </button>

        <button
          onClick={onTogglePlay}
          className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium transition-colors"
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {isPlaying ? "Pause" : "Play"}
        </button>

        <button
          onClick={onNextFrame}
          disabled={currentFrame === totalFrames - 1}
          className="p-1.5 rounded-md hover:bg-muted/50 disabled:opacity-30 transition-colors"
          title="Next frame"
        >
          <SkipForward className="h-4 w-4" />
        </button>

        <span className="text-xs text-muted-foreground font-mono ml-auto">
          {currentFrame + 1} / {totalFrames}
        </span>
      </div>

      {/* Frame slider */}
      <input
        type="range"
        min={0}
        max={totalFrames - 1}
        value={currentFrame}
        onChange={(e) => onSliderChange(Number(e.target.value))}
        className="w-full h-1.5 accent-primary cursor-pointer"
      />
    </div>
  );
}

// Landmarks tab 
function LandmarksPanel({
  prediction,
  visibleLandmarks,
  onToggleLandmark,
  hasPredictions,
  currentFrame,
}: {
  prediction: FramePrediction | null;
  visibleLandmarks: Set<string>;
  onToggleLandmark: (id: string) => void;
  hasPredictions: boolean;
  currentFrame: number;
}) {
  if (!hasPredictions) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-center text-muted-foreground text-sm gap-2 py-8">
        <MapPin className="h-8 w-8 opacity-30" />
        <p>Run detection to see landmark predictions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Frame label */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Detected Landmarks</h3>
        <span className="text-xs text-muted-foreground">
          Frame {currentFrame + 1}
        </span>
      </div>

      {/* Landmark list */}
      <div className="space-y-1">
        {LANDMARK_DEFINITIONS.map((def) => {
          const coord = getLandmarkCoord(prediction, def.id);
          const isVisible = visibleLandmarks.has(def.id);
          const hasCoord = !!coord;

          return (
            <button
              key={def.id}
              onClick={() => onToggleLandmark(def.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-all text-left",
                isVisible && hasCoord
                  ? "border-border bg-background hover:bg-muted/40"
                  : "border-dashed border-border/50 bg-transparent opacity-50",
              )}
            >
              {/* Colour dot */}
              <span
                className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-offset-1 ring-transparent"
                style={{ backgroundColor: def.color }}
              />
              {/* Label */}
              <span className="flex-1 text-xs font-medium truncate">{def.label}</span>
              {/* Coordinates*/}
              {hasCoord ? (
                <span className="text-[10px] text-muted-foreground font-mono">
                  {coord![0]}, {coord![1]}
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground/50">—</span>
              )}
              {/* Visibility indicator */}
              <span
                className={cn(
                  "text-[10px] px-1 py-0.5 rounded",
                  isVisible
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {isVisible ? "on" : "off"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Strain / AHA-17 tab 
function StrainPanel({ hasPredictions }: { hasPredictions: boolean }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-foreground">AHA 17-Segment Alignment</h3>

      {hasPredictions ? (
        <>
          {/* Tier labels */}
          <p className="text-[10px] text-muted-foreground">
            Basal (1–6) · Mid (7–12) · Apical (13–16) · Apex (17)
          </p>

          {/* AHA grid */}
          <div className="grid grid-cols-6 gap-1">
            {AHA_SEGMENT_COLORS.map((color, i) => (
              <div
                key={i}
                className="aspect-square rounded flex items-center justify-center text-[9px] font-semibold text-white/90 cursor-pointer hover:opacity-80 transition-opacity"
                style={{ backgroundColor: color }}
                title={`Segment ${i + 1}`}
              >
                {i + 1}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-red-500 inline-block" />
              High strain
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm bg-green-500 inline-block" />
              Low strain
            </span>
          </div>

          {/* Strain metrics */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            {[
              { label: "Peak GCS", value: "–17.6%", color: "text-red-500" },
              { label: "Peak GRS", value: "+27.8%", color: "text-green-500" },
              { label: "Peak GLS", value: "–16.2%", color: "text-red-500" },
              { label: "Alignment", value: "94%",   color: "text-green-500" },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="rounded-lg border border-border bg-muted/30 p-2 text-center"
              >
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className={cn("text-sm font-semibold", color)}>{value}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground text-sm gap-2">
          <Activity className="h-8 w-8 opacity-30" />
          <p>Run detection first to see AHA segment mapping.</p>
        </div>
      )}
    </div>
  );
}

// Settings tab 
function SettingsPanel({ onReset }: { onReset: () => void }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-foreground">Detection Settings</h3>

      <div className="space-y-3 text-sm text-muted-foreground">
        <p className="text-xs">
          Model endpoint and rendering options. Extended settings will be added
          in a later sprint.
        </p>

        <div className="pt-2 border-t border-border space-y-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs gap-2"
            onClick={onReset}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Detection
          </Button>
        </div>
      </div>
    </div>
  );
}
