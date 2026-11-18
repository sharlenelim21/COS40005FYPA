// Shared geometry for the guide's strain diagrams (schematic SVGs, no data).
//
// Angles are SVG screen angles in degrees: 0 = right, 90 = down, 180 = left,
// 270 = up (y grows downward). The diagrams use the standard short-axis
// display: anterior at the top, septum and RV on the LEFT, lateral on the
// right -- the same layout as the app's bullseye charts.

export interface Point {
  x: number;
  y: number;
}

export function polar(center: Point, radius: number, angleDeg: number): Point {
  const a = (angleDeg * Math.PI) / 180;
  return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
}

/** Path of the ring sector between two radii, from startDeg to endDeg (clockwise on screen). */
export function annularSector(center: Point, innerR: number, outerR: number, startDeg: number, endDeg: number): string {
  const os = polar(center, outerR, startDeg);
  const oe = polar(center, outerR, endDeg);
  const ie = polar(center, innerR, endDeg);
  const is = polar(center, innerR, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${os.x} ${os.y}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${oe.x} ${oe.y}`,
    `L ${ie.x} ${ie.y}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${is.x} ${is.y}`,
    "Z",
  ].join(" ");
}

export function polyline(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
}

/** Evenly spaced values from `start` to `end` inclusive. */
export function range(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  for (let v = start; v <= end + 1e-9; v += step) out.push(v);
  return out;
}

/**
 * Categorical colours for the three RV free-wall sections (Seg 1 inferior,
 * Seg 2, Seg 3 anterior). Not a strain scale -- no value is implied -- and
 * every use also carries a text label, so colour is never the only cue.
 * No red: red is reserved for the "research output" warnings.
 */
export const RV_SECTION_COLORS = ["#0d9488", "#7c3aed", "#d97706"] as const;

/** Text style shared by the diagrams: follows the guide's light/dark theme. */
export const LABEL_CLASS = "fill-foreground";
export const MUTED_LABEL_CLASS = "fill-muted-foreground";
