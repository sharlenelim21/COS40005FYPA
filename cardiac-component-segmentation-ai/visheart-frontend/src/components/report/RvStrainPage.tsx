"use client";

import React from "react";
import type { RvStrain, RvStrainSeries } from "@/hooks/useProjectResults";
import { ReportPageFrame } from "./ReportPageFrame";

const BAND_ORDER: RvStrain["segments"][number]["band"][] = ["basal", "mid", "apical"];
const BAND_LABEL: Record<string, string> = { basal: "Basal", mid: "Mid", apical: "Apical" };

function fmt(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(digits);
}

/**
 * RV Regional Findings — print counterpart of the screen-only "RV Regional
 * Findings" card in InteractiveReport.tsx. Deliberately its own layout rather
 * than reusing the LV bullseye/full-cycle chart components: those are built
 * around the 17-segment AHA model (ringForSegment, frameLabel), which does not
 * apply here — RV cavity-radius strain has only 3 bands (basal/mid/apical
 * free-wall), not a bullseye geometry, so forcing it through the LV chart
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
  const hasAny = !!(rvStrain || rvStrainSeries?.frames?.length);

  // Prefer the full-cycle series for the per-band table (real per-frame data);
  // fall back to the single ED→ES rvStrain result when only that exists.
  const bandValues: { band: string; value: number | null }[] = rvStrainSeries?.peakFrameIndex != null
    ? (() => {
        const peakFrame = rvStrainSeries.frames.find((f) => f.frameIndex === rvStrainSeries.peakFrameIndex);
        return (peakFrame?.regions ?? []).map((r) => ({ band: r.label, value: r.strain }));
      })()
    : (rvStrain?.segments ?? []).map((s) => ({ band: BAND_LABEL[s.band] ?? s.band, value: s.rv_gcs }));

  const globalValue = rvStrainSeries?.peak_global_rv_strain ?? rvStrain?.global_rv_gcs ?? null;

  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Complete"
      title="RV Regional Findings"
      subtitle="Exploratory · RV circumferential strain (RV GCS), short-axis · advisory only"
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
              <p className="text-[8.5px] uppercase tracking-wide text-muted-foreground">Global RV GCS</p>
              <p className="text-[18px] font-bold tabular-nums text-foreground">
                {fmt(globalValue)}
                <span className="ml-0.5 text-[10px] font-semibold text-muted-foreground">%</span>
              </p>
            </div>
            {rvStrain?.free_wall_gcs != null && (
              <div>
                <p className="text-[8.5px] uppercase tracking-wide text-muted-foreground">Free-wall GCS</p>
                <p className="text-[18px] font-bold tabular-nums text-foreground">
                  {fmt(rvStrain.free_wall_gcs)}
                  <span className="ml-0.5 text-[10px] font-semibold text-muted-foreground">%</span>
                </p>
              </div>
            )}
          </div>

          {/* No severity colouring — there is no validated cutoff for this
              measure, so tinting the cells would imply one that doesn't exist. */}
          <section className="mb-4">
            <h3 className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
              {rvStrainSeries?.peakFrameIndex != null ? "Regional strain at peak frame" : "Regional strain (ED→ES)"}
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {bandValues.map((b) => (
                <div key={b.band} className="rounded-lg border border-border px-2.5 py-2">
                  <p className="text-[8.5px] uppercase tracking-wide text-muted-foreground">{b.band}</p>
                  <p className="mt-1 text-[14px] font-bold tabular-nums text-foreground">
                    {fmt(b.value)}
                    <span className="ml-0.5 text-[9px] font-semibold text-muted-foreground">%</span>
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Per-frame band table — the RV analogue of the LV per-frame bar
              grid, sized for the 3-band measure instead of 17 segments. */}
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
                      {BAND_ORDER.map((band) => (
                        <th key={band} className="border-b border-border px-2 py-1 text-right font-semibold text-muted-foreground">
                          {BAND_LABEL[band]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rvStrainSeries.frames.map((f) => {
                      const byLabel = new Map(f.regions.map((r) => [r.label.toLowerCase(), r.strain]));
                      const isPeak = f.frameIndex === rvStrainSeries.peakFrameIndex;
                      return (
                        <tr key={f.frameIndex} className={isPeak ? "bg-primary/5" : undefined}>
                          <td className="border-b border-border/60 px-2 py-1 text-foreground">
                            {f.frameIndex}{isPeak ? " (peak)" : ""}
                          </td>
                          <td className="border-b border-border/60 px-2 py-1 text-right tabular-nums text-foreground">
                            {fmt(f.global_rv_strain)}
                          </td>
                          {BAND_ORDER.map((band) => (
                            <td key={band} className="border-b border-border/60 px-2 py-1 text-right tabular-nums text-foreground">
                              {fmt(byLabel.get(band) ?? f.regions.find((r) => r.label.toLowerCase().includes(band))?.strain)}
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
            {rvStrain?.note ?? "Geometric contour-length proxy (cavity-radius), not tracked material points."}
            {(rvStrain?.source || rvStrain?.method) && (
              <span className="ml-1 opacity-80">
                ({[rvStrain.source, rvStrain.method].filter(Boolean).join(" · ")})
              </span>
            )}
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
