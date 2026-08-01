"use client";

import React from "react";
import { ReportPageFrame } from "./ReportPageFrame";

/** Metric values are nullable — the pipeline leaves them null until computed. */
export interface PatientSummaryData {
  patientLabel: string;
  scanSummary: string;
  /** LV metrics. Named without an `lv` prefix for backward compatibility with
   *  existing callers; the printed LABELS are explicitly LV-prefixed. */
  ef: number | null;
  edv: number | null;
  esv: number | null;
  strokeVolume: number | null;
  peakGrs: number | null;
  peakGcs: number | null;
  /** RV metrics — all optional. Omitted entirely for masks with no RV cavity,
   *  in which case the RV block is not printed at all. */
  rvEf?: number | null;
  rvEdv?: number | null;
  rvEsv?: number | null;
  rvSv?: number | null;
  /** Derived in the report page from the LV/RV volumes above. */
  rvLvRatio?: number | null;
  svDifference?: number | null;
  voxelSize: string;
  /** Backend grades (compute_health_status.py); the longer labels are legacy. */
  healthStatus:
    | "Healthy" | "Mild" | "Moderate" | "Severe" | "Indeterminate"
    | "Mild Functional Impairment" | "Moderate Dysfunction" | "Severe Dysfunction";
  healthEvidence: { text: string; ok: boolean }[];
  diseasePattern: { label: string; pct: number; color: string }[];
  /** False when any figure on the page is placeholder rather than computed. */
  isRealData?: boolean;
}

/** Tailwind classes for the health-status pill, by grade. */
const STATUS_PILL: Record<string, string> = {
  Healthy: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  Mild: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  Moderate: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  Severe: "bg-red-600/10 text-red-700 dark:text-red-400",
  Indeterminate: "bg-muted text-muted-foreground",
};

function statusPillClass(status: string): string {
  return STATUS_PILL[status] ?? STATUS_PILL[status.split(" ")[0]] ?? STATUS_PILL.Indeterminate;
}

