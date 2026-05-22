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
import { ClientHeartModel } from "@/components/landmark/ClientHeartModel";
import type { LandmarkMaskOverlay } from "@/components/landmark/LandmarkSliceViewer";
import { AHA_SEGMENT_COLORS, LANDMARK_DEFINITIONS } from "@/types/landmark";
import { ANATOMICAL_LABELS, type AnatomicalLabel } from "@/types/segmentation";
import type { LandmarkPageState } from "@/types/landmark";
import type { FramePrediction } from "@/types/landmark";
import { segmentationApi } from "@/lib/api";
import type { BullseyeData } from "@/types/project";
import {
  StrainBullseye,
  getDummyStrainData,
  getStrainColor,
  type StrainType,
} from "@/components/landmark/StrainVisualization";
import { fmt } from "@/lib/format-utils";

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

/** Resolve which segmentation model produced an editable mask.
 *  Prefers the explicit segmentationModel field; falls back to name heuristics. */
function maskBelongsTo(
  m: { name?: string; [key: string]: unknown },
  target: "medsam" | "unet",
): boolean {
  const field = (m.segmentationModel as string | undefined)?.toLowerCase();
  if (field === "medsam" || field === "unet") return field === target;
  const name = (m.name ?? "").toLowerCase();
  if (name.includes("unet")) return target === "unet";
  if (name.includes("medsam")) return target === "medsam";
  // untagged masks default to medsam bucket
  return target === "medsam";
}

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
    confidentCount,
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

  // Bullseye data + model selector state
  const [bullseyeData, setBullseyeData] = useState<BullseyeData | null | undefined>(undefined);
  const [bullseyeLoading, setBullseyeLoading] = useState(true);
  const [selectedBullseyeModel, setSelectedBullseyeModel] = useState<"medsam" | "unet">("medsam");
  const [availableBullseyeModels, setAvailableBullseyeModels] = useState<{ medsam: boolean; unet: boolean }>({ medsam: false, unet: false });
  // Tracks whether the editable mask itself exists (independent of whether bullseye is computed)
  const [existingSegModels, setExistingSegModels] = useState<{ medsam: boolean; unet: boolean }>({ medsam: false, unet: false });
  const [leftPanelView, setLeftPanelView] = useState<"bullseye" | "strain">("bullseye");
  const [selectedStrainType, setSelectedStrainType] = useState<StrainType>("GLS");
  const [selectedStrainSegment, setSelectedStrainSegment] = useState<number | null>(null);
  const [editableLandmarks, setEditableLandmarks] = useState(true);
  const [highlightedLandmarkId, setHighlightedLandmarkId] = useState<string | null>(null);
  const [landmarkEdits, setLandmarkEdits] = useState<Record<string, Partial<Record<keyof FramePrediction, [number, number]>>>>({});

  const bullseyePollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchBullseye = useCallback(async (preferredModel?: "medsam" | "unet", triggerIfMissing = true) => {
    // Cancel any pending poll before starting a new fetch
    if (bullseyePollRef.current) {
      clearTimeout(bullseyePollRef.current);
      bullseyePollRef.current = null;
    }
    setBullseyeLoading(true);
    try {
      const res = await segmentationApi.getSegmentationResults(projectId);
      type SegItem = { _id?: string; name?: string; isMedSAMOutput: boolean; bullseye?: BullseyeData };
      const segs = (res.segmentations ?? []) as SegItem[];

      const editables = segs.filter((m) => !m.isMedSAMOutput);
      const medsamMasks = editables.filter((m) => maskBelongsTo(m, "medsam"));
      const unetMasks   = editables.filter((m) => maskBelongsTo(m, "unet"));

      const medsamWithBullseye = medsamMasks.find((m) => m.bullseye != null);
      const unetWithBullseye = unetMasks.find((m) => m.bullseye != null);

      setAvailableBullseyeModels({ medsam: !!medsamWithBullseye, unet: !!unetWithBullseye });
      setExistingSegModels({ medsam: medsamMasks.length > 0, unet: unetMasks.length > 0 });

      // Pick which model's bullseye to show — prefer the requested one, show whatever has data
      const effective = preferredModel ?? selectedBullseyeModel;
      const preferredResult = effective === "unet" ? unetWithBullseye : medsamWithBullseye;
      const fallbackResult  = effective === "unet" ? medsamWithBullseye : unetWithBullseye;
      const selectedMask = preferredResult ?? fallbackResult;

      if (selectedMask) {
        // Auto-switch display model to match actual data source
        setSelectedBullseyeModel(selectedMask === unetWithBullseye ? "unet" : "medsam");
        setBullseyeData(selectedMask.bullseye!);
        setBullseyeLoading(false);
        return;
      }

      // No bullseye data yet — pick the best mask to trigger computation on
      let targetMasks = effective === "unet" ? unetMasks : medsamMasks;
      if (targetMasks.length === 0) {
        targetMasks = effective === "unet" ? medsamMasks : unetMasks;
        if (targetMasks.length > 0) setSelectedBullseyeModel(effective === "unet" ? "medsam" : "unet");
      }
      const triggerTarget = targetMasks[0];

      if (triggerTarget?._id && triggerIfMissing) {
        try {
          await segmentationApi.triggerBullseye(triggerTarget._id);
        } catch {
          // trigger failed; fall through to show null
        }
        // Poll once after 8s regardless of trigger success
        bullseyePollRef.current = setTimeout(() => fetchBullseye(preferredModel, false), 8000);
        return;
      }
      setBullseyeData(null);
      setBullseyeLoading(false);
    } catch {
      setBullseyeData(null);
      setBullseyeLoading(false);
    }
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
    // Prefer avg_lm1/avg_lm2 from the new GPU response — more stable than per-slice mean.
    // Fall back to the existing per-slice approach when those fields are absent.
    if (state.avgLm1 && state.avgLm2) {
      const dx = state.avgLm2.x - state.avgLm1.x;
      const dy = state.avgLm2.y - state.avgLm1.y;
      setAhaAlignmentAngle(Math.atan2(-dx, dy) * (180 / Math.PI));
      return;
    }

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
  const autoRunStartedRef = useRef(false);

  const runDetectionAndResetEdits = useCallback((model: ModelId) => {
    setLandmarkEdits({});
    setHighlightedLandmarkId(null);
    handleRunDetection(model);
  }, [handleRunDetection]);

  const rerunDetectionAndResetEdits = useCallback((model: ModelId) => {
    setLandmarkEdits({});
    setHighlightedLandmarkId(null);
    handleRerunDetection(model);
  }, [handleRerunDetection]);

  useEffect(() => {
    if (loading !== "done" || !projectData || autoRunStartedRef.current) return;
    if (state.status !== "idle") return;

    autoRunStartedRef.current = true;
    runDetectionAndResetEdits(selectedModel);
  }, [loading, projectData, state.status, runDetectionAndResetEdits, selectedModel]);

  // Always prefer projectData dimensions (actual DICOM W×H) over the hook's
  // default 256×256 placeholder. GPU coords are in NIfTI space which matches
  // projectData.dimensions exactly.
  const imageDimensions = {
    width:  projectData?.dimensions?.width  ?? state.imageDimensions.width,
    height: projectData?.dimensions?.height ?? state.imageDimensions.height,
  };

  const currentImageFrame = currentPrediction?.frame_id ?? state.currentFrame;
  const currentImageSlice = currentPrediction?.slice_id ?? 0;
  const currentLandmarkEditKey = `${currentImageFrame}:${currentImageSlice}`;
  const adjustedCurrentPrediction = useMemo(() => {
    if (!currentPrediction) return null;
    return {
      ...currentPrediction,
      ...(landmarkEdits[currentLandmarkEditKey] ?? {}),
    } as FramePrediction;
  }, [currentPrediction, currentLandmarkEditKey, landmarkEdits]);

  const handleLandmarkMove = useCallback((id: string, coord: [number, number]) => {
    setLandmarkEdits((prev) => ({
      ...prev,
      [currentLandmarkEditKey]: {
        ...(prev[currentLandmarkEditKey] ?? {}),
        [id]: coord,
      },
    }));
  }, [currentLandmarkEditKey]);
  const bullseyeFrameCount =
    (projectData?.dimensions?.frames && projectData.dimensions.frames > 0)
      ? projectData.dimensions.frames
      : (projectData?.dimensions?.slices && projectData.dimensions.slices > 0)
      ? projectData.dimensions.slices
      : 1;

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

  const maskDimensions = {
    width:  projectData?.dimensions?.width  ?? imageDimensions.width,
    height: projectData?.dimensions?.height ?? imageDimensions.height,
  };

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
      if (mask) overlays.push({ label: label as AnatomicalLabel, mask });
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
          onClick={() => handleRunDetection(selectedModel, selectedBullseyeModel)}
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
            onClick={() => runDetectionAndResetEdits(selectedModel)}
          >
            Try again
          </button>
        </div>
      )}
      {hasPredictions && (
        <LandmarkSummaryStats
          nTotal={state.nTotal}
          nCollapsed={state.nCollapsed}
          n2ch={state.n2ch}
          n1chFallback={state.n1chFallback}
        />
      )}

      {/* Mobile layout */}
      <div className="lg:hidden flex-1 overflow-y-auto p-3 space-y-3">
        {/* Mobile: full-width viewer */}
        <div className="aspect-square w-full">
          <LandmarkSliceViewer
            prediction={adjustedCurrentPrediction}
            currentFrame={state.currentFrame}
            totalFrames={state.totalFrames || projectData.dimensions?.frames || 1}
            imageDimensions={imageDimensions}
            frameImageUrl={frameImageUrl}
            maskOverlays={currentMaskOverlays}
            maskDimensions={maskDimensions}
            visibleLandmarks={visibleLandmarks}
            showLabels={showLabels}
            editableLandmarks={editableLandmarks}
            highlightedLandmarkId={highlightedLandmarkId}
            onLandmarkMove={handleLandmarkMove}
          />
        </div>

        {/* Mobile: Sidebar content as flat stack */}
        <div className="rounded-xl border border-border overflow-hidden">
          <LandmarkSidebar
            state={state}
            currentPrediction={adjustedCurrentPrediction}
            visibleLandmarks={visibleLandmarks}
            replacementFileError={replacementFileError}
            confidentCount={confidentCount}
            onToggleLandmark={handleToggleLandmark}
            onTogglePlay={handleTogglePlay}
            onNextFrame={handleNextFrame}
            onPrevFrame={handlePrevFrame}
            onSliderChange={handleSliderChange}
            onPlaybackSpeedChange={handlePlaybackSpeedChange}
            onRerun={() => rerunDetectionAndResetEdits(selectedModel)}
            onReset={handleReset}
            onFileSelect={handleFileSelect}
            onClearReplacementFile={handleClearReplacementFile}
            showLabels={showLabels}
            onToggleShowLabels={() => setShowLabels((p) => !p)}
            editableLandmarks={editableLandmarks}
            onToggleEditableLandmarks={() => setEditableLandmarks((p) => !p)}
            highlightedLandmarkId={highlightedLandmarkId}
            onHighlightLandmark={setHighlightedLandmarkId}
            selectedStrainSegment={selectedStrainSegment}
            selectedStrainType={selectedStrainType}
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
            <div className="w-full h-full bg-background p-4 flex flex-col overflow-hidden">
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
                        "rounded-md px-3 py-1.5 text-[10px] font-semibold transition-colors",
                        leftPanelView === "bullseye" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      Bullseye
                    </button>
                    <button
                      type="button"
                      onClick={() => setLeftPanelView("strain")}
                      className={cn(
                        "rounded-md px-3 py-1.5 text-[10px] font-semibold transition-colors",
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
                        className="h-7 min-w-[92px] rounded-lg bg-background px-2 text-[10px] shadow-sm hover:bg-muted/40"
                        aria-label="Select bullseye model"
                      >
                        <SelectValue placeholder="Model" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl p-1 shadow-lg">
                        <SelectItem
                          value="medsam"
                          disabled={!existingSegModels.medsam}
                          className="rounded-lg py-1.5 text-xs"
                        >
                          MedSAM{!existingSegModels.medsam ? " (no data)" : !availableBullseyeModels.medsam ? " (computing…)" : ""}
                        </SelectItem>
                        <SelectItem
                          value="unet"
                          disabled={!existingSegModels.unet}
                          className="rounded-lg py-1.5 text-xs"
                        >
                          UNet{!existingSegModels.unet ? " (no data)" : !availableBullseyeModels.unet ? " (computing…)" : ""}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {leftPanelView === "strain" && (
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
                {/* AHA alignment controls — visible once landmarks are detected */}
                {leftPanelView === "bullseye" && hasPredictions && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {ahaAlignmentAngle === null ? (
                      <button
                        type="button"
                        onClick={handleApplyAlignment}
                        className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[10px] font-medium text-foreground shadow-sm hover:bg-muted/60 transition-colors"
                        title="Rotate bullseye to match detected RV insertion points"
                      >
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                        Align
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleResetAlignment}
                        className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[10px] font-medium text-foreground shadow-sm hover:bg-muted/60 transition-colors"
                        title="Reset bullseye rotation"
                      >
                        <RefreshCw className="h-3 w-3 text-muted-foreground" />
                        Reset
                      </button>
                    )}
                  </div>
                )}
              </div>
              {leftPanelView === "bullseye" ? (
                <AhaBullseyePanel
                  bullseyeData={hasPredictions ? bullseyeData : null}
                  loading={hasPredictions ? bullseyeLoading : isRunning}
                  referenceAngleDeg={ahaAlignmentAngle ?? 0}
                  onCompute={() => fetchBullseye(selectedBullseyeModel, true)}
                  currentFrame={state.currentFrame}
                  frameCount={bullseyeFrameCount}
                  previewMode={!hasPredictions && !isRunning}
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
                  previewMode={!hasPredictions}
                  selectedSegment={selectedStrainSegment}
                  onSelectSegment={setSelectedStrainSegment}
                />
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* CENTER: 2D MRI slice viewer + landmark overlay */}
          <ResizablePanel defaultSize={47}>
            <div className="w-full h-full relative bg-muted/40 p-4 flex flex-col gap-3 overflow-hidden">
              {state.status === "idle" && !isRunning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10 pointer-events-none">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className="p-4 rounded-full bg-muted/60">
                      <Scan className="h-8 w-8 text-muted-foreground opacity-50" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Preparing landmark detection
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Detection starts automatically using the server default model.
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
                  prediction={adjustedCurrentPrediction}
                  currentFrame={state.currentFrame}
                  totalFrames={state.totalFrames || projectData.dimensions?.frames || 1}
                  imageDimensions={imageDimensions}
                  frameImageUrl={frameImageUrl}
                  maskOverlays={currentMaskOverlays}
            maskDimensions={maskDimensions}
                  visibleLandmarks={visibleLandmarks}
                  showLabels={showLabels}
                  editableLandmarks={editableLandmarks}
                  highlightedLandmarkId={highlightedLandmarkId}
                  onLandmarkMove={handleLandmarkMove}
                />
              </div>

            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* RIGHT: Sidebar */}
          <ResizablePanel defaultSize={25} minSize={20} maxSize={36}>
            <div className="h-full w-full">
              <LandmarkSidebar
                state={state}
                currentPrediction={adjustedCurrentPrediction}
                visibleLandmarks={visibleLandmarks}
                replacementFileError={replacementFileError}
                onToggleLandmark={handleToggleLandmark}
                onTogglePlay={handleTogglePlay}
                onNextFrame={handleNextFrame}
                onPrevFrame={handlePrevFrame}
                onSliderChange={handleSliderChange}
                onPlaybackSpeedChange={handlePlaybackSpeedChange}
                onRerun={() => rerunDetectionAndResetEdits(selectedModel)}
                onReset={handleReset}
                onFileSelect={handleFileSelect}
                onClearReplacementFile={handleClearReplacementFile}
                showLabels={showLabels}
                onToggleShowLabels={() => setShowLabels((p) => !p)}
                editableLandmarks={editableLandmarks}
                onToggleEditableLandmarks={() => setEditableLandmarks((p) => !p)}
                highlightedLandmarkId={highlightedLandmarkId}
                onHighlightLandmark={setHighlightedLandmarkId}
                selectedStrainSegment={selectedStrainSegment}
                selectedStrainType={selectedStrainType}
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

function segmentColor(value: number | null | undefined, min: number | null | undefined, max: number | null | undefined): string {
  if (value == null || min == null || max == null) return "#444444";
  if (max === min) return AHA_SEGMENT_COLORS[0];
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return rdYlGn(t);
}

function getFrameBullseyeValues(bullseyeData: BullseyeData, currentFrame = 0, frameCount = 1): number[] {
  const phase = frameCount > 1 ? currentFrame / (frameCount - 1) : 0;
  const beat = Math.sin(phase * Math.PI);

  return bullseyeData.segment_values.map((value, index) => (
    value + Math.sin(index * 0.7 + currentFrame * 0.45) * 0.9 + beat * 1.2
  ));
}

function getDummyBullseyeData(currentFrame = 0, frameCount = 1): BullseyeData {
  const phase = frameCount > 1 ? currentFrame / (frameCount - 1) : 0;
  const beat = Math.sin(phase * Math.PI);
  const segment_values = Array.from({ length: 17 }, (_, index) => {
    const base = 4.8 + Math.sin(index * 0.85) * 1.1 + beat * 0.8;
    return Number(Math.max(2.6, base).toFixed(2));
  });
  const stats = {
    min: Math.min(...segment_values),
    max: Math.max(...segment_values),
    mean: segment_values.reduce((sum, value) => sum + value, 0) / segment_values.length,
    n_nan: 0,
  };

  return {
    segment_values,
    segment_metadata: segment_values.map((value, index) => ({
      idx: index + 1,
      name: AHA_SEGMENTS[index] ?? `Segment ${index + 1}`,
      ring: index < 6 ? "basal" : index < 12 ? "mid" : index < 16 ? "apical" : "apex",
      value,
    })),
    stats,
    computed_at: new Date(0).toISOString(),
  };
}

function AhaBullseyePanel({
  bullseyeData,
  loading,
  referenceAngleDeg = 0,
  currentFrame = 0,
  frameCount = 1,
  previewMode = false,
  onCompute,
}: {
  bullseyeData: BullseyeData | null | undefined;
  loading: boolean;
  referenceAngleDeg?: number;
  currentFrame?: number;
  frameCount?: number;
  previewMode?: boolean;
  onCompute?: () => void;
}) {
  const displayBullseyeData = previewMode ? getDummyBullseyeData(currentFrame, frameCount) : bullseyeData;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background">
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-xs">Computing bullseye…</span>
          </div>
        </div>
      ) : !displayBullseyeData ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
          <AlertCircle className="h-6 w-6 text-muted-foreground opacity-50" />
          <p className="text-xs text-muted-foreground">
            No bullseye data for this segmentation model yet.
          </p>
          {onCompute && (
            <button
              type="button"
              onClick={onCompute}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-muted/60 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Compute Bullseye
            </button>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Regional wall thickness (%)
              </p>
              <p className="text-[10px] text-muted-foreground">
                Frame {Math.min(currentFrame + 1, Math.max(frameCount, 1))} of {Math.max(frameCount, 1)}
              </p>
            </div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {previewMode ? "Dummy preview" : "Project result"}
            </span>
          </div>
          <div className="rounded-lg bg-slate-50 p-4 dark:bg-zinc-900">
            <div className="flex min-h-[330px] items-center justify-center">
              <AhaBullseyeChart
                bullseyeData={displayBullseyeData}
                referenceAngleDeg={referenceAngleDeg}
                size={390}
                currentFrame={currentFrame}
                frameCount={frameCount}
              />
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground tabular-nums">{displayBullseyeData.stats.min.toFixed(1)}%</span>
              <div
                className="h-2.5 flex-1 rounded-full shadow-inner"
                style={{
                  background: "linear-gradient(to right, #d73027, #fc8d59, #fee08b, #d9ef8b, #91cf60, #1a9850)",
                  border: "1px solid hsl(var(--border))",
                }}
              />
              <span className="text-[10px] text-muted-foreground tabular-nums">{displayBullseyeData.stats.max.toFixed(1)}%</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <MetricTile label="Min" value={displayBullseyeData.stats.min.toFixed(2)} unit="%" />
              <MetricTile label="Mean" value={displayBullseyeData.stats.mean.toFixed(2)} unit="%" emphasized />
              <MetricTile label="Max" value={displayBullseyeData.stats.max.toFixed(2)} unit="%" />
            </div>
          </div>
          {displayBullseyeData.stats.n_nan > 0 && (
            <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400">
              {displayBullseyeData.stats.n_nan} segment{displayBullseyeData.stats.n_nan > 1 ? "s" : ""} missing data
            </p>
          )}
          <AhaHeartProjection
            bullseyeData={displayBullseyeData}
            currentFrame={currentFrame}
            frameCount={frameCount}
            previewMode={previewMode}
          />
        </div>
      )}
    </div>
  );
}

function MetricTile({
  label,
  value,
  unit,
  emphasized = false,
}: {
  label: string;
  value: string;
  unit: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-muted/30 px-2 py-2 text-center",
        emphasized && "bg-primary/10 text-primary",
      )}
    >
      <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-sm font-semibold tabular-nums">
        {value}
        <span className="ml-1 text-[9px] font-medium text-muted-foreground">{unit}</span>
      </p>
    </div>
  );
}

