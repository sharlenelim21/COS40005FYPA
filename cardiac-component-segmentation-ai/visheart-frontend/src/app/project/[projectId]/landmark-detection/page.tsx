"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  Scan,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Heart,
  Download,
  FileText,
  ArrowLeft,
  Activity,
} from "lucide-react";

import { useProject } from "@/context/ProjectContext";
import { LoadingProject } from "@/components/project/LoadingProject";
import { ErrorProject } from "@/components/project/ErrorProject";
import { exportLandmarkPDF } from "@/lib/landmarkPdfExport";
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
import { useGpuStatus } from "@/lib/dashboard-hooks";
import type { BullseyeData } from "@/types/project";
import { StrainBullseye, type StrainType } from "@/components/landmark/StrainVisualization";

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
  "Basal Anterolateral",
  "Basal Inferolateral",
  "Basal Inferior",
  "Basal Inferoseptal",
  "Basal Anteroseptal",
  "Mid Anterior",
  "Mid Anterolateral",
  "Mid Inferolateral",
  "Mid Inferior",
  "Mid Inferoseptal",
  "Mid Anteroseptal",
  "Apical Anterior",
  "Apical Lateral",
  "Apical Inferior",
  "Apical Septal",
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

  // GPU availability — mirrors segmentation page pattern (async, false on first render)
  const { processingUnit, isLoading: gpuLoading } = useGpuStatus();
  const isGpuMode = processingUnit.gpuAvailable;

  // Bullseye data + model selector state
  const [bullseyeData, setBullseyeData] = useState<BullseyeData | null | undefined>(undefined);
  const [bullseyeLoading, setBullseyeLoading] = useState(true);
  const [selectedBullseyeModel, setSelectedBullseyeModel] = useState<"medsam" | "unet">("medsam");
  const [availableBullseyeModels, setAvailableBullseyeModels] = useState<{ medsam: boolean; unet: boolean }>({ medsam: false, unet: false });
  const [calculatingModels, setCalculatingModels] = useState<{ medsam: boolean; unet: boolean }>({ medsam: false, unet: false });
  const [calcCountdown, setCalcCountdown] = useState(15);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [leftPanelView, setLeftPanelView] = useState<"bullseye" | "strain">("bullseye");
  const [selectedStrainType, setSelectedStrainType] = useState<StrainType>("GLS");

  // Correct the bullseye model default once the GPU probe resolves.
  // Guard on gpuLoading: isGpuMode starts false before the fetch completes,
  // so without the guard this fires immediately and locks GPU users on UNet.
  useEffect(() => {
    if (gpuLoading) return;
    setSelectedBullseyeModel(isGpuMode ? "medsam" : "unet");
  }, [isGpuMode, gpuLoading]);

  // Countdown timer — ticks while any model is still calculating its bullseye.
  // Resets to 15 each time calculatingModels changes (i.e. on each fetchBullseye cycle).
  useEffect(() => {
    const anyCalculating = calculatingModels.medsam || calculatingModels.unet;
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!anyCalculating) {
      setCalcCountdown(15);
      return;
    }
    setCalcCountdown(15);
    countdownRef.current = setInterval(() => {
      setCalcCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [calculatingModels.medsam, calculatingModels.unet]);

  // Infer which segmentation model produced a mask from its name (matches backend inferMaskModelForExport).
  const inferMaskModel = (name: string): "medsam" | "unet" | null => {
    const n = name.toLowerCase();
    if (n.includes("unet")) return "unet";
    if (n.includes("medsam")) return "medsam";
    return null;
  };

  const fetchBullseye = useCallback(async (preferredModel?: "medsam" | "unet", triggerIfMissing = true) => {
    setBullseyeLoading(true);
    try {
      const res = await segmentationApi.getSegmentationResults(projectId);
      type SegItem = { _id?: string; name?: string; isMedSAMOutput: boolean; bullseye?: BullseyeData };
      const segs = (res.segmentations ?? []) as SegItem[];

      // Editable masks only (isMedSAMOutput === false), split by inferred model
      const editables = segs.filter((m) => !m.isMedSAMOutput);
      const medsamMasks = editables.filter((m) => inferMaskModel(m.name ?? "") !== "unet");
      const unetMasks = editables.filter((m) => inferMaskModel(m.name ?? "") === "unet");

      const medsamWithBullseye = medsamMasks.find((m) => m.bullseye != null);
      const unetWithBullseye = unetMasks.find((m) => m.bullseye != null);

      const medsamHasBullseye = !!medsamWithBullseye;
      const unetHasBullseye = !!unetWithBullseye;
      setAvailableBullseyeModels({ medsam: medsamHasBullseye, unet: unetHasBullseye });
      setCalculatingModels({
        medsam: medsamMasks.length > 0 && !medsamHasBullseye,
        unet: unetMasks.length > 0 && !unetHasBullseye,
      });

      // Choose which model to display: use preferredModel, fall back to whatever has data
      const effective = preferredModel ?? selectedBullseyeModel;
      let selectedMask: SegItem | undefined;
      if (effective === "unet") {
        selectedMask = unetWithBullseye ?? medsamWithBullseye;
      } else {
        selectedMask = medsamWithBullseye ?? unetWithBullseye;
      }

      // Auto-trigger bullseye for every editable mask that has no data yet,
      // using a session ref so each mask is triggered at most once.
      if (triggerIfMissing) {
        const masksNeedingBullseye = editables.filter(
          (m) => m._id && !m.bullseye && !autoTriggeredBullseyeMasks.current.has(m._id)
        );
        for (const mask of masksNeedingBullseye) {
          const maskId = mask._id as string;
          autoTriggeredBullseyeMasks.current.add(maskId);
          segmentationApi.triggerBullseye(maskId).catch(() => {
            // Allow retry on next page visit by removing from the set
            autoTriggeredBullseyeMasks.current.delete(maskId);
          });
        }
        if (masksNeedingBullseye.length > 0) {
          // Re-fetch after ~15s to pick up newly computed bullseye data
          setTimeout(() => fetchBullseye(preferredModel, false), 15000);
        }
      }

      if (selectedMask) {
        setBullseyeData(selectedMask.bullseye!);
        setBullseyeLoading(false);
        return;
      }

      setBullseyeData(null);
      setBullseyeLoading(false);
    } catch {
      setBullseyeData(null);
      setBullseyeLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedBullseyeModel]);

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

  // Tracks which mask IDs have already had bullseye auto-triggered this session
  const autoTriggeredBullseyeMasks = useRef<Set<string>>(new Set());

  // Refetch bullseye after detection finishes; clear alignment on new run
  const prevStatus = useRef(state.status);
  useEffect(() => {
    if (prevStatus.current !== state.status) {
      if (state.status === "running") {
        setAhaAlignmentAngle(null);
      }
      if (prevStatus.current === "running" && state.status === "done") {
        fetchBullseye(selectedBullseyeModel);
      }
    }
    prevStatus.current = state.status;
  }, [state.status, fetchBullseye, selectedBullseyeModel]);

  const handleApplyAlignment = useCallback(() => {
    const validPreds = state.predictions.filter(
      (p) => p.rv_insertion_1 && p.rv_insertion_2,
    );
    if (validPreds.length === 0) return;

    // Compute septal angle per slice (90° CW rotation of rv1→rv2 in y-down coords)
    const allAngles = validPreds.map((p) => {
      const dx = p.rv_insertion_2![0] - p.rv_insertion_1![0];
      const dy = p.rv_insertion_2![1] - p.rv_insertion_1![1];
      return Math.atan2(-dx, dy);
    });

    // Preliminary circular mean to establish a reference direction
    const prelimRad = Math.atan2(
      allAngles.reduce((s, a) => s + Math.sin(a), 0),
      allAngles.reduce((s, a) => s + Math.cos(a), 0),
    );

    // Filter out slices whose angle deviates more than 30° from the preliminary mean
    const filtered = allAngles.filter((a) => {
      const diff = Math.abs((((a - prelimRad) * 180) / Math.PI + 540) % 360 - 180);
      return diff < 30;
    });

    const finalRad = Math.atan2(
      filtered.reduce((s, a) => s + Math.sin(a), 0),
      filtered.reduce((s, a) => s + Math.cos(a), 0),
    );
    setAhaAlignmentAngle(finalRad * (180 / Math.PI));
  }, [state.predictions]);

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

      setFrameImageUrl(cachedUrl ?? null);
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
          <Button asChild variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <Link href={`/project/${projectId}`}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Project
            </Link>
          </Button>
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

        {/* Export buttons */}
        {hasPredictions && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              onClick={() => {
                exportLandmarkPDF({
                  projectName: projectData?.name || "Unnamed Project",
                  detectionModel: state.modelUsed || "UNetResNet34",
                  totalFrames: state.totalFrames || 0,
                  currentFrame: state.currentFrame,
                  strainMetrics: {
                    peakGCS: "–17.6%",
                    peakGRS: "+27.8%",
                    peakGLS: "–16.2%",
                    alignment: "94%",
                  },
                });
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Export Report
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              onClick={() => {
                // Dummy CSV export
                console.log("Exporting landmark data as CSV (dummy)...");
                alert("Landmark data CSV export initiated.\n(Currently a placeholder - CSV export coming soon)");
              }}
            >
              <FileText className="h-3.5 w-3.5" />
              Export Data
            </Button>
          </div>
        )}
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
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-foreground">
                    {leftPanelView === "bullseye" ? "AHA 17-Segment Bullseye" : "Strain Preview"}
                  </h3>
                  <div className="grid grid-cols-2 rounded-lg border border-border bg-background p-0.5">
                    <button
                      type="button"
                      onClick={() => setLeftPanelView("bullseye")}
                      className={cn(
                        "rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
                        leftPanelView === "bullseye" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      Bullseye
                    </button>
                    <button
                      type="button"
                      onClick={() => setLeftPanelView("strain")}
                      className={cn(
                        "rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
                        leftPanelView === "strain" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      Strain
                    </button>
                  </div>
                  {leftPanelView === "bullseye" && (
                    <Select
                      value={selectedBullseyeModel}
                      onValueChange={(v: string) => {
                        const model = v as "medsam" | "unet";
                        setSelectedBullseyeModel(model);
                        fetchBullseye(model);
                      }}
                      disabled={bullseyeLoading}
                    >
                      <SelectTrigger
                        size="sm"
                        className="h-6 min-w-[80px] rounded-lg bg-background px-2 text-[10px] shadow-sm hover:bg-muted/40"
                        aria-label="Select bullseye model"
                      >
                        <SelectValue placeholder="Model" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl p-1 shadow-lg">
                        <SelectItem value="medsam" disabled={!availableBullseyeModels.medsam || !isGpuMode} className="rounded-lg py-1.5 text-xs">
                          MedSAM{
                            !isGpuMode ? " (GPU only)" :
                            calculatingModels.medsam ? ` (Calculating... ${calcCountdown}s)` :
                            !availableBullseyeModels.medsam ? " (no data)" :
                            ""
                          }
                        </SelectItem>
                        <SelectItem value="unet" disabled={!availableBullseyeModels.unet} className="rounded-lg py-1.5 text-xs">
                          UNet{
                            calculatingModels.unet ? ` (Calculating... ${calcCountdown}s)` :
                            !availableBullseyeModels.unet ? " (no data)" :
                            ""
                          }
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {leftPanelView === "strain" && (
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
              </div>
              {!hasPredictions ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center text-muted-foreground px-6">
                  <div className="h-16 w-16 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
                    <span className="text-2xl opacity-30">♥</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium">No landmark data yet</p>
                    <p className="text-xs mt-1 opacity-70">
                      Click <strong>Run Detection</strong> to analyse this project&apos;s MRI and generate the AHA 17-Segment Bullseye.
                    </p>
                  </div>
                </div>
              ) : leftPanelView === "bullseye" ? (
                <AhaBullseyePanel
                  bullseyeData={bullseyeData}
                  loading={bullseyeLoading}
                  referenceAngleDeg={ahaAlignmentAngle ?? 0}
                  currentFrame={state.currentFrame}
                  frameCount={
                    (projectData?.dimensions?.frames && projectData.dimensions.frames > 0)
                      ? projectData.dimensions.frames
                      : (projectData?.dimensions?.slices && projectData.dimensions.slices > 0)
                      ? projectData.dimensions.slices
                      : 1
                  }
                />
              ) : (
                <StrainPreviewPanel
                  selectedStrainType={selectedStrainType}
                  onStrainTypeChange={setSelectedStrainType}
                  currentFrame={state.currentFrame}
                  frameCount={
                    (projectData?.dimensions?.frames && projectData.dimensions.frames > 0)
                      ? projectData.dimensions.frames
                      : state.totalFrames || 1
                  }
                  hasPredictions={hasPredictions}
                />
              )}
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
  currentFrame = 0,
  frameCount = 1,
}: {
  bullseyeData: BullseyeData | null | undefined;
  loading: boolean;
  referenceAngleDeg?: number;
  currentFrame?: number;
  frameCount?: number;
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
      ) : !bullseyeData ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
          <AlertCircle className="h-6 w-6 text-muted-foreground opacity-50" />
          <p className="text-xs text-muted-foreground">
            No bullseye data available for this project. Bullseye analysis is generated automatically during segmentation.
          </p>
        </div>
      ) : (
        <>
          <p className="text-[10px] text-muted-foreground mb-2 flex-shrink-0">
            Frame {Math.min(currentFrame + 1, Math.max(frameCount, 1))} of {Math.max(frameCount, 1)}
          </p>
          <div className="flex-1 min-h-0 rounded-lg bg-zinc-900/30 p-3 flex items-center justify-center">
            <AhaBullseyeChart
              bullseyeData={bullseyeData}
              referenceAngleDeg={referenceAngleDeg}
              size={320}
              currentFrame={currentFrame}
              frameCount={frameCount}
            />
          </div>
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
  currentFrame = 0,
  frameCount = 1,
}: {
  bullseyeData: BullseyeData;
  referenceAngleDeg?: number;
  size?: number;
  currentFrame?: number;
  frameCount?: number;
}) {
  const center = 150;
  const basalOuter = 118;
  const basalInner = 88;
  const midInner = 58;
  const apicalInner = 30;
  const { segment_values, segment_metadata } = bullseyeData;
  const phase = frameCount > 1 ? currentFrame / (frameCount - 1) : 0;
  const beat = Math.sin(phase * Math.PI);
  const frameValues = segment_values.map((value, index) => (
    value + Math.sin(index * 0.7 + currentFrame * 0.45) * 0.9 + beat * 1.2
  ));
  const frameMin = Math.min(...frameValues);
  const frameMax = Math.max(...frameValues);

  // Cardinal label positions are fixed (anatomically correct, do not rotate with segments).
  const anteriorPt  = polarPoint(center, 135, -90);  // 12 o'clock
  const lateralPt   = polarPoint(center, 135, 180);  // 9 o'clock
  const inferiorPt  = polarPoint(center, 135,  90);  // 6 o'clock
  const septalPt    = polarPoint(center, 135,   0);  // 3 o'clock

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
          startAngle={-120 - index * 60 + referenceAngleDeg}
          endAngle={-60 - index * 60 + referenceAngleDeg}
          value={segment_values[index]}
          tooltip={segment_metadata[index]}
          min={frameMin}
          max={frameMax}
        />
      ))}
      {Array.from({ length: 6 }, (_, index) => (
        <BullseyeSegment
          key={`mid-${index}`}
          index={index + 6}
          center={center}
          innerRadius={midInner}
          outerRadius={basalInner}
          startAngle={-120 - index * 60 + referenceAngleDeg}
          endAngle={-60 - index * 60 + referenceAngleDeg}
          value={segment_values[index + 6]}
          tooltip={segment_metadata[index + 6]}
          min={frameMin}
          max={frameMax}
        />
      ))}
      {Array.from({ length: 4 }, (_, index) => (
        <BullseyeSegment
          key={`apical-${index}`}
          index={index + 12}
          center={center}
          innerRadius={apicalInner}
          outerRadius={midInner}
          startAngle={-135 - index * 90 + referenceAngleDeg}
          endAngle={-45 - index * 90 + referenceAngleDeg}
          value={segment_values[index + 12]}
          tooltip={segment_metadata[index + 12]}
          min={frameMin}
          max={frameMax}
        />
      ))}
      <circle
        cx={center}
        cy={center}
        r={apicalInner}
        fill={segmentColor(frameValues[16], frameMin, frameMax)}
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="0.8"
      >
        <title>{segment_metadata[16]?.name}: {frameValues[16]?.toFixed(2)} px</title>
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
        {frameValues[16].toFixed(1)}
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

function StrainPreviewPanel({
  selectedStrainType,
  onStrainTypeChange,
  currentFrame,
  frameCount,
  hasPredictions,
}: {
  selectedStrainType: StrainType;
  onStrainTypeChange: (type: StrainType) => void;
  currentFrame: number;
  frameCount: number;
  hasPredictions: boolean;
}) {
  return (
    <div className="flex-1 min-h-0 rounded-lg border border-border bg-background p-3 flex flex-col overflow-hidden">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/20 p-1">
          {(["GLS", "GCS", "GRS"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onStrainTypeChange(type)}
              className={cn(
                "rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
                selectedStrainType === type ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {type}
            </button>
          ))}
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">
          Frame {Math.min(currentFrame + 1, Math.max(frameCount, 1))}/{Math.max(frameCount, 1)}
        </span>
      </div>

      {!hasPredictions ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <Activity className="h-8 w-8 opacity-30" />
          <p className="text-xs leading-relaxed">
            Run landmark detection to preview frame-by-frame dummy strain values.
          </p>
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto rounded-lg bg-muted/20 p-2">
            <StrainBullseye
              selectedStrainType={selectedStrainType}
              frame={currentFrame}
              totalFrames={frameCount}
              compact
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px]">
            <div className="rounded-md border border-border bg-muted/20 p-2">
              <p className="text-muted-foreground">GLS</p>
              <p className="font-semibold text-red-500">-16.2%</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-2">
              <p className="text-muted-foreground">GCS</p>
              <p className="font-semibold text-red-500">-17.6%</p>
            </div>
            <div className="rounded-md border border-border bg-muted/20 p-2">
              <p className="text-muted-foreground">GRS</p>
              <p className="font-semibold text-green-500">+27.8%</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
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
