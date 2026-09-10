/**
 * exportResultsCsv — build a CSV of a project's stored analysis results and
 * trigger a download. Covers both segmentation models (UNet, MedSAM) so the
 * file is a complete record. Pulls stored values wherever they exist; missing
 * values are written as empty cells. The handful of prototype/placeholder
 * quantities the printed report also shows (RV GAS, RV disease-pattern
 * factors with no real classifier yet) are included too, so a CSV reader
 * doesn't need to cross-reference the PDF to know they exist — but every one
 * of them is labelled PROTOTYPE inline, never presented as a measured value.
 *
 * The CSV is sectioned (a blank line + a section header between blocks) rather
 * than one flat table, because the data is genuinely heterogeneous: scalar
 * measurements, health-status evidence lines, similarity rows, and a 17-segment
 * strain table don't share a column layout. Spreadsheet apps open this fine;
 * each section reads as its own small table.
 */

import type { MaskDoc, Model } from "@/hooks/useProjectResults";
import { computeRvDiseasePatterns, type Sex } from "@/lib/rvDiseasePattern";

// No RV area-strain (GAS) computation exists anywhere in the pipeline yet —
// same fixed placeholder the printed report shows (see report/page.tsx and
// InteractiveReport.tsx), so the CSV states the same caveat instead of
// silently omitting the metric a reader of the PDF would expect to also see
// noted here.
const RV_PEAK_GAS_PREVIEW = 28.7;

/** BSA/sex entered on the report screen — never persisted server-side, so
 *  this is the only way the export can know them. Optional: omit entirely
 *  and every indexed/RV-disease-pattern row below simply stays blank. */
export type ExportPatientContext = {
  bsaM2?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  sex?: Sex;
};

/** RFC-4180-ish quoting: wrap in quotes and double any embedded quotes. */
function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(...cells: unknown[]): string {
  return cells.map(cell).join(",");
}

const MODELS: Model[] = ["unet", "medsam"];
const MODEL_LABEL: Record<Model, string> = { unet: "UNet", medsam: "MedSAM" };

/** Max across the 17 AHA-segment ED wall-thickness values — same computation
 *  assembleSimilarityMeasurements does server-side for the HCM gate, and
 *  useProjectResults.ts duplicates client-side for the report's display. */
function maxWallThicknessMm(d: MaskDoc): number | null {
  const vals = (d.bullseye?.segment_values ?? []).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  return vals.length ? Math.max(...vals) : null;
}

