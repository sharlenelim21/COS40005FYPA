"use client";

import { lvScaleKey, strainScaleFraction, strainScaleMinMax } from "@/lib/strainColorScale";
import React, { useRef, useEffect, useCallback } from "react";

// ── types ─────────────────────────────────────────────────────────────────────

export type StrainType = "GCS" | "GRS";

export interface RealStrainSegment {
  segment: number;
  label: string;
  grs: number | null;
  gcs: number | null;
  wt_ed_mm?: number | null;
  wt_es_mm?: number | null;
}

export interface StrainComputedFor {
  mode: "choose-frames" | "full-cycle" | "upload";
  model: "unet" | "medsam";
  edFrameIndex: number;
  esFrameIndex?: number;
}

export interface RealStrainResult {
  segments: RealStrainSegment[];
  global_grs: number | null;
  global_gcs: number | null;
  ed_wt_mean_mm: number | null;
  es_wt_mean_mm: number | null;
  vox_xy_mm: number;
  alignment_source: string;
  alignment_angle_deg?: number | null;
  source?: "upload" | "frames";
  edFrameIndex?: number;
  esFrameIndex?: number;
  computedFor?: StrainComputedFor;
  /** Set when hydrated from a stored doc whose landmarks were edited since it
   *  was computed (mirrors Strain/StrainSeries' own staleSince in
   *  useProjectResults.ts); absent on a freshly-computed result. */
  staleSince?: string;
}

export interface StrainSegmentData {
  segment: number;
  label: string;
  strain: number;
}

/**
 * Regional RV strain over the 9-segment RV bullseye (basal/mid/apical x 3
 * sections, Seg1 inferior → Seg3 anterior; rays cast from the LV centroid,
 * wedges fixed at ED). There is no RV free-wall myocardium label, so per
 * segment the backend measures the RV cavity: `gcs` = free-wall chord %
 * change, `gas` = cavity area % change. `strain` currently equals `gcs`
 * until the two are combined. See bullseye_analysis.mask_to_rv_regions.
 */
export interface RvStrainRegion {
  region: number;
  label: string;
  strain: number | null;
  gcs?: number | null;
  gas?: number | null;
  chord_ed_mm?: number | null;
  chord_es_mm?: number | null;
  area_ed_mm2?: number | null;
  area_es_mm2?: number | null;
  radius_ed_mm?: number | null;
  radius_es_mm?: number | null;
}

/** RV septal segment — septal-side border of the RV cavity, one per ring,
 *  reported separately from the free-wall regions (cf. Tokodi et al. 2021). */
export type RvSeptalRegion = { region: number; ring: string; label: string; gcs: number | null; chord_ed_mm?: number | null; chord_es_mm?: number | null };

export interface RvStrainResult {
  regions: RvStrainRegion[];
  global_rv_strain: number | null;
  global_rv_gcs?: number | null;
  global_rv_gas?: number | null;
  /** RV septal GCS (septal-side border), separate from the free-wall GCS above. */
  global_rv_septal_gcs?: number | null;
  septal_regions?: RvSeptalRegion[];
  vox_xy_mm: number;
  alignment_source: string;
  alignment_angle_deg?: number | null;
  source?: "frames";
  edFrameIndex?: number;
  esFrameIndex?: number;
  computedFor?: StrainComputedFor;
}

// ── dummy data ────────────────────────────────────────────────────────────────

// AHA order: Ant, AntLat, InfLat, Inf, InfSep, AntSep (basal then mid), then 4 apical, apex
const BASE_GCS = [-17.1, -18.3, -16.8, -17.7, -19.4, -18.5, -20.2, -19.1, -18.2, -19.7, -20.8, -20.1, -21.0, -19.5, -20.4, -19.8, -18.9];
const BASE_GRS = [26.4, 28.2, 24.9, 25.8, 30.1, 29.4, 31.2, 30.5, 27.8, 28.6, 32.4, 31.6, 34.1, 32.7, 33.4, 31.9, 29.8];

export const SEGMENT_LABELS = [
  "Basal Anterior", "Basal Anteroseptal", "Basal Inferoseptal",
  "Basal Inferior", "Basal Inferolateral", "Basal Anterolateral",
  "Mid Anterior", "Mid Anteroseptal", "Mid Inferoseptal",
  "Mid Inferior", "Mid Inferolateral", "Mid Anterolateral",
  "Apical Anterior", "Apical Lateral", "Apical Inferior", "Apical Septal",
  "Apex",
];