/** Render a nullable metric, matching the results page's em-dash convention. */
function metric(v: number | null | undefined, digits = 1, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v.toFixed(digits)}${suffix}`;
}

/**
 * Placeholder/preview numbers until Health Status and Disease Pattern Similarity
 * are implemented — same "dummy until pipeline connected" convention already used
 * elsewhere in the app (see landmarkPdfExport.ts).
 */
export const PLACEHOLDER_PATIENT_SUMMARY: PatientSummaryData = {
  patientLabel: "DET0026101",
  scanSummary: "Cine MRI · 6 slices · 8 frames · Model: UNetResNet34",
  ef: 58,
  edv: 162,
  esv: 68,
  strokeVolume: 94,
  peakGrs: 39,
  peakGcs: -21.0,
  voxelSize: "1.25 × 1.25 × 8 mm",
  healthStatus: "Healthy",
  healthEvidence: [
    { text: "Ejection Fraction within normal range (55–70%)", ok: true },
    { text: "End-Diastolic Volume within normal range", ok: true },
    { text: "Peak Global Radial Strain within expected range", ok: true },
    { text: "Mild reduction in 3 basal segments (Segments 1–4)", ok: false },
  ],
  diseasePattern: [
    { label: "Healthy (NOR)", pct: 82, color: "#15803d" },
    { label: "Dilated CM", pct: 12, color: "#fab219" },
    { label: "Hypertrophic CM", pct: 6, color: "#d03b3b" },
  ],
};

export function PatientSummaryPage({
  data = PLACEHOLDER_PATIENT_SUMMARY,
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
}: {
  data?: PatientSummaryData;
  /** Overrides data.patientLabel — lets the report use the real project name/ID everywhere else stays placeholder. */
  patientLabel?: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
}) {
  const resolvedLabel = patientLabel || data.patientLabel;
  // Every label is LV-prefixed: with RV metrics printed below, a bare "EDV"
  // would be ambiguous on paper where there's no surrounding context.
  const metrics: [string, string][] = [
    ["LV Ejection Fraction (LVEF)", metric(data.ef, 1, " %")],
    ["LV End-Diastolic Volume (LV EDV)", metric(data.edv, 1, " mL")],
    ["LV End-Systolic Volume (LV ESV)", metric(data.esv, 1, " mL")],
    ["LV Stroke Volume (LV SV)", metric(data.strokeVolume, 1, " mL")],
    ["LV Peak GRS", metric(data.peakGrs, 1, " %")],
    ["LV Peak GCS", metric(data.peakGcs, 1, " %")],
    ["Voxel Size", data.voxelSize],
  ];

  // RV block. Optional so callers that don't supply RV data (and the
  // placeholder) print exactly as before.
  const hasRv =
    data.rvEf != null || data.rvEdv != null || data.rvEsv != null || data.rvSv != null;
  const rvMetrics: [string, string][] = [
    ["RV Ejection Fraction (RVEF)", metric(data.rvEf, 1, " %")],
    ["RV End-Diastolic Volume (RV EDV)", metric(data.rvEdv, 1, " mL")],
    ["RV End-Systolic Volume (RV ESV)", metric(data.rvEsv, 1, " mL")],
    ["RV Stroke Volume (RV SV)", metric(data.rvSv, 1, " mL")],
  ];

  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={resolvedLabel}
      statusLabel="Complete"
      title={`Patient ${resolvedLabel}`}
      subtitle={data.scanSummary}
      generatedAt={generatedAt}
    >
      <section className="mb-4">
        <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Measurements · Left Ventricle
        </h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {metrics.map(([label, value]) => (
            <div key={label}>
              <p className="text-[8.5px] uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="text-[12px] font-bold text-foreground">{value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Right ventricle — printed only when RV was segmented, so a report
          without RV data looks exactly as it did before rather than showing a
          block of em-dashes. Volumes are raw and ungraded. */}
      {hasRv && (
        <section className="mb-4">
          <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Measurements · Right Ventricle
          </h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {rvMetrics.map(([label, value]) => (
              <div key={label}>
                <p className="text-[8.5px] uppercase tracking-wide text-muted-foreground">{label}</p>
                <p className="text-[12px] font-bold text-foreground">{value}</p>
              </div>
            ))}
          </div>
          {(data.rvLvRatio != null || data.svDifference != null) && (
            <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
              {data.rvLvRatio != null && (
                <div>
                  <p className="text-[8.5px] uppercase tracking-wide text-muted-foreground">RV:LV Volume Ratio</p>
                  <p className="text-[12px] font-bold text-foreground">
                    {data.rvLvRatio.toFixed(2)}
                    {data.rvLvRatio >= 1.0 && (
                      <span className="ml-1 text-[8.5px] font-semibold text-muted-foreground">RV enlarged rel. to LV</span>
                    )}
                  </p>
                </div>
              )}
              {data.svDifference != null && (
                <div>
                  <p className="text-[8.5px] uppercase tracking-wide text-muted-foreground">SV Difference (RV − LV)</p>
                  <p className="text-[12px] font-bold text-foreground">
                    {data.svDifference > 0 ? "+" : ""}{data.svDifference.toFixed(1)} mL
                  </p>
                </div>
              )}
            </div>
          )}
          <p className="mt-1.5 text-[7.5px] leading-snug text-muted-foreground">
            RV values are raw, not BSA-indexed and not graded. RV function thresholds are
            approximate, not sex-specific, and must be clinically validated before use.
          </p>
        </section>
      )}

      <section className="mb-4">
        <h3 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Health Status
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${statusPillClass(data.healthStatus)}`}>
            {data.healthStatus}
          </span>
        </h3>
        <ul className="space-y-1">
          {data.healthEvidence.map((item) => (
            <li key={item.text} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
              <span className={item.ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-500"}>{item.ok ? "✓" : "▲"}</span>
              {item.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-2">
        <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Disease Pattern Similarity</h3>
        <div className="space-y-1.5">
          {data.diseasePattern.map((d) => (
            <div key={d.label} className="flex items-center gap-2 text-[10px]">
              <span className="w-20 shrink-0 text-muted-foreground">{d.label}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full" style={{ width: `${d.pct}%`, backgroundColor: d.color }} />
              </span>
              <span className="w-8 shrink-0 text-right font-semibold text-foreground">{d.pct}%</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[8.5px] leading-snug text-muted-foreground">
          Global longitudinal strain (GLS) is not reported — it needs a long-axis (4-chamber) view
          and the current pipeline is short-axis (SAX) only.
          {data.isRealData
            ? " Health Status is a rule-based assessment (ASE/EACVI 2015 thresholds) and Disease Pattern Similarity is a similarity comparison — neither is a diagnosis; interpretation by a qualified clinician is required."
            : " Health Status and Disease Pattern Similarity are preview values pending those features."}
        </p>
      </section>
    </ReportPageFrame>
  );
}