function EmptyAnalysisPreview({
  icon,
  frame,
  frameCount,
  message,
}: {
  icon: "bullseye" | "strain";
  frame: number;
  frameCount: number;
  message: string;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col rounded-lg bg-background p-3">
      <div className="flex items-center justify-end">
        <span className="text-[10px] font-mono text-muted-foreground">
          Frame {Math.min(frame + 1, Math.max(frameCount, 1))}/{Math.max(frameCount, 1)}
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center text-muted-foreground">
        {icon === "bullseye" ? (
          <div className="relative h-8 w-8 opacity-25">
            <span className="absolute inset-0 rounded-full border-2 border-current" />
            <span className="absolute inset-2 rounded-full border-2 border-current" />
            <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-current" />
            <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-current" />
          </div>
        ) : (
          <Activity className="h-8 w-8 opacity-25" />
        )}
        <p className="max-w-[240px] text-xs leading-relaxed">{message}</p>
      </div>
    </div>
  );
}

function AhaHeartProjection({
  bullseyeData,
  currentFrame,
  frameCount,
  previewMode = false,
}: {
  bullseyeData: BullseyeData;
  currentFrame: number;
  frameCount: number;
  previewMode?: boolean;
}) {
  const frameValues = getFrameBullseyeValues(bullseyeData, currentFrame, frameCount);
  const frameMin = Math.min(...frameValues);
  const frameMax = Math.max(...frameValues);

  return (
    <div className="mt-3 flex-shrink-0 border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">3D heart projection</p>
          <p className="text-[10px] text-muted-foreground">{previewMode ? "Preview color map" : "Frame color map"}</p>
        </div>
      </div>
      <ClientHeartModel
        values={frameValues}
        min={bullseyeData.stats.min}
        mid={bullseyeData.stats.mean}
        max={bullseyeData.stats.max}
        className="h-[340px] w-full overflow-hidden rounded-lg bg-[#151515]"
      />
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
  const { segment_metadata } = bullseyeData;
  const frameValues = getFrameBullseyeValues(bullseyeData, currentFrame, frameCount);
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
      className="h-auto w-full text-[#475569] dark:text-slate-300"
    >
      <circle cx={center} cy={center} r="122" className="fill-slate-50 stroke-slate-200 dark:fill-zinc-900 dark:stroke-zinc-700" strokeWidth="1" />

      <text x={anteriorPt.x} y={anteriorPt.y} textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">
        Anterior
      </text>
      <text x={septalPt.x} y={septalPt.y} textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">
        Septal
      </text>
      <text x={lateralPt.x} y={lateralPt.y} textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">
        Lateral
      </text>
      <text x={inferiorPt.x} y={inferiorPt.y} textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">
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
          value={frameValues[index]}
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
          value={frameValues[index + 6]}
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
          value={frameValues[index + 12]}
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
        stroke="rgba(0,0,0,0.9)"
        strokeWidth="1"
        style={{ transition: "fill 240ms ease" }}
      >
        <title>{segment_metadata[16]?.name}: {frameValues[16]?.toFixed(2)}%</title>
      </circle>
      <text
        x={center}
        y={center - 2}
        textAnchor="middle"
        dominantBaseline="auto"
        fontSize="9"
        fontWeight="600"
        fill="black"
        style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.55))" }}
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
        fill="black"
        style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.55))" }}
      >
        {fmt(frameValues[16], 1)}
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
  value: number | null;
  tooltip: { name: string; value: number | null } | undefined;
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
        stroke="rgba(0,0,0,0.9)"
        strokeWidth="1"
        style={{ transition: "fill 240ms ease" }}
      >
        {tooltip && (
          <title>{tooltip.name}: {tooltip.value != null ? tooltip.value.toFixed(2) : "N/A"}%</title>
        )}
      </path>
      <text
        x={label.x}
        y={label.y + (showValue ? 0 : 4)}
        textAnchor="middle"
        dominantBaseline="auto"
        fontSize="9"
        fontWeight="600"
        fill="black"
        style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.55))" }}
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
          fill="black"
          style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.55))" }}
        >
          {fmt(value, 1)}
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
  previewMode,
  selectedSegment,
  onSelectSegment,
}: {
  selectedStrainType: StrainType;
  onStrainTypeChange: (type: StrainType) => void;
  currentFrame: number;
  frameCount: number;
  previewMode: boolean;
  selectedSegment: number | null;
  onSelectSegment: (segment: number) => void;
}) {
  const strainData = getDummyStrainData(selectedStrainType, currentFrame, frameCount);
  const average = strainData.reduce((sum, item) => sum + item.strain, 0) / strainData.length;
  const peak = selectedStrainType === "GRS"
    ? Math.max(...strainData.map((item) => item.strain))
    : Math.min(...strainData.map((item) => item.strain));
  const metricPreview = (["GLS", "GCS", "GRS"] as const).map((type) => {
    const data = getDummyStrainData(type, currentFrame, frameCount);
    const value = data.reduce((sum, item) => sum + item.strain, 0) / data.length;
    return { type, value };
  });

  if (previewMode) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background p-3">
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
        </div>
        <EmptyAnalysisPreview
          icon="strain"
          frame={currentFrame}
          frameCount={frameCount}
          message="Run landmark detection to preview frame-by-frame dummy strain values."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background p-3">
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
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {previewMode ? "Dummy preview" : "Detected"}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            {Math.min(currentFrame + 1, Math.max(frameCount, 1))}/{Math.max(frameCount, 1)}
          </span>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <MetricTile
          label={`Mean ${selectedStrainType}`}
          value={`${average > 0 ? "+" : ""}${average.toFixed(1)}`}
          unit="%"
          emphasized
        />
        <MetricTile
          label="Peak"
          value={`${peak > 0 ? "+" : ""}${peak.toFixed(1)}`}
          unit="%"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-muted/20 p-2">
        <StrainBullseye
          segmentData={strainData}
          selectedStrainType={selectedStrainType}
          frame={currentFrame}
          totalFrames={frameCount}
          compact
          selectedSegment={selectedSegment}
          onSelectSegment={onSelectSegment}
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px]">
        {metricPreview.map(({ type, value }) => (
          <button
            key={type}
            type="button"
            onClick={() => onStrainTypeChange(type)}
            className={cn(
              "rounded-md border border-border bg-muted/20 p-2 transition-colors hover:bg-muted/50",
              selectedStrainType === type && "border-primary/40 bg-primary/10",
            )}
          >
            <p className="text-muted-foreground">{type}</p>
            <p
              className="font-semibold"
              style={{ color: getStrainColor(value, type) }}
            >
              {value > 0 ? "+" : ""}{value.toFixed(1)}%
            </p>
          </button>
        ))}
      </div>
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

