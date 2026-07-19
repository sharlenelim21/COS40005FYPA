"use client";

/**
 * Cardiac Analysis Results — standalone mockup page.
 *
 * Displays the REAL, stored per-model results for a project:
 *   • Heart metrics  (EF / EDV / ESV / SV / PeakGRS / PeakGCS) — from heartMetrics
 *   • Disease Pattern Similarity (NOR / HCM / DCM + reasoning) — from diseaseSimilarity
 *   • Health Status  — placeholder until Teammate B's rule-based module lands
 *
 * A UNet / MedSAM toggle selects which model's stored results to show. Each model
 * is a separate mask document (distinguished by `segmentationModel`), so this is a
 * pure display selector — no recompute. This page is a mockup stand-in until the
 * shared frontend/report is built.
 *
 * NOTE: Disease Pattern Similarity is NOT a diagnosis — it reports which known
 * cardiac reference pattern the measurements most resemble.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { segmentationApi } from "@/lib/api";
import { useProject } from "@/context/ProjectContext";
import { cn } from "@/lib/utils";

// ── Types mirroring the stored mask-document fields ─────────────────────────────

type Measurements = {
  EF: number | null;
  EDV: number | null;
  ESV: number | null;
  StrokeVolume: number | null;
  PeakGRS: number | null;
  PeakGCS: number | null;
};

type HeartMetrics = {
  measurements?: Measurements;
  ed_frame?: number;
  es_frame?: number;
  LV_mass_g?: number | null;
  warnings?: string[];
};

type SimilarityEntry = {
  code: "NOR" | "HCM" | "DCM";
  label: string;
  percent: number;
  distance: number;
  reasons: string[];
};

type DiseaseSimilarity = {
  most_similar: "NOR" | "HCM" | "DCM";
  similarities: SimilarityEntry[];
  features_used: string[];
  features_missing: string[];
  disclaimer: string;
  method: string;
  warnings: string[];
  computed_at: string;
};

type MaskDoc = {
  _id?: string;
  name?: string;
  isMedSAMOutput: boolean;
  segmentationModel?: string;
  model_used?: string;
  heartMetrics?: HeartMetrics;
  diseaseSimilarity?: DiseaseSimilarity;
};

type Model = "unet" | "medsam";

// ── Helpers ─────────────────────────────────────────────────────────────────────

const PATTERN_COLORS: Record<string, string> = {
  NOR: "#22c55e",
  HCM: "#f97316",
  DCM: "#dc2626",
};

function inferModel(m: MaskDoc): Model | null {
  const tag = (m.segmentationModel || m.model_used || "").toLowerCase();
  if (tag === "unet" || tag === "medsam") return tag;
  const name = (m.name || "").toLowerCase();
  if (name.includes("unet")) return "unet";
  if (name.includes("medsam")) return "medsam";
  return null;
}

function fmt(v: number | null | undefined, digits = 1, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}${suffix}`;
}

// ── Metric tile ─────────────────────────────────────────────────────────────────

function MetricTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function ResultsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { projectData } = useProject();

  const [masks, setMasks] = useState<MaskDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<Model>("unet");

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await segmentationApi.getSegmentationResults(projectId);
        if (cancelled) return;
        const editable = ((res.segmentations ?? []) as MaskDoc[]).filter((m) => !m.isMedSAMOutput);
        setMasks(editable);
      } catch {
        if (!cancelled) setError("Failed to load results. Ensure the project has been processed.");
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  // Group editable masks by model, and pick the doc that has the richest data.
  const byModel = useMemo(() => {
    const pick = (want: Model): MaskDoc | null => {
      const candidates = (masks ?? []).filter((m) => inferModel(m) === want);
      if (candidates.length === 0) return null;
      // Prefer a doc that actually has metrics/similarity computed.
      return (
        candidates.find((m) => m.heartMetrics?.measurements || m.diseaseSimilarity) ??
        candidates[0]
      );
    };
    return { unet: pick("unet"), medsam: pick("medsam") };
  }, [masks]);

  const available: Record<Model, boolean> = {
    unet: !!byModel.unet,
    medsam: !!byModel.medsam,
  };

  // If the default model has no data but the other does, switch to the one with data.
  useEffect(() => {
    if (masks === null) return;
    if (!available[model] && available[model === "unet" ? "medsam" : "unet"]) {
      setModel(model === "unet" ? "medsam" : "unet");
    }
  }, [masks, available, model]);

  const doc = byModel[model];
  const measurements = doc?.heartMetrics?.measurements;
  const similarity = doc?.diseaseSimilarity;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Cardiac Analysis Results</h1>
        <p className="text-sm text-muted-foreground">
          {projectData?.name ? `Patient: ${projectData.name}` : "Project results"}
          <span className="mx-2 text-muted-foreground/40">·</span>
          Mockup preview of stored per-model results
        </p>
      </div>

      {/* Model toggle */}
      <div className="mb-6 inline-flex rounded-lg border border-border bg-background p-0.5">
        {(["unet", "medsam"] as Model[]).map((m) => (
          <button
            key={m}
            type="button"
            disabled={!available[m]}
            onClick={() => setModel(m)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
              model === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              !available[m] && "cursor-not-allowed opacity-40",
            )}
          >
            {m === "unet" ? "UNet" : "MedSAM"}
            {!available[m] && " (no data)"}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {masks === null && !error && (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">Loading results…</div>
      )}

      {masks !== null && !doc && !error && (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No results found for this project. Run segmentation, landmark detection, and strain first.
        </div>
      )}

      {doc && (
        <div className="flex flex-col gap-6">
          {/* ── Measurements ── */}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Measurements</h2>
            {measurements ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <MetricTile label="Ejection Fraction" value={fmt(measurements.EF, 1, " %")} />
                <MetricTile label="EDV" value={fmt(measurements.EDV, 1, " mL")} sub={doc.heartMetrics?.ed_frame != null ? `ED frame ${doc.heartMetrics.ed_frame}` : undefined} />
                <MetricTile label="ESV" value={fmt(measurements.ESV, 1, " mL")} sub={doc.heartMetrics?.es_frame != null ? `ES frame ${doc.heartMetrics.es_frame}` : undefined} />
                <MetricTile label="Stroke Volume" value={fmt(measurements.StrokeVolume, 1, " mL")} />
                <MetricTile label="Peak GRS" value={fmt(measurements.PeakGRS, 1, " %")} sub={measurements.PeakGRS == null ? "run strain at ED/ES" : undefined} />
                <MetricTile label="Peak GCS" value={fmt(measurements.PeakGCS, 1, " %")} sub={measurements.PeakGCS == null ? "run strain at ED/ES" : undefined} />
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                Heart metrics not computed for this model yet.
              </div>
            )}
          </section>

          {/* ── Health Status (placeholder) ── */}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Health Status</h2>
            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
              Rule-based health-status assessment is pending — this module is not yet integrated.
            </div>
          </section>

          {/* ── Disease Pattern Similarity ── */}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Disease Pattern Similarity
            </h2>
            {similarity ? (
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-baseline gap-2">
                  <span className="text-xs text-muted-foreground">Most similar pattern:</span>
                  <span className="text-sm font-semibold text-foreground">
                    {similarity.similarities.find((s) => s.code === similarity.most_similar)?.label ?? similarity.most_similar}
                  </span>
                </div>

                {/* Bars */}
                <div className="flex flex-col gap-2">
                  {similarity.similarities.map((s) => (
                    <div key={s.code} className="flex items-center gap-3">
                      <span className="w-10 text-xs font-medium text-foreground">{s.code}</span>
                      <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${Math.max(0, Math.min(100, s.percent))}%`, backgroundColor: PATTERN_COLORS[s.code] }}
                        />
                      </div>
                      <span className="w-12 text-right text-xs font-mono text-muted-foreground">{s.percent.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>

                {/* Reasoning for the top match */}
                {(() => {
                  const top = similarity.similarities.find((s) => s.code === similarity.most_similar);
                  if (!top?.reasons?.length) return null;
                  return (
                    <div className="mt-4">
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Reasoning</div>
                      <ul className="flex flex-col gap-1">
                        {top.reasons.map((r, i) => (
                          <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                            <span className="text-muted-foreground/50">•</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                {similarity.features_missing.length > 0 && (
                  <div className="mt-3 text-[11px] text-amber-600 dark:text-amber-400">
                    Missing features: {similarity.features_missing.join(", ")} — similarity uses the available metrics only.
                  </div>
                )}

                <p className="mt-4 border-t border-border pt-3 text-[11px] italic text-muted-foreground">
                  {similarity.disclaimer}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                Disease similarity not computed for this model yet — run strain (Choose frames) to trigger it.
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
