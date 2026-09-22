"use client";

import React from "react";
import { StrainBullseyeChart, SEGMENT_LABELS } from "@/components/landmark/StrainVisualization";
import { FrameSeriesPages, frameSeriesPageCount, type SeriesFrame } from "./FrameSeriesPages";

export function lvRegionalStrainPageCount(frameCount: number): number {
  return frameSeriesPageCount(frameCount) * 2; // GRS section + GCS section
}

export function LvRegionalStrainPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  grsFrames,
  gcsFrames,
  edFrameIndex,
  esFrameIndex,
}: {
  patientLabel: string;
  /** First physical page number this component occupies. */
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  grsFrames: SeriesFrame[];
  gcsFrames: SeriesFrame[];
  edFrameIndex?: number | null;
  esFrameIndex?: number | null;
}) {
  const grsPages = frameSeriesPageCount(grsFrames.length);

  return (
    <>
      <FrameSeriesPages
        patientLabel={patientLabel}
        pageNumber={pageNumber}
        totalPages={totalPages}
        generatedAt={generatedAt}
        metricLabel="LV Regional GRS"
        columnLabels={SEGMENT_LABELS}
        frames={grsFrames}
        edFrameIndex={edFrameIndex}
        esFrameIndex={esFrameIndex}
        emptyMessage="Not computed — run the per-frame strain series to populate LV Regional GRS."
        renderBullseye={(values) => (
          <StrainBullseyeChart
            data={values.map((v, i) => ({ segment: i + 1, label: SEGMENT_LABELS[i], strain: v ?? 0 }))}
            strainType="GRS"
            sharedMin={0}
            sharedMax={42}
          />
        )}
      />
      <FrameSeriesPages
        patientLabel={patientLabel}
        pageNumber={pageNumber + grsPages}
        totalPages={totalPages}
        generatedAt={generatedAt}
        metricLabel="LV Regional GCS"
        columnLabels={SEGMENT_LABELS}
        frames={gcsFrames}
        edFrameIndex={edFrameIndex}
        esFrameIndex={esFrameIndex}
        emptyMessage="Not computed — run the per-frame strain series to populate LV Regional GCS."
        renderBullseye={(values) => (
          <StrainBullseyeChart
            data={values.map((v, i) => ({ segment: i + 1, label: SEGMENT_LABELS[i], strain: v ?? 0 }))}
            strainType="GCS"
            sharedMin={-26}
            sharedMax={2}
            reverseColors
          />
        )}
      />
    </>
  );
}
