"use client";

import React from "react";
import { StrainBullseyeChart, SEGMENT_LABELS, type StrainSegmentData } from "@/components/landmark/StrainVisualization";
import { ReportPageFrame } from "./ReportPageFrame";
import { fmt } from "./print-utils";

function toSeries(values: (number | null)[]): StrainSegmentData[] {
  return values.map((v, i) => ({ segment: i + 1, label: SEGMENT_LABELS[i] ?? `Segment ${i + 1}`, strain: v ?? 0 }));
}

/**
 * Default-mode ("Summary Report") LV strain page: one GCS map and one GRS map, each the
 * single stored ED→ES result (Strain.segments[i].gcs/grs).
 *
 * Originally this paired an "ED map" (0% for every segment, since GCS/GRS is a % change
 * measured relative to ED by definition) alongside the ES map. Dropped per direct request
 * (2026-11-14): a map that is always uniformly zero adds a visual without adding information,
 * so showing just the one real ED→ES result is clearer and uses the page better. The 0%-at-ED
 * fact itself is still stated in the caption below, not hidden -- only the redundant chart
 * was removed.
 */
export function LvStrainEdEsPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  modeLabel,
  esGcs,
  esGrs,
  edFrameIndex,
  esFrameIndex,
}: {
  patientLabel: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  modeLabel?: string;
  /** Strain.segments[i].gcs / grs — the stored ED→ES result, 17 values. */
  esGcs?: (number | null)[];
  esGrs?: (number | null)[];
  edFrameIndex?: number | null;
  esFrameIndex?: number | null;
}) {
  const gcs = esGcs ?? [];
  const grs = esGrs ?? [];
  const hasStrain = gcs.some((v) => v != null) || grs.some((v) => v != null);
  const phaseLabel = `ED (Frame ${edFrameIndex != null ? edFrameIndex + 1 : "—"}) → ES (Frame ${esFrameIndex != null ? esFrameIndex + 1 : "—"})`;

  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Complete"
      modeLabel={modeLabel}
      title="LV Regional Strain — ED → ES"
      subtitle="GCS and GRS, 17-segment AHA bullseye"
      generatedAt={generatedAt}
    >
      {!hasStrain ? (
        <p className="py-10 text-center text-[14px] text-gray-600">
          Not computed — run ED→ES strain to populate LV regional GCS/GRS.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="mb-1.5 text-center text-[13px] font-semibold uppercase tracking-wide text-gray-600">
                GCS — {phaseLabel}
              </p>
              <div className="mx-auto h-[260px] w-[260px]">
                <StrainBullseyeChart data={toSeries(gcs)} strainType="GCS" />
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-center text-[13px] font-semibold uppercase tracking-wide text-gray-600">
                GRS — {phaseLabel}
              </p>
              <div className="mx-auto h-[260px] w-[260px]">
                <StrainBullseyeChart data={toSeries(grs)} strainType="GRS" />
              </div>
            </div>
          </div>

          <table className="mt-3 w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-teal-50">
                <th className="border-b border-gray-300 px-2 py-1 text-left font-bold text-teal-800">Segment</th>
                <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-teal-800">GCS (%)</th>
                <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-teal-800">GRS (%)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 17 }, (_, i) => (
                <tr key={i}>
                  <td className="border-b border-gray-300/60 px-2 py-0.5 text-gray-900">{i + 1}. {SEGMENT_LABELS[i]}</td>
                  <td className="border-b border-gray-300/60 px-2 py-0.5 text-right font-mono text-gray-900">{fmt(gcs[i] ?? null)}</td>
                  <td className="border-b border-gray-300/60 px-2 py-0.5 text-right font-mono text-gray-900">{fmt(grs[i] ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-snug text-gray-600">
            GCS/GRS is a % change measured relative to ED by definition (so ED&apos;s own value is
            0% for every segment) — the figures above are the resulting ED→ES change, the single
            stored strain result. Frame numbers are one-based.
          </p>
        </>
      )}
    </ReportPageFrame>
  );
}
