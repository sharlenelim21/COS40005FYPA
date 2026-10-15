"use client";

import React from "react";
import { StrainBullseyeChart, SEGMENT_LABELS, type StrainSegmentData } from "@/components/landmark/StrainVisualization";
import { RvRegionRing } from "./RvRegionRing";
import { ReportPageFrame } from "./ReportPageFrame";
import { fmt } from "./print-utils";

/** Broadcast each ring's single FAC value across its 3 sections — FAC is
 *  only tracked per-RING (not per-section like GCS/GAS), so this is the same
 *  value drawn 3x within a ring rather than 3 independent measurements. */
function rvFacToNineWide(rings: (number | null)[]): (number | null)[] {
  return [0, 1, 2].flatMap((ring) => [rings[ring] ?? null, rings[ring] ?? null, rings[ring] ?? null]);
}

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
  rvFacRings,
  rvFacGlobal,
  rvEsFrameIndex,
}: {
  patientLabel: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  /** Per-AHA-segment ED wall thickness (mm), 17 values — from the bullseye analysis. */
  edWallThicknessMm?: (number | null)[];
  edFrameIndex?: number | null;
  /** ED→ES RV FAC per ring [basal, mid, apical] (%), from the 9-segment RV bullseye. */
  rvFacRings: (number | null)[];
  /** ED→ES global RV FAC (%) — ratio of totals over all 9 segments. */
  rvFacGlobal: number | null;
  /** ES frame of the stored ED→ES RV strain result. */
  rvEsFrameIndex?: number | null;
}) {
  const wtStats = stats(edWallThicknessMm);
  const hasWt = wtStats.max !== null;
  const hasFac = rvFacGlobal !== null;

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

        <div className="relative rounded-lg border border-gray-300 p-2">
          <p className="mb-1 text-[14px] font-extrabold text-gray-900">RV Cavity Area - FAC (%)</p>
          {hasFac ? (
            <>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                ED (frame {edFrameIndex ?? "—"}) → ES (frame {rvEsFrameIndex ?? "—"})
              </p>
              <div className="mx-auto h-[220px] w-[220px]">
                <RvRegionRing values={rvFacToNineWide(rvFacRings)} metric="FAC" />
              </div>
              <p className="mt-2 text-[8.5px] leading-snug text-gray-600">
                (ED area − ES area) / ED area, drawn per ring across its 3 RV-bullseye sections. Not the
                echo 4-chamber FAC — no validated reference range.
              </p>
              <table className="mt-2 w-full border-collapse text-[9px]">
                <thead>
                  <tr className="bg-teal-50">
                    <th className="border-b border-gray-300 px-2 py-1 text-left font-bold text-teal-800">Region</th>
                    <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-teal-800">FAC</th>
                  </tr>
                </thead>
                <tbody>
                  {["Basal", "Mid", "Apical"].map((r, i) => (
                    <tr key={r}>
                      <td className="border-b border-gray-300/60 px-2 py-1 text-gray-900">{r}</td>
                      <td className="border-b border-gray-300/60 px-2 py-1 text-right font-mono text-gray-900">{fmt(rvFacRings[i] ?? null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 flex gap-1.5">
                <StatSquare label="Global FAC" value={`${fmt(rvFacGlobal)} %`} />
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-[10px] text-gray-600">
              Not computed — run RV strain (ED → ES) from the Strain tab. Results computed before GAS was added need recomputing.
            </p>
          )}
        </div>
      </div>
    </ReportPageFrame>
  );
}
