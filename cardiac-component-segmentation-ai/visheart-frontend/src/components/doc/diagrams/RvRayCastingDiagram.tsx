import type { ReactNode } from "react";
import {
  LABEL_CLASS,
  MUTED_LABEL_CLASS,
  RV_SECTION_COLORS,
  polar,
  polyline,
  range,
  type Point,
} from "@/components/doc/diagrams/geometry";

// Schematic short-axis slice (standard display: anterior at the top, RV on the
// left) showing how bullseye_analysis.ray_cast_rv_hits / rv_arc_sections /
// rv_section_measures work. Rays are drawn every 4° here; the real method uses
// 360 rays, one per degree.
const C: Point = { x: 330, y: 190 };
const LV_OUT = 78;
const LV_IN = 56;
const RV_IN = 81; // septal-side border of the RV cavity, just outside the LV wall
const TH_A = 112; // inferior insertion (bottom end of the RV arc)
const TH_B = 248; // anterior insertion (top end)
const RV_WIDTH = 70;
const SECTION = (TH_B - TH_A) / 3;
const RAY_STEP = 4;
const END_RAYS = 2; // drawn rays per end that stand for the trimmed 5 % (≥ 5 rays) of the arc

const rvOuter = (deg: number) => {
  const t = (deg - TH_A) / (TH_B - TH_A);
  return RV_IN + RV_WIDTH * Math.pow(Math.sin(Math.PI * t), 0.75);
};
const sectionOf = (deg: number) => Math.min(2, Math.floor((deg - TH_A) / SECTION));

const RAYS = range(RAY_STEP / 2, 360 - RAY_STEP / 2, RAY_STEP);
const HIT_RAYS = RAYS.filter((a) => a > TH_A && a < TH_B);
const isEndRay = (a: number) => {
  const i = HIT_RAYS.indexOf(a);
  return i < END_RAYS || i >= HIT_RAYS.length - END_RAYS;
};
const USED_RAYS = HIT_RAYS.filter((a) => !isEndRay(a));

function rvSectionPath(a0: number, a1: number): string {
  const steps = Math.max(1, Math.ceil(a1 - a0));
  const angles = Array.from({ length: steps + 1 }, (_, i) => a0 + ((a1 - a0) * i) / steps);
  const outer = angles.map((a) => polar(C, rvOuter(a), a));
  const inner = [...angles].reverse().map((a) => polar(C, RV_IN, a));
  return `${polyline([...outer, ...inner])} Z`;
}

const halo = { paintOrder: "stroke" as const, strokeWidth: 3.5, strokeLinejoin: "round" as const };

