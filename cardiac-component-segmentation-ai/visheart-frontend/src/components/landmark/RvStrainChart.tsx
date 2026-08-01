"use client";

import React from "react";
import { rdYlGn, polarPoint, annularSectorPath } from "./StrainVisualization";
import type { RvStrainRegion } from "./StrainVisualization";

/**
 * Regional RV strain chart — 2 rings (basal, mid) x 3 free-wall sectors.
 *
 * Deliberately a separate, simpler component from StrainBullseyeChart rather
 * than a generalized version of it: StrainBullseyeChart's 17-segment layout
 * is also used by the printed-report pages, and RV strain isn't a
 * wall-thickness measure like LV's GRS/GCS — see RvStrainRegion for why
 * `strain` here is a cavity-radius % change instead. Negative (shrinking
 * radius) is the healthy direction, same convention as GCS.
 */
interface RvStrainChartProps {
  regions: RvStrainRegion[];
  selectedRegion?: number | null; // 1-based
  onRegionClick?: (region: number) => void;
  onRegionHover?: (info: { x: number; y: number; label: string; value: number | null } | null) => void;
}

export function RvStrainChart({ regions, selectedRegion, onRegionClick, onRegionHover }: RvStrainChartProps) {
  const center = 150;
  const basalOuter = 108, basalInner = 68, midInner = 30;
  const nSectors = 3;
  const sectorDeg = 360 / nSectors;

  const values = regions.map((r) => r.strain).filter((v): v is number => v != null);
  const colMin = values.length ? Math.min(...values) : -20;
  const colMax = values.length ? Math.max(...values) : 0;

  const val = (i: number) => regions[i]?.strain ?? null;
  const lbl = (i: number) => regions[i]?.label ?? `Region ${i + 1}`;
  // Negative strain (shrinking RV cavity) is healthy — same reversed ramp as GCS.
  const col = (i: number) => {
    const v = val(i);
    if (v == null) return "#94a3b8"; // slate — no data for this region
    const t = colMin === colMax ? 0.5 : Math.max(0, Math.min(1, (v - colMin) / (colMax - colMin)));
    return rdYlGn(1 - t);
  };
  const isSel = (region1based: number) => selectedRegion === region1based;

  const segPath = (i: number, innerR: number, outerR: number) => {
    const start = -90 - sectorDeg / 2 - i * sectorDeg;
    const end = start + sectorDeg;
    const mid = (start + end) / 2;
    const lr = (innerR + outerR) / 2;
    const lp = polarPoint(center, lr, mid);
    return { path: annularSectorPath(center, innerR, outerR, start, end), lp };
  };

  const hoverHandler = (i: number) => onRegionHover
    ? (e: React.MouseEvent) => onRegionHover({ x: e.clientX, y: e.clientY, label: lbl(i), value: val(i) })
    : undefined;

  const ring = (ringIndex: 0 | 1, innerR: number, outerR: number, keyPrefix: string) =>
    Array.from({ length: nSectors }, (_, i) => {
      const dataIdx = ringIndex * nSectors + i;
      const region = dataIdx + 1;
      const { path, lp } = segPath(i, innerR, outerR);
      const v = val(dataIdx);
      return (
        <g key={`${keyPrefix}${i}`}>
          <path
            d={path}
            fill={col(dataIdx)}
            stroke={isSel(region) ? "white" : "rgba(0,0,0,0.18)"}
            strokeWidth={isSel(region) ? 2.5 : 1}
            style={{ transition: "fill 200ms ease", cursor: onRegionClick ? "pointer" : "default" }}
            onMouseMove={hoverHandler(dataIdx)}
            onMouseLeave={onRegionHover ? () => onRegionHover(null) : undefined}
            onClick={onRegionClick ? () => onRegionClick(region) : undefined}
          />
          <text x={lp.x} y={lp.y - 1} textAnchor="middle" fontSize="9" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>
            {region}
          </text>
          <text x={lp.x} y={lp.y + 10} textAnchor="middle" fontSize="7.5" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>
            {v != null ? v.toFixed(1) : "—"}
          </text>
        </g>
      );
    });

  return (
    <svg viewBox="0 0 300 340" className="h-full w-full text-[#475569] dark:text-slate-300" role="img" aria-label="RV regional strain chart">
      <circle cx={center} cy={center} r="112" className="fill-slate-50 stroke-slate-200 dark:fill-zinc-900 dark:stroke-zinc-700" strokeWidth="1" />

      <text x={center} y="12" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">RV Free Wall</text>
      <text x={center} y="290" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.7">
        Basal + mid free-wall regions — cavity-radius strain (approximate)
      </text>

      {ring(0, basalInner, basalOuter, "b")}
      {ring(1, midInner, basalInner, "m")}

      <circle cx={center} cy={center} r={midInner} className="fill-slate-200/70 dark:fill-zinc-800/70" />

      {/* Colour scale bar */}
      <defs>
        <linearGradient id="rvStrainBar" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%"   stopColor="#00ff00" />
          <stop offset="25%"  stopColor="#80ff00" />
          <stop offset="50%"  stopColor="#ffff00" />
          <stop offset="75%"  stopColor="#ff8000" />
          <stop offset="100%" stopColor="#ff0000" />
        </linearGradient>
      </defs>
      <rect x="30" y="305" width="240" height="6" rx="3" fill="url(#rvStrainBar)" opacity="0.9" />
      <text x="30"  y="320" textAnchor="middle" fontSize="7" fill="currentColor" opacity="0.7">{colMin.toFixed(1)}</text>
      <text x="150" y="320" textAnchor="middle" fontSize="7" fill="currentColor" opacity="0.7">RV strain %</text>
      <text x="270" y="320" textAnchor="middle" fontSize="7" fill="currentColor" opacity="0.7">{colMax.toFixed(1)}</text>
    </svg>
  );
}
