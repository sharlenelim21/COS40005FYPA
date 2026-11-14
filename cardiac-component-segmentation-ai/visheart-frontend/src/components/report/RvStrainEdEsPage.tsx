"use client";

import React from "react";
import { RvRegionRing, RV_REGION_LABELS_9 } from "./RvRegionRing";
import { ReportPageFrame } from "./ReportPageFrame";
import { fmt } from "./print-utils";
import { RvResearchNotice } from "@/components/landmark/RvResearchNotice";

/**
 * Default-mode ("Summary Report") RV strain page: one GCS map and one GAS map, each the
 * single stored ED→ES result (RvStrain.regions[i].gcs/gas) — same simplification as
 * LvStrainEdEsPage, and for the same reason: GCS/GAS is 0% at ED by definition, so a
 * second "ED map" that's always uniformly zero adds no information. The fact itself is
 * still stated below, just not drawn as its own flat chart.
 */
export function RvStrainEdEsPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  modeLabel,
  esGcs,
  esGas,
  septalGcs,
  edFrameIndex,
  esFrameIndex,
}: {
  patientLabel: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  modeLabel?: string;
  /** RvStrain.regions[i].gcs / gas — the stored ED→ES result, 9 values. */
  esGcs?: (number | null)[];
  esGas?: (number | null)[];
  /** RvStrain.global_rv_septal_gcs — septal-side border, a separate scope from the
   *  9 free-wall regions above. */
  septalGcs?: number | null;
  edFrameIndex?: number | null;
  esFrameIndex?: number | null;
}) {
  const gcs = esGcs ?? [];
  const gas = esGas ?? [];
  const hasGcs = gcs.some((v) => v != null);
  const hasGas = gas.some((v) => v != null);
  const phaseLabel = `ED (Frame ${edFrameIndex != null ? edFrameIndex + 1 : "—"}) → ES (Frame ${esFrameIndex != null ? esFrameIndex + 1 : "—"})`;

  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Complete"
      modeLabel={modeLabel}
      title="RV Regional Strain — ED → ES"
      subtitle="GCS and GAS, 9-segment RV bullseye"
      generatedAt={generatedAt}
    >
      {!hasGcs && !hasGas ? (
        <p className="py-10 text-center text-[14px] text-gray-600">
          Not computed — run RV strain from the Strain tab to populate RV Regional GCS/GAS.
        </p>
      ) : (
        <>
          <RvResearchNotice compact className="mb-2" />
          <p className="mb-2 text-[11px] leading-snug text-gray-600">
            GCS is % change in RV free-wall length; GAS is % change in RV cavity area — reported as
            two separate measures, never combined.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="mb-1.5 text-center text-[13px] font-semibold uppercase tracking-wide text-gray-600">
                GCS — {phaseLabel}
              </p>
              <div className="mx-auto h-[260px] w-[260px]">
                <RvRegionRing values={gcs} metric="GCS" muted={!hasGcs} />
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-center text-[13px] font-semibold uppercase tracking-wide text-gray-600">
                GAS — {phaseLabel}
              </p>
              <div className="mx-auto h-[260px] w-[260px]">
                <RvRegionRing values={gas} metric="GAS" muted={!hasGas} />
              </div>
            </div>
          </div>

          <table className="mt-3 w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-teal-50">
                <th className="border-b border-gray-300 px-2 py-1 text-left font-bold text-teal-800">Region</th>
                <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-teal-800">GCS (%)</th>
                <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-teal-800">GAS (%)</th>
              </tr>
            </thead>
            <tbody>
              {RV_REGION_LABELS_9.map((label, i) => (
                <tr key={label}>
                  <td className="border-b border-gray-300/60 px-2 py-0.5 text-gray-900">{i + 1}. {label}</td>
                  <td className="border-b border-gray-300/60 px-2 py-0.5 text-right font-mono text-gray-900">{fmt(gcs[i] ?? null)}</td>
                  <td className="border-b border-gray-300/60 px-2 py-0.5 text-right font-mono text-gray-900">{fmt(gas[i] ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] leading-snug text-gray-600">
            GCS/GAS is a % change measured relative to ED by definition (so ED&apos;s own value is
            0% for every region) — the figures above are the resulting ED→ES change. RV Peak Septal
            GCS (septal-side border, separate scope from the 9 free-wall regions
            above): <span className="font-mono font-semibold text-gray-900">{fmt(septalGcs ?? null)}%</span>.
            Frame numbers are one-based.
          </p>
        </>
      )}
    </ReportPageFrame>
  );
}