export function buildResultsCsv(
  projectLabel: string,
  byModel: Record<Model, MaskDoc | null>,
  patient: ExportPatientContext = {},
): string {
  const lines: string[] = [];
  const present = MODELS.filter((m) => byModel[m]);
  const { bsaM2, heightCm, weightKg, sex } = patient;
  /** raw/bsaM2, matching the exact client-side division the report page and
   *  InteractiveReport.tsx use — never a backend-persisted value (see the
   *  end-to-end wiring notes: heartMetrics.bsa_m2 and every *I field are
   *  always null in the stored document; BSA only ever exists as this
   *  report-time, un-persisted convenience). */
  const idx = (raw: number | null | undefined): number | null =>
    bsaM2 && typeof raw === "number" ? raw / bsaM2 : null;

  lines.push(row("VisHeart — Cardiac Analysis Results"));
  lines.push(row("Patient", projectLabel));
  lines.push(row("Exported", new Date().toISOString()));
  lines.push(row("Models included", present.map((m) => MODEL_LABEL[m]).join(" / ") || "none"));
  lines.push(row(
    "Body surface area (BSA)",
    bsaM2 != null ? `${bsaM2.toFixed(2)} m² (${heightCm ?? "?"} cm, ${weightKg ?? "?"} kg)` : "not entered on the report screen",
  ));
  lines.push(row("Sex (for sex-specific RV cutoffs)", sex && sex !== "unspecified" ? sex : "not selected on the report screen"));
  lines.push("");

  // ── Measurements ────────────────────────────────────────────────────────
  lines.push(row("MEASUREMENTS"));
  lines.push(row("Metric", "Unit", ...present.map((m) => MODEL_LABEL[m])));
  const measRows: [string, string, (d: MaskDoc) => number | null | undefined][] = [
    ["Ejection Fraction (LV)", "%", (d) => d.heartMetrics?.measurements?.EF],
    ["End-Diastolic Volume (LV)", "mL", (d) => d.heartMetrics?.measurements?.EDV],
    ["End-Systolic Volume (LV)", "mL", (d) => d.heartMetrics?.measurements?.ESV],
    ["Stroke Volume (LV)", "mL", (d) => d.heartMetrics?.measurements?.StrokeVolume],
    ["LV Mass", "g", (d) => d.heartMetrics?.LV_mass_g],
    ["Max Wall Thickness (ED)", "mm", (d) => maxWallThicknessMm(d)],
    ["Peak GRS", "%", (d) => d.heartMetrics?.measurements?.PeakGRS],
    ["Peak GCS", "%", (d) => d.heartMetrics?.measurements?.PeakGCS],
    ["ED frame", "", (d) => d.heartMetrics?.ed_frame],
    ["ES frame", "", (d) => d.heartMetrics?.es_frame],
    // RV volumes are stored top-level on heartMetrics, not inside
    // `measurements` (which is the LV-only contract) — see useProjectResults.ts.
    ["RV Ejection Fraction", "%", (d) => d.heartMetrics?.RVEF],
    ["RV End-Diastolic Volume", "mL", (d) => d.heartMetrics?.RVEDV],
    ["RV End-Systolic Volume", "mL", (d) => d.heartMetrics?.RVESV],
    ["RV Stroke Volume", "mL", (d) => d.heartMetrics?.RV_SV],
    // RV strain isn't part of heartMetrics.measurements (it's a separate
    // cavity-radius measure, not GRS/GCS — see rvStrain), so pull its global
    // value straight from the series peak, falling back to the single ED→ES
    // result. Not a "Peak" label to avoid implying it's GRS/GCS-comparable.
    ["Global RV Strain", "%", (d) => d.rvStrainSeries?.peak_global_rv_strain ?? d.rvStrain?.global_rv_strain],
  ];
  for (const [label, unit, get] of measRows) {
    lines.push(row(label, unit, ...present.map((m) => {
      const v = get(byModel[m]!);
      return typeof v === "number" ? v : null;
    })));
  }
  // Prototype — no per-frame RV area-strain computation exists in this
  // pipeline yet; same fixed placeholder the printed report shows, never a
  // measured value. Always a flat row (not per-model) since it isn't derived
  // from either mask document.
  lines.push(row("RV Peak Global Area Strain (GAS) — PROTOTYPE, not computed", "%", ...present.map(() => RV_PEAK_GAS_PREVIEW)));
  lines.push("");

  // ── BSA-indexed volumes ─────────────────────────────────────────────────
  // Only meaningful once BSA is entered on the report screen — bsa_m2 is
  // never persisted server-side (see the end-to-end wiring audit), so this
  // is computed the same way the report page does it: raw/bsaM2, freshly,
  // from whatever height/weight were entered when this export was triggered.
  lines.push(row(bsaM2 != null ? "BSA-INDEXED VOLUMES" : "BSA-INDEXED VOLUMES (enter height/weight on the report screen to populate)"));
  lines.push(row("Metric", "Unit", ...present.map((m) => MODEL_LABEL[m])));
  const idxRows: [string, string, (d: MaskDoc) => number | null | undefined][] = [
    ["LV EDV Index (EDVI)", "mL/m²", (d) => idx(d.heartMetrics?.measurements?.EDV)],
    ["LV ESV Index (ESVI)", "mL/m²", (d) => idx(d.heartMetrics?.measurements?.ESV)],
    ["LV Mass Index (LVMI)", "g/m²", (d) => idx(d.heartMetrics?.LV_mass_g)],
    ["RV EDV Index (RVEDVI)", "mL/m²", (d) => idx(d.heartMetrics?.RVEDV)],
    ["RV ESV Index (RVESVI)", "mL/m²", (d) => idx(d.heartMetrics?.RVESV)],
    ["RV Stroke Volume Index (RV SVI)", "mL/m²", (d) => idx(d.heartMetrics?.RV_SV)],
  ];
  for (const [label, unit, get] of idxRows) {
    lines.push(row(label, unit, ...present.map((m) => {
      const v = get(byModel[m]!);
      return typeof v === "number" ? v : null;
    })));
  }
  lines.push("");

  // ── Health status ───────────────────────────────────────────────────────
  lines.push(row("HEALTH STATUS (rule-based — not a diagnosis)"));
  lines.push(row("Model", "Status", "Confidence", "Evidence"));
  for (const m of present) {
    const hs = byModel[m]!.healthStatus;
    if (!hs) { lines.push(row(MODEL_LABEL[m], "not computed")); continue; }
    const evidence = (hs.evidence ?? []).map((e) => `${e.label}: ${e.detail}`).join(" | ");
    lines.push(row(MODEL_LABEL[m], hs.status, hs.confidence, evidence));
  }
  lines.push("");

  // ── Disease pattern similarity ──────────────────────────────────────────
  lines.push(row("DISEASE PATTERN SIMILARITY (similarity comparison — not a diagnosis)"));
  lines.push(row("Model", "Headline", "Confidence", "Mode", "Gate", "Notes"));
  for (const m of present) {
    const ds = byModel[m]!.diseaseSimilarity;
    if (!ds) { lines.push(row(MODEL_LABEL[m], "not computed")); continue; }
    lines.push(row(
      MODEL_LABEL[m],
      ds.phenotype_headline ?? "",
      typeof ds.confidence === "number" ? ds.confidence.toFixed(2) : "",
      ds.mode ?? "",
      ds.gate?.reason ?? "",
      (ds.notes ?? []).join(" | "),
    ));
  }
  lines.push("");
  lines.push(row("Model", "Pattern", "Similarity %", "Reasoning"));
  for (const m of present) {
    const ds = byModel[m]!.diseaseSimilarity;
    if (!ds) { lines.push(row(MODEL_LABEL[m], "not computed")); continue; }
    for (const s of ds.similarities ?? []) {
      lines.push(row(
        MODEL_LABEL[m],
        `${s.label}${s.code === ds.most_similar ? " (most similar)" : ""}`,
        s.percent.toFixed(1),
        (s.reasons ?? []).join(" | "),
      ));
    }
  }
  lines.push("");

  // ── Regional health status (advisory, never changes the overall grade) ──
  lines.push(row("REGIONAL HEALTH STATUS (advisory — per-segment, doesn't change overall grade)"));
  lines.push(row("Model", "Status", "Reduced segment count", "Summary"));
  for (const m of present) {
    const rhs = byModel[m]!.regionalHealthStatus;
    if (!rhs) { lines.push(row(MODEL_LABEL[m], "not computed")); continue; }
    lines.push(row(MODEL_LABEL[m], rhs.status, rhs.reduced_count, rhs.summary));
  }
  lines.push("");

  // ── RV disease-pattern analysis (prototype scoring, not a diagnosis) ────
  // Entirely client-side (see rvDiseasePattern.ts) — never stored server-side
  // — so this recomputes it fresh from whatever's in `byModel` plus the
  // BSA/sex passed in, the same way InteractiveReport.tsx and the printed
  // report's DiseasePatternSimilarityPage do.
  lines.push(row("RV DISEASE PATTERN ANALYSIS — PROTOTYPE (rule-based similarity scoring, not a diagnosis)"));
  lines.push(row("Model", "Pattern", "Score /100", "Contributing factors"));
  for (const m of present) {
    const d = byModel[m]!;
    const rvedvi = idx(d.heartMetrics?.RVEDV);
    const rvesvi = idx(d.heartMetrics?.RVESV);
    const svi = idx(d.heartMetrics?.RV_SV);
    const patterns = computeRvDiseasePatterns({
      rvedvi, rvesvi, rvef: d.heartMetrics?.RVEF ?? null, svi,
      sex: sex ?? "unspecified",
      // Neither the RV regional-contraction classifier nor the GAS geometric
      // module exist in this pipeline yet — same placeholders the on-screen
      // card and printed report use.
      regionalContractionAbnormal: null,
      gasAbnormal: null,
    });
    for (const p of patterns) {
      const factors = p.factors
        .map((f) => `${f.detail}${f.status === "pending" ? " (PROTOTYPE — not assessed)" : ""}`)
        .join(" | ");
      lines.push(row(MODEL_LABEL[m], p.label, p.score, factors));
    }
  }
  lines.push("");

  // ── Per-segment strain (ED→ES) ──────────────────────────────────────────
  // The single ED→ES result carries per-segment GRS/GCS and wall thickness.
  lines.push(row("REGIONAL STRAIN — ED→ES (17 AHA segments)"));
  lines.push(row("Model", "Segment", "Label", "GRS %", "GCS %", "WT ED (mm)", "WT ES (mm)"));
  for (const m of present) {
    const segs = byModel[m]!.strain?.segments;
    if (!segs?.length) { lines.push(row(MODEL_LABEL[m], "not computed")); continue; }
    for (const s of segs) {
      lines.push(row(MODEL_LABEL[m], s.segment, s.label, s.grs, s.gcs,
        s.wt_ed_mm ?? null, s.wt_es_mm ?? null));
    }
  }
  lines.push("");

  // ── Per-frame strain series ─────────────────────────────────────────────
  // Long form: one row per model × frame × segment. Only emitted when a series
  // has been computed, and only for segments carrying data.
  lines.push(row("PER-FRAME STRAIN SERIES (global + per segment)"));
  lines.push(row("Model", "Frame", "Global GRS %", "Global GCS %", "Segment", "Label", "GRS %", "GCS %", "WT (mm)"));
  let anySeries = false;
  for (const m of present) {
    const ss = byModel[m]!.strainSeries;
    if (!ss?.frames?.length) continue;
    anySeries = true;
    for (const f of ss.frames) {
      for (const s of f.segments ?? []) {
        lines.push(row(MODEL_LABEL[m], f.frameIndex, f.global_grs, f.global_gcs,
          s.segment, s.label, s.grs, s.gcs, s.wt_mm ?? null));
      }
    }
  }
  if (!anySeries) lines.push(row("(no per-frame series computed for any model)"));
  lines.push("");

  // ── Per-region RV strain (ED→ES) ────────────────────────────────────────
  // RV strain is % change in cavity boundary radius (not wall thickness —
  // there's no separate RV free-wall myocardium label to ray-cast against),
  // over 6 basal/mid free-wall regions rather than 17 AHA segments. See
  // bullseye_analysis.mask_to_rv_regions for the full rationale.
  lines.push(row("REGIONAL RV STRAIN — ED→ES (6 free-wall regions)"));
  lines.push(row("Model", "Region", "Label", "RV Strain %", "Radius ED (mm)", "Radius ES (mm)"));
  for (const m of present) {
    const regions = byModel[m]!.rvStrain?.regions;
    if (!regions?.length) { lines.push(row(MODEL_LABEL[m], "not computed")); continue; }
    for (const r of regions) {
      lines.push(row(MODEL_LABEL[m], r.region, r.label, r.strain,
        r.radius_ed_mm ?? null, r.radius_es_mm ?? null));
    }
  }
  lines.push("");

  // ── Per-frame RV strain series ──────────────────────────────────────────
  lines.push(row("PER-FRAME RV STRAIN SERIES (global + per region)"));
  lines.push(row("Model", "Frame", "Global RV Strain %", "Region", "Label", "RV Strain %", "Radius (mm)"));
  let anyRvSeries = false;
  for (const m of present) {
    const rvs = byModel[m]!.rvStrainSeries;
    if (!rvs?.frames?.length) continue;
    anyRvSeries = true;
    for (const f of rvs.frames) {
      for (const r of f.regions ?? []) {
        lines.push(row(MODEL_LABEL[m], f.frameIndex, f.global_rv_strain,
          r.region, r.label, r.strain, r.radius_mm ?? null));
      }
    }
  }
  if (!anyRvSeries) lines.push(row("(no per-frame RV series computed for any model)"));

  return lines.join("\n");
}

/** Build the CSV and trigger a browser download. */
export function downloadResultsCsv(
  projectLabel: string,
  byModel: Record<Model, MaskDoc | null>,
  patient: ExportPatientContext = {},
): void {
  const csv = buildResultsCsv(projectLabel, byModel, patient);
  // Prepend a UTF-8 BOM so Excel reads unicode (e.g. the ES arrow) correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const safe = projectLabel.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40) || "results";
  const a = document.createElement("a");
  a.href = url;
  a.download = `visheart_${safe}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
