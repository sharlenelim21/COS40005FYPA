import { LABEL_CLASS, MUTED_LABEL_CLASS, RV_SECTION_COLORS, annularSector, polar } from "@/components/doc/diagrams/geometry";

// Same crescent geometry as the Strain tab's bullseye (CombinedVentricularChart):
// the RV wraps the septal (left) side of the LV from 100° to 260°, the apical
// ring touches the LV and the basal ring is outermost, Seg 1 is the inferior
// (bottom) end and Seg 3 the anterior (top) end.
const C = { x: 250, y: 178 };
const LV_R = 84;
const SPAN_START = 100;
const SPAN_END = 260;
const SECTOR = (SPAN_END - SPAN_START) / 3;

const RINGS = [
  { name: "Basal", inner: 120, outer: 142, opacity: 0.62, first: 1 },
  { name: "Mid", inner: 100, outer: 120, opacity: 0.44, first: 4 },
  { name: "Apical", inner: LV_R, outer: 100, opacity: 0.28, first: 7 },
] as const;

const SECTION_NAMES = ["Seg 1 · inferior", "Seg 2", "Seg 3 · anterior"] as const;

const halo = { paintOrder: "stroke" as const, strokeWidth: 3, strokeLinejoin: "round" as const };

export function RvNineSegmentDiagram({ title }: { title: string }) {
  return (
    <div>
      <svg viewBox="40 0 400 350" role="img" aria-label={title} className="mx-auto block h-auto w-full max-w-[460px]">
        {/* LV: the 17-segment bullseye, drawn faintly for context only. */}
        <circle cx={C.x} cy={C.y} r={LV_R} className="fill-muted stroke-border" strokeWidth={1.5} />
        <text x={C.x + 14} y={C.y - 2} textAnchor="middle" fontSize={15} fontWeight={700} className={LABEL_CLASS}>
          LV
        </text>
        <text x={C.x + 14} y={C.y + 14} textAnchor="middle" fontSize={10} className={MUTED_LABEL_CLASS}>
          17 AHA segments
        </text>
        <text x={C.x - LV_R + 8} y={C.y + 4} fontSize={10} fontStyle="italic" className={MUTED_LABEL_CLASS}>
          septum
        </text>

        {/* RV: 3 rings x 3 sections. */}
        {RINGS.map((ring) =>
          [0, 1, 2].map((s) => {
            const start = SPAN_START + s * SECTOR;
            const mid = polar(C, (ring.inner + ring.outer) / 2, start + SECTOR / 2);
            return (
              <g key={`${ring.name}-${s}`}>
                <path
                  d={annularSector(C, ring.inner, ring.outer, start, start + SECTOR)}
                  fill={RV_SECTION_COLORS[s]}
                  fillOpacity={ring.opacity}
                  className="stroke-background"
                  strokeWidth={1.5}
                />
                <text
                  x={mid.x}
                  y={mid.y + 3.5}
                  textAnchor="middle"
                  fontSize={ring.name === "Apical" ? 9.5 : 10.5}
                  fontWeight={700}
                  className={LABEL_CLASS}
                >
                  R{ring.first + s}
                </text>
              </g>
            );
          }),
        )}

        {/* Directions (LV-relative, as on the Strain tab) and the RV arc's two ends. */}
        <text x={C.x} y={22} textAnchor="middle" fontSize={12} fontWeight={700} className={LABEL_CLASS}>
          Anterior
        </text>
        <text x={C.x} y={C.y + 165} textAnchor="middle" fontSize={12} fontWeight={700} className={LABEL_CLASS}>
          Inferior
        </text>
        <text x={C.x + LV_R + 12} y={C.y + 4} fontSize={12} fontWeight={700} className={LABEL_CLASS}>
          Lateral
        </text>
        {(
          [
            { angle: 246, label: "Seg 3 (anterior end)", color: RV_SECTION_COLORS[2] },
            { angle: 180, label: "Seg 2", color: RV_SECTION_COLORS[1] },
            { angle: 114, label: "Seg 1 (inferior end)", color: RV_SECTION_COLORS[0] },
          ] as const
        ).map(({ angle, label, color }) => {
          const p = polar(C, 152, angle);
          return (
            <text
              key={label}
              x={p.x}
              y={p.y + 4}
              textAnchor="end"
              fontSize={11}
              fontWeight={700}
              fill={color}
              className="stroke-background"
              style={halo}
            >
              {label}
            </text>
          );
        })}
      </svg>

      <table className="mx-auto mt-3 border-separate border-spacing-x-3 border-spacing-y-1 text-center text-xs">
        <caption className="sr-only">RV segment numbers by ring and section</caption>
        <thead>
          <tr>
            <th scope="col" className="text-muted-foreground text-left font-medium">
              Ring
            </th>
            {SECTION_NAMES.map((name, s) => (
              <th key={name} scope="col" className="font-semibold whitespace-nowrap">
                <span
                  className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle"
                  style={{ backgroundColor: RV_SECTION_COLORS[s] }}
                  aria-hidden="true"
                />
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {RINGS.map((ring) => (
            <tr key={ring.name}>
              <th scope="row" className="text-left font-medium whitespace-nowrap">
                {ring.name}
                <span className="text-muted-foreground font-normal">
                  {ring.name === "Basal" ? " (outer)" : ring.name === "Apical" ? " (inner)" : ""}
                </span>
              </th>
              {[0, 1, 2].map((s) => (
                <td key={s} className="tabular-nums">
                  R{ring.first + s}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
