"use client";

import React from "react";
import { StrainBullseyeChart, type StrainType } from "@/components/landmark/StrainVisualization";
import { buildDummyCycleSeries, frameLabel } from "@/components/landmark/RegionalStrainCharts";
import { ReportPageFrame } from "./ReportPageFrame";

const DOMAIN: Record<StrainType, { min: number; max: number; reverse: boolean }> = {
  GRS: { min: 0, max: 42, reverse: false },
  GCS: { min: -26, max: 2, reverse: true },
};

const STRAIN_TYPE_LABEL: Record<StrainType, string> = {
  GRS: "Global Radial Strain (GRS)",
  GCS: "Global Circumferential Strain (GCS)",
};

const LEGEND = [
  ["#15803d", "Excellent"],
  ["#22c55e", "Good"],
  ["#eab308", "Fair"],
  ["#f97316", "Reduced"],
  ["#dc2626", "Poor"],
] as const;

/**
 * One strain type per page, no toggle — a printed page can't be clicked, so GRS
 * and GCS get their own separate pages instead of sharing one with a switcher.
 */
export function RegionalStrainBullseyePage({
  strainType,
  patientLabel,
  totalFrames,
  pageNumber,
  totalPages,
  generatedAt,
  realSeries,
}: {
  strainType: StrainType;
  patientLabel: string;
  totalFrames: number;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  /**
   * Computed per-frame strain, already mapped to the chart's shape
   * (frame → 17 segments). When absent the dummy preview is used and the page
   * says so, so a printed report never implies uncomputed values are measured.
   */
  realSeries?: { segment: number; label: string; strain: number }[][];
}) {
  const series = realSeries?.length ? realSeries : buildDummyCycleSeries(strainType, totalFrames);
  const isReal = !!realSeries?.length;
  const domain = DOMAIN[strainType];

  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Complete"
      title={`Regional Strain — ${STRAIN_TYPE_LABEL[strainType]}`}
      subtitle="AHA 17-segment strain, tracked across the full cardiac cycle"
      generatedAt={generatedAt}
    >
      <div className="grid grid-cols-3 gap-1">
        {series.map((frameData, f) => (
          <div key={f} className="rounded-md border border-border bg-muted/10 p-0.5">
            {/* padding-bottom trick, not `aspect-square`: CSS aspect-ratio can
                mis-size against an SVG's own intrinsic viewBox ratio inside a
                CSS grid track, splitting the chart's content (circle vs. its
                color-scale bar near the bottom of the same SVG) apart with a
                gap between them. This older technique derives height purely
                from width, sidestepping that interaction entirely. */}
            <div className="relative w-full" style={{ paddingBottom: "100%" }}>
              <div className="absolute inset-0">
                <StrainBullseyeChart
                  data={frameData}
                  strainType={strainType}
                  sharedMin={domain.min}
                  sharedMax={domain.max}
                  reverseColors={domain.reverse}
                />
              </div>
            </div>
            <p className="text-center text-[8px] font-semibold text-muted-foreground">
              {frameLabel(f, series.length)}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[9px] text-muted-foreground">
        {LEGEND.map(([color, label]) => (
          <span key={label} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[8.5px] text-muted-foreground">
        {isReal
          ? "Computed from this patient's segmentation: each frame's strain is measured against the end-diastolic reference frame."
          : "PREVIEW VALUES — not this patient's data. No per-frame strain series has been computed for this model; run the strain series to populate this page."}
      </p>
    </ReportPageFrame>
  );
}
