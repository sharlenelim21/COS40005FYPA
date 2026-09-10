"use client";

import React from "react";
import { rdYlGn } from "./StrainVisualization";
import type { StrainSegmentData, StrainType, RvStrainRegion } from "./StrainVisualization";

interface CombinedVentricularChartProps {
  lvData: StrainSegmentData[];
  hasLv: boolean;
  strainType: StrainType;
  selectedSegment?: number | null; // 1-based LV segment
  onSegmentClick?: (seg: number) => void;
  onSegmentHover?: (info: { x: number; y: number; label: string; value: number } | null) => void;
  sharedMin?: number;
  sharedMax?: number;
  reverseColors?: boolean;

  rvRegions: RvStrainRegion[] | null;
  selectedRvRegion?: number | null; // 1-based RV region
  onRvRegionClick?: (region: number) => void;
  onRvRegionHover?: (info: { x: number; y: number; label: string; value: number | null } | null) => void;
}

// ── Layout constants (single source of truth for the geometry below) ────────
const VIEW_W = 480, VIEW_H = 430;
const LV_BASAL_OUTER = 100, LV_BASAL_INNER = 76, LV_MID_INNER = 50, LV_APICAL_INNER = 26;
const RV_MID_INNER = LV_BASAL_OUTER, RV_MID_OUTER = RV_MID_INNER + 20;
const RV_BASAL_INNER = RV_MID_OUTER, RV_BASAL_OUTER = RV_BASAL_INNER + 24;
const CENTER = { x: (VIEW_W - (LV_BASAL_OUTER + 4) + RV_BASAL_OUTER) / 2, y: 168 };
const RV_SPAN_START = 120, RV_SPAN_END = 240;

