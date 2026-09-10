"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Loader2,
  Scan,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Heart,
  FileText,
  ArrowLeft,
  Activity,
  ZoomIn,
  ZoomOut,
  Stethoscope,
  Save,
} from "lucide-react";

import { useProject, normalizeReconstructionChamber } from "@/context/ProjectContext";
import { useProjectResults, type MaskDoc } from "@/hooks/useProjectResults";
import { LoadingProject } from "@/components/project/LoadingProject";
import { ErrorProject } from "@/components/project/ErrorProject";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLandmarkDetection } from "@/hooks/useLandmarkDetection";
import { LandmarkSidebar, type StrainComputeBundle } from "@/components/landmark/LandmarkSidebar";
import { ReconstructedHeartModel } from "@/components/landmark/ReconstructedHeartModel";
import { CombinedHeartModel } from "@/components/landmark/CombinedHeartModel";
import { RvCrescentDiagram } from "@/components/landmark/RvCrescentDiagram";
import { RV_SEGMENT_NAMES } from "@/components/landmark/heartColor";
import { ChamberFocusToggle, type ChamberFocus } from "@/components/landmark/ChamberFocusToggle";
import type { LandmarkMaskOverlay } from "@/components/landmark/LandmarkSliceViewer";
import {
  AHA_SEGMENT_COLORS,
  LANDMARK_DEFINITIONS,
  framePredictionsToLandmarkFrames,
  landmarkFramesToEdits,
} from "@/types/landmark";
import { ANATOMICAL_LABELS, type AnatomicalLabel } from "@/types/segmentation";
import type { LandmarkPageState } from "@/types/landmark";
import type { FramePrediction } from "@/types/landmark";
import { segmentationApi } from "@/lib/api";
import { fmt } from "@/lib/format-utils";
import { useGpuStatus } from "@/lib/dashboard-hooks";
import type { BullseyeData } from "@/types/project";
import { JobStatus } from "@/types/project";
import {
  StrainBullseyeChart,
  getDummyStrainData,
  ZoomPanContainer as StrainZoomPan,
  type StrainType,
  type RealStrainResult,
  type RealStrainSegment,
  type RvStrainResult,
  type StrainComputedFor,
} from "@/components/landmark/StrainVisualization";
import { CombinedVentricularChart } from "@/components/landmark/CombinedVentricularChart";
import { landmarkApi, computeStrainFromFrames, computeRvStrainFromFrames } from "@/lib/landmarkApi";

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
  const router = useRouter();

  // Workspace (which tab) and the active segmentation model are the page's
  // single source of truth, persisted to the URL so a reload restores exactly
  // what the user was looking at (?tab=strain&model=unet). The bullseye panel,
  // the sidebar tab, and the strain compute all read from these — no separate
  // per-widget model state to drift out of sync.
  const searchParams = useSearchParams();
  const workspace: "landmarks" | "structure" | "strain" =
    searchParams.get("tab") === "strain" ? "strain"
    : searchParams.get("tab") === "structure" ? "structure"
    : "landmarks";
  const activeModel: "unet" | "medsam" =
    searchParams.get("model") === "medsam" ? "medsam" : "unet";

  const updateUrlState = useCallback(
    (next: { tab?: "landmarks" | "structure" | "strain"; model?: "unet" | "medsam" }) => {
      const params = new URLSearchParams(window.location.search);
      if (next.tab) params.set("tab", next.tab);
      if (next.model) params.set("model", next.model);
      router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
    },
    [router],
  );
  const setWorkspace = useCallback(
    (tab: "landmarks" | "structure" | "strain") => updateUrlState({ tab }),
    [updateUrlState],
  );
  const setActiveModel = useCallback(
    (model: "unet" | "medsam") => updateUrlState({ model }),
    [updateUrlState],
  );
  // Back-compat aliases: existing bullseye code reads/writes these names.
  const selectedBullseyeModel = activeModel;
  const setSelectedBullseyeModel = setActiveModel;

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
    hydrating,
    replacementFileError,
    currentPrediction,
    confidentCount,
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
  // Per-frame wall thickness (RLE-only, auto-computed alongside the single
  // snapshot above) — separate from bullseyeSeries, which only exists once the
  // user manually runs the GRS/GCS strain series. See computeFrameWallThicknessSeries.
  const [frameBullseyeSeries, setFrameBullseyeSeries] = useState<{
    frames: { frameIndex: number; segment_values: (number | null)[]; stats: any }[];
    computed_at: string;
  } | null>(null);
  const [segFrameCount, setSegFrameCount] = useState(0);
  const [availableBullseyeModels, setAvailableBullseyeModels] = useState<{ medsam: boolean; unet: boolean }>({ medsam: false, unet: false });
  // Tracks whether the editable mask itself exists (independent of whether bullseye is computed)
  const [existingSegModels, setExistingSegModels] = useState<{ medsam: boolean; unet: boolean }>({ medsam: false, unet: false });
  const [calculatingModels, setCalculatingModels] = useState<{ medsam: boolean; unet: boolean }>({ medsam: false, unet: false });
  const [calcCountdown, setCalcCountdown] = useState(15);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [structureVentricle, setStructureVentricle] = useState<"LV" | "RV">("LV");
  const [selectedStrainType, setSelectedStrainType] = useState<StrainType>("GRS");
  // RV's own metric toggle (GCS/GAS) — separate from selectedStrainType (LV's
  // GRS/GCS) since RV has different metrics: GCS is real once computed, GAS is
  // an entirely unimplemented placeholder, so switching to it must render as
  // an obvious prototype state rather than fabricate colored values.
  const [selectedRvMetricType, setSelectedRvMetricType] = useState<"GCS" | "GAS">("GCS");
  // Full cycle's "Compute/Recompute all frames" busy state lives in StrainTab
  // (LandmarkSidebar.tsx) as local state, but the main panel needs to know
  // about it too (to show its own loading state) — reported up via the
  // strainCompute bundle's onFullCycleBusyChange.
  const [fullCycleBusy, setFullCycleBusy] = useState(false);
  const [selectedStrainSegment, setSelectedStrainSegment] = useState<number | null>(null);
  const [strainResult, setStrainResult] = useState<RealStrainResult | null>(null);
  const [rvStrainResult, setRvStrainResult] = useState<RvStrainResult | null>(null);
  const [autoFramesByModel, setAutoFramesByModel] = useState<{
    unet: { ed: number; es: number } | null;
    medsam: { ed: number; es: number } | null;
  }>({ unet: null, medsam: null });

  // Compute-strain state — lifted here (not owned by StrainPreviewPanel) since
  // the compute controls live in the sidebar's Strain tab ("Compute strain"
  // card) while the bullseye/3D-heart visualization they feed lives in the
  // main panel; both sibling trees need it.
  const [computeScope, setComputeScope] = useState<"quick" | "full">("quick");
  const [strainInputMode, setStrainInputMode] = useState<"frames" | "upload">("frames");
  const autoFramesForActiveModel = autoFramesByModel[activeModel];
  const [edFrameIdx, setEdFrameIdx] = useState<number>(autoFramesForActiveModel?.ed ?? 0);
  const [esFrameIdx, setEsFrameIdx] = useState<number>(autoFramesForActiveModel?.es ?? 13);
  // Sync the picker to the auto ED/ES when they load (metrics are async) or
  // when the active model changes — but only while the user hasn't manually
  // dragged the picker.
  const userPickedFramesRef = useRef(false);
  useEffect(() => {
    if (userPickedFramesRef.current) return;
    const auto = autoFramesByModel[activeModel];
    if (typeof auto?.ed === "number") setEdFrameIdx(auto.ed);
    if (typeof auto?.es === "number") setEsFrameIdx(auto.es);
  }, [autoFramesByModel, activeModel]);
  const [edFile, setEdFile] = useState<File | null>(null);
  const [esFile, setEsFile] = useState<File | null>(null);
  const [isComputingStrain, setIsComputingStrain] = useState(false);
  const [strainComputeError, setStrainComputeError] = useState<string | null>(null);
  const [editableLandmarks, setEditableLandmarks] = useState(true);
  const [highlightedLandmarkId, setHighlightedLandmarkId] = useState<string | null>(null);
  const [landmarkEdits, setLandmarkEdits] = useState<Record<string, Partial<FramePrediction>>>({});
  const [isSavingLandmarks, setIsSavingLandmarks] = useState(false);
  const [hasUnsavedLandmarkEdits, setHasUnsavedLandmarkEdits] = useState(false);
  const [pendingDeletions, setPendingDeletions] = useState<Record<string, number>>({});
  const pendingDeletionTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [bullseyeRecomputing, setBullseyeRecomputing] = useState(false);

  // (Model default now comes from the URL via activeModel — UNet unless the
  // user picked MedSAM. The old GPU-mode auto-flip to MedSAM was removed: it
  // fought the user's selection and desynced the bullseye from the strain tab.)

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

  // Tracks which mask IDs have already had bullseye auto-triggered this session
  const autoTriggeredBullseyeMasks = useRef<Set<string>>(new Set());

  const fetchBullseye = useCallback(async (preferredModel?: "medsam" | "unet", triggerIfMissing = true) => {
    setBullseyeLoading(true);
    try {
      const res = await segmentationApi.getSegmentationResults(projectId);
      type SegItem = {
        _id?: string; name?: string; isMedSAMOutput: boolean; bullseye?: BullseyeData; strain?: RealStrainResult;
        heartMetrics?: { ed_frame?: number; es_frame?: number };
        frameBullseye?: { frames: { frameIndex: number; segment_values: (number | null)[]; stats: any }[]; computed_at: string };
      };
      const segs = (res.segmentations ?? []) as SegItem[];

      // Editable masks only (isMedSAMOutput === false), split by inferred model
      const editables = segs.filter((m) => !m.isMedSAMOutput);
      const medsamMasks = editables.filter((m) => maskBelongsTo(m, "medsam"));
      const unetMasks = editables.filter((m) => maskBelongsTo(m, "unet"));

      // Surface the auto-detected ED/ES frames PER MODEL (from each model's own
      // heart-metrics) so the strain picker can default to the correct pair for
      // whichever model it computes with. Each model's mask detects ED/ES over its
      // own frames independently, so they can differ (e.g. UNet ES=13, MedSAM ES=11).
      const framesFor = (masks: SegItem[]): { ed: number; es: number } | null => {
        const withMetrics = masks.find(
          (m) => typeof m.heartMetrics?.ed_frame === "number" && typeof m.heartMetrics?.es_frame === "number",
        );
        return withMetrics?.heartMetrics
          ? { ed: withMetrics.heartMetrics.ed_frame as number, es: withMetrics.heartMetrics.es_frame as number }
          : null;
      };
      setAutoFramesByModel({ unet: framesFor(unetMasks), medsam: framesFor(medsamMasks) });

      const medsamWithBullseye = medsamMasks.find((m) => m.bullseye != null);
      const unetWithBullseye = unetMasks.find((m) => m.bullseye != null);

      const medsamHasBullseye = !!medsamWithBullseye;
      const unetHasBullseye = !!unetWithBullseye;
      setAvailableBullseyeModels({ medsam: medsamHasBullseye, unet: unetHasBullseye });
      // Whether the editable mask itself exists (regardless of bullseye state)
      setExistingSegModels({ medsam: medsamMasks.length > 0, unet: unetMasks.length > 0 });
      // Extract frame count from the non-MedSAM mask (used for "Choose frames" strain mode)
      const nonMedSAMWithFrames = editables.find((m) => (m as any).frames?.length > 0);
      if (nonMedSAMWithFrames) {
        setSegFrameCount((nonMedSAMWithFrames as any).frames.length);
      }
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

      // Auto-trigger bullseye for every editable mask missing EITHER the single
      // snapshot or the per-frame series — trigger-bullseye computes both, so
      // this also backfills frameBullseye on masks from before it existed
      // (which already have `bullseye` and would otherwise never re-fire).
      // Session ref still caps it at one trigger per mask per page load.
      if (triggerIfMissing) {
        const masksNeedingBullseye = editables.filter(
          (m) => m._id && (!m.bullseye || !m.frameBullseye) && !autoTriggeredBullseyeMasks.current.has(m._id)
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
        // Don't switch the active model here — activeModel (from the URL) is the
        // single source of truth; this only loads that model's bullseye data.
        setBullseyeData(selectedMask.bullseye!);
        setFrameBullseyeSeries(selectedMask.frameBullseye ?? null);
        setBullseyeLoading(false);
        return;
      }

      setBullseyeData(null);
      setFrameBullseyeSeries(null);
      setBullseyeLoading(false);
    } catch {
      setBullseyeData(null);
      setFrameBullseyeSeries(null);
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

  // Zoom reset refs — shared between bullseye panel and toolbar button
  const bullseyeZoomResetRef = useRef<(() => void) | null>(null);
  const heartZoomResetRef = useRef<(() => void) | null>(null);
  // Same pattern as heartZoomRef/heartZoomResetRef above, for the Structure
  // tab's standalone RV 3D panel (which isn't inside AhaBullseyePanel).
  const structureRvHeartZoomRef = useRef<((delta: number) => void) | null>(null);
  const structureRvHeartResetRef = useRef<(() => void) | null>(null);
  const [structureRvTooltip, setStructureRvTooltip] = useState<{ x: number; y: number; segment: number } | null>(null);

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
  }, [state.predictions, state.avgLm1, state.avgLm2]);

  const handleResetAlignment = useCallback(() => {
    setAhaAlignmentAngle(null);
  }, []);

  const [showLabels, setShowLabels] = useState(true);
  const [frameImageUrl, setFrameImageUrl] = useState<string | null>(null);

  const isRunning     = state.status === "running";
  const hasPredictions = state.status === "done" && state.predictions.length > 0;
  const autoRunStartedRef = useRef(false);

  // Prefer the GPU response's own top-level summary (state.nTotal etc.),
  // but those are optional on FramePrediction/LandmarkInferenceResponse and
  // absent on older stored detection runs -- e.g. patient005_4d's stored
  // result predates them, so LandmarkSummaryStats silently rendered nothing
  // even though every prediction it needs (confidence/model_used/flag) is
  // right there per-slice, the same fields the Detected Landmarks slice-
  // confidence strip already counts from successfully. Falling back to
  // counting them client-side means the summary always has something to
  // show whenever real predictions exist, regardless of backend version.
  const landmarkSummaryStats = useMemo(() => {
    if (state.nTotal != null) {
      return { nTotal: state.nTotal, nCollapsed: state.nCollapsed, n2ch: state.n2ch, n1chFallback: state.n1chFallback };
    }
    const preds = state.predictions;
    return {
      nTotal: preds.length,
      nCollapsed: preds.filter((p) => p.flag === "collapsed_to_mean").length,
      n2ch: preds.filter((p) => p.model_used === "2ch").length,
      n1chFallback: preds.filter((p) => p.model_used === "1ch_fallback").length,
    };
  }, [state.nTotal, state.nCollapsed, state.n2ch, state.n1chFallback, state.predictions]);

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
    // Wait for the hook to finish checking for an already-computed result
    // (in-memory cache or persisted DB job) before firing a fresh GPU run.
    // If one is found, status flips to "done" and this effect stays a no-op.
    if (hydrating) return;
    if (state.status !== "idle") return;

    autoRunStartedRef.current = true;
    runDetectionAndResetEdits(selectedModel);
  }, [loading, projectData, hydrating, state.status, runDetectionAndResetEdits, selectedModel]);

  const imageDimensions =
    state.imageDimensions.width > 0
      ? state.imageDimensions
      : {
          width:  projectData?.dimensions?.width  ?? 256,
          height: projectData?.dimensions?.height ?? 256,
        };

  const maskDimensions = {
    width:  projectData?.dimensions?.width  ?? imageDimensions.width,
    height: projectData?.dimensions?.height ?? imageDimensions.height,
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
    setLandmarkEdits((prev) => {
      const existing = prev[currentLandmarkEditKey] ?? {};
      const wasCollapsed = (currentPrediction?.flag === "collapsed_to_mean") && !("flag" in existing);
      return {
        ...prev,
        [currentLandmarkEditKey]: {
          ...existing,
          [id]: coord,
          // First edit on a collapsed slice promotes it to a normal editable prediction
          ...(wasCollapsed ? { flag: "normal" as const } : {}),
        },
      };
    });
    setHasUnsavedLandmarkEdits(true);
  }, [currentLandmarkEditKey, currentPrediction?.flag]);

  const handleLandmarkDeleteRequest = useCallback((id: string) => {
    const sliceKey = currentLandmarkEditKey;
    const fullKey = `${sliceKey}:${id}`;
    setPendingDeletions((prev) => ({ ...prev, [fullKey]: Date.now() }));
    pendingDeletionTimers.current[fullKey] = setTimeout(() => {
      setLandmarkEdits((prev) => ({
        ...prev,
        [sliceKey]: { ...(prev[sliceKey] ?? {}), [id]: undefined },
      }));
      setHasUnsavedLandmarkEdits(true);
      setPendingDeletions((prev) => {
        const next = { ...prev };
        delete next[fullKey];
        return next;
      });
      delete pendingDeletionTimers.current[fullKey];
    }, 5000);
  }, [currentLandmarkEditKey]);

  /** Undo a pending delete before its 5s window expires. Safe to key off the
   *  CURRENT slice: the row that renders this action only exists while
   *  viewing the same slice the deletion was started on. */
  const handleUndoLandmarkDelete = useCallback((id: string) => {
    const fullKey = `${currentLandmarkEditKey}:${id}`;
    const timer = pendingDeletionTimers.current[fullKey];
    if (timer) {
      clearTimeout(timer);
      delete pendingDeletionTimers.current[fullKey];
    }
    setPendingDeletions((prev) => {
      const next = { ...prev };
      delete next[fullKey];
      return next;
    });
  }, [currentLandmarkEditKey]);

  const handleSaveLandmarks = useCallback(async () => {
    if (isSavingLandmarks || state.predictions.length === 0) return;
    setIsSavingLandmarks(true);
    try {
      const frames = framePredictionsToLandmarkFrames(state.predictions, landmarkEdits);
      await landmarkApi.saveLandmarks(projectId, {
        frames,
        segmentationModel: selectedBullseyeModel,
      });
      setHasUnsavedLandmarkEdits(false);

      // Landmark points just changed, so the stored AHA-17 bullseye is now stale.
      // Re-trigger bullseye for every editable mask — the backend prefers the
      // saved edits we just wrote — then re-fetch so the chart reflects the new
      // alignment. Best-effort: a failed recompute never blocks the save.
      try {
        const res = await segmentationApi.getSegmentationResults(projectId);
        const editableMaskIds = ((res.segmentations ?? []) as { _id?: string; isMedSAMOutput: boolean }[])
          .filter((m) => !m.isMedSAMOutput && m._id)
          .map((m) => m._id as string);
        await Promise.all(
          editableMaskIds.map((id) => segmentationApi.triggerBullseye(id).catch(() => {})),
        );
        // Bullseye compute is async on the server; re-fetch after a short delay
        // to pick up the freshly-recomputed, edit-aligned result.
        setBullseyeRecomputing(true);
        setTimeout(() => {
          fetchBullseye(selectedBullseyeModel, false);
          setBullseyeRecomputing(false);
        }, 8000);
      } catch (recomputeErr) {
        console.error("[Landmark] Bullseye recompute after save failed:", recomputeErr);
      }
    } catch (err) {
      console.error("[Landmark] Failed to save landmark edits:", err);
    } finally {
      setIsSavingLandmarks(false);
    }
  }, [isSavingLandmarks, state.predictions, landmarkEdits, projectId, selectedBullseyeModel, fetchBullseye]);

  // Reload saved landmark edits on mount and after every successful (re-)run —
  // local landmarkEdits state was just cleared by run/rerunDetectionAndResetEdits,
  // but a previously SAVED editable doc must still reappear (mirrors segmentation
  // masks reloading the editable mask after a rerun).
  //
  // Landmark edits are shared across segmentation models (one editable doc per
  // project), so the reload is model-agnostic and only needs to fire on the
  // "just transitioned to done" edge — not on model changes.
  const prevLandmarkStatus = useRef(state.status);
  useEffect(() => {
    const justFinished = prevLandmarkStatus.current !== "done" && state.status === "done";
    prevLandmarkStatus.current = state.status;
    if (!justFinished) return;

    let cancelled = false;
    landmarkApi.loadSavedLandmarks(projectId).then((doc) => {
      if (cancelled || !doc) return;
      setLandmarkEdits(landmarkFramesToEdits(doc));
    }).catch(() => {
      // No saved doc yet, or load failed — leave landmarkEdits as-is (empty from the reset).
    });
    return () => { cancelled = true; };
  }, [state.status, projectId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === 's') {
        event.preventDefault();
        if (hasUnsavedLandmarkEdits && !isSavingLandmarks) {
          handleSaveLandmarks();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasUnsavedLandmarkEdits, isSavingLandmarks, handleSaveLandmarks]);
  const bullseyeFrameCount =
    (projectData?.dimensions?.frames && projectData.dimensions.frames > 0)
      ? projectData.dimensions.frames
      : (projectData?.dimensions?.slices && projectData.dimensions.slices > 0)
      ? projectData.dimensions.slices
      : 1;

  // Cardiac-cycle frame owned by the Strain tab's playback bar (in the sidebar)
  // and mirrored here so the bullseye and 3D heart animate with it. Kept
  // separate from `state.currentFrame`, which is the SLICE index used by the
  // landmark viewer.
  const [strainPlaybackFrame, setStrainPlaybackFrame] = useState(0);


  // Per-frame wall thickness, when the full-cycle strain series has been run for
  // the model the bullseye is showing. This is what lets the AHA plot animate
  // real myocardial thickening; without it the stored `bullseye` is a single
  // static measurement.
  const {
    strainSeries: bullseyeSeries,
    setModel: setBullseyeResultsModel,
    seriesAvailable,
    seriesComputedAt,
    byModel: resultsByModel,
  } = useProjectResults(projectId);
  useEffect(() => {
    setBullseyeResultsModel(selectedBullseyeModel);
  }, [selectedBullseyeModel, setBullseyeResultsModel]);

  // The full-cycle strain series (LV wall-thickness animation, GRS/GCS) stays
  // manual -- "Compute all frames" in the Strain tab -- since it's one GPU
  // pass per frame and shouldn't run automatically for every patient. Only
  // the cheap single-snapshot bullseye (fetchBullseye, below) auto-computes
  // as soon as segmentation is ready.

  // Hydrate strainResult/rvStrainResult (and the ED/ES picker) from whatever
  // this model's mask document already has stored — so reopening a project
  // with a previously-computed strain result shows it immediately instead of
  // an empty state, without re-running the compute. Moved here (not owned by
  // StrainPreviewPanel) since strainResult/rvStrainResult/edFrameIdx are all
  // lifted to this level now.
  const strainResultRef = useRef(strainResult);
  strainResultRef.current = strainResult;
  const rvStrainResultRef = useRef(rvStrainResult);
  rvStrainResultRef.current = rvStrainResult;
  const hydratedModelsRef = useRef<Set<"unet" | "medsam">>(new Set());
  useEffect(() => {
    if (hydratedModelsRef.current.has(activeModel)) return;
    const doc = resultsByModel?.[activeModel];
    if (!doc) return;

    const hasLvData = !!doc.strain || !!doc.strainSeries?.frames?.length;
    if (!hasLvData) return;
    hydratedModelsRef.current.add(activeModel);

    const meanOfNullable = (vals: (number | null | undefined)[]): number | null => {
      const nums = vals.filter((v): v is number => typeof v === "number");
      return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    };

    if (!strainResultRef.current) {
      if (doc.strain) {
        setStrainResult({
          segments: doc.strain.segments,
          global_grs: doc.strain.global_grs,
          global_gcs: doc.strain.global_gcs,
          ed_wt_mean_mm: meanOfNullable(doc.strain.segments.map((s) => s.wt_ed_mm)),
          es_wt_mean_mm: meanOfNullable(doc.strain.segments.map((s) => s.wt_es_mm)),
          vox_xy_mm: 0,
          alignment_source: "stored",
          edFrameIndex: doc.strain.edFrameIndex,
          esFrameIndex: doc.strain.esFrameIndex,
          source: "frames",
          computedFor: {
            mode: "choose-frames",
            model: activeModel,
            edFrameIndex: doc.strain.edFrameIndex ?? 0,
            esFrameIndex: doc.strain.esFrameIndex,
          },
        });
        if (!userPickedFramesRef.current) {
          if (typeof doc.strain.edFrameIndex === "number") setEdFrameIdx(doc.strain.edFrameIndex);
          if (typeof doc.strain.esFrameIndex === "number") setEsFrameIdx(doc.strain.esFrameIndex);
        }
      } else if (doc.strainSeries?.frames?.length) {
        const series = doc.strainSeries;
        const frame =
          series.frames.find((f) => f.frameIndex === series.edFrameIndex) ?? series.frames[0];
        setStrainResult({
          segments: frame.segments.map((s) => ({ segment: s.segment, label: s.label, grs: s.grs, gcs: s.gcs })),
          global_grs: frame.global_grs,
          global_gcs: frame.global_gcs,
          ed_wt_mean_mm: null,
          es_wt_mean_mm: null,
          vox_xy_mm: 0,
          alignment_source: "stored",
          edFrameIndex: series.edFrameIndex,
          source: "frames",
          computedFor: {
            mode: "full-cycle",
            model: activeModel,
            edFrameIndex: series.edFrameIndex,
          },
        });
      }
    }

    if (!rvStrainResultRef.current) {
      if (doc.rvStrain) {
        setRvStrainResult({
          regions: doc.rvStrain.regions,
          global_rv_strain: doc.rvStrain.global_rv_strain,
          vox_xy_mm: 0,
          alignment_source: "stored",
          edFrameIndex: doc.rvStrain.edFrameIndex,
          esFrameIndex: doc.rvStrain.esFrameIndex,
          source: "frames",
          computedFor: {
            mode: "choose-frames",
            model: activeModel,
            edFrameIndex: doc.rvStrain.edFrameIndex ?? 0,
            esFrameIndex: doc.rvStrain.esFrameIndex,
          },
        });
      } else if (doc.rvStrainSeries?.frames?.length) {
        const series = doc.rvStrainSeries;
        const frame =
          series.frames.find((f) => f.frameIndex === series.edFrameIndex) ?? series.frames[0];
        setRvStrainResult({
          regions: frame.regions,
          global_rv_strain: frame.global_rv_strain,
          vox_xy_mm: 0,
          alignment_source: "stored",
          edFrameIndex: series.edFrameIndex,
          source: "frames",
          computedFor: {
            mode: "full-cycle",
            model: activeModel,
            edFrameIndex: series.edFrameIndex,
          },
        });
      }
    }
  }, [activeModel, resultsByModel]);

  // On first load with NO model in the URL, land on a model that actually has
  // per-frame data (or the most recently computed when both do). When the URL
  // already names a model — e.g. after a reload — that choice wins and this is
  // skipped, so the user returns to exactly what they were viewing.
  const autoPickedSeriesModel = useRef(false);
  useEffect(() => {
    if (autoPickedSeriesModel.current) return;
    if (searchParams.get("model")) { autoPickedSeriesModel.current = true; return; }
    const { unet, medsam } = seriesAvailable;
    if (!unet && !medsam) return;
    let preferred: "unet" | "medsam";
    if (unet && medsam) {
      preferred =
        (seriesComputedAt.medsam ?? 0) > (seriesComputedAt.unet ?? 0) ? "medsam" : "unet";
    } else {
      preferred = unet ? "unet" : "medsam";
    }
    autoPickedSeriesModel.current = true;
    if (preferred !== activeModel) {
      setActiveModel(preferred);
      fetchBullseye(preferred);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesAvailable.unet, seriesAvailable.medsam, seriesComputedAt.unet, seriesComputedAt.medsam]);

  /** Wall thickness (mm) per AHA segment at the frame currently being shown. */
  const frameThicknessValues = useMemo(() => {
    // Prefer the strain series's wt_mm when the user has run "Compute all
    // frames" — it's derived from the same GPU comparison as GRS/GCS, so it's
    // already loaded and consistent with whatever strain data is showing.
    const strainFrames = bullseyeSeries?.frames;
    if (strainFrames?.length) {
      const frame = strainFrames.find((f) => f.frameIndex === strainPlaybackFrame) ?? strainFrames[0];
      const vals = Array.from({ length: 17 }, (_, i) => {
        const seg = frame.segments?.find((s) => s.segment === i + 1);
        return typeof seg?.wt_mm === "number" ? seg.wt_mm : null;
      });
      if (!vals.every((v) => v === null)) return vals;
      // Older series predate wt_mm — fall through to the RLE-only series below
      // rather than rendering a plot full of gaps.
    }
    // Otherwise use the auto-computed, RLE-only per-frame series — available
    // as soon as segmentation is done, no manual strain compute needed.
    const rleFrames = frameBullseyeSeries?.frames;
    if (!rleFrames?.length) return null;
    const rleFrame = rleFrames.find((f) => f.frameIndex === strainPlaybackFrame) ?? rleFrames[0];
    return rleFrame.segment_values.every((v) => v === null) ? null : rleFrame.segment_values;
  }, [bullseyeSeries, frameBullseyeSeries, strainPlaybackFrame]);

  // Structure tab's RV panel: real mesh + real segment boundaries, colored by
  // segment identity — see useRvPrototypeMesh's docstring.
  const structureRvMesh = useRvPrototypeMesh(activeModel, strainPlaybackFrame);

  /** Sidebar's compact Min/Mean/Max — tracks the current frame when a per-frame
   *  series exists (same source as frameThicknessValues), otherwise falls back
   *  to the single ED-frame snapshot so the sidebar isn't left blank. */
  const currentFrameStructureStats = useMemo(() => {
    if (!frameThicknessValues) return bullseyeData?.stats ?? null;
    const finite = frameThicknessValues.filter((v): v is number => typeof v === "number");
    if (!finite.length) return bullseyeData?.stats ?? null;
    return {
      min: Math.min(...finite),
      mean: finite.reduce((a, b) => a + b, 0) / finite.length,
      max: Math.max(...finite),
    };
  }, [frameThicknessValues, bullseyeData]);

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
    // tarCacheReady is a dependency so that when a persisted landmark result
    // makes predictions ready before the image cache finishes init(), this
    // effect re-runs once the cache becomes ready and the MRI image appears
    // without needing user interaction.
  }, [hasPredictions, getMRIImage, currentImageFrame, currentImageSlice, projectId, tarCacheReady]);

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

  // Landmark ids to hide from the CURRENTLY VIEWED slice's canvas while their
  // deletion is pending undo — scoped to this slice only, so navigating away
  // and back doesn't leak the fade into an unrelated slice.
  const currentSliceFadingIds = useMemo(() => {
    const prefix = `${currentLandmarkEditKey}:`;
    return new Set(
      Object.keys(pendingDeletions)
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length)),
    );
  }, [pendingDeletions, currentLandmarkEditKey]);

  // Slices with a manual deletion — pending OR already committed to
  // landmarkEdits — for the Slice Confidence strip's pencil badge.
  const manuallyDeletedSliceKeys = useMemo(() => {
    const set = new Set<string>();
    for (const key of Object.keys(pendingDeletions)) {
      set.add(key.slice(0, key.lastIndexOf(":")));
    }
    for (const [key, edit] of Object.entries(landmarkEdits)) {
      if (Object.values(edit).some((value) => value === undefined)) set.add(key);
    }
    return set;
  }, [pendingDeletions, landmarkEdits]);

  // Frame count for the ED/ES picker — prefer the MASK's actual frame count
  // (segFrameCount), the same set heart-metrics uses to detect ED/ES, so the
  // auto-detected ED/ES frames are always reachable and strain runs at frames
  // that match heartMetrics. Shared by the main panel and the sidebar's
  // "Compute strain" card so their pickers always agree.
  const strainFrameCount =
    segFrameCount > 0
      ? segFrameCount
      : (projectData?.dimensions?.frames && projectData.dimensions.frames > 0)
        ? projectData.dimensions.frames
        : state.totalFrames || 1;

  const handleComputeStrainFromUpload = useCallback(async () => {
    if (!edFile || !esFile) return;
    setIsComputingStrain(true);
    setStrainComputeError(null);
    try {
      const formData = new FormData();
      formData.append("ed_file", edFile);
      formData.append("es_file", esFile);
      if (state.avgLm1 && state.avgLm2) {
        formData.append("rv_insertion_1_x", String(state.avgLm1.x));
        formData.append("rv_insertion_1_y", String(state.avgLm1.y));
        formData.append("rv_insertion_2_x", String(state.avgLm2.x));
        formData.append("rv_insertion_2_y", String(state.avgLm2.y));
      }
      const result = await landmarkApi.computeStrain(projectId, formData);
      setStrainResult({
        ...result,
        computedFor: { mode: "upload", model: activeModel, edFrameIndex: -1 },
      });
    } catch (err: any) {
      setStrainComputeError(
        err?.response?.data?.message ??
        "Strain computation failed. Check that both files are valid segmentation NIfTI masks."
      );
    } finally {
      setIsComputingStrain(false);
    }
  }, [edFile, esFile, state.avgLm1, state.avgLm2, projectId, activeModel]);

  const handleComputeStrainFromFrames = useCallback(async () => {
    if (edFrameIdx === esFrameIdx) return;
    setStrainComputeError(null);
    setIsComputingStrain(true);
    try {
      const computedFor: StrainComputedFor = {
        mode: "choose-frames",
        model: activeModel,
        edFrameIndex: edFrameIdx,
        esFrameIndex: esFrameIdx,
      };
      const [lvOutcome, rvOutcome] = await Promise.allSettled([
        computeStrainFromFrames(projectId, edFrameIdx, esFrameIdx, activeModel),
        computeRvStrainFromFrames(projectId, edFrameIdx, esFrameIdx, activeModel),
      ]);
      if (lvOutcome.status === "fulfilled") setStrainResult({ ...lvOutcome.value, computedFor });
      if (rvOutcome.status === "fulfilled") setRvStrainResult({ ...rvOutcome.value, computedFor });

      if (lvOutcome.status === "rejected" && rvOutcome.status === "rejected") {
        setStrainComputeError("Failed to compute LV and RV strain from frames.");
      } else if (lvOutcome.status === "rejected") {
        setStrainComputeError("RV strain computed, but LV strain failed.");
      } else if (rvOutcome.status === "rejected") {
        setStrainComputeError("LV strain computed, but RV strain failed.");
      }
    } finally {
      setIsComputingStrain(false);
    }
  }, [edFrameIdx, esFrameIdx, projectId, activeModel]);

  // Whether the currently-stored strainResult/rvStrainResult actually matches
  // the Quick ED->ES pair/model selected right now (as opposed to a full-cycle
  // result, or a choose-frames result for a pair the user has since changed) —
  // same matching StrainPreviewPanel uses for its own display, duplicated here
  // (not lifted, to avoid an extra render dependency) so the sidebar's Quick
  // scope view shows exactly the same "is this actually the ED->ES result for
  // my current selection" answer as the bullseye/3D heart do.
  const quickLvResult = (() => {
    const cf = strainResult?.computedFor;
    const matches = !!(
      cf && cf.mode !== "full-cycle" && cf.model === activeModel &&
      (cf.mode === "upload" || (cf.edFrameIndex === edFrameIdx && cf.esFrameIndex === esFrameIdx))
    );
    return matches ? strainResult : null;
  })();
  const quickRvResult = (() => {
    const cf = rvStrainResult?.computedFor;
    const matches = !!(
      cf && cf.mode !== "full-cycle" && cf.model === activeModel &&
      (cf.mode === "upload" || (cf.edFrameIndex === edFrameIdx && cf.esFrameIndex === esFrameIdx))
    );
    return matches ? rvStrainResult : null;
  })();

  // Bundled and passed to LandmarkSidebar's "Compute strain" card (Strain tab) —
  // a single prop instead of ~18 individual ones, since the card and the main
  // panel's visualization both need this same state/these same handlers.
  const strainCompute: StrainComputeBundle = {
    scope: computeScope,
    onScopeChange: setComputeScope,
    inputMode: strainInputMode,
    onInputModeChange: setStrainInputMode,
    edFrameIdx,
    esFrameIdx,
    onEdFrameChange: (v) => { userPickedFramesRef.current = true; setEdFrameIdx(v); setStrainComputeError(null); },
    onEsFrameChange: (v) => { userPickedFramesRef.current = true; setEsFrameIdx(v); setStrainComputeError(null); },
    autoFrames: autoFramesByModel[activeModel] ?? null,
    onResetToAuto: () => {
      const auto = autoFramesByModel[activeModel];
      if (!auto) return;
      userPickedFramesRef.current = false;
      setEdFrameIdx(auto.ed);
      setEsFrameIdx(auto.es);
      setStrainComputeError(null);
    },
    frameCount: strainFrameCount,
    edFile,
    esFile,
    onEdFileChange: (f) => { setEdFile(f); setStrainComputeError(null); },
    onEsFileChange: (f) => { setEsFile(f); setStrainComputeError(null); },
    isComputing: isComputingStrain,
    error: strainComputeError,
    hasLandmarkAlignment: !!(state.avgLm1 && state.avgLm2),
    strainModel: activeModel,
    onComputeFrames: handleComputeStrainFromFrames,
    onComputeUpload: handleComputeStrainFromUpload,
    quickLvResult,
    quickRvResult,
    rvMetricType: selectedRvMetricType,
    onRvMetricTypeChange: setSelectedRvMetricType,
    onFullCycleBusyChange: setFullCycleBusy,
  };
  // Whichever compute is relevant to the CURRENT scope — the main panel
  // shows one loading state regardless of which of the two ran.
  const isComputeBusy = computeScope === "quick" ? isComputingStrain : fullCycleBusy;

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
          {/* Slices and frames are different axes: landmark detection runs per
              slice, the cardiac cycle spans frames. state.totalFrames is a slice
              count despite its name, so label it as slices and take frames from
              the project dimensions. */}
          <InfoPill
            label="Slices"
            value={String(
              (hasPredictions ? state.totalFrames : projectData.dimensions?.slices) ??
              projectData.dimensions?.slices ?? "—",
            )}
          />
          <InfoPill
            label="Frames"
            value={String(projectData.dimensions?.frames ?? "—")}
          />
        </div>

        {/* Re-run + Export buttons. (Landmark save lives in the Landmarks tab
            now, next to the editing controls — the header button was redundant.) */}
        {hasPredictions && (
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              className="text-xs gap-1.5"
              onClick={() => rerunDetectionAndResetEdits(selectedModel)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-run
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              onClick={() => router.push(`/project/${projectId}/report`)}
            >
              <FileText className="h-3.5 w-3.5" />
              Report Page
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
            fadingLandmarkIds={currentSliceFadingIds}
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
            summaryStats={hasPredictions ? (
              <LandmarkSummaryStats
                nTotal={landmarkSummaryStats.nTotal}
                nCollapsed={landmarkSummaryStats.nCollapsed}
                n2ch={landmarkSummaryStats.n2ch}
                n1chFallback={landmarkSummaryStats.n1chFallback}
              />
            ) : null}
            currentPrediction={adjustedCurrentPrediction}
            visibleLandmarks={visibleLandmarks}
            replacementFileError={replacementFileError}
            confidentCount={confidentCount}
            onStrainFrameChange={setStrainPlaybackFrame}
            onTabChange={setWorkspace}
            activeTab={workspace}
            activeModel={activeModel}
            onModelChange={(m) => { setActiveModel(m); fetchBullseye(m); }}
            structureVentricle={structureVentricle}
            onStructureVentricleChange={setStructureVentricle}
            structureStats={currentFrameStructureStats}
            isPerFrame={!!frameThicknessValues}
            hasUnsavedLandmarkEdits={hasUnsavedLandmarkEdits}
            isSavingLandmarks={isSavingLandmarks}
            onSaveLandmarks={handleSaveLandmarks}
            onToggleLandmark={handleToggleLandmark}
            currentSliceKey={currentLandmarkEditKey}
            pendingDeletions={pendingDeletions}
            onDeleteLandmark={handleLandmarkDeleteRequest}
            onUndoDeleteLandmark={handleUndoLandmarkDelete}
            manuallyDeletedSliceKeys={manuallyDeletedSliceKeys}
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
            selectedStrainType={selectedStrainType}
            onStrainTypeChange={setSelectedStrainType}
            strainCompute={strainCompute}
          />
        </div>
      </div>

      {/* Desktop: 3-panel resizable layout */}
      <div className="hidden lg:flex flex-1 min-h-0 p-3">
        {/* Keyed on the workspace: the group caches panel sizes by index, so
            adding/removing the bullseye panel without a remount leaves the
            remaining panels at stale widths. */}
        <ResizablePanelGroup
          key={workspace}
          direction="horizontal"
          className="h-full w-full rounded-xl border shadow-sm"
        >
          {workspace === "structure" && (
          <ResizablePanel defaultSize={66} minSize={40}>
            <div className="w-full h-full bg-background p-4 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-foreground">
                    {structureVentricle === "LV" ? "AHA 17-Segment Bullseye" : "RV 9-Segment Bullseye"}
                  </h3>
                  {/* Model choice lives only in the sidebar's UNet/MedSAM
                      buttons now (right panel) — this main panel used to
                      duplicate it with a Select dropdown for LV and RV each,
                      which could drift out of sync with the sidebar's own
                      control even though they shared state, and was just
                      redundant UI either way. */}
                  {structureVentricle === "LV" && bullseyeRecomputing && (
                    <span className="text-[10px] font-medium text-muted-foreground animate-pulse">
                      Recomputing with edits…
                    </span>
                  )}
                </div>
                {/* AHA alignment controls — visible once landmarks are detected */}
                {structureVentricle === "LV" && hasPredictions && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => { bullseyeZoomResetRef.current?.(); heartZoomResetRef.current?.(); }}
                      className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[10px] font-medium text-foreground shadow-sm hover:bg-muted/60 transition-colors"
                      title="Reset zoom on bullseye and 3D heart"
                    >
                      Reset View
                    </button>
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
              ) : structureVentricle === "RV" ? (
                structureRvMesh.available && structureRvMesh.meshUrl ? (
                  <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <div className="flex min-h-0 flex-1 gap-2 p-1">
                      {/* LEFT: flattened 9-segment crescent (RV's equivalent of
                          LV's circular bullseye — free-wall-only, so a half
                          annulus rather than a full circle; see
                          RvCrescentDiagram's own docstring). Static/decorative
                          — there's no real per-segment RV value to plot yet,
                          same gap the caption below already explains. */}
                      <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-slate-50 dark:bg-zinc-900 p-2">
                        <div className="mb-1 flex items-center justify-between flex-shrink-0">
                          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                            RV 9-Segment Crescent
                          </p>
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            Prototype
                          </span>
                        </div>
                        <div className="flex flex-1 min-h-0 items-center justify-center">
                          <RvCrescentDiagram className="w-full h-full max-h-[260px]" />
                        </div>
                      </div>

                      {/* RIGHT: 3D heart model */}
                      <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-slate-50 dark:bg-zinc-900 overflow-hidden p-2">
                        <div className="mb-1 flex items-center justify-between flex-shrink-0">
                          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">3D Heart</p>
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">Synced</span>
                        </div>
                        <div className="flex-1 min-h-0 w-full relative">
                          <ReconstructedHeartModel
                            meshUrl={structureRvMesh.meshUrl}
                            meshFormat={structureRvMesh.meshFormat}
                            segmentLabels={structureRvMesh.segmentLabels}
                            colorMode="rv-segment"
                            chamber="rv"
                            className="w-full h-full"
                            onZoomChange={(fn) => { structureRvHeartZoomRef.current = fn; }}
                            onResetZoom={(fn) => { structureRvHeartResetRef.current = fn; }}
                            onSegmentHover={setStructureRvTooltip}
                          />
                          {structureRvTooltip && (
                            <div
                              className="fixed z-50 pointer-events-none rounded px-2 py-1 text-xs bg-black/85 text-white border border-white/20 shadow-lg"
                              style={{ left: structureRvTooltip.x + 14, top: structureRvTooltip.y - 10 }}
                            >
                              <div className="font-semibold">
                                {RV_SEGMENT_NAMES[structureRvTooltip.segment] ?? `Segment ${structureRvTooltip.segment}`}
                              </div>
                            </div>
                          )}
                        </div>
                        {/* Zoom hint + buttons — matches the LV bullseye's own
                            3D panel (AhaHeartProjection) so RV isn't missing
                            the control LV has. */}
                        <div className="flex items-center justify-center gap-2 px-2 py-1 flex-shrink-0">
                          <p className="text-[9px] text-muted-foreground">Scroll or</p>
                          <button
                            type="button"
                            aria-label="Zoom in"
                            className="rounded border border-border bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground hover:bg-muted transition-colors flex items-center gap-0.5"
                            onClick={() => structureRvHeartZoomRef.current?.(-1)}
                          >
                            <ZoomIn className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            aria-label="Zoom out"
                            className="rounded border border-border bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground hover:bg-muted transition-colors flex items-center gap-0.5"
                            onClick={() => structureRvHeartZoomRef.current?.(1)}
                          >
                            <ZoomOut className="h-3 w-3" />
                          </button>
                          <p className="text-[9px] text-muted-foreground">to zoom</p>
                        </div>
                      </div>
                    </div>
                    <p className="text-[9px] text-muted-foreground leading-relaxed flex-shrink-0 px-1">
                      The mesh shape and 9-segment boundaries are from the real RV reconstruction, colored
                      by segment identity using the same palette as the analysis notebook. There&apos;s no
                      real per-segment wall-thickness/FAC measurement yet — colors mark segment identity,
                      not a value.
                    </p>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center text-muted-foreground px-6">
                    <AlertCircle className="h-8 w-8 opacity-40" />
                    <p className="max-w-[280px] text-xs leading-relaxed">
                      No RV reconstruction built yet for this model — create one from the project page to see
                      the Results (colors will stay prototype until wall-thickness/FAC is computed by
                      the backend).
                    </p>
                  </div>
                )
              ) : (
                <AhaBullseyePanel
                  bullseyeData={hasPredictions ? bullseyeData : null}
                  loading={hasPredictions ? bullseyeLoading : isRunning}
                  isComputing={bullseyeRecomputing || calculatingModels[activeModel]}
                  referenceAngleDeg={ahaAlignmentAngle ?? 0}
                  onCompute={() => fetchBullseye(selectedBullseyeModel, true)}
                  // Follows the shared cardiac-cycle playback (now driven from
                  // either the Structure or Strain tab), not the slice index —
                  // the bullseye is a per-frame view of the cycle.
                  currentFrame={strainPlaybackFrame}
                  frameCount={bullseyeFrameCount}
                  frameThickness={frameThicknessValues}
                  reconstructionModel={selectedBullseyeModel}
                  modelLabel={selectedBullseyeModel === "unet" ? "UNet" : "MedSAM"}
                  previewMode={!hasPredictions && !isRunning}
                  hasSegmentation={existingSegModels[selectedBullseyeModel]}
                  onBullseyeResetRef={(fn) => { bullseyeZoomResetRef.current = fn; }}
                  onHeartResetRef={(fn) => { heartZoomResetRef.current = fn; }}
                />
              )}
            </div>
          </ResizablePanel>
          )}

          {workspace === "strain" && (
          <ResizablePanel defaultSize={66} minSize={40}>
            <div className="w-full h-full bg-background p-4 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-foreground">Strain Preview</h3>
                  <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {activeModel === "unet" ? "UNet" : "MedSAM"}
                  </span>
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
                      Click <strong>Run Detection</strong> to analyse this project&apos;s MRI and generate strain results.
                    </p>
                  </div>
                </div>
              ) : (
                <StrainPreviewPanel
                  selectedStrainType={selectedStrainType}
                  activeModel={activeModel}
                  currentFrame={strainPlaybackFrame}
                  selectedSegment={selectedStrainSegment}
                  onSelectSegment={setSelectedStrainSegment}
                  avgLm1={state.avgLm1 ?? null}
                  strainResult={strainResult}
                  onStrainResult={setStrainResult}
                  rvStrainResult={rvStrainResult}
                  onRvStrainResult={setRvStrainResult}
                  edFrameIdx={edFrameIdx}
                  esFrameIdx={esFrameIdx}
                  rvMetricType={selectedRvMetricType}
                  computeScope={computeScope}
                  isComputeBusy={isComputeBusy}
                />
              )}
            </div>
          </ResizablePanel>
          )}

          {/* CENTER: 2D MRI slice viewer + landmark overlay — the Landmarks
              workspace only. Strain is about the cardiac cycle as a whole
              (bullseye / 3D heart / curves), not editing points on a slice. */}
          {workspace === "landmarks" && (
          <ResizablePanel defaultSize={55} minSize={25}>
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
                  fadingLandmarkIds={currentSliceFadingIds}
                  showLabels={showLabels}
                  editableLandmarks={editableLandmarks}
                  highlightedLandmarkId={highlightedLandmarkId}
                  onLandmarkMove={handleLandmarkMove}
                />
              </div>

            </div>
          </ResizablePanel>
          )}

          <ResizableHandle withHandle />

          {/* RIGHT: Sidebar — present in both workspaces. */}
          <ResizablePanel defaultSize={33} minSize={20} maxSize={45}>
            <div className="h-full w-full">
              <LandmarkSidebar
                state={state}
                summaryStats={hasPredictions ? (
                  <LandmarkSummaryStats
                    nTotal={landmarkSummaryStats.nTotal}
                    nCollapsed={landmarkSummaryStats.nCollapsed}
                    n2ch={landmarkSummaryStats.n2ch}
                    n1chFallback={landmarkSummaryStats.n1chFallback}
                  />
                ) : null}
                currentPrediction={adjustedCurrentPrediction}
                visibleLandmarks={visibleLandmarks}
                replacementFileError={replacementFileError}
                confidentCount={confidentCount}
                onStrainFrameChange={setStrainPlaybackFrame}
            onTabChange={setWorkspace}
            activeTab={workspace}
            activeModel={activeModel}
            onModelChange={(m) => { setActiveModel(m); fetchBullseye(m); }}
            structureVentricle={structureVentricle}
            onStructureVentricleChange={setStructureVentricle}
            structureStats={currentFrameStructureStats}
            isPerFrame={!!frameThicknessValues}
            hasUnsavedLandmarkEdits={hasUnsavedLandmarkEdits}
            isSavingLandmarks={isSavingLandmarks}
            onSaveLandmarks={handleSaveLandmarks}
                onToggleLandmark={handleToggleLandmark}
            currentSliceKey={currentLandmarkEditKey}
            pendingDeletions={pendingDeletions}
            onDeleteLandmark={handleLandmarkDeleteRequest}
            onUndoDeleteLandmark={handleUndoLandmarkDelete}
            manuallyDeletedSliceKeys={manuallyDeletedSliceKeys}
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
                selectedStrainType={selectedStrainType}
                onStrainTypeChange={setSelectedStrainType}
                strainCompute={strainCompute}
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

