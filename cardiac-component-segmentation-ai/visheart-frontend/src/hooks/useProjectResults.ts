"use client";

/**
 * useProjectResults — single source of truth for a project's stored, per-model
 * analysis results (heart metrics, health status, disease similarity).
 *
 * Both the interactive results page and the printable report read from here so
 * they can never disagree about what the pipeline actually produced. Each
 * segmentation model (UNet / MedSAM) is a separate mask document distinguished
 * by `segmentationModel`, so switching model is a pure display selector — no
 * recompute is triggered.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { segmentationApi } from "@/lib/api";

// ── Types mirroring the stored mask-document fields ─────────────────────────────

export type Measurements = {
  EF: number | null;
  EDV: number | null;
  ESV: number | null;
  StrokeVolume: number | null;
  PeakGRS: number | null;
  PeakGCS: number | null;
};

/**
 * Right-ventricular metrics.
 *
 * These are stored at the TOP LEVEL of `heartMetrics` by
 * compute_heart_metrics_from_rle.py — deliberately NOT inside `measurements`,
 * which is the LV-only contract the report/similarity modules consume. They
 * were already being computed and persisted; they simply weren't surfaced to
 * the frontend until now.
 *
 * All optional: a mask with no RV cavity yields nulls (the Python emits a
 * warning and sets RVEF/RV_SV to null rather than dividing by zero), and older
 * documents predate the fields entirely.
 */
export type RvMetrics = {
  RVEDV: number | null;
  RVESV: number | null;
  RV_SV: number | null;
  RVEF: number | null;
  /** Per-frame RV volume curve, index = frameindex. */
  rv_volumes_ml?: (number | null)[];
};

export type HeartMetrics = {
  measurements?: Measurements;
  /** LV end-diastolic volume — the LV twin of RVEDV, kept top-level by the
   *  backend for the same reason (measurements is the flat report contract). */
  LVEDV?: number | null;
  LVESV?: number | null;
  LV_SV?: number | null;
  LVEF?: number | null;
  RVEDV?: number | null;
  RVESV?: number | null;
  RV_SV?: number | null;
  RVEF?: number | null;
  rv_volumes_ml?: (number | null)[];
  ed_frame?: number;
  es_frame?: number;
  LV_mass_g?: number | null;
  warnings?: string[];
  /** Set by the backend on every write — lets a forced recompute detect that a
   *  NEW result landed rather than just seeing the old one still present. */
  computed_at?: string;
};

export type SimilarityEntry = {
  code: "NOR" | "HCM" | "DCM";
  label: string;
  percent: number;
  distance: number;
  reasons: string[];
};

export type DiseaseSimilarity = {
  most_similar: "NOR" | "HCM" | "DCM";
  similarities: SimilarityEntry[];
  features_used: string[];
  features_missing: string[];
  disclaimer: string;
  method: string;
  warnings: string[];
  computed_at: string;
};

export type HealthStatus = {
  status: "Healthy" | "Mild" | "Moderate" | "Severe" | "Indeterminate";
  confidence: "normal" | "low";
  grade_from_ef: "Healthy" | "Mild" | "Moderate" | "Severe" | "Indeterminate";
  evidence: { label: string; level: "ok" | "warn"; detail: string }[];
  features_used: string[];
  features_missing: string[];
  disclaimer: string;
  method: string;
  warnings: string[];
  computed_at: string;
};

/**
 * Layer 2 — advisory per-AHA-segment assessment. Sits BESIDE `healthStatus` and
 * never changes it (`overall_grade_unchanged` is always true). `status` is
 * "unavailable" — never "healthy" — when regional strain is missing or its
 * ED/ES frames don't align with the auto-detected ones.
 */
