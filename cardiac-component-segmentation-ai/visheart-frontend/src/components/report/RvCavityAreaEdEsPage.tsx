"use client";

import React from "react";
import { RvRegionRing } from "./RvRegionRing";
import { ReportPageFrame } from "./ReportPageFrame";
import { fmt } from "./print-utils";
import { rvTotalArea } from "@/lib/rvAreaMetrics";

/** Broadcast each ring's single FAC value across its 3 sections — same helper
 *  WallThicknessCavityAreaPage already uses, since FAC is tracked per-RING. */
function rvFacToNineWide(rings: (number | null)[]): (number | null)[] {
  return [0, 1, 2].flatMap((ring) => [rings[ring] ?? null, rings[ring] ?? null, rings[ring] ?? null]);
}

function StatSquare({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-md border-2 border-gray-300 bg-gray-50 px-2 py-1.5 text-center">
      <p className="text-[11px] uppercase tracking-wide text-gray-600">{label}</p>
      <p className="font-mono text-[16px] font-bold text-gray-900">{value}</p>
    </div>
  );
}

/** Sum of area_ed_mm2/area_es_mm2 across the 3 segments of one ring (0=basal, 1=mid, 2=apical). */
function ringAreaSum(regions: { area_ed_mm2?: number | null; area_es_mm2?: number | null }[], ring: number) {
  const slice = regions.slice(ring * 3, ring * 3 + 3);
  const ed = slice.map((r) => r.area_ed_mm2).filter((v): v is number => typeof v === "number");
  const es = slice.map((r) => r.area_es_mm2).filter((v): v is number => typeof v === "number");
  return {
    ed: ed.length ? ed.reduce((a, b) => a + b, 0) : null,
    es: es.length ? es.reduce((a, b) => a + b, 0) : null,
  };
}

/**
 * Default-mode ("ED/ES Only") twin of WallThicknessCavityAreaPage's RV half. FAC is
 * fundamentally an ED→ES *change*, not an independently-defined value at each phase
 * (per the report-redesign spec's own warning against inventing "ED FAC"/"ES FAC"),
 * so this keeps the ONE existing FAC ring (RvRegionRing, same component the full
 * report already uses) and adds the raw ED/ES area numbers as a table column instead
 * of a second ring chart.
 */
export function RvCavityAreaEdEsPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  modeLabel,
  rvRegions,
  rvFacRings,
  rvFacGlobal,
  edFrameIndex,
  esFrameIndex,
}: {
  patientLabel: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  modeLabel?: string;
  /** RvStrain.regions — carries area_ed_mm2/area_es_mm2 per of the 9 segments. */
  rvRegions?: { area_ed_mm2?: number | null; area_es_mm2?: number | null }[];
  /** ED→ES RV FAC per ring [basal, mid, apical] (%) — already computed (rvEdEsFac). */
  rvFacRings: (number | null)[];
  /** ED→ES global RV FAC (%). */
  rvFacGlobal: number | null;
  /** RV's OWN ED/ES frame selection — can differ from LV's. */
  edFrameIndex?: number | null;
  esFrameIndex?: number | null;
}) {
  const hasFac = rvFacGlobal !== null;
  const totalArea = rvTotalArea({ regions: rvRegions });

  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Complete"
      modeLabel={modeLabel}
      title="RV Cavity Area — ED vs ES"
      subtitle="Short-axis RV cavity area and fractional area change (FAC), end-diastole to end-systole"
      generatedAt={generatedAt}
    >
      {!hasFac ? (
        <p className="py-10 text-center text-[14px] text-gray-600">
          Not computed — run RV strain (ED → ES) from the Strain tab. Results computed before GAS
          was added need recomputing.
        </p>
      ) : (
        <>
          <p className="mb-2 text-[13px] leading-snug text-gray-600">
            FAC = (ED area − ES area) / ED area × 100 — an ED-to-ES change, not an independent value
            at each phase, so it is shown once here (not as separate "ED FAC"/"ES FAC" figures).
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-gray-300 p-2">
              <p className="mb-1 text-center text-[15px] font-extrabold text-gray-900">
                FAC — ED (Frame {edFrameIndex != null ? edFrameIndex + 1 : "—"}) → ES (Frame {esFrameIndex != null ? esFrameIndex + 1 : "—"})
              </p>
              <div className="mx-auto h-[260px] w-[260px]">
                <RvRegionRing values={rvFacToNineWide(rvFacRings)} metric="FAC" />
              </div>
              <div className="mt-2 flex gap-1.5">
                <StatSquare label="Global FAC" value={`${fmt(rvFacGlobal)} %`} />
              </div>
            </div>
            <div>
              <p className="mb-1 text-[15px] font-extrabold text-gray-900">Cavity Area (mm²)</p>
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-teal-50">
                    <th className="border-b border-gray-300 px-2 py-1 text-left font-bold text-teal-800">Region</th>
                    <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-teal-800">ED area</th>
                    <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-teal-800">ES area</th>
                    <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-teal-800">FAC</th>
                  </tr>
                </thead>
                <tbody>
                  {["Basal", "Mid", "Apical"].map((r, i) => {
                    const { ed, es } = ringAreaSum(rvRegions ?? [], i);
                    return (
                      <tr key={r}>
                        <td className="border-b border-gray-300/60 px-2 py-1 text-gray-900">{r}</td>
                        <td className="border-b border-gray-300/60 px-2 py-1 text-right font-mono text-gray-900">{fmt(ed)}</td>
                        <td className="border-b border-gray-300/60 px-2 py-1 text-right font-mono text-gray-900">{fmt(es)}</td>
                        <td className="border-b border-gray-300/60 px-2 py-1 text-right font-mono text-gray-900">{fmt(rvFacRings[i] ?? null)}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-gray-50 font-semibold">
                    <td className="border-b border-gray-300/60 px-2 py-1 text-gray-900">Global</td>
                    <td className="border-b border-gray-300/60 px-2 py-1 text-right font-mono text-gray-900">{fmt(totalArea.ed)}</td>
                    <td className="border-b border-gray-300/60 px-2 py-1 text-right font-mono text-gray-900">{fmt(totalArea.es)}</td>
                    <td className="border-b border-gray-300/60 px-2 py-1 text-right font-mono text-gray-900">{fmt(rvFacGlobal)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2 text-[11px] leading-snug text-gray-600">
                Not the echocardiographic 4-chamber FAC — short-axis MRI, no validated reference
                range. Frame numbers are one-based.
              </p>
            </div>
          </div>
        </>
      )}
    </ReportPageFrame>
  );
}
