"use client";

import React from "react";
import { HeartPulse, AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";
import { ReportPageFrame } from "./ReportPageFrame";
import type { RvHealthStatus } from "@/hooks/useProjectResults";

function fmt(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(digits);
}

function DataTable({ rows }: { rows: { label: string; value: string; unit: string; preview?: boolean }[] }) {
  return (
    <table className="w-full border-collapse text-[10.5px]">
      <thead>
        <tr className="bg-teal-50">
          <th className="rounded-tl-md border-b border-gray-300 px-2.5 py-1.5 text-left font-bold uppercase tracking-wide text-teal-800">Metric</th>
          <th className="border-b border-gray-300 px-2.5 py-1.5 text-right font-bold uppercase tracking-wide text-teal-800">Value</th>
          <th className="rounded-tr-md border-b border-gray-300 px-2.5 py-1.5 text-right font-bold uppercase tracking-wide text-teal-800">Unit</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className={r.preview ? "bg-amber-50" : undefined}>
            <td className="border-b border-gray-300/60 px-2.5 py-1.5 text-gray-900">
              {r.label}
              {r.preview && <span className="ml-1.5 text-[8px] font-bold uppercase tracking-wide text-amber-600">coming soon — prototype</span>}
            </td>
            <td className={`border-b border-gray-300/60 px-2.5 py-1.5 text-right font-mono ${r.preview ? "text-gray-600" : "text-gray-900"}`}>{r.value}</td>
            <td className="border-b border-gray-300/60 px-2.5 py-1.5 text-right font-mono text-gray-600">{r.unit}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HeartMetricsPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  bsaM2, heightCm, weightKg,
  edv, esv, ef, strokeVolume, lvMassG, maxWallThicknessMm,
  rvEdv, rvEsv, rvEf, rvSv,
  rvHealthStatus,
}: {
  patientLabel: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  bsaM2: number | null; heightCm: number | null; weightKg: number | null;
  edv: number | null; esv: number | null; ef: number | null; strokeVolume: number | null;
  lvMassG: number | null; maxWallThicknessMm: number | null;
  rvEdv: number | null; rvEsv: number | null; rvEf: number | null; rvSv: number | null;
  /** Null when nothing has been graded yet for the sex/BSA currently on this
   *  page (see report/page.tsx's matching rule) — rendered as "not graded"
   *  rather than omitted, so the report's structure stays identical whether
   *  or not this has been computed. */
  rvHealthStatus?: RvHealthStatus | null;
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
  ];

  const rvRows = [
    { label: "RVEDV", value: fmt(rvEdv), unit: "mL" },
    { label: "RVESV", value: fmt(rvEsv), unit: "mL" },
    { label: "RVEF", value: fmt(rvEf), unit: "%" },
    { label: "RV Stroke Volume", value: fmt(rvSv), unit: "mL" },
    { label: "RVEDVI", value: fmt(idx(rvEdv)), unit: "mL/m²" },
    { label: "RVESVI", value: fmt(idx(rvEsv)), unit: "mL/m²" },
    { label: "RV SVI", value: fmt(idx(rvSv)), unit: "mL/m²" },
    { label: "RV FAC", value: "—", unit: "%", preview: true },
  ];

  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Complete"
      title="Heart Metrics"
      subtitle="Volumetric and mass measurements, left and right ventricle"
      generatedAt={generatedAt}
    >
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-dotted border-gray-300 py-1 text-[10.5px]">
        <span className="text-gray-600">Body surface area (BSA)</span>
        <span className={`font-mono font-medium ${bsaM2 != null ? "text-gray-900" : "italic text-gray-600"}`}>
          {bsaM2 != null ? `${bsaM2.toFixed(2)} m² (${heightCm?.toFixed(0)} cm, ${weightKg?.toFixed(0)} kg)` : "Not entered — indexed (…I) rows below are blank"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-extrabold text-blue-700">
            <HeartPulse className="h-4 w-4" strokeWidth={2.5} />Left Ventricle
          </h3>
          <DataTable rows={lvRows} />
        </div>
        <div>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-extrabold text-rose-700">
            <HeartPulse className="h-4 w-4" strokeWidth={2.5} />Right Ventricle
          </h3>
          <DataTable rows={rvRows} />
        </div>
      </div>

      {/* RV Health Status verdict — the interactive report shows this on screen
          (InteractiveReport.tsx) but it never had a print equivalent, so a
          printed report could carry the raw RV numbers with no conclusion
          drawn from them at all. No severity colour scale here on purpose —
          see compute_rv_health_status.py: no validated CMR severity grading
          exists for RV function, so this is deliberately in/out-of-range
          only, never a gradient. */}
      <div className="mt-3 rounded-lg border border-gray-300 bg-gray-50 p-3">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-[11.5px] font-extrabold text-gray-900">
            <HeartPulse className="h-3.5 w-3.5 text-rose-700" strokeWidth={2.5} />RV Health Status
          </h3>
          {rvHealthStatus && (
            <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-700 border border-gray-300">
              {rvHealthStatus.status}
            </span>
          )}
        </div>
        {!rvHealthStatus ? (
          <p className="text-[10px] text-gray-600">
            Not graded for this sex/BSA yet — open the on-screen report to compute it, then reprint.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {rvHealthStatus.evidence.map((e, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[10px] leading-snug text-gray-900">
                  {e.level === "ok" ? (
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                  ) : e.level === "warn" ? (
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                  ) : (
                    <HelpCircle className="mt-0.5 h-3 w-3 shrink-0 text-gray-400" />
                  )}
                  <span><span className="font-semibold">{e.label}:</span> {e.detail}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[8.5px] leading-snug text-gray-600">
              {rvHealthStatus.reference.source} · confidence: {rvHealthStatus.confidence}
              {rvHealthStatus.confidence === "low" ? " (RVEF missing or absolute RV volumes unreliable)" : ""}.
              {" "}{rvHealthStatus.disclaimer}
            </p>
          </>
        )}
      </div>

      <p className="mt-3 text-[8.5px] leading-snug text-gray-600">
        RV FAC has no computation anywhere in the current pipeline (no area-per-frame calculation exists) — coming
        soon, currently a prototype — shown rather than omitted, so the report&apos;s structure stays identical for
        both chambers.
      </p>
    </ReportPageFrame>
  );
}
