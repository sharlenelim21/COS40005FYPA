import { LABEL_CLASS, MUTED_LABEL_CLASS } from "@/components/doc/diagrams/geometry";

// Worked example of the slice -> ring split (bullseye_analysis.classify_slices
// for the LV, classify_rv_slices for the RV) on a 10-slice stack where the LV
// wall shows on all 10 slices and the RV on the first 9:
//   LV: 10 slices < 15, so 1 apex slice; the other 9 split 3 / 3 / 3.
//   RV: 9 slices split into even thirds 3 / 3 / 3; no apex ring; slice 10 unused.
const N_SLICES = 10;
const ROW_H = 24;
const TOP = 44;
const LV_X = 96;
const RV_X = 286;
const COL_W = 170;

interface Band {
  from: number; // first slice (1-based)
  to: number; // last slice
  title: string;
  detail: string;
  shade: number; // 0..1, fill opacity
  muted?: boolean;
}

const LV_BANDS: Band[] = [
  { from: 1, to: 3, title: "Basal", detail: "segments 1–6", shade: 0.14 },
  { from: 4, to: 6, title: "Mid", detail: "segments 7–12", shade: 0.24 },
  { from: 7, to: 9, title: "Apical", detail: "segments 13–16", shade: 0.34 },
  { from: 10, to: 10, title: "Apex", detail: "segment 17", shade: 0.46 },
];

const RV_BANDS: Band[] = [
  { from: 1, to: 3, title: "Basal", detail: "R1–R3", shade: 0.14 },
  { from: 4, to: 6, title: "Mid", detail: "R4–R6", shade: 0.24 },
  { from: 7, to: 9, title: "Apical", detail: "R7–R9", shade: 0.34 },
  { from: 10, to: 10, title: "No RV", detail: "not used", shade: 0, muted: true },
];

const rowY = (slice: number) => TOP + (slice - 1) * ROW_H;

function BandColumn({ x, bands }: { x: number; bands: Band[] }) {
  return (
    <>
      {bands.map((band) => {
        const y = rowY(band.from) + 2;
        const h = (band.to - band.from + 1) * ROW_H - 4;
        const single = band.from === band.to;
        return (
          <g key={band.title}>
            <rect
              x={x}
              y={y}
              width={COL_W}
              height={h}
              rx={6}
              fill="#64748b"
              fillOpacity={band.shade}
              className="stroke-border"
              strokeDasharray={band.muted ? "4 3" : undefined}
            />
            <text
              x={x + COL_W / 2}
              y={single ? y + h / 2 + 4 : y + h / 2 - 2}
              textAnchor="middle"
              fontSize={11.5}
              fontWeight={700}
              className={band.muted ? MUTED_LABEL_CLASS : LABEL_CLASS}
            >
              {single ? `${band.title} · ${band.detail}` : band.title}
            </text>
            {!single && (
              <text x={x + COL_W / 2} y={y + h / 2 + 13} textAnchor="middle" fontSize={10.5} className={MUTED_LABEL_CLASS}>
                {band.detail}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
}

export function SliceRingsDiagram({ title }: { title: string }) {
  const height = TOP + N_SLICES * ROW_H + 10;
  return (
    <svg viewBox={`0 0 470 ${height}`} role="img" aria-label={title} className="mx-auto block h-auto w-full max-w-[470px]">
      <text x={44} y={24} textAnchor="middle" fontSize={11} fontWeight={700} className={LABEL_CLASS}>
        Slice
      </text>
      <text x={LV_X + COL_W / 2} y={24} textAnchor="middle" fontSize={11} fontWeight={700} className={LABEL_CLASS}>
        LV rings (17 segments)
      </text>
      <text x={RV_X + COL_W / 2} y={24} textAnchor="middle" fontSize={11} fontWeight={700} className={LABEL_CLASS}>
        RV rings (9 segments)
      </text>

      {Array.from({ length: N_SLICES }, (_, i) => {
        const slice = i + 1;
        const y = rowY(slice) + ROW_H / 2 + 4;
        return (
          <text key={slice} x={44} y={y} textAnchor="middle" fontSize={10.5} className={MUTED_LABEL_CLASS}>
            {slice === 1 ? "1 base" : slice === N_SLICES ? `${slice} apex` : slice}
          </text>
        );
      })}

      <BandColumn x={LV_X} bands={LV_BANDS} />
      <BandColumn x={RV_X} bands={RV_BANDS} />
    </svg>
  );
}
