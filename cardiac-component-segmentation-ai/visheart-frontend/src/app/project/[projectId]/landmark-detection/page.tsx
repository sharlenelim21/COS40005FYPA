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
  Download,
  FileText,
  ArrowLeft,
  Activity,
  ZoomIn,
  ZoomOut,
  Upload,
  Stethoscope,
  X,
  Save,
} from "lucide-react";

import { useProject } from "@/context/ProjectContext";
import { useProjectResults } from "@/hooks/useProjectResults";
import { downloadResultsCsv } from "@/lib/exportResultsCsv";
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
import { ClientHeartModel } from "@/components/landmark/ClientHeartModel";
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
import {
  StrainBullseyeChart,
  getDummyStrainData,
  ZoomPanContainer as StrainZoomPan,
  type StrainType,
  type RealStrainResult,
  type RealStrainSegment,
} from "@/components/landmark/StrainVisualization";
import { landmarkApi, computeStrainFromFrames } from "@/lib/landmarkApi";

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
  const workspace: "landmarks" | "strain" =
    searchParams.get("tab") === "strain" ? "strain" : "landmarks";
  const activeModel: "unet" | "medsam" =
    searchParams.get("model") === "medsam" ? "medsam" : "unet";

  const updateUrlState = useCallback(
    (next: { tab?: "landmarks" | "strain"; model?: "unet" | "medsam" }) => {
      const params = new URLSearchParams(window.location.search);
      if (next.tab) params.set("tab", next.tab);
      if (next.model) params.set("model", next.model);
      router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
    },
    [router],
  );
  const setWorkspace = useCallback(
    (tab: "landmarks" | "strain") => updateUrlState({ tab }),
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
  const [segFrameCount, setSegFrameCount] = useState(0);
  const [availableBullseyeModels, setAvailableBullseyeModels] = useState<{ medsam: boolean; unet: boolean }>({ medsam: false, unet: false });
  // Tracks whether the editable mask itself exists (independent of whether bullseye is computed)
  const [existingSegModels, setExistingSegModels] = useState<{ medsam: boolean; unet: boolean }>({ medsam: false, unet: false });
  const [calculatingModels, setCalculatingModels] = useState<{ medsam: boolean; unet: boolean }>({ medsam: false, unet: false });
  const [calcCountdown, setCalcCountdown] = useState(15);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [leftPanelView, setLeftPanelView] = useState<"bullseye" | "strain">(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash;
      if (hash === "#strain") return "strain";
    }
    return "bullseye";
  });
  const [selectedStrainType, setSelectedStrainType] = useState<StrainType>("GRS");
  const [selectedStrainSegment, setSelectedStrainSegment] = useState<number | null>(null);
  const [strainResult, setStrainResult] = useState<RealStrainResult | null>(null);
  // Auto-detected ED/ES frames from heart-metrics (ED = largest LV cavity, ES =
  // smallest), PER MODEL — each model's mask has its own independently-detected
  // ED/ES. The strain picker must use the frames from the SAME model it computes
  // with, so peaks match heartMetrics and the similarity guard passes.
  const [autoFramesByModel, setAutoFramesByModel] = useState<{
    unet: { ed: number; es: number } | null;
    medsam: { ed: number; es: number } | null;
  }>({ unet: null, medsam: null });
  const [editableLandmarks, setEditableLandmarks] = useState(true);
  const [highlightedLandmarkId, setHighlightedLandmarkId] = useState<string | null>(null);
  const [landmarkEdits, setLandmarkEdits] = useState<Record<string, Partial<FramePrediction>>>({});
  const [isSavingLandmarks, setIsSavingLandmarks] = useState(false);
  const [hasUnsavedLandmarkEdits, setHasUnsavedLandmarkEdits] = useState(false);
  // True while the bullseye is being recomputed after a landmark-edit save, so
  // the UI can show a "recomputing" hint instead of the stale chart.
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
      type SegItem = { _id?: string; name?: string; isMedSAMOutput: boolean; bullseye?: BullseyeData; strain?: RealStrainResult; heartMetrics?: { ed_frame?: number; es_frame?: number } };
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
        // Don't switch the active model here — activeModel (from the URL) is the
        // single source of truth; this only loads that model's bullseye data.
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

  // Zoom reset refs — shared between bullseye panel and toolbar button
  const bullseyeZoomResetRef = useRef<(() => void) | null>(null);
  const heartZoomResetRef = useRef<(() => void) | null>(null);

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
    const frames = bullseyeSeries?.frames;
    if (!frames?.length) return null;
    const frame =
      frames.find((f) => f.frameIndex === strainPlaybackFrame) ?? frames[0];
    const vals = Array.from({ length: 17 }, (_, i) => {
      const seg = frame.segments?.find((s) => s.segment === i + 1);
      return typeof seg?.wt_mm === "number" ? seg.wt_mm : null;
    });
    // Older series predate wt_mm — fall back to the static bullseye rather than
    // rendering a plot full of gaps.
    return vals.every((v) => v === null) ? null : vals;
  }, [bullseyeSeries, strainPlaybackFrame]);

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
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              disabled={!resultsByModel?.unet && !resultsByModel?.medsam}
              onClick={() => {
                if (!resultsByModel?.unet && !resultsByModel?.medsam) {
                  alert("No computed results to export yet. Run metrics and strain first.");
                  return;
                }
                downloadResultsCsv(projectData?.name || String(projectId), resultsByModel);
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
            onStrainFrameChange={setStrainPlaybackFrame}
            onTabChange={setWorkspace}
            activeTab={workspace}
            activeModel={activeModel}
            onModelChange={(m) => { setActiveModel(m); fetchBullseye(m); }}
            hasUnsavedLandmarkEdits={hasUnsavedLandmarkEdits}
            isSavingLandmarks={isSavingLandmarks}
            onSaveLandmarks={handleSaveLandmarks}
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
      <div className="hidden lg:flex flex-1 min-h-0 p-3">
        {/* Keyed on the workspace: the group caches panel sizes by index, so
            adding/removing the bullseye panel without a remount leaves the
            remaining panels at stale widths. */}
        <ResizablePanelGroup
          key={workspace}
          direction="horizontal"
          className="h-full w-full rounded-xl border shadow-sm"
        >
          {/* Bullseye / 3D heart — only in the Strain workspace. In Landmarks
              the task is editing points on the MRI, so this panel is hidden and
              the viewer takes its space. */}
          {workspace === "strain" && (
          <ResizablePanel defaultSize={78} minSize={40}>
            <div className="w-full h-full bg-background p-4 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-foreground">
                    {leftPanelView === "bullseye" ? "AHA 17-Segment Bullseye" : "Strain Preview"}
                  </h3>
                  <div className="grid grid-cols-2 rounded-lg border border-border bg-background p-0.5">
                    <button
                      type="button"
                      onClick={() => { setLeftPanelView("bullseye"); window.location.hash = "bullseye"; }}
                      className={cn(
                        "rounded-md px-3 py-1.5 text-[10px] font-semibold transition-colors",
                        leftPanelView === "bullseye" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      Bullseye
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLeftPanelView("strain"); window.location.hash = "strain"; }}
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
                        // An explicit choice wins over the auto-pick, including
                        // choosing a model whose series hasn't been run yet.
                        autoPickedSeriesModel.current = true;
                        setSelectedBullseyeModel(model);
                        fetchBullseye(model);
                      }}
                      disabled={bullseyeLoading}
                    >
                      <SelectTrigger
                        size="sm"
                        className="h-7 w-[132px] shrink-0 rounded-lg bg-background px-2 text-[10px] shadow-sm hover:bg-muted/40"
                        aria-label="Select bullseye model"
                      >
                        <SelectValue placeholder="Model" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl p-1 shadow-lg">
                        {/* Selectable whenever the segmentation exists — a model
                            without a per-frame strain series is still worth
                            choosing, and the panel explains what to run. */}
                        <SelectItem
                          value="medsam"
                          disabled={!existingSegModels.medsam || (!isGpuMode && !availableBullseyeModels.medsam)}
                          className="rounded-lg py-1.5 text-xs"
                        >
                          MedSAM{
                            !isGpuMode && !availableBullseyeModels.medsam ? " (GPU only)" :
                            calculatingModels.medsam ? ` (Calculating... ${calcCountdown}s)` :
                            !availableBullseyeModels.medsam ? " (computing…)" :
                            ""
                          }
                        </SelectItem>
                        <SelectItem
                          value="unet"
                          disabled={!existingSegModels.unet}
                          className="rounded-lg py-1.5 text-xs"
                        >
                          UNet{
                            !existingSegModels.unet ? " (no data)" :
                            calculatingModels.unet ? ` (Calculating... ${calcCountdown}s)` :
                            !availableBullseyeModels.unet ? " (computing…)" :
                            " (recommended)"
                          }
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {leftPanelView === "bullseye" && bullseyeRecomputing && (
                    <span className="text-[10px] font-medium text-muted-foreground animate-pulse">
                      Recomputing with edits…
                    </span>
                  )}
                  {leftPanelView === "strain" && (
                    <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
                {/* AHA alignment controls — visible once landmarks are detected */}
                {leftPanelView === "bullseye" && hasPredictions && (
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
              ) : leftPanelView === "bullseye" ? (
                <AhaBullseyePanel
                  bullseyeData={hasPredictions ? bullseyeData : null}
                  loading={hasPredictions ? bullseyeLoading : isRunning}
                  isComputing={bullseyeRecomputing || calculatingModels[activeModel]}
                  referenceAngleDeg={ahaAlignmentAngle ?? 0}
                  onCompute={() => fetchBullseye(selectedBullseyeModel, true)}
                  // Follows the Strain tab's cardiac-cycle playback, not the
                  // slice index — the bullseye is a per-frame view of the cycle.
                  currentFrame={strainPlaybackFrame}
                  frameCount={bullseyeFrameCount}
                  frameThickness={frameThicknessValues}
                  modelLabel={selectedBullseyeModel === "unet" ? "UNet" : "MedSAM"}
                  previewMode={!hasPredictions && !isRunning}
                  onBullseyeResetRef={(fn) => { bullseyeZoomResetRef.current = fn; }}
                  onHeartResetRef={(fn) => { heartZoomResetRef.current = fn; }}
                />
              ) : (
                <StrainPreviewPanel
                  selectedStrainType={selectedStrainType}
                  onStrainTypeChange={setSelectedStrainType}
                  currentFrame={state.currentFrame}
                  frameCount={
                    // Prefer the MASK's actual frame count (segFrameCount) — this is
                    // the same frame set heart-metrics uses to detect ED/ES, so the
                    // auto-detected ED/ES frames are always reachable in the picker
                    // and strain runs at frames that match heartMetrics. Fall back to
                    // project dimensions / total frames only when the mask count is
                    // unknown.
                    segFrameCount > 0
                      ? segFrameCount
                      : (projectData?.dimensions?.frames && projectData.dimensions.frames > 0)
                        ? projectData.dimensions.frames
                        : state.totalFrames || 1
                  }
                  selectedSegment={selectedStrainSegment}
                  onSelectSegment={setSelectedStrainSegment}
                  projectId={projectId}
                  avgLm1={state.avgLm1 ?? null}
                  avgLm2={state.avgLm2 ?? null}
                  strainResult={strainResult}
                  onStrainResult={setStrainResult}
                  autoFramesByModel={autoFramesByModel}
                />
              )}
            </div>
          </ResizablePanel>
          )}

          {/* CENTER: 2D MRI slice viewer + landmark overlay — the Landmarks
              workspace only. Strain is about the cardiac cycle as a whole
              (bullseye / 3D heart / curves), not editing points on a slice. */}
          {workspace === "landmarks" && (
          <ResizablePanel defaultSize={62} minSize={25}>
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
          )}

          <ResizableHandle withHandle />

          {/* RIGHT: Sidebar — present in both workspaces. */}
          <ResizablePanel defaultSize={22} minSize={15} maxSize={35}>
            <div className="h-full w-full">
              <LandmarkSidebar
                state={state}
                currentPrediction={adjustedCurrentPrediction}
                visibleLandmarks={visibleLandmarks}
                replacementFileError={replacementFileError}
                confidentCount={confidentCount}
                onStrainFrameChange={setStrainPlaybackFrame}
            onTabChange={setWorkspace}
            activeTab={workspace}
            activeModel={activeModel}
            onModelChange={(m) => { setActiveModel(m); fetchBullseye(m); }}
            hasUnsavedLandmarkEdits={hasUnsavedLandmarkEdits}
            isSavingLandmarks={isSavingLandmarks}
            onSaveLandmarks={handleSaveLandmarks}
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

function AhaBullseyePanel({
  bullseyeData,
  loading,
  referenceAngleDeg = 0,
  currentFrame = 0,
  frameCount = 1,
  frameThickness = null,
  modelLabel = "this model",
  previewMode = false,
  isComputing = false,
  onCompute,
  onBullseyeResetRef,
  onHeartResetRef,
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
  /** Display name of the model being shown — used in the empty state. */
  modelLabel?: string;
  previewMode?: boolean;
  onCompute?: () => void;
  onBullseyeResetRef?: (fn: () => void) => void;
  onHeartResetRef?: (fn: () => void) => void;
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
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            {/* "Computing" only when the GPU is actually generating the bullseye;
                otherwise we're just loading already-stored data. */}
            <span className="text-xs">{isComputing ? "Computing bullseye…" : "Loading…"}</span>
          </div>
        </div>
      ) : !frameThickness && !previewMode ? (
        /* No per-frame wall thickness for this model — the panel is a
           cardiac-cycle view, so without a series there is nothing to show.
           Rendered as unavailable rather than dimmed so a single static
           measurement can't be mistaken for the animated result. */
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <AlertCircle className="h-6 w-6 text-muted-foreground opacity-40" />
          <p className="text-xs font-medium text-muted-foreground">
            No strain data for {modelLabel}
          </p>
          <p className="max-w-[280px] text-[11px] leading-snug text-muted-foreground">
            Open the <span className="font-medium text-foreground">Strain</span> tab and run{" "}
            <span className="font-medium text-foreground">Compute all frames</span> to measure wall
            thickness across the cardiac cycle for this model.
          </p>
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
  onZoomChange,
  onResetZoom,
}: {
  bullseyeData: BullseyeData;
  currentFrame: number;
  frameCount: number;
  previewMode?: boolean;
  selectedSegment?: number;
  onZoomChange?: (fn: (delta: number) => void) => void;
  onResetZoom?: (fn: () => void) => void;
}) {
  const frameValues = getFrameBullseyeValues(bullseyeData);
  // Use per-frame min/max so the 3D colour scale is identical to the 2D bullseye chart
  const frameMin = Math.min(...frameValues);
  const frameMax = Math.max(...frameValues);

  return (
    <ClientHeartModel
      values={frameValues}
      min={frameMin}
      max={frameMax}
      className="flex-1 min-h-0 w-full"
      selectedSegment={selectedSegment}
      onZoomChange={onZoomChange}
      onResetZoom={onResetZoom}
    />
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
        Lateral
      </text>
      <text x={center} y="290" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">
        Inferior
      </text>
      <text x="2" y={center + 4} textAnchor="start" fontSize="11" fontWeight="700" fill="currentColor">
        Septal
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

// Wraps ClientHeartModel with strain-appropriate colour scale and zoom controls.
// selectedSegment3d is 0-based to match ClientHeartModel's convention.
// min, max, reverseColors are passed from the parent so both panels share the same scale.
function StrainHeartModel({
  segments,
  selectedStrainType,
  selectedSegment3d,
  min,
  max,
  reverseColors,
  onZoomChange,
  onResetZoom,
}: {
  segments: RealStrainSegment[];
  selectedStrainType: StrainType;
  selectedSegment3d: number;
  min: number;
  max: number;
  reverseColors: boolean;
  onZoomChange?: (fn: (delta: number) => void) => void;
  onResetZoom?: (fn: () => void) => void;
}) {
  // Build 17-element values array (0-indexed matching HEART_SEGMENTS order)
  const values = Array.from({ length: 17 }, (_, i) => {
    const seg = segments[i];
    if (!seg) return 0;
    return (selectedStrainType === "GRS" ? seg.grs : seg.gcs) ?? 0;
  });

  return (
    <div className="w-full h-full relative">
      <ClientHeartModel
        values={values}
        min={min}
        max={max}
        reverseColors={reverseColors}
        selectedSegment={selectedSegment3d}
        className="w-full h-full"
        onZoomChange={onZoomChange}
        onResetZoom={onResetZoom}
      />
    </div>
  );
}

/**
 * Dual-handle range picker for ED/ES frame selection — a single track with two
 * draggable handles (hollow = ED, filled = ES), with the interval between them
 * visually filled. Replaces two independent sliders so the ED-to-ES gap is
 * immediately visible. Purely a rendering/interaction layer over the same
 * edFrameIdx/esFrameIdx state StrainPreviewPanel already owns — no new source
 * of truth for frame selection.
 */
function DualFrameRangePicker({
  min,
  max,
  edValue,
  esValue,
  onEdChange,
  onEsChange,
}: {
  min: number;
  max: number;
  edValue: number;
  esValue: number;
  onEdChange: (value: number) => void;
  onEsChange: (value: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingHandle = useRef<"ed" | "es" | null>(null);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const pctFor = (value: number) => (max > min ? ((value - min) / (max - min)) * 100 : 0);

  const valueFromClientX = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return min;
    const rect = track.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    const raw = min + ratio * (max - min);
    return clamp(Math.round(raw));
  }, [min, max]);

  const applyDrag = useCallback((clientX: number) => {
    const handle = draggingHandle.current;
    if (!handle) return;
    const value = valueFromClientX(clientX);
    if (handle === "ed") {
      // ED cannot cross or equal ES.
      onEdChange(Math.min(value, esValue - 1));
    } else {
      // ES cannot cross or equal ED.
      onEsChange(Math.max(value, edValue + 1));
    }
  }, [valueFromClientX, edValue, esValue, onEdChange, onEsChange]);

  // Fast drags can momentarily move the pointer off the small handle circle
  // (onto the track or page), so cursor-grabbing set only via Tailwind classes
  // on the handle flickers back to the default arrow. Set it explicitly on
  // document.body for the duration of the drag instead — same technique this
  // codebase already uses on a container ref for canvas panning
  // (image-canvas.tsx), scoped to body here since this drag isn't bounded to
  // one container. user-select is also suppressed so a fast drag doesn't
  // trigger accidental text selection on nearby labels.
  const endDrag = useCallback(() => {
    draggingHandle.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    if (!draggingHandle.current) return undefined;
    const onMove = (e: PointerEvent) => applyDrag(e.clientX);
    const onUp = () => endDrag();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    // Safety net: if the pointer is released outside the window entirely
    // (no pointerup fires), still restore cursor/selection on blur.
    window.addEventListener("blur", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("blur", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edValue, esValue]);

  const startDrag = (handle: "ed" | "es") => (e: React.PointerEvent) => {
    e.preventDefault();
    draggingHandle.current = handle;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    // Kick off listeners immediately (effect above re-attaches on next render,
    // but we also want the very first move to register without waiting).
    const onMove = (ev: PointerEvent) => applyDrag(ev.clientX);
    const onUp = () => {
      endDrag();
      window.removeEventListener("pointermove", onMove);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("blur", onUp, { once: true });
  };

  const onKeyDown = (handle: "ed" | "es") => (e: React.KeyboardEvent) => {
    let delta = 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") delta = -1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") delta = 1;
    else return;
    e.preventDefault();
    if (handle === "ed") {
      onEdChange(clamp(Math.min(edValue + delta, esValue - 1)));
    } else {
      onEsChange(clamp(Math.max(esValue + delta, edValue + 1)));
    }
  };

  const edPct = pctFor(edValue);
  const esPct = pctFor(esValue);
  const rangeStartPct = Math.min(edPct, esPct);
  const rangeWidthPct = Math.abs(esPct - edPct);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={trackRef}
        className="relative h-1.5 w-full rounded-full bg-muted"
      >
        {/* Filled segment between the two handles */}
        <div
          className="absolute h-full rounded-full bg-primary/70"
          style={{ left: `${rangeStartPct}%`, width: `${rangeWidthPct}%` }}
        />
        {/* ED handle — hollow/outlined */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={`End-diastole frame, ${edValue + 1} of ${max - min + 1}`}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={edValue}
          onPointerDown={startDrag("ed")}
          onKeyDown={onKeyDown("ed")}
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-primary bg-background shadow-sm transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring active:cursor-grabbing"
          style={{ left: `${edPct}%` }}
        />
        {/* ES handle — filled */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={`End-systole frame, ${esValue + 1} of ${max - min + 1}`}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={esValue}
          onPointerDown={startDrag("es")}
          onKeyDown={onKeyDown("es")}
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-primary bg-primary shadow-sm transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring active:cursor-grabbing"
          style={{ left: `${esPct}%` }}
        />
      </div>
      <div className="relative h-7 text-[10px] font-mono">
        <span
          className="absolute -translate-x-1/2 text-muted-foreground"
          style={{ left: `${edPct}%` }}
        >
          ED · {edValue + 1}
        </span>
        <span
          className="absolute -translate-x-1/2 font-semibold text-primary"
          style={{ left: `${esPct}%` }}
        >
          ES · {esValue + 1}
        </span>
      </div>
    </div>
  );
}

function StrainPreviewPanel({
  selectedStrainType,
  onStrainTypeChange,
  currentFrame,
  frameCount,
  selectedSegment,
  onSelectSegment,
  projectId,
  avgLm1,
  avgLm2,
  strainResult,
  onStrainResult,
  autoFramesByModel,
}: {
  selectedStrainType: StrainType;
  onStrainTypeChange: (type: StrainType) => void;
  currentFrame: number;
  frameCount: number;
  selectedSegment: number | null;
  onSelectSegment: (segment: number) => void;
  projectId: string;
  avgLm1: { x: number; y: number } | null;
  avgLm2: { x: number; y: number } | null;
  strainResult: RealStrainResult | null;
  onStrainResult: (result: RealStrainResult | null) => void;
  autoFramesByModel: {
    unet: { ed: number; es: number } | null;
    medsam: { ed: number; es: number } | null;
  };
}) {
  const edRef  = useRef<HTMLInputElement>(null);
  const esRef  = useRef<HTMLInputElement>(null);
  const [edFile, setEdFile] = useState<File | null>(null);
  const [esFile, setEsFile] = useState<File | null>(null);
  const [isComputing, setIsComputing] = useState(false);
  const [strainError, setStrainError] = useState<string | null>(null);
  const [strainInputMode, setStrainInputMode] = useState<"upload" | "frames">("frames");
  const [strainModel, setStrainModel] = useState<"unet" | "medsam">("unet");
  // The auto-detected ED/ES for the CURRENTLY-selected strain model — so the
  // picker defaults to the frames that this model's heart-metrics found, keeping
  // strain, heart-metrics, and the similarity guard consistent.
  const autoFrames = autoFramesByModel[strainModel];
  // Default the picker to the auto-detected ED/ES (physiologically correct pair)
  // when available, so computed strain peaks are meaningful and match the volumes.
  const [edFrameIdx, setEdFrameIdx] = useState<number>(autoFrames?.ed ?? 0);
  const [esFrameIdx, setEsFrameIdx] = useState<number>(autoFrames?.es ?? 13);
  // Sync the picker to the auto ED/ES when they load (metrics are async) or when
  // the strain model changes — but only while the user hasn't manually dragged.
  const userPickedFramesRef = useRef(false);
  useEffect(() => {
    if (userPickedFramesRef.current) return;
    if (typeof autoFrames?.ed === "number") setEdFrameIdx(autoFrames.ed);
    if (typeof autoFrames?.es === "number") setEsFrameIdx(autoFrames.es);
  }, [autoFrames?.ed, autoFrames?.es]);
  const realStrainData = strainResult;
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; value: number } | null>(null);
  const bullseyeResetRef = useRef<(() => void) | null>(null);
  const heartZoomRef    = useRef<((delta: number) => void) | null>(null);
  const heartResetRef   = useRef<(() => void) | null>(null);
  // 0-based segment index for ClientHeartModel (-1 = none). Kept in sync with the
  // parent's 1-based selectedSegment via handleSegClick below.
  const [selectedSeg3d, setSelectedSeg3d] = useState(-1);

  const handleComputeStrain = async () => {
    if (!edFile || !esFile) return;
    setIsComputing(true);
    setStrainError(null);
    try {
      const formData = new FormData();
      formData.append("ed_file", edFile);
      formData.append("es_file", esFile);
      if (avgLm1 && avgLm2) {
        formData.append("rv_insertion_1_x", String(avgLm1.x));
        formData.append("rv_insertion_1_y", String(avgLm1.y));
        formData.append("rv_insertion_2_x", String(avgLm2.x));
        formData.append("rv_insertion_2_y", String(avgLm2.y));
      }
      const result = await landmarkApi.computeStrain(projectId, formData);
      onStrainResult(result);
      setShowUploadPanel(false);
    } catch (err: any) {
      setStrainError(
        err?.response?.data?.message ??
        "Strain computation failed. Check that both files are valid segmentation NIfTI masks."
      );
    } finally {
      setIsComputing(false);
    }
  };

  const handleComputeFromFrames = async () => {
    if (edFrameIdx === esFrameIdx) return;
    setStrainError(null);
    setIsComputing(true);
    try {
      const result = await computeStrainFromFrames(projectId, edFrameIdx, esFrameIdx, strainModel);
      onStrainResult(result);
      setShowUploadPanel(false);
    } catch (err: any) {
      setStrainError(err.message ?? "Failed to compute strain from frames.");
    } finally {
      setIsComputing(false);
    }
  };

  const displayData = realStrainData
    ? realStrainData.segments.map((s) => ({
        segment: s.segment,
        label:   s.label,
        strain:  selectedStrainType === "GRS" ? (s.grs ?? 0) : (s.gcs ?? 0),
      }))
    : [];

  // Shared colour scale — computed once and passed to both 2D and 3D panels so
  // the same strain value maps to the same colour in both views.
  const strainVals = realStrainData
    ? realStrainData.segments
        .map((s) => (selectedStrainType === "GRS" ? s.grs : s.gcs) ?? NaN)
        .filter((v) => Number.isFinite(v))
    : [];
  const sharedMin = strainVals.length ? Math.min(...strainVals) : -30;
  const sharedMax = strainVals.length ? Math.max(...strainVals) : 80;
  const reverseColors = selectedStrainType === "GCS";

  // handle segment click — toggle selection.
  // seg is 1-based (from the 2D bullseye). ClientHeartModel expects 0-based.
  const handleSegClick = (seg: number) => {
    const isDeselect = selectedSegment === seg;
    onSelectSegment(isDeselect ? -1 as any : seg);
    setSelectedSeg3d(isDeselect ? -1 : seg - 1);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background">

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
        {/* Strain type toggle */}
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/20 p-0.5">
          {(["GCS", "GRS"] as const).map((type) => (
            <button key={type} type="button" onClick={() => onStrainTypeChange(type)}
              className={cn("rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors",
                selectedStrainType === type ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
              {type}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Source badge — only when real data exists */}
          {realStrainData && (
            <span className="rounded-full px-2 py-0.5 text-[9px] font-medium shrink-0 bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400">
              {avgLm1 ? "Real · Aligned" : "Real"}
            </span>
          )}

          {/* Clear strain result */}
          {realStrainData && (
            <button type="button" onClick={() => { onStrainResult(null); setStrainInputMode("frames"); setShowUploadPanel(false); }}
              className="rounded border border-destructive/40 bg-background px-1.5 py-0.5 text-[9px] text-destructive hover:bg-destructive/10 transition-colors shrink-0">
              Clear
            </button>
          )}

          {/* Upload trigger — always visible */}
          <button type="button" onClick={() => setShowUploadPanel((p) => !p)}
            title="Upload ED / ES masks to compute real strain"
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[9px] font-medium transition-colors shrink-0",
              showUploadPanel
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:bg-muted"
            )}>
            <Upload className="h-3 w-3" />
            {realStrainData ? "Recompute" : "Upload masks"}
          </button>
        </div>
      </div>

      {/* ── Upload drawer — slides in below toolbar ── */}
      {showUploadPanel && (
        <div className="flex-shrink-0 border-b border-border bg-muted/10 px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-foreground">Compute Strain</p>
            <button type="button" onClick={() => setShowUploadPanel(false)}
              className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Mode toggle — compact segmented control, "Choose frames" first/default */}
          <div className="inline-flex w-fit rounded-lg border border-border bg-muted/20 p-0.5 text-[10px] flex-shrink-0">
            <button
              type="button"
              onClick={() => setStrainInputMode("frames")}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium transition-colors",
                strainInputMode === "frames"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              Choose frames
            </button>
            <button
              type="button"
              onClick={() => setStrainInputMode("upload")}
              className={cn(
                "rounded-md px-2.5 py-1 font-medium transition-colors",
                strainInputMode === "upload"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              Upload masks
            </button>
          </div>

          {strainInputMode === "upload" && (
            <>
              <p className="text-[9px] text-muted-foreground leading-relaxed">
                Any NIfTI segmentation mask (.nii or .nii.gz) with classes 0=background, 1=RV, 2=myocardium, 3=LV cavity. You can use masks exported from VisHeart or from any other cardiac segmentation tool.
                {avgLm1 && avgLm2 && <span className="text-green-600 ml-1">Landmark alignment will be applied automatically.</span>}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {/* ED */}
                <div>
                  <p className="text-[9px] text-muted-foreground mb-1">End-Diastole (ED)</p>
                  <input ref={edRef} type="file" accept=".nii,.nii.gz" className="sr-only"
                    onChange={(e) => { setEdFile(e.target.files?.[0] ?? null); setStrainError(null); }} />
                  <button type="button" onClick={() => edRef.current?.click()}
                    className={cn(
                      "w-full flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[9px] font-medium transition-colors",
                      edFile ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400"
                             : "border-dashed border-border bg-background text-muted-foreground hover:bg-muted/50"
                    )}>
                    <Upload className="h-3 w-3 shrink-0" />
                    <span className="truncate">{edFile ? edFile.name : "Choose ED .nii/.gz"}</span>
                  </button>
                </div>
                {/* ES */}
                <div>
                  <p className="text-[9px] text-muted-foreground mb-1">End-Systole (ES)</p>
                  <input ref={esRef} type="file" accept=".nii,.nii.gz" className="sr-only"
                    onChange={(e) => { setEsFile(e.target.files?.[0] ?? null); setStrainError(null); }} />
                  <button type="button" onClick={() => esRef.current?.click()}
                    className={cn(
                      "w-full flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[9px] font-medium transition-colors",
                      esFile ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400"
                             : "border-dashed border-border bg-background text-muted-foreground hover:bg-muted/50"
                    )}>
                    <Upload className="h-3 w-3 shrink-0" />
                    <span className="truncate">{esFile ? esFile.name : "Choose ES .nii/.gz"}</span>
                  </button>
                </div>
              </div>
              {strainError && (
                <p className="text-[9px] text-destructive rounded bg-destructive/10 px-2 py-1">{strainError}</p>
              )}
              <button type="button" disabled={!edFile || !esFile || isComputing} onClick={handleComputeStrain}
                className={cn(
                  "w-full rounded-md px-3 py-1.5 text-[10px] font-semibold transition-colors",
                  (!edFile || !esFile || isComputing)
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                )}>
                {isComputing ? (
                  <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Computing…</span>
                ) : "Compute Strain"}
              </button>
            </>
          )}

          {strainInputMode === "frames" && (
            <div className="flex flex-col gap-3 px-1">
              <p className="text-[11px] text-muted-foreground">
                Select any two frames from the stored segmentation to compute strain between them.
                {avgLm1 && avgLm2 && <span className="text-green-600 ml-1">Landmark alignment will be applied automatically.</span>}
              </p>

              {/* ED/ES dual-handle frame range */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] text-muted-foreground">{frameCount} frames</span>
                <DualFrameRangePicker
                  min={0}
                  max={Math.max(0, frameCount - 1)}
                  edValue={edFrameIdx}
                  esValue={esFrameIdx}
                  onEdChange={(v) => { userPickedFramesRef.current = true; setEdFrameIdx(v); setStrainError(null); }}
                  onEsChange={(v) => { userPickedFramesRef.current = true; setEsFrameIdx(v); setStrainError(null); }}
                />
              </div>

              {edFrameIdx === esFrameIdx && (
                <p className="text-[10px] text-destructive">
                  ED and ES frames must be different.
                </p>
              )}

              {/* Peak strain is only physiologically meaningful between the TRUE
                  end-diastole and end-systole. When the picker is moved off the
                  auto-detected pair the backend deliberately withholds the peaks
                  from heartMetrics (and therefore from disease similarity and
                  health status) — surface that here so the omission isn't silent. */}
              {typeof autoFrames?.ed === "number" && typeof autoFrames?.es === "number" &&
               (edFrameIdx !== autoFrames.ed || esFrameIdx !== autoFrames.es) && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
                  <p className="text-[9px] leading-relaxed text-amber-700 dark:text-amber-400">
                    <span className="font-semibold">Custom frames.</span>{" "}
                    Computing {edFrameIdx + 1}→{esFrameIdx + 1} instead of the auto-detected{" "}
                    {autoFrames.ed + 1}→{autoFrames.es + 1} ({strainModel === "unet" ? "UNet" : "MedSAM"}).
                    Strain will still be computed for inspection, but the peaks will{" "}
                    <span className="font-semibold">not</span> feed Disease Similarity or Health
                    Status — those need the true ED/ES pair.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      userPickedFramesRef.current = false;
                      setEdFrameIdx(autoFrames.ed);
                      setEsFrameIdx(autoFrames.es);
                      setStrainError(null);
                    }}
                    className="mt-1 text-[9px] font-medium text-amber-800 underline underline-offset-2 hover:no-underline dark:text-amber-300"
                  >
                    Reset to auto-detected frames
                  </button>
                </div>
              )}

              {typeof autoFrames?.ed === "number" && typeof autoFrames?.es === "number" &&
               edFrameIdx === autoFrames.ed && esFrameIdx === autoFrames.es && (
                <p className="text-[9px] leading-relaxed text-emerald-700 dark:text-emerald-400">
                  Using the auto-detected ED/ES ({autoFrames.ed + 1}→{autoFrames.es + 1}) — peaks
                  will feed Disease Similarity and Health Status.
                </p>
              )}

              {/* Model selector + demoted accuracy note — paired since the note
                  is specifically about auto-segmentation model quality. */}
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/10 px-2 py-1.5">
                <select
                  value={strainModel}
                  onChange={(e) => setStrainModel(e.target.value as "unet" | "medsam")}
                  className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="unet">UNet</option>
                  <option value="medsam">MedSAM</option>
                </select>
                <p className="text-[9px] leading-relaxed text-muted-foreground">
                  Values are indicative only — auto-segmentation masks have limited wall boundary accuracy. For clinical accuracy, use Upload Masks with manually verified masks.
                </p>
              </div>

              {strainError && (
                <p className="text-[9px] text-destructive rounded bg-destructive/10 px-2 py-1">{strainError}</p>
              )}

              <button
                type="button"
                disabled={edFrameIdx === esFrameIdx || frameCount <= 1 || isComputing}
                onClick={handleComputeFromFrames}
                className="w-full rounded-md bg-primary px-3 py-1.5 text-[11px] text-primary-foreground disabled:opacity-50 transition-colors hover:bg-primary/90"
              >
                {isComputing ? (
                  <span className="inline-flex items-center justify-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Computing…</span>
                ) : "Compute Strain"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Main area ── */}
      {!realStrainData ? (
        /* Upload prompt — shown when no strain data available */
        <div className="flex flex-1 items-center justify-center min-h-[320px]">
          <div className="flex flex-col items-center gap-3 text-center max-w-xs">
            <div className="rounded-full border-2 border-dashed border-muted-foreground/30 p-5 mb-2">
              <Heart className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <p className="font-semibold text-sm text-foreground">
              No strain computed yet
            </p>
            {/* Two ways in, and the stored-mask route is the usual one — the old
                copy named only the upload, which reads as "upload is required". */}
            <p className="text-xs text-muted-foreground leading-relaxed">
              Open the panel to compute strain from this project&apos;s <strong>already-saved
              segmentation</strong> — pick the ED and ES frames and press Compute Strain, no
              upload needed. Optionally, upload your own ED/ES masks in NIfTI format (.nii or
              .nii.gz; classes 0=background, 1=RV, 2=myocardium, 3=LV cavity) for
              manually-verified accuracy.
            </p>
            <button
              type="button"
              onClick={() => setShowUploadPanel(true)}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              <Upload className="w-3 h-3" />
              Compute or upload masks
            </button>
          </div>
        </div>
      ) : (
        /* 2-panel layout: LEFT bullseye / RIGHT 3D heart */
        <div className="flex min-h-0 flex-1 gap-2 p-2.5">

          {/* LEFT: 2D bullseye */}
          <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-slate-50 dark:bg-zinc-900 p-2">
            <div className="mb-1 flex items-center justify-between flex-shrink-0">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                2D Bullseye
              </p>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                {selectedStrainType}
              </span>
            </div>
            <StrainZoomPan className="flex-1 min-h-0 w-full" onResetRef={(fn) => { bullseyeResetRef.current = fn; }}>
              <StrainBullseyeChart
                data={displayData}
                strainType={selectedStrainType}
                selectedSegment={selectedSegment}
                onSegmentClick={handleSegClick}
                onSegmentHover={setTooltip}
                sharedMin={sharedMin}
                sharedMax={sharedMax}
                reverseColors={reverseColors}
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
          </div>

          {/* RIGHT: real 3D heart coloured by strain */}
          <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-border bg-slate-50 dark:bg-zinc-900 overflow-hidden p-2">
            <div className="mb-1 flex items-center justify-between flex-shrink-0">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                3D Heart
              </p>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">Synced</span>
            </div>
            <div className="flex-1 min-h-0 w-full">
              <StrainHeartModel
                segments={realStrainData.segments}
                selectedStrainType={selectedStrainType}
                selectedSegment3d={selectedSeg3d}
                min={sharedMin}
                max={sharedMax}
                reverseColors={reverseColors}
                onZoomChange={(fn) => { heartZoomRef.current = fn; }}
                onResetZoom={(fn) => { heartResetRef.current = fn; }}
              />
            </div>
            {/* Real strain KPIs below 3D view */}
            <div className="grid grid-cols-2 gap-1 pt-1 flex-shrink-0">
              <div className="rounded border border-border bg-background px-1.5 py-1 text-center">
                <p className="text-[8px] text-muted-foreground">Peak GRS</p>
                <p className={cn("font-bold text-[10px]",
                  realStrainData.global_grs !== null && realStrainData.global_grs >= 40 ? "text-green-600" : "text-orange-500")}>
                  {realStrainData.global_grs != null ? `${realStrainData.global_grs >= 0 ? "+" : ""}${realStrainData.global_grs.toFixed(1)}%` : "N/A"}
                </p>
                <p className="text-[7px] text-muted-foreground">Normal &gt;+40%</p>
              </div>
              <div className="rounded border border-border bg-background px-1.5 py-1 text-center">
                <p className="text-[8px] text-muted-foreground">Peak GCS</p>
                <p className={cn("font-bold text-[10px]",
                  realStrainData.global_gcs !== null && realStrainData.global_gcs >= -25 && realStrainData.global_gcs <= -15 ? "text-green-600" : "text-orange-500")}>
                  {realStrainData.global_gcs != null ? `${realStrainData.global_gcs.toFixed(1)}%` : "N/A"}
                </p>
                <p className="text-[7px] text-muted-foreground">Normal -15% to -25%</p>
              </div>
              <div className="rounded border border-border bg-background px-1.5 py-1 text-center">
                <p className="text-[8px] text-muted-foreground">
                  {realStrainData.source === "frames" ? `Frame ${(realStrainData.edFrameIndex ?? 0) + 1} WT` : "ED WT"}
                </p>
                <p className="font-bold text-[10px]">{realStrainData.ed_wt_mean_mm?.toFixed(2) ?? "—"} mm</p>
              </div>
              <div className="rounded border border-border bg-background px-1.5 py-1 text-center">
                <p className="text-[8px] text-muted-foreground">
                  {realStrainData.source === "frames" ? `Frame ${(realStrainData.esFrameIndex ?? 0) + 1} WT` : "ES WT"}
                </p>
                <p className="font-bold text-[10px]">{realStrainData.es_wt_mean_mm?.toFixed(2) ?? "—"} mm</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded px-2 py-1 text-xs bg-black/85 text-white border border-white/20 shadow-lg"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}>
          <div className="font-semibold">{tooltip.label}</div>
          <div>{tooltip.value > 0 ? "+" : ""}{tooltip.value.toFixed(1)}%</div>
        </div>
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
      {segGuided > 0 && (
        <span>
          <span className="font-medium text-blue-500">{segGuided}/{nTotal}</span>
          {" seg-guided (2ch)"}
        </span>
      )}
      {mriOnly > 0 && (
        <span>
          <span className="font-medium text-amber-500">{mriOnly}/{nTotal}</span>
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
