"use client";

import React from "react";
import { StrainBullseyeChart, SEGMENT_LABELS, type StrainSegmentData } from "@/components/landmark/StrainVisualization";
import { ReportPageFrame } from "./ReportPageFrame";
import { fmt } from "./print-utils";

function toSeries(values: (number | null)[] | undefined): StrainSegmentData[] {
  return (values ?? []).map((v, i) => ({ segment: i + 1, label: SEGMENT_LABELS[i] ?? `Segment ${i + 1}`, strain: v ?? 0 }));
}

function stats(values: (number | null)[] | undefined) {
  const nums = (values ?? []).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return { max: null, min: null, mean: null, sd: null };
  const max = Math.max(...nums);
  const min = Math.min(...nums);
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
  return { max, min, mean, sd };
}

function StatSquare({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-md border-2 border-gray-300 bg-gray-50 px-2 py-1.5 text-center">
      <p className="text-[8px] uppercase tracking-wide text-gray-600">{label}</p>
      <p className="font-mono text-[13px] font-bold text-gray-900">{value}</p>
    </div>
  );
}

export function WallThicknessCavityAreaPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  edWallThicknessMm,
  edFrameIndex,
}: {
  patientLabel: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  /** Per-AHA-segment ED wall thickness (mm), 17 values — from the bullseye analysis. */
  edWallThicknessMm?: (number | null)[];
  edFrameIndex?: number | null;
}) {
  const wtStats = stats(edWallThicknessMm);
  const hasWt = wtStats.max !== null;

  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Complete"
      title="Wall Thickness & Cavity Area"
      subtitle="LV wall thickness and RV cavity area — raw single-frame geometry"
      generatedAt={generatedAt}
    >
      <p className="mb-2 text-[10px] leading-snug text-gray-600">
        Grouped together as the two chambers&apos; raw single-frame geometry, at end-diastole. See the next page
        for how each varies across the full cardiac cycle, and Regional Strain for the %-change deformation metrics.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="mb-1 text-[14px] font-extrabold text-gray-900">LV Wall Thickness (mm)</p>
          {hasWt ? (
            <>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                End-diastole (ED) — frame {edFrameIndex ?? "—"}
              </p>
              <div className="mx-auto h-[220px] w-[220px]">
                <StrainBullseyeChart data={toSeries(edWallThicknessMm)} strainType="GRS" sharedMin={wtStats.min ?? 0} sharedMax={wtStats.max ?? 1} />
              </div>
              <div className="mt-2 flex gap-1.5">
                <StatSquare label="Max" value={`${fmt(wtStats.max)} mm`} />
                <StatSquare label="Min" value={`${fmt(wtStats.min)} mm`} />
                <StatSquare label="Mean" value={`${fmt(wtStats.mean)} mm`} />
                <StatSquare label="SD" value={`${fmt(wtStats.sd)} mm`} />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[8.5px]">
                {(edWallThicknessMm ?? []).map((v, i) => (
                  <div key={i} className="flex justify-between border-b border-dotted border-gray-300 py-0.5">
                    <span className="text-gray-600">{i + 1}. {SEGMENT_LABELS[i]}</span>
                    <span className="font-mono font-medium text-gray-900">{fmt(v)} mm</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-[10px] text-gray-600">
              Not computed — run the bullseye analysis to populate this panel.
            </p>
          )}
        </div>

        <div className="relative rounded-lg border border-dashed border-gray-300 bg-amber-50 p-2">
          <span className="absolute right-2 top-2 rounded-full bg-amber-100 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-700">
prototype — not yet computed
          </span>
          <p className="mb-1 text-[14px] font-extrabold text-gray-900">RV Cavity Area - FAC (%)</p>
          <p className="mb-2 text-[9px] text-gray-600">
            No per-frame RV cavity-area computation exists in this pipeline yet — table shown for structure, not measured values.
          </p>
          <table className="w-full border-collapse text-[9px]">
            <thead>
              <tr className="bg-amber-100">
                <th className="border-b border-gray-300 px-2 py-1 text-left font-bold text-amber-800">Region</th>
                <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-amber-800">FAC</th>
              </tr>
            </thead>
            <tbody>
              {["Basal", "Mid", "Apical"].map((r) => (
                <tr key={r}>
                  <td className="border-b border-gray-300/60 px-2 py-1 text-gray-900">{r}</td>
                  <td className="border-b border-gray-300/60 px-2 py-1 text-right font-mono italic text-amber-800">—</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex gap-1.5">
            <StatSquare label="ED area" value="— mm²" />
            <StatSquare label="ES area" value="— mm²" />
          </div>
        </div>
      </div>
    </ReportPageFrame>
  );
}
