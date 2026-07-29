"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { getDummyStrainData, getStrainColor, type StrainSegmentData, type StrainType } from "./StrainVisualization";

// ── AHA ring grouping ──────────────────────────────────────────────────────
// Basal 1-6, Mid 7-12, Apical 13-16, Apex 17 — same convention used throughout
// the bullseye/heart components.

export type Ring = "basal" | "mid" | "apical" | "apex";

const RING_ORDER: Ring[] = ["basal", "mid", "apical", "apex"];
const RING_LABEL: Record<Ring, string> = {
  basal: "Basal ring",
  mid: "Mid ring",
  apical: "Apical ring",
  apex: "Apex",
};
// Reuses the app's existing shadcn chart tokens (--chart-1..4) instead of inventing new colors.
const RING_COLOR_VAR: Record<Ring, string> = {
  basal: "var(--chart-1)",
  mid: "var(--chart-2)",
  apical: "var(--chart-3)",
  apex: "var(--chart-4)",
};

export function ringForSegment(segment: number): Ring {
  if (segment <= 6) return "basal";
  if (segment <= 12) return "mid";
  if (segment <= 16) return "apical";
  return "apex";
}

const stripRingPrefix = (label: string) => label.replace(/^(Basal|Mid|Apical)\s*/, "");

/**
 * One frame's worth of per-segment strain, repeated across the cardiac cycle.
 * Backed by the existing getDummyStrainData generator until the backend computes
 * real per-frame strain (currently /bullseye/compute-strain only does ED vs ES).
 */
export function buildDummyCycleSeries(strainType: StrainType, totalFrames: number): StrainSegmentData[][] {
  const frames = Math.max(totalFrames || 9, 2);
  return Array.from({ length: frames }, (_, f) => getDummyStrainData(strainType, f, frames));
}

function valueAtFrame(series: StrainSegmentData[][], segment: number, frame: number): number {
  return series[frame]?.find((d) => d.segment === segment)?.strain ?? 0;
}

