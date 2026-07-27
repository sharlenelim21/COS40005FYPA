/**
 * exportResultsCsv — build a CSV of a project's stored analysis results and
 * trigger a download. Covers both segmentation models (UNet, MedSAM) so the
 * file is a complete record, and pulls only real stored values — nothing is
 * fabricated; missing values are written as empty cells.
 *
 * The CSV is sectioned (a blank line + a section header between blocks) rather
 * than one flat table, because the data is genuinely heterogeneous: scalar
 * measurements, health-status evidence lines, similarity rows, and a 17-segment
 * strain table don't share a column layout. Spreadsheet apps open this fine;
 * each section reads as its own small table.
 */

import type { MaskDoc, Model } from "@/hooks/useProjectResults";

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

export function buildResultsCsv(
  projectLabel: string,
  byModel: Record<Model, MaskDoc | null>,
): string {
  const lines: string[] = [];
  const present = MODELS.filter((m) => byModel[m]);

  lines.push(row("VisHeart — Cardiac Analysis Results"));
  lines.push(row("Patient", projectLabel));
  lines.push(row("Exported", new Date().toISOString()));
  lines.push(row("Models included", present.map((m) => MODEL_LABEL[m]).join(" / ") || "none"));
  lines.push("");

  // ── Measurements ────────────────────────────────────────────────────────
  lines.push(row("MEASUREMENTS"));
  lines.push(row("Metric", "Unit", ...present.map((m) => MODEL_LABEL[m])));
  const measRows: [string, string, (d: MaskDoc) => number | null | undefined][] = [
    ["Ejection Fraction", "%", (d) => d.heartMetrics?.measurements?.EF],
    ["End-Diastolic Volume", "mL", (d) => d.heartMetrics?.measurements?.EDV],
    ["End-Systolic Volume", "mL", (d) => d.heartMetrics?.measurements?.ESV],
    ["Stroke Volume", "mL", (d) => d.heartMetrics?.measurements?.StrokeVolume],
    ["Peak GRS", "%", (d) => d.heartMetrics?.measurements?.PeakGRS],
    ["Peak GCS", "%", (d) => d.heartMetrics?.measurements?.PeakGCS],
    ["ED frame", "", (d) => d.heartMetrics?.ed_frame],
    ["ES frame", "", (d) => d.heartMetrics?.es_frame],
  ];
  for (const [label, unit, get] of measRows) {
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

  // ── Per-segment strain (ED→ES) ──────────────────────────────────────────
  // The single ED→ES result carries per-segment GRS/GCS and wall thickness.
  lines.push(row("REGIONAL STRAIN — ED→ES (17 AHA segments)"));
  lines.push(row("Model", "Segment", "Label", "GRS %", "GCS %", "WT ED (mm)", "WT ES (mm)"));
  for (const m of present) {
    const segs = byModel[m]!.strain?.segments;
    if (!segs?.length) { lines.push(row(MODEL_LABEL[m], "not computed")); continue; }
    for (const s of segs) {
      lines.push(row(MODEL_LABEL[m], s.segment, s.label, s.grs, s.gcs,
        (s as any).wt_ed_mm ?? null, (s as any).wt_es_mm ?? null));
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
          s.segment, s.label, s.grs, s.gcs, (s as any).wt_mm ?? null));
      }
    }
  }
  if (!anySeries) lines.push(row("(no per-frame series computed for any model)"));

  return lines.join("\n");
}

/** Build the CSV and trigger a browser download. */
export function downloadResultsCsv(
  projectLabel: string,
  byModel: Record<Model, MaskDoc | null>,
): void {
  const csv = buildResultsCsv(projectLabel, byModel);
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
