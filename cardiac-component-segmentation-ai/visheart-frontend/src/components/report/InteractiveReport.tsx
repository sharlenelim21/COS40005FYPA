"use client";

/**
 * InteractiveReport — the on-screen presentation of the cardiac analysis report.
 *
 * The same route also renders the paginated A4 sheets (ReportPageFrame et al.)
 * for printing; CSS picks exactly one per medium (.vh-screen-only /
 * .vh-print-only in globals.css). This component is screen-only: it is free to
 * be interactive, since a printed page can't be hovered.
 *
 * All clinical values come from the stored pipeline output via useProjectResults
 * — nothing here is generated. Sections with no stored data render an explicit
 * empty state rather than placeholder numbers, so the report can never imply a
 * measurement that wasn't computed.
 */

import React, { useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import { CheckCircle2, AlertTriangle, Info, Sparkles, Heart, BookOpen, FileText, Loader2 } from "lucide-react";
import type { Measurements, HealthStatus, DiseaseSimilarity, Strain, StrainSeries, RegionalHealthStatus } from "@/hooks/useProjectResults";

// AHA 17-segment ring layout: 6 basal, 6 mid, 4 apical, 1 apex.
const RINGS = [
  { rInner: 105, rOuter: 140, count: 6, firstSegment: 1 },
  { rInner: 65,  rOuter: 105, count: 6, firstSegment: 7 },
  { rInner: 30,  rOuter: 65,  count: 4, firstSegment: 13 },
];

const SEGMENT_COLORS = [
  "#E11D2E", "#F97316", "#EAB308", "#22C55E", "#14B8A6", "#0EA5E9", "#6366F1",
  "#A855F7", "#EC4899", "#F43F5E", "#84CC16", "#06B6D4", "#8B5CF6", "#D946EF",
  "#F59E0B", "#10B981", "#3B82F6",
];

const PATTERN_COLORS: Record<string, string> = { NOR: "#15803d", DCM: "#b45309", HCM: "#dc2626" };

type StrainType = "GRS" | "GCS";

// Same red→green gradient the landmark-detection bullseye uses, so the two
// plots read with one colour language. Red = weak contraction, green = strong.
const STRAIN_GRADIENT = ["#d73027", "#fc8d59", "#fee08b", "#d9ef8b", "#91cf60", "#1a9850"] as const;

function lerpHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = p(a);
  const [br, bg, bb] = p(b);
  const to = (x: number) => Math.round(x).toString(16).padStart(2, "0");
  return `#${to(ar + (br - ar) * t)}${to(ag + (bg - ag) * t)}${to(ab + (bb - ab) * t)}`;
}

/**
 * Colour by contraction strength on a continuous scale (matching the landmark
 * bullseye). GRS is positive (thickening) and GCS negative (shortening), so
 * both are normalised to "fraction of expected peak contraction": 0 → red,
 * 1 → green.
 */