export type RegionalHealthStatus = {
  status: "ok" | "unavailable";
  overall_grade_unchanged: true;
  source: "strain" | "strainSeries" | null;
  segments: {
    idx: number;
    region: "basal" | "mid" | "apical" | "apex";
    label?: string;
    gcs: number;
    grs: number | null;
    level: "normal" | "mild" | "moderate" | "severe";
    abs_level: "normal" | "mild" | "moderate" | "severe";
    rel_gap: number;
    rel_flag: boolean;
  }[];
  reduced_count: number;
  affected_idx: number[];
  skipped_idx: number[];
  summary: string;
  patient_mean_gcs: number | null;
  relative_rule_applied?: boolean;
  disclaimer: string;
  method: string;
  warnings: string[];
  computed_at: string;
};

/** Single ED→ES strain result (global peaks + 17 AHA segments). */
export type Strain = {
  segments: {
    segment: number; label: string; grs: number | null; gcs: number | null;
    wt_ed_mm?: number | null; wt_es_mm?: number | null;
  }[];
  global_grs: number | null;
  global_gcs: number | null;
  edFrameIndex?: number;
  esFrameIndex?: number;
  computed_at?: string;
  /** Set when landmarks were edited after this was computed; cleared on recompute. */
  staleSince?: string;
};

/**
 * Per-frame strain series — every stored frame measured against the fixed ED
 * reference, so the UI can plot a full-cycle curve. Written by
 * POST /segmentation/compute-strain-series; absent until that route is run.
 */
export type StrainSeries = {
  frames: {
    frameIndex: number;
    global_grs: number | null;
    global_gcs: number | null;
    segments: {
      segment: number;
      label: string;
      grs: number | null;
      gcs: number | null;
      /** Wall thickness at this frame (mm) — drives the animated AHA bullseye. */
      wt_mm?: number | null;
    }[];
  }[];
  edFrameIndex: number;
  peakFrameIndex?: number | null;
  peak_global_grs: number | null;
  peak_global_gcs: number | null;
  framesRequested?: number;
  framesComputed?: number;
  computed_at?: string;
  /** Set when landmarks were edited after this was computed; cleared on recompute. */
  staleSince?: string;
};

/**
 * Regional RV strain — sibling to `Strain`/`StrainSeries` above. `strain` per
 * region is % change in RV cavity boundary radius, not wall thickness (there
 * is no separate RV free-wall myocardium label) — see the backend's
 * bullseye_analysis.mask_to_rv_regions for the full rationale. No GRS/GCS
 * split: it's a single radius-based measure, closer in spirit to GCS.
 */
export type RvStrain = {
  regions: { region: number; label: string; strain: number | null }[];
  global_rv_strain: number | null;
  edFrameIndex?: number;
  esFrameIndex?: number;
  computed_at?: string;
};

export type RvStrainSeries = {
  frames: {
    frameIndex: number;
    global_rv_strain: number | null;
    regions: { region: number; label: string; strain: number | null }[];
  }[];
  edFrameIndex: number;
  peakFrameIndex?: number | null;
  peak_global_rv_strain: number | null;
  framesRequested?: number;
  framesComputed?: number;
  computed_at?: string;
};

export type MaskDoc = {
  _id?: string;
  name?: string;
  isMedSAMOutput: boolean;
  segmentationModel?: string;
  model_used?: string;
  heartMetrics?: HeartMetrics;
  diseaseSimilarity?: DiseaseSimilarity;
  healthStatus?: HealthStatus;
  regionalHealthStatus?: RegionalHealthStatus;
  strain?: Strain;
  strainSeries?: StrainSeries;
  rvStrain?: RvStrain;
  rvStrainSeries?: RvStrainSeries;
};

export type Model = "unet" | "medsam";

// ── Helpers ─────────────────────────────────────────────────────────────────────

export function inferModel(m: MaskDoc): Model | null {
  const tag = (m.segmentationModel || m.model_used || "").toLowerCase();
  if (tag === "unet" || tag === "medsam") return tag;
  const name = (m.name || "").toLowerCase();
  if (name.includes("unet")) return "unet";
  if (name.includes("medsam")) return "medsam";
  return null;
}

