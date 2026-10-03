"use client";

/**
 * AhaBullseye — the ONE AHA 17-segment LV bullseye used by the landmark
 * page's Wall Thickness (Structure tab) and LV Strain (Strain tab) views, so
 * the two look and behave identically. Replaces the page's old
 * AhaBullseyeChart/BullseyeSegment and the Strain tab's separate LV drawing.
 *
 * Colours are per-view min→max (red → yellow → green), the same rdYlGn ramp
 * the 3D heart uses. `reverse` flips it for measures where MORE NEGATIVE is
 * more deformation (GCS, RV GAS), so green always means "more".
 *
 * BullseyeScaleBar is the matching bar + Min / Mean / Max row shown under it.
 */

import React from "react";
import { rdYlGn, polarPoint, annularSectorPath } from "./StrainVisualization";

export type BullseyeHover = { x: number; y: number; name: string; value: number; pct: number };

/** Segment fill for a value on the view's own min→max scale. */
export function bullseyeColor(value: number | null | undefined, min: number, max: number, reverse = false): string {
  // Missing or exactly 0 (no measurement at this frame) -> grey, same as the 3D model.
  if (value == null || !Number.isFinite(value) || value === 0) return "#444444";
  const t = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0.5;
  return rdYlGn(reverse ? 1 - t : t);
}

/** Position of a value along the min→max bar, as a whole percent (0 = min, 100 = max). */
function pctOf(value: number, min: number, max: number): number {
  return max > min ? Math.round(((value - min) / (max - min)) * 100) : 0;
}

/** Min/max of the finite values (0/0 if none). */
export function finiteRange(values: (number | null | undefined)[]): { min: number; max: number; mean: number | null } {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (!v.length) return { min: 0, max: 0, mean: null };
  return { min: Math.min(...v), max: Math.max(...v), mean: v.reduce((a, b) => a + b, 0) / v.length };
}

const RADII = { basalOuter: 108, basalInner: 81, midInner: 54, apicalInner: 28 };
const LABEL_STYLE = { pointerEvents: "none" as const, filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.55))" };

export function AhaBullseye({
  values,
  names,
  min,
  max,
  reverse = false,
  selectedSegment = -1,
  onSegmentClick,
  onSegmentHover,
  onSegmentLeave,
  ariaLabel = "AHA 17-segment bullseye",
}: {
  /** 17 values, standard AHA order (basal 1-6, mid 7-12, apical 13-16, apex 17). */
  values: (number | null)[];
  /** 17 segment names for the hover tooltip. */
  names: string[];
  min: number;
  max: number;
  reverse?: boolean;
  /** 0-based selected segment, -1 = none. */
  selectedSegment?: number;
  onSegmentClick?: (index: number) => void;
  onSegmentHover?: (t: BullseyeHover) => void;
  onSegmentLeave?: () => void;
  ariaLabel?: string;
}) {
  const center = 150;
  const { basalOuter, basalInner, midInner, apicalInner } = RADII;

  const hover = (index: number) => (e: React.MouseEvent) => {
    const v = values[index];
    if (!onSegmentHover || v == null) return;
    onSegmentHover({ x: e.clientX, y: e.clientY, name: names[index] ?? `Segment ${index + 1}`, value: v, pct: pctOf(v, min, max) });
  };

  const segment = (index: number, innerR: number, outerR: number, startAngle: number, endAngle: number) => {
    const value = values[index];
    const mid = (startAngle + endAngle) / 2;
    const label = polarPoint(center, (innerR + outerR) / 2, mid);
    const showValue = outerR - innerR >= 20;
    const selected = selectedSegment === index;
    return (
      <g key={index}>
        <path
          d={annularSectorPath(center, innerR, outerR, startAngle, endAngle)}
          fill={bullseyeColor(value, min, max, reverse)}
          stroke={selected ? "white" : "rgba(0,0,0,0.9)"}
          strokeWidth={selected ? 2.5 : 1}
          style={{ transition: "fill 240ms ease", cursor: "pointer" }}
          onMouseMove={hover(index)}
          onMouseLeave={onSegmentLeave}
          onClick={onSegmentClick ? () => onSegmentClick(index) : undefined}
        />
        <text x={label.x} y={label.y + (showValue ? 0 : 4)} textAnchor="middle" fontSize="9" fontWeight="600" fill="black" style={LABEL_STYLE}>
          {index + 1}
        </text>
        {showValue && (
          <text x={label.x} y={label.y + 11} textAnchor="middle" fontSize="8" fontWeight="600" fill="black" style={LABEL_STYLE}>
            {value == null ? "—" : value.toFixed(1)}
          </text>
        )}
      </g>
    );
  };

  const apex = values[16];
  return (
    <svg viewBox="0 0 300 300" role="img" aria-label={ariaLabel} className="h-full w-full text-[#475569] dark:text-slate-300">
      <circle cx={center} cy={center} r="112" className="fill-slate-50 stroke-slate-200 dark:fill-zinc-900 dark:stroke-zinc-700" strokeWidth="1" />

      {/* Standard AHA layout: Anterior at the top, the septal segments (2, 3,
          8, 9, 14) on the LEFT and the lateral ones (5, 6, 11, 12, 16) on the
          RIGHT. The chart is never rotated. */}
      <text x={center} y="12" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">Anterior</text>
      <text x="298" y={center + 4} textAnchor="end" fontSize="11" fontWeight="700" fill="currentColor">Lateral</text>
      <text x={center} y="290" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">Inferior</text>
      <text x="2" y={center + 4} textAnchor="start" fontSize="11" fontWeight="700" fill="currentColor">Septal</text>

      {Array.from({ length: 6 }, (_, i) =>
        segment(i, basalInner, basalOuter, -120 - i * 60, -60 - i * 60))}
      {Array.from({ length: 6 }, (_, i) =>
        segment(i + 6, midInner, basalInner, -120 - i * 60, -60 - i * 60))}
      {Array.from({ length: 4 }, (_, i) =>
        segment(i + 12, apicalInner, midInner, -135 - i * 90, -45 - i * 90))}

      <circle
        cx={center}
        cy={center}
        r={apicalInner}
        fill={bullseyeColor(apex, min, max, reverse)}
        stroke={selectedSegment === 16 ? "white" : "rgba(0,0,0,0.9)"}
        strokeWidth={selectedSegment === 16 ? 2.5 : 1}
        style={{ transition: "fill 240ms ease", cursor: "pointer" }}
        onMouseMove={hover(16)}
        onMouseLeave={onSegmentLeave}
        onClick={onSegmentClick ? () => onSegmentClick(16) : undefined}
      />
      <text x={center} y={center - 2} textAnchor="middle" fontSize="9" fontWeight="600" fill="black" style={LABEL_STYLE}>17</text>
      <text x={center} y={center + 9} textAnchor="middle" fontSize="8" fontWeight="600" fill="black" style={LABEL_STYLE}>
        {apex == null ? "—" : apex.toFixed(1)}
      </text>
    </svg>
  );
}

