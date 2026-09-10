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
  /** Landmark-derived anterior start angle from the backend (RealStrainResult's
   *  alignment_angle_deg). Null/undefined = fixed-angle layout. */
  alignmentAngleDeg?: number | null;

  rvRegions: RvStrainRegion[] | null;
  selectedRvRegion?: number | null; // 1-based RV region
  onRvRegionClick?: (region: number) => void;
  onRvRegionHover?: (info: { x: number; y: number; label: string; value: number | null } | null) => void;

  /** Which chamber(s) to actually draw -- both default true (the original,
   * always-combined layout). The Strain tab's chamber toggle sets these so
   * picking "LV" or "RV" shows only that chamber's wedges instead of always
   * rendering both regardless of the toggle. Geometry/centering is left
   * unchanged either way, so a single-chamber view keeps the same layout
   * space the combined view uses rather than re-centering around one side. */
  showLv?: boolean;
  showRv?: boolean;
}

// Same backend ray-cast start-angle fallback as StrainBullseyeChart/RvStrainChart
// (bullseye_analysis.py's start_angle_by_ring["basal"] = 4*pi/3 = 240deg). The
// fixed LV/RV wedge layouts below already assume this exact fallback.
const BACKEND_FIXED_FALLBACK_DEG = 240;

// ── Layout constants (single source of truth for the geometry below) ────────
const VIEW_W = 480, VIEW_H = 470;
const LV_BASAL_OUTER = 100, LV_BASAL_INNER = 76, LV_MID_INNER = 50, LV_APICAL_INNER = 26;
// 3 rings (apical/mid/basal), touching the LV boundary innermost-out, same
// apex-near-center convention the LV rings and the Structure tab's RV
// crescent (RvCrescentDiagram) both already use. Only 2 of these 3 rings
// have real backend data (RV strain only computes basal+mid, 6 regions) --
// apical renders as an honest "no data" ring (see rvVal/rvCol's existing
// null handling) rather than being left out, so the shape matches the real
// 9-segment CPD atlas scheme instead of looking like a smaller 6-segment one.
const RV_APICAL_INNER = LV_BASAL_OUTER, RV_APICAL_OUTER = RV_APICAL_INNER + 14;
const RV_MID_INNER = RV_APICAL_OUTER, RV_MID_OUTER = RV_MID_INNER + 18;
const RV_BASAL_INNER = RV_MID_OUTER, RV_BASAL_OUTER = RV_BASAL_INNER + 20;
const CENTER = { x: (VIEW_W - (LV_BASAL_OUTER + 4) + RV_BASAL_OUTER) / 2, y: 190 };
// Widened from a 120deg sliver to a fuller 160deg horseshoe wrapping more of
// the LV circle's near side, closer to how published combined LV+RV
// bullseyes (e.g. the CinC/Bazhutina figure) actually draw it -- still
// short of a full 180deg so the crescent's own top/bottom points don't run
// into the Anterior/Inferior labels at these radii.
const RV_SPAN_START = 100, RV_SPAN_END = 260;

