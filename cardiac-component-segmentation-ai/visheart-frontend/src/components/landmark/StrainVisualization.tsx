"use client";

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
}

export interface StrainSegmentData {
  segment: number;
  label: string;
  strain: number;
}

/**
 * Regional RV strain. Unlike RealStrainSegment's grs/gcs (wall-thickness and
 * circumference), `strain` here is % change in RV cavity boundary radius —
 * there is no separate RV free-wall myocardium label to measure thickness
 * against, so this mirrors the same radius-based methodology GCS uses,
 * applied to the RV cavity instead of the LV endocardium. Basal/mid
 * free-wall regions only (no apex/RVOT/LVOT breakdown yet).
 */
export interface RvStrainRegion {
  region: number;
  label: string;
  strain: number | null;
  radius_ed_mm?: number | null;
  radius_es_mm?: number | null;
}

export interface RvStrainResult {
  regions: RvStrainRegion[];
  global_rv_strain: number | null;
  vox_xy_mm: number;
  alignment_source: string;
  alignment_angle_deg?: number | null;
  source?: "frames";
  edFrameIndex?: number;
  esFrameIndex?: number;
}

// ── dummy data ────────────────────────────────────────────────────────────────

// AHA order: Ant, AntLat, InfLat, Inf, InfSep, AntSep (basal then mid), then 4 apical, apex
const BASE_GCS = [-17.1, -18.3, -16.8, -17.7, -19.4, -18.5, -20.2, -19.1, -18.2, -19.7, -20.8, -20.1, -21.0, -19.5, -20.4, -19.8, -18.9];
const BASE_GRS = [26.4, 28.2, 24.9, 25.8, 30.1, 29.4, 31.2, 30.5, 27.8, 28.6, 32.4, 31.6, 34.1, 32.7, 33.4, 31.9, 29.8];

