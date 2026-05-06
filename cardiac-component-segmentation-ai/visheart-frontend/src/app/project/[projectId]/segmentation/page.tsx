"use client";

import dynamic from "next/dynamic";
import { Loader2, RefreshCw } from "lucide-react";
import { useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

// Backend integration
import { segmentationApi } from "@/lib/api";
import { createFramesStructureFromEditableMasks, decodeSegmentationMasks } from "@/lib/decode-RLE";
import { LoadingProject } from "@/components/project/LoadingProject";
import { ErrorProject } from "@/components/project/ErrorProject";
import { SegmentationSidebar } from "@/components/segmentation/segmentation-sidebar";
import type { AnatomicalLabel, HistoryEntry, DrawingTool } from "@/types/segmentation";
import { generateMaskKey } from "@/types/segmentation";
import type * as ProjectTypes from "@/types/project";
import { useProject } from "@/context/ProjectContext";
import { useSegmentationHistory } from "@/hooks/useSegmentationHistory";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { ReconstructionGLBViewer } from "@/components/reconstruction/ReconstructionGLBViewer";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGpuStatus } from "@/lib/dashboard-hooks";

export type SegmentationModelId = "medsam" | "unet";

const MODEL_OPTIONS: { value: SegmentationModelId; label: string }[] = [
  { value: "medsam", label: "MedSam" },
  { value: "unet", label: "Unet" },
];

const isValidModel = (v: string | null): v is SegmentationModelId =>
  v === "medsam" || v === "unet";

const ImageCanvas = dynamic(() => import("@/components/segmentation/image-canvas").then((mod) => mod.ImageCanvas), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full">
      <Loader2 className="w-8 h-8 animate-spin" />
    </div>
  ),
});