export function RvRayCastingDiagram({ title }: { title: string }) {
  const anterior = polar(C, RV_IN, TH_B);
  const inferior = polar(C, RV_IN, TH_A);

  return (
    <div>
      <svg viewBox="104 62 404 250" role="img" aria-label={title} className="mx-auto block h-auto w-full max-w-[560px]">
        {/* RV cavity, shaded by section (the area each section's GAS uses). */}
        {[0, 1, 2].map((s) => (
          <path
            key={s}
            d={rvSectionPath(TH_A + s * SECTION, TH_A + (s + 1) * SECTION)}
            fill={RV_SECTION_COLORS[s]}
            fillOpacity={0.16}
          />
        ))}
        <path d={rvSectionPath(TH_A, TH_B)} fill="none" className="stroke-muted-foreground" strokeWidth={1} />

        {/* LV cavity and wall. */}
        <circle cx={C.x} cy={C.y} r={LV_IN} className="fill-muted" />
        <circle cx={C.x} cy={C.y} r={(LV_IN + LV_OUT) / 2} fill="none" stroke="#94a3b8" strokeOpacity={0.55} strokeWidth={LV_OUT - LV_IN} />

        {/* Rays that miss the RV: ignored. */}
        {RAYS.filter((a) => !HIT_RAYS.includes(a)).map((a) => {
          const p0 = polar(C, 6, a);
          const p1 = polar(C, 104, a);
          return (
            <line key={a} x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} className="stroke-muted-foreground" strokeOpacity={0.3} strokeWidth={0.8} />
          );
        })}

        {/* Rays that cross the RV, coloured by section; the arc's end rays are dashed. */}
        {HIT_RAYS.map((a) => {
          const p0 = polar(C, 6, a);
          const p1 = polar(C, rvOuter(a) + 9, a);
          return (
            <line
              key={a}
              x1={p0.x}
              y1={p0.y}
              x2={p1.x}
              y2={p1.y}
              stroke={RV_SECTION_COLORS[sectionOf(a)]}
              strokeOpacity={0.7}
              strokeWidth={1}
              strokeDasharray={isEndRay(a) ? "3 2.5" : undefined}
            />
          );
        })}

        {/* Septal-side border: joined entry points (septal GCS, one per ring). */}
        <path
          d={polyline(USED_RAYS.map((a) => polar(C, RV_IN, a)))}
          fill="none"
          className="stroke-foreground"
          strokeOpacity={0.7}
          strokeWidth={1.4}
          strokeDasharray="4 3"
        />

        {/* Free-wall border: joined exit points, per section (free-wall GCS). */}
        {[0, 1, 2].map((s) => (
          <path
            key={s}
            d={polyline(USED_RAYS.filter((a) => sectionOf(a) === s).map((a) => polar(C, rvOuter(a), a)))}
            fill="none"
            stroke={RV_SECTION_COLORS[s]}
            strokeWidth={2.4}
            strokeLinecap="round"
          />
        ))}

        {/* Entry (hollow) and exit (filled) points on every used ray. */}
        {USED_RAYS.map((a) => {
          const pin = polar(C, RV_IN, a);
          const pout = polar(C, rvOuter(a), a);
          const color = RV_SECTION_COLORS[sectionOf(a)];
          return (
            <g key={a}>
              <circle cx={pin.x} cy={pin.y} r={2.1} className="fill-background" stroke={color} strokeWidth={1.2} />
              <circle cx={pout.x} cy={pout.y} r={2.3} fill={color} />
            </g>
          );
        })}

        {/* LV centre: every ray starts here. */}
        <circle cx={C.x} cy={C.y} r={3.5} className="fill-foreground" />
        <text x={C.x} y={C.y + 19} textAnchor="middle" fontSize={10.5} fontWeight={600} className={`${LABEL_CLASS} stroke-muted`} style={halo}>
          LV centre
        </text>
        <text x={C.x + LV_OUT + 8} y={C.y - 3} fontSize={10.5} fontWeight={600} className={`${LABEL_CLASS} stroke-background`} style={halo}>
          LV wall
        </text>
        <text x={C.x + LV_OUT + 8} y={C.y + 11} fontSize={9.5} className={`${MUTED_LABEL_CLASS} stroke-background`} style={halo}>
          (myocardium)
        </text>
        <text x={C.x - 115} y={C.y + 4} textAnchor="middle" fontSize={12} fontWeight={700} className={`${LABEL_CLASS} stroke-background`} style={halo}>
          RV
        </text>

        {/* Insertion points: the two ends of the RV arc. */}
        {[
          { p: anterior, label: "Anterior insertion", dy: -10 },
          { p: inferior, label: "Inferior insertion", dy: 21 },
        ].map(({ p, label, dy }) => (
          <g key={label}>
            <rect x={p.x - 3.5} y={p.y - 3.5} width={7} height={7} transform={`rotate(45 ${p.x} ${p.y})`} className="fill-foreground" />
            <text x={p.x + 14} y={p.y + dy} fontSize={10.5} fontWeight={600} className={`${LABEL_CLASS} stroke-background`} style={halo}>
              {label}
            </text>
          </g>
        ))}

        {/* Section labels, outside the free wall. */}
        {(["Seg 1 (inferior)", "Seg 2", "Seg 3 (anterior)"] as const).map((label, s) => {
          const mid = TH_A + (s + 0.5) * SECTION;
          const p = polar(C, rvOuter(mid) + 20, mid);
          return (
            <text
              key={label}
              x={p.x}
              y={p.y + 4}
              textAnchor="end"
              fontSize={11}
              fontWeight={700}
              fill={RV_SECTION_COLORS[s]}
              className="stroke-background"
              style={halo}
            >
              {label}
            </text>
          );
        })}
      </svg>

      <ul className="text-muted-foreground mx-auto mt-3 grid max-w-[560px] gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        <LegendItem swatch={<circle cx={9} cy={6} r={3.2} className="fill-background" stroke={RV_SECTION_COLORS[1]} strokeWidth={1.4} />}>
          Septal-side point: where the ray enters the RV
        </LegendItem>
        <LegendItem swatch={<circle cx={9} cy={6} r={3.4} fill={RV_SECTION_COLORS[1]} />}>
          Free-wall point: where the ray leaves the RV
        </LegendItem>
        <LegendItem swatch={<line x1={1} y1={6} x2={17} y2={6} stroke={RV_SECTION_COLORS[1]} strokeWidth={2.4} />}>
          Free-wall length of a section (RV GCS)
        </LegendItem>
        <LegendItem
          swatch={<line x1={1} y1={6} x2={17} y2={6} className="stroke-foreground" strokeWidth={1.4} strokeDasharray="4 3" />}
        >
          Septal-side length (RV septal GCS)
        </LegendItem>
        <LegendItem swatch={<line x1={1} y1={6} x2={17} y2={6} className="stroke-muted-foreground" strokeOpacity={0.6} />}>
          Ray that misses the RV: ignored
        </LegendItem>
        <LegendItem
          swatch={<line x1={1} y1={6} x2={17} y2={6} stroke={RV_SECTION_COLORS[2]} strokeDasharray="3 2.5" strokeWidth={1.2} />}
        >
          End ray of the arc: left out of the lengths
        </LegendItem>
        <LegendItem swatch={<rect x={1} y={0.5} width={16} height={11} rx={2} fill={RV_SECTION_COLORS[0]} fillOpacity={0.25} />}>
          Shaded wedge: RV cavity area of a section (RV GAS)
        </LegendItem>
      </ul>
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
