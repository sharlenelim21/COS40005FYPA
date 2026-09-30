/**
 * strainColorScale — the ONE fixed colour scale for every strain chart
 * (landmark bullseye + 3D heart, interactive report, printed report, value
 * tables), so the same value always gets the same colour, for every patient
 * and on every page.
 *
 * Deliberately FIXED, not stretched to each patient's own min/max (that made
 * the lowest segment always red and the highest always green, whatever the
 * values), and deliberately NOT a clinical grade: none of these measures
 * (geometric GRS/GCS, RV cavity GCS/GAS) has a validated normal range, so the
 * colours only show "more / less deformation", never normal vs abnormal.
 *
 * Team-agreed ranges live here — change a number below and every chart follows.
 * Values beyond a range are clamped to its end colour (the number shown is
 * still the real value).
 */

export type StrainScaleKey = "LV_GRS" | "LV_GCS" | "RV_GCS" | "RV_GAS";

type Scale = {
  /** Value drawn fully red (least deformation). */
  worst: number;
  /** Value drawn fully green (most deformation). */
  best: number;
  label: string;
};

export const STRAIN_COLOR_SCALES: Record<StrainScaleKey, Scale> = {
  // Geometric wall thickening — typically ~30-80% with this method.
  LV_GRS: { worst: 0, best: 80, label: "LV GRS %" },
  // Circumferential shortening — more negative = more shortening.
  LV_GCS: { worst: 0, best: -30, label: "LV GCS %" },
  // RV free-wall and septal length strain (same scale for both).
  RV_GCS: { worst: 0, best: -30, label: "RV GCS %" },
  // RV cavity-area strain — area changes ~2x faster than length.
  RV_GAS: { worst: 0, best: -50, label: "RV GAS %" },
};

/** 0 = worst end (red) … 1 = best end (green), clamped. */
export function strainScaleFraction(value: number, key: StrainScaleKey): number {
  const { worst, best } = STRAIN_COLOR_SCALES[key];
  return Math.max(0, Math.min(1, (value - worst) / (best - worst)));
}

/** The same scale in the min/max/reverse form most chart components take:
 *  t = (v - min) / (max - min), coloured rdYlGn(reverse ? 1 - t : t). */
export function strainScaleMinMax(key: StrainScaleKey): { min: number; max: number; reverse: boolean } {
  const { worst, best } = STRAIN_COLOR_SCALES[key];
  return { min: Math.min(worst, best), max: Math.max(worst, best), reverse: best < worst };
}

/** LV key for the LV strain type toggle. */
export function lvScaleKey(strainType: "GRS" | "GCS"): StrainScaleKey {
  return strainType === "GRS" ? "LV_GRS" : "LV_GCS";
}

/** One-line note shown under charts in place of the old Excellent…Poor legend. */
export const FIXED_SCALE_NOTE =
  "Fixed colour scale — the same value gets the same colour for every patient. Colours show more/less deformation, not a clinical grade.";