export default function SegmentationResultsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { processingUnit } = useGpuStatus();
  const isGpuMode = processingUnit.gpuAvailable;

  const {
    loading,
    error,
    projectData,
    decodedMasks: contextDecodedMasks,
    undecodedMasks,
    hasMasks,
    maskFetchDone,
    segmentationError,
    tarCacheReady,
    tarCacheError,
    updateContextMasks,
    hasReconstructions,
    reconstructionCacheReady,
    getReconstructionGLB,
  } = useProject();

  useEffect(() => {
    if (projectData?.name) {
      document.title = `VisHeart | ${projectData.name} - Segmentation`;
    } else {
      document.title = "VisHeart | Segmentation Editor";
    }
    
    return () => {
      document.title = "VisHeart";
    };
  }, [projectData?.name]);

  const [masksInitialized, setMasksInitialized] = useState(false);
  const [localDecodedMasks, setLocalDecodedMasks] = useState<Record<string, Uint8Array> | null>(null);

  // `setDecodedMasks` is the writer used by brush/save/history flows.
  const setDecodedMasks = setLocalDecodedMasks;

  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log("[Segmentation Debug] Data flow check:", {
        contextMasks: contextDecodedMasks ? Object.keys(contextDecodedMasks).length : 0,
        localMasks: localDecodedMasks ? Object.keys(localDecodedMasks).length : 0,
        masksInitialized,
        tarCacheReady,
        tarCacheError
      });
    }
  }, [contextDecodedMasks, localDecodedMasks, masksInitialized, tarCacheReady, tarCacheError]);

  // UI state
  const [activeLabel, setActiveLabel] = useState<AnatomicalLabel>("lvc");
  const [tool, setTool] = useState<DrawingTool>("brush");
  const [brushSize, setBrushSize] = useState<number>(10);
  const [opacity, setOpacity] = useState<number>(1);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [currentSlice, setCurrentSlice] = useState(0);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [resetTrigger, setResetTrigger] = useState<number>(0);
  const [revertDialogOpen, setRevertDialogOpen] = useState(false);
  const [rerunDialogOpen, setRerunDialogOpen] = useState(false);
  const [runSegmentationLoading, setRunSegmentationLoading] = useState(false);
  const [runSegmentationError, setRunSegmentationError] = useState<string | null>(null);
  const [runSegmentationSuccess, setRunSegmentationSuccess] = useState<string | null>(null);
  const modelSessionKey = `selectedModel_${projectId}`;

  // Default to MedSAM on first render. The auto-pick effect below will
  // override this once `undecodedMasks` arrives (latest project mask wins),
  // and the CPU-guard effect further down forces "unet" when GPU is absent.
  // We deliberately do NOT seed from localStorage — that caused the dropdown
  // to "stick" on whatever the previous test session wrote.
  const [selectedModel, setSelectedModel] = useState<SegmentationModelId>("medsam");

  // Locked once the user has explicitly chosen a model (clicked dropdown or
  // clicked Run Segmentation), or once the auto-pick has fired. Prevents
  // auto-pick from overriding a manual selection.
  const autoPickLockedRef = useRef(false);

  // Auto-pick the dropdown from the project's actual mask history.
  // Priority order:
  //   1. latest segmentation mask actually stored under this project
  //   2. environment default — GPU => "medsam", CPU => "unet"
  // Runs once after the unscoped mask fetch completes; locked off after
  // the user manually picks a model or clicks Run Segmentation.
  useEffect(() => {
    if (autoPickLockedRef.current) return;
    // Wait for the unscoped mask fetch to finish so we know whether the
    // project has any masks yet (otherwise we may pick the env default
    // before the latest-mask data has arrived).
    if (!maskFetchDone) return;

    // Priority 0: explicit user choice from this tab session. Both
    // `handleModelSelect` and `handleRunSegmentation` write the user's
    // chosen model into sessionStorage. sessionStorage survives the
    // `window.location.reload()` triggered by Run-Segmentation, so the
    // toggle stays on UNet after a UNet run regardless of how the
    // backend timestamps the new docs. Cleared on tab close.
    let explicitPreference: SegmentationModelId | null = null;
    try {
      const stored = sessionStorage.getItem(modelSessionKey);
      if (stored === "medsam" || stored === "unet") {
        explicitPreference = stored as SegmentationModelId;
      }
    } catch {
      // ignore storage read errors
    }

    if (explicitPreference) {
      // Trust the stored choice as-is. `handleModelSelect` already
      // validates GPU availability before letting the user pick MedSAM,
      // so anything in sessionStorage is a previously-validated selection.
      // Re-checking `isGpuMode` here was racy: the GPU probe transiently
      // returns `false` on first render and again while the GPU is
      // saturated by an in-flight job, which silently flipped the toggle
      // back to UNet after a MedSAM Run-Segmentation reload.
      autoPickLockedRef.current = true;
      if (explicitPreference !== selectedModel) {
        setSelectedModel(explicitPreference);
      }
      return;
    }

    const masks = undecodedMasks ?? [];

    // Extract a robust "creation timestamp" for each tagged mask. We try, in
    // order: explicit `createdAt`, then the timestamp encoded in the Mongo
    // `_id` ObjectId (first 8 hex chars = unix seconds), then the array
    // index (backend returns natural insertion order, so larger index =
    // newer). This means we still pick the latest mask even on responses
    // where `createdAt` is absent or stripped.
    const tagged = masks
      .map((m, idx) => {
        const raw = m as unknown as {
          _id?: string;
          segmentationModel?: string;
          model_used?: string;
          createdAt?: string | number | Date;
        };
        const modelStr = (raw.segmentationModel || raw.model_used || "")
          .toString()
          .toLowerCase();
        const model: SegmentationModelId | undefined =
          modelStr === "medsam" || modelStr === "unet"
            ? (modelStr as SegmentationModelId)
            : undefined;

        let ts = 0;
        if (raw.createdAt) {
          ts = new Date(raw.createdAt).getTime() || 0;
        }
        if (!ts && typeof raw._id === "string" && raw._id.length >= 8) {
          // Mongo ObjectId: first 4 bytes (8 hex chars) is unix seconds.
          const seconds = parseInt(raw._id.substring(0, 8), 16);
          if (!Number.isNaN(seconds)) ts = seconds * 1000;
        }
        return { model, ts, idx };
      })
      .filter(
        (x): x is { model: SegmentationModelId; ts: number; idx: number } => !!x.model
      );

    if (tagged.length > 0) {
      // We have evidence from real mask documents — pick the latest and lock
      // so future re-renders don't second-guess the user's actual data.
      tagged.sort((a, b) => (b.ts - a.ts) || (b.idx - a.idx));
      let resolvedModel = tagged[0].model;
      // CPU mode must never auto-pick MedSAM (GPU-only model).
      if (!isGpuMode && resolvedModel === "medsam") {
        resolvedModel = "unet";
      }
      autoPickLockedRef.current = true;
      if (resolvedModel !== selectedModel) {
        setSelectedModel(resolvedModel);
        try {
          localStorage.setItem(modelSessionKey, resolvedModel);
          sessionStorage.setItem(modelSessionKey, resolvedModel);
        } catch {
          // ignore storage write errors
        }
      }
    } else {
      // No tagged masks → fall back to the environment default, but DO NOT
      // lock. `useGpuStatus` returns `false` on first render before the
      // actual GPU probe resolves; if we locked here we'd permanently
      // freeze the dropdown on "unet" even on GPU machines. By leaving the
      // ref unlocked, this effect re-runs the moment `isGpuMode` flips
      // true, and the dropdown corrects itself to "medsam".
      const resolvedModel: SegmentationModelId = isGpuMode ? "medsam" : "unet";
      if (resolvedModel !== selectedModel) {
        setSelectedModel(resolvedModel);
      }
    }
  }, [maskFetchDone, undecodedMasks, isGpuMode, selectedModel, modelSessionKey]);

  // NOTE: The previous "CPU-guard" effect that eagerly forced unet whenever
  // !isGpuMode has been removed. `useGpuStatus` returns `false` on first
  // render before the GPU check resolves, which caused the guard to fire
  // immediately and lock the dropdown to UNet on GPU machines too.
  // CPU enforcement still happens in two places that are safe:
  //   - `handleModelSelect` rejects MedSAM clicks when !isGpuMode.
  //   - `handleRunSegmentation` falls back to "unet" via
  //       `effectiveModel = isGpuMode ? selectedModel : "unet"`.
  // Plus the auto-pick effect above already maps the env default through
  // `isGpuMode` once `maskFetchDone` is true, by which point GPU status
  // has had a chance to resolve.

  // Decode ONLY the currently-selected-model's mask documents.
  // The committed `decodeSegmentationMasks` builds keys without a model prefix
  // (e.g. `editable_frame_0_slice_0_lvc`), so a MedSAM and a UNet doc would
  // collide on the same key if both were decoded together. By filtering
  // `undecodedMasks` down to a single model first, we sidestep the collision
  // entirely without changing the decoder, the renderer, or the brush/save
  // key formats. Switching the dropdown re-runs this memo and the canvas
  // re-renders with the correct model's masks.
  const modelScopedDecodedMasks = useMemo(() => {
    // `null` means "data not loaded yet" — caller may fall back to
    // `contextDecodedMasks` while waiting. Once data is loaded we always
    // return an object (possibly empty) so the caller's `||` chain
    // short-circuits here and DOES NOT leak the unfiltered set.
    if (!undecodedMasks || undecodedMasks.length === 0) return null;
    if (!projectData?.dimensions?.width || !projectData?.dimensions?.height) return null;

    // Robust per-doc model resolver. Order of trust:
    //   1. Explicit `segmentationModel` / `model_used` field if present.
    //   2. Name-based hint — the webhook stamps the model name into
    //      the doc's `name` (e.g. `"UNET Output - Job ..."`,
    //      `"Manual Edit (UNET) - ..."`, `"MedSAM AI Output ..."`).
    //      We only accept this when the explicit tag is missing, and we
    //      only accept exact "medsam" / "unet" substrings — never a
    //      free-text guess.
    // Returns `null` for "no signal at all" so the caller can decide
    // legacy-fallback policy without us silently casting untagged data
    // into the current model.
    const inferDocModel = (m: unknown): "medsam" | "unet" | null => {
      const raw = m as {
        segmentationModel?: string;
        model_used?: string;
        name?: string;
      };
      const tag = (raw.segmentationModel || raw.model_used || "")
        .toString()
        .toLowerCase();
      if (tag === "medsam" || tag === "unet") return tag;
      const name = (raw.name || "").toString().toLowerCase();
      // UNet first because its names always contain the literal word.
      if (name.includes("unet")) return "unet";
      if (name.includes("medsam")) return "medsam";
      // Webhook AI-doc name templates produced by the MedSAM path:
      //   "AI Output - Job <id>"      (no model word, the literal "AI")
      // — they're MedSAM by construction (UNet's AI doc is "UNET Output …",
      // already caught above). Recognising this template lets us
      // resolve a MedSAM AI doc whose explicit `segmentationModel`
      // field somehow didn't survive into the API response.
      if (name.startsWith("ai output")) return "medsam";
      // Pre-Option-2 Manual editable docs: "Manual Edit - <something>".
      // That code path only ever ran for MedSAM, so we can resolve them
      // safely here. New code stamps "Manual Edit (MEDSAM)" /
      // "(UNET)" which the includes-check above already handles.
      if (name.startsWith("manual edit -") || name === "manual edit") return "medsam";
      return null;
    };

    // Pass 1 — match docs whose resolved model equals the toggle.
    const exact = undecodedMasks.filter((m) => inferDocModel(m) === selectedModel);

    if (exact.length > 0) {
      return decodeSegmentationMasks(
        exact,
        projectData.dimensions.width,
        projectData.dimensions.height,
      ).masks;
    }

    // No doc resolves to the current model. Decide whether the project
    // is still pure-legacy or whether other tagged docs already live
    // here (in which case we MUST NOT silently surface untagged docs
    // under the current toggle — that's the leak).
    const anyDocResolves = undecodedMasks.some((m) => inferDocModel(m) !== null);

    if (anyDocResolves) {
      // The project has docs we can identify, but none are for the
      // current model. Paint empty rather than leaking the other model.
      return {};
    }

    // Pure-legacy project: no doc has a tag or a name hint. Treat
    // the whole set as MedSAM-only (codebase's pre-UNet history).
    if (selectedModel === "medsam") {
      return decodeSegmentationMasks(
        undecodedMasks,
        projectData.dimensions.width,
        projectData.dimensions.height,
      ).masks;
    }
    return {};
  }, [undecodedMasks, selectedModel, projectData?.dimensions?.width, projectData?.dimensions?.height]);

  // One-shot diagnostic so the actual tag/name distribution is
  // observable in the browser console. This makes future "why did the
  // toggle not see my docs" questions answerable in seconds without
  // having to read the DB.
  useEffect(() => {
    if (!undecodedMasks || undecodedMasks.length === 0) return;
    const summary = undecodedMasks.map((m) => {
      const raw = m as unknown as {
        _id?: any;
        name?: string;
        segmentationModel?: string;
        model_used?: string;
        isMedSAMOutput?: boolean;
      };
      return {
        id: raw._id ? raw._id.toString() : "(no id)",
        name: raw.name,
        segmentationModel: raw.segmentationModel,
        model_used: raw.model_used,
        isMedSAMOutput: raw.isMedSAMOutput,
      };
    });
    console.log(
      "[Segmentation] undecodedMasks tag summary (selectedModel=" +
        selectedModel +
        "):",
      summary
    );
  }, [undecodedMasks, selectedModel]);

  // `decodedMasks` priority:
  //   1. localDecodedMasks       — user's in-progress brush edits.
  //   2. modelScopedDecodedMasks — strictly model-scoped data. When
  //                                undecodedMasks is loaded but the
  //                                current model has no docs (and the
  //                                project has docs for the OTHER model),
  //                                this is `{}` — truthy — so the chain
  //                                short-circuits HERE and we paint
  //                                empty rather than leaking the other
  //                                model via the contextDecodedMasks
  //                                fallback.
  //   3. contextDecodedMasks     — last-resort fallback ONLY when
  //                                modelScopedDecodedMasks is `null`
  //                                (data not loaded yet).
  const decodedMasks = localDecodedMasks || modelScopedDecodedMasks || contextDecodedMasks;
  const safeDecodedMasks = decodedMasks || {};

  // Cached-result detection: bound to the SAME strictly model-scoped
  // source the canvas paints from (`modelScopedDecodedMasks`). We
  // deliberately do NOT peek into `localDecodedMasks` (in-progress
  // brush edits aren't a persisted AI cache) or `contextDecodedMasks`
  // (the unfiltered set — would falsely report "cached MedSAM" when
  // only UNet docs exist, and vice-versa). Result: badge truthfully
  // reports the cache state of the currently selected model only.
  const hasCachedResultForSelected = useMemo(() => {
    if (!modelScopedDecodedMasks) return false;
    for (const key in modelScopedDecodedMasks) {
      const value = modelScopedDecodedMasks[key];
      if (
        (key.startsWith("editable_") || key.startsWith("medSamOutput_")) &&
        value &&
        value.length > 0
      ) {
        return true;
      }
    }
    return false;
  }, [modelScopedDecodedMasks]);

  const handleModelSelect = useCallback((value: SegmentationModelId) => {
    if (!isGpuMode && value === "medsam") {
      setRunSegmentationError("This model is only available with NVIDIA GPU.");
      return;
    }

    setSelectedModel(value);
    autoPickLockedRef.current = true; // user took over; auto-pick must back off
    // Drop any in-memory editing state for the previous model so the canvas
    // re-renders from the newly selected model's stored masks.
    setLocalDecodedMasks(null);
    setHasUnsavedChanges(false);
    try {
      localStorage.setItem(modelSessionKey, value);
      sessionStorage.setItem(modelSessionKey, value);
    } catch {
      // ignore storage write errors
    }
    setRunSegmentationError(null);
    setRunSegmentationSuccess(
      `${MODEL_OPTIONS.find((o) => o.value === value)?.label} selected successfully.`
    );
  }, [isGpuMode, modelSessionKey]);

  const [reconstructionModelUrl, setReconstructionModelUrl] = useState<string | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);

  useEffect(() => {
    if (!hasReconstructions || !reconstructionCacheReady) {
      setReconstructionModelUrl(null);
      return;
    }

    const loadModel = async () => {
      setIsLoadingModel(true);
      try {
        console.log(`[Segmentation 3D] Loading model for frame ${currentFrame}...`);
        const url = await getReconstructionGLB(currentFrame + 1);
        if (url) {
          console.log(`[Segmentation 3D] ✅ Loaded model for frame ${currentFrame}`);
          setReconstructionModelUrl(url);
        } else {
          console.warn(`[Segmentation 3D] ❌ No model URL for frame ${currentFrame}`);
          setReconstructionModelUrl(null);
        }
      } catch (error) {
        console.error(`[Segmentation 3D] Error loading model:`, error);
        setReconstructionModelUrl(null);
      } finally {
        setIsLoadingModel(false);
      }
    };

    loadModel();
  }, [currentFrame, hasReconstructions, reconstructionCacheReady, getReconstructionGLB]);

  const handleReset = useCallback(() => {
    setZoomLevel(1);
    setResetTrigger(prev => prev + 1);
  }, []);

  // Poll `/segmentation-results/:projectId` for a new mask doc whose
  // `segmentationModel` matches `expectedModel` and whose `_id` is not in
  // `preIds`. Returns true as soon as a new doc is seen; false on
  // timeout. Caller decides what to do with the timeout — the new policy
  // is to reload anyway (no error popup), matching the original
  // 1500ms-then-reload behaviour but without the race when results
  // arrive sooner. Interval is 1s and we do a synchronous first check
  // (no 2s dead time before the first probe) so fast jobs reload
  // promptly. Match relaxed: if any new doc lands at all (regardless of
  // tag) we treat it as ready, because some legacy webhook paths don't
  // stamp `segmentationModel` and we'd otherwise miss the reload window.
  const pollForNewMaskDoc = useCallback(
    async (expectedModel: SegmentationModelId, preIds: Set<string>) => {
      const intervalMs = 1000;
      const maxAttempts = 30; // ~30s, then caller reloads regardless
      const probe = async (): Promise<boolean> => {
        try {
          const result = await segmentationApi.getSegmentationResults(projectId!);
          const segs: any[] = Array.isArray(result?.segmentations)
            ? result.segmentations
            : [];
          // Strong match first: matching model tag + new _id
          const strong = segs.find((m) => {
            const tag = (m?.segmentationModel || m?.model_used || "")
              .toString()
              .toLowerCase();
            const id = m?._id ? m._id.toString() : "";
            return tag === expectedModel && id && !preIds.has(id);
          });
          if (strong) return true;
          // Weak match: ANY new doc (covers legacy/untagged webhook paths)
          const weak = segs.find((m) => {
            const id = m?._id ? m._id.toString() : "";
            return id && !preIds.has(id);
          });
          return !!weak;
        } catch (err) {
          console.warn("[Segmentation] Poll probe failed:", err);
          return false;
        }
      };

      // Synchronous first check — covers the "result already landed
      // before we started polling" case (rare but possible if the
      // webhook fires very fast).
      if (await probe()) return true;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        if (await probe()) {
          console.log(
            `[Segmentation] Poll detected new mask doc for ${expectedModel} after ${attempt + 1}s.`
          );
          return true;
        }
      }
      return false;
    },
    [projectId]
  );

  // The actual dispatch path. Called either directly (cache miss, no
  // existing result) or from the Re-run confirm dialog (cache hit and
  // user explicitly chose to regenerate).
  const dispatchRunSegmentation = useCallback(async () => {
    if (!projectId || runSegmentationLoading) return;

    setRunSegmentationLoading(true);
    setRunSegmentationError(null);
    setRunSegmentationSuccess(null);

    try {
      const detectedMode = isGpuMode ? "gpu" : "cpu";
      const effectiveModel: SegmentationModelId = selectedModel;

      if (!isGpuMode && effectiveModel === "medsam") {
        setRunSegmentationError("MedSam requires NVIDIA GPU mode. Select Unet or start the GPU service first.");
        return;
      }

      try {
        localStorage.setItem(modelSessionKey, effectiveModel);
        sessionStorage.setItem(modelSessionKey, effectiveModel);
        autoPickLockedRef.current = true;
      } catch {
        // ignore storage write errors
      }

      // Snapshot the existing mask `_id`s BEFORE dispatch so the poller
      // below can detect when a NEW doc for `effectiveModel` lands. This
      // is more reliable than timestamp comparisons across timezones.
      const preIds = new Set<string>(
        (undecodedMasks ?? [])
          .map((m) => {
            const raw = m as unknown as { _id?: any };
            return raw._id ? raw._id.toString() : "";
          })
          .filter((id) => id.length > 0)
      );

      console.log("[Segmentation] Run request mode/model:", {
        processingUnit,
        detectedMode,
        selectedModel,
        effectiveModel,
        preIdCount: preIds.size,
        requestPayload: { segmentationModel: effectiveModel, deviceType: "auto" },
      });

      await segmentationApi.startSegmentation(projectId, effectiveModel, "auto");

      const modelLabel =
        MODEL_OPTIONS.find((o) => o.value === effectiveModel)?.label || effectiveModel;
      setRunSegmentationSuccess(
        `${modelLabel} segmentation started. Waiting for result…`
      );

      const arrived = await pollForNewMaskDoc(effectiveModel, preIds);
      // Reload regardless of detection. If `arrived` is true the new
      // doc is in the DB and will render after reload. If it timed
      // out, we still reload (the page may refetch and the user sees
      // current state without a confusing "taking longer" error). This
      // matches the original 1500ms-then-reload pipeline UX, just
      // without the race when results land sooner than the timeout.
      setRunSegmentationSuccess(
        arrived
          ? `${modelLabel} result ready. Reloading…`
          : `Reloading to fetch latest ${modelLabel} state…`
      );
      window.location.reload();
    } catch (error: any) {
      const errorMsg =
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        "Failed to start segmentation";

      console.error("[Segmentation] ❌ Full error:", error);
      console.error("[Segmentation] ❌ Response data:", error?.response?.data);
      console.error("[Segmentation] ❌ Status:", error?.response?.status);
      console.error("[Segmentation] ❌ projectId:", projectId);
      console.error("[Segmentation] ❌ selectedModel:", selectedModel);

      setRunSegmentationError(errorMsg);
      setRunSegmentationLoading(false);
    }
    // NOTE: we deliberately do NOT clear loading in a `finally` when the
    // poller succeeded — the page is about to reload, so leaving the
    // button disabled prevents a double-click.
  }, [
    projectId,
    selectedModel,
    runSegmentationLoading,
    modelSessionKey,
    isGpuMode,
    processingUnit,
    undecodedMasks,
    pollForNewMaskDoc,
  ]);

  // Top-level button handler: cache-aware gate. If the selected model
  // already has at least one persisted mask doc, we DO NOT auto-dispatch.
  // The user must explicitly confirm via the Re-run dialog so MedSAM in
  // particular doesn't get re-fired on every accidental click.
  const handleRunSegmentation = useCallback(() => {
    if (!projectId || runSegmentationLoading) return;
    if (hasCachedResultForSelected) {
      setRunSegmentationError(null);
      setRerunDialogOpen(true);
      return;
    }
    dispatchRunSegmentation();
  }, [projectId, runSegmentationLoading, hasCachedResultForSelected, dispatchRunSegmentation]);

  const handleConfirmRerun = useCallback(() => {
    setRerunDialogOpen(false);
    dispatchRunSegmentation();
  }, [dispatchRunSegmentation]);

  const {
    currentHistory,
    currentStep: currentHistoryStep,
    canUndo,
    canRedo,
    createEntry: createHistoryEntry,
    addToHistory,
    navigateToStep: handleHistoryStepChange,
    initialize: initializeHistory,
    clear: handleHistoryClear
  } = useSegmentationHistory({
    currentFrame,
    currentSlice,
    decodedMasks
  });

  const canClear = useMemo(() => !!decodedMasks, [decodedMasks]);

  const [visibleMasks, setVisibleMasks] = useState<Set<AnatomicalLabel>>(new Set(["lvc", "rv", "myo"]));

  const calculateMaskChanges = useCallback(
    (oldMasks: Record<string, Uint8Array>, newMasks: Record<string, Uint8Array>, label: string): HistoryEntry["maskChanges"] => {
      const editableMaskKey = generateMaskKey(currentFrame, currentSlice, label as AnatomicalLabel);
      const oldMask = oldMasks[editableMaskKey];
      const newMask = newMasks[editableMaskKey];

      if (!newMask) return undefined;

      let added = 0;
      let removed = 0;

      const maskLength = newMask.length;
      for (let i = 0; i < maskLength; i++) {
        const oldPixel = oldMask ? oldMask[i] || 0 : 0;
        const newPixel = newMask[i] || 0;

        if (oldPixel === 0 && newPixel > 0) added++;
        if (oldPixel > 0 && newPixel === 0) removed++;
      }

      return { added, removed, label: label as AnatomicalLabel };
    },
    [currentFrame, currentSlice],
  );

  const updateMasksWithHistory = useCallback(
    (newMasks: Record<string, Uint8Array>, actionType: HistoryEntry["type"] = "brush", description?: string) => {
      if (!decodedMasks) return;

      const maskChanges = calculateMaskChanges(decodedMasks, newMasks, activeLabel);
      
      const newEntry = createHistoryEntry(
        actionType, 
        description || `${actionType} action on ${activeLabel.toUpperCase()}`, 
        decodedMasks,
        maskChanges, 
        activeLabel
      );

      addToHistory(newEntry);

      setDecodedMasks(newMasks);
      setHasUnsavedChanges(true);

      console.log(`[Segmentation] Updated history for current frame/slice`);
    },
    [decodedMasks, activeLabel, createHistoryEntry, addToHistory, calculateMaskChanges, setDecodedMasks],
  );

  const canvasDimensions = useMemo(() => {
    const dbWidth = projectData?.dimensions?.width || 512;
    const dbHeight = projectData?.dimensions?.height || 512;

    return {
      width: dbWidth,
      height: dbHeight,
    };
  }, [projectData?.dimensions]);

  const restoreMasksFromHistory = useCallback((entry: HistoryEntry | null) => {
    if (!entry || !entry.masksSnapshot || !decodedMasks) return;

    const currentFrameSlicePrefix = `editable_frame_${currentFrame}_slice_${currentSlice}_`;
    const mergedMasks = { ...decodedMasks };

    for (const key of Object.keys(mergedMasks)) {
      if (key.startsWith(currentFrameSlicePrefix) && !(key in entry.masksSnapshot)) {
        delete mergedMasks[key];
        console.log(`[Segmentation] Removed mask ${key} (not in snapshot)`);
      }
    }

    for (const [key, maskData] of Object.entries(entry.masksSnapshot)) {
      if (key.startsWith(currentFrameSlicePrefix) && maskData) {
        try {
          mergedMasks[key] = new Uint8Array(maskData as ArrayLike<number>);
        } catch (error) {
          console.error(`[Segmentation] Failed to restore mask ${key}:`, error);
        }
      }
    }

    setDecodedMasks(mergedMasks);
    setHasUnsavedChanges(true);
  }, [decodedMasks, currentFrame, currentSlice, setDecodedMasks]);

  const handleHistoryStepChangeWithMasks = useCallback((step: number) => {
    console.log(`[Segmentation] Navigating to history step ${step}`);
    const entry = handleHistoryStepChange(step);
    if (entry) {
      restoreMasksFromHistory(entry);
      console.log(`[Segmentation] Successfully navigated to history step ${step}`);
    }
    return entry;
  }, [handleHistoryStepChange, restoreMasksFromHistory]);

  const handleUndo = useCallback(() => {
    if (!canUndo || !decodedMasks) return;
    
    const previousEntry = handleHistoryStepChangeWithMasks(currentHistoryStep - 1);
    if (previousEntry) {
      console.log(`[Segmentation] Undo operation completed`);
    }
  }, [canUndo, decodedMasks, handleHistoryStepChangeWithMasks, currentHistoryStep]);

  const handleRedo = useCallback(() => {
    if (!canRedo || !decodedMasks) return;
    
    const nextEntry = handleHistoryStepChangeWithMasks(currentHistoryStep + 1);
    if (nextEntry) {
      console.log(`[Segmentation] Redo operation completed`);
    }
  }, [canRedo, decodedMasks, handleHistoryStepChangeWithMasks, currentHistoryStep]); 
  const handleClear = useCallback(() => {
    if (!decodedMasks) return;

    const newMasks = { ...decodedMasks };
    const editableMaskKey = generateMaskKey(currentFrame, currentSlice, activeLabel);

    if (newMasks[editableMaskKey]) {
      newMasks[editableMaskKey] = new Uint8Array(newMasks[editableMaskKey].length);
      updateMasksWithHistory(newMasks, "clear", `Cleared ${activeLabel.toUpperCase()} editable mask`);
    }
  }, [decodedMasks, currentFrame, currentSlice, activeLabel, updateMasksWithHistory]);

  const handleHistoryCheckpoint = useCallback(() => {
    if (!decodedMasks) return;

    const existingCheckpoints = currentHistory.filter((entry) => entry.type === "checkpoint").length;
    const nextCheckpointNum = existingCheckpoints + 1;

    updateMasksWithHistory(decodedMasks, "checkpoint", `Manual checkpoint #${nextCheckpointNum} created`);
  }, [decodedMasks, currentHistory, updateMasksWithHistory]);

  const handleSave = useCallback(async () => {
    if (!decodedMasks || !projectId || isSaving) return;
    
    setIsSaving(true);
    try {
      const editableMasks = Object.entries(decodedMasks)
        .filter(([key]) => key.startsWith("editable_"))
        .reduce(
          (acc, [key, data]) => {
            acc[key] = data;
            return acc;
          },
          {} as Record<string, Uint8Array>,
        );

      console.log("[Segmentation] Saving editable masks:", Object.keys(editableMasks));

      const frames = createFramesStructureFromEditableMasks(editableMasks);

      console.log("[Segmentation] Converted to backend frames format:", frames);

      if (frames.length > 0 && frames[0].slices && frames[0].slices.length > 0) {
        const firstMask = frames[0].slices[0].segmentationmasks?.[0];
        if (firstMask) {
          console.log("[RLE Test] First mask RLE string:", firstMask.segmentationmaskcontents);
          console.log("[RLE Test] RLE string length:", firstMask.segmentationmaskcontents.length);
        }
      }

      await segmentationApi.saveManualSegmentation(projectId, {
        name: `Manual Segmentation - ${new Date().toISOString()}`,
        description: "Manually edited segmentation masks with RLE encoding",
        frames: frames,
        model: selectedModel,
      });

      console.log("[Segmentation] Successfully saved masks to backend");

      updateContextMasks(decodedMasks);

      setHasUnsavedChanges(false);
      setLocalDecodedMasks(null); 

      console.log("[Segmentation] Successfully saved and updated context with optimistic approach");
    } catch (err) {
      console.error("Failed to save editable masks:", err);
    } finally {
      setIsSaving(false);
    }
  }, [decodedMasks, projectId, isSaving, updateContextMasks]);

  const handleRevertToAI = useCallback(async () => {
    if (!projectId || isSaving || !undecodedMasks) return;

    setIsSaving(true);
    try {
      const aiMask = undecodedMasks.find((mask: ProjectTypes.BaseSegmentationMask) => mask.isMedSAMOutput === true);
      const editableMask = undecodedMasks.find((mask: ProjectTypes.BaseSegmentationMask) => mask.isMedSAMOutput === false);

      if (!aiMask || !editableMask) {
        console.error("[Segmentation] Could not find AI or editable mask");
        alert("Could not find masks to revert. Please try again.");
        return;
      }

      console.log("[Segmentation] Reverting to AI mask:", {
        aiMaskId: aiMask._id,
        editableMaskId: editableMask._id,
        frameCount: aiMask.frames?.length || 0,
      });

      const revertData = {
        frames: aiMask.frames, 
      };

      await segmentationApi.saveManualSegmentation(projectId, revertData);

      console.log("[Segmentation] ✅ Successfully reverted to AI mask");

      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (err) {
      console.error("[Segmentation] ❌ Error reverting to AI mask:", err);
      alert("Failed to revert to AI mask. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [projectId, isSaving, undecodedMasks]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === 's') {
        event.preventDefault(); 
        
        if (hasUnsavedChanges && !isSaving) {
          console.log('[Segmentation] Ctrl+S shortcut triggered - saving changes...');
          handleSave();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasUnsavedChanges, isSaving, handleSave]);

  const handleHistoryExport = useCallback(() => {
    console.log("Export triggered from page level");
  }, []);

  useEffect(() => {
    if (contextDecodedMasks && !masksInitialized) {
      console.log("[Segmentation] Initializing history with context masks");
      initializeHistory(contextDecodedMasks);
      setMasksInitialized(true);
    }
  }, [contextDecodedMasks, masksInitialized, initializeHistory]);

  useEffect(() => {
    if (masksInitialized && decodedMasks) {
      console.log(`[Segmentation] Auto-initializing history for new frame/slice if needed`);
      initializeHistory(decodedMasks);
    }
  }, [currentFrame, currentSlice, masksInitialized, decodedMasks, initializeHistory]);

  if (!projectId) return <ErrorProject error="Project ID is missing." />;
  if (loading !== "done") return <LoadingProject loadingStage={loading} />;
  if (error) return <ErrorProject error={error} />;
  if (segmentationError && !hasMasks) return <ErrorProject error={segmentationError} />;
  if (!projectData || (!contextDecodedMasks && !isSaving)) {
    return <ErrorProject error="No data available" />;
  }
  if (isSaving && !contextDecodedMasks) {
    return <LoadingProject loadingStage="mask" />;
  }

  return (
    <div className="h-full w-full bg-background flex flex-col">

      {/* AI Model Selector Bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-background shrink-0 flex-wrap">
        {/* Icon + label */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.75a6 6 0 1 1 4.5 11.25M9.75 3.75A6 6 0 0 0 3.75 9.75M9.75 3.75 3.75 9.75m10.5 0a6 6 0 0 1-4.5 11.25M14.25 9.75A6 6 0 0 1 20.25 15" />
            </svg>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground leading-none">AI Model</p>
            <p className="text-xs font-medium text-foreground leading-tight mt-0.5">Select segmentation model</p>
          </div>
        </div>

        {/* Dropdown */}
        <Select
            value={selectedModel}
          onValueChange={(value: string) => handleModelSelect(value as SegmentationModelId)}
          >
          <SelectTrigger
            size="sm"
            className="min-w-[160px] rounded-xl bg-background px-3 text-sm shadow-sm hover:bg-muted/40"
            aria-label="Select segmentation model"
          >
            <SelectValue placeholder="Select model" />
          </SelectTrigger>
          <SelectContent className="rounded-xl p-1.5 shadow-lg">
            {MODEL_OPTIONS.map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                disabled={!isGpuMode && opt.value === "medsam"}
                className="rounded-lg py-2"
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!isGpuMode && (
          <span className="text-xs text-muted-foreground">
            This model is only available with NVIDIA GPU.
          </span>
        )}

        {/* Status badge: cached vs. empty */}
        {hasCachedResultForSelected ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 border border-green-200 dark:border-green-800">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500 inline-block" />
            Cached result available
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />
            No result yet
          </span>
        )}

        {/* Confirmation text */}
        <span className="text-xs text-muted-foreground">
          Using: <strong className="text-foreground font-medium">
            {MODEL_OPTIONS.find((o) => o.value === selectedModel)?.label}
          </strong>
        </span>

        {/* Run / Re-run Segmentation Button (cache-aware) */}
        <button
          onClick={handleRunSegmentation}
          disabled={runSegmentationLoading}
          className="ml-auto px-3 py-1.5 text-sm font-medium rounded-md bg-black text-white hover:bg-black/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 dark:bg-white dark:text-black dark:hover:bg-white/90"
        >
          {runSegmentationLoading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Processing...
            </>
          ) : hasCachedResultForSelected ? (
            <>
              <RefreshCw className="w-3.5 h-3.5" />
              Re-run {MODEL_OPTIONS.find((o) => o.value === selectedModel)?.label}
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 0 1-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              Run Segmentation
            </>
          )}
        </button>

        {/* Error message */}
        {runSegmentationError && (
          <div className="text-xs text-red-600 dark:text-red-400 ml-auto">
            {runSegmentationError}
          </div>
        )}

        {/* Success message */}
        {runSegmentationSuccess && (
          <div className="w-full text-xs text-green-600 dark:text-green-400 mt-1">
            {runSegmentationSuccess}
          </div>
        )}
      </div>

      {/* Main segmentation layout */}
      <div className="flex-1 min-h-0 overflow-hidden">
      {/* Mobile: Stack vertically */}
      <div className="lg:hidden w-full h-full p-4 flex flex-col gap-4">
        <div className="flex-1 relative bg-muted/40 rounded-xl border shadow-sm p-4 flex items-center justify-center overflow-hidden">
          <ImageCanvas
            projectData={projectData}
            decodedMasks={safeDecodedMasks}
            onMaskUpdate={updateMasksWithHistory}
            currentFrame={currentFrame}
            currentSlice={currentSlice}
            onFrameChange={setCurrentFrame}
            onSliceChange={setCurrentSlice}
            width={canvasDimensions.width}
            height={canvasDimensions.height}
            activeLabel={activeLabel}
            visibleMasks={visibleMasks}
            tool={tool}
            brushSize={brushSize}
            opacity={opacity}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
            resetTrigger={resetTrigger}
            selectedModel={selectedModel}
          />
        </div>
        
        <div className="w-full bg-background rounded-xl border shadow-sm">
          <SegmentationSidebar
            projectData={projectData}
            decodedMasks={safeDecodedMasks}
            tool={tool}
            setTool={setTool}
            brushSize={brushSize}
            setBrushSize={setBrushSize}
            opacity={opacity}
            setOpacity={setOpacity}
            activeLabel={activeLabel}
            setActiveLabel={setActiveLabel}
            visibleMasks={visibleMasks}
            setVisibleMasks={setVisibleMasks}
            handleUndo={handleUndo}
            handleRedo={handleRedo}
            handleClear={handleClear}
            canUndo={canUndo}
            canRedo={canRedo}
            canClear={canClear}
            hasUnsavedChanges={hasUnsavedChanges}
            isSaving={isSaving}
            onSave={handleSave}
            currentFrame={currentFrame}
            currentSlice={currentSlice}
            totalFrames={projectData.dimensions?.frames || 1}
            totalSlices={projectData.dimensions?.slices || 1}
            historyData={currentHistory}
            currentHistoryStep={currentHistoryStep}
            onHistoryStepChange={handleHistoryStepChangeWithMasks}
            onHistoryClear={handleHistoryClear}
            onHistoryExport={handleHistoryExport}
            onHistoryCheckpoint={handleHistoryCheckpoint}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
            onReset={handleReset}
            selectedModel={selectedModel}
            onModelChange={handleModelSelect}
            isModelActive={hasMasks}
            isModelRunning={runSegmentationLoading}
          />
        </div>
      </div>

      {/* Desktop: Resizable panels */}
      <div className="hidden lg:block w-full h-full p-3">
        <ResizablePanelGroup 
          direction="horizontal" 
          className="h-full w-full rounded-xl border shadow-sm"
        >
          {/* Canvas Panel with horizontal split for 3D viewer */}
          <ResizablePanel defaultSize={70} minSize={20}>
            <ResizablePanelGroup direction="horizontal">
              {/* 3D Viewer (Left)*/}
              <>
                <ResizablePanel defaultSize={35} minSize={0} maxSize={70}>
                  <div className="w-full bg-background p-4 flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
                    <div className="flex items-center justify-between mb-2 flex-shrink-0">
                      <h3 className="text-sm font-semibold">3D Reconstruction of Left Ventricle Myocardium</h3>
                      {isLoadingModel && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading model...
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-h-0 max-h-full">
                      <ReconstructionGLBViewer
                        modelUrl={reconstructionModelUrl}
                        frame={currentFrame + 1}
                        className="w-full h-full"
                      />
                    </div>
                  </div>
                </ResizablePanel>

                <ResizableHandle withHandle />
              </>

              {/* 2D Canvas (Right) */}
              <ResizablePanel defaultSize={65}>
                <div className="w-full relative bg-muted/40 p-4 flex items-center justify-center" style={{ height: 'calc(100vh - 120px)' }}>
                  <ImageCanvas
                    projectData={projectData}
                    decodedMasks={safeDecodedMasks}
                    onMaskUpdate={updateMasksWithHistory}
                    currentFrame={currentFrame}
                    currentSlice={currentSlice}
                    onFrameChange={setCurrentFrame}
                    onSliceChange={setCurrentSlice}
                    width={canvasDimensions.width}
                    height={canvasDimensions.height}
                    activeLabel={activeLabel}
                    visibleMasks={visibleMasks}
                    tool={tool}
                    brushSize={brushSize}
                    opacity={opacity}
                    zoomLevel={zoomLevel}
                    setZoomLevel={setZoomLevel}
                    resetTrigger={resetTrigger}
                    selectedModel={selectedModel}
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Sidebar Panel */}
          <ResizablePanel defaultSize={30} minSize={0} maxSize={80}>
            <div className="h-full w-full bg-background">
              <SegmentationSidebar
                projectData={projectData}
                decodedMasks={safeDecodedMasks}
                tool={tool}
                setTool={setTool}
                brushSize={brushSize}
                setBrushSize={setBrushSize}
                opacity={opacity}
                setOpacity={setOpacity}
                activeLabel={activeLabel}
                setActiveLabel={setActiveLabel}
                visibleMasks={visibleMasks}
                setVisibleMasks={setVisibleMasks}
                handleUndo={handleUndo}
                handleRedo={handleRedo}
                handleClear={handleClear}
                canUndo={canUndo}
                canRedo={canRedo}
                canClear={canClear}
                hasUnsavedChanges={hasUnsavedChanges}
                isSaving={isSaving}
                onSave={handleSave}
                onRevert={() => setRevertDialogOpen(true)}
                currentFrame={currentFrame}
                currentSlice={currentSlice}
                totalFrames={projectData.dimensions?.frames || 1}
                totalSlices={projectData.dimensions?.slices || 1}
                historyData={currentHistory}
                currentHistoryStep={currentHistoryStep}
                onHistoryStepChange={handleHistoryStepChangeWithMasks}
                onHistoryClear={handleHistoryClear}
                onHistoryExport={handleHistoryExport}
                onHistoryCheckpoint={handleHistoryCheckpoint}
                zoomLevel={zoomLevel}
                setZoomLevel={setZoomLevel}
                onReset={handleReset}
                selectedModel={selectedModel}
                onModelChange={handleModelSelect}
                isModelActive={hasMasks}
                isModelRunning={runSegmentationLoading}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Re-run Segmentation Confirmation Dialog */}
      <AlertDialog open={rerunDialogOpen} onOpenChange={setRerunDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Re-run {MODEL_OPTIONS.find((o) => o.value === selectedModel)?.label} Segmentation?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                A cached <strong>{MODEL_OPTIONS.find((o) => o.value === selectedModel)?.label}</strong> result already exists for &quot;{projectData?.name}&quot;.
              </p>
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <p className="text-sm text-amber-900 dark:text-amber-100">
                  Re-running will dispatch a new GPU job and create a new mask document for this model. The other model&apos;s result is unaffected. Existing manual edits for this model will not be deleted, but the new AI output will appear alongside them.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedModel === "medsam"
                  ? "MedSAM requires GPU and may take 30–60 seconds."
                  : "UNet may run on CPU or GPU and typically completes in under a minute."}
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={runSegmentationLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRerun}
              disabled={runSegmentationLoading}
            >
              {runSegmentationLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Dispatching…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Yes, Re-run
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revert to AI Confirmation Dialog */}
      <AlertDialog open={revertDialogOpen} onOpenChange={setRevertDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Masks to AI Segmentation?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                This will replace <strong>all your manual edits</strong> with the original AI-generated segmentation masks for &quot;{projectData?.name}&quot;.
              </p>
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <p className="text-sm text-amber-900 dark:text-amber-100">
                  <strong>Warning:</strong> Any brush edits, refinements, or manual adjustments you&apos;ve made will be permanently lost.
                </p>
              </div>
              <p className="font-semibold text-sm">This action cannot be undone.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleRevertToAI} 
              disabled={isSaving}
              className="bg-amber-600 text-white hover:bg-amber-700"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reset Masks
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      </div>
    </div>
  );
}
