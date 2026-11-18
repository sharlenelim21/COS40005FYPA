import type { ReactNode } from "react";
import { SEGMENT_LABELS } from "@/lib/ahaSegments";
import {
  LABEL_CLASS,
  MUTED_LABEL_CLASS,
  annularSector,
  polar,
  polyline,
  range,
  type Point,
} from "@/components/doc/diagrams/geometry";

// Schematic basal short-axis slice (standard display: anterior at the top,
// septum and RV on the left) showing bullseye_analysis.mask_to_17_segments:
// rays from the LV-cavity centre, the first ray 60° before the anterior RV
// insertion point, six 60° sectors, and the inner / mid / outer border points
// used for wall thickness (GRS) and border length (GCS).
const C: Point = { x: 300, y: 200 };
const LV_IN = 64;
const LV_OUT = 92;
const LV_MID = (LV_IN + LV_OUT) / 2;
const INSERTION = 248; // anterior RV insertion, screen angle
// In the standard display the rays run anticlockwise on screen (decreasing
// angle): first ray at insertion + 60°, segment 1 = the 60° that ends at the
// insertion point, then 2 and 3 across the septum.
const FIRST_RAY = INSERTION + 60;
const SEGMENT_START = (k: number) => FIRST_RAY - 60 * k; // segment k (1..6) spans [start, start + 60]

const FIRST_RAY_COLOR = "#d97706";
const BORDER_COLORS = { outer: "#2563eb", mid: "#7c3aed", inner: "#0d9488" } as const;
const EXAMPLE_RAYS = [12, 18, 24];

const halo = { paintOrder: "stroke" as const, strokeWidth: 3.5, strokeLinejoin: "round" as const };

function rvCrescentPath(): string {
  const a0 = 112;
  const a1 = 248;
  const inner = 94;
  const outer = (a: number) => inner + 52 * Math.pow(Math.sin((Math.PI * (a - a0)) / (a1 - a0)), 0.75);
  const angles = range(a0, a1, 2);
  return `${polyline([...angles.map((a) => polar(C, outer(a), a)), ...[...angles].reverse().map((a) => polar(C, inner, a))])} Z`;
}

/** Arrowhead at `tip`, pointing along the anticlockwise (decreasing-angle) tangent at `angleDeg`. */
function arrowHead(tip: Point, angleDeg: number): string {
  const a = (angleDeg * Math.PI) / 180;
  const dir = { x: Math.sin(a), y: -Math.cos(a) };
  const normal = { x: -dir.y, y: dir.x };
  const base = { x: tip.x - 8 * dir.x, y: tip.y - 8 * dir.y };
  const p1 = { x: base.x + 4 * normal.x, y: base.y + 4 * normal.y };
  const p2 = { x: base.x - 4 * normal.x, y: base.y - 4 * normal.y };
  return `M ${tip.x} ${tip.y} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y} Z`;
}

