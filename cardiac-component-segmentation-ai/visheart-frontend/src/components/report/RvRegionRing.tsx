"use client";

import React from "react";

function hex2rgb(h: string): [number, number, number] {
  const c = h.replace("#", "");
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

/** Neutral (not red/green-graded) interpolation — used for RV values that have no validated reference range,
 *  so the color can't imply a normal/abnormal judgement that doesn't exist. */
function neutralColor(t: number): string {
  const [r1, g1, b1] = hex2rgb("#8b96a5");
  const [r2, g2, b2] = hex2rgb("#2c5f68");
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

export const RV_REGION_LABELS = ["Basal RV Free Wall 1", "Basal RV Free Wall 2", "Basal RV Free Wall 3", "Mid RV Free Wall 1", "Mid RV Free Wall 2", "Mid RV Free Wall 3"];

/** Illustrative 9-region labels (basal/mid/apical x 3 sectors) for the RV GAS
 *  prototype placeholder — no computation backs these yet, so there is no
 *  real region convention to match; this is a plausible future layout only. */
export const RV_REGION_LABELS_9 = [
  "Basal RV Free Wall 1", "Basal RV Free Wall 2", "Basal RV Free Wall 3",
  "Mid RV Free Wall 1", "Mid RV Free Wall 2", "Mid RV Free Wall 3",
  "Apical RV Free Wall 1", "Apical RV Free Wall 2", "Apical RV Free Wall 3",
];

/** RV polar diagram, 3 sectors per ring — 2 rings (basal/mid) for the real
 *  6-region GCS-proxy, or 3 rings (basal/mid/apical, 9 segments) for the GAS
 *  prototype placeholder, which has no real region convention yet. */
export function RvRegionRing({
  values, lo, hi, muted, dashed, ringCount = 2,
}: { values: (number | null)[]; lo: number; hi: number; muted?: boolean; dashed?: boolean; ringCount?: 2 | 3 }) {
  const size = 160, cx = size / 2, cy = size / 2;
  const boundaries = ringCount === 3 ? [76, 51, 26, 0] : [76, 38, 0];
  const wedge = (rIn: number, rOut: number, a0: number, a1: number) => {
    const pt = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [x0, y0] = pt(rOut, a0), [x1, y1] = pt(rOut, a1), [x2, y2] = pt(rIn, a1), [x3, y3] = pt(rIn, a0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${x0},${y0} A${rOut},${rOut} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${rIn},${rIn} 0 ${large} 0 ${x3},${y3} Z`;
  };
  const colorFor = (v: number | null) => {
    if (muted || v === null) return "#f3f4f6";
    const t = hi === lo ? 0.5 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
    return neutralColor(t);
  };
  const start = -Math.PI / 2;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
      {boundaries.slice(0, -1).map((rOut, ring) => {
        const rIn = boundaries[ring + 1];
        return Array.from({ length: 3 }, (_, i) => {
          const v = values[ring * 3 + i] ?? null;
          const a0 = start + (i * 2 * Math.PI) / 3, a1 = start + ((i + 1) * 2 * Math.PI) / 3;
          return (
            <path key={`${ring}-${i}`} d={wedge(rIn, rOut, a0, a1)} fill={colorFor(v)}
              stroke="#ffffff" strokeWidth={1.5} strokeDasharray={dashed ? "3,2" : undefined} />
          );
        });
      })}
    </svg>
  );
}
