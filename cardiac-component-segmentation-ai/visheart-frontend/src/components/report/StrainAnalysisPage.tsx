"use client";

import React from "react";
import { ReportPageFrame } from "./ReportPageFrame";
import { chunk, fmt } from "./print-utils";

// The per-frame values table's rows are cheap (one line each), so far more
// fit per sheet than the charts above it — chunked anyway so an unusually
// long series (or a future higher frame-rate scan) can't silently overflow.
const FRAMES_PER_TABLE_PAGE = 70;

/** How many physical pages this component renders — the charts/peak-table page, plus one per chunk of the full per-frame table. */
export function strainAnalysisPageCount(frameCount: number): number {
  return 1 + Math.ceil(Math.max(frameCount, 0) / FRAMES_PER_TABLE_PAGE);
}

/** Minimal inline line chart — no library, matches the app's other hand-rolled print SVGs. */
function LineChart({
  lo, hi, width = 400, height = 200, curves,
}: {
  lo: number; hi: number; width?: number; height?: number;
  curves: { points: (number | null)[]; color: string; dashed?: boolean }[];
}) {
  const pad = 28;
  const n = Math.max(...curves.map((c) => c.points.length), 2);
  const scaleX = (i: number) => pad + ((width - 2 * pad) * i) / (n - 1);
  const scaleY = (v: number) => height - pad - ((height - 2 * pad) * (v - lo)) / (hi - lo);

  const gridVals = [lo, 0, hi].filter((v, i, arr) => v >= lo && v <= hi && arr.indexOf(v) === i);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
      {gridVals.map((v) => (
        <g key={v}>
          <line x1={pad} x2={width - pad} y1={scaleY(v)} y2={scaleY(v)} stroke="#d1d5db" strokeWidth={1} />
          <text x={2} y={scaleY(v) + 3} fontSize={9} fill="#4b5563">{v}%</text>
        </g>
      ))}
      {curves.map((c, ci) => {
        let d = "";
        c.points.forEach((v, i) => {
          if (v === null) return;
          d += `${d ? "L" : "M"}${scaleX(i)},${scaleY(v)} `;
        });
        return (
          <path key={ci} d={d} fill="none" stroke={c.color} strokeWidth={2} strokeDasharray={c.dashed ? "4,3" : undefined} />
        );
      })}
    </svg>
  );
}

export type StrainAnalysisRow = { frameIndex: number; lvGrs: number | null; lvGcs: number | null; rvGcs: number | null };