export function LvRayCastingDiagram({ title }: { title: string }) {
  const insertion = polar(C, LV_OUT + 1, INSERTION);
  const firstRayEnd = polar(C, 120, FIRST_RAY);
  const sweepFrom = polar(C, 112, FIRST_RAY - 6);
  const sweepTo = polar(C, 112, INSERTION + 10);
  const angleArcFrom = polar(C, 38, FIRST_RAY);
  const angleArcTo = polar(C, 38, INSERTION);
  const angleLabel = polar(C, 50, INSERTION + 30);
  const thicknessLabel = polar(C, 104, 16);

  return (
    <div>
      <svg viewBox="100 52 420 290" role="img" aria-label={title} className="mx-auto block h-auto w-full max-w-[560px]">
        {/* RV, for context only. */}
        <path d={rvCrescentPath()} className="fill-muted stroke-border" />
        <text x={C.x - 120} y={C.y + 4} textAnchor="middle" fontSize={11} fontWeight={700} className={MUTED_LABEL_CLASS}>
          RV
        </text>

        {/* LV cavity and the six wall sectors. */}
        <circle cx={C.x} cy={C.y} r={LV_IN} className="fill-muted" fillOpacity={0.6} />
        {[1, 2, 3, 4, 5, 6].map((k) => (
          <path
            key={k}
            d={annularSector(C, LV_IN, LV_OUT, SEGMENT_START(k), SEGMENT_START(k) + 60)}
            fill="#64748b"
            fillOpacity={k % 2 ? 0.16 : 0.3}
            className="stroke-background"
            strokeWidth={1}
          />
        ))}

        {/* 360 rays (every 6th drawn). */}
        {range(0, 354, 6).map((a) => {
          const p0 = polar(C, 6, a);
          const p1 = polar(C, 104, a);
          return <line key={a} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} className="stroke-muted-foreground" strokeOpacity={0.22} strokeWidth={0.8} />;
        })}

        {/* Sector borders. */}
        {[2, 3, 4, 5, 6].map((k) => {
          const a = SEGMENT_START(k) + 60;
          const p1 = polar(C, LV_OUT + 8, a);
          return <line key={k} x1={C.x} y1={C.y} x2={p1.x} y2={p1.y} className="stroke-foreground" strokeOpacity={0.45} strokeWidth={1} />;
        })}

        {/* Segment numbers. */}
        {[1, 2, 3, 4, 5, 6].map((k) => {
          const p = polar(C, LV_MID, SEGMENT_START(k) + 30);
          return (
            <text key={k} x={p.x} y={p.y + 4} textAnchor="middle" fontSize={12} fontWeight={700} className={LABEL_CLASS}>
              {k}
            </text>
          );
        })}

        {/* First ray, the 60° to the insertion point, and the sweep direction. */}
        <line x1={C.x} y1={C.y} x2={firstRayEnd.x} y2={firstRayEnd.y} stroke={FIRST_RAY_COLOR} strokeWidth={2.2} />
        <path
          d={`M ${angleArcFrom.x} ${angleArcFrom.y} A 38 38 0 0 0 ${angleArcTo.x} ${angleArcTo.y}`}
          fill="none"
          stroke={FIRST_RAY_COLOR}
          strokeWidth={1.3}
        />
        <line
          x1={C.x}
          y1={C.y}
          x2={insertion.x}
          y2={insertion.y}
          stroke={FIRST_RAY_COLOR}
          strokeWidth={1.3}
          strokeDasharray="3 2.5"
        />
        <text x={angleLabel.x} y={angleLabel.y + 4} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={FIRST_RAY_COLOR} className="stroke-muted" style={halo}>
          60°
        </text>
        <path d={`M ${sweepFrom.x} ${sweepFrom.y} A 112 112 0 0 0 ${sweepTo.x} ${sweepTo.y}`} fill="none" stroke={FIRST_RAY_COLOR} strokeWidth={1.6} />
        <path d={arrowHead(sweepTo, INSERTION + 10)} fill={FIRST_RAY_COLOR} />
        <text x={firstRayEnd.x + 6} y={firstRayEnd.y - 4} fontSize={10.5} fontWeight={700} fill={FIRST_RAY_COLOR} className="stroke-background" style={halo}>
          First ray
        </text>
        <text x={firstRayEnd.x + 6} y={firstRayEnd.y + 9} fontSize={9.5} className={`${MUTED_LABEL_CLASS} stroke-background`} style={halo}>
          60° before the insertion
        </text>

        {/* Anterior RV insertion point. */}
        <rect
          x={insertion.x - 4}
          y={insertion.y - 4}
          width={8}
          height={8}
          transform={`rotate(45 ${insertion.x} ${insertion.y})`}
          className="fill-foreground"
        />
        <text x={insertion.x - 10} y={insertion.y - 10} textAnchor="end" fontSize={10.5} fontWeight={600} className={`${LABEL_CLASS} stroke-background`} style={halo}>
          Anterior RV insertion
        </text>

        {/* Example rays: inner, mid-wall and outer border points, joined ray to ray. */}
        {(["outer", "mid", "inner"] as const).map((border) => {
          const r = border === "outer" ? LV_OUT : border === "mid" ? LV_MID : LV_IN;
          return (
            <path
              key={border}
              d={polyline(EXAMPLE_RAYS.map((a) => polar(C, r, a)))}
              fill="none"
              stroke={BORDER_COLORS[border]}
              strokeWidth={2.2}
              strokeLinecap="round"
            />
          );
        })}
        {EXAMPLE_RAYS.map((a) => {
          const p0 = polar(C, LV_IN, a);
          const p1 = polar(C, LV_OUT, a);
          const pm = polar(C, LV_MID, a);
          return (
            <g key={a}>
              <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} className="stroke-foreground" strokeWidth={1} />
              <circle cx={p0.x} cy={p0.y} r={2.6} fill={BORDER_COLORS.inner} />
              <circle cx={pm.x} cy={pm.y} r={2.2} fill={BORDER_COLORS.mid} />
              <circle cx={p1.x} cy={p1.y} r={2.6} fill={BORDER_COLORS.outer} />
            </g>
          );
        })}
        <text x={thicknessLabel.x} y={thicknessLabel.y + 4} fontSize={10} fontWeight={600} className={`${LABEL_CLASS} stroke-background`} style={halo}>
          wall thickness
        </text>
        <text x={thicknessLabel.x} y={thicknessLabel.y + 16} fontSize={9.5} className={`${MUTED_LABEL_CLASS} stroke-background`} style={halo}>
          (inner → outer, per ray)
        </text>

        <circle cx={C.x} cy={C.y} r={3.5} className="fill-foreground" />

        {/* Directions. */}
        <text x={C.x} y={70} textAnchor="middle" fontSize={12} fontWeight={700} className={LABEL_CLASS}>
          Anterior
        </text>
        <text x={C.x} y={C.y + 132} textAnchor="middle" fontSize={12} fontWeight={700} className={LABEL_CLASS}>
          Inferior
        </text>
        <text x={C.x - 154} y={C.y + 4} textAnchor="end" fontSize={12} fontWeight={700} className={LABEL_CLASS}>
          Septal
        </text>
        <text x={C.x + LV_OUT + 22} y={C.y - 16} fontSize={12} fontWeight={700} className={LABEL_CLASS}>
          Lateral
        </text>
      </svg>

      <ul className="text-muted-foreground mx-auto mt-3 grid max-w-[560px] gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        <LegendItem swatch={<line x1={1} y1={6} x2={17} y2={6} stroke={FIRST_RAY_COLOR} strokeWidth={2.2} />}>
          First ray: 60° before the anterior RV insertion (75° on apical slices)
        </LegendItem>
        <LegendItem swatch={<line x1={1} y1={6} x2={17} y2={6} className="stroke-muted-foreground" strokeOpacity={0.6} />}>
          360 rays, one per degree (every 6th drawn), all from the LV-cavity centre
        </LegendItem>
        <LegendItem swatch={<line x1={1} y1={6} x2={17} y2={6} stroke={BORDER_COLORS.outer} strokeWidth={2.2} />}>
          Outer border (epicardium)
        </LegendItem>
        <LegendItem swatch={<line x1={1} y1={6} x2={17} y2={6} stroke={BORDER_COLORS.mid} strokeWidth={2.2} />}>
          Mid-wall line (halfway between the borders)
        </LegendItem>
        <LegendItem swatch={<line x1={1} y1={6} x2={17} y2={6} stroke={BORDER_COLORS.inner} strokeWidth={2.2} />}>
          Inner border (endocardium)
        </LegendItem>
      </ul>
      <p className="text-muted-foreground mx-auto mt-2 max-w-[560px] text-center text-xs">
        {SEGMENT_LABELS.slice(0, 6)
          .map((label, i) => `${i + 1} ${label}`)
          .join(" · ")}
      </p>
    </div>
  );
}

function LegendItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <svg width={18} height={12} viewBox="0 0 18 12" aria-hidden="true" className="shrink-0">
        {swatch}
      </svg>
      <span>{children}</span>
    </li>
  );
}
