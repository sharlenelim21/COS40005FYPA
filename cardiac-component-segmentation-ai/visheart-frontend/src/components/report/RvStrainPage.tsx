"use client";

import React from "react";
import type { RvStrain, RvStrainSeries } from "@/hooks/useProjectResults";
import { ReportPageFrame } from "./ReportPageFrame";

function fmt(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(digits);
}

/**
 * RV Regional Findings — print counterpart of the screen-only "RV Regional
 * Findings" card in InteractiveReport.tsx. Deliberately its own layout rather
 * than reusing the LV bullseye/full-cycle chart components: those are built
 * around the 17-segment AHA model (ringForSegment, frameLabel), which does not
 * apply here — RV cavity-radius strain is 2 rings (basal, mid) x 3 free-wall
 * sectors, not a bullseye geometry, so forcing it through the LV chart
 * helpers would either mis-render or imply an anatomy this measure doesn't have.
 *
 * Carries the same exploratory caveat as the screen version, verbatim in
 * substance: circumferential (not the validated longitudinal RV measure),
 * short-axis only (through-plane motion unaccounted for), geometric
 * contour-length proxy rather than tracked material points, and — critically —
 * no severity threshold, so nothing here is colour-graded and it must never be
 * read as feeding a health-status grade.
 */
export function RvStrainPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  rvStrain,
  rvStrainSeries,
}: {
  patientLabel: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  rvStrain?: RvStrain;
  rvStrainSeries?: RvStrainSeries;
}) {
  const hasAny = !!(rvStrain?.regions?.length || rvStrainSeries?.frames?.length);

  const regionValues: { label: string; value: number | null }[] = rvStrainSeries?.peakFrameIndex != null
    ? (() => {
        const peakFrame = rvStrainSeries.frames.find((f) => f.frameIndex === rvStrainSeries.peakFrameIndex);
        return (peakFrame?.regions ?? []).map((r) => ({ label: r.label, value: r.strain }));
      })()
    : (rvStrain?.regions ?? []).map((r) => ({ label: r.label, value: r.strain }));

  const globalValue = rvStrainSeries?.peak_global_rv_strain ?? rvStrain?.global_rv_strain ?? null;

  const seriesRegionOrder = rvStrainSeries?.frames?.[0]?.regions
    ? [...rvStrainSeries.frames[0].regions].sort((a, b) => a.region - b.region)
    : [];

  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Complete"
      title="RV Regional Findings"
      subtitle="Exploratory · RV cavity-radius strain, short-axis · advisory only"
      generatedAt={generatedAt}
    >
      {!hasAny ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Not computed for this model — run RV strain from the Strain tab to populate this page.
        </p>
      ) : (
        <>
          <div className="mb-4 flex items-end gap-8">
            <div>
              <p className="text-[8.5px] uppercase tracking-wide text-muted-foreground">Global RV Strain</p>
              <p className="text-[18px] font-bold tabular-nums text-foreground">
                {fmt(globalValue)}
                <span className="ml-0.5 text-[10px] font-semibold text-muted-foreground">%</span>
              </p>
            </div>
          </div>

          {/* No severity colouring — there is no validated cutoff for this
              measure, so tinting the cells would imply one that doesn't exist. */}
          <section className="mb-4">
            <h3 className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
              {rvStrainSeries?.peakFrameIndex != null ? "Regional strain at peak frame" : "Regional strain (ED→ES)"}
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {regionValues.map((r, i) => (
                <div key={`${r.label}-${i}`} className="rounded-lg border border-border px-2.5 py-2">
                  <p className="text-[8.5px] uppercase tracking-wide text-muted-foreground">{r.label}</p>
                  <p className="mt-1 text-[14px] font-bold tabular-nums text-foreground">
                    {fmt(r.value)}
                    <span className="ml-0.5 text-[9px] font-semibold text-muted-foreground">%</span>
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Per-frame region table — the RV analogue of the LV per-frame bar
              grid, sized for the 2-ring x 3-sector measure instead of 17 segments. */}
          {rvStrainSeries?.frames?.length ? (
            <section>
              <h3 className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
                Across the cardiac cycle
              </h3>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full border-collapse text-[8.5px]">
                  <thead>
                    <tr className="bg-muted/30">
                      <th className="border-b border-border px-2 py-1 text-left font-semibold text-muted-foreground">Frame</th>
                      <th className="border-b border-border px-2 py-1 text-right font-semibold text-muted-foreground">Global</th>
                      {seriesRegionOrder.map((r) => (
                        <th key={r.region} className="border-b border-border px-2 py-1 text-right font-semibold text-muted-foreground">
                          {r.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rvStrainSeries.frames.map((f) => {
                      const byRegion = new Map(f.regions.map((r) => [r.region, r.strain]));
                      const isPeak = f.frameIndex === rvStrainSeries.peakFrameIndex;
                      return (
                        <tr key={f.frameIndex} className={isPeak ? "bg-primary/5" : undefined}>
                          <td className="border-b border-border/60 px-2 py-1 text-foreground">
                            {f.frameIndex}{isPeak ? " (peak)" : ""}
                          </td>
                          <td className="border-b border-border/60 px-2 py-1 text-right tabular-nums text-foreground">
                            {fmt(f.global_rv_strain)}
                          </td>
                          {seriesRegionOrder.map((r) => (
                            <td key={r.region} className="border-b border-border/60 px-2 py-1 text-right tabular-nums text-foreground">
                              {fmt(byRegion.get(r.region))}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <p className="mt-3 text-[8.5px] leading-snug text-muted-foreground">
            Geometric contour-length proxy (cavity-radius), not tracked material points.
          </p>
          <p className="mt-1 text-[8.5px] leading-snug text-muted-foreground">
            Negative values indicate circumferential shortening. Circumferential, not the
            validated longitudinal RV measure; taken from short-axis slices, so through-plane
            motion is unaccounted for. No severity threshold is applied — this measure does not
            contribute to any health-status grade.
          </p>
        </>
      )}
    </ReportPageFrame>
  );
}
