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
import { CheckCircle2, AlertTriangle, Info, Sparkles, Heart, Loader2, RotateCcw } from "lucide-react";
import type { Measurements, HealthStatus, DiseaseSimilarity, Strain, StrainSeries, RegionalHealthStatus, RvMetrics, RvStrain } from "@/hooks/useProjectResults";
import { RvStrainChart } from "@/components/landmark/RvStrainChart";
import CardiacResearchAssistant from "@/components/report/CardiacResearchAssistant";
import { buildPatientContext } from "@/lib/researchApi";

// AHA 17-segment ring layout: 6 basal, 6 mid, 4 apical, 1 apex.
const RINGS = [
  { rInner: 105, rOuter: 140, count: 6, firstSegment: 1 },
  { rInner: 65,  rOuter: 105, count: 6, firstSegment: 7 },
  { rInner: 30,  rOuter: 65,  count: 4, firstSegment: 13 },
];

const PATTERN_COLORS: Record<string, string> = { NOR: "#15803d", DCM: "#b45309", HCM: "#dc2626" };

/**
 * Curves are coloured by AHA RING, not per-segment. 17 distinct hues is
 * unreadable and fights the bullseye's own ring language; 4 keeps the chart
 * legible and matches what RegionalStrainCharts already does. Individual
 * segments are identified by selection + the info box, not by colour.
 * Uses the app's chart tokens so it stays on-theme in dark mode.
 */
const RING_OF = (seg: number): "basal" | "mid" | "apical" | "apex" =>
  seg <= 6 ? "basal" : seg <= 12 ? "mid" : seg <= 16 ? "apical" : "apex";

const RING_COLOR_VAR: Record<string, string> = {
  basal: "var(--chart-1)",
  mid: "var(--chart-2)",
  apical: "var(--chart-3)",
  apex: "var(--chart-4)",
};

/**
 * Severity → the SAME token strings the overall health-status badge uses, so
 * "Severe" reads identically wherever it appears. Not a new colour system.
 */
const LEVEL_BADGE: Record<string, string> = {
  normal: "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  mild: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  moderate: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  severe: "bg-red-600/10 text-red-700 dark:text-red-400",
};
const LEVEL_WORD: Record<string, string> = {
  normal: "Normal", mild: "Mild", moderate: "Moderate", severe: "Severe",
};

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

/**
 * Polar point in SVG screen space: 0° = 3 o'clock, angles increase clockwise
 * (because +y is down). NO -90° shift — callers pass true screen angles.
 *
 * The previous version applied `angleDeg - 90` and callers walked sectors
 * clockwise from 0, which wound the ring the WRONG WAY: every *lateral*
 * segment rendered on the septal (right) side and every *septal* segment on
 * the lateral (left) side — a left-right mirror against this chart's own
 * direction labels. Angles now match the AHA convention in
 * visheart-inference-gpu/app/bullseye_analysis.py, which is also what
 * StrainBullseyeChart uses.
 */
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
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

/**
 * Read the GRS or GCS field off a per-segment strain entry.
 *
 * `strain.segments[]` and `strainSeries.frames[].segments[]` are structurally
 * different types that happen to share `grs`/`gcs`, so indexing the union
 * directly doesn't narrow. Accepting the shared shape keeps this type-safe and
 * removes the `as any` casts the call sites used to need.
 */
const strainField = (
  s: { grs?: number | null; gcs?: number | null },
  key: "grs" | "gcs",
): number | null => s[key] ?? null;

function Bullseye({
  values, strainType, selectedSegment = null, onSegmentClick, onSegmentHover,
}: {
  values: SegValue[];
  strainType: StrainType;
  /** 1-based AHA segment id to highlight, or null. Optional — the print pages
   *  render this component read-only and pass none of the interaction props. */
  selectedSegment?: number | null;
  onSegmentClick?: (seg: number) => void;
  onSegmentHover?: (seg: number | null) => void;
}) {
  const cx = 140, cy = 140;
  const byId = new Map(values.map((v) => [v.segment, v]));
  const wedges: React.ReactNode[] = [];
  const interactive = !!onSegmentClick;

  // Selected wedge: strong foreground outline + lift. Uses currentColor so it
  // inverts correctly in dark mode instead of a baked-in white/black.
  const selProps = (seg: number) =>
    selectedSegment === seg
      ? { stroke: "currentColor", strokeWidth: 3, style: { filter: "brightness(1.06)" } }
      : { stroke: "var(--card)", strokeWidth: 1.5 };

  /** Clicks must not bubble to the reset handler on the chart wrapper. */
  const clickProps = (seg: number) =>
    onSegmentClick
      ? {
          onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSegmentClick(seg); },
          onMouseEnter: () => onSegmentHover?.(seg),
          onMouseLeave: () => onSegmentHover?.(null),
          cursor: "pointer",
        }
      : {};

  RINGS.forEach((ring, ri) => {
    // AHA sector angles, counter-clockwise from 12 o'clock = Anterior. These are
    // the same formulas StrainBullseyeChart uses, so the report bullseye and the
    // landmark bullseye now place a given segment id in the SAME position.
    //   basal / mid : segment i spans [-120 - 60i, -60 - 60i]
    //   apical      : segment i spans [-135 - 90i, -45 - 90i]
    const apical = ri === 2;
    for (let i = 0; i < ring.count; i++) {
      const segId = ring.firstSegment + i;
      const a0 = apical ? -135 - i * 90 : -120 - i * 60;
      const a1 = apical ? -45 - i * 90 : -60 - i * 60;
      const seg = byId.get(segId);
      const v = seg?.value ?? null;
      const mid = polar(cx, cy, (ring.rInner + ring.rOuter) / 2, (a0 + a1) / 2);
      wedges.push(
        <g key={segId} {...clickProps(segId)}>
          <path
            d={wedgePath(cx, cy, ring.rInner, ring.rOuter, a0, a1)}
            fill={strainColor(v, strainType)}
            {...selProps(segId)}
            style={{ transition: "fill 120ms ease, stroke-width 120ms ease" }}
          >
            <title>{`${seg?.label ?? `Segment ${segId}`}: ${v === null ? "—" : `${v.toFixed(1)}%`}`}</title>
          </path>
          {/* Segment number: with curves coloured by ring (4 hues, not 17),
              the number is how a reader identifies a specific segment. */}
          <text
            x={mid.x} y={mid.y + 3} textAnchor="middle" fontSize={10} fontWeight={700}
            fill="#0b1220" style={{ pointerEvents: "none" }}
          >
            {segId}
          </text>
        </g>,
      );
    }
  });

  const apex = byId.get(17);
  return (
    <svg
      viewBox="0 0 280 280" width="100%" height={240} role="img"
      aria-label="AHA 17-segment bullseye"
      className={interactive ? "text-foreground" : undefined}
    >
      {wedges}
      <g {...clickProps(17)}>
        <circle
          cx={cx} cy={cy} r={30} fill={strainColor(apex?.value ?? null, strainType)}
          {...selProps(17)}
          style={{ transition: "fill 120ms ease, stroke-width 120ms ease" }}
        >
          <title>{`Apex: ${apex?.value === null || apex?.value === undefined ? "—" : `${apex.value.toFixed(1)}%`}`}</title>
        </circle>
        <text x={cx} y={cy + 3} textAnchor="middle" fontSize={10} fontWeight={700} fill="#0b1220" style={{ pointerEvents: "none" }}>17</text>
      </g>
      <text x={cx} y={16} textAnchor="middle" fontSize={11} className="fill-muted-foreground">Anterior</text>
      <text x={cx} y={272} textAnchor="middle" fontSize={11} className="fill-muted-foreground">Inferior</text>
      <text x={12} y={cy + 4} textAnchor="start" fontSize={11} className="fill-muted-foreground">Septal</text>
      <text x={268} y={cy + 4} textAnchor="end" fontSize={11} className="fill-muted-foreground">Lateral</text>
    </svg>
  );
}

