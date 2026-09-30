"use client";

import { STRAIN_COLOR_SCALES } from "@/lib/strainColorScale";
import React from "react";
import { RvRegionRing, RV_REGION_LABELS_9 } from "./RvRegionRing";
import { FrameSeriesPages, frameSeriesPageCount, type SeriesFrame } from "./FrameSeriesPages";

export function rvRegionalStrainPageCount(frameCount: number): number {
  // RV Regional GCS pages + RV Regional GAS pages — two separate metrics
  // (never combined) over the same frames. No separate intro page — the
  // explanatory note folds into the first GCS bullseye page instead.
  return frameSeriesPageCount(frameCount) * 2;
}

/** Fixed colour range (lib/strainColorScale.ts) — lo = least deformation,
 *  hi = most, so RvRegionRing shades darker for more deformation. */
function range(key: "RV_GCS" | "RV_GAS") {
  return { lo: STRAIN_COLOR_SCALES[key].worst, hi: STRAIN_COLOR_SCALES[key].best };
}

export function RvRegionalStrainPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  gcsFrames,
  gasFrames,
  edFrameIndex,
  esFrameIndex,
}: {
  patientLabel: string;
  /** First physical page number this component occupies. */
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  /** 9 values per frame (basal 1-3, mid 4-6, apical 7-9). */
  gcsFrames: SeriesFrame[];
  /** Same frames/order as gcsFrames; null values where GAS wasn't stored. */
  gasFrames: SeriesFrame[];
  edFrameIndex?: number | null;
  esFrameIndex?: number | null;
}) {
  const gcsRange = range("RV_GCS");
  const gasRange = range("RV_GAS");
  const gcsPages = frameSeriesPageCount(gcsFrames.length);
  const hasGas = gasFrames.some((f) => f.values.some((v) => v !== null));

  return (
    <>
      <FrameSeriesPages
        patientLabel={patientLabel}
        pageNumber={pageNumber}
        totalPages={totalPages}
        generatedAt={generatedAt}
        metricLabel="RV Regional GCS · Prototype"
        columnLabels={RV_REGION_LABELS_9}
        frames={gcsFrames}
        edFrameIndex={edFrameIndex}
        esFrameIndex={esFrameIndex}
        emptyMessage="Not computed — run RV strain from the Strain tab to populate RV Regional GCS."
        renderBullseye={(values) => <RvRegionRing values={values} lo={gcsRange.lo} hi={gcsRange.hi} ringCount={3} />}
        tablePrototypeNote="RV Regional GCS (% change in RV free-wall length) has no published reference range and has not been clinically validated — values below are real but exploratory."
        bullseyeIntroNote="9-segment RV bullseye (basal / mid / apical × 3 sections, Seg1 inferior → Seg3 anterior), rays cast from the LV centre, segment layout fixed at end-diastole. RV Regional GCS (% change in free-wall length) and RV Regional GAS (% change in cavity area) are reported as two separate measures, not combined. Both are prototypes with no published reference range, so neither is clinically validated."
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
        emptyMessage="Not computed — run RV strain from the Strain tab to populate RV Regional GAS."
        renderBullseye={(values) => <RvRegionRing values={values} lo={gasRange.lo} hi={gasRange.hi} ringCount={3} muted={!hasGas} dashed={!hasGas} />}
        tablePrototypeNote={hasGas
          ? "RV Regional GAS (% change in RV cavity area, short-axis) has no published reference range and has not been clinically validated — values below are real but exploratory. Regional FAC = −GAS."
          : "This RV strain series was computed before GAS was stored — recompute the RV strain series to populate these values."}
        theme="amber"
      />
    </>
  );
}
