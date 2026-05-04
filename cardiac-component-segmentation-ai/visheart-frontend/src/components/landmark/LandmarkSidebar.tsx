"use client";

import React, { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  CartesianGrid,
  Line,
  LineChart,
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
  ArrowRight,
} from "lucide-react";
import {
  LANDMARK_DEFINITIONS,
  getLandmarkCoord,
  AHA_SEGMENT_COLORS,
} from "@/types/landmark";
import type { LandmarkPageState, FramePrediction } from "@/types/landmark";

const NAV_ITEMS = [
  { key: "landmarks", icon: MapPin,    label: "Landmarks" },
  { key: "strain",    icon: Activity,  label: "Strain"    },
  { key: "settings",  icon: Settings2, label: "Settings"  },
] as const;

type TabKey = typeof NAV_ITEMS[number]["key"];

const STRAIN_CURVE_DATA = [
  { frame: 1, strain: -4.2 },
  { frame: 2, strain: -8.8 },
  { frame: 3, strain: -13.6 },
  { frame: 4, strain: -17.6 },
  { frame: 5, strain: -15.7 },
  { frame: 6, strain: -14.6 },
  { frame: 7, strain: -12.2 },
  { frame: 8, strain: -8.1 },
  { frame: 9, strain: -5.4 },
  { frame: 10, strain: -3.2 },
];

// Props 
export interface LandmarkSidebarProps {
  state: LandmarkPageState;
  currentPrediction: FramePrediction | null;
  visibleLandmarks: Set<string>;
  replacementFileError: string | null;

  onToggleLandmark: (id: string) => void;
  onTogglePlay: () => void;
  onNextFrame: () => void;
  onPrevFrame: () => void;
  onSliderChange: (frame: number) => void;
  onRerun: () => void;
  onReset: () => void;
  onApplyAlignment: () => void;
  onFileSelect: (file: File | null) => void;
  onClearReplacementFile: () => void;
  showLabels: boolean;
  onToggleShowLabels: () => void;
}

export function LandmarkSidebar({
  state,
  currentPrediction,
  visibleLandmarks,
  replacementFileError,
  onToggleLandmark,
  onTogglePlay,
  onNextFrame,
  onPrevFrame,
  onSliderChange,
  onRerun,
  onReset,
  onApplyAlignment,
  onFileSelect,
  onClearReplacementFile,
  showLabels,
  onToggleShowLabels,
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
          {state.modelUsed || "HRNet-LV"}
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
          onTogglePlay={onTogglePlay}
          onNextFrame={onNextFrame}
          onPrevFrame={onPrevFrame}
          onSliderChange={onSliderChange}
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
          />
        )}
        {activeTab === "strain" && (
          <StrainTab hasPredictions={hasPredictions} />
        )}
        {activeTab === "settings" && (
          <SettingsTab
            hasPredictions={hasPredictions}
            onRerun={onRerun}
            onReset={onReset}
            modelUsed={state.modelUsed || "HRNet-LV"}
            totalFrames={state.totalFrames}
          />
        )}
      </div>

      {/* Bottom action buttons */}
      {hasPredictions && (
        <div className="p-4 border-t border-[var(--sidebar-border)] flex flex-col gap-2 flex-shrink-0">
          <Button size="sm" className="w-full text-xs gap-1.5" onClick={onApplyAlignment}>
            Apply AHA-17 Alignment
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs gap-1.5"
            onClick={onRerun}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Re-run Detection
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
    </div>
  );
}

// Landmarks tab
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
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  if (!hasPredictions) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-muted-foreground text-sm gap-3 py-8">
        <MapPin className="h-8 w-8 opacity-25" />
        <p className="text-sm leading-snug">
          Click <strong className="text-foreground">Run Detection</strong> to detect landmarks
          using this project&apos;s MRI data.
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
        <span className="text-xs text-muted-foreground tabular-nums">
          Frame {currentFrame + 1}
        </span>
      </div>

      {/* Landmark rows */}
      <div className="space-y-1">
        {LANDMARK_DEFINITIONS.map((def) => {
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
}) {
  const settings = [
    { label: "Show landmark labels", checked: showLabels, onCheckedChange: onToggleShowLabels },
    { label: "Show centroid", checked: showCentroid, onCheckedChange: onToggleShowCentroid },
    { label: "Show radial lines", checked: showRadialLines, onCheckedChange: onToggleShowRadialLines },
    { label: "Show strain overlay", checked: showStrainOverlay, onCheckedChange: onToggleShowStrainOverlay },
    { label: "Auto-align to AHA", checked: autoAlignAha, onCheckedChange: onToggleAutoAlignAha },
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

// Strain / AHA-17 tab
function StrainTab({ hasPredictions }: { hasPredictions: boolean }) {
  if (!hasPredictions) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-muted-foreground text-sm gap-3 py-8">
        <Activity className="h-8 w-8 opacity-25" />
        <p className="text-sm">Run detection first to preview AHA-17 segment mapping.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-foreground">AHA 17-Segment Alignment</h3>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Basal (1–6) · Mid (7–12) · Apical (13–16) · Apex (17)
      </p>

      {/* AHA grid */}
      <div className="grid grid-cols-6 gap-1">
        {AHA_SEGMENT_COLORS.map((color, i) => (
          <button
            key={i}
            type="button"
            className="aspect-square rounded flex items-center justify-center text-[9px] font-semibold text-white/90 hover:opacity-80 transition-opacity cursor-pointer"
            style={{ backgroundColor: color }}
            title={`Segment ${i + 1}`}
            aria-label={`AHA Segment ${i + 1}`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-red-500 inline-block" />
          High strain
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-green-500 inline-block" />
          Low strain
        </span>
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
            Global Strain Curve
          </h4>
          <span className="text-[10px] text-muted-foreground">GLS</span>
        </div>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={STRAIN_CURVE_DATA} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="frame"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                domain={[-20, 0]}
                tickFormatter={(value) => `${value}%`}
              />
              <Tooltip
                cursor={{ stroke: "hsl(var(--border))" }}
                formatter={(value) => {
                  const numericValue = Number(value ?? 0);
                  return [`${numericValue.toFixed(1)}%`, "GLS"];
                }}
                labelFormatter={(label) => `Frame ${label}`}
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--popover))",
                  color: "hsl(var(--popover-foreground))",
                  fontSize: 12,
                }}
              />
              <Line
                type="monotone"
                dataKey="strain"
                stroke="#f87171"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          Time (ms) - 3 frames - GLS shown
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        {[
          { label: "Peak GCS (SAX)", value: "–17.6%", neg: true  },
          { label: "Peak GRS (SAX)", value: "+27.8%", neg: false },
          { label: "Peak GLS (LAX)", value: "–16.2%", neg: true  },
          { label: "Alignment",      value: "94%",    neg: false },
        ].map(({ label, value, neg }) => (
          <div key={label} className="rounded-lg border border-border bg-muted/30 p-2 text-center">
            <p className="text-[10px] text-muted-foreground leading-none mb-1">{label}</p>
            <p className={cn("text-sm font-semibold", neg ? "text-red-500" : "text-green-500")}>
              {value}
            </p>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground/60 italic">
        Values shown are mock data. Real strain values will be computed after AHA-17 alignment (EPIC 7).
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