export function StrainAnalysisPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  lvPeakGrs,
  lvPeakGcs,
  rvPeakGcs,
  rvPeakGasPreview,
  rows,
}: {
  patientLabel: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  lvPeakGrs: number | null;
  lvPeakGcs: number | null;
  /** Real (radius-based cavity-boundary measure), unvalidated reference range. */
  rvPeakGcs: number | null;
  /** No RV area-strain computation exists anywhere yet — fixed preview constant. */
  rvPeakGasPreview: number;
  /** One row per ACTUAL computed frame index, already joined across the LV
   *  and RV series (which may cover different frame subsets) — never assumed
   *  to be a dense 0..N-1 range. Sorted by frameIndex. */
  rows: StrainAnalysisRow[];
}) {
  const lvGrsByFrame = rows.map((r) => r.lvGrs);
  const lvGcsByFrame = rows.map((r) => r.lvGcs);
  const rvGcsByFrame = rows.map((r) => r.rvGcs);
  const hasLvSeries = rows.some((r) => r.lvGrs !== null || r.lvGcs !== null);
  const hasRvSeries = rows.some((r) => r.rvGcs !== null);
  const rvGasFlatLine = rows.map(() => 0);
  const rowChunks = chunk(rows, FRAMES_PER_TABLE_PAGE);

  return (
    <>
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Complete"
      title="Strain Analysis"
      subtitle="Global strain, left and right ventricle"
      generatedAt={generatedAt}
    >
      <h3 className="mb-1.5 text-[14px] font-extrabold text-gray-900">Global Strain — Peak Values</h3>
      <table className="mb-1 w-full border-collapse text-[10.5px]">
        <thead>
          <tr className="bg-teal-50">
            <th className="border-b border-gray-300 px-2.5 py-1.5 text-left font-bold uppercase tracking-wide text-teal-800">Chamber</th>
            <th className="border-b border-gray-300 px-2.5 py-1.5 text-right font-bold uppercase tracking-wide text-teal-800">Peak GRS</th>
            <th className="border-b border-gray-300 px-2.5 py-1.5 text-right font-bold uppercase tracking-wide text-teal-800">Peak GCS</th>
            <th className="border-b border-gray-300 px-2.5 py-1.5 text-right font-bold uppercase tracking-wide text-teal-800">Peak GAS</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border-b border-gray-300/60 px-2.5 py-1.5 text-gray-900">LV</td>
            <td className="border-b border-gray-300/60 px-2.5 py-1.5 text-right font-mono text-gray-900">{fmt(lvPeakGrs)}%</td>
            <td className="border-b border-gray-300/60 px-2.5 py-1.5 text-right font-mono text-gray-900">{fmt(lvPeakGcs)}%</td>
            <td className="border-b border-gray-300/60 px-2.5 py-1.5 text-right font-mono text-gray-600">n/a</td>
          </tr>
          <tr>
            <td className="border-b border-gray-300/60 px-2.5 py-1.5 text-gray-900">RV</td>
            <td className="border-b border-gray-300/60 px-2.5 py-1.5 text-right font-mono text-gray-600">n/a</td>
            <td className="border-b border-gray-300/60 bg-amber-50 px-2.5 py-1.5 text-right font-mono italic text-amber-800">{fmt(rvPeakGcs)}%¹</td>
            <td className="border-b border-gray-300/60 bg-amber-50 px-2.5 py-1.5 text-right font-mono italic text-amber-800">{rvPeakGasPreview.toFixed(1)}%¹</td>
          </tr>
        </tbody>
      </table>
      <p className="mb-3 text-[8.5px] leading-snug text-gray-600">
        ¹ Prototype — RV GCS and RV GAS have no published reference range and are not yet clinically validated,
        so both are shown as placeholders rather than reported values.
      </p>

      <h3 className="mb-1.5 text-[14px] font-extrabold text-gray-900">Full-Cycle Strain</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-gray-300 p-2">
          <p className="mb-1 flex items-center gap-1.5 text-[10.5px] font-bold text-gray-900">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            LV — GRS / GCS
          </p>
          <div className="mb-1 flex gap-3 text-[9px] text-gray-600">
            <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-[#2c5f68]" />LV GRS</span>
            <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-[#c1573f]" />LV GCS</span>
          </div>
          {hasLvSeries ? (
            <LineChart lo={-20} hi={40} curves={[
              { points: lvGrsByFrame ?? [], color: "#2c5f68" },
              { points: lvGcsByFrame ?? [], color: "#c1573f" },
            ]} />
          ) : (
            <p className="py-10 text-center text-[9.5px] text-gray-600">Not computed — run the per-frame strain series.</p>
          )}
        </div>
        <div className="rounded-lg border border-dashed border-gray-300 bg-amber-500/5 p-2">
          <p className="mb-1 flex items-center gap-1.5 text-[10.5px] font-bold text-gray-900">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            RV — GCS / GAS
          </p>
          <div className="mb-1 flex gap-3 text-[9px] text-gray-600">
            <span className="flex items-center gap-1"><span className="h-0.5 w-3 border-b-2 border-dotted border-[#a6852f]" />RV GCS¹</span>
            <span className="flex items-center gap-1 italic"><span className="h-0.5 w-3 bg-gray-400" />RV GAS²</span>
          </div>
          {hasRvSeries ? (
            <LineChart lo={-45} hi={10} curves={[
              { points: rvGcsByFrame ?? [], color: "#a6852f", dashed: true },
              { points: rvGasFlatLine, color: "#9aa4b1", dashed: true },
            ]} />
          ) : (
            <p className="py-10 text-center text-[9.5px] text-gray-600">Not computed — run RV strain from the Strain tab.</p>
          )}
        </div>
      </div>
      <p className="mt-2 text-[8.5px] leading-snug text-gray-600">
        ¹ Prototype — real per-frame data, but no published reference range, so not clinically validated. ²
        Prototype — no per-frame GAS computation exists; the flat line is a placeholder, not a measurement.
      </p>
    </ReportPageFrame>

    {rowChunks.length > 0 && rowChunks.map((rowChunk, ci) => (
      <ReportPageFrame
        key={ci}
        pageNumber={pageNumber + 1 + ci}
        totalPages={totalPages}
        patientLabel={patientLabel}
        statusLabel="Complete"
        title={`Full-Cycle Strain — All Values${rowChunks.length > 1 ? ` (${ci + 1} of ${rowChunks.length})` : ""}`}
        subtitle="Global strain, every computed frame"
        generatedAt={generatedAt}
      >
        <table className="w-full border-collapse text-[9px]">
          <thead>
            <tr className="bg-teal-50">
              <th className="border-b border-gray-300 px-2 py-1 text-left font-bold uppercase tracking-wide text-teal-800">Frame</th>
              <th className="border-b border-gray-300 px-2 py-1 text-right font-bold uppercase tracking-wide text-teal-800">LV GRS</th>
              <th className="border-b border-gray-300 px-2 py-1 text-right font-bold uppercase tracking-wide text-teal-800">LV GCS</th>
              <th className="border-b border-gray-300 bg-amber-100 px-2 py-1 text-right font-bold uppercase tracking-wide text-amber-800">RV GCS¹ · Prototype</th>
              <th className="border-b border-gray-300 bg-amber-100 px-2 py-1 text-right font-bold uppercase tracking-wide text-amber-800">RV GAS² · Prototype</th>
            </tr>
          </thead>
          <tbody>
            {rowChunk.map((r) => (
              <tr key={r.frameIndex}>
                <td className="border-b border-gray-300/60 px-2 py-0.5 font-semibold text-gray-900">{r.frameIndex}</td>
                <td className="border-b border-gray-300/60 px-2 py-0.5 text-right font-mono text-gray-900">{fmt(r.lvGrs)}</td>
                <td className="border-b border-gray-300/60 px-2 py-0.5 text-right font-mono text-gray-900">{fmt(r.lvGcs)}</td>
                <td className="border-b border-gray-300/60 bg-amber-50 px-2 py-0.5 text-right font-mono italic text-amber-800">{fmt(r.rvGcs)}</td>
                <td className="border-b border-gray-300/60 bg-amber-50 px-2 py-0.5 text-right font-mono italic text-amber-800">0.0</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ci === rowChunks.length - 1 && (
          <p className="mt-2 text-[8.5px] leading-snug text-gray-600">
            ¹ Prototype — real per-frame data, but no published reference range, so not clinically validated.
            ² Prototype — no per-frame GAS computation exists; every row is the same placeholder constant, not a
            measurement.
          </p>
        )}
      </ReportPageFrame>
    ))}
    </>
  );
}
