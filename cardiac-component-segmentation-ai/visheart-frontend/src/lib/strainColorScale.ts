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

export type StrainScaleKey = "LV_GRS" | "LV_GCS" | "RV_GCS" | "RV_GAS" | "RV_FAC";

type Scale = {
  /** Value drawn fully yellow (least deformation). */
  worst: number;
  /** Value drawn fully blue (most deformation). */
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
  // RV cavity-area FAC = -GAS (rvAreaMetrics.ts) — same measurement, opposite
  // sign convention, so best is positive here instead of negative.
  RV_FAC: { worst: 0, best: 50, label: "RV FAC %" },
};

/**
 * The strain colour ramp, worst (t = 0) → best (t = 1): yellow → green →
 * blue, evenly spaced and blended linearly. No red/orange end, so the low end
 * reads as "less deformation", never as a warning. Every strain chart — SVG
 * bullseyes, CSS/SVG scale bars and the 3D heart — reads these stops, so
 * changing a hex here recolours all of them together.
 */
export const STRAIN_RAMP_STOPS = ["#facc15", "#22c55e", "#3b82f6"] as const;

const hexToRgb = (h: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

/** Ramp colour at t (0 = worst … 1 = best, clamped) as [r, g, b] in 0–1. */
export function strainRampRgb(t: number): [number, number, number] {
  const n = STRAIN_RAMP_STOPS.length - 1;
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const f = x - i;
  const a = hexToRgb(STRAIN_RAMP_STOPS[i]);
  const b = hexToRgb(STRAIN_RAMP_STOPS[i + 1]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Ramp colour at t as a CSS hex string. */
export function strainRampHex(t: number): string {
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${strainRampRgb(t).map(toHex).join("")}`;
}

/** Gradient stops for a left → right scale bar (worst → best, or best →
 *  worst when `reverse`), for SVG <stop>s and CSS linear-gradients alike. */
export function strainRampStops(reverse = false): { offset: string; color: string }[] {
  const n = STRAIN_RAMP_STOPS.length - 1;
  const colors = reverse ? [...STRAIN_RAMP_STOPS].reverse() : [...STRAIN_RAMP_STOPS];
  return colors.map((color, i) => ({ offset: `${Math.round((i / n) * 100)}%`, color }));
}

/** CSS linear-gradient matching strainRampHex exactly. */
export function strainRampCss(reverse = false): string {
  return `linear-gradient(to right, ${strainRampStops(reverse).map((s) => `${s.color} ${s.offset}`).join(", ")})`;
}

/** 0 = worst end (yellow) … 1 = best end (blue), clamped. */
export function strainScaleFraction(value: number, key: StrainScaleKey): number {
  const { worst, best } = STRAIN_COLOR_SCALES[key];
  return Math.max(0, Math.min(1, (value - worst) / (best - worst)));
}

/** The same scale in the min/max/reverse form most chart components take:
 *  t = (v - min) / (max - min), coloured strainRamp(reverse ? 1 - t : t). */
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