export function CombinedVentricularChart({
  lvData, hasLv, strainType, selectedSegment, onSegmentClick, onSegmentHover,
  sharedMin, sharedMax, reverseColors = false, alignmentAngleDeg,
  rvRegions, selectedRvRegion, onRvRegionClick, onRvRegionHover,
  showLv = true, showRv = true,
}: CombinedVentricularChartProps) {
  // Combined (both chambers) keeps the shared layout center, which balances
  // against the crescent's leftward bulge. LV-only has no crescent to
  // balance against, so re-centering on the LV circle alone (horizontally;
  // vertical stays the same so the Anterior/Inferior/colorbar spacing built
  // around CENTER.y is unaffected) instead of leaving it off to one side of
  // empty space. RV-only isn't touched here -- it already centers correctly
  // on its own.
  const center = (showLv && !showRv) ? { x: VIEW_W / 2, y: CENTER.y } : CENTER;
  // How far out layout (the Inferior label, the color bars) should clear --
  // the RV crescent's outer radius when it's drawn, or just the LV circle's
  // when it's the only thing on screen (using the RV radius there left a
  // large, unbalanced gap between the LV circle and everything below it).
  const outerR = showRv ? RV_BASAL_OUTER : (LV_BASAL_OUTER + 4);
  const referenceAngleDeg = alignmentAngleDeg != null ? alignmentAngleDeg - BACKEND_FIXED_FALLBACK_DEG : 0;

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
    const start = (ring === "bm" ? -120 - i * 60 : -135 - i * 90) + referenceAngleDeg;
    const end   = (ring === "bm" ?  -60 - i * 60 :  -45 - i * 90) + referenceAngleDeg;
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

  // 3 bands (apical = inner, touching the LV boundary; mid; basal = outer),
  // 3 sectors each — see RV_SPAN_START/END above for the span. Rotated by
  // the same referenceAngleDeg as the LV rings so the crescent stays fused
  // to the LV circle's septal-side seam as the layout rotates.
  const rvSegPath = (i: number, innerR: number, outerR: number) => {
    const sectorWidth = (RV_SPAN_END - RV_SPAN_START) / 3;
    const start = RV_SPAN_START + i * sectorWidth + referenceAngleDeg;
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
      {showRv && <circle cx={center.x} cy={center.y} r={RV_BASAL_OUTER} className="fill-slate-50 dark:fill-zinc-900" opacity="0.5" />}
      {showLv && <circle cx={center.x} cy={center.y} r={LV_BASAL_OUTER + 4} className="fill-slate-50 stroke-slate-200 dark:fill-zinc-900 dark:stroke-zinc-700" strokeWidth="1" />}
      {/* Anterior/Lateral/Inferior are LV-relative anatomical directions --
          meaningful for LV-only and Combined (where LV is still the frame of
          reference), but RV-only has nothing for them to be relative TO, so
          they're skipped there in favor of just the R#/segment labels. */}
      {showLv && (
        <>
          {/* Distance from the shape's own top edge, not a fixed offset --
              was a fixed y=14 regardless of chamber, leaving a large,
              awkward gap above LV-only's smaller circle. */}
          <text x={center.x} y={center.y - outerR - 12} textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor">Anterior</text>
          {/* Lateral only makes sense as a single-chamber direction label --
              in Combined, the RV crescent's own R#/segment labels already
              occupy that side, and "Lateral" collided/clipped against them
              there. */}
          {!showRv && (
            <text x={center.x - (LV_BASAL_OUTER + 4) - 20} y={center.y + 4} textAnchor="end" fontSize="12" fontWeight="700" fill="currentColor">
              Lateral
            </text>
          )}
          <text x={center.x + LV_BASAL_OUTER + 20} y={center.y + 4} textAnchor="start" fontSize="12" fontWeight="700" fill="currentColor">Septal</text>
          <text x={center.x} y={center.y + outerR + 24} textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor">Inferior</text>
        </>
      )}
      {showRv && (() => {
        // Clearly outside/above the crescent's own topmost point, offset
        // toward the upper-LEFT (away from Anterior's top-center spot)
        // rather than sitting right at the crescent's edge.
        const tag = polarPointAt(center, RV_BASAL_OUTER + 26, RV_SPAN_START + 12);
        return <text x={tag.x} y={tag.y + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="currentColor" opacity="0.7">RV</text>;
      })()}
      {showLv && <text x={center.x + LV_BASAL_OUTER - 26} y={center.y - LV_BASAL_OUTER + 16} textAnchor="start" fontSize="10" fontWeight="700" fill="currentColor" opacity="0.7">LV</text>}

      {/* ── RV crescent (drawn first, sits behind/beside the LV circle) ── */}
      {showRv && rvRing(0, RV_BASAL_INNER, RV_BASAL_OUTER, "rvb")}
      {showRv && rvRing(3, RV_MID_INNER, RV_MID_OUTER, "rvm")}
      {/* Apical ring: RV strain has no apical computation yet (backend only
          returns 6 basal+mid regions), so rvVal/rvCol/rvLbl's existing
          null-safe fallbacks (gray fill, "—" label) render this ring
          honestly as "no data" -- completing the real 9-segment shape
          instead of a smaller 6-segment one, without fabricating values. */}
      {showRv && rvRing(6, RV_APICAL_INNER, RV_APICAL_OUTER, "rva")}

      {/* ── LV rings ── */}
      {showLv && Array.from({ length: 6 }, (_, i) => {
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
      {showLv && Array.from({ length: 6 }, (_, i) => {
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
      {showLv && Array.from({ length: 4 }, (_, i) => {
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
      {showLv && (
        <>
          <circle cx={center.x} cy={center.y} r={LV_APICAL_INNER} fill={lvCol(16)}
            stroke={isLvSel(17) ? "white" : "rgba(0,0,0,0.18)"} strokeWidth={isLvSel(17) ? 2.5 : 1}
            style={{ transition: "fill 200ms ease", cursor: onSegmentClick ? "pointer" : "default" }}
            onMouseMove={lvHoverHandler(16)} onMouseLeave={onSegmentHover ? () => onSegmentHover(null) : undefined}
            onClick={onSegmentClick ? () => onSegmentClick(17) : undefined} />
          <text x={center.x} y={center.y - 2} textAnchor="middle" fontSize="9" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>17</text>
          <text x={center.x} y={center.y + 9} textAnchor="middle" fontSize="7.5" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>{lvVal(16).toFixed(1)}</text>
        </>
      )}

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
        // Aligned to `center.x`, not the raw viewBox center -- the shape
        // above isn't centered on the viewBox either (Combined balances
        // against the crescent's bulge; LV-only recenters on the LV circle),
        // so bars centered independently of the shape just meant the bars
        // and the shape they describe didn't line up with each other.
        const barW = 260, barMidX = center.x, barX = barMidX - barW / 2;
        const rvBarY = center.y + outerR + 40;
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