export function CombinedVentricularChart({
  lvData, hasLv, strainType, selectedSegment, onSegmentClick, onSegmentHover,
  sharedMin, sharedMax, reverseColors = false,
  rvRegions, selectedRvRegion, onRvRegionClick, onRvRegionHover,
}: CombinedVentricularChartProps) {
  const center = CENTER;

  // ── LV (right side — unchanged 17-segment geometry, recentered) ──────────
  const lvValues = lvData.map((d) => d.strain);
  const lvColMin = sharedMin ?? (lvValues.length ? Math.min(...lvValues) : 0);
  const lvColMax = sharedMax ?? (lvValues.length ? Math.max(...lvValues) : 1);

  const lvVal = (i: number) => lvData[i]?.strain ?? 0;
  const lvLbl = (i: number) => lvData[i]?.label ?? `Segment ${i + 1}`;
  const lvCol = (i: number) => {
    if (!hasLv) return "#cbd5e1";
    const v = lvVal(i);
    const t = lvColMin === lvColMax ? 0.5 : Math.max(0, Math.min(1, (v - lvColMin) / (lvColMax - lvColMin)));
    return rdYlGn(reverseColors ? 1 - t : t);
  };
  const isLvSel = (seg1based: number) => selectedSegment === seg1based;

  const lvSegPath = (i: number, innerR: number, outerR: number, ring: "bm" | "ap") => {
    const start = ring === "bm" ? -120 - i * 60 : -135 - i * 90;
    const end   = ring === "bm" ?  -60 - i * 60 :  -45 - i * 90;
    const mid   = (start + end) / 2;
    const lr    = (innerR + outerR) / 2;
    const lp    = polarPointAt(center, lr, mid);
    return { path: annularSectorPathAt(center, innerR, outerR, start, end), lp };
  };

  const lvHoverHandler = (i: number) => onSegmentHover
    ? (e: React.MouseEvent) => onSegmentHover({ x: e.clientX, y: e.clientY, label: lvLbl(i), value: lvVal(i) })
    : undefined;

  // ── RV (left side — crescent wrapping the septal edge of the LV circle) ──
  const rvValues = (rvRegions ?? []).map((r) => r.strain).filter((v): v is number => v != null);
  const rvColMin = rvValues.length ? Math.min(...rvValues) : -20;
  const rvColMax = rvValues.length ? Math.max(...rvValues) : 0;
  const rvVal = (i: number) => rvRegions?.[i]?.strain ?? null;
  const rvLbl = (i: number) => rvRegions?.[i]?.label ?? `RV Region ${i + 1}`;
  const rvCol = (i: number) => {
    const v = rvVal(i);
    if (v == null) return "#cbd5e1";
    const t = rvColMin === rvColMax ? 0.5 : Math.max(0, Math.min(1, (v - rvColMin) / (rvColMax - rvColMin)));
    return rdYlGn(1 - t); // negative (shrinking) is healthy — same convention as GCS
  };
  const isRvSel = (region1based: number) => selectedRvRegion === region1based;

  // 2 bands (mid = inner, touching the LV boundary; basal = outer), 3 sectors
  // each — see RV_SPAN_START/END above for why this spans 120°→240°.
  const rvSegPath = (i: number, innerR: number, outerR: number) => {
    const sectorWidth = (RV_SPAN_END - RV_SPAN_START) / 3;
    const start = RV_SPAN_START + i * sectorWidth;
    const end = start + sectorWidth;
    const mid = (start + end) / 2;
    const lr = (innerR + outerR) / 2;
    const lp = polarPointAt(center, lr, mid);
    return { path: annularSectorPathAt(center, innerR, outerR, start, end), lp };
  };

  const rvHoverHandler = (i: number) => onRvRegionHover
    ? (e: React.MouseEvent) => onRvRegionHover({ x: e.clientX, y: e.clientY, label: rvLbl(i), value: rvVal(i) })
    : undefined;

  const rvRing = (dataOffset: number, innerR: number, outerR: number, keyPrefix: string) =>
    Array.from({ length: 3 }, (_, i) => {
      const dataIdx = dataOffset + i;
      const region = dataIdx + 1;
      const { path, lp } = rvSegPath(i, innerR, outerR);
      const v = rvVal(dataIdx);
      return (
        <g key={`${keyPrefix}${i}`}>
          <path
            d={path}
            fill={rvCol(dataIdx)}
            stroke={isRvSel(region) ? "white" : "rgba(0,0,0,0.18)"}
            strokeWidth={isRvSel(region) ? 2.5 : 1}
            style={{ transition: "fill 200ms ease", cursor: onRvRegionClick ? "pointer" : "default" }}
            onMouseMove={rvHoverHandler(dataIdx)}
            onMouseLeave={onRvRegionHover ? () => onRvRegionHover(null) : undefined}
            onClick={onRvRegionClick ? () => onRvRegionClick(region) : undefined}
          />
          <text x={lp.x} y={lp.y - 1} textAnchor="middle" fontSize="8" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>
            R{region}
          </text>
          <text x={lp.x} y={lp.y + 9} textAnchor="middle" fontSize="7" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>
            {v != null ? v.toFixed(0) : "—"}
          </text>
        </g>
      );
    });

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="h-full w-full text-[#475569] dark:text-slate-300" role="img" aria-label={`Combined LV/RV ${strainType} bullseye`}>
      {/* Background discs */}
      <circle cx={center.x} cy={center.y} r={RV_BASAL_OUTER} className="fill-slate-50 dark:fill-zinc-900" opacity="0.5" />
      <circle cx={center.x} cy={center.y} r={LV_BASAL_OUTER + 4} className="fill-slate-50 stroke-slate-200 dark:fill-zinc-900 dark:stroke-zinc-700" strokeWidth="1" />
      <text x={center.x} y="14" textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor">Anterior</text>
      <text x={center.x - RV_BASAL_OUTER - 20} y={center.y + 4} textAnchor="end" fontSize="12" fontWeight="700" fill="currentColor">Lateral</text>
      <text x={center.x + LV_BASAL_OUTER + 20} y={center.y + 4} textAnchor="start" fontSize="12" fontWeight="700" fill="currentColor">Septal</text>
      <text x={center.x} y={center.y + RV_BASAL_OUTER + 24} textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor">Inferior</text>
      {(() => {
        const tag = polarPointAt(center, RV_BASAL_OUTER + 16, 205);
        return <text x={tag.x} y={tag.y + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor" opacity="0.7">RV</text>;
      })()}
      <text x={center.x + LV_BASAL_OUTER - 26} y={center.y - LV_BASAL_OUTER + 16} textAnchor="start" fontSize="10" fontWeight="700" fill="currentColor" opacity="0.7">LV</text>

      {/* ── RV crescent (drawn first, sits behind/beside the LV circle) ── */}
      {rvRing(0, RV_BASAL_INNER, RV_BASAL_OUTER, "rvb")}
      {rvRing(3, RV_MID_INNER, RV_MID_OUTER, "rvm")}

      {/* ── LV rings ── */}
      {Array.from({ length: 6 }, (_, i) => {
        const { path, lp } = lvSegPath(i, LV_BASAL_INNER, LV_BASAL_OUTER, "bm");
        const seg = i + 1;
        return (
          <g key={`b${i}`}>
            <path d={path} fill={lvCol(i)} stroke={isLvSel(seg) ? "white" : "rgba(0,0,0,0.18)"} strokeWidth={isLvSel(seg) ? 2.5 : 1}
              style={{ transition: "fill 200ms ease", cursor: onSegmentClick ? "pointer" : "default" }}
              onMouseMove={lvHoverHandler(i)} onMouseLeave={onSegmentHover ? () => onSegmentHover(null) : undefined}
              onClick={onSegmentClick ? () => onSegmentClick(seg) : undefined} />
            <text x={lp.x} y={lp.y - 1} textAnchor="middle" fontSize="9" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>{seg}</text>
            <text x={lp.x} y={lp.y + 10} textAnchor="middle" fontSize="7.5" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>{lvVal(i).toFixed(1)}</text>
          </g>
        );
      })}
      {Array.from({ length: 6 }, (_, i) => {
        const { path, lp } = lvSegPath(i, LV_MID_INNER, LV_BASAL_INNER, "bm");
        const seg = i + 7;
        return (
          <g key={`m${i}`}>
            <path d={path} fill={lvCol(i + 6)} stroke={isLvSel(seg) ? "white" : "rgba(0,0,0,0.18)"} strokeWidth={isLvSel(seg) ? 2.5 : 1}
              style={{ transition: "fill 200ms ease", cursor: onSegmentClick ? "pointer" : "default" }}
              onMouseMove={lvHoverHandler(i + 6)} onMouseLeave={onSegmentHover ? () => onSegmentHover(null) : undefined}
              onClick={onSegmentClick ? () => onSegmentClick(seg) : undefined} />
            <text x={lp.x} y={lp.y - 1} textAnchor="middle" fontSize="9" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>{seg}</text>
            <text x={lp.x} y={lp.y + 10} textAnchor="middle" fontSize="7.5" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>{lvVal(i + 6).toFixed(1)}</text>
          </g>
        );
      })}
      {Array.from({ length: 4 }, (_, i) => {
        const { path, lp } = lvSegPath(i, LV_APICAL_INNER, LV_MID_INNER, "ap");
        const seg = i + 13;
        return (
          <g key={`a${i}`}>
            <path d={path} fill={lvCol(i + 12)} stroke={isLvSel(seg) ? "white" : "rgba(0,0,0,0.18)"} strokeWidth={isLvSel(seg) ? 2.5 : 1}
              style={{ transition: "fill 200ms ease", cursor: onSegmentClick ? "pointer" : "default" }}
              onMouseMove={lvHoverHandler(i + 12)} onMouseLeave={onSegmentHover ? () => onSegmentHover(null) : undefined}
              onClick={onSegmentClick ? () => onSegmentClick(seg) : undefined} />
            <text x={lp.x} y={lp.y - 1} textAnchor="middle" fontSize="9" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>{seg}</text>
            <text x={lp.x} y={lp.y + 10} textAnchor="middle" fontSize="7.5" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>{lvVal(i + 12).toFixed(1)}</text>
          </g>
        );
      })}

      {/* Apex */}
      <circle cx={center.x} cy={center.y} r={LV_APICAL_INNER} fill={lvCol(16)}
        stroke={isLvSel(17) ? "white" : "rgba(0,0,0,0.18)"} strokeWidth={isLvSel(17) ? 2.5 : 1}
        style={{ transition: "fill 200ms ease", cursor: onSegmentClick ? "pointer" : "default" }}
        onMouseMove={lvHoverHandler(16)} onMouseLeave={onSegmentHover ? () => onSegmentHover(null) : undefined}
        onClick={onSegmentClick ? () => onSegmentClick(17) : undefined} />
      <text x={center.x} y={center.y - 2} textAnchor="middle" fontSize="9" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>17</text>
      <text x={center.x} y={center.y + 9} textAnchor="middle" fontSize="7.5" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>{lvVal(16).toFixed(1)}</text>

      {/* ── Colour scales — stacked in their own rows, well clear of the
           Inferior label above, so long RV numbers never collide with it. ── */}
      <defs>
        <linearGradient id="combinedLvBar" x1="0" x2="1" y1="0" y2="0">
          {reverseColors ? (
            <><stop offset="0%" stopColor="#00ff00" /><stop offset="25%" stopColor="#80ff00" /><stop offset="50%" stopColor="#ffff00" /><stop offset="75%" stopColor="#ff8000" /><stop offset="100%" stopColor="#ff0000" /></>
          ) : (
            <><stop offset="0%" stopColor="#ff0000" /><stop offset="25%" stopColor="#ff8000" /><stop offset="50%" stopColor="#ffff00" /><stop offset="75%" stopColor="#80ff00" /><stop offset="100%" stopColor="#00ff00" /></>
          )}
        </linearGradient>
        <linearGradient id="combinedRvBar" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#00ff00" /><stop offset="25%" stopColor="#80ff00" /><stop offset="50%" stopColor="#ffff00" /><stop offset="75%" stopColor="#ff8000" /><stop offset="100%" stopColor="#ff0000" />
        </linearGradient>
      </defs>
      {(() => {
        // Centered on the viewBox itself (not `center`, which is offset left
        // to balance the crescent) so these bars stay visually centered in
        // the panel regardless of where the shapes sit.
        const barW = 260, barMidX = VIEW_W / 2, barX = barMidX - barW / 2;
        const rvBarY = center.y + RV_BASAL_OUTER + 40;
        const lvBarY = rvBarY + 30;
        return (
          <>
            <rect x={barX} y={rvBarY} width={barW} height="6" rx="3" fill="url(#combinedRvBar)" opacity="0.9" />
            <text x={barX} y={rvBarY + 16} textAnchor="start" fontSize="8" fill="currentColor" opacity="0.7">{rvColMin.toFixed(1)}</text>
            <text x={barMidX} y={rvBarY + 16} textAnchor="middle" fontSize="8" fill="currentColor" opacity="0.7">RV strain %</text>
            <text x={barX + barW} y={rvBarY + 16} textAnchor="end" fontSize="8" fill="currentColor" opacity="0.7">{rvColMax.toFixed(1)}</text>

            <rect x={barX} y={lvBarY} width={barW} height="6" rx="3" fill="url(#combinedLvBar)" opacity="0.9" />
            <text x={barX} y={lvBarY + 16} textAnchor="start" fontSize="8" fill="currentColor" opacity="0.7">{lvColMin.toFixed(1)}</text>
            <text x={barMidX} y={lvBarY + 16} textAnchor="middle" fontSize="8" fill="currentColor" opacity="0.7">LV {strainType} %</text>
            <text x={barX + barW} y={lvBarY + 16} textAnchor="end" fontSize="8" fill="currentColor" opacity="0.7">{lvColMax.toFixed(1)}</text>
          </>
        );
      })()}
    </svg>
  );
}

function polarPointAt(center: { x: number; y: number }, radius: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
}

function annularSectorPathAt(
  center: { x: number; y: number }, innerR: number, outerR: number,
  startDeg: number, endDeg: number,
) {
  const os = polarPointAt(center, outerR, startDeg);
  const oe = polarPointAt(center, outerR, endDeg);
  const ie = polarPointAt(center, innerR, endDeg);
  const is_ = polarPointAt(center, innerR, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${os.x} ${os.y}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${oe.x} ${oe.y}`,
    `L ${ie.x} ${ie.y}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${is_.x} ${is_.y}`,
    "Z",
  ].join(" ");
}
