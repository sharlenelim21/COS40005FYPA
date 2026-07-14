"use client";

import React from "react";
import { ReportPageFrame } from "./ReportPageFrame";

export interface PatientSummaryData {
  patientLabel: string;
  scanSummary: string;
  ef: number;
  edv: number;
  esv: number;
  strokeVolume: number;
  peakGrs: number;
  peakGcs: number;
  voxelSize: string;
  healthStatus: "Healthy" | "Mild Functional Impairment" | "Moderate Dysfunction" | "Severe Dysfunction";
  healthEvidence: { text: string; ok: boolean }[];
  diseasePattern: { label: string; pct: number; color: string }[];
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
  const metrics: [string, string][] = [
    ["Ejection Fraction", `${data.ef} %`],
    ["EDV", `${data.edv} mL`],
    ["ESV", `${data.esv} mL`],
    ["Stroke Volume", `${data.strokeVolume} mL`],
    ["Peak GRS", `${data.peakGrs} %`],
    ["Peak GCS", `${data.peakGcs.toFixed(1)} %`],
    ["Voxel Size", data.voxelSize],
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
        <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Measurements</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {metrics.map(([label, value]) => (
            <div key={label}>
              <p className="text-[8.5px] uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="text-[12px] font-bold text-foreground">{value}</p>
            </div>
          ))}
          <div>
            <p className="text-[8.5px] uppercase tracking-wide text-muted-foreground">Peak GLS †</p>
            <p className="text-[11px] font-semibold text-muted-foreground">Not available</p>
          </div>
        </div>
      </section>

      <section className="mb-4">
        <h3 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Health Status
          <span className="rounded-full bg-emerald-600/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 dark:text-emerald-400">
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
          † GLS needs a long-axis (4-chamber) view — the current pipeline is short-axis (SAX) only.
          Health Status and Disease Pattern Similarity are preview values pending those features.
        </p>
      </section>
    </ReportPageFrame>
  );
}