function Card({ title, subtitle, icon, children, sectionRef, highlight, action }: {
  title: string; subtitle?: string; icon?: React.ReactNode; children: React.ReactNode;
  /** Optional so existing call sites are unaffected. */
  sectionRef?: React.Ref<HTMLDivElement>;
  /** Brief ring after a scroll-to, so the jump is traceable. */
  highlight?: boolean;
  /** Right-aligned control in the header (e.g. the GCS/GRS toggle). */
  action?: React.ReactNode;
}) {
  return (
    <section
      ref={sectionRef as React.Ref<HTMLElement>}
      className={`mb-5 scroll-mt-24 rounded-xl border bg-card p-5 transition-shadow duration-300 ${
        highlight ? "border-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.25)]" : "border-border"
      }`}
    >
      <div className="mb-4 flex items-start gap-2.5">
        {icon && <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">{icon}</div>}
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-bold text-foreground">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
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
 * Health-status metric rows: the reference band drawn ON the bar, so no
 * separate "Reference Range" text column is needed.
 *
 * Thresholds mirror compute_health_status.py (ASE/EACVI 2015 for LVEF; the
 * strain figures are the same approximate references the backend cites, which
 * vary by vendor/software). They are hardcoded ONLY because the stored payload
 * exposes the verdicts, not the numeric cutoffs — the INTERPRETATION words are
 * always taken from healthStatus.evidence (see interpretationFor) so this table
 * can never contradict the backend's grade.
 */
// ── RV (right-ventricular) helpers ───────────────────────────────────────────
// The report is BIVENTRICULAR (LV + RV), not whole-heart: the atria are not
// segmented, so nothing here describes them.

/**
 * RV ejection-fraction bands. Mirrors the SHAPE of _grade_from_lvef in
 * compute_health_status.py (descending thresholds, "Indeterminate" on null) but
 * is a SEPARATE frontend helper — the LV grader is not touched and the overall
 * badge is never computed from these.
 *
 * ⚠️ APPROXIMATE. Anchored on the 2024 CMR meta-analysis normal lower limit,
 * NOT sex-specific, and not validated for this pipeline. RV normal ranges
 * differ meaningfully between males and females; these MUST be replaced with
 * sex-specific validated values before any clinical use. Advisory only.
 */
const RVEF_NORMAL_MIN = 48.0;
const RVEF_MILD_MIN = 40.0;
const RVEF_MODERATE_MIN = 30.0;

type RvGrade = "Normal" | "Mildly reduced" | "Moderately reduced" | "Severely reduced" | "Indeterminate";

function rvFunctionGrade(rvef: number | null | undefined): RvGrade {
  if (rvef === null || rvef === undefined || Number.isNaN(rvef)) return "Indeterminate";
  if (rvef >= RVEF_NORMAL_MIN) return "Normal";
  if (rvef >= RVEF_MILD_MIN) return "Mildly reduced";
  if (rvef >= RVEF_MODERATE_MIN) return "Moderately reduced";
  return "Severely reduced";
}

/** Reuses the existing status token vocabulary — no new colour system. */
const RV_GRADE_BADGE: Record<RvGrade, string> = {
  "Normal": "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  "Mildly reduced": "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  "Moderately reduced": "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  "Severely reduced": "bg-red-600/10 text-red-700 dark:text-red-400",
  "Indeterminate": "bg-muted text-muted-foreground",
};

/**
 * Stroke-volume balance. In a closed circulation LV and RV stroke volumes
 * should be near-equal; a persistent gap suggests a shunt or valvular
 * regurgitation — OR, far more often here, segmentation error. Flagged as a
 * data-quality / follow-up prompt, never as a finding.
 *
 * ⚠️ APPROXIMATE — a project heuristic, not a guideline. RELATIVE only:
 * >= 25 % of the larger stroke volume.
 *
 * Deliberately no absolute-millilitre floor. An absolute cutoff scales badly:
 * ~10 mL on a normal ~80 mL stroke volume is only ~12 %, well inside RV
 * segmentation noise, while the same 10 mL on a small heart is a genuine
 * mismatch. A pure ratio treats both correctly.
 */
const SV_DIFF_REL_PCT = 25.0;

function svBalance(lvSv: number | null | undefined, rvSv: number | null | undefined) {
  if (lvSv == null || rvSv == null || Number.isNaN(lvSv) || Number.isNaN(rvSv)) return null;
  const diff = rvSv - lvSv;
  const larger = Math.max(Math.abs(lvSv), Math.abs(rvSv));
  const relPct = larger > 0 ? (Math.abs(diff) / larger) * 100 : 0;
  const mismatch = relPct >= SV_DIFF_REL_PCT;
  return { diff, relPct, mismatch };
}

/** RV:LV end-diastolic volume ratio. >= 1.0 means the RV is at least as large
 *  as the LV — the conventional flag for RV enlargement. */
function rvLvRatio(rvedv: number | null | undefined, lvedv: number | null | undefined) {
  if (rvedv == null || lvedv == null || !(lvedv > 0)) return null;
  return rvedv / lvedv;
}

type Zone = { from: number; to: number; tone: "green" | "amber" | "red" };

type MetricBar = {
  key: "EF" | "EDV" | "PeakGCS" | "PeakGRS";
  name: string;
  unit: string;
  /** evidence.label the backend uses for this metric */
  evidenceLabel: string;
  min: number;
  max: number;
  /** inclusive normal band within [min,max] — drawn with a bold outline */
  normal: [number, number];
  /** green = normal, amber = borderline, red = far from normal */
  zones: Zone[];
};

const METRIC_BARS: MetricBar[] = [
  { key: "EF", name: "Ejection Fraction (LVEF)", unit: "%", evidenceLabel: "Ejection Fraction",
    min: 0, max: 100, normal: [55, 100],
    zones: [{ from: 0, to: 30, tone: "red" }, { from: 30, to: 55, tone: "amber" }, { from: 55, to: 100, tone: "green" }] },
  { key: "EDV", name: "End-Diastolic Volume (EDV)", unit: "mL", evidenceLabel: "End-Diastolic Volume",
    min: 0, max: 400, normal: [60, 250],
    zones: [{ from: 0, to: 60, tone: "amber" }, { from: 60, to: 250, tone: "green" }, { from: 250, to: 320, tone: "amber" }, { from: 320, to: 400, tone: "red" }] },
  { key: "PeakGCS", name: "Peak Global Circumferential Strain", unit: "%", evidenceLabel: "Peak GCS",
    min: -30, max: 0, normal: [-30, -17],
    zones: [{ from: -30, to: -17, tone: "green" }, { from: -17, to: -10, tone: "amber" }, { from: -10, to: 0, tone: "red" }] },
  { key: "PeakGRS", name: "Peak Global Radial Strain", unit: "%", evidenceLabel: "Peak GRS",
    min: 0, max: 50, normal: [25, 50],
    zones: [{ from: 0, to: 15, tone: "red" }, { from: 15, to: 25, tone: "amber" }, { from: 25, to: 50, tone: "green" }] },
];

/** Zone fills — muted enough to sit under the value marker without shouting. */
const ZONE_FILL: Record<Zone["tone"], string> = {
  green: "bg-emerald-500/35 dark:bg-emerald-500/30",
  amber: "bg-amber-500/35 dark:bg-amber-500/30",
  red: "bg-red-500/35 dark:bg-red-500/30",
};

/** Position of `v` along the bar, clamped to 0–100 %. */
const pct = (v: number, min: number, max: number) =>
  Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));

/**
 * The Interpretation cell. Sourced from the backend's own evidence line so the
 * table displays the stored grade rather than re-deriving one in the browser.
 * Returns null when the backend didn't evaluate that metric — the row then
 * shows "—" instead of inventing a verdict.
 */
function interpretationFor(hs: HealthStatus | undefined, evidenceLabel: string) {
  const e = hs?.evidence?.find((x) => x.label === evidenceLabel);
  if (!e) return null;
  // Details read like:
  //   "LVEF 17.2 % — severely reduced (< 30 %)."
  //   "EDV 357.1 mL — above the raw adult reference band (60-250 mL). Not
  //    BSA-indexed; body size not accounted for."
  // Take the clause after the em dash, then only its FIRST sentence/clause and
  // drop any parenthetical — the cell needs a short verdict, and the full
  // sentence is already available as the row's tooltip.
  const after = e.detail.split("—")[1]?.trim() ?? e.detail;
  const clause = after.split(/[.;]/)[0].replace(/\s*\([^)]*\)/g, "").trim();
  const verdict = clause || after;
  return {
    // Sentence case only. Tailwind's `capitalize` title-cases EVERY word, which
    // turned "above the raw adult reference band" into "Above The Raw Adult…".
    text: verdict.charAt(0).toUpperCase() + verdict.slice(1),
    full: e.detail,
    level: e.level,
  };
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
  computing, computeError, rv, lvVolumes, rvStrain,
}: {
  patientLabel: string;
  scanSummary: string;
  generatedAt: string;
  measurements?: Measurements;
  /** RV metrics — optional so existing callers and the print pages are
   *  unaffected. Absent/null means no RV cavity was segmented. */
  rv?: RvMetrics;
  lvVolumes?: { LVEDV: number | null; LV_SV: number | null };
  /** Display-only. Undefined until the backend module exists. */
  rvStrain?: RvStrain;
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
      for (const s of f.segments ?? []) row[`s${s.segment}`] = strainField(s, key);
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
    return src.map((s) => ({ segment: s.segment, label: s.label, value: strainField(s, key) }));
  }, [strainSeries, strain, activeFrame, key]);

  const hasStrainData = bullseyeValues.length > 0;
  const hasCurves = curves.length > 1;

  /**
   * The ONE selection shared by the findings buttons, the bullseye wedges and
   * the strain curves. Frame-agnostic on purpose: the regional findings are the
   * ED→ES peak result, so the info box must NOT follow hoverFrame.
   */
  const [selectedSeg, setSelectedSeg] = useState<number | null>(null);
  /** RV region selection — separate from the LV segment selection above; the
   *  two charts are independent and their ids are different scales. */
  const [selectedRvRegion, setSelectedRvRegion] = useState<number | null>(null);
  const [showAllSegments, setShowAllSegments] = useState(false);
  const strainCardRef = React.useRef<HTMLDivElement | null>(null);
  const [pulse, setPulse] = useState(false);

  /** Regional entry for the selected segment; falls back to the ED→ES strain. */
  const selectedInfo = useMemo(() => {
    if (selectedSeg == null) return null;
    const r = regionalHealthStatus?.segments?.find((s) => s.idx === selectedSeg);
    if (r) return { idx: r.idx, label: r.label, region: r.region, gcs: r.gcs, grs: r.grs, level: r.level };
    const s = strain?.segments?.find((x) => x.segment === selectedSeg);
    if (s) return { idx: s.segment, label: s.label, region: RING_OF(s.segment), gcs: s.gcs, grs: s.grs, level: undefined };
    const lbl = segmentLabels.find((x) => x.segment === selectedSeg);
    return { idx: selectedSeg, label: lbl?.label ?? `Segment ${selectedSeg}`, region: RING_OF(selectedSeg), gcs: null, grs: null, level: undefined };
  }, [selectedSeg, regionalHealthStatus, strain, segmentLabels]);

  /** Select + bring the strain card into view (used by the findings buttons). */
  const selectAndReveal = (seg: number) => {
    setSelectedSeg(seg);
    strainCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setPulse(true);
    window.setTimeout(() => setPulse(false), 650);
  };

  /** Level for a segment id, for the findings buttons. */
  const levelOf = (idx: number) =>
    regionalHealthStatus?.segments?.find((s) => s.idx === idx)?.level ?? "normal";

  /** Click persists, hover only previews — selection therefore wins. */
  const emphasisSeg = selectedSeg ?? hoverSeg;

  const regionalOk = regionalHealthStatus?.status === "ok";
  const hasFindings = regionalOk && (regionalHealthStatus?.reduced_count ?? 0) > 0;
  const findingIds = hasFindings
    ? (showAllSegments
        ? (regionalHealthStatus?.segments ?? []).map((s) => s.idx).sort((a, b) => a - b)
        : (regionalHealthStatus?.affected_idx ?? []).slice().sort((a, b) => a - b))
    : [];

  /** LEFT-ventricular cards. Every label is explicitly LV-prefixed: with RV
   *  metrics on the same page, a bare "EDV" is ambiguous. */
  const metricCards: { label: string; value: string; unit: string; accent?: boolean }[] = [
    { label: "LV Ejection Fraction (LVEF)", value: fmt(measurements?.EF), unit: "%", accent: true },
    { label: "LV End-Diastolic Volume (LV EDV)", value: fmt(measurements?.EDV), unit: "mL", accent: true },
    { label: "LV End-Systolic Volume (LV ESV)", value: fmt(measurements?.ESV), unit: "mL" },
    { label: "LV Stroke Volume (LV SV)", value: fmt(measurements?.StrokeVolume), unit: "mL" },
    { label: "LV Peak Global Radial Strain (LV GRS)", value: fmt(measurements?.PeakGRS), unit: "%" },
    { label: "LV Peak Global Circumferential Strain (LV GCS)", value: fmt(measurements?.PeakGCS), unit: "%" },
  ];

  // ── RV block ───────────────────────────────────────────────────────────────
  // Hidden entirely when nothing RV was segmented, rather than rendering a row
  // of em-dashes that implies a measurement was attempted and came back empty.
  const hasRv = !!rv && (rv.RVEF !== null || rv.RVEDV !== null || rv.RVESV !== null || rv.RV_SV !== null);

  const rvCards: { label: string; value: string; unit: string }[] = [
    { label: "RV Ejection Fraction (RVEF)", value: fmt(rv?.RVEF), unit: "%" },
    { label: "RV End-Diastolic Volume (RV EDV)", value: fmt(rv?.RVEDV), unit: "mL" },
    { label: "RV End-Systolic Volume (RV ESV)", value: fmt(rv?.RVESV), unit: "mL" },
    { label: "RV Stroke Volume (RV SV)", value: fmt(rv?.RV_SV), unit: "mL" },
  ];

  const rvGrade = rvFunctionGrade(rv?.RVEF);
  const ratio = rvLvRatio(rv?.RVEDV, lvVolumes?.LVEDV ?? measurements?.EDV);
  const sv = svBalance(lvVolumes?.LV_SV ?? measurements?.StrokeVolume, rv?.RV_SV);

  return (
    <div className="mx-auto max-w-5xl px-6 pb-16 pt-6">
      <header className="mb-5">
        <p className="text-xs text-muted-foreground">Cardiac Functional Analysis Report · Generated {generatedAt}</p>
        <h1 className="mt-1 text-[22px] font-extrabold text-foreground">Patient {patientLabel}</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{scanSummary}</p>
      </header>

      {/* Summary strip: measurements · health status · disease similarity.
          Health Status is the widest column — it now carries the metric table
          and the Regional Findings entry point. */}
      {/* Two columns, not three: Health Status carries the metric table AND
          the Regional Findings entry point, so it needs the width. Cardiac
          Measurements and Disease Similarity are both compact and stack in the
          left column instead of squeezing the table into a third of the row. */}
      <section className="mb-5 grid grid-cols-1 rounded-xl border border-border bg-card lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Explicit placement rather than reordering the JSX: Measurements and
            Disease stack in column 1, Health Status owns column 2 across both
            rows. Keeps the DOM order (and the print/screen-reader order)
            unchanged while giving the table the width it needs. */}
        <div className="border-b border-border p-4 lg:col-start-1 lg:row-start-1">
          <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Cardiac Measurements
          </p>
          <p className="mb-2 mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Left Ventricle
          </p>
          {/* 2×3 grid, sized to CONTENT. An earlier revision forced
              aspect-[1/0.92]; in a wide column that made each card ~270px tall
              with a dead gap in the middle. Icon and label now sit on one row
              with the value beneath, so the card is only as tall as it needs to
              be and the section balances against Health Status.
              ONE muted icon token for all six — the icon is wayfinding, not a
              category signal, so colour-coding it would imply meaning that
              isn't there. */}
          <div className="grid grid-cols-2 gap-2">
            {metricCards.map((m) => (
              <div key={m.label} className="rounded-lg border border-border px-2.5 py-2">
                <div className="flex items-start gap-1.5">
                  <Heart className="mt-[1px] h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="text-[10.5px] font-semibold leading-snug text-muted-foreground">
                    {m.label}
                  </span>
                </div>
                <span className={`mt-1 block text-[17px] font-bold leading-none tracking-tight ${
                  m.accent ? "text-primary" : "text-foreground"}`}>
                  {m.value}
                  <span className="ml-0.5 text-[10px] font-semibold text-muted-foreground">{m.unit}</span>
                </span>
              </div>
            ))}
          </div>

          {/* ── Right ventricle ────────────────────────────────────────────
              Same card style as the LV block. Volumes are shown RAW: there is
              no RV grading here, and RV volumes are not BSA-indexed. */}
          {hasRv && (
            <>
              <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Right Ventricle
              </p>
              <div className="grid grid-cols-2 gap-2">
                {rvCards.map((m) => (
                  <div key={m.label} className="rounded-lg border border-border px-2.5 py-2">
                    <div className="flex items-start gap-1.5">
                      <Heart className="mt-[1px] h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="text-[10.5px] font-semibold leading-snug text-muted-foreground">
                        {m.label}
                      </span>
                    </div>
                    <span className="mt-1 block text-[17px] font-bold leading-none tracking-tight text-foreground">
                      {m.value}
                      <span className="ml-0.5 text-[10px] font-semibold text-muted-foreground">{m.unit}</span>
                    </span>
                  </div>
                ))}
              </div>

              {/* ── Derived biventricular relationships ──────────────────────
                  Computed in the browser from stored LV + RV volumes; nothing
                  new is measured. Both are flags for review, not findings. */}
              {(ratio !== null || sv !== null) && (
                <>
                  <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Biventricular Relationship
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {ratio !== null && (
                      <div className={`rounded-lg border px-2.5 py-2 ${
                        ratio >= 1.0 ? "border-amber-500/50 bg-amber-500/10" : "border-primary/40 bg-primary/5"}`}>
                        <span className="text-[10.5px] font-semibold leading-snug text-muted-foreground">
                          RV:LV Volume Ratio (RV EDV ÷ LV EDV)
                        </span>
                        <span className="mt-1 block text-[17px] font-bold leading-none tracking-tight text-foreground">
                          {ratio.toFixed(2)}
                        </span>
                        <span className={`mt-1 block text-[9.5px] font-semibold leading-snug ${
                          ratio >= 1.0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                          {ratio >= 1.0 ? "RV enlarged relative to LV" : "RV smaller than LV"}
                        </span>
                      </div>
                    )}
                    {sv !== null && (
                      <div className={`rounded-lg border px-2.5 py-2 ${
                        sv.mismatch ? "border-amber-500/50 bg-amber-500/10" : "border-border"}`}>
                        <span className="text-[10.5px] font-semibold leading-snug text-muted-foreground">
                          SV Difference (RV SV − LV SV)
                        </span>
                        <span className="mt-1 block text-[17px] font-bold leading-none tracking-tight text-foreground">
                          {sv.diff > 0 ? "+" : ""}{sv.diff.toFixed(1)}
                          <span className="ml-0.5 text-[10px] font-semibold text-muted-foreground">mL</span>
                        </span>
                        <span className={`mt-1 block text-[9.5px] font-semibold leading-snug ${
                          sv.mismatch ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                          {sv.mismatch
                            ? `Large mismatch (${sv.relPct.toFixed(0)} %) — possible shunt, valve leak, or segmentation error`
                            : `Balanced (${sv.relPct.toFixed(0)} %)`}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <div className="border-b border-border p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-b-0 lg:border-l">
          <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Health Status
          </p>
          <div className="mb-2.5" />
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

              {/* ── Biventricular function ─────────────────────────────────
                  LV Function is the stored grade, shown verbatim. RV Function
                  is a SEPARATE advisory grade from RVEF — it is deliberately
                  rendered beside, never merged into, the badge above, which
                  remains LV-driven and byte-identical whether or not RV data
                  exists. "Biventricular", not "whole heart": the atria are not
                  segmented. */}
              {hasRv && (
                <div className="mb-3 rounded-lg border border-border bg-muted/30 p-2.5">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Biventricular Function
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="block text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                        LV Function
                      </span>
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        healthStatus.status === "Healthy" ? "bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
                        : healthStatus.status === "Mild" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : healthStatus.status === "Moderate" ? "bg-orange-500/10 text-orange-700 dark:text-orange-400"
                        : healthStatus.status === "Severe" ? "bg-red-600/10 text-red-700 dark:text-red-400"
                        : "bg-muted text-muted-foreground"}`}>
                        {healthStatus.status}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                        RV Function <span className="normal-case tracking-normal">· advisory</span>
                      </span>
                      <span
                        className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${RV_GRADE_BADGE[rvGrade]}`}
                        title="Approximate, non-sex-specific RVEF thresholds — must be clinically validated before use."
                      >
                        {rvGrade}
                      </span>
                    </div>
                  </div>

                  {sv !== null && (
                    <span className={`mt-2 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10.5px] font-medium ${
                      sv.mismatch
                        ? "border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        : "border-border bg-muted text-muted-foreground"}`}>
                      {sv.mismatch && <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />}
                      {sv.mismatch
                        ? `SV mismatch · Δ ${sv.diff > 0 ? "+" : ""}${sv.diff.toFixed(1)} mL`
                        : `SV balance acceptable · Δ ${sv.diff > 0 ? "+" : ""}${sv.diff.toFixed(1)} mL`}
                    </span>
                  )}

                  <p className="mt-2 text-[9.5px] leading-snug text-muted-foreground">
                    RV thresholds are approximate and not sex-specific — they must be clinically
                    validated before use. RV function does not affect the grade above.
                  </p>
                </div>
              )}

              {/* Metric table. There is deliberately NO "Reference Range"
                  column — the normal band is drawn ON each bar as a bold
                  outlined zone, putting the reference where the value is
                  instead of in a separate column of prose. */}
              {/* table-fixed + explicit widths: without them the Interpretation
                  column collapsed to one word per line. */}
              <table className="w-full table-fixed border-collapse">
                <thead>
                  <tr>
                    {([["Metric", "w-[29%]"], ["Result (this study)", "w-[43%]"], ["Interpretation", "w-[28%]"]] as const).map(([h, w]) => (
                      <th key={h} className={`${w} px-1 pb-1.5 text-left align-top text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRIC_BARS.map((m) => {
                    const v = measurements?.[m.key] ?? null;
                    const interp = interpretationFor(healthStatus, m.evidenceLabel);
                    return (
                      <tr key={m.key} className="border-t border-border/60">
                        <td className="px-1 py-2 align-top">
                          <span className="text-[11.5px] font-semibold leading-tight text-foreground">{m.name}</span>
                        </td>
                        <td className="px-1 py-2 align-top">
                          <span className="text-[13px] font-bold tabular-nums text-foreground">
                            {fmt(v)}<span className="ml-0.5 text-[10px] font-medium text-muted-foreground">{m.unit}</span>
                          </span>
                          {/* Zones: green = normal, amber = borderline, red =
                              far from normal. The normal band has no outline —
                              the green fill plus the "normal x–y" caption below
                              carry that reference, so an extra bold border only
                              competed with the value marker.
                              Outer wrapper is NOT clipped so the marker can
                              stand proud of the track; the zones live in an
                              inner clipped element to keep the rounded ends. */}
                          <div className="relative mt-3 h-2.5 w-full min-w-[120px] max-w-[190px]">
                            <div className="absolute inset-0 overflow-hidden rounded-full bg-muted">
                              {m.zones.map((z) => (
                                <div
                                  key={`${z.from}-${z.to}`}
                                  className={`absolute inset-y-0 ${ZONE_FILL[z.tone]}`}
                                  style={{
                                    left: `${pct(z.from, m.min, m.max)}%`,
                                    width: `${pct(z.to, m.min, m.max) - pct(z.from, m.min, m.max)}%`,
                                  }}
                                />
                              ))}
                            </div>
                            {v !== null && (
                              /* Full-height marker: overhangs the track top and
                                 bottom so the reading is findable at a glance,
                                 with a card-coloured ring to separate it from
                                 whichever zone sits underneath. */
                              <div
                                className="absolute top-1/2 h-[22px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-foreground ring-[1.5px] ring-card"
                                style={{ left: `${pct(v, m.min, m.max)}%` }}
                                title={`This study: ${fmt(v)} ${m.unit}`}
                              />
                            )}
                          </div>
                          <div className="mt-2 flex w-full min-w-[120px] max-w-[190px] justify-between text-[8.5px] tabular-nums text-muted-foreground">
                            <span>{m.min}</span>
                            <span className="text-foreground/70">normal {m.normal[0]}–{m.normal[1]}</span>
                            <span>{m.max}</span>
                          </div>
                        </td>
                        <td className="px-1 py-2 align-top">
                          {interp ? (
                            /* Short verdict only; the backend's full sentence is
                               the tooltip so nothing is lost. */
                            <span
                              title={interp.full}
                              className={`text-[11px] font-semibold leading-tight ${
                                interp.level === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
                            >
                              {interp.text}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* ── RV Health ───────────────────────────────────────────────
                  RVEF gets a reference bar in the same visual language as the
                  LV rows. RV VOLUMES are listed raw and ungraded: there is no
                  BSA indexing here, exactly as noted for LV EDV. No strain
                  grade — RV strain is exploratory and lives elsewhere. */}
              {hasRv && (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    RV Health · advisory
                  </p>
                  <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
                    <div>
                      <span className="text-[11.5px] font-semibold text-foreground">RV Ejection Fraction (RVEF)</span>
                      <span className="ml-2 text-[13px] font-bold tabular-nums text-foreground">
                        {fmt(rv?.RVEF)}<span className="ml-0.5 text-[10px] font-medium text-muted-foreground">%</span>
                      </span>
                      {/* Same zone language as the LV bars: green normal,
                          amber borderline, red far. Thresholds approximate. */}
                      <div className="relative mt-2 h-2.5 w-[150px]">
                        <div className="absolute inset-0 overflow-hidden rounded-full bg-muted">
                          {[
                            { from: 0, to: 30, tone: "red" as const },
                            { from: 30, to: 40, tone: "amber" as const },
                            { from: 40, to: 48, tone: "amber" as const },
                            { from: 48, to: 100, tone: "green" as const },
                          ].map((z) => (
                            <div
                              key={z.from}
                              className={`absolute inset-y-0 ${ZONE_FILL[z.tone]}`}
                              style={{ left: `${pct(z.from, 0, 100)}%`, width: `${pct(z.to, 0, 100) - pct(z.from, 0, 100)}%` }}
                            />
                          ))}
                        </div>
                        {rv?.RVEF != null && (
                          <div
                            className="absolute top-1/2 h-[22px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-[1.5px] ring-card"
                            style={{ left: `${pct(rv.RVEF, 0, 100)}%` }}
                            title={`RVEF ${fmt(rv.RVEF)} %`}
                          />
                        )}
                      </div>
                      <div className="mt-2 flex w-[150px] justify-between text-[8.5px] tabular-nums text-muted-foreground">
                        <span>0</span><span className="text-foreground/70">normal ≥ 48</span><span>100</span>
                      </div>
                    </div>
                    <div>
                      <span className="block text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Interpretation
                      </span>
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${RV_GRADE_BADGE[rvGrade]}`}>
                        {rvGrade}
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
                    RV EDV {fmt(rv?.RVEDV)} mL · RV ESV {fmt(rv?.RVESV)} mL · RV SV {fmt(rv?.RV_SV)} mL —
                    raw values, not BSA-indexed and not graded; body size is not accounted for.
                  </p>
                </div>
              )}

              {/* Any evidence line the table doesn't cover (e.g. "Absolute
                  volumes suppressed") still shows, so nothing the backend
                  reported is silently dropped. */}
              {healthStatus.evidence
                ?.filter((e) => !METRIC_BARS.some((m) => m.evidenceLabel === e.label))
                .map((e, i) => (
                  <div key={i} className="mt-2 flex items-start gap-1.5 text-xs">
                    {e.level === "ok"
                      ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />}
                    <span className={e.level === "ok" ? "text-foreground" : "text-amber-700 dark:text-amber-400"}>
                      <span className="font-medium">{e.label}:</span> {e.detail}
                    </span>
                  </div>
                ))}

              {/* ── Regional Findings (Layer 2) ─────────────────────────────
                  Interactive entry point into the strain card: each affected
                  segment is a button that selects it and scrolls to the charts.
                  Still advisory — the grade badge above is Layer 1 only. */}
              {regionalHealthStatus && (
                <div className="mt-3 border-t border-border pt-3" title={regionalHealthStatus.disclaimer}>
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold text-foreground">Regional Findings</h3>
                    <span className="rounded border border-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      Advisory
                    </span>
                  </div>

                  {hasFindings ? (
                    <>
                      <p className="mb-2 mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {showAllSegments ? "All Segments" : "Affected Segments"}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {findingIds.map((idx) => {
                          const lvl = levelOf(idx);
                          const isSel = selectedSeg === idx;
                          const quiet = lvl === "normal";
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); selectAndReveal(idx); }}
                              title={`Segment ${idx} — ${LEVEL_WORD[lvl] ?? lvl}`}
                              className={`min-w-[46px] rounded-lg border px-2 py-1.5 text-center transition-all hover:-translate-y-0.5 hover:shadow-sm ${
                                isSel ? "border-primary ring-2 ring-primary/30" : "border-border"
                              } ${quiet ? "bg-muted/40" : "bg-card"}`}
                            >
                              <span className={`block text-[15px] font-bold leading-none ${quiet ? "text-muted-foreground" : "text-foreground"}`}>
                                {idx}
                              </span>
                              <span className={`mt-1 block text-[9px] font-semibold leading-none ${
                                lvl === "severe" ? "text-red-700 dark:text-red-400"
                                : lvl === "moderate" ? "text-orange-700 dark:text-orange-400"
                                : lvl === "mild" ? "text-amber-700 dark:text-amber-400"
                                : "text-muted-foreground"}`}>
                                {LEVEL_WORD[lvl] ?? lvl}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">{regionalHealthStatus.summary}</p>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setShowAllSegments((v) => !v); }}
                        className="mt-1.5 text-[11px] font-medium text-primary hover:underline"
                      >
                        {showAllSegments ? "← Show affected only" : "View all segments →"}
                      </button>
                    </>
                  ) : (
                    /* status !== "ok", or no focal defect — keep the plain
                       advisory sentence rather than an empty button row. */
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {regionalOk
                        ? regionalHealthStatus.summary
                        : "Regional assessment unavailable for this model."}
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <EmptyState computing={computing} error={computeError} />
          )}
        </div>

        <div className="p-4 lg:col-start-1 lg:row-start-2">
          <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
            <Info className="h-3.5 w-3.5 text-primary" /> Disease Pattern Similarity
          </p>
          <p className="mb-3 mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            LV patterns
          </p>
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

          {/* RV patterns deliberately NOT modelled. The reference profiles
              (NOR/HCM/DCM) are LV-derived, so applying them to the RV would
              fabricate a classifier that doesn't exist. */}
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              RV patterns
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Not available — future work. The reference profiles are LV-derived; no RV
              classifier exists in this pipeline.
            </p>
          </div>
        </div>
      </section>

      {/* Regional strain: bullseye linked to the full-cycle curves */}
      <Card
        title="LV Regional Strain Analysis"
        subtitle="LV AHA 17-segment strain. Click a segment — here, on a curve, or in Regional Findings — to focus it; click empty chart space to reset."
        icon={<Heart className="h-4 w-4 text-primary" />}
        sectionRef={strainCardRef}
        highlight={pulse}
        action={hasStrainData ? (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {/* Explicit reset. Clicking empty chart space also clears the
                selection, but that's undiscoverable — this makes the exit
                obvious. Only rendered while something IS selected, so it never
                sits there as a dead control. */}
            {selectedSeg !== null && (
              <button
                type="button"
                onClick={() => setSelectedSeg(null)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Clear the selected segment"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
            )}
            <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
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
          </div>
        ) : undefined}
      >
        {!hasStrainData ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No strain computed for this model yet — run strain from the Landmark Detection page.
          </p>
        ) : (
          <>

            {/* Selected-segment info — ABOVE the charts so the finding you
                clicked is the first thing you land on. Absent (not a
                placeholder) when nothing is selected; the findings buttons
                already advertise what's clickable. Animated height/opacity so
                the charts reflowing downward reads as intentional. */}
            <div
              className={`overflow-hidden transition-all duration-200 ${
                selectedInfo ? "mb-4 max-h-40 opacity-100" : "mb-0 max-h-0 opacity-0"
              }`}
              aria-live="polite"
            >
              {selectedInfo && (
                <div
                  className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-border bg-muted/40 px-4 py-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[17px] font-bold text-[#0b1220]"
                    style={{ background: strainColor(strainType === "GCS" ? selectedInfo.gcs : selectedInfo.grs, strainType) }}
                  >
                    {selectedInfo.idx}
                  </span>
                  <div className="min-w-[150px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-foreground">{selectedInfo.label}</span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {selectedInfo.region} ring
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Peak values measured end-diastole → end-systole.
                    </p>
                  </div>
                  <div className="flex items-center gap-5">
                    <div className="text-right">
                      <span className="block text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">Peak GCS</span>
                      <span className="text-[15px] font-bold tabular-nums text-foreground">{fmt(selectedInfo.gcs)}%</span>
                    </div>
                    <div className="text-right">
                      <span className="block text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">Peak GRS</span>
                      <span className="text-[15px] font-bold tabular-nums text-foreground">{fmt(selectedInfo.grs)}%</span>
                    </div>
                    {selectedInfo.level && (
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${LEVEL_BADGE[selectedInfo.level] ?? "bg-muted text-muted-foreground"}`}>
                        {LEVEL_WORD[selectedInfo.level] ?? selectedInfo.level}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Clicking anywhere in the chart area that isn't a wedge, a curve
                or a control clears the selection. */}
            <div
              className="grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]"
              onClick={() => setSelectedSeg(null)}
            >
              <div>
                <div className="mb-1 text-center">
                  <span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                    {hoverFrame == null
                      ? (defaultFrame != null ? `Peak · Frame ${defaultFrame}` : "Peak")
                      : `Frame ${activeFrame}`}
                  </span>
                </div>
                <Bullseye
                  values={bullseyeValues}
                  strainType={strainType}
                  selectedSegment={selectedSeg}
                  onSegmentClick={setSelectedSeg}
                  onSegmentHover={setHoverSeg}
                />
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
                        onMouseMove={(e: { activeLabel?: string | number }) => {
                          if (e?.activeLabel !== undefined) setHoverFrame(Number(e.activeLabel));
                        }}
                        onMouseLeave={() => setHoverFrame(null)}
                      >
                        <CartesianGrid stroke="var(--border)" strokeOpacity={0.4} />
                        <XAxis dataKey="frame" tick={{ fontSize: 11 }} label={{ value: "Cardiac frame", position: "insideBottom", offset: -2, fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} label={{ value: "Strain (%)", angle: -90, position: "insideLeft", fontSize: 11 }} />
                        <ReferenceLine y={0} stroke="var(--border)" />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                        {/* Invisible wide hit-lines. A 1.4px stroke is almost
                            impossible to click; these give each curve a ~14px
                            target without changing what's drawn. Rendered
                            first so the visible lines paint over them. */}
                        {segmentLabels.map((s) => (
                          <Line
                            key={`hit-${s.segment}`}
                            dataKey={`s${s.segment}`}
                            stroke="transparent"
                            strokeWidth={14}
                            dot={false}
                            activeDot={false}
                            isAnimationActive={false}
                            legendType="none"
                            style={{ cursor: "pointer" }}
                            onClick={() => setSelectedSeg(s.segment)}
                            onMouseEnter={() => setHoverSeg(s.segment)}
                            onMouseLeave={() => setHoverSeg(null)}
                          />
                        ))}

                        {/* Emphasis precedence: a click PERSISTS, hover only
                            previews — so selection wins over hoverSeg. Selected
                            segment is rendered last so it draws on top. */}
                        {[...segmentLabels]
                          .sort((a, b) => (a.segment === emphasisSeg ? 1 : b.segment === emphasisSeg ? -1 : 0))
                          .map((s) => {
                            const isOn = emphasisSeg === s.segment;
                            const dimmed = emphasisSeg != null && !isOn;
                            return (
                              <Line
                                key={s.segment}
                                dataKey={`s${s.segment}`}
                                name={s.label}
                                stroke={RING_COLOR_VAR[RING_OF(s.segment)]}
                                strokeWidth={isOn ? 3 : 1.4}
                                dot={false}
                                opacity={dimmed ? 0.12 : 1}
                                isAnimationActive={false}
                                style={{ cursor: "pointer" }}
                                onClick={() => setSelectedSeg(s.segment)}
                              />
                            );
                          })}
                      </LineChart>
                    </ResponsiveContainer>
                    {/* Legend is now per RING (4 entries), matching the curve
                        colours. Individual segments are identified by their
                        number on the bullseye and by the info box. */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                      {(["basal", "mid", "apical", "apex"] as const).map((r) => (
                        <span key={r} className="flex items-center gap-1.5 text-[10.5px] capitalize text-muted-foreground">
                          <span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: RING_COLOR_VAR[r] }} />
                          {r}
                        </span>
                      ))}
                      <span className="text-[10.5px] text-muted-foreground/70">· click a curve or wedge to focus</span>
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

      {/* ── RV Regional Findings — DISPLAY ONLY ─────────────────────────────
          Renders `rvStrain` if the backend ever writes it. Nothing here
          computes strain: the producing module (compute_rv_strain_from_rle.py)
          is backend-owned and does not exist yet, so today this always shows
          the pending state.

          It feeds NO grade, and by construction never will — the measure is a
          geometric contour-length proxy, circumferential rather than the
          validated longitudinal one, taken from short-axis slices. Exploratory. */}
      <Card
        title="RV Regional Findings"
        subtitle="Exploratory · RV circumferential strain (RV GCS), short-axis · advisory"
        icon={<Heart className="h-4 w-4 text-primary" />}
        action={
          <span className="rounded border border-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Advisory
          </span>
        }
      >
        {!rvStrain?.regions?.length ? (
          <p className="py-5 text-center text-sm text-muted-foreground">
            No RV regional strain computed for this model yet — run RV strain from the
            Landmark Detection page.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[300px_1fr]">
            {/* Same chart the landmark page draws RV strain with — 2 rings
                (basal, mid) x 3 free-wall sectors. Reused rather than
                reimplemented so the two views can never disagree. */}
            <div onClick={(e) => e.stopPropagation()}>
              <RvStrainChart
                regions={rvStrain.regions}
                selectedRegion={selectedRvRegion}
                onRegionClick={(r) => setSelectedRvRegion((cur) => (cur === r ? null : r))}
              />
            </div>

            <div>
              <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                <div>
                  <span className="block text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Global RV Strain
                  </span>
                  <span className="text-[19px] font-bold tabular-nums text-foreground">
                    {fmt(rvStrain.global_rv_strain)}
                    <span className="ml-0.5 text-[11px] font-semibold text-muted-foreground">%</span>
                  </span>
                </div>
                {rvStrain.edFrameIndex != null && rvStrain.esFrameIndex != null && (
                  <div>
                    <span className="block text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Frames
                    </span>
                    <span className="text-[13px] font-semibold tabular-nums text-foreground">
                      ED {rvStrain.edFrameIndex} → ES {rvStrain.esFrameIndex}
                    </span>
                  </div>
                )}
              </div>

              {/* Per region. Deliberately NO severity colouring: this measure
                  has no validated cutoff, so tinting it would imply one. */}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {rvStrain.regions.map((r) => (
                  <button
                    key={r.region}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedRvRegion((cur) => (cur === r.region ? null : r.region));
                    }}
                    className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      selectedRvRegion === r.region
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-border hover:bg-muted/50"}`}
                  >
                    <span className="block text-[9.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {r.label}
                    </span>
                    <span className="mt-1 block text-[15px] font-bold tabular-nums text-foreground">
                      {fmt(r.strain)}
                      <span className="ml-0.5 text-[10px] font-semibold text-muted-foreground">%</span>
                    </span>
                  </button>
                ))}
              </div>

              <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
                <span className="font-semibold text-foreground">Exploratory only.</span>{" "}
                RV strain here is the percentage change in RV cavity boundary radius between
                end-diastole and end-systole — not a wall-thickness measure like the LV&apos;s
                GRS/GCS, and not the validated longitudinal RV measure. Negative values
                indicate the cavity shrinking (the healthy direction). No severity threshold
                is applied and this does not contribute to any health-status grade.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Clinical Research Assistant — grounded, cited literature answers for
          this report. Patient measurements are passed as read-only context so
          "Explain these results" is specific to this scan. The panel shows a
          clear notice if the assistant service isn't running. */}
      <section className="mt-6">
        <CardiacResearchAssistant
          storageKey={patientLabel}
          patientContext={buildPatientContext({
            EF: measurements?.EF,
            EDV: measurements?.EDV,
            ESV: measurements?.ESV,
            StrokeVolume: measurements?.StrokeVolume,
            PeakGRS: measurements?.PeakGRS,
            PeakGCS: measurements?.PeakGCS,
            mostSimilarPattern: similarity?.most_similar,
          })}
        />
      </section>

      <p className="mt-6 text-center text-[11.5px] text-muted-foreground">
        Generated for clinical decision support only. Health Status is a rule-based assessment and
        Disease Pattern Similarity is a similarity comparison — neither is a diagnosis. Final
        interpretation remains the responsibility of the treating clinician.
      </p>
    </div>
  );
}
