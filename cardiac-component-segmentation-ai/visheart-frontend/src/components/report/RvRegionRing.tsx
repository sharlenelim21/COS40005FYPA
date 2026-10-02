"use client";

import React from "react";
import { CombinedVentricularChart } from "@/components/landmark/CombinedVentricularChart";

/** The backend's 9-segment RV bullseye labels (basal/mid/apical x 3 sections,
 *  Seg1 inferior → Seg3 anterior) — same order as the strain regions 1-9. */
export const RV_REGION_LABELS_9 = [
  "Basal_Seg1", "Basal_Seg2", "Basal_Seg3",
  "Mid_Seg1", "Mid_Seg2", "Mid_Seg3",
  "Apical_Seg1", "Apical_Seg2", "Apical_Seg3",
];

/** 9-wide values -> the region-object shape CombinedVentricularChart takes. */
function valuesToRvRegions(values: (number | null)[]): { region: number; label: string; strain: number | null }[] {
  return values.map((v, i) => ({ region: i + 1, label: RV_REGION_LABELS_9[i] ?? `RV Region ${i + 1}`, strain: v }));
}

/**
 * RV bullseye for the printed report — a thin wrapper around
 * CombinedVentricularChart (the SAME crescent-shaped component the live app
 * uses for every other RV bullseye), not a separate print-only drawing.
 *
 * This replaces an earlier from-scratch SVG here that drew a FULL circle
 * (3 wedges x 360deg per ring) instead of the real RV's crescent shape, and
 * colored it with its own muted grey-to-teal gradient instead of the app's
 * red-yellow-green scale — reported live as "using a dummy round bullseye"
 * (2026-10). Reusing the real component guarantees the print page can never
 * visually disagree with what the app itself shows for the same data.
 */
export function RvRegionRing({
  values, metric, muted,
}: {
  /** 9 values, basal 1-3 / mid 4-6 / apical 7-9 (CRESCENT_REGION_NAMES order). */
  values: (number | null)[];
  /** Picks the same fixed colour scale (lib/strainColorScale.ts) the live
   *  app's RV bullseye uses for this metric. */
  metric: "GCS" | "GAS" | "FAC";
  /** When true, every wedge renders as "no data" grey regardless of value
   *  (old results computed before this metric existed). */
  muted?: boolean;
}) {
  return (
    <CombinedVentricularChart
      lvData={[]}
      hasLv={false}
      strainType="GRS"
      showLv={false}
      showRv={true}
      showColorBars={false}
      rvRegions={muted ? valuesToRvRegions(values).map((r) => ({ ...r, strain: null })) : valuesToRvRegions(values)}
      rvMetric={metric}
    />
  );
}