export function getDummyStrainData(
  selectedStrainType: StrainType = "GCS",
  frame = 0,
  totalFrames = 10,
): StrainSegmentData[] {
  const safeTotal = Math.max(totalFrames, 1);
  const phase = safeTotal > 1 ? frame / (safeTotal - 1) : 0;
  const contraction = Math.sin(phase * Math.PI);
  const base = selectedStrainType === "GRS" ? BASE_GRS : BASE_GCS;

  return base.map((value, index) => {
    const segmentOffset = Math.sin((index + 1) * 0.85 + frame * 0.35) * 0.9;
    const dynamicValue =
      selectedStrainType === "GRS"
        ? value * (0.62 + contraction * 0.38) + segmentOffset
        : value * (0.42 + contraction * 0.58) + segmentOffset;
    return { segment: index + 1, label: SEGMENT_LABELS[index], strain: Number(dynamicValue.toFixed(1)) };
  });
}

// ── color helpers ─────────────────────────────────────────────────────────────

// Same ramp as the 3D heart model: red(0) → yellow(0.5) → green(1)
export function rdYlGn(t: number): string {
  const r = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
  const g = t < 0.5 ? t * 2 : 1;
  const toHex = (x: number) =>
    Math.round(Math.max(0, Math.min(255, x * 255))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}00`;
}

/** Text/swatch colour for a strain value on the shared FIXED scale
 *  (lib/strainColorScale.ts) — same colour as the bullseye for that value. */
export function getStrainColor(strain: number, strainType: StrainType): string {
  return rdYlGn(strainScaleFraction(strain, lvScaleKey(strainType)));
}

// ── geometry helpers ──────────────────────────────────────────────────────────

export function polarPoint(center: number, radius: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: center + radius * Math.cos(a), y: center + radius * Math.sin(a) };
}

export function annularSectorPath(
  center: number, innerR: number, outerR: number,
  startDeg: number, endDeg: number,
) {
  const os = polarPoint(center, outerR, startDeg);
  const oe = polarPoint(center, outerR, endDeg);
  const ie = polarPoint(center, innerR, endDeg);
  const is_ = polarPoint(center, innerR, startDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${os.x} ${os.y}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${oe.x} ${oe.y}`,
    `L ${ie.x} ${ie.y}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${is_.x} ${is_.y}`,
    "Z",
  ].join(" ");
}

// ── ZoomPanContainer (keeps clicks working at scale=1) ─────────────────────

export function ZoomPanContainer({
  children, className, onResetRef,
}: {
  children: React.ReactNode;
  className?: string;
  onResetRef?: (fn: () => void) => void;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const activePtr = useRef<number | null>(null);

  const apply = useCallback((t: { scale: number; x: number; y: number }) => {
    transformRef.current = t;
    if (innerRef.current) innerRef.current.style.transform = `translate(${t.x}px,${t.y}px) scale(${t.scale})`;
    if (outerRef.current) outerRef.current.style.cursor = t.scale > 1 ? "grab" : "default";
  }, []);

  useEffect(() => { if (onResetRef) onResetRef(() => apply({ scale: 1, x: 0, y: 0 })); }, [onResetRef, apply]);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = transformRef.current;
      const s = Math.min(4, Math.max(1, p.scale * (e.deltaY < 0 ? 1.12 : 0.9)));
      apply({ scale: s, x: p.x * (s / p.scale), y: p.y * (s / p.scale) });
    };
    const onDown = (e: PointerEvent) => {
      if (transformRef.current.scale <= 1) return;
      e.preventDefault(); activePtr.current = e.pointerId;
      el.setPointerCapture(e.pointerId); dragging.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || e.pointerId !== activePtr.current || transformRef.current.scale <= 1) return;
      const p = transformRef.current;
      apply({ ...p, x: p.x + e.clientX - lastPos.current.x, y: p.y + e.clientY - lastPos.current.y });
      lastPos.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => { if (e.pointerId === activePtr.current) { dragging.current = false; activePtr.current = null; } };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [apply]);

  return (
    <div ref={outerRef} className={`relative isolate ${className ?? ""}`} style={{ cursor: "default", overflow: "clip" }}>
      <div ref={innerRef} style={{ transform: "translate(0,0) scale(1)", transformOrigin: "center center", width: "100%", height: "100%" }}>
        {children}
      </div>
    </div>
  );
}

// ── StrainBullseyeChart — the pure SVG chart (no chrome) ──────────────────────

// Backend ray-cast start-angle fallback used when no landmark is available
// (bullseye_analysis.py's start_angle_by_ring["basal"/"mid"] = 4*pi/3 = 240deg).
// The frontend's fixed wedge layout below (-120 - i*60) already assumes this
// exact fallback, so alignment_angle_deg must be rebased against it before
// being added as a rotation — see AhaBullseyeChart's referenceAngleDeg for
// the same pattern applied to the AHA thickness bullseye.
const BACKEND_FIXED_FALLBACK_DEG = 240;

