"use client";

import React from "react";
import type { StrainType } from "@/components/landmark/StrainVisualization";
import {
  buildDummyCycleSeries,
  PerFrameBarGrid,
  RegionalStrainFullCycle,
  seriesGlobalPeak,
} from "@/components/landmark/RegionalStrainCharts";
import { ReportPageFrame } from "./ReportPageFrame";

const STRAIN_TYPE_LABEL: Record<StrainType, string> = {
  GRS: "Global Radial Strain (GRS)",
  GCS: "Global Circumferential Strain (GCS)",
};

/**
 * Per-frame bar charts vs. the full-cycle curve are complementary, not redundant:
 * the curve shows how ONE segment trends over time; the bar grid shows how ALL 17
 * segments compare to each other AT ONE instant, on a shared axis rather than by
 * color alone — the more reliable read when you need an exact "which segment is
 * lowest this frame" answer, and it still works in black-and-white print.
 */
export function StrainDetailPage({
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
  /** Computed per-frame strain (frame → 17 segments); dummy preview when absent. */
  realSeries?: { segment: number; label: string; strain: number }[][];
}) {
  const series = realSeries?.length ? realSeries : buildDummyCycleSeries(strainType, totalFrames);
  const isReal = !!realSeries?.length;
  const stat = seriesGlobalPeak(series, strainType);
  const unit = "%";

  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Complete"
      title={STRAIN_TYPE_LABEL[strainType]}
      subtitle="Per-frame segment snapshots and the full-cycle summary curve, all 17 AHA segments"
      generatedAt={generatedAt}
    >
      <div className="mb-3 grid grid-cols-3 gap-2">
        <div className="rounded-md bg-muted/30 p-2">
          <p className="text-[8px] uppercase tracking-wide text-muted-foreground">Global Peak</p>
          <p className="text-[12px] font-bold text-foreground">{stat.avg > 0 ? "+" : ""}{stat.avg.toFixed(1)}{unit}</p>
        </div>
        <div className="rounded-md bg-muted/30 p-2">
          <p className="text-[8px] uppercase tracking-wide text-muted-foreground">Best segment</p>
          <p className="text-[11px] font-semibold text-foreground">{stat.best.segment}. {stat.best.label.replace(/^(Basal|Mid|Apical)\s*/, "")}</p>
        </div>
        <div className="rounded-md bg-muted/30 p-2">
          <p className="text-[8px] uppercase tracking-wide text-muted-foreground">Watch</p>
          <p className="text-[11px] font-semibold text-amber-500">{stat.worst.segment}. {stat.worst.label.replace(/^(Basal|Mid|Apical)\s*/, "")}</p>
        </div>
      </div>

      <section className="mb-3">
        <h3 className="mb-1 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
          Per-frame segment snapshots
        </h3>
        <PerFrameBarGrid series={series} strainType={strainType} />
        <p className="mt-1 text-[8px] italic leading-snug text-muted-foreground">
          Each bar chart plots all 17 segments at one frame, colored by the same Excellent→Poor scale as the
          bullseye — a magnitude-comparable, color-and-position read of &ldquo;which segment is lowest right now,&rdquo;
          which stays legible in black-and-white print where the bullseye&apos;s color coding alone would not.
        </p>
      </section>

      <section>
        <h3 className="mb-1 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
          Across the cardiac cycle — summary curve
        </h3>
        <RegionalStrainFullCycle series={series} strainType={strainType} width={620} height={190} legendSize="xs" legendColumns={2} />
        <p className="mt-2 text-[8.5px] text-muted-foreground">
          {isReal
            ? "Computed from this patient's segmentation: each frame's strain is measured against the end-diastolic reference frame."
            : "PREVIEW VALUES — not this patient's data. No per-frame strain series has been computed for this model; run the strain series to populate this page."}
        </p>
      </section>
    </ReportPageFrame>
  );
}
