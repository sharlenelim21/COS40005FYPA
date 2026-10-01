/**
 * rvAreaMetrics — RV area-based metrics (GAS, FAC) derived from the stored
 * 9-segment RV strain results, shared by the on-screen report, the printed
 * report and the CSV so they can never disagree.
 *
 * Definitions (short-axis MRI, see bullseye_analysis.mask_to_rv_regions):
 *   GAS = (A_ES − A_ED) / A_ED × 100   (negative = contraction)
 *   FAC = (A_ED − A_ES) / A_ED × 100 = −GAS
 * where A is the RV cavity area inside a segment's wedge, averaged over that
 * ring's slices. Ring / global values are ratio-of-totals over their segments
 * (same rule the backend uses for global_rv_gas), not an average of
 * per-segment percentages.
 *
 * This is a short-axis, MRI-derived FAC — NOT the echo 4-chamber FAC, so the
 * echo cutoff (≈35%) does not apply to it.
 */

import type { RvStrain, RvStrainSeries } from "@/hooks/useProjectResults";

export const RV_RING_NAMES = ["Basal", "Mid", "Apical"] as const;

type AreaPair = { region: number; ed: number | null | undefined; es: number | null | undefined };

/** Ratio-of-totals FAC over the given segments; null if no segment has both areas. */
function facOf(pairs: AreaPair[]): number | null {
  let sumEd = 0;
  let sumEs = 0;
  let n = 0;
  for (const p of pairs) {
    if (typeof p.ed === "number" && Number.isFinite(p.ed) && typeof p.es === "number" && Number.isFinite(p.es)) {
      sumEd += p.ed;
      sumEs += p.es;
      n++;
    }
  }
  return n && sumEd > 0 ? ((sumEd - sumEs) / sumEd) * 100 : null;
}

/** FAC per ring [basal, mid, apical] — segments 1-3, 4-6, 7-9. */
function ringFacs(pairs: AreaPair[]): (number | null)[] {
  return RV_RING_NAMES.map((_, ring) => facOf(pairs.filter((p) => Math.ceil(p.region / 3) === ring + 1)));
}

/** Peak (most negative) global RV GAS: over the full-cycle series if present, else the single ED→ES result. */
export function rvPeakGas(rvStrain?: RvStrain | null, rvStrainSeries?: RvStrainSeries | null): number | null {
  const vals = (rvStrainSeries?.frames ?? [])
    .map((f) => f.global_rv_gas)
    .filter((v): v is number => typeof v === "number");
  if (vals.length) return Math.min(...vals);
  return typeof rvStrain?.global_rv_gas === "number" ? rvStrain.global_rv_gas : null;
}

/** Peak global RV FAC (= −peak GAS). */
export function rvPeakFac(rvStrain?: RvStrain | null, rvStrainSeries?: RvStrainSeries | null): number | null {
  const gas = rvPeakGas(rvStrain, rvStrainSeries);
  return gas == null ? null : -gas;
}

/** ED→ES FAC per ring + global, from the single ED→ES RV strain result. */
export function rvEdEsFac(rvStrain?: RvStrain | null): { rings: (number | null)[]; global: number | null } {
  const pairs: AreaPair[] = (rvStrain?.regions ?? []).map((r) => ({ region: r.region, ed: r.area_ed_mm2, es: r.area_es_mm2 }));
  return { rings: ringFacs(pairs), global: facOf(pairs) };
}

/** Per-frame FAC per ring + global (each frame vs ED), from the full-cycle series.
 *  Series computed before per-frame areas were stored give nulls. */
export function rvFacSeries(rvStrainSeries?: RvStrainSeries | null): { frameIndex: number; rings: (number | null)[]; global: number | null }[] {
  return [...(rvStrainSeries?.frames ?? [])]
    .sort((a, b) => a.frameIndex - b.frameIndex)
    .map((f) => {
      const pairs: AreaPair[] = f.regions.map((r) => ({ region: r.region, ed: r.area_ed_mm2, es: r.area_mm2 }));
      return { frameIndex: f.frameIndex, rings: ringFacs(pairs), global: facOf(pairs) };
    });
}

/** Peak (most negative) RV septal GCS — septal-side border, separate from
 *  the free-wall GCS. Over the full-cycle series if present, else ED→ES. */
export function rvPeakSeptalGcs(rvStrain?: RvStrain | null, rvStrainSeries?: RvStrainSeries | null): number | null {
  const vals = (rvStrainSeries?.frames ?? [])
    .map((f) => f.global_rv_septal_gcs)
    .filter((v): v is number => typeof v === "number");
  if (vals.length) return Math.min(...vals);
  return typeof rvStrain?.global_rv_septal_gcs === "number" ? rvStrain.global_rv_septal_gcs : null;
}

/** Short text describing the measured RV GAS for the disease-pattern factors,
 *  which stay unscored because no validated GAS cutoff exists. */
export function rvGasMeasuredNote(rvStrain?: RvStrain | null, rvStrainSeries?: RvStrainSeries | null): string | null {
  const gas = rvPeakGas(rvStrain, rvStrainSeries);
  return gas == null ? null : `Measured peak RV GAS ${gas.toFixed(1)}% (FAC ${(-gas).toFixed(1)}%, short-axis)`;
}
