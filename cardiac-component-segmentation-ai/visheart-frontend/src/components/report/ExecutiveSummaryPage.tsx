"use client";

import React from "react";
import { HeartPulse } from "lucide-react";
import { ReportPageFrame } from "./ReportPageFrame";

function fmt(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(digits);
}

function Tile({
  label, value, unit, preview,
}: { label: string; value: string; unit?: string; preview?: boolean }) {
  return (
    <div className={`rounded-md border-2 px-2.5 py-2 ${preview ? "border-dashed border-amber-300 bg-amber-50" : "border-gray-300 bg-gray-50"}`}>
      <p className="text-[8px] uppercase tracking-wide text-gray-600">
        {label}
        {preview && <span className="ml-1 font-bold text-amber-600">preview</span>}
      </p>
      <p className={`mt-0.5 text-[13px] font-bold tabular-nums ${preview ? "text-gray-600" : "text-gray-900"}`}>
        {value}
        {unit && <span className="ml-0.5 text-[9px] font-medium text-gray-600">{unit}</span>}
      </p>
    </div>
  );
}

export function ExecutiveSummaryPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  modelLabel,
  slices,
  frames,
  voxelSize,
  bsaM2,
  heightCm,
  weightKg,
  ef, edv, esv, strokeVolume, peakGrs, peakGcs, maxWallThicknessMm,
  rvEf, rvEdv, rvEsv, rvSv, rvPeakGcs, rvPeakGasPreview,
  healthStatusText,
  phenotypeHeadline,
  isRealData,
}: {
  patientLabel: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  modelLabel: string;
  slices: number | null;
  frames: number | null;
  voxelSize: string;
  bsaM2: number | null;
  heightCm: number | null;
  weightKg: number | null;
  ef: number | null; edv: number | null; esv: number | null; strokeVolume: number | null;
  peakGrs: number | null; peakGcs: number | null; maxWallThicknessMm: number | null;
  rvEf: number | null; rvEdv: number | null; rvEsv: number | null; rvSv: number | null;
  /** Real (radius-based cavity-boundary measure), unvalidated reference range. */
  rvPeakGcs: number | null;
  /** No RV area-strain computation exists anywhere yet — fixed preview constant. */
  rvPeakGasPreview: number;
  healthStatusText: string | null;
  phenotypeHeadline: string | null;
  isRealData: boolean;
}) {
  const hasRv = rvEf != null || rvEdv != null || rvEsv != null || rvSv != null;

  const findings = !isRealData
    ? "Nothing has been computed for this project yet — run segmentation, heart metrics, and strain to populate this report."
    : [
        healthStatusText
          ? `Left-ventricular function is assessed as ${healthStatusText.toLowerCase()}${ef != null ? ` (LVEF ${fmt(ef)}%)` : ""}.`
          : null,
        phenotypeHeadline ? `Disease pattern similarity: ${phenotypeHeadline}.` : null,
        hasRv ? `Right-ventricular volumes and function are shown alongside the left ventricle above.` : null,
      ].filter(Boolean).join(" ") || "Quantitative cardiac measurements were generated from the provided cardiac MRI segmentation.";

  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Research use only"
      title="Executive Summary"
      subtitle="Patient overview and cardiac assessment summary"
      generatedAt={generatedAt}
    >
      {/* Masthead — deliberately its own block rather than ReportPageFrame's
          standard title, since this is the one page that needs the full
          document-title treatment the mockup gives page 1. */}
      <div className="mb-4 flex items-start justify-between gap-4 border-b-[3px] border-gray-900 pb-3">
        <div>
          <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-gray-900">
            Cardiac Functional Analysis Report
          </h1>
          <p className="mt-1 text-[12px] text-gray-700">
            Patient {patientLabel} · Cine MRI · Generated {generatedAt}
          </p>
        </div>
        <span className="mt-1 shrink-0 rounded-full bg-teal-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-teal-700">
          Research use only
        </span>
      </div>

      <section className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[10.5px]">
        {[
          ["Patient / scan ID", patientLabel],
          ["Segmentation model", modelLabel],
          ["Slices", slices != null ? String(slices) : "—"],
          ["Cardiac frames", frames != null ? String(frames) : "—"],
          ["Voxel spacing", voxelSize],
          [
            "Body surface area (BSA)",
            bsaM2 != null
              ? `${bsaM2.toFixed(2)} m² (${heightCm?.toFixed(0)} cm, ${weightKg?.toFixed(0)} kg)`
              : "Not entered",
          ],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-2 border-b border-dotted border-gray-300 py-1">
            <span className="text-gray-600">{k}</span>
            <span className={`font-mono font-medium ${v === "Not entered" ? "italic text-gray-600" : "text-gray-900"}`}>{v}</span>
          </div>
        ))}
      </section>

      <h3 className="mb-2 text-[16px] font-extrabold text-gray-900">Cardiac Assessment Summary</h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-blue-700">
            <HeartPulse className="h-4 w-4" strokeWidth={2.5} />Left Ventricle
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <Tile label="EDV" value={fmt(edv)} unit="mL" />
            <Tile label="ESV" value={fmt(esv)} unit="mL" />
            <Tile label="EF" value={fmt(ef)} unit="%" />
            <Tile label="Stroke Volume" value={fmt(strokeVolume)} unit="mL" />
            <Tile label="Max wall thickness" value={fmt(maxWallThicknessMm)} unit="mm" />
            <Tile label="Peak GRS / GCS" value={`${fmt(peakGrs)} / ${fmt(peakGcs)}`} unit="%" />
          </div>
        </div>
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-rose-700">
            <HeartPulse className="h-4 w-4" strokeWidth={2.5} />Right Ventricle
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <Tile label="EDV" value={fmt(rvEdv)} unit="mL" />
            <Tile label="ESV" value={fmt(rvEsv)} unit="mL" />
            <Tile label="EF" value={fmt(rvEf)} unit="%" />
            <Tile label="Stroke Volume" value={fmt(rvSv)} unit="mL" />
            <Tile label="Regional FAC" value="—" unit="%" preview />
            <Tile label="GAS / GCS-proxy" value={`${rvPeakGasPreview.toFixed(1)} / ${fmt(rvPeakGcs)}`} unit="%" preview />
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 text-[10.5px] leading-snug text-gray-900">
        <span className="font-bold text-gray-900">Overall findings — </span>
        {findings}
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-[9.5px] font-semibold text-amber-600">
        ⚠ Research use only. These results are not a clinical diagnosis.
      </p>
    </ReportPageFrame>
  );
}