const SEGMENT_LABELS = [
  "Basal Anterior", "Basal Anterolateral", "Basal Inferolateral",
  "Basal Inferior", "Basal Inferoseptal", "Basal Anteroseptal",
  "Mid Anterior", "Mid Anterolateral", "Mid Inferolateral",
  "Mid Inferior", "Mid Inferoseptal", "Mid Anteroseptal",
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

// Same ramp as ClientHeartModel: red(0) → yellow(0.5) → green(1)
export function rdYlGn(t: number): string {
  const r = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
  const g = t < 0.5 ? t * 2 : 1;
  const toHex = (x: number) =>
    Math.round(Math.max(0, Math.min(255, x * 255))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}00`;
}

export function getStrainColor(strain: number, strainType: StrainType): string {
  if (strainType === "GRS") {
    if (strain < 16) return "#dc2626";
    if (strain < 24) return "#f97316";
    if (strain < 30) return "#eab308";
    if (strain < 38) return "#22c55e";
    return "#15803d";
  }
  // GCS — negative is normal
  if (strain > -13) return "#dc2626";
  if (strain > -17) return "#f97316";
  if (strain > -20) return "#eab308";
  if (strain > -24) return "#22c55e";
  return "#15803d";
}

// Returns a value 0–1 representing position on a colour scale for the whole dataset
function strainNorm(strain: number, min: number, max: number, strainType: StrainType): number {
  if (max === min) return 0.5;
  // For GRS higher is better, for GCS more negative is better — normalise so "good" → high
  return strainType === "GRS"
    ? (strain - min) / (max - min)
    : (max - strain) / (max - min);
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
}

export function StrainBullseyeChart({
  data, strainType, selectedSegment, onSegmentClick, onSegmentHover,
  forcedMin, forcedMax, sharedMin, sharedMax, reverseColors = false,
}: ChartProps) {
  const center = 150;
  const basalOuter = 108, basalInner = 81, midInner = 54, apicalInner = 28;

  const values = data.map((d) => d.strain);
  const colMin = sharedMin ?? forcedMin ?? Math.min(...values);
  const colMax = sharedMax ?? forcedMax ?? Math.max(...values);

  const val = (i: number) => data[i]?.strain ?? 0;
  const lbl = (i: number) => data[i]?.label ?? `Segment ${i + 1}`;
  // Use rdYlGn normalised against the shared range — same function as 3D heart
  const col = (i: number) => {
    const v = val(i);
    const t = colMin === colMax ? 0.5 : Math.max(0, Math.min(1, (v - colMin) / (colMax - colMin)));
    return rdYlGn(reverseColors ? 1 - t : t);
  };
  const isSel = (seg1based: number) => selectedSegment === seg1based;

  // AHA CCW convention — identical to AhaBullseyeChart:
  //   basal/mid: startAngle = -120 - index*60, endAngle = -60 - index*60
  //   apical:    startAngle = -135 - index*90, endAngle = -45 - index*90
  const segPath = (i: number, innerR: number, outerR: number, ring: "bm" | "ap") => {
    const start = ring === "bm" ? -120 - i * 60 : -135 - i * 90;
    const end   = ring === "bm" ?  -60 - i * 60 :  -45 - i * 90;
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
      <text x="298" y={center + 4} textAnchor="end" fontSize="11" fontWeight="700" fill="currentColor">Lateral</text>
      <text x={center} y="290" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">Inferior</text>
      <text x="2" y={center + 4} textAnchor="start" fontSize="11" fontWeight="700" fill="currentColor">Septal</text>

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
          {reverseColors ? (
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

// ── StrainHeartProjection — anatomical 3D-style colour-synced SVG heart ──────

interface HeartProps {
  data: StrainSegmentData[];
  strainType: StrainType;
  selectedSegment?: number | null;
  onSegmentClick?: (seg: number) => void;
  frame?: number;
  totalFrames?: number;
}

export function StrainHeartProjection({ data, strainType, selectedSegment, onSegmentClick, frame = 0, totalFrames = 1 }: HeartProps) {
  const col = (i: number) => getStrainColor(data[i]?.strain ?? 0, strainType);
  const isSel = (seg: number) => selectedSegment === seg;

  // Heart-shaped outline with coloured zones matching AHA regions
  // Uses an anterior view SAX approximation: concentric ellipses with colour bands
  const cx = 130, cy = 155;
  const phase = totalFrames > 1 ? frame / (totalFrames - 1) : 0;
  const breathe = Math.sin(phase * Math.PI);

  // Outer wall dimensions animate with cardiac cycle
  const outerRx = 95 + breathe * 4;
  const outerRy = 110 + breathe * 5;
  const innerRx = 42 - breathe * 6;
  const innerRy = 48 - breathe * 7;

  // Segment wedge boundaries (8 outer, 6 mid, 4 inner — simplified to 3 rings + apex)
  // We draw colour-coded arcs matching the 2D bullseye segments
  // Outer ring = basal (6 sectors), mid ring, apical (4), apex center
  const rings = [
    { segs: 6, dataOffset: 0,  innerFx: 0.55, outerFx: 1.0,  innerFy: 0.54, outerFy: 1.0  },
    { segs: 6, dataOffset: 6,  innerFx: 0.35, outerFx: 0.55, innerFy: 0.34, outerFy: 0.54 },
    { segs: 4, dataOffset: 12, innerFx: 0.18, outerFx: 0.35, innerFy: 0.17, outerFy: 0.34 },
  ];

  return (
    <svg viewBox="0 0 260 310" className="h-full w-full" role="img" aria-label={`${strainType} heart projection`}>
      {/* Background */}
      <ellipse cx={cx} cy={cy} rx={outerRx + 6} ry={outerRy + 8} className="fill-slate-100 dark:fill-zinc-800" />

      {/* Coloured rings */}
      {rings.map((ring, ri) => {
        const iRx = outerRx * ring.innerFx, iRy = outerRy * ring.innerFy;
        const oRx = outerRx * ring.outerFx, oRy = outerRy * ring.outerFy;
        const n = ring.segs;
        return Array.from({ length: n }, (_, si) => {
          const seg1based = ring.dataOffset + si + 1;
          const angleStep = 360 / n;
          // CCW from top: same -120 - i*60 convention
          const startDeg = ring.segs === 4
            ? -135 - si * 90
            : -120 - si * 60;
          const endDeg = ring.segs === 4
            ? -45 - si * 90
            : -60 - si * 60;
          const fill = col(ring.dataOffset + si);
          const selected = isSel(seg1based);

          const toEllipticPoint = (rx: number, ry: number, deg: number) => {
            const a = (deg * Math.PI) / 180;
            return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
          };
          const os = toEllipticPoint(oRx, oRy, startDeg);
          const oe = toEllipticPoint(oRx, oRy, endDeg);
          const ie = toEllipticPoint(iRx, iRy, endDeg);
          const is_ = toEllipticPoint(iRx, iRy, startDeg);
          const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
          const path = [
            `M ${os.x} ${os.y}`,
            `A ${oRx} ${oRy} 0 ${large} 1 ${oe.x} ${oe.y}`,
            `L ${ie.x} ${ie.y}`,
            `A ${iRx} ${iRy} 0 ${large} 0 ${is_.x} ${is_.y}`,
            "Z",
          ].join(" ");

          // Label at midpoint
          const midDeg = (startDeg + endDeg) / 2;
          const lRx = (oRx + iRx) / 2, lRy = (oRy + iRy) / 2;
          const lp = toEllipticPoint(lRx, lRy, midDeg);

          return (
            <g key={`hr${ri}-${si}`}>
              <path
                d={path} fill={fill}
                stroke={selected ? "white" : "rgba(0,0,0,0.2)"}
                strokeWidth={selected ? 2.5 : 0.8}
                style={{ transition: "fill 200ms ease", filter: selected ? "drop-shadow(0 0 4px rgba(255,255,255,0.8))" : undefined, cursor: onSegmentClick ? "pointer" : "default" }}
                onClick={onSegmentClick ? () => onSegmentClick(seg1based) : undefined}
              />
              {ri < 2 && (
                <text x={lp.x} y={lp.y + 4} textAnchor="middle" fontSize="8" fontWeight="600"
                  fill="rgba(0,0,0,0.75)" style={{ pointerEvents: "none", filter: "drop-shadow(0 1px 1px rgba(255,255,255,0.7))" }}>
                  {seg1based}
                </text>
              )}
            </g>
          );
        });
      })}

      {/* Apex centre */}
      {(() => {
        const apRx = outerRx * 0.18, apRy = outerRy * 0.17;
        return (
          <g>
            <ellipse cx={cx} cy={cy} rx={apRx} ry={apRy}
              fill={col(16)}
              stroke={isSel(17) ? "white" : "rgba(0,0,0,0.2)"}
              strokeWidth={isSel(17) ? 2.5 : 0.8}
              style={{ transition: "fill 200ms ease", cursor: onSegmentClick ? "pointer" : "default" }}
              onClick={onSegmentClick ? () => onSegmentClick(17) : undefined}
            />
            <text x={cx} y={cy + 4} textAnchor="middle" fontSize="8" fontWeight="600"
              fill="rgba(0,0,0,0.75)" style={{ pointerEvents: "none" }}>17</text>
          </g>
        );
      })()}

      {/* LV cavity ring */}
      <ellipse cx={cx} cy={cy} rx={outerRx * 0.12} ry={outerRy * 0.11}
        className="fill-slate-900/60 dark:fill-zinc-950/80" />

      {/* Outer border */}
      <ellipse cx={cx} cy={cy} rx={outerRx} ry={outerRy}
        fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="1.5" />

      {/* Apex pointer */}
      <text x={cx} y={cy + outerRy + 16} textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor" opacity="0.6">Apex</text>
      <text x={cx} y={cy - outerRy - 8} textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor" opacity="0.6">Base</text>

      {/* Frame indicator */}
      {totalFrames > 1 && (
        <text x="248" y="16" textAnchor="end" fontSize="8" fill="currentColor" opacity="0.5">
          {frame + 1}/{totalFrames}
        </text>
      )}

      {/* Legend: selected segment callout */}
      {selectedSegment && selectedSegment >= 1 && selectedSegment <= 17 && (() => {
        const sv = data[selectedSegment - 1];
        if (!sv) return null;
        return (
          <g>
            <rect x="4" y="280" width="252" height="22" rx="4"
              className="fill-background/90 dark:fill-zinc-900/90" stroke="rgba(0,0,0,0.1)" strokeWidth="1" />
            <text x="12" y="295" fontSize="9" fontWeight="600" fill="currentColor" opacity="0.9">
              {sv.label}: {sv.strain > 0 ? "+" : ""}{sv.strain.toFixed(1)}%
            </text>
          </g>
        );
      })()}
    </svg>
  );
}

// ── StrainBullseye — legacy full-panel component (kept for backwards compat) ──

interface StrainVisualizationProps {
  segmentData?: StrainSegmentData[];
  realStrainData?: RealStrainResult | null;
  selectedStrainType?: StrainType;
  frame?: number;
  totalFrames?: number;
  compact?: boolean;
  selectedSegment?: number | null;
  onSelectSegment?: (segment: number) => void;
}

export const StrainBullseye: React.FC<StrainVisualizationProps> = ({
  segmentData, realStrainData, selectedStrainType = "GCS",
  frame = 0, totalFrames = 10, compact = false, selectedSegment, onSelectSegment,
}) => {
  const data: StrainSegmentData[] = realStrainData
    ? realStrainData.segments.map((s) => ({
        segment: s.segment, label: s.label,
        strain: selectedStrainType === "GRS" ? (s.grs ?? 0) : (s.gcs ?? 0),
      }))
    : (segmentData ?? getDummyStrainData(selectedStrainType, frame, totalFrames));

  const resetRef = useRef<(() => void) | null>(null);
  const [tooltip, setTooltip] = React.useState<{ x: number; y: number; label: string; value: number } | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2 gap-1">
      <div className="flex items-center justify-between flex-shrink-0">
        <p className="text-[8px] text-muted-foreground/60">Scroll to zoom · drag to pan</p>
        <button type="button" onClick={() => resetRef.current?.()}
          className="rounded border border-border bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground hover:bg-muted transition-colors">
          Reset View
        </button>
      </div>
      <ZoomPanContainer className="min-h-0 flex-1 w-full" onResetRef={(fn) => { resetRef.current = fn; }}>
        <StrainBullseyeChart
          data={data} strainType={selectedStrainType}
          selectedSegment={selectedSegment}
          onSegmentClick={onSelectSegment}
          onSegmentHover={setTooltip}
        />
      </ZoomPanContainer>
      {tooltip && (
        <div className="fixed z-50 pointer-events-none rounded px-2 py-1 text-xs bg-black/85 text-white border border-white/20 shadow-lg"
          style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}>
          <div className="font-semibold">{tooltip.label}</div>
          <div>{tooltip.value > 0 ? "+" : ""}{tooltip.value.toFixed(1)}%</div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] text-muted-foreground flex-shrink-0 mt-1">
        {[["#15803d","Excellent"],["#22c55e","Good"],["#eab308","Fair"],["#f97316","Reduced"],["#dc2626","Poor"]].map(([color, label]) => (
          <span key={label} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>
      {!compact && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="bg-muted/30 p-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide">Per-Segment {selectedStrainType} Values</h3>
          </div>
          <div className="max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 border-b border-border bg-background">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Segment</th>
                  <th className="px-3 py-2 text-right">{selectedStrainType} (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map((item) => (
                  <tr key={item.segment} className="hover:bg-muted/40">
                    <td className="px-3 py-2 text-muted-foreground">{item.segment}</td>
                    <td className="px-3 py-2">{item.label}</td>
                    <td className="px-3 py-2 text-right font-mono" style={{ color: getStrainColor(item.strain, selectedStrainType) }}>
                      {item.strain > 0 ? "+" : ""}{item.strain.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default StrainBullseye;
