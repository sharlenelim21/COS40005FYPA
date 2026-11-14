"use client";

import React from "react";
import { StrainBullseyeChart, SEGMENT_LABELS, type StrainSegmentData } from "@/components/landmark/StrainVisualization";
import { ReportPageFrame } from "./ReportPageFrame";
import { fmt } from "./print-utils";

function toSeries(values: (number | null)[]): StrainSegmentData[] {
  return values.map((v, i) => ({ segment: i + 1, label: SEGMENT_LABELS[i] ?? `Segment ${i + 1}`, strain: v ?? 0 }));
}

function stats(a: (number | null)[], b: (number | null)[]) {
  const nums = [...a, ...b].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return { min: 0, max: 1 };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

/**
 * Default-mode ("ED/ES Only") twin of WallThicknessCavityAreaPage's LV half — same
 * StrainBullseyeChart component, shown twice (ED, ES) side by side with ONE shared
 * color scale across both (computed from both arrays together) so the pair is
 * genuinely comparable rather than each auto-scaling to its own range.
 */
export function LvWallThicknessEdEsPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  modeLabel,
  edWallThicknessMm,
  esWallThicknessMm,
  edFrameIndex,
  esFrameIndex,
}: {
  patientLabel: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  modeLabel?: string;
  /** Per-AHA-segment wall thickness (mm), 17 values each — from the single ED→ES
   *  strain result (Strain.segments[i].wt_ed_mm / wt_es_mm), so ED and ES come
   *  from the same stored record. */
  edWallThicknessMm?: (number | null)[];
  esWallThicknessMm?: (number | null)[];
  edFrameIndex?: number | null;
  esFrameIndex?: number | null;
}) {
  const ed = edWallThicknessMm ?? [];
  const es = esWallThicknessMm ?? [];
  const hasWt = ed.some((v) => v != null) || es.some((v) => v != null);
  const { min, max } = stats(ed, es);

  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Complete"
      modeLabel={modeLabel}
      title="LV Wall Thickness — ED vs ES"
      subtitle="17-segment AHA bullseye, end-diastole and end-systole, shared colour scale"
      generatedAt={generatedAt}
    >
      {!hasWt ? (
        <p className="py-10 text-center text-[14px] text-gray-600">
          Not computed — run ED→ES strain to populate LV wall thickness.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="mb-1.5 text-center text-[13px] font-semibold uppercase tracking-wide text-gray-600">
                LV Wall Thickness — ED (Frame {edFrameIndex != null ? edFrameIndex + 1 : "—"})
              </p>
              <div className="mx-auto h-[280px] w-[280px]">
                <StrainBullseyeChart data={toSeries(ed)} strainType="GRS" sharedMin={min} sharedMax={max} />
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-center text-[13px] font-semibold uppercase tracking-wide text-gray-600">
                LV Wall Thickness — ES (Frame {esFrameIndex != null ? esFrameIndex + 1 : "—"})
              </p>
              <div className="mx-auto h-[280px] w-[280px]">
                <StrainBullseyeChart data={toSeries(es)} strainType="GRS" sharedMin={min} sharedMax={max} />
              </div>
            </div>
          </div>

          <table className="mt-3 w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-teal-50">
                <th className="border-b border-gray-300 px-2 py-1 text-left font-bold text-teal-800">Segment</th>
                <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-teal-800">ED thickness (mm)</th>
                <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-teal-800">ES thickness (mm)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 17 }, (_, i) => (
                <tr key={i}>
                  <td className="border-b border-gray-300/60 px-2 py-0.5 text-gray-900">{i + 1}. {SEGMENT_LABELS[i]}</td>
                  <td className="border-b border-gray-300/60 px-2 py-0.5 text-right font-mono text-gray-900">{fmt(ed[i] ?? null)}</td>
                  <td className="border-b border-gray-300/60 px-2 py-0.5 text-right font-mono text-gray-900">{fmt(es[i] ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-snug text-gray-600">
            Wall thickness is a real geometric measurement at both phases (not a reference-relative
            strain value) — ED and ES are genuinely different numbers here, not a 0%-at-ED
            convention. Frame numbers are one-based.
          </p>
        </>
      )}
    </ReportPageFrame>
  );
}
