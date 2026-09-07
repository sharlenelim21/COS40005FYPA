"use client";

import React from "react";
import { ReportPageFrame } from "./ReportPageFrame";
import { chunk, fmt } from "./print-utils";

const VOLUMES_PER_TABLE_PAGE = 70;

function VolumeChart({ values }: { values: (number | null)[] }) {
  const nums = values.filter((v): v is number => v !== null);
  if (!nums.length) return null;
  const lo = Math.min(...nums) * 0.9, hi = Math.max(...nums) * 1.05;
  const width = 400, height = 180, pad = 30;
  const n = values.length;
  const scaleX = (i: number) => pad + ((width - 2 * pad) * i) / Math.max(n - 1, 1);
  const scaleY = (v: number) => height - pad - ((height - 2 * pad) * (v - lo)) / (hi - lo);
  let d = "";
  values.forEach((v, i) => { if (v !== null) d += `${d ? "L" : "M"}${scaleX(i)},${scaleY(v)} `; });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
      {[lo, hi].map((v) => (
        <g key={v}>
          <line x1={pad} x2={width - pad} y1={scaleY(v)} y2={scaleY(v)} stroke="#d1d5db" strokeWidth={1} />
          <text x={2} y={scaleY(v) + 3} fontSize={9} fill="#4b5563">{Math.round(v)}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke="#2c5f68" strokeWidth={2.5} />
    </svg>
  );
}

/** How many physical pages this component renders — the chart page, plus one per chunk of the full per-frame table. */
export function rvCavityGeometryPageCount(frameCount: number): number {
  return 1 + Math.ceil(Math.max(frameCount, 0) / VOLUMES_PER_TABLE_PAGE);
}

export function RvCavityGeometryPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  rvEdv,
  rvEsv,
  rvVolumesMl,
}: {
  patientLabel: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  rvEdv: number | null;
  rvEsv: number | null;
  rvVolumesMl?: (number | null)[];
}) {
  const hasVolumeCurve = !!rvVolumesMl?.some((v) => v !== null);
  const rowChunks = chunk((rvVolumesMl ?? []).map((v, i) => ({ frame: i, volume: v })), VOLUMES_PER_TABLE_PAGE);

  return (
    <>
      <ReportPageFrame
        pageNumber={pageNumber}
        totalPages={totalPages}
        patientLabel={patientLabel}
        statusLabel="Complete"
        title="RV Cavity Geometry"
        subtitle="RV cavity volume across the cycle"
        generatedAt={generatedAt}
      >
        <p className="mb-1 flex items-center gap-1.5 text-[14px] font-extrabold text-gray-900">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />RV Cavity Volume, ED → ES
        </p>
        <div className="mb-2 flex gap-2">
          <div className="flex-1 rounded-md border-2 border-gray-300 bg-gray-50 px-2 py-1.5 text-center">
            <p className="text-[8px] uppercase tracking-wide text-gray-600">ED volume</p>
            <p className="font-mono text-[13px] font-bold text-gray-900">{fmt(rvEdv)} mL</p>
          </div>
          <div className="flex-1 rounded-md border-2 border-gray-300 bg-gray-50 px-2 py-1.5 text-center">
            <p className="text-[8px] uppercase tracking-wide text-gray-600">ES volume</p>
            <p className="font-mono text-[13px] font-bold text-gray-900">{fmt(rvEsv)} mL</p>
          </div>
        </div>
        <div className="rounded-lg border border-gray-300 p-2">
          <p className="mb-1 flex items-center gap-1.5 text-[9px] text-gray-600">
            <span className="h-0.5 w-3 bg-[#2c5f68]" />RV cavity volume / frame
          </p>
          {hasVolumeCurve ? (
            <VolumeChart values={rvVolumesMl!} />
          ) : (
            <p className="py-8 text-center text-[9.5px] text-gray-600">Not computed.</p>
          )}
        </div>
        <p className="mt-1.5 text-[8.5px] text-gray-600">
          Shown as volume, not area — per-frame RV area isn&apos;t separately computed, only frame-wise segmented
          volume. RV FAC (fractional area change) is not shown here — see the Wall Thickness &amp; Cavity Area
          pages for that measure, so it is not repeated in two places.
        </p>
      </ReportPageFrame>

      {rowChunks.map((rowChunk, ci) => (
        <ReportPageFrame
          key={ci}
          pageNumber={pageNumber + 1 + ci}
          totalPages={totalPages}
          patientLabel={patientLabel}
          statusLabel="Complete"
          title={`RV Cavity Volume — All Frames${rowChunks.length > 1 ? ` (${ci + 1} of ${rowChunks.length})` : ""}`}
          subtitle="RV cavity volume (mL), every frame"
          generatedAt={generatedAt}
        >
          <table className="w-full border-collapse text-[9.5px]">
            <thead>
              <tr className="bg-teal-50">
                <th className="border-b border-gray-300 px-2 py-1 text-left font-bold uppercase tracking-wide text-teal-800">Frame</th>
                <th className="border-b border-gray-300 px-2 py-1 text-right font-bold uppercase tracking-wide text-teal-800">RV Volume</th>
              </tr>
            </thead>
            <tbody>
              {rowChunk.map((r) => (
                <tr key={r.frame}>
                  <td className="border-b border-gray-300/60 px-2 py-0.5 font-semibold text-gray-900">{r.frame}</td>
                  <td className="border-b border-gray-300/60 px-2 py-0.5 text-right font-mono text-gray-900">{fmt(r.volume)} mL</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportPageFrame>
      ))}
    </>
  );
}