/** CSS gradient matching bullseyeColor exactly (rdYlGn is linear red→yellow→green). */
export function bullseyeGradientCss(reverse = false): string {
  return reverse
    ? "linear-gradient(to right, #00ff00, #ffff00, #ff0000)"
    : "linear-gradient(to right, #ff0000, #ffff00, #00ff00)";
}

/**
 * The bar + Min / Mean / Max row under a bullseye (Wall Thickness layout).
 * The bar always runs min (left) → max (right); `reverse` flips its colours
 * to match the segments when more-negative means more deformation.
 */
export function BullseyeScaleBar({
  min,
  max,
  mean,
  unit,
  reverse = false,
  title,
  missingCount = 0,
}: {
  min: number;
  max: number;
  mean: number | null;
  unit: string;
  reverse?: boolean;
  /** Optional label above the bar (used when a view shows two bars, e.g. LV + RV). */
  title?: string;
  missingCount?: number;
}) {
  const meanPct = mean != null && max > min ? Math.round(((mean - min) / (max - min)) * 100) : 50;
  const u = unit === "%" ? "%" : ` ${unit}`;
  // Compact single-line Min/Mean/Max (was a 2-line label+value stack per
  // stat) -- when two of these stack (LV + RV in Combined view) the taller
  // version ate enough vertical space to visibly shrink the bullseye above
  // it, reported live as "the bullseyes look too small" (2026-10).
  return (
    <div className="flex-shrink-0 pt-1 space-y-0.5">
      {title && <p className="text-[8.5px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>}
      <div className="flex items-center gap-1.5">
        <span className="text-[8px] text-muted-foreground tabular-nums">{min.toFixed(1)}</span>
        <div className="h-1 flex-1 rounded-full" style={{ background: bullseyeGradientCss(reverse), border: "1px solid hsl(var(--border))" }} />
        <span className="text-[8px] text-muted-foreground tabular-nums">{max.toFixed(1)}</span>
      </div>
      <div className="flex justify-between gap-1 text-[8px] leading-tight">
        <span className="text-muted-foreground">Min <span className="font-semibold tabular-nums text-foreground">{min.toFixed(1)}{u}</span></span>
        <span className="text-muted-foreground">Mean <span className="font-semibold tabular-nums text-primary">{(mean ?? 0).toFixed(1)}{u}</span> <span className="opacity-70">({meanPct}%)</span></span>
        <span className="text-muted-foreground">Max <span className="font-semibold tabular-nums text-foreground">{max.toFixed(1)}{u}</span></span>
      </div>
      {missingCount > 0 && (
        <p className="text-[8px] text-amber-600 dark:text-amber-400">
          ⚠ {missingCount} segment{missingCount > 1 ? "s" : ""} missing
        </p>
      )}
    </div>
  );
}