/** Format a possibly-null metric; returns an em dash when unavailable. */
export function fmt(v: number | null | undefined, digits = 1, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}${suffix}`;
}

// ── Hook ────────────────────────────────────────────────────────────────────────

/** When to auto-select a model. "recent" picks whichever was computed last. */
type AutoSelect = "prefer-unet" | "recent";

/**
 * Status of the automatic analysis compute (see `autoCompute` below).
 *   idle      — nothing to do, or not started
 *   computing — a trigger has fired and we're polling for the result
 *   error     — the trigger failed, or the result never appeared in time
 */
export type ComputeState = "idle" | "computing" | "error";

/** How long to wait for an async backend compute before giving up. */
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 20; // ~30 s

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Module-level cache of the last-fetched masks per project. The page mounts this
 * hook several times (bullseye panel, strain tab, etc.), and the sidebar remounts
 * on every tab switch. Without a shared cache each instance starts at masks=null
 * and shows an empty flash until its own fetch returns — the "switch to Strain,
 * see nothing, then results appear" glitch. Seeding from the cache removes the
 * flash; the fetch still runs to refresh.
 */
const masksCache = new Map<string, MaskDoc[]>();

export function useProjectResults(
  projectId: string | undefined,
  autoSelect: AutoSelect = "prefer-unet",
  opts: {
    /**
     * When true (default), the hook makes the displayed model's results
     * self-healing: if the selected mask has no heartMetrics / healthStatus /
     * diseaseSimilarity, it fires the corresponding trigger endpoints and polls
     * until the results land, then re-renders with the real numbers.
     *
     * Why this exists: those three fields are only ever written by the
     * reconstruction pipeline or an explicit trigger call. A project that was
     * segmented but never reconstructed therefore showed permanent em-dashes on
     * the results/report pages, because nothing in the UI ever asked for the
     * compute. Pass false to get the old read-only behaviour.
     */
    autoCompute?: boolean;
  } = {},
) {
  const { autoCompute = true } = opts;
  const [masks, setMasks] = useState<MaskDoc[] | null>(
    projectId ? masksCache.get(projectId) ?? null : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<Model>("unet");
  const [computeState, setComputeState] = useState<ComputeState>("idle");
  const [computeError, setComputeError] = useState<string | null>(null);
  const userChoseModel = useRef(false);
  // Masks we've already tried to compute this session, so a failed or partial
  // compute can't spin into an infinite trigger loop when the doc re-renders.
  const attempted = useRef<Set<string>>(new Set());

  /** Fetch the project's editable masks and push them into state. Returns the
   *  fresh array so callers (the poller) can inspect it without waiting for
   *  React state to settle. */
  const loadMasks = useCallback(async (): Promise<MaskDoc[] | null> => {
    if (!projectId) return null;
    const res = await segmentationApi.getSegmentationResults(projectId);
    // Editable masks carry the computed fields; raw MedSAM output does not.
    const editable = ((res.segmentations ?? []) as MaskDoc[]).filter((m) => !m.isMedSAMOutput);
    setMasks(editable);
    return editable;
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    // Seed synchronously from cache so a remount never flashes empty.
    const cached = masksCache.get(projectId);
    if (cached) setMasks(cached);

    let cancelled = false;
    (async () => {
      try {
        const res = await segmentationApi.getSegmentationResults(projectId);
        if (cancelled) return;
        // Editable masks carry the computed fields; raw MedSAM output does not.
        const editable = ((res.segmentations ?? []) as MaskDoc[]).filter((m) => !m.isMedSAMOutput);
        masksCache.set(projectId, editable);
        setMasks(editable);
      } catch {
        if (!cancelled && !cached) setError("Failed to load results. Ensure the project has been processed.");
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, loadMasks]);

  // Group by model, preferring whichever doc actually has computed data.
  const byModel = useMemo(() => {
    const pick = (want: Model): MaskDoc | null => {
      const candidates = (masks ?? []).filter((m) => inferModel(m) === want);
      if (candidates.length === 0) return null;
      // Newest first — ObjectIds are monotonic by creation time. The backend
      // now prunes superseded masks on re-run so there is normally one per
      // model, but ordering explicitly means that when duplicates DO exist
      // (legacy data, or pruning disabled) the newest run wins deterministically
      // instead of depending on the order the API happened to return.
      const newestFirst = [...candidates].sort((a, b) =>
        String(b._id ?? "").localeCompare(String(a._id ?? "")),
      );
      // Still prefer a doc that actually has results: results live on the mask
      // they were computed for, so falling back to a populated older doc beats
      // showing an empty newer one. `newerMaskAvailable` flags when that happens.
      return (
        newestFirst.find(
          (m) => m.heartMetrics?.measurements || m.diseaseSimilarity || m.healthStatus ||
                 m.strain || m.strainSeries || m.rvStrain || m.rvStrainSeries,
        ) ?? newestFirst[0]
      );
    };
    return { unet: pick("unet"), medsam: pick("medsam") };
  }, [masks]);

  const available: Record<Model, boolean> = {
    unet: !!byModel.unet,
    medsam: !!byModel.medsam,
  };

  /**
   * True when a NEWER editable mask exists for the displayed model but carries
   * no computed results, so `pick()` fell back to an older doc that does.
   *
   * Why surface it rather than just switching: each segmentation job creates a
   * fresh mask document, and results live on the document they were computed
   * for. Silently jumping to the newest mask would blank the strain chart
   * (strain is computed per-mask and isn't auto-recomputed), so we keep showing
   * the populated doc and let the page say the run is stale instead.
   *
   * Mongo ObjectIds are monotonic by creation time, so a plain string compare
   * orders masks without needing a timestamp field on the wire.
   */
  const newerMaskAvailable = useMemo(() => {
    const shown = byModel[model];
    if (!shown?._id) return false;
    const candidates = (masks ?? []).filter((m) => inferModel(m) === model && m._id);
    return candidates.some(
      (m) =>
        String(m._id) > String(shown._id) &&
        !m.heartMetrics?.measurements && !m.healthStatus && !m.diseaseSimilarity &&
        !m.strain && !m.strainSeries && !m.rvStrain && !m.rvStrainSeries,
    );
  }, [masks, byModel, model]);

  // Most recent time anything was computed for a model — used to default to the
  // freshest run. Takes the newest of the timestamps the doc carries.
  const computedAtFor = (m: MaskDoc | null): number => {
    if (!m) return 0;
    const stamps = [
      m.strainSeries?.computed_at,
      m.strain?.computed_at,
      m.diseaseSimilarity?.computed_at,
      m.healthStatus?.computed_at,
    ]
      .filter(Boolean)
      .map((s) => Date.parse(s as string))
      .filter((n) => !Number.isNaN(n));
    return stamps.length ? Math.max(...stamps) : 0;
  };

  // Auto-select a model once data arrives, unless the caller has switched
  // manually. "recent" picks the freshest run (the report wants one report,
  // most-recent); "prefer-unet" keeps UNet when it has data and only falls back.
  useEffect(() => {
    if (masks === null || userChoseModel.current) return;
    const other: Model = model === "unet" ? "medsam" : "unet";
    if (autoSelect === "recent") {
      if (!available.unet && !available.medsam) return;
      let pick: Model;
      if (available.unet && available.medsam) {
        pick = computedAtFor(byModel.medsam) > computedAtFor(byModel.unet) ? "medsam" : "unet";
      } else {
        pick = available.unet ? "unet" : "medsam";
      }
      if (pick !== model) setModel(pick);
    } else if (!available[model] && available[other]) {
      setModel(other);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masks, available.unet, available.medsam, autoSelect]);

  /** Switch model and stop auto-selection from overriding the choice. */
  const chooseModel = (m: Model) => {
    userChoseModel.current = true;
    setModel(m);
  };

  const doc = byModel[model];

  // ── Self-healing analysis compute ─────────────────────────────────────────
  /**
   * Make sure `maskId` has heart metrics, health status and disease similarity,
   * firing whichever triggers are missing and polling until the results land.
   *
   * Order matters: health status and disease similarity both read
   * `heartMetrics.measurements` server-side and return 400 without it, so
   * volumes must complete first. Health status is normally auto-chained by the
   * heart-metrics compute, so step 2 is usually a no-op.
   *
   * Only step 1 is treated as fatal — if volumes computed but similarity timed
   * out, the page still shows real EF/EDV/ESV rather than reverting to dashes.
   */
  const ensureComputed = useCallback(
    async (maskId: string, force = false) => {
      setComputeState("computing");
      setComputeError(null);

      const pick = (list: MaskDoc[] | null) => list?.find((m) => m._id === maskId) ?? null;

      /** Poll until `done(mask)` holds. Returns the mask, or null on timeout. */
      const pollUntil = async (done: (m: MaskDoc) => boolean): Promise<MaskDoc | null> => {
        for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
          await sleep(POLL_INTERVAL_MS);
          try {
            const m = pick(await loadMasks());
            if (m && done(m)) return m;
          } catch {
            /* transient network error — keep polling */
          }
        }
        return null;
      };

      try {
        let current = pick(await loadMasks());
        if (!current) {
          setComputeState("idle");
          return;
        }

        // 1. Volumes / EF / LV mass — the dependency for everything below.
        if (force || !current.heartMetrics?.measurements) {
          const before = current.heartMetrics?.computed_at;
          await segmentationApi.triggerHeartMetrics(maskId);
          const m = await pollUntil((x) =>
            !!x.heartMetrics?.measurements &&
            (!force || x.heartMetrics?.computed_at !== before),
          );
          if (!m) {
            setComputeError(
              "Heart metrics did not finish in time. Check the backend log for [HeartMetrics].",
            );
            setComputeState("error");
            return;
          }
          current = m;
        }

        // 2. Health status — usually already chained by step 1.
        if (force || !current.healthStatus) {
          const before = current.healthStatus?.computed_at;
          await segmentationApi.triggerHealthStatus(maskId);
          current =
            (await pollUntil((x) =>
              !!x.healthStatus && (!force || x.healthStatus?.computed_at !== before),
            )) ?? current;
        }

        // 3. Disease similarity — depends on measurements, so it runs last.
        if (force || !current.diseaseSimilarity) {
          const before = current.diseaseSimilarity?.computed_at;
          await segmentationApi.triggerDiseaseSimilarity(maskId);
          current =
            (await pollUntil((x) =>
              !!x.diseaseSimilarity &&
              (!force || x.diseaseSimilarity?.computed_at !== before),
            )) ?? current;
        }

        // 4. Regional (Layer 2) — advisory. Depends on per-segment STRAIN, not
        //    on measurements, so it is independent of steps 2-3 and is attempted
        //    even if they failed. It resolves either way: when strain is missing
        //    or misaligned it stores status "unavailable" rather than erroring,
        //    so there is nothing to treat as a failure here.
        if (force || !current.regionalHealthStatus) {
          const before = current.regionalHealthStatus?.computed_at;
          await segmentationApi.triggerRegionalHealthStatus(maskId);
          current =
            (await pollUntil((x) =>
              !!x.regionalHealthStatus &&
              (!force || x.regionalHealthStatus?.computed_at !== before),
            )) ?? current;
        }

        setComputeState("idle");
      } catch (e: unknown) {
        const err = e as { response?: { data?: { message?: string } }; message?: string };
        setComputeError(
          err?.response?.data?.message ?? err?.message ?? "Analysis compute failed.",
        );
        setComputeState("error");
      }
    },
    [loadMasks],
  );

  // Fire the compute once per mask when the displayed doc is missing results.
  // Guarded by `attempted` so a timeout or a 400 can't retrigger on every
  // re-render — the user can still retry explicitly via recompute().
  useEffect(() => {
    if (!autoCompute) return;
    const id = doc?._id;
    if (!id) return;
    const complete =
      !!doc?.heartMetrics?.measurements && !!doc?.healthStatus && !!doc?.diseaseSimilarity;
    if (complete || attempted.current.has(id)) return;
    attempted.current.add(id);
    void ensureComputed(id);
  }, [doc, autoCompute, ensureComputed]);

  /** Force a fresh recompute of all three analyses for the displayed mask. */
  const recompute = useCallback(async () => {
    const id = doc?._id;
    if (!id) return;
    attempted.current.add(id);
    await ensureComputed(id, true);
  }, [doc, ensureComputed]);

  /**
   * Which models have a usable per-frame strain series (one carrying wall
   * thickness). Lets callers disable a model rather than switching to it and
   * finding an empty panel, and pick a sensible default.
   */
  const seriesByModel = useMemo(() => {
    const info = (m: MaskDoc | null) => {
      const s = m?.strainSeries;
      const hasThickness = !!s?.frames?.some((f) =>
        f.segments?.some((seg) => typeof seg.wt_mm === "number"),
      );
      return {
        has: hasThickness,
        computedAt: hasThickness && s?.computed_at ? Date.parse(s.computed_at) : null,
      };
    };
    return { unet: info(byModel.unet), medsam: info(byModel.medsam) };
  }, [byModel]);

  const seriesAvailable: Record<Model, boolean> = {
    unet: seriesByModel.unet.has,
    medsam: seriesByModel.medsam.has,
  };

  return {
    seriesAvailable,
    seriesComputedAt: {
      unet: seriesByModel.unet.computedAt,
      medsam: seriesByModel.medsam.computedAt,
    },
    masks,
    error,
    loading: masks === null && !error,
    /** "computing" while the analysis triggers are running/polling. */
    computeState,
    computeError,
    /** True when results are absent *because* a compute is still in flight —
     *  lets the UI say "Computing…" instead of "Not computed yet". */
    computing: computeState === "computing",
    /** Force a fresh recompute of metrics + status + similarity. */
    recompute,
    /** A newer segmentation run exists for this model but has no results yet —
     *  what's displayed comes from an earlier run. */
    newerMaskAvailable,
    /** Re-read the masks without triggering any compute. */
    refresh: loadMasks,
    model,
    setModel,
    chooseModel,
    available,
    doc,
    /** Both models' full mask docs — for exports that cover UNet and MedSAM. */
    byModel,
    measurements: doc?.heartMetrics?.measurements,
    /**
     * RV metrics, surfaced separately from `measurements` so the LV-only
     * contract that feeds health status and disease similarity is unchanged.
     * `null` when the mask has no RV cavity — callers must handle that rather
     * than rendering NaN.
     */
    rv: doc?.heartMetrics
      ? {
          RVEDV: doc.heartMetrics.RVEDV ?? null,
          RVESV: doc.heartMetrics.RVESV ?? null,
          RV_SV: doc.heartMetrics.RV_SV ?? null,
          RVEF: doc.heartMetrics.RVEF ?? null,
          rv_volumes_ml: doc.heartMetrics.rv_volumes_ml,
        }
      : undefined,
    /** LV volumes as stored top-level — used for the RV:LV ratio, which needs
     *  LVEDV alongside RVEDV. `measurements.EDV` is the same number. */
    lvVolumes: doc?.heartMetrics
      ? { LVEDV: doc.heartMetrics.LVEDV ?? null, LV_SV: doc.heartMetrics.LV_SV ?? null }
      : undefined,
    healthStatus: doc?.healthStatus,
    /** Layer 2 — advisory regional assessment; never changes healthStatus. */
    regionalHealthStatus: doc?.regionalHealthStatus,
    similarity: doc?.diseaseSimilarity,
    strain: doc?.strain,
    strainSeries: doc?.strainSeries,
    rvStrain: doc?.rvStrain,
    rvStrainSeries: doc?.rvStrainSeries,
    // Auto-detected cardiac phase frames (largest / smallest LV cavity).
    // Strain is only physiologically meaningful measured against these.
    autoEdFrame: doc?.heartMetrics?.ed_frame,
    autoEsFrame: doc?.heartMetrics?.es_frame,
  };
}
