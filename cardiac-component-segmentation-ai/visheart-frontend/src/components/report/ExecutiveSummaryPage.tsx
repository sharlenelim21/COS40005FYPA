"use client";

import React from "react";
import { HeartPulse, Info } from "lucide-react";
import { ReportPageFrame } from "./ReportPageFrame";

function fmt(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(digits);
}

/**
 * Same metric table HeartMetricsPage used to render as its own separate print page -- moved here
 * (direct request, 2026-11-14) so the executive summary carries the full volumetric/mass/strain
 * picture instead of a short tile preview, and the report has one fewer page to flip through.
 * `researchInfo` rows (RV strain) get a small red marker instead of a hover card: this is a
 * printed/static page, so there's no hover to show one on.
 */
function DataTable({ rows }: { rows: { label: string; value: string; unit: string; researchInfo?: boolean }[] }) {
  return (
    <table className="w-full border-collapse text-[13.5px]">
      <thead>
        <tr className="bg-teal-50">
          <th className="rounded-tl-md border-b border-gray-300 px-2.5 py-1.5 text-left font-bold uppercase tracking-wide text-teal-800">Metric</th>
          <th className="border-b border-gray-300 px-2.5 py-1.5 text-right font-bold uppercase tracking-wide text-teal-800">Value</th>
          <th className="rounded-tr-md border-b border-gray-300 px-2.5 py-1.5 text-right font-bold uppercase tracking-wide text-teal-800">Unit</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="border-b border-gray-300/60 px-2.5 py-1.5 text-gray-900">
              <span className="flex items-center gap-1">
                {r.label}
                {r.researchInfo && <Info className="h-3 w-3 shrink-0 text-red-600" />}
              </span>
              {r.researchInfo && (
                <span className="mt-0.5 block text-[10.5px] font-semibold uppercase tracking-wide text-red-600">
                  Research output — this is our own research
                </span>
              )}
            </td>
            <td className="border-b border-gray-300/60 px-2.5 py-1.5 text-right font-mono text-gray-900">{r.value}</td>
            <td className="border-b border-gray-300/60 px-2.5 py-1.5 text-right font-mono text-gray-600">{r.unit}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
  ef, edv, esv, strokeVolume, lvMassG, peakGrs, peakGcs, maxWallThicknessMm,
  rvEf, rvEdv, rvEsv, rvSv, rvPeakGcs, rvPeakGas, rvFac,
  isRealData,
  mode = "full",
  lvEdFrame, lvEsFrame, rvEdFrame, rvEsFrame,
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
  lvMassG: number | null;
  peakGrs: number | null; peakGcs: number | null; maxWallThicknessMm: number | null;
  rvEf: number | null; rvEdv: number | null; rvEsv: number | null; rvSv: number | null;
  /** RV free-wall length strain (9-segment RV bullseye), unvalidated reference range. */
  rvPeakGcs: number | null;
  /** RV cavity-area strain (9-segment RV bullseye), unvalidated reference range. */
  rvPeakGas: number | null;
  /** Short-axis MRI FAC (= −peak GAS) — not the echo 4-chamber FAC. */
  rvFac: number | null;
  isRealData: boolean;
  /** Which export mode this page is part of — see report/page.tsx's `?mode=` toggle. Changes only
   *  the banner/phase-box below; the metrics table itself is identical in both modes. */
  mode?: "default" | "full";
  /** 0-based stored frame indices — displayed +1 (one-based) here, same convention as every
   *  other print page. LV comes from heartMetrics.ed_frame/es_frame; RV has its OWN selection
   *  (rvStrain.edFrameIndex/esFrameIndex) and the two are shown separately rather than assumed
   *  to match, since they can genuinely differ. */
  lvEdFrame?: number | null;
  lvEsFrame?: number | null;
  rvEdFrame?: number | null;
  rvEsFrame?: number | null;
}) {
  const idx = (raw: number | null) => (bsaM2 && raw != null ? raw / bsaM2 : null);

  const lvRows = [
    { label: "EDV", value: fmt(edv), unit: "mL" },
    { label: "ESV", value: fmt(esv), unit: "mL" },
    { label: "EF", value: fmt(ef), unit: "%" },
    { label: "Stroke Volume", value: fmt(strokeVolume), unit: "mL" },
    { label: "EDVI", value: fmt(idx(edv)), unit: "mL/m²" },
    { label: "ESVI", value: fmt(idx(esv)), unit: "mL/m²" },
    { label: "LV Mass", value: fmt(lvMassG), unit: "g" },
    { label: "LVMI", value: fmt(idx(lvMassG)), unit: "g/m²" },
    { label: "Max wall thickness", value: fmt(maxWallThicknessMm), unit: "mm" },
    { label: "Peak GRS", value: fmt(peakGrs), unit: "%" },
    { label: "Peak GCS", value: fmt(peakGcs), unit: "%" },
  ];

  const rvRows = [
    { label: "RVEDV", value: fmt(rvEdv), unit: "mL" },
    { label: "RVESV", value: fmt(rvEsv), unit: "mL" },
    { label: "RVEF", value: fmt(rvEf), unit: "%" },
    { label: "RV Stroke Volume", value: fmt(rvSv), unit: "mL" },
    { label: "RVEDVI", value: fmt(idx(rvEdv)), unit: "mL/m²" },
    { label: "RVESVI", value: fmt(idx(rvEsv)), unit: "mL/m²" },
    { label: "RV SVI", value: fmt(idx(rvSv)), unit: "mL/m²" },
    { label: "RV FAC (short-axis MRI)", value: fmt(rvFac), unit: "%" },
    { label: "RV Peak GCS", value: fmt(rvPeakGcs), unit: "%", researchInfo: true },
    { label: "RV Peak GAS", value: fmt(rvPeakGas), unit: "%", researchInfo: true },
  ];

  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Research use only"
      modeLabel={mode === "default" ? "Summary (ED/ES)" : "Full Research (All Frames)"}
      title="Executive Summary"
      subtitle="Patient overview and cardiac assessment summary"
      generatedAt={generatedAt}
    >
      {/* Masthead — deliberately its own block rather than ReportPageFrame's
          standard title, since this is the one page that needs the full
          document-title treatment the mockup gives page 1. */}
      <div className="mb-4 flex items-start justify-between gap-4 border-b-[3px] border-gray-900 pb-3">
        <div>
          <h1 className="text-[30px] font-extrabold leading-tight tracking-tight text-gray-900">
            Cardiac Functional Analysis Report
          </h1>
          <p className="mt-1 text-[14px] text-gray-700">
            Patient {patientLabel} · Cine MRI · Generated {generatedAt}
          </p>
        </div>
        <span className="mt-1 shrink-0 rounded-full bg-teal-50 px-3 py-1 text-[13px] font-bold uppercase tracking-wide text-teal-700">
          Research use only
        </span>
      </div>

      <section className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[13.5px]">
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

      {/* Required mode statement — exact wording per the report-redesign spec,
          so a reader opening just this one page (or a printout of it alone)
          knows immediately which report they're holding and what's missing
          from it, if anything. */}
      <p className={`mb-3 rounded-md border px-3 py-2 text-[13px] leading-snug ${
        mode === "default" ? "border-indigo-300 bg-indigo-50 text-indigo-900" : "border-gray-300 bg-gray-50 text-gray-700"
      }`}>
        {mode === "default"
          ? "This report displays end-diastolic (ED) and end-systolic (ES) measurements and visualizations only. Full-cycle data are available in the Full Research Report."
          : "This report contains all available analyzed cardiac frames, full-cycle measurements, regional data tables, and supporting visualizations."}
      </p>

      {mode === "default" && (
        <div className="mb-3 rounded-md border border-gray-300 bg-gray-50 p-2.5">
          <p className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-gray-700">Selected Cardiac Phases</p>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="pb-0.5 text-left font-semibold text-gray-600"> </th>
                <th className="pb-0.5 text-left font-semibold text-gray-600">ED frame</th>
                <th className="pb-0.5 text-left font-semibold text-gray-600">ES frame</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-0.5 font-semibold text-gray-900">LV</td>
                <td className="py-0.5 font-mono text-gray-900">{lvEdFrame != null ? `Frame ${lvEdFrame + 1}` : "Frame not recorded"}</td>
                <td className="py-0.5 font-mono text-gray-900">{lvEsFrame != null ? `Frame ${lvEsFrame + 1}` : "Frame not recorded"}</td>
              </tr>
              <tr>
                <td className="py-0.5 font-semibold text-gray-900">RV</td>
                <td className="py-0.5 font-mono text-gray-900">{rvEdFrame != null ? `Frame ${rvEdFrame + 1}` : "Frame not recorded"}</td>
                <td className="py-0.5 font-mono text-gray-900">{rvEsFrame != null ? `Frame ${rvEsFrame + 1}` : "Frame not recorded"}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1.5 text-[11px] leading-snug text-gray-600">
            Total cardiac frames: {frames != null ? frames : "—"}. LV phases come from the heart-metrics
            ED/ES selection; RV has its own separately-selected ED/ES strain result — shown above as-is,
            not forced to match LV, since the two can genuinely differ. Frame numbers are one-based.
          </p>
        </div>
      )}

      <h3 className="mb-2 text-[20px] font-extrabold text-gray-900">Cardiac Assessment Summary</h3>
      {mode === "default" && (
        <p className="mb-2 text-[11.5px] leading-snug text-gray-600">
          Summary metrics include derived and peak values where labeled. Detailed maps and regional
          tables in this review report are restricted to ED and ES.
        </p>
      )}
      {!isRealData ? (
        <p className="py-6 text-center text-[13.5px] text-gray-600">
          Nothing has been computed for this project yet — run segmentation, heart metrics, and
          strain to populate this report.
        </p>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-dotted border-gray-300 py-1 text-[13.5px]">
            <span className="text-gray-600">Body surface area (BSA)</span>
            <span className={`font-mono font-medium ${bsaM2 != null ? "text-gray-900" : "italic text-gray-600"}`}>
              {bsaM2 != null ? `${bsaM2.toFixed(2)} m² (${heightCm?.toFixed(0)} cm, ${weightKg?.toFixed(0)} kg)` : "Not entered — indexed (…I) rows below are blank"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="mb-1.5 flex items-center gap-1.5 text-[15px] font-extrabold text-blue-700">
                <HeartPulse className="h-4 w-4" strokeWidth={2.5} />Left Ventricle
              </h4>
              <DataTable rows={lvRows} />
            </div>
            <div>
              <h4 className="mb-1.5 flex items-center gap-1.5 text-[15px] font-extrabold text-rose-700">
                <HeartPulse className="h-4 w-4" strokeWidth={2.5} />Right Ventricle
              </h4>
              <DataTable rows={rvRows} />
            </div>
          </div>
        </>
      )}
    </ReportPageFrame>
  );
}