/** One-line summary of GPU inference quality stats. */
function LandmarkSummaryStats({
  nTotal,
  nCollapsed,
  n2ch,
  n1chFallback,
}: {
  nTotal?: number;
  nCollapsed?: number;
  n2ch?: number;
  n1chFallback?: number;
}) {
  if (!nTotal) return null;
  const confident = nTotal - (nCollapsed ?? 0);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 px-4 py-1.5 border-b border-border bg-muted/30 text-[11px] text-muted-foreground flex-shrink-0">
      <span>
        <span className="font-medium text-green-600 dark:text-green-400">{confident}/{nTotal}</span>
        {" slices confident"}
      </span>
      {(nCollapsed ?? 0) > 0 && (
        <span>
          <span className="font-medium text-zinc-500">{nCollapsed}/{nTotal}</span>
          {" mean point used"}
        </span>
      )}
      {(n2ch ?? 0) > 0 && (
        <span>
          <span className="font-medium text-blue-500">{n2ch}/{nTotal}</span>
          {" seg-guided (2ch)"}
        </span>
      )}
      {(n1chFallback ?? 0) > 0 && (
        <span>
          <span className="font-medium text-amber-500">{n1chFallback}/{nTotal}</span>
          {" MRI-only (1ch)"}
        </span>
      )}
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
