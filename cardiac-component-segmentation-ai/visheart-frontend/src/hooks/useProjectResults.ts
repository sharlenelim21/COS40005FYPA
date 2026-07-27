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

import { useEffect, useMemo, useRef, useState } from "react";
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

export type HeartMetrics = {
  measurements?: Measurements;
  ed_frame?: number;
  es_frame?: number;
  LV_mass_g?: number | null;
  warnings?: string[];
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

/** Single ED→ES strain result (global peaks + 17 AHA segments). */
export type Strain = {
  segments: { segment: number; label: string; grs: number | null; gcs: number | null }[];
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

export type MaskDoc = {
  _id?: string;
  name?: string;
  isMedSAMOutput: boolean;
  segmentationModel?: string;
  model_used?: string;
  heartMetrics?: HeartMetrics;
  diseaseSimilarity?: DiseaseSimilarity;
  healthStatus?: HealthStatus;
  strain?: Strain;
  strainSeries?: StrainSeries;
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

export function useProjectResults(
  projectId: string | undefined,
  autoSelect: AutoSelect = "prefer-unet",
) {
  const [masks, setMasks] = useState<MaskDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<Model>("unet");
  const userChoseModel = useRef(false);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await segmentationApi.getSegmentationResults(projectId);
        if (cancelled) return;
        // Editable masks carry the computed fields; raw MedSAM output does not.
        const editable = ((res.segmentations ?? []) as MaskDoc[]).filter((m) => !m.isMedSAMOutput);
        setMasks(editable);
      } catch {
        if (!cancelled) setError("Failed to load results. Ensure the project has been processed.");
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // Group by model, preferring whichever doc actually has computed data.
  const byModel = useMemo(() => {
    const pick = (want: Model): MaskDoc | null => {
      const candidates = (masks ?? []).filter((m) => inferModel(m) === want);
      if (candidates.length === 0) return null;
      return (
        candidates.find(
          (m) => m.heartMetrics?.measurements || m.diseaseSimilarity || m.healthStatus ||
                 m.strain || m.strainSeries,
        ) ?? candidates[0]
      );
    };
    return { unet: pick("unet"), medsam: pick("medsam") };
  }, [masks]);

  const available: Record<Model, boolean> = {
    unet: !!byModel.unet,
    medsam: !!byModel.medsam,
  };

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
    model,
    setModel,
    chooseModel,
    available,
    doc,
    measurements: doc?.heartMetrics?.measurements,
    healthStatus: doc?.healthStatus,
    similarity: doc?.diseaseSimilarity,
    strain: doc?.strain,
    strainSeries: doc?.strainSeries,
    // Auto-detected cardiac phase frames (largest / smallest LV cavity).
    // Strain is only physiologically meaningful measured against these.
    autoEdFrame: doc?.heartMetrics?.ed_frame,
    autoEsFrame: doc?.heartMetrics?.es_frame,
  };
}
