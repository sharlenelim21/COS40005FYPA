"use client";

import React from "react";
import { RvRegionRing, RV_REGION_LABELS_9 } from "./RvRegionRing";
import { FrameSeriesPages, frameSeriesPageCount, type SeriesFrame } from "./FrameSeriesPages";

export function rvRegionalStrainPageCount(frameCount: number): number {
  // RV Regional GCS (real, prototype-tagged) pages + RV Regional GAS (dummy,
  // prototype) pages — GAS mirrors GCS's own frame count/page shape since it
  // has no real per-frame data of its own. No separate intro page — the
  // explanatory note folds into the first GCS bullseye page instead.
  return frameSeriesPageCount(frameCount) * 2;
}

export function RvRegionalStrainPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  gcsFrames,
  edFrameIndex,
  esFrameIndex,
}: {
  patientLabel: string;
  /** First physical page number this component occupies. */
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  gcsFrames: SeriesFrame[];
  edFrameIndex?: number | null;
  esFrameIndex?: number | null;
}) {
  const allValues = gcsFrames.flatMap((f) => f.values).filter((v): v is number => v !== null);
  const lo = allValues.length ? Math.min(...allValues) : -1;
  const hi = allValues.length ? Math.max(...allValues) : 0;
  const gcsPages = frameSeriesPageCount(gcsFrames.length);

  // No per-frame RV area-strain computation exists yet — the "GAS" section
  // mirrors GCS's own frame indices (so ED/ES line up and page counts match)
  // but every value is null, so the bullseye renders fully muted and the
  // table renders as all "—", never implying a measurement that isn't real.
  const gasFrames: SeriesFrame[] = gcsFrames.map((f) => ({ frameIndex: f.frameIndex, values: new Array(9).fill(null) }));

  return (
    <>
      <FrameSeriesPages
        patientLabel={patientLabel}
        pageNumber={pageNumber}
        totalPages={totalPages}
        generatedAt={generatedAt}
        metricLabel="RV Regional GCS · Prototype"
        columnLabels={RV_REGION_LABELS_9}
        frames={gcsFrames.map((f) => ({ frameIndex: f.frameIndex, values: [...f.values, null, null, null] }))}
        edFrameIndex={edFrameIndex}
        esFrameIndex={esFrameIndex}
        emptyMessage="Not computed — run RV strain from the Strain tab to populate RV Regional GCS."
        renderBullseye={(values) => <RvRegionRing values={values} lo={lo} hi={hi} ringCount={3} />}
        tablePrototypeNote="RV Regional GCS has no published reference range and has not been clinically validated — values below are real but exploratory. The apical ring (regions 7-9) has no data and is not shown in this table."
        bullseyeIntroNote="RV Regional GCS (real per-frame data, the existing radius-based cavity-boundary measure) and RV Regional GAS (no per-frame computation exists yet) are both prototypes — neither has a published reference range, so neither is clinically validated. Both use the same 9-region (basal/mid/apical) bullseye layout for visual consistency; GCS has no apical-region data, so that ring always renders empty."
        theme="amber"
      />

      <FrameSeriesPages
        patientLabel={patientLabel}
        pageNumber={pageNumber + gcsPages}
        totalPages={totalPages}
        generatedAt={generatedAt}
        metricLabel="RV Regional GAS · Prototype"
        columnLabels={RV_REGION_LABELS_9}
        frames={gasFrames}
        edFrameIndex={edFrameIndex}
        esFrameIndex={esFrameIndex}
        emptyMessage="No per-frame RV area-strain computation exists in this pipeline yet."
        renderBullseye={(values) => <RvRegionRing values={values} lo={0} hi={1} ringCount={3} muted dashed />}
        tablePrototypeNote="No per-frame RV area-strain (GAS) computation exists in this pipeline yet — every value below is a placeholder, not a measurement."
        theme="amber"
      />
    </>
  );
}