interface ChartProps {
  data: StrainSegmentData[];
  strainType: StrainType;
  selectedSegment?: number | null;  // 1-based
  onSegmentClick?: (seg: number) => void;
  onSegmentHover?: (info: { x: number; y: number; label: string; value: number } | null) => void;
  forcedMin?: number;
  forcedMax?: number;
  sharedMin?: number;
  sharedMax?: number;
  reverseColors?: boolean;
  /** Landmark-derived anterior start angle from the backend (RealStrainResult /
   *  RvStrainResult's alignment_angle_deg). Null/undefined = fixed-angle layout. */
  alignmentAngleDeg?: number | null;
}

export function StrainBullseyeChart({
  data, strainType, selectedSegment, onSegmentClick, onSegmentHover,
  forcedMin, forcedMax, sharedMin, sharedMax, reverseColors,
  alignmentAngleDeg,
}: ChartProps) {
  const center = 150;
  const referenceAngleDeg = alignmentAngleDeg != null ? alignmentAngleDeg - BACKEND_FIXED_FALLBACK_DEG : 0;
  const basalOuter = 108, basalInner = 81, midInner = 54, apicalInner = 28;

  // No explicit range → the shared FIXED strain scale (never this patient's
  // own min/max). Explicit ranges (e.g. wall thickness in mm) are unchanged.
  const fixed = strainScaleMinMax(lvScaleKey(strainType));
  const hasExplicitRange = sharedMin != null || forcedMin != null;
  const colMin = sharedMin ?? forcedMin ?? fixed.min;
  const colMax = sharedMax ?? forcedMax ?? fixed.max;
  const reverse = reverseColors ?? (hasExplicitRange ? false : fixed.reverse);

  const val = (i: number) => data[i]?.strain ?? 0;
  const lbl = (i: number) => data[i]?.label ?? `Segment ${i + 1}`;
  // Use rdYlGn normalised against the shared range — same function as 3D heart
  const col = (i: number) => {
    const v = val(i);
    const t = colMin === colMax ? 0.5 : Math.max(0, Math.min(1, (v - colMin) / (colMax - colMin)));
    return rdYlGn(reverse ? 1 - t : t);
  };
  const isSel = (seg1based: number) => selectedSegment === seg1based;

  // AHA CCW convention — identical to AhaBullseyeChart:
  //   basal/mid: startAngle = -120 - index*60, endAngle = -60 - index*60
  //   apical:    startAngle = -135 - index*90, endAngle = -45 - index*90
  // referenceAngleDeg rotates the whole layout to match the landmark-derived
  // alignment_angle_deg, same as AhaBullseyeChart's referenceAngleDeg prop.
  const segPath = (i: number, innerR: number, outerR: number, ring: "bm" | "ap") => {
    const start = (ring === "bm" ? -120 - i * 60 : -135 - i * 90) + referenceAngleDeg;
    const end   = (ring === "bm" ?  -60 - i * 60 :  -45 - i * 90) + referenceAngleDeg;
    const mid   = (start + end) / 2;
    const lr    = (innerR + outerR) / 2;
    const lp    = polarPoint(center, lr, mid);
    return { path: annularSectorPath(center, innerR, outerR, start, end), lp };
  };

  const hoverHandler = (i: number) => onSegmentHover
    ? (e: React.MouseEvent) => onSegmentHover({ x: e.clientX, y: e.clientY, label: lbl(i), value: val(i) })
    : undefined;

  return (
    <svg viewBox="0 0 300 340" className="h-full w-full text-[#475569] dark:text-slate-300" role="img" aria-label={`${strainType} strain bullseye`}>
      <circle cx={center} cy={center} r="112" className="fill-slate-50 stroke-slate-200 dark:fill-zinc-900 dark:stroke-zinc-700" strokeWidth="1" />

      {/* Direction labels */}
      <text x={center} y="12" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">Anterior</text>
      <text x="298" y={center + 4} textAnchor="end" fontSize="11" fontWeight="700" fill="currentColor">Septal</text>
      <text x={center} y="290" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">Inferior</text>
      <text x="2" y={center + 4} textAnchor="start" fontSize="11" fontWeight="700" fill="currentColor">Lateral</text>

      {/* Basal ring — segments 1–6 */}
      {Array.from({ length: 6 }, (_, i) => {
        const { path, lp } = segPath(i, basalInner, basalOuter, "bm");
        const seg = i + 1;
        return (
          <g key={`b${i}`}>
            <path
              d={path} fill={col(i)}
              stroke={isSel(seg) ? "white" : "rgba(0,0,0,0.18)"}
              strokeWidth={isSel(seg) ? 2.5 : 1}
              style={{ transition: "fill 200ms ease", cursor: onSegmentClick ? "pointer" : "default" }}
              onMouseMove={hoverHandler(i)}
              onMouseLeave={onSegmentHover ? () => onSegmentHover(null) : undefined}
              onClick={onSegmentClick ? () => onSegmentClick(seg) : undefined}
            />
            <text x={lp.x} y={lp.y - 1} textAnchor="middle" fontSize="9" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>{seg}</text>
            <text x={lp.x} y={lp.y + 10} textAnchor="middle" fontSize="7.5" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>{val(i).toFixed(1)}</text>
          </g>
        );
      })}

      {/* Mid ring — segments 7–12 */}
      {Array.from({ length: 6 }, (_, i) => {
        const { path, lp } = segPath(i, midInner, basalInner, "bm");
        const seg = i + 7;
        return (
          <g key={`m${i}`}>
            <path
              d={path} fill={col(i + 6)}
              stroke={isSel(seg) ? "white" : "rgba(0,0,0,0.18)"}
              strokeWidth={isSel(seg) ? 2.5 : 1}
              style={{ transition: "fill 200ms ease", cursor: onSegmentClick ? "pointer" : "default" }}
              onMouseMove={hoverHandler(i + 6)}
              onMouseLeave={onSegmentHover ? () => onSegmentHover(null) : undefined}
              onClick={onSegmentClick ? () => onSegmentClick(seg) : undefined}
            />
            <text x={lp.x} y={lp.y - 1} textAnchor="middle" fontSize="9" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>{seg}</text>
            <text x={lp.x} y={lp.y + 10} textAnchor="middle" fontSize="7.5" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>{val(i + 6).toFixed(1)}</text>
          </g>
        );
      })}

      {/* Apical ring — segments 13–16 */}
      {Array.from({ length: 4 }, (_, i) => {
        const { path, lp } = segPath(i, apicalInner, midInner, "ap");
        const seg = i + 13;
        return (
          <g key={`a${i}`}>
            <path
              d={path} fill={col(i + 12)}
              stroke={isSel(seg) ? "white" : "rgba(0,0,0,0.18)"}
              strokeWidth={isSel(seg) ? 2.5 : 1}
              style={{ transition: "fill 200ms ease", cursor: onSegmentClick ? "pointer" : "default" }}
              onMouseMove={hoverHandler(i + 12)}
              onMouseLeave={onSegmentHover ? () => onSegmentHover(null) : undefined}
              onClick={onSegmentClick ? () => onSegmentClick(seg) : undefined}
            />
            <text x={lp.x} y={lp.y - 1} textAnchor="middle" fontSize="9" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>{seg}</text>
            <text x={lp.x} y={lp.y + 10} textAnchor="middle" fontSize="7.5" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>{val(i + 12).toFixed(1)}</text>
          </g>
        );
      })}

      {/* Apex — segment 17 */}
      <circle
        cx={center} cy={center} r={apicalInner}
        fill={col(16)}
        stroke={isSel(17) ? "white" : "rgba(0,0,0,0.18)"}
        strokeWidth={isSel(17) ? 2.5 : 1}
        style={{ transition: "fill 200ms ease", cursor: onSegmentClick ? "pointer" : "default" }}
        onMouseMove={hoverHandler(16)}
        onMouseLeave={onSegmentHover ? () => onSegmentHover(null) : undefined}
        onClick={onSegmentClick ? () => onSegmentClick(17) : undefined}
      />
      <text x={center} y={center - 2} textAnchor="middle" fontSize="9" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>17</text>
      <text x={center} y={center + 9} textAnchor="middle" fontSize="7.5" fontWeight="600" fill="rgba(0,0,0,0.85)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.6))" }}>{val(16).toFixed(1)}</text>

      {/* ── Colour scale bar ── */}
      <defs>
        <linearGradient id="strainBar" x1="0" x2="1" y1="0" y2="0">
          {reverse ? (
            <>
              <stop offset="0%"   stopColor="#00ff00" />
              <stop offset="25%"  stopColor="#80ff00" />
              <stop offset="50%"  stopColor="#ffff00" />
              <stop offset="75%"  stopColor="#ff8000" />
              <stop offset="100%" stopColor="#ff0000" />
            </>
          ) : (
            <>
              <stop offset="0%"   stopColor="#ff0000" />
              <stop offset="25%"  stopColor="#ff8000" />
              <stop offset="50%"  stopColor="#ffff00" />
              <stop offset="75%"  stopColor="#80ff00" />
              <stop offset="100%" stopColor="#00ff00" />
            </>
          )}
        </linearGradient>
      </defs>
      <rect x="30" y="305" width="240" height="6" rx="3" fill="url(#strainBar)" opacity="0.9" />
      <text x="30"  y="320" textAnchor="middle" fontSize="7" fill="currentColor" opacity="0.7">{colMin.toFixed(1)}</text>
      <text x="150" y="320" textAnchor="middle" fontSize="7" fill="currentColor" opacity="0.7">{strainType} %</text>
      <text x="270" y="320" textAnchor="middle" fontSize="7" fill="currentColor" opacity="0.7">{colMax.toFixed(1)}</text>

    </svg>
  );
}