/** Catmull-Rom → cubic Bezier: smooth curve through every point (any count ≥ 2), no fake data. */
function smoothPathD(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function frameLabel(f: number, frames: number): string {
  if (f === 0) return "ED";
  if (f === frames - 1) return "Next ED";
  if (f === Math.round((frames - 1) / 2)) return "ES (peak)";
  return `F${f}`;
}

// ── 1. By Region — small multiples (Basal / Mid / Apical / Apex) ────────────
// Faceting by AHA ring keeps each panel inside a readable series count (≤6 lines)
// instead of 17 lines fighting for distinguishable colors in one chart.

export function RegionalStrainByRegion({
  series,
}: {
  series: StrainSegmentData[][];
}) {
  const frames = series.length;
  const segmentIds = series[0]?.map((d) => d.segment) ?? [];
  const ringsPresent = RING_ORDER.filter((r) => segmentIds.some((s) => ringForSegment(s) === r));

  // One ring at a time — the four toggles switch which ring's chart is shown,
  // rather than tiling all four at once (clearer, and gives each chart room for
  // a hover tooltip).
  const [ring, setRing] = useState<Ring>(ringsPresent[0] ?? "basal");
  // Hover by FRAME (not by point): the tooltip lists every segment's value at
  // that frame, matching the report's shared-tooltip behaviour.
  const [hoverFrame, setHoverFrame] = useState<number | null>(null);

  const segs = segmentIds.filter((s) => ringForSegment(s) === ring);
  const values = segs.flatMap((s) => Array.from({ length: frames }, (_, f) => valueAtFrame(series, s, f)));
  const yMin = Math.min(...values, 0) - 1;
  const yMax = Math.max(...values, 0) + 1;
  const w = 460, h = 230, padL = 34, padR = 14, padT = 10, padB = 22;
  const x = (f: number) => padL + (w - padL - padR) * (f / Math.max(frames - 1, 1));
  const y = (v: number) => padT + (h - padT - padB) * (1 - (v - yMin) / (yMax - yMin || 1));

  return (
    <div className="rounded-lg border border-border bg-background p-2.5">
      {/* Ring selector */}
      <div className="mb-2 inline-flex rounded-md border border-border bg-muted/30 p-0.5">
        {ringsPresent.map((r) => {
          const count = segmentIds.filter((s) => ringForSegment(s) === r).length;
          return (
            <button
              key={r}
              type="button"
              onClick={() => { setRing(r); setHoverFrame(null); }}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                ring === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <span className="h-1.5 w-1.5 rounded-sm" style={{ backgroundColor: RING_COLOR_VAR[r] }} />
              {RING_LABEL[r]} ({count})
            </button>
          );
        })}
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full">
          {/* gridlines + y labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const gy = padT + (h - padT - padB) * frac;
            const val = yMax - (yMax - yMin) * frac;
            return (
              <g key={frac}>
                <line x1={padL} x2={w - padR} y1={gy} y2={gy} stroke="var(--border)" strokeWidth={1} opacity={0.5} />
                <text x={padL - 4} y={gy + 3} textAnchor="end" fontSize={9} fill="var(--muted-foreground)">{val.toFixed(0)}</text>
              </g>
            );
          })}
          {segs.map((seg, idx) => {
            const opacity = 0.55 + (idx / Math.max(segs.length - 1, 1)) * 0.45;
            const points = Array.from({ length: frames }, (_, f) => `${x(f)},${y(valueAtFrame(series, seg, f))}`).join(" ");
            return <polyline key={seg} points={points} fill="none" stroke={RING_COLOR_VAR[ring]} strokeWidth={1.8} opacity={opacity} strokeLinecap="round" />;
          })}
          {/* Vertical guide + dots at the hovered frame for every segment. */}
          {hoverFrame !== null && (
            <>
              <line x1={x(hoverFrame)} x2={x(hoverFrame)} y1={padT} y2={h - padB} stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="3 3" />
              {segs.map((seg) => (
                <circle key={`dot-${seg}`} cx={x(hoverFrame)} cy={y(valueAtFrame(series, seg, hoverFrame))} r={2.4} fill={RING_COLOR_VAR[ring]} />
              ))}
            </>
          )}
          {/* Full-height hit columns, one per frame — hovering anywhere in a
              column selects that frame (report-style shared tooltip). */}
          {Array.from({ length: frames }, (_, f) => (
            <rect
              key={`hit-${f}`}
              x={f === 0 ? padL : (x(f - 1) + x(f)) / 2}
              y={padT}
              width={f === 0 ? (x(1) - x(0)) / 2 || 1 : (x(Math.min(f + 1, frames - 1)) - x(f - 1)) / 2}
              height={h - padT - padB}
              fill="transparent"
              onMouseEnter={() => setHoverFrame(f)}
              onMouseLeave={() => setHoverFrame(null)}
            />
          ))}
          <line x1={padL} x2={w - padR} y1={h - padB} y2={h - padB} stroke="var(--muted-foreground)" strokeWidth={1} />
          <text x={padL} y={h - 6} fontSize={9} fill="var(--muted-foreground)">ED</text>
          <text x={(padL + w - padR) / 2} y={h - 6} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">cardiac frame →</text>
          <text x={w - padR} y={h - 6} textAnchor="end" fontSize={9} fill="var(--muted-foreground)">ED</text>
        </svg>
        {hoverFrame !== null && (
          <div
            className="pointer-events-none absolute z-10 min-w-[120px] rounded border border-border bg-popover px-2 py-1.5 text-[9px] text-popover-foreground shadow-lg"
            style={{
              left: `${(x(hoverFrame) / w) * 100}%`,
              top: 4,
              transform: `translateX(${hoverFrame > frames / 2 ? "-105%" : "5%"})`,
            }}
          >
            <div className="mb-1 font-semibold">Frame {hoverFrame} · {RING_LABEL[ring]}</div>
            {segs.map((seg) => {
              const label = stripRingPrefix(series[0]?.find((d) => d.segment === seg)?.label ?? `Seg ${seg}`);
              return (
                <div key={seg} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: RING_COLOR_VAR[ring] }} />
                    {label}
                  </span>
                  <span className="font-mono tabular-nums">{valueAtFrame(series, seg, hoverFrame).toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 2. Full Cycle — all 17 segments in one chart, hover-to-isolate ──────────
// The "complete" clinical view (matches the reference strain-curve slide), restyled
// to the app's ring-grouped color language. Hover a legend row (LVSegmentsLegend,
// rendered separately — see below) to isolate a segment; the rest recede to low
// opacity instead of competing for 17 distinct hues.
//
// Chart and legend are split into two components so callers can lay them out
// however fits — side-by-side (used by the printed report) or in separate tabs
// (used by the sidebar, where a side panel would crowd the narrow width).

export function FullCycleChart({
  series,
  strainType,
  width = 560,
  height = 240,
  highlightSeg = null,
}: {
  series: StrainSegmentData[][];
  strainType: StrainType;
  width?: number;
  height?: number;
  highlightSeg?: number | null;
}) {
  const frames = series.length;
  const segmentIds = series[0]?.map((d) => d.segment) ?? [];
  const [hoverFrame, setHoverFrame] = useState<number | null>(null);

  // Fit the y-range to the actual data so peaks aren't clipped at a fixed cap
  // (real GRS can exceed the old 42 ceiling). Start from sensible defaults, then
  // widen to cover the data plus a small margin, snapped to the grid step.
  const allValues = segmentIds.flatMap((s) =>
    Array.from({ length: frames }, (_, f) => valueAtFrame(series, s, f)),
  );
  const dataMin = allValues.length ? Math.min(...allValues) : 0;
  const dataMax = allValues.length ? Math.max(...allValues) : 0;
  const step = 10;
  const defMin = strainType === "GRS" ? 0 : -26;
  const defMax = strainType === "GRS" ? 42 : 2;
  const yMin = Math.floor(Math.min(defMin, dataMin - 2) / step) * step;
  const yMax = Math.ceil(Math.max(defMax, dataMax + 2) / step) * step;
  const padL = 30, padR = 12, padT = 14, padB = 20;
  const x = (f: number) => padL + (width - padL - padR) * (f / Math.max(frames - 1, 1));
  const y = (v: number) => padT + (height - padT - padB) * (1 - (v - yMin) / (yMax - yMin));
  const yZero = y(0);
  const gridLines: number[] = [];
  for (let gy = Math.ceil(yMin / step) * step; gy <= yMax; gy += step) gridLines.push(gy);

  const diastoleEnd = Math.max(1, Math.round(frames * 0.22));
  const systoleEnd = Math.min(frames - 2, Math.round(frames * 0.78));
  // With very few frames (a small project) these can land on the same frame or
  // cross — there isn't enough resolution to meaningfully split 3 phases, so we
  // skip the band/separators/labels entirely rather than draw a zero-width
  // "systole" sliver (which also produced two <line> elements sharing one key).
  const hasPhaseBands = systoleEnd > diastoleEnd;

  // Render order matters for hover: draw the highlighted segment last so its
  // line sits on top of its neighbors instead of being partially hidden by them.
  const orderedSegments = highlightSeg === null
    ? segmentIds
    : [...segmentIds.filter((s) => s !== highlightSeg), highlightSeg];

  return (
    <div className="relative min-w-0">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full rounded-lg border border-border bg-background">
        {hasPhaseBands && (
          <rect
            x={x(diastoleEnd)} y={padT}
            width={Math.max(x(systoleEnd) - x(diastoleEnd), 0)} height={height - padT - padB}
            fill="var(--primary)" opacity={0.06}
          />
        )}
        {gridLines.map((gy) => (
          <g key={gy}>
            <line x1={padL} x2={width - padR} y1={y(gy)} y2={y(gy)} stroke="var(--border)" strokeDasharray="3 3" />
            <text x={2} y={y(gy) + 3} fontSize={10} fill="var(--muted-foreground)">{gy}</text>
          </g>
        ))}
        <line x1={padL} x2={width - padR} y1={yZero} y2={yZero} stroke="var(--muted-foreground)" strokeDasharray="3 3" />
        {hasPhaseBands && [
          { key: "diastole-end", f: diastoleEnd },
          { key: "systole-end", f: systoleEnd },
        ].map(({ key, f }) => (
          <line key={key} x1={x(f)} x2={x(f)} y1={padT} y2={height - padB} stroke="var(--border)" strokeDasharray="2 2" />
        ))}
        {orderedSegments.map((seg) => {
          const ring = ringForSegment(seg);
          const segsInRing = segmentIds.filter((s) => ringForSegment(s) === ring);
          const idxInRing = segsInRing.indexOf(seg);
          const isHovered = highlightSeg === seg;
          const dimmed = highlightSeg !== null && !isHovered;
          const opacity = dimmed ? 0.1 : isHovered ? 1 : 0.55 + (idxInRing / Math.max(segsInRing.length - 1, 1)) * 0.45;
          const points = Array.from({ length: frames }, (_, f) => ({ x: x(f), y: y(valueAtFrame(series, seg, f)) }));
          return (
            <path
              key={seg} d={smoothPathD(points)} fill="none" stroke={RING_COLOR_VAR[ring]}
              strokeWidth={isHovered ? 3 : 1.6} opacity={opacity} strokeLinecap="round" strokeLinejoin="round"
              style={{ transition: "opacity 150ms ease, stroke-width 150ms ease" }}
            />
          );
        })}
        <line x1={padL} x2={width - padR} y1={height - padB} y2={height - padB} stroke="var(--muted-foreground)" />
        {Array.from({ length: frames }, (_, f) => (
          <text key={f} x={x(f)} y={height - padB + 12} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">{f}</text>
        ))}
        {/* Vertical guide + a dot on every segment at the hovered frame. */}
        {hoverFrame !== null && (
          <>
            <line x1={x(hoverFrame)} x2={x(hoverFrame)} y1={padT} y2={height - padB} stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="3 3" />
            {segmentIds.map((seg) => (
              <circle key={`dot-${seg}`} cx={x(hoverFrame)} cy={y(valueAtFrame(series, seg, hoverFrame))} r={2} fill={RING_COLOR_VAR[ringForSegment(seg)]} />
            ))}
          </>
        )}
        {/* Full-height hit column per frame → report-style shared tooltip. */}
        {Array.from({ length: frames }, (_, f) => (
          <rect
            key={`hit-${f}`}
            x={f === 0 ? padL : (x(f - 1) + x(f)) / 2}
            y={padT}
            width={f === 0 ? (x(1) - x(0)) / 2 || 1 : (x(Math.min(f + 1, frames - 1)) - x(f - 1)) / 2}
            height={height - padT - padB}
            fill="transparent"
            onMouseEnter={() => setHoverFrame(f)}
            onMouseLeave={() => setHoverFrame(null)}
          />
        ))}
      </svg>
      {hoverFrame !== null && (
        <div
          className="pointer-events-none absolute z-10 max-h-[180px] w-[150px] overflow-auto rounded border border-border bg-popover px-2 py-1.5 text-[9px] text-popover-foreground shadow-lg"
          style={{
            left: `${(x(hoverFrame) / width) * 100}%`,
            top: 4,
            transform: `translateX(${hoverFrame > frames / 2 ? "-105%" : "5%"})`,
          }}
        >
          <div className="mb-1 font-semibold">Frame {hoverFrame}</div>
          {segmentIds.map((seg) => {
            const label = series[0]?.find((d) => d.segment === seg)?.label ?? `Seg ${seg}`;
            return (
              <div key={seg} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 truncate text-muted-foreground">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: RING_COLOR_VAR[ringForSegment(seg)] }} />
                  {label}
                </span>
                <span className="font-mono tabular-nums">{valueAtFrame(series, seg, hoverFrame).toFixed(1)}</span>
              </div>
            );
          })}
        </div>
      )}
      {hasPhaseBands ? (
        <div className="mt-1 flex text-center text-[9px] font-semibold">
          <span className="flex-[2] text-muted-foreground">Diastole (Filling)</span>
          <span className="flex-[4] border-x border-dashed border-border text-primary">Systole (Ejection)</span>
          <span className="flex-[2] text-muted-foreground">Diastole (Filling)</span>
        </div>
      ) : (
        <p className="mt-1 text-center text-[9px] text-muted-foreground">
          Cardiac phase breakdown needs more frames than this project has ({frames}).
        </p>
      )}
      <p className="mt-1.5 text-center text-[10px] italic text-muted-foreground">
        {strainType === "GRS"
          ? "Positive radial strain indicates myocardial wall thickening (contraction)."
          : "Negative circumferential strain indicates myocardial shortening (contraction)."}
      </p>
    </div>
  );
}

export function LVSegmentsLegend({
  series,
  highlightSeg = null,
  onHoverSeg,
  size = "sm",
  columns = 1,
}: {
  series: StrainSegmentData[][];
  highlightSeg?: number | null;
  /** Omit for a static (non-interactive) legend, e.g. print. */
  onHoverSeg?: (seg: number | null) => void;
  size?: "sm" | "xs";
  columns?: 1 | 2;
}) {
  const segmentIds = series[0]?.map((d) => d.segment) ?? [];
  const interactive = !!onHoverSeg;

  return (
    <div
      className={cn("rounded-lg border border-border bg-muted/20 p-2", columns === 2 && "columns-2 gap-2")}
      onMouseLeave={interactive ? () => onHoverSeg?.(null) : undefined}
    >
      {RING_ORDER.map((ring) => {
        const segs = segmentIds.filter((s) => ringForSegment(s) === ring);
        if (!segs.length) return null;
        return (
          <div key={ring} className={cn("mb-2 last:mb-0", columns === 2 && "break-inside-avoid")}>
            <p className={cn("mb-0.5 font-semibold uppercase tracking-wide text-muted-foreground/70", size === "xs" ? "text-[7px]" : "text-[8px]")}>
              {RING_LABEL[ring]}
            </p>
            {segs.map((seg, idx) => {
              const opacity = 0.55 + (idx / Math.max(segs.length - 1, 1)) * 0.45;
              const label = stripRingPrefix(series[0]?.find((d) => d.segment === seg)?.label ?? `Segment ${seg}`);
              return (
                <div
                  key={seg}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-1 py-0.5",
                    size === "xs" ? "text-[7px]" : "text-[9.5px]",
                    interactive && "cursor-pointer",
                    highlightSeg === seg ? "bg-background font-semibold text-foreground" : "text-muted-foreground hover:bg-background",
                  )}
                  onMouseEnter={interactive ? () => onHoverSeg?.(seg) : undefined}
                >
                  <span
                    className={cn("shrink-0 rounded-sm", size === "xs" ? "h-1 w-1" : "h-1.5 w-1.5")}
                    style={{ backgroundColor: RING_COLOR_VAR[ring], opacity }}
                  />
                  {seg}. {label}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Chart + legend side-by-side, with its own hover state — used by the printed report (full-width page, no tab UI). */
export function RegionalStrainFullCycle({
  series,
  strainType,
  width = 560,
  height = 240,
  legendSize = "sm",
  legendColumns = 1,
}: {
  series: StrainSegmentData[][];
  strainType: StrainType;
  width?: number;
  height?: number;
  /** "xs" is for the printed report — a full 17-row legend at readable-but-compact size. */
  legendSize?: "sm" | "xs";
  legendColumns?: 1 | 2;
}) {
  const [hoverSeg, setHoverSeg] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <div className="flex-1">
        <FullCycleChart series={series} strainType={strainType} width={width} height={height} highlightSeg={hoverSeg} />
      </div>
      <div className={cn("shrink-0", legendSize === "xs" ? "w-full sm:w-40" : "w-full max-h-[240px] overflow-y-auto sm:w-44 sm:max-h-[280px]")}>
        <LVSegmentsLegend series={series} highlightSeg={hoverSeg} onHoverSeg={setHoverSeg} size={legendSize} columns={legendColumns} />
      </div>
    </div>
  );
}

// ── 3. Per-frame bar chart — a magnitude-comparable snapshot of one frame ───
// Complements the bullseye/curve: the bullseye encodes magnitude as color (fast to
// scan, approximate), the curve encodes trend over time. Neither makes it easy to
// precisely compare all 17 segments AT ONE INSTANT against each other on a shared
// axis — that's what a bar chart is for, and unlike the bullseye it reads correctly
// for colorblind viewers and in black-and-white print, since bar *height* (not just
// color) carries the value.

export function PerFrameBarChart({
  values,
  strainType,
  label,
  width = 90,
  height = 56,
}: {
  values: StrainSegmentData[];
  strainType: StrainType;
  label: string;
  width?: number;
  height?: number;
}) {
  const yMin = strainType === "GRS" ? 0 : -26;
  const yMax = strainType === "GRS" ? 42 : 2;
  const padL = 2, padR = 2, padT = 4, padB = 12;
  const y = (v: number) => padT + (height - padT - padB) * (1 - (v - yMin) / (yMax - yMin));
  const yZero = y(0);
  const bw = (width - padL - padR) / values.length;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
        <line x1={padL} x2={width - padR} y1={yZero} y2={yZero} stroke="var(--border)" strokeWidth={0.6} />
        {values.map((d, i) => {
          const yv = y(d.strain);
          const top = Math.min(yv, yZero);
          const barH = Math.max(Math.abs(yv - yZero), 0.6);
          return (
            <rect
              key={d.segment}
              x={padL + i * bw + 0.4} y={top}
              width={Math.max(bw - 0.8, 0.5)} height={barH}
              fill={getStrainColor(d.strain, strainType)} rx={0.4}
            />
          );
        })}
      </svg>
      <p className="mt-0.5 text-center text-[7.5px] text-muted-foreground">{label}</p>
    </div>
  );
}

export function PerFrameBarGrid({ series, strainType }: { series: StrainSegmentData[][]; strainType: StrainType }) {
  const frames = series.length;
  return (
    <div className="grid grid-cols-3 gap-1">
      {series.map((frameData, f) => (
        <PerFrameBarChart key={f} values={frameData} strainType={strainType} label={frameLabel(f, frames)} />
      ))}
    </div>
  );
}

// ── shared stats used by the report page ─────────────────────────────────────

export function seriesGlobalPeak(series: StrainSegmentData[][], strainType: StrainType) {
  const frames = series.length;
  const segmentIds = series[0]?.map((d) => d.segment) ?? [];
  const isMin = strainType === "GCS"; // more negative = better for GCS, higher = better for GRS
  const peaks = segmentIds.map((seg) => {
    const vals = Array.from({ length: frames }, (_, f) => valueAtFrame(series, seg, f));
    return isMin ? Math.min(...vals) : Math.max(...vals);
  });
  const avg = peaks.reduce((a, b) => a + b, 0) / (peaks.length || 1);
  const bestIdx = isMin ? peaks.indexOf(Math.min(...peaks)) : peaks.indexOf(Math.max(...peaks));
  const worstIdx = isMin ? peaks.indexOf(Math.max(...peaks)) : peaks.indexOf(Math.min(...peaks));
  return {
    avg,
    best: { segment: segmentIds[bestIdx], label: series[0]?.[bestIdx]?.label ?? "" },
    worst: { segment: segmentIds[worstIdx], label: series[0]?.[worstIdx]?.label ?? "" },
  };
}