/**
 * Bullseye values to display.
 *
 * The stored `bullseye` is a SINGLE measurement (wall thickness at one point in
 * the cycle) — it has no time dimension. This previously added a sine wave keyed
 * to the frame index so the plot appeared to animate, which showed values that
 * were never measured. Real per-frame values come from `strainSeries`
 * (POST /segmentation/compute-strain-series); until that exists the static
 * measurement is shown unchanged, and the UI says so.
 */
function getFrameBullseyeValues(bullseyeData: BullseyeData): number[] {
  return bullseyeData.segment_values;
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

/**
 * Resolves the real RV reconstruction for `model` (if one has been built) and
 * fetches its actual per-frame mesh + real 9-segment vertex labels. The SHAPE
 * and segment BOUNDARIES this returns are real (from the RV 4D reconstruction
 * + CPD segmentation pipeline). There is no real per-segment wall-thickness/
 * FAC data to color it with yet — callers should render with colorMode=
 * "rv-segment" (identity colors matching the analysis notebook's palette,
 * see heartColor.ts's RV_SEGMENT_PALETTE), not a value-based heatmap.
 */
function useRvPrototypeMesh(model: "unet" | "medsam", currentFrame: number) {
  const { getReconstructionGLB, reconstructionResults } = useProject();

  const rvReconstruction = useMemo(() => {
    const candidates = (reconstructionResults ?? []).filter(
      (r: any) => normalizeReconstructionChamber(r?.chamber) === "rv", // eslint-disable-line @typescript-eslint/no-explicit-any
    );
    if (!candidates.length) return null;
    const sameModel = candidates.find(
      (r: any) => (r?.segmentationModel ?? "").toString().toLowerCase() === model, // eslint-disable-line @typescript-eslint/no-explicit-any
    );
    // No same-model RV reconstruction: don't pair a UNet RV mesh with a
    // MedSAM LV segmentation context — only fall back if there's just one.
    return sameModel ?? (candidates.length === 1 ? candidates[0] : null);
  }, [reconstructionResults, model]);

  const [meshUrl, setMeshUrl] = useState<string | null>(null);
  useEffect(() => {
    setMeshUrl(null);
  }, [rvReconstruction?.reconstructionId]);
  useEffect(() => {
    let cancelled = false;
    if (!rvReconstruction?.reconstructionId) return;
    (async () => {
      const url = await getReconstructionGLB(currentFrame, model, rvReconstruction.reconstructionId);
      if (!cancelled) setMeshUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, [rvReconstruction, model, currentFrame, getReconstructionGLB]);

  const segmentLabels = useMemo(() => {
    const perFrame = rvReconstruction?.frameAhaVertexLabels?.[String(currentFrame)];
    if (Array.isArray(perFrame)) return perFrame;
    return Array.isArray(rvReconstruction?.ahaVertexLabels) ? rvReconstruction.ahaVertexLabels : null;
  }, [rvReconstruction, currentFrame]);

  return {
    available: !!rvReconstruction && !!segmentLabels?.length,
    meshUrl,
    meshFormat: (rvReconstruction?.meshFormat?.toLowerCase() === "obj" ? "obj" : "glb") as "obj" | "glb",
    segmentLabels,
  };
}

function AhaBullseyePanel({
  bullseyeData,
  loading,
  referenceAngleDeg = 0,
  currentFrame = 0,
  frameCount = 1,
  frameThickness = null,
  reconstructionModel,
  modelLabel = "this model",
  previewMode = false,
  isComputing = false,
  onCompute,
  onBullseyeResetRef,
  onHeartResetRef,
  hasSegmentation = true,
}: {
  bullseyeData: BullseyeData | null | undefined;
  loading: boolean;
  /** True only while the GPU is generating the bullseye (vs. loading stored data). */
  isComputing?: boolean;
  referenceAngleDeg?: number;
  currentFrame?: number;
  frameCount?: number;
  /**
   * Wall thickness (mm) per AHA segment at `currentFrame`, from the full-cycle
   * strain series. When present the plot animates real myocardial thickening;
   * when null it falls back to the single stored `bullseye` measurement.
   */
  frameThickness?: (number | null)[] | null;
  reconstructionModel?: "unet" | "medsam";
  /** Display name of the model being shown — used in the empty state. */
  modelLabel?: string;
  previewMode?: boolean;
  onCompute?: () => void;
  onBullseyeResetRef?: (fn: () => void) => void;
  onHeartResetRef?: (fn: () => void) => void;
  /**
   * Whether `reconstructionModel`'s segmentation exists at all for this
   * project. False means there's nothing to compute a bullseye OR a 3D
   * heart FROM yet (not just "bullseye not computed yet") -- mirrors the
   * RV structure panel's own "No RV reconstruction built yet" empty state
   * instead of the generic "No bullseye data" one, which implied a Compute
   * action was available when it wasn't.
   */
  hasSegmentation?: boolean;
}) {
  const baseBullseyeData = previewMode ? getDummyBullseyeData(currentFrame, frameCount) : bullseyeData;

  // Swap in the per-frame thickness while keeping the stored metadata/labels.
  const displayBullseyeData = useMemo(() => {
    if (!baseBullseyeData || !frameThickness) return baseBullseyeData;
    const segment_values = baseBullseyeData.segment_values.map((v, i) =>
      typeof frameThickness[i] === "number" ? (frameThickness[i] as number) : v,
    );
    const finite = segment_values.filter((v) => Number.isFinite(v));
    return {
      ...baseBullseyeData,
      segment_values,
      segment_metadata: baseBullseyeData.segment_metadata?.map((m, i) => ({
        ...m,
        value: segment_values[i],
      })),
      // Recompute so the colour scale tracks this frame, not the ED snapshot.
      stats: {
        ...baseBullseyeData.stats,
        min: finite.length ? Math.min(...finite) : baseBullseyeData.stats?.min,
        max: finite.length ? Math.max(...finite) : baseBullseyeData.stats?.max,
        mean: finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : baseBullseyeData.stats?.mean,
      },
    } as BullseyeData;
  }, [baseBullseyeData, frameThickness]);
  const heartZoomRef = useRef<((delta: number) => void) | null>(null);

  const { getReconstructionGLB, reconstructionsByModel, reconstructionJobs } = useProject();
  const activeReconstruction = reconstructionModel ? reconstructionsByModel?.[reconstructionModel] ?? null : null;
  const [reconstructionMeshUrl, setReconstructionMeshUrl] = useState<string | null>(null);
  // Reset ONLY when switching to a genuinely different reconstruction/model - not on
  // every frame change, otherwise fast playback (many frame changes per second) spends
  // most of its time with the mesh nulled out while each fetch is still in flight,
  // which is exactly what caused the flicker/disappearing model during playback.
  useEffect(() => {
    setReconstructionMeshUrl(null);
  }, [activeReconstruction?.reconstructionId, reconstructionModel]);

  useEffect(() => {
    let cancelled = false;
    if (!activeReconstruction?.reconstructionId || !Array.isArray(activeReconstruction?.ahaVertexLabels)) {
      return;
    }
    (async () => {
      const url = await getReconstructionGLB(currentFrame, reconstructionModel, activeReconstruction.reconstructionId);
      // Swap in directly, without nulling first - keeps the previous frame's mesh
      // visible until the new one is ready, so rapid playback doesn't flash empty.
      if (!cancelled) setReconstructionMeshUrl(url);
    })();
    return () => { cancelled = true; };
  }, [activeReconstruction, reconstructionModel, getReconstructionGLB, currentFrame]);

  // Per-frame AHA labels for whichever frame's geometry is currently loaded above.
  // Each frame's own marching-cubes mesh has its own vertex count/ordering, so labels
  // are NOT interchangeable across frames - falls back to the ED-only labels (older
  // reconstructions, or frames the GPU skipped as apex/base slices with no contour).
  const reconstructionLabels = useMemo(() => {
    const perFrame = activeReconstruction?.frameAhaVertexLabels?.[String(currentFrame)];
    if (Array.isArray(perFrame)) return perFrame;
    return Array.isArray(activeReconstruction?.ahaVertexLabels) ? activeReconstruction.ahaVertexLabels : null;
  }, [activeReconstruction, currentFrame]);

  const isReconstructionPending = useMemo(() => {
    if (!reconstructionModel) return false;
    return (reconstructionJobs || []).some(
      (job) =>
        job.segmentationModel === reconstructionModel &&
        (job.status === JobStatus.PENDING || job.status === JobStatus.IN_PROGRESS),
    );
  }, [reconstructionJobs, reconstructionModel]);

  // Fix 1: bullseye segment hover tooltip
  const [bullseyeTooltip, setBullseyeTooltip] = useState<{
    x: number; y: number; name: string; valueMm: number; pct: number;
  } | null>(null);

  // Fix 3: selected 2D segment drives 3D camera pan + blink (0-based, -1=none)
  const [selectedBullseyeSegment, setSelectedBullseyeSegment] = useState(-1);

  // Fix 2: per-frame min/max for colorbar percentages
  const frameValues = displayBullseyeData
    ? getFrameBullseyeValues(displayBullseyeData)
    : null;
  const frameMin = frameValues ? Math.min(...frameValues) : 0;
  const frameMax = frameValues ? Math.max(...frameValues) : 0;
  // Total invalidity: every segment came back null (e.g. a segmentation model
  // found no myocardium above classify_slices()'s pixel threshold for any
  // slice). Distinct from the partial case (stats.n_nan > 0 but mean still a
  // real number), which already renders correctly further down.
  const hasNoValidSegments = displayBullseyeData != null && displayBullseyeData.stats.mean == null;
  const meanPct = frameMax > frameMin && displayBullseyeData?.stats.mean != null
    ? Math.round((displayBullseyeData.stats.mean - frameMin) / (frameMax - frameMin) * 100)
    : 50;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background">
      {!previewMode && !hasSegmentation ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center text-muted-foreground px-6">
          <AlertCircle className="h-8 w-8 opacity-40" />
          <p className="max-w-[280px] text-xs leading-relaxed">
            No LV reconstruction built yet for this model — create one from the project page to see
            the results
          </p>
        </div>
      ) : loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            {/* "Computing" only when the GPU is actually generating the bullseye;
                otherwise we're just loading already-stored data. */}
            <span className="text-xs">{isComputing ? "Computing bullseye…" : "Loading…"}</span>
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
      ) : hasNoValidSegments ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-4">
          <AlertCircle className="h-6 w-6 text-muted-foreground opacity-50" />
          <p className="text-xs text-muted-foreground">
            Insufficient segmentation — no myocardium detected in any slice for this model.
          </p>
          {onCompute && (
            <button
              type="button"
              onClick={onCompute}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-muted/60 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Recompute Bullseye
            </button>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-2 p-3">
          {/* LEFT: Bullseye chart */}
          <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-slate-50 dark:bg-zinc-900 p-2">
            <div className="mb-1 flex items-center justify-between flex-shrink-0">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                Frame {Math.min(currentFrame + 1, Math.max(frameCount, 1))}/{Math.max(frameCount, 1)}
              </p>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                {previewMode ? "Preview" : "Result"}
              </span>
            </div>
            <ZoomPanContainer
              className="flex-1 min-h-0 w-full"
              onResetRef={(fn) => { if (onBullseyeResetRef) onBullseyeResetRef(fn); }}
            >
              <AhaBullseyeChart
                bullseyeData={displayBullseyeData}
                referenceAngleDeg={referenceAngleDeg}
                currentFrame={currentFrame}
                frameCount={frameCount}
                onSegmentHover={setBullseyeTooltip}
                onSegmentLeave={() => setBullseyeTooltip(null)}
                selectedSegment={selectedBullseyeSegment}
                onSegmentClick={(idx) => setSelectedBullseyeSegment((prev) => prev === idx ? -1 : idx)}
              />
            </ZoomPanContainer>
            {bullseyeTooltip && (
              <div
                className="fixed z-50 pointer-events-none rounded px-2 py-1 text-xs bg-black/85 text-white border border-white/20 shadow-lg"
                style={{ left: bullseyeTooltip.x + 14, top: bullseyeTooltip.y - 10 }}
              >
                <div className="font-semibold">{bullseyeTooltip.name}</div>
                <div>{bullseyeTooltip.valueMm.toFixed(1)} mm ({bullseyeTooltip.pct}%)</div>
              </div>
            )}
            {/* Compact stats below chart */}
            <div className="flex-shrink-0 pt-1.5 space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-muted-foreground tabular-nums">{frameMin.toFixed(1)}</span>
                <div
                  className="h-1.5 flex-1 rounded-full"
                  style={{
                    background: "linear-gradient(to right, #d73027, #fc8d59, #fee08b, #d9ef8b, #91cf60, #1a9850)",
                    border: "1px solid hsl(var(--border))",
                  }}
                />
                <span className="text-[9px] text-muted-foreground tabular-nums">{frameMax.toFixed(1)}</span>
              </div>
              <div className="flex justify-between text-center text-[9px]">
                <div>
                  <p className="text-muted-foreground">Min</p>
                  <p className="font-semibold tabular-nums">{frameMin.toFixed(1)} mm <span className="text-muted-foreground font-normal">(0%)</span></p>
                </div>
                <div>
                  <p className="text-muted-foreground">Mean</p>
                  <p className="font-semibold tabular-nums text-primary">{(displayBullseyeData.stats.mean ?? 0).toFixed(1)} mm <span className="text-muted-foreground font-normal">({meanPct}%)</span></p>
                </div>
                <div>
                  <p className="text-muted-foreground">Max</p>
                  <p className="font-semibold tabular-nums">{frameMax.toFixed(1)} mm <span className="text-muted-foreground font-normal">(100%)</span></p>
                </div>
              </div>
              {displayBullseyeData.stats.n_nan > 0 && (
                <p className="text-[9px] text-amber-600 dark:text-amber-400">
                  ⚠ {displayBullseyeData.stats.n_nan} segment{displayBullseyeData.stats.n_nan > 1 ? "s" : ""} missing
                </p>
              )}
            </div>
          </div>

          {/* RIGHT: 3D heart model */}
          <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-slate-50 dark:bg-zinc-900 overflow-hidden p-2">
            <div className="mb-1 flex items-center justify-between flex-shrink-0">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">3D Heart</p>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">Synced</span>
            </div>
            <AhaHeartProjection
              bullseyeData={displayBullseyeData}
              currentFrame={currentFrame}
              frameCount={frameCount}
              previewMode={previewMode}
              selectedSegment={selectedBullseyeSegment}
              onSelectSegment={setSelectedBullseyeSegment}
              reconstructionMeshUrl={reconstructionMeshUrl}
              reconstructionMeshFormat={activeReconstruction?.meshFormat?.toLowerCase() === "obj" ? "obj" : "glb"}
              reconstructionLabels={reconstructionLabels}
              reconstructionPending={isReconstructionPending}
              onZoomChange={(fn) => { heartZoomRef.current = fn; }}
              onResetZoom={(fn) => { if (onHeartResetRef) onHeartResetRef(fn); }}
            />
            {/* Zoom hint + buttons */}
            <div className="flex items-center justify-center gap-2 px-2 py-1 flex-shrink-0">
              <p className="text-[9px] text-muted-foreground">Scroll or</p>
              <button
                type="button"
                aria-label="Zoom in"
                className="rounded border border-border bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground hover:bg-muted transition-colors flex items-center gap-0.5"
                onClick={() => heartZoomRef.current?.(-1)}
              >
                <ZoomIn className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Zoom out"
                className="rounded border border-border bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground hover:bg-muted transition-colors flex items-center gap-0.5"
                onClick={() => heartZoomRef.current?.(1)}
              >
                <ZoomOut className="h-3 w-3" />
              </button>
              <p className="text-[9px] text-muted-foreground">to zoom</p>
            </div>
          </div>
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
  selectedSegment = -1,
  onSelectSegment,
  reconstructionMeshUrl,
  reconstructionMeshFormat,
  reconstructionLabels,
  reconstructionPending = false,
  onZoomChange,
  onResetZoom,
}: {
  bullseyeData: BullseyeData;
  currentFrame: number;
  frameCount: number;
  previewMode?: boolean;
  selectedSegment?: number;
  onSelectSegment?: (segment: number) => void;
  reconstructionMeshUrl?: string | null;
  reconstructionMeshFormat?: "obj" | "glb";
  reconstructionLabels?: number[] | null;
  reconstructionPending?: boolean;
  onZoomChange?: (fn: (delta: number) => void) => void;
  onResetZoom?: (fn: () => void) => void;
}) {
  const frameValues = getFrameBullseyeValues(bullseyeData);
  // Use per-frame min/max so the 3D colour scale is identical to the 2D bullseye chart
  const frameMin = Math.min(...frameValues);
  const frameMax = Math.max(...frameValues);
  const [heartTooltip, setHeartTooltip] = useState<{ x: number; y: number; segment: number } | null>(null);

  if (reconstructionMeshUrl && reconstructionMeshFormat && reconstructionLabels?.length) {
    return (
      <div className="flex-1 min-h-0 w-full relative">
        <ReconstructedHeartModel
          meshUrl={reconstructionMeshUrl}
          meshFormat={reconstructionMeshFormat}
          segmentLabels={reconstructionLabels}
          colorMode="strain"
          values={frameValues}
          min={frameMin}
          max={frameMax}
          className="w-full h-full"
          selectedSegment={selectedSegment >= 0 ? selectedSegment + 1 : -1}
          onSegmentClick={(seg) =>
            onSelectSegment?.(selectedSegment === seg - 1 ? -1 : seg - 1)
          }
          onSegmentHover={setHeartTooltip}
        />
        {heartTooltip && (
          <div
            className="fixed z-50 pointer-events-none rounded px-2 py-1 text-xs bg-black/85 text-white border border-white/20 shadow-lg"
            style={{ left: heartTooltip.x + 14, top: heartTooltip.y - 10 }}
          >
            <div className="font-semibold">{AHA_SEGMENTS[heartTooltip.segment - 1] ?? `Segment ${heartTooltip.segment}`}</div>
            <div>{(frameValues[heartTooltip.segment - 1] ?? 0).toFixed(1)} mm</div>
          </div>
        )}
      </div>
    );
  }

  if (reconstructionPending) {
    return (
      <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center gap-3 px-4 text-center text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin opacity-50" />
        <p className="max-w-[240px] text-xs leading-relaxed">
          Your 4D reconstruction is processing, this usually takes 2-5 minutes. The real
          AHA-colored 3D model will appear here once it's done.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 w-full flex flex-col items-center justify-center gap-3 px-4 text-center text-muted-foreground">
      <AlertCircle className="h-8 w-8 opacity-40" />
      <p className="max-w-[240px] text-xs leading-relaxed">
        Please run <span className="font-medium text-foreground">MedSAM</span> or{" "}
        <span className="font-medium text-foreground">U-Net</span> 4D reconstruction to access this.
      </p>
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
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ZoomPanContainer({
  children,
  className,
  onResetRef,
}: {
  children: ReactNode;
  className?: string;
  onResetRef?: (resetFn: () => void) => void;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const activePtr = useRef<number | null>(null);

  const applyTransform = useCallback((t: { scale: number; x: number; y: number }) => {
    transformRef.current = t;
    if (innerRef.current) {
      innerRef.current.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
    }
    if (outerRef.current) {
      outerRef.current.style.cursor = t.scale > 1 ? "grab" : "default";
    }
  }, []);

  useEffect(() => {
    if (onResetRef) {
      onResetRef(() => applyTransform({ scale: 1, x: 0, y: 0 }));
    }
  }, [onResetRef, applyTransform]);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const prev = transformRef.current;
      const factor = e.deltaY < 0 ? 1.12 : 0.9;
      const scale = Math.min(4, Math.max(1, prev.scale * factor));
      const ratio = scale / prev.scale;
      applyTransform({ scale, x: prev.x * ratio, y: prev.y * ratio });
    };

    const onPointerDown = (e: PointerEvent) => {
      // Only capture pointer (and block click) when zoomed in so panning is possible.
      // At scale=1 we let events through so SVG segment onClick fires normally.
      if (transformRef.current.scale <= 1) return;
      e.preventDefault();
      activePtr.current = e.pointerId;
      el.setPointerCapture(e.pointerId);
      dragging.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging.current || e.pointerId !== activePtr.current) return;
      const prev = transformRef.current;
      if (prev.scale <= 1) return;
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      applyTransform({ ...prev, x: prev.x + dx, y: prev.y + dy });
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId === activePtr.current) {
        dragging.current = false;
        activePtr.current = null;
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, [applyTransform]);

  return (
    <div ref={outerRef} className={`relative isolate ${className ?? ""}`} style={{ cursor: "default", overflow: "clip" }}>
      <div
        ref={innerRef}
        style={{
          transform: "translate(0px, 0px) scale(1)",
          transformOrigin: "center center",
          width: "100%",
          height: "100%",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function AhaBullseyeChart({
  bullseyeData,
  referenceAngleDeg = 0,
  currentFrame = 0,
  frameCount = 1,
  onSegmentHover,
  onSegmentLeave,
  selectedSegment = -1,
  onSegmentClick,
}: {
  bullseyeData: BullseyeData;
  referenceAngleDeg?: number;
  currentFrame?: number;
  frameCount?: number;
  onSegmentHover?: (t: { x: number; y: number; name: string; valueMm: number; pct: number }) => void;
  onSegmentLeave?: () => void;
  selectedSegment?: number;
  onSegmentClick?: (index: number) => void;
}) {
  const center = 150;
  const basalOuter = 108;
  const basalInner = 81;
  const midInner = 54;
  const apicalInner = 28;
  const { segment_metadata } = bullseyeData;
  const frameValues = getFrameBullseyeValues(bullseyeData);
  const frameMin = Math.min(...frameValues);
  const frameMax = Math.max(...frameValues);

  return (
    <svg
      viewBox="0 0 300 300"
      role="img"
      aria-label="AHA 17-segment bullseye chart"
      className="h-full w-full text-[#475569] dark:text-slate-300"
    >
      <circle cx={center} cy={center} r="112" className="fill-slate-50 stroke-slate-200 dark:fill-zinc-900 dark:stroke-zinc-700" strokeWidth="1" />

      <text x={center} y="12" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">
        Anterior
      </text>
      <text x="298" y={center + 4} textAnchor="end" fontSize="11" fontWeight="700" fill="currentColor">
        Septal
      </text>
      <text x={center} y="290" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">
        Inferior
      </text>
      <text x="2" y={center + 4} textAnchor="start" fontSize="11" fontWeight="700" fill="currentColor">
        Lateral
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
          selected={selectedSegment === index}
          onSegmentHover={onSegmentHover}
          onSegmentLeave={onSegmentLeave}
          onSegmentClick={onSegmentClick}
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
          selected={selectedSegment === index + 6}
          onSegmentHover={onSegmentHover}
          onSegmentLeave={onSegmentLeave}
          onSegmentClick={onSegmentClick}
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
          selected={selectedSegment === index + 12}
          onSegmentHover={onSegmentHover}
          onSegmentLeave={onSegmentLeave}
          onSegmentClick={onSegmentClick}
        />
      ))}
      <circle
        cx={center}
        cy={center}
        r={apicalInner}
        fill={segmentColor(frameValues[16], frameMin, frameMax)}
        stroke={selectedSegment === 16 ? "white" : "rgba(0,0,0,0.9)"}
        strokeWidth={selectedSegment === 16 ? 2.5 : 1}
        style={{ transition: "fill 240ms ease", cursor: "pointer" }}
        onMouseMove={onSegmentHover ? (e) => {
          const val = frameValues[16];
          const pct = frameMax > frameMin ? Math.round((val - frameMin) / (frameMax - frameMin) * 100) : 0;
          onSegmentHover({ x: e.clientX, y: e.clientY, name: segment_metadata[16]?.name ?? "Apex", valueMm: val, pct });
        } : undefined}
        onMouseLeave={onSegmentLeave}
        onClick={onSegmentClick ? () => onSegmentClick(16) : undefined}
      />

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
  selected = false,
  onSegmentHover,
  onSegmentLeave,
  onSegmentClick,
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
  selected?: boolean;
  onSegmentHover?: (t: { x: number; y: number; name: string; valueMm: number; pct: number }) => void;
  onSegmentLeave?: () => void;
  onSegmentClick?: (index: number) => void;
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
        stroke={selected ? "white" : "rgba(0,0,0,0.9)"}
        strokeWidth={selected ? 2.5 : 1}
        style={{ transition: "fill 240ms ease", cursor: "pointer" }}
        onMouseMove={onSegmentHover && value != null ? (e) => {
          const pct = max > min ? Math.round((value - min) / (max - min) * 100) : 0;
          onSegmentHover({ x: e.clientX, y: e.clientY, name: tooltip?.name ?? `Segment ${index + 1}`, valueMm: value, pct });
        } : undefined}
        onMouseLeave={onSegmentLeave}
        onClick={onSegmentClick ? () => onSegmentClick(index) : undefined}
      />
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

// Renders the real reconstructed heart, or a prompt to run 4D reconstruction.
// selectedSegment3d is 0-based.
// min, max, reverseColors are passed from the parent so both panels share the same scale.
function StrainHeartModel({
  segments,
  selectedStrainType,
  selectedSegment3d,
  min,
  max,
  reverseColors,
  reconstructionMeshUrl,
  reconstructionMeshFormat,
  reconstructionLabels,
  onReconstructionSegmentClick,
}: {
  segments: RealStrainSegment[];
  selectedStrainType: StrainType;
  selectedSegment3d: number;
  min: number;
  max: number;
  reverseColors: boolean;
  reconstructionMeshUrl?: string | null;
  reconstructionMeshFormat?: "obj" | "glb";
  reconstructionLabels?: number[] | null;
  onReconstructionSegmentClick?: (segment: number) => void;
}) {
  // Build 17-element values array (0-indexed matching HEART_SEGMENTS order)
  const values = Array.from({ length: 17 }, (_, i) => {
    const seg = segments[i];
    if (!seg) return 0;
    return (selectedStrainType === "GRS" ? seg.grs : seg.gcs) ?? 0;
  });
  const [heartTooltip, setHeartTooltip] = useState<{ x: number; y: number; segment: number } | null>(null);
  if (reconstructionMeshUrl && reconstructionMeshFormat && reconstructionLabels?.length) {
    return (
      <div className="w-full h-full relative">
        <ReconstructedHeartModel
          meshUrl={reconstructionMeshUrl}
          meshFormat={reconstructionMeshFormat}
          segmentLabels={reconstructionLabels}
          colorMode="strain"
          values={values}
          min={min}
          max={max}
          reverseColors={reverseColors}
          className="w-full h-full"
          selectedSegment={selectedSegment3d >= 0 ? selectedSegment3d + 1 : -1}
          onSegmentClick={onReconstructionSegmentClick}
          onSegmentHover={setHeartTooltip}
        />
        {heartTooltip && (
          <div
            className="fixed z-50 pointer-events-none rounded px-2 py-1 text-xs bg-black/85 text-white border border-white/20 shadow-lg"
            style={{ left: heartTooltip.x + 14, top: heartTooltip.y - 10 }}
          >
            <div className="font-semibold">
              {segments[heartTooltip.segment - 1]?.label ?? `Segment ${heartTooltip.segment}`}
            </div>
            <div>{(values[heartTooltip.segment - 1] ?? 0).toFixed(1)}%</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full relative flex flex-col items-center justify-center gap-3 px-4 text-center text-muted-foreground">
      <AlertCircle className="h-8 w-8 opacity-40" />
      <p className="max-w-[240px] text-xs leading-relaxed">
        Please run <span className="font-medium text-foreground">MedSAM</span> or{" "}
        <span className="font-medium text-foreground">U-Net</span> 4D reconstruction to access this.
      </p>
    </div>
  );
}

function StrainPreviewPanel({
  selectedStrainType,
  currentFrame,
  selectedSegment,
  onSelectSegment,
  avgLm1,
  strainResult,
  onStrainResult,
  rvStrainResult,
  onRvStrainResult,
  activeModel,
  edFrameIdx,
  esFrameIdx,
  rvMetricType,
  computeScope,
  isComputeBusy,
}: {
  selectedStrainType: StrainType;
  currentFrame: number;
  selectedSegment: number | null;
  onSelectSegment: (segment: number) => void;
  avgLm1: { x: number; y: number } | null;
  strainResult: RealStrainResult | null;
  onStrainResult: (result: RealStrainResult | null) => void;
  rvStrainResult: RvStrainResult | null;
  onRvStrainResult: (result: RvStrainResult | null) => void;
  activeModel: "unet" | "medsam";
  edFrameIdx: number;
  esFrameIdx: number;
  /** RV's own metric selection (GCS/GAS), chosen from the sidebar's Strain
   *  tab. GAS has no computation at all yet, so it renders the RV side of
   *  the bullseye as an explicit "not computed" prototype state rather than
   *  colored — see the rvRegions={null} branch below. */
  rvMetricType: "GCS" | "GAS";
  /** Which compute mode is selected in the sidebar's "Compute strain" card —
   *  determines whether this panel colors itself from the single ED->ES
   *  result (quick) or from the per-frame full-cycle series at the currently
   *  scrubbed frame (full). */
  computeScope: "quick" | "full";
  /** A (re)compute is running right now (Quick's isComputing, or Full
   *  cycle's seriesBusy reported up) — shows a loading state over the
   *  bullseye/3D heart and their stat tiles instead of the now-stale values. */
  isComputeBusy: boolean;
}) {
  // Compute controls (frame/upload pickers, model select, the actual
  // compute calls) live in the sidebar's "Compute strain" card now — this
  // panel is visualization-only (bullseye + 3D heart), driven by the
  // edFrameIdx/esFrameIdx/strainResult/rvStrainResult the parent lifted so
  // both trees agree on what's selected and what's been computed.
  const strainModel = activeModel;
  const realStrainData = strainResult;
  const isFullCycle = computeScope === "full";

  // Full-cycle per-frame series — a separate subscription from the sidebar's
  // own useProjectResults call (safe: the hook just reads/caches the mask
  // doc), so this panel can color itself from the SAME per-frame series the
  // sidebar's Full-cycle scope computed, at whichever frame is scrubbed.
  const { projectId: fullCycleProjectId } = useParams<{ projectId: string }>();
  const {
    strainSeries: realSeries,
    rvStrainSeries: realRvSeries,
    setModel: setFullCycleResultsModel,
  } = useProjectResults(fullCycleProjectId);
  useEffect(() => { setFullCycleResultsModel(strainModel); }, [strainModel, setFullCycleResultsModel]);

  const { getReconstructionGLB, reconstructionsByModel } = useProject();
  const activeReconstruction = reconstructionsByModel?.[strainModel] ?? null;

  // RV side of the 3D Heart toggle: real mesh + real segment boundaries,
  // colored by segment identity — see useRvPrototypeMesh's docstring.
  // Independent of the LV reconstruction above; RV has its own reconstruction record.
  const rvMesh = useRvPrototypeMesh(strainModel, currentFrame);

  const [reconstructionMeshUrl, setReconstructionMeshUrl] = useState<string | null>(null);
  // Reset ONLY when switching to a genuinely different reconstruction/model - not on
  // every frame change, otherwise fast playback spends most of its time with the mesh
  // nulled out while each fetch is still in flight (the flicker/disappearing bug).
  useEffect(() => {
    setReconstructionMeshUrl(null);
  }, [activeReconstruction?.reconstructionId, strainModel]);

  useEffect(() => {
    let cancelled = false;
    if (!activeReconstruction?.reconstructionId || !Array.isArray(activeReconstruction?.ahaVertexLabels)) {
      return;
    }
    (async () => {
      const url = await getReconstructionGLB(currentFrame, strainModel, activeReconstruction.reconstructionId);
      // Swap in directly, without nulling first - keeps the previous frame's mesh
      // visible until the new one is ready, so rapid playback doesn't flash empty.
      if (!cancelled) setReconstructionMeshUrl(url);
    })();
    return () => { cancelled = true; };
  }, [activeReconstruction, strainModel, getReconstructionGLB, currentFrame]);

  // Per-frame AHA labels for whichever frame's geometry is currently loaded above -
  // each frame's own mesh has its own vertex layout, so labels can't be reused
  // across frames. Falls back to ED-only labels for older reconstructions.
  const reconstructionLabels = useMemo(() => {
    const perFrame = activeReconstruction?.frameAhaVertexLabels?.[String(currentFrame)];
    if (Array.isArray(perFrame)) return perFrame;
    return Array.isArray(activeReconstruction?.ahaVertexLabels) ? activeReconstruction.ahaVertexLabels : null;
  }, [activeReconstruction, currentFrame]);

  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; value: number | null } | null>(null);
  const bullseyeResetRef = useRef<(() => void) | null>(null);
  // Combined/RV aren't backed by real data yet (no RV mesh from the backend) —
  // see ChamberFocusToggle's docstring. Only "LV" renders the real model.
  const [chamberFocus, setChamberFocus] = useState<ChamberFocus>("LV");
  // 0-based segment index for the 3D heart (-1 = none). Kept in sync with the
  // parent's 1-based selectedSegment via handleSegClick below.
  const [selectedSeg3d, setSelectedSeg3d] = useState(-1);
  // Selection state for the RV crescent — kept separate from the LV's
  // selectedSegment (1-17) since RV region numbers (1-6) would otherwise
  // collide visually with LV segment numbers in the same 1-based range.
  const [selectedRvRegion, setSelectedRvRegion] = useState<number | null>(null);
  const [rvHeartTooltip, setRvHeartTooltip] = useState<{ x: number; y: number; segment: number } | null>(null);

  const strainMatchesSelection = !!(
    realStrainData?.computedFor &&
    realStrainData.computedFor.mode !== "full-cycle" &&
    realStrainData.computedFor.model === strainModel &&
    (realStrainData.computedFor.mode === "upload" ||
      (realStrainData.computedFor.edFrameIndex === edFrameIdx &&
        realStrainData.computedFor.esFrameIndex === esFrameIdx))
  );
  const rvStrainMatchesSelection = !!(
    rvStrainResult?.computedFor &&
    rvStrainResult.computedFor.mode !== "full-cycle" &&
    rvStrainResult.computedFor.model === strainModel &&
    (rvStrainResult.computedFor.mode === "upload" ||
      (rvStrainResult.computedFor.edFrameIndex === edFrameIdx &&
        rvStrainResult.computedFor.esFrameIndex === esFrameIdx))
  );

  // Full cycle: color from the per-frame series at whichever frame is
  // currently scrubbed — this is what was missing before (the bullseye/3D
  // heart only ever read the Quick ED->ES result, so switching to Full cycle
  // and running "Compute all frames" never changed what was displayed here).
  const fullCycleFrame = isFullCycle ? realSeries?.frames?.find((f) => f.frameIndex === currentFrame) ?? null : null;
  const fullCycleRvFrame = isFullCycle ? realRvSeries?.frames?.find((f) => f.frameIndex === currentFrame) ?? null : null;

  const strainForDisplay: RealStrainResult | null = isFullCycle
    ? (fullCycleFrame ? {
        segments: fullCycleFrame.segments.map((s) => ({ segment: s.segment, label: s.label, grs: s.grs, gcs: s.gcs })),
        global_grs: fullCycleFrame.global_grs,
        global_gcs: fullCycleFrame.global_gcs,
        ed_wt_mean_mm: null,
        es_wt_mean_mm: null,
        vox_xy_mm: 0,
        alignment_source: "stored",
        edFrameIndex: realSeries?.edFrameIndex,
        source: "frames",
        computedFor: { mode: "full-cycle", model: strainModel, edFrameIndex: realSeries?.edFrameIndex ?? 0 },
      } : null)
    : (strainMatchesSelection ? realStrainData : null);

  const rvStrainForDisplay: RvStrainResult | null = isFullCycle
    ? (fullCycleRvFrame ? {
        regions: fullCycleRvFrame.regions,
        global_rv_strain: fullCycleRvFrame.global_rv_strain,
        vox_xy_mm: 0,
        alignment_source: "stored",
        edFrameIndex: realRvSeries?.edFrameIndex,
        source: "frames",
        computedFor: { mode: "full-cycle", model: strainModel, edFrameIndex: realRvSeries?.edFrameIndex ?? 0 },
      } : null)
    : (rvStrainMatchesSelection ? rvStrainResult : null);

  const displayData = strainForDisplay
    ? strainForDisplay.segments.map((s) => ({
        segment: s.segment,
        label:   s.label,
        strain:  selectedStrainType === "GRS" ? (s.grs ?? 0) : (s.gcs ?? 0),
      }))
    : [];

  // Shared colour scale — computed once and passed to both 2D and 3D panels so
  // the same strain value maps to the same colour in both views.
  const strainVals = strainForDisplay
    ? strainForDisplay.segments
        .map((s) => (selectedStrainType === "GRS" ? s.grs : s.gcs) ?? NaN)
        .filter((v) => Number.isFinite(v))
    : [];
  const sharedMin = strainVals.length ? Math.min(...strainVals) : -30;
  const sharedMax = strainVals.length ? Math.max(...strainVals) : 80;
  const reverseColors = selectedStrainType === "GCS";

  // handle segment click — toggle selection.
  // seg is 1-based (from the 2D bullseye). The 3D heart expects 0-based.
  const handleSegClick = (seg: number) => {
    const isDeselect = selectedSegment === seg;
    onSelectSegment(isDeselect ? -1 as any : seg);
    setSelectedSeg3d(isDeselect ? -1 : seg - 1);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
        {/* GRS/GCS (and RV's GCS/GAS) are chosen from the sidebar's Strain tab
            now — this panel just displays whatever metric is currently
            selected there, so there's no second toggle here to fall out of
            sync with it. Labeled per-chamber (not a bare "GCS") since LV and
            RV each have their own independent metric toggle in the sidebar —
            this one never flips when you switch RV's toggle, by design. */}
        <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
          LV {selectedStrainType}
        </span>
        {/* RV is always labeled Prototype first — GCS is real but has no
            published reference range, GAS has no computation at all. */}
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-400">
          Prototype — RV {rvMetricType}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Source badge — only when real data exists */}
          {(realStrainData || rvStrainResult) && (
            <span className="rounded-full px-2 py-0.5 text-[9px] font-medium shrink-0 bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400">
              {avgLm1 ? "Real · Aligned" : "Real"}
            </span>
          )}

          {/* Clear strain result — compute/recompute controls live in the
              sidebar's Strain tab "Compute strain" card now. */}
          {(realStrainData || rvStrainResult) && (
            <button type="button" onClick={() => { onStrainResult(null); onRvStrainResult(null); }}
              className="rounded border border-destructive/40 bg-background px-1.5 py-0.5 text-[9px] text-destructive hover:bg-destructive/10 transition-colors shrink-0">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Main area ── */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      {isComputeBusy && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-background/80 backdrop-blur-sm">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-xs font-medium text-muted-foreground">
            {computeScope === "quick" ? "Computing…" : "Computing all frames…"}
          </p>
        </div>
      )}
      {!strainForDisplay && !rvStrainForDisplay ? (
        /* Prompt — shown when neither LV nor RV strain matches the current
           Choose-Frames selection. Two distinct causes get distinct copy:
           nothing has ever been computed, vs. something exists but it's for
           a different mode/model/frame-pair (e.g. a full-cycle result, or a
           choose-frames result for a pair the user has since changed) — see
           strainMatchesSelection/rvStrainMatchesSelection above. */
        <div className="flex flex-1 items-center justify-center min-h-[320px]">
          <div className="flex flex-col items-center gap-3 text-center max-w-xs">
            <div className="rounded-full border-2 border-dashed border-muted-foreground/30 p-5 mb-2">
              <Heart className="w-8 h-8 text-muted-foreground/50" />
            </div>
            {(realStrainData || rvStrainResult) ? (
              <>
                <p className="font-semibold text-sm text-foreground">
                  No result for this selection yet
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  A strain result exists, but not for the ED/ES frames and model currently
                  selected here (it may be a full-cycle result, or was computed for a
                  different pair). Use the sidebar&apos;s Strain tab to compute this pair.
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold text-sm text-foreground">
                  No strain computed yet
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Use the <strong>Compute strain</strong> card in the sidebar&apos;s Strain tab to
                  compute LV and RV strain together from this project&apos;s already-saved
                  segmentation, or upload your own ED/ES masks in NIfTI format (.nii or .nii.gz;
                  classes 0=background, 1=RV, 2=myocardium, 3=LV cavity) for manually-verified
                  LV accuracy.
                </p>
              </>
            )}
          </div>
        </div>
      ) : (
        /* 2-panel layout: LEFT combined LV+RV bullseye / RIGHT 3D heart (LV only —
           see CombinedVentricularChart for why the RV side has no 3D counterpart) */
        <div className="flex min-h-0 flex-1 gap-2 p-2.5">

          {/* LEFT: combined 2D bullseye */}
          <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-slate-50 dark:bg-zinc-900 p-2">
            <div className="mb-1 flex items-center justify-between flex-shrink-0">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                {chamberFocus === "combined" ? "LV + RV Bullseye" : chamberFocus === "LV" ? "LV Bullseye" : "RV Bullseye"}
              </p>
              <div className="flex items-center gap-1">
                {chamberFocus !== "RV" && (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                    LV {selectedStrainType}
                  </span>
                )}
                {chamberFocus !== "LV" && (
                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-400">
                    Prototype — RV {rvMetricType}
                  </span>
                )}
              </div>
            </div>
            <StrainZoomPan className="flex-1 min-h-0 w-full" onResetRef={(fn) => { bullseyeResetRef.current = fn; }}>
              <CombinedVentricularChart
                lvData={displayData}
                hasLv={!!strainForDisplay}
                strainType={selectedStrainType}
                selectedSegment={selectedSegment}
                onSegmentClick={handleSegClick}
                onSegmentHover={setTooltip}
                sharedMin={sharedMin}
                sharedMax={sharedMax}
                reverseColors={reverseColors}
                rvRegions={rvMetricType === "GCS" ? (rvStrainForDisplay?.regions ?? null) : null}
                selectedRvRegion={selectedRvRegion}
                onRvRegionClick={(region) => setSelectedRvRegion((prev) => (prev === region ? null : region))}
                onRvRegionHover={setTooltip}
                showLv={chamberFocus !== "RV"}
                showRv={chamberFocus !== "LV"}
              />
            </StrainZoomPan>
            {/* Colour legend */}
            <div className="flex flex-wrap items-center justify-center gap-2 text-[8.5px] text-muted-foreground pt-1 flex-shrink-0">
              {[["#15803d","Excellent"],["#22c55e","Good"],["#eab308","Fair"],["#f97316","Reduced"],["#dc2626","Poor"]].map(([c, l]) => (
                <span key={l} className="inline-flex items-center gap-0.5">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: c }} />{l}
                </span>
              ))}
            </div>
            {rvMetricType === "GAS" ? (
              <div className="mt-1 flex-shrink-0 rounded-md border border-dashed border-amber-500/40 bg-amber-500/10 px-2 py-1 text-center">
                <p className="text-[8.5px] leading-snug text-amber-700 dark:text-amber-400">
                  RV GAS has no computation in this pipeline yet — switch to RV GCS for computed (still prototype) values.
                </p>
              </div>
            ) : (!isFullCycle && rvStrainForDisplay) && (
              /* ED->ES-specific stat row — Full cycle shows its own per-frame
                 aggregate stats in the sidebar instead, so this stays Quick-only. */
              <div className="grid grid-cols-2 gap-1 pt-1 flex-shrink-0">
                <div className="rounded border border-border bg-background px-1.5 py-1 text-center">
                  <p className="text-[8px] text-muted-foreground">Prototype — RV GCS</p>
                  {isComputeBusy ? (
                    <div className="mx-auto mt-0.5 h-3.5 w-10 animate-pulse rounded bg-muted-foreground/20" />
                  ) : (
                    <p className="font-bold text-[10px]">
                      {rvStrainForDisplay.global_rv_strain != null ? `${rvStrainForDisplay.global_rv_strain.toFixed(1)}%` : "N/A"}
                    </p>
                  )}
                  <p className="text-[7px] text-muted-foreground">Negative = shrinking (healthy)</p>
                </div>
                <div className="rounded border border-border bg-background px-1.5 py-1 text-center">
                  <p className="text-[8px] text-muted-foreground">RV Frames</p>
                  <p className="font-bold text-[10px]">{(rvStrainForDisplay.edFrameIndex ?? 0) + 1}→{(rvStrainForDisplay.esFrameIndex ?? 0) + 1}</p>
                  <p className="text-[7px] text-muted-foreground capitalize">{rvStrainForDisplay.alignment_source ?? "—"} alignment</p>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: real 3D heart coloured by LV strain */}
          <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-slate-50 dark:bg-zinc-900 overflow-hidden p-2">
            <div className="mb-1 flex items-center justify-between flex-shrink-0">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                3D Heart {chamberFocus === "combined" ? "(LV + RV)" : `(${chamberFocus})`}
              </p>
              <div className="flex items-center gap-1">
                {chamberFocus === "RV" && (
                  <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-400">
                    Prototype
                  </span>
                )}
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">Synced</span>
              </div>
            </div>
            <ChamberFocusToggle value={chamberFocus} onChange={setChamberFocus} className="mb-2 flex-shrink-0" />
            {chamberFocus === "RV" && rvMesh.available && rvMesh.meshUrl ? (
              <>
                <div className="flex-1 min-h-0 w-full relative">
                  <ReconstructedHeartModel
                    meshUrl={rvMesh.meshUrl}
                    meshFormat={rvMesh.meshFormat}
                    segmentLabels={rvMesh.segmentLabels}
                    colorMode="rv-segment"
                    chamber="rv"
                    className="w-full h-full"
                    onSegmentHover={setRvHeartTooltip}
                  />
                  {rvHeartTooltip && (
                    <div
                      className="fixed z-50 pointer-events-none rounded px-2 py-1 text-xs bg-black/85 text-white border border-white/20 shadow-lg"
                      style={{ left: rvHeartTooltip.x + 14, top: rvHeartTooltip.y - 10 }}
                    >
                      <div className="font-semibold">
                        {RV_SEGMENT_NAMES[rvHeartTooltip.segment] ?? `Segment ${rvHeartTooltip.segment}`}
                      </div>
                    </div>
                  )}
                </div>
                <p className="text-center text-[9px] text-muted-foreground pt-1 flex-shrink-0">
                  Drag to rotate · scroll to zoom
                </p>
                <RvGlobalStrainMiniBlock result={rvStrainForDisplay} loading={isComputeBusy} />
              </>
            ) : chamberFocus === "combined" && reconstructionMeshUrl && reconstructionLabels?.length && rvMesh.available && rvMesh.meshUrl ? (
              <>
                <div className="flex-1 min-h-0 w-full">
                  <CombinedHeartModel
                    lvMeshUrl={reconstructionMeshUrl}
                    lvMeshFormat={activeReconstruction?.meshFormat?.toLowerCase() === "obj" ? "obj" : "glb"}
                    lvSegmentLabels={reconstructionLabels}
                    lvValues={strainForDisplay ? Array.from({ length: 17 }, (_, i) => {
                      const seg = strainForDisplay.segments[i];
                      return seg ? (selectedStrainType === "GRS" ? seg.grs : seg.gcs) ?? 0 : 0;
                    }) : undefined}
                    lvMin={sharedMin}
                    lvMax={sharedMax}
                    lvReverseColors={reverseColors}
                    rvMeshUrl={rvMesh.meshUrl}
                    rvMeshFormat={rvMesh.meshFormat}
                    rvSegmentLabels={rvMesh.segmentLabels}
                    className="w-full h-full"
                  />
                </div>
                <p className="text-center text-[9px] text-muted-foreground pt-1 flex-shrink-0">
                  Drag to rotate · scroll to zoom — LV colored by {selectedStrainType}, RV by segment identity (prototype)
                </p>
                {!isFullCycle ? (
                  <div className="grid grid-cols-2 gap-1 pt-1 flex-shrink-0">
                    {strainForDisplay && <LvGlobalStrainMiniBlock result={strainForDisplay} loading={isComputeBusy} />}
                    <RvGlobalStrainMiniBlock result={rvStrainForDisplay} loading={isComputeBusy} />
                  </div>
                ) : (
                  <p className="px-4 text-center text-[10px] text-muted-foreground">
                    Full-cycle per-frame stats are shown in the sidebar&apos;s Strain tab instead.
                  </p>
                )}
              </>
            ) : chamberFocus !== "LV" ? (
              <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-y-auto px-1 py-1">
                <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-3 text-center text-muted-foreground">
                  <AlertCircle className="h-6 w-6 opacity-40" />
                  <p className="max-w-[240px] text-[10px] leading-relaxed">
                    {chamberFocus === "RV"
                      ? "No RV reconstruction built yet for this model"
                      : "Combined view needs both an LV and an RV reconstruction for this model"} — showing values only.
                  </p>
                </div>
                {/* Quick ED->ES has one pair for both chambers, so the values
                    are always available here even without a mesh. Full cycle's
                    equivalent stats live in the sidebar instead (see the gate
                    on the LV tab's KPI grid below). */}
                {!isFullCycle ? (
                  <>
                    {chamberFocus === "combined" && strainForDisplay && (
                      <LvGlobalStrainMiniBlock result={strainForDisplay} loading={isComputeBusy} />
                    )}
                    <RvGlobalStrainMiniBlock result={rvStrainForDisplay} loading={isComputeBusy} />
                  </>
                ) : (
                  <p className="px-4 text-center text-[10px] text-muted-foreground">
                    Full-cycle per-frame stats are shown in the sidebar&apos;s Strain tab instead.
                  </p>
                )}
              </div>
            ) : strainForDisplay ? (
              <>
                <div className="flex-1 min-h-0 w-full">
                  <StrainHeartModel
                    segments={strainForDisplay.segments}
                    selectedStrainType={selectedStrainType}
                    selectedSegment3d={selectedSeg3d}
                    min={sharedMin}
                    max={sharedMax}
                    reverseColors={reverseColors}
                    reconstructionMeshUrl={reconstructionMeshUrl}
                    reconstructionMeshFormat={activeReconstruction?.meshFormat?.toLowerCase() === "obj" ? "obj" : "glb"}
                    reconstructionLabels={reconstructionLabels}
                    onReconstructionSegmentClick={handleSegClick}
                  />
                </div>
                <p className="text-center text-[9px] text-muted-foreground pt-1 flex-shrink-0">
                  Drag to rotate · scroll to zoom
                </p>
                {/* ED->ES-specific KPIs — only meaningful for the Quick scope's
                    single computed pair; Full cycle shows its own per-frame
                    aggregate stats in the sidebar instead. */}
                {!isFullCycle && (
                  <div className="grid grid-cols-2 gap-1 pt-1 flex-shrink-0">
                    <div className="rounded border border-border bg-background px-1.5 py-1 text-center">
                      <p className="text-[8px] text-muted-foreground">Peak GRS</p>
                      {isComputeBusy ? (
                        <div className="mx-auto mt-0.5 h-3.5 w-10 animate-pulse rounded bg-muted-foreground/20" />
                      ) : (
                        <p className={cn("font-bold text-[10px]",
                          strainForDisplay.global_grs !== null && strainForDisplay.global_grs >= 40 ? "text-green-600" : "text-orange-500")}>
                          {strainForDisplay.global_grs != null ? `${strainForDisplay.global_grs >= 0 ? "+" : ""}${strainForDisplay.global_grs.toFixed(1)}%` : "N/A"}
                        </p>
                      )}
                      <p className="text-[7px] text-muted-foreground">Normal &gt;+40%</p>
                    </div>
                    <div className="rounded border border-border bg-background px-1.5 py-1 text-center">
                      <p className="text-[8px] text-muted-foreground">Peak GCS</p>
                      {isComputeBusy ? (
                        <div className="mx-auto mt-0.5 h-3.5 w-10 animate-pulse rounded bg-muted-foreground/20" />
                      ) : (
                        <p className={cn("font-bold text-[10px]",
                          strainForDisplay.global_gcs !== null && strainForDisplay.global_gcs >= -25 && strainForDisplay.global_gcs <= -15 ? "text-green-600" : "text-orange-500")}>
                          {strainForDisplay.global_gcs != null ? `${strainForDisplay.global_gcs.toFixed(1)}%` : "N/A"}
                        </p>
                      )}
                      <p className="text-[7px] text-muted-foreground">Normal -15% to -25%</p>
                    </div>
                    <div className="rounded border border-border bg-background px-1.5 py-1 text-center">
                      <p className="text-[8px] text-muted-foreground">
                        {strainForDisplay.source === "frames" ? `Frame ${(strainForDisplay.edFrameIndex ?? 0) + 1} WT` : "ED WT"}
                      </p>
                      {isComputeBusy ? (
                        <div className="mx-auto mt-0.5 h-3.5 w-10 animate-pulse rounded bg-muted-foreground/20" />
                      ) : (
                        <p className="font-bold text-[10px]">{strainForDisplay.ed_wt_mean_mm?.toFixed(2) ?? "—"} mm</p>
                      )}
                    </div>
                    <div className="rounded border border-border bg-background px-1.5 py-1 text-center">
                      <p className="text-[8px] text-muted-foreground">
                        {strainForDisplay.source === "frames" ? `Frame ${(strainForDisplay.esFrameIndex ?? 0) + 1} WT` : "ES WT"}
                      </p>
                      {isComputeBusy ? (
                        <div className="mx-auto mt-0.5 h-3.5 w-10 animate-pulse rounded bg-muted-foreground/20" />
                      ) : (
                        <p className="font-bold text-[10px]">{strainForDisplay.es_wt_mean_mm?.toFixed(2) ?? "—"} mm</p>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-center px-4">
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  {activeReconstruction?.reconstructionId
                    ? `${strainModel === "unet" ? "UNet" : "MedSAM"} reconstruction found — click Compute Strain to view the 3D heart.`
                    : `No LV strain yet — run ${strainModel === "unet" ? "UNet" : "MedSAM"} 4D reconstruction first. RV-only results show on the left.`}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
      </div>

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded px-2 py-1 text-xs bg-black/85 text-white border border-white/20 shadow-lg"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}>
          <div className="font-semibold">{tooltip.label}</div>
          <div>
            {tooltip.value == null
              ? "No data"
              : `${tooltip.value > 0 ? "+" : ""}${tooltip.value.toFixed(1)}%`}
          </div>
        </div>
      )}
    </div>
  );
}

/** Small neutral stat tile — no color-coding, for values that aren't a
 *  strain % (wall thickness in mm, cavity area). */
function KpiTile({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <div className="rounded border border-border bg-background px-1.5 py-1 text-center">
      <p className="text-[8px] text-muted-foreground">{label}</p>
      {loading ? (
        <div className="mx-auto mt-0.5 h-3 w-10 animate-pulse rounded bg-muted-foreground/20" />
      ) : (
        <p className="font-bold text-[10px]">{value}</p>
      )}
    </div>
  );
}

/** Quick ED->ES's LV summary — shown in the 3D-heart panel's Combined tab
 *  (LV tab already shows this inline alongside the mesh). */
function LvGlobalStrainMiniBlock({ result, loading }: { result: RealStrainResult; loading?: boolean }) {
  const fmt = (v: number | null) => (v == null ? "N/A" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
  return (
    <div>
      <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">LV Global Strain</p>
      <div className="grid grid-cols-2 gap-1">
        <KpiTile label="Peak GRS" value={fmt(result.global_grs)} loading={loading} />
        <KpiTile label="Peak GCS" value={fmt(result.global_gcs)} loading={loading} />
        <KpiTile label={`Frame ${(result.edFrameIndex ?? 0) + 1} WT`} value={result.ed_wt_mean_mm != null ? `${result.ed_wt_mean_mm.toFixed(2)} mm` : "—"} loading={loading} />
        <KpiTile label={`Frame ${(result.esFrameIndex ?? 0) + 1} WT`} value={result.es_wt_mean_mm != null ? `${result.es_wt_mean_mm.toFixed(2)} mm` : "—"} loading={loading} />
      </div>
    </div>
  );
}

/** Quick ED->ES's RV summary — GCS is real but unvalidated, GAS/area are
 *  entirely fabricated placeholders — every value here is labeled Prototype. */
function RvGlobalStrainMiniBlock({ result, loading }: { result: RvStrainResult | null; loading?: boolean }) {
  const fmt = (v: number | null | undefined) => (v == null ? "N/A" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
  return (
    <div>
      <p className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[7px] font-bold text-amber-700 dark:text-amber-400">Prototype</span>
        RV Global Strain
      </p>
      <div className="grid grid-cols-2 gap-1">
        <KpiTile label="Peak GCS" value={fmt(result?.global_rv_strain)} loading={loading} />
        <KpiTile label="Peak GAS" value="—" />
        <KpiTile label={`Frame ${(result?.edFrameIndex ?? 0) + 1} area`} value="—" />
        <KpiTile label={`Frame ${(result?.esFrameIndex ?? 0) + 1} area`} value="—" />
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
  const segGuided = n2ch ?? 0;
  const mriOnly = n1chFallback ?? 0;
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
      <span>
        <span className="font-medium text-blue-500">{segGuided}/{nTotal}</span>
        {" seg-guided (2ch)"}
      </span>
      <span>
        <span className="font-medium text-amber-500">{mriOnly}/{nTotal}</span>
        {" MRI-only (1ch)"}
      </span>
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