function strainColor(v: number | null, type: StrainType): string {
  if (v === null || Number.isNaN(v)) return "#e5e7eb";
  // Normalise to 0..1 against a typical healthy peak (GRS ~40 %, GCS ~-20 %).
  const frac = type === "GCS" ? Math.abs(v) / 20 : v / 40;
  const t = Math.max(0, Math.min(1, frac));
  const scaled = t * (STRAIN_GRADIENT.length - 1);
  const i = Math.min(Math.floor(scaled), STRAIN_GRADIENT.length - 2);
  return lerpHex(STRAIN_GRADIENT[i], STRAIN_GRADIENT[i + 1], scaled - i);
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function wedgePath(cx: number, cy: number, rInner: number, rOuter: number, a0: number, a1: number): string {
  const p0 = polar(cx, cy, rOuter, a0);
  const p1 = polar(cx, cy, rOuter, a1);
  const p2 = polar(cx, cy, rInner, a1);
  const p3 = polar(cx, cy, rInner, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${rOuter} ${rOuter} 0 ${large} 1 ${p1.x} ${p1.y} L ${p2.x} ${p2.y} A ${rInner} ${rInner} 0 ${large} 0 ${p3.x} ${p3.y} Z`;
}

type SegValue = { segment: number; label: string; value: number | null };

function Bullseye({ values, strainType }: { values: SegValue[]; strainType: StrainType }) {
  const cx = 140, cy = 140;
  const byId = new Map(values.map((v) => [v.segment, v]));
  const wedges: React.ReactNode[] = [];

  RINGS.forEach((ring, ri) => {
    const step = 360 / ring.count;
    const offset = ri === 2 ? -45 : 0; // apical ring is rotated in the AHA model
    for (let i = 0; i < ring.count; i++) {
      const segId = ring.firstSegment + i;
      const seg = byId.get(segId);
      const v = seg?.value ?? null;
      wedges.push(
        <path
          key={segId}
          d={wedgePath(cx, cy, ring.rInner, ring.rOuter, offset + i * step, offset + (i + 1) * step)}
          fill={strainColor(v, strainType)}
          stroke="#fff"
          strokeWidth={1.5}
          style={{ transition: "fill 120ms ease" }}
        >
          <title>{`${seg?.label ?? `Segment ${segId}`}: ${v === null ? "—" : `${v.toFixed(1)}%`}`}</title>
        </path>,
      );
    }
  });

  const apex = byId.get(17);
  return (
    <svg viewBox="0 0 280 280" width="100%" height={240} role="img" aria-label="AHA 17-segment bullseye">
      {wedges}
      <circle cx={cx} cy={cy} r={30} fill={strainColor(apex?.value ?? null, strainType)} stroke="#fff" strokeWidth={1.5} style={{ transition: "fill 120ms ease" }}>
        <title>{`Apex: ${apex?.value === null || apex?.value === undefined ? "—" : `${apex.value.toFixed(1)}%`}`}</title>
      </circle>
      <text x={cx} y={16} textAnchor="middle" fontSize={11} className="fill-muted-foreground">Anterior</text>
      <text x={cx} y={272} textAnchor="middle" fontSize={11} className="fill-muted-foreground">Inferior</text>
      <text x={12} y={cy + 4} textAnchor="start" fontSize={11} className="fill-muted-foreground">Lateral</text>
      <text x={268} y={cy + 4} textAnchor="end" fontSize={11} className="fill-muted-foreground">Septal</text>
    </svg>
  );
}

function Card({ title, subtitle, icon, children }: {
  title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start gap-2.5">
        {icon && <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">{icon}</div>}
        <div>
          <h2 className="text-[15px] font-bold text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function fmt(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

/**
 * One short line explaining WHY the health status is low-confidence.
 *
 * The backend sets confidence="low" for exactly two reasons
 * (compute_health_status.py): EF was not computable, or heart-metrics warnings
 * caused the volume evidence to be suppressed. Each leaves a distinctive
 * `warn` evidence line, so we match those two specifically.
 *
 * Deliberately NOT "any warn line". Peak GCS, Peak GRS, End-Diastolic Volume
 * and a *present-but-low* EF all emit level:"warn" while confidence stays
 * "normal" — those feed the downgrade heuristic, not confidence. Matching them
 * would attach a wrong reason to a perfectly normal-confidence result (e.g. a
 * severely-reduced-but-known EF would read as "EF could not be computed").
 *
 * EF-null is detected via grade_from_ef === "Indeterminate", which the backend
 * maps a null EF to (_grade_from_lvef); more robust than string-matching the
 * detail text, which is kept only as a fallback. When both causes co-occur the
 * EF reason leads — without EF there is no grade at all.
 */
function confidenceReason(hs: HealthStatus): string {
  const efNotComputable =
    hs.grade_from_ef === "Indeterminate" ||
    !!hs.evidence?.some(
      (e) =>
        e.label === "Ejection Fraction" &&
        e.level === "warn" &&
        /not computable/i.test(e.detail),
    );
  if (efNotComputable) {
    return (
      "Ejection fraction could not be computed, so the status is not graded — " +
      "usually only one cardiac phase was segmented, or ED and ES resolved to the same frame."
    );
  }

  const volumesUnreliable = !!hs.evidence?.some(
    (e) => e.label === "Absolute volumes" && e.level === "warn",
  );
  if (volumesUnreliable) {
    return (
      "Volume measurements may be unreliable — the heart-metrics compute flagged the " +
      "affine / spacing, so the status is graded from EF alone."
    );
  }

  return "The underlying measurements may be unreliable — interpret with caution.";
}

/**
 * Placeholder shown in a summary card that has no data yet. Distinguishes
 * "the compute is running" from "nothing ever asked for it" from "it failed",
 * so an empty card is never a dead end for the reader.
 */
function EmptyState({ computing, error }: { computing?: boolean; error?: string | null }) {
  if (computing) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Computing from segmentation…
      </p>
    );
  }
  if (error) {
    return (
      <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{error}</span>
      </p>
    );
  }
  return <p className="text-xs text-muted-foreground">Not computed for this model yet.</p>;
}

export function InteractiveReport({
  patientLabel, scanSummary, generatedAt,
  measurements, healthStatus, similarity, strain, strainSeries, regionalHealthStatus,
  computing, computeError,
}: {
  patientLabel: string;
  scanSummary: string;
  generatedAt: string;
  measurements?: Measurements;
  healthStatus?: HealthStatus;
  similarity?: DiseaseSimilarity;
  strain?: Strain;
  strainSeries?: StrainSeries;
  /** Layer 2 — advisory, shown beneath the Layer-1 evidence. Never alters the grade. */
  regionalHealthStatus?: RegionalHealthStatus;
  /** True while the analysis triggers are running — see useProjectResults. */
  computing?: boolean;
  computeError?: string | null;
}) {
  const [strainType, setStrainType] = useState<StrainType>("GCS");
  const [hoverSeg, setHoverSeg] = useState<number | null>(null);
  const [hoverFrame, setHoverFrame] = useState<number | null>(null);

  const key = strainType === "GRS" ? "grs" : "gcs";

  // Recharts rows: one per frame, one dataKey per segment (s1..s17).
  const curves = useMemo(() => {
    if (!strainSeries?.frames?.length) return [];
    return strainSeries.frames.map((f) => {
      const row: Record<string, number | null> = { frame: f.frameIndex };
      for (const s of f.segments ?? []) row[`s${s.segment}`] = (s as any)[key] ?? null;
      return row;
    });
  }, [strainSeries, key]);

  // Segment labels come from whichever real payload is available.
  const segmentLabels = useMemo(() => {
    const src = strain?.segments?.length ? strain.segments : strainSeries?.frames?.[0]?.segments ?? [];
    return src.map((s) => ({ segment: s.segment, label: s.label }));
  }, [strain, strainSeries]);

  // Default the bullseye to peak systole; hovering the chart overrides it.
  const defaultFrame = strainSeries?.peakFrameIndex ?? strainSeries?.frames?.at(-1)?.frameIndex ?? null;
  const activeFrame = hoverFrame ?? defaultFrame;

  const bullseyeValues: SegValue[] = useMemo(() => {
    const frame = strainSeries?.frames?.find((f) => f.frameIndex === activeFrame);
    const src = frame?.segments ?? strain?.segments ?? [];
    return src.map((s) => ({ segment: s.segment, label: s.label, value: (s as any)[key] ?? null }));
  }, [strainSeries, strain, activeFrame, key]);

  const hasStrainData = bullseyeValues.length > 0;
  const hasCurves = curves.length > 1;

  const metricRows: [string, string, string][] = [
    ["Ejection Fraction", fmt(measurements?.EF), "%"],
    ["EDV", fmt(measurements?.EDV), "mL"],
    ["ESV", fmt(measurements?.ESV), "mL"],
    ["Stroke Volume", fmt(measurements?.StrokeVolume), "mL"],
    ["Peak GRS", fmt(measurements?.PeakGRS), "%"],
    ["Peak GCS", fmt(measurements?.PeakGCS), "%"],
  ];

  return (
    <div className="mx-auto max-w-5xl px-6 pb-16 pt-6">
      <header className="mb-5">
        <p className="text-xs text-muted-foreground">Cardiac Functional Analysis Report · Generated {generatedAt}</p>
        <h1 className="mt-1 text-[22px] font-extrabold text-foreground">Patient {patientLabel}</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{scanSummary}</p>
      </header>

      {/* Summary strip: measurements · health status · disease similarity */}
      <section className="mb-5 grid grid-cols-1 rounded-xl border border-border bg-card md:grid-cols-[1.15fr_1fr_1fr]">
        <div className="border-b border-border p-4 md:border-b-0 md:border-r">
          <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Cardiac Measurements
          </p>
          <p className="mb-3 mt-0.5 text-[11px] text-muted-foreground">From segmentation volumes + voxel spacing</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {metricRows.map(([label, value, unit]) => (
              <div key={label} className="flex items-baseline justify-between border-b border-dashed border-border pb-1">
                <span className="text-[11.5px] text-muted-foreground">{label}</span>
                <span className="text-[13px] font-bold text-foreground">
                  {value}<span className="ml-0.5 text-[10px] font-medium text-muted-foreground">{unit}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="border-b border-border p-4 md:border-b-0 md:border-r">
          <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Health Status
          </p>
          <p className="mb-2.5 mt-0.5 text-[11px] text-muted-foreground">Rule-based — not a diagnosis</p>
          {healthStatus ? (
            <>
              {/* Grade badge (Layer 1) + how much to trust it. The confidence
                  badge sits BESIDE the grade, never inside it — confidence
                  qualifies the grade, it doesn't change it. */}
              <div className="mb-2.5 flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  healthStatus.status === "Healthy" ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                  : healthStatus.status === "Mild" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  : healthStatus.status === "Moderate" ? "bg-orange-500/10 text-orange-700 dark:text-orange-400"
                  : healthStatus.status === "Severe" ? "bg-red-600/10 text-red-700 dark:text-red-400"
                  : "bg-muted text-muted-foreground"}`}>
                  {healthStatus.status}
                </span>

                {/* Rendered only for a value we recognise — an absent/unknown
                    `confidence` shows nothing rather than defaulting to "Low",
                    which would misreport the result. */}
                {(healthStatus.confidence === "normal" || healthStatus.confidence === "low") && (
                  <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${
                    healthStatus.confidence === "low"
                      ? "border border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      : "border border-border bg-muted text-muted-foreground"}`}>
                    {healthStatus.confidence === "low" && (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    )}
                    {healthStatus.confidence === "low" ? "Low confidence" : "Normal confidence"}
                  </span>
                )}
              </div>

              {/* Why it's low — so the badge isn't a mystery. Derived from the
                  two evidence lines that actually drive confidence. */}
              {healthStatus.confidence === "low" && (
                <p className="mb-2.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                  {confidenceReason(healthStatus)}
                </p>
              )}

              <div className="flex flex-col gap-1.5">
                {healthStatus.evidence?.map((e, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs">
                    {e.level === "ok"
                      ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />}
                    <span className={e.level === "ok" ? "text-foreground" : "text-amber-700 dark:text-amber-400"}>
                      <span className="font-medium">{e.label}:</span> {e.detail}
                    </span>
                  </div>
                ))}

                {/* Layer 2 — advisory regional finding, rendered as one more
                    evidence line BELOW the Layer-1 lines. It is deliberately
                    presented as supporting detail, never as part of the grade:
                    the badge above is driven solely by Layer 1. Only shown when
                    the regional layer actually found something; "unavailable"
                    and "no focal defect" stay silent so the card doesn't fill
                    with non-findings. */}
                {regionalHealthStatus?.status === "ok" &&
                 regionalHealthStatus.reduced_count > 0 && (
                  <div className="flex items-start gap-1.5 text-xs" title={regionalHealthStatus.disclaimer}>
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span className="text-amber-700 dark:text-amber-400">
                      {regionalHealthStatus.summary}
                      {regionalHealthStatus.affected_idx?.length > 0 && (
                        <span className="text-muted-foreground">
                          {" "}({regionalHealthStatus.affected_idx.join(", ")})
                        </span>
                      )}
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        · advisory
                      </span>
                    </span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <EmptyState computing={computing} error={computeError} />
          )}
        </div>

        <div className="p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Info className="h-3.5 w-3.5 text-primary" /> Disease Pattern Similarity
          </p>
          <p className="mb-3 mt-0.5 text-[11px] text-muted-foreground">Comparison vs. reference profiles</p>
          {similarity ? (
            <>
              <div className="flex flex-col gap-2.5">
                {similarity.similarities.map((d) => (
                  <div key={d.code}>
                    <div className="mb-1 flex justify-between text-[11.5px]">
                      <span className="text-foreground">{d.label}</span>
                      <span className="font-bold text-foreground">{d.percent.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, d.percent))}%`, background: PATTERN_COLORS[d.code] ?? "#64748b" }} />
                    </div>
                  </div>
                ))}
              </div>
              {/* Why the top pattern matched — the per-metric reasoning the
                  module already computes, shown so the % isn't a black box. */}
              {(() => {
                const top = similarity.similarities.find((s) => s.code === similarity.most_similar);
                if (!top?.reasons?.length) return null;
                return (
                  <div className="mt-3 border-t border-border pt-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Why {top.label}
                    </p>
                    <ul className="flex flex-col gap-0.5">
                      {top.reasons.slice(0, 4).map((r, i) => (
                        <li key={i} className="flex gap-1 text-[10.5px] leading-snug text-muted-foreground">
                          <span className="text-muted-foreground/50">•</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </>
          ) : (
            <EmptyState computing={computing} error={computeError} />
          )}
        </div>
      </section>

      {/* Regional strain: bullseye linked to the full-cycle curves */}
      <Card
        title="Regional Strain Analysis"
        subtitle="AHA 17-segment strain. Hover the chart to redraw the bullseye at that frame."
        icon={<Heart className="h-4 w-4 text-primary" />}
      >
        {!hasStrainData ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No strain computed for this model yet — run strain from the Landmark Detection page.
          </p>
        ) : (
          <>
            <div className="mb-3 inline-flex rounded-lg border border-border bg-background p-0.5">
              {(["GCS", "GRS"] as StrainType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setStrainType(t)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                    strainType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
              <div>
                <div className="mb-1 text-center">
                  <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                    {hoverFrame == null
                      ? (defaultFrame != null ? `Peak · Frame ${defaultFrame}` : "Peak")
                      : `Frame ${activeFrame}`}
                  </span>
                </div>
                <Bullseye values={bullseyeValues} strainType={strainType} />
                {/* Continuous scale, matching the landmark-detection bullseye. */}
                <div className="mx-auto mt-2 max-w-[240px]">
                  <div
                    className="h-2 w-full rounded-full border border-border"
                    style={{ background: `linear-gradient(to right, ${STRAIN_GRADIENT.join(", ")})` }}
                  />
                  <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
                    <span>Weaker</span>
                    <span>Contraction</span>
                    <span>Stronger</span>
                  </div>
                </div>
              </div>

              <div>
                {hasCurves ? (
                  <>
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart
                        data={curves}
                        margin={{ top: 8, right: 12, left: -12, bottom: 4 }}
                        onMouseMove={(e: any) => { if (e?.activeLabel !== undefined) setHoverFrame(Number(e.activeLabel)); }}
                        onMouseLeave={() => setHoverFrame(null)}
                      >
                        <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} />
                        <XAxis dataKey="frame" tick={{ fontSize: 11 }} label={{ value: "Cardiac frame", position: "insideBottom", offset: -2, fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} label={{ value: "Strain (%)", angle: -90, position: "insideLeft", fontSize: 11 }} />
                        <ReferenceLine y={0} stroke="hsl(var(--border))" />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                        {segmentLabels.map((s, i) => (
                          <Line
                            key={s.segment}
                            dataKey={`s${s.segment}`}
                            name={s.label}
                            stroke={SEGMENT_COLORS[i % SEGMENT_COLORS.length]}
                            strokeWidth={hoverSeg === s.segment ? 3 : 1.4}
                            dot={false}
                            opacity={hoverSeg && hoverSeg !== s.segment ? 0.15 : 1}
                            isAnimationActive={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1">
                      {segmentLabels.map((s, i) => (
                        <span
                          key={s.segment}
                          onMouseEnter={() => setHoverSeg(s.segment)}
                          onMouseLeave={() => setHoverSeg(null)}
                          className="flex items-center gap-1 text-[10.5px] text-muted-foreground"
                        >
                          <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: SEGMENT_COLORS[i % SEGMENT_COLORS.length] }} />
                          {s.label}
                        </span>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center">
                    <p className="text-sm text-muted-foreground">Full-cycle curves need the per-frame strain series.</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      The single ED→ES result is shown in the bullseye. Run the strain series to plot strain across the cardiac cycle.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Research assistant — not yet integrated; shown as a labelled preview. */}
      <Card
        title="Clinical Research Assistant"
        subtitle="Not yet integrated — the content below is a static preview, not generated from this patient."
        icon={<BookOpen className="h-4 w-4 text-primary" />}
      >
        <div className="mb-3 rounded-lg border border-dashed border-border bg-muted/20 p-3.5 text-[13px] leading-relaxed text-muted-foreground">
          Retrieval-augmented literature summaries will appear here once the research-assistant
          service is connected. Until then this section shows example papers only — it does not
          reference this patient&apos;s results.
        </div>
        <div className="flex flex-col gap-2.5 opacity-60">
          {[
            ["Deep Learning Techniques for Automatic MRI Cardiac Multi-structures Segmentation and Diagnosis", "Bernard O. et al., IEEE Trans. Medical Imaging, 2018"],
            ["Normal ranges of left ventricular strain by feature-tracking CMR", "J. Cardiovasc. Magn. Reson., 2020"],
          ].map(([title, authors]) => (
            <div key={title} className="flex gap-2.5 rounded-lg border border-border p-3">
              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-[13px] font-semibold text-foreground">{title}</p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">{authors}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <p className="mt-6 text-center text-[11.5px] text-muted-foreground">
        Generated for clinical decision support only. Health Status is a rule-based assessment and
        Disease Pattern Similarity is a similarity comparison — neither is a diagnosis. Final
        interpretation remains the responsibility of the treating clinician.
      </p>
    </div>
  );
}
