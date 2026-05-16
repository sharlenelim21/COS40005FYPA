"use client";

import React from "react";

export type StrainType = "GLS" | "GCS" | "GRS";

export interface StrainSegmentData {
  segment: number;
  label: string;
  strain: number;
}

interface StrainVisualizationProps {
  segmentData?: StrainSegmentData[];
  selectedStrainType?: StrainType;
  frame?: number;
  totalFrames?: number;
  compact?: boolean;
}

const SEGMENT_LABELS = [
  "Basal Ant",
  "Basal ASep",
  "Basal ISep",
  "Basal Inf",
  "Basal ILat",
  "Basal ALat",
  "Mid Ant",
  "Mid ASep",
  "Mid ISep",
  "Mid Inf",
  "Mid ILat",
  "Mid ALat",
  "Apical Ant",
  "Apical Sep",
  "Apical Inf",
  "Apical Lat",
  "Apex",
];

const BASE_GLS = [-18.2, -19.1, -16.5, -17.8, -20.2, -19.5, -20.1, -18.9, -17.3, -19.2, -21.1, -20.4, -19.8, -18.6, -20.3, -19.1, -18.7];
const BASE_GCS = [-17.1, -18.3, -16.8, -17.7, -19.4, -18.5, -20.2, -19.1, -18.2, -19.7, -20.8, -20.1, -21.0, -19.5, -20.4, -19.8, -18.9];
const BASE_GRS = [26.4, 28.2, 24.9, 25.8, 30.1, 29.4, 31.2, 30.5, 27.8, 28.6, 32.4, 31.6, 34.1, 32.7, 33.4, 31.9, 29.8];

export function getDummyStrainData(
  selectedStrainType: StrainType = "GLS",
  frame = 0,
  totalFrames = 10,
): StrainSegmentData[] {
  const safeTotal = Math.max(totalFrames, 1);
  const phase = safeTotal > 1 ? frame / (safeTotal - 1) : 0;
  const contraction = Math.sin(phase * Math.PI);
  const base = selectedStrainType === "GRS" ? BASE_GRS : selectedStrainType === "GCS" ? BASE_GCS : BASE_GLS;

  return base.map((value, index) => {
    const segmentOffset = Math.sin((index + 1) * 0.85 + frame * 0.35) * 0.9;
    const dynamicValue =
      selectedStrainType === "GRS"
        ? value * (0.62 + contraction * 0.38) + segmentOffset
        : value * (0.42 + contraction * 0.58) + segmentOffset;

    return {
      segment: index + 1,
      label: SEGMENT_LABELS[index],
      strain: Number(dynamicValue.toFixed(1)),
    };
  });
}

export function getStrainColor(strain: number, strainType: StrainType): string {
  if (strainType === "GRS") {
    if (strain < 16) return "#dc2626";
    if (strain < 24) return "#f97316";
    if (strain < 30) return "#eab308";
    if (strain < 38) return "#22c55e";
    return "#15803d";
  }

  if (strain > -13) return "#dc2626";
  if (strain > -17) return "#f97316";
  if (strain > -20) return "#eab308";
  if (strain > -24) return "#22c55e";
  return "#15803d";
}

function polarPoint(center: number, radius: number, angleDegrees: number) {
  const angle = (angleDegrees * Math.PI) / 180;
  return {
    x: center + radius * Math.cos(angle),
    y: center + radius * Math.sin(angle),
  };
}

function annularSectorPath(
  center: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  const outerStart = polarPoint(center, outerRadius, startAngle);
  const outerEnd = polarPoint(center, outerRadius, endAngle);
  const innerEnd = polarPoint(center, innerRadius, endAngle);
  const innerStart = polarPoint(center, innerRadius, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

export const StrainBullseye: React.FC<StrainVisualizationProps> = ({
  segmentData,
  selectedStrainType = "GLS",
  frame = 0,
  totalFrames = 10,
  compact = false,
}) => {
  const data = segmentData ?? getDummyStrainData(selectedStrainType, frame, totalFrames);
  const center = 150;
  const basalOuter = 118;
  const basalInner = 88;
  const midInner = 58;
  const apicalInner = 30;

  const segmentValue = (index: number) => data[index]?.strain ?? 0;
  const segmentLabel = (index: number) => data[index]?.label ?? `Segment ${index + 1}`;

  return (
    <div className="flex flex-col gap-3">
      <svg viewBox="0 0 300 300" className="mx-auto h-auto w-full max-w-sm" role="img" aria-label={`${selectedStrainType} strain bullseye`}>
        <circle cx={center} cy={center} r="122" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1" />

        {Array.from({ length: 6 }, (_, index) => (
          <StrainSegment
            key={`basal-${index}`}
            index={index}
            value={segmentValue(index)}
            label={segmentLabel(index)}
            strainType={selectedStrainType}
            center={center}
            innerRadius={basalInner}
            outerRadius={basalOuter}
            startAngle={-90 + index * 60}
            endAngle={-90 + (index + 1) * 60}
          />
        ))}
        {Array.from({ length: 6 }, (_, index) => (
          <StrainSegment
            key={`mid-${index}`}
            index={index + 6}
            value={segmentValue(index + 6)}
            label={segmentLabel(index + 6)}
            strainType={selectedStrainType}
            center={center}
            innerRadius={midInner}
            outerRadius={basalInner}
            startAngle={-90 + index * 60}
            endAngle={-90 + (index + 1) * 60}
          />
        ))}
        {Array.from({ length: 4 }, (_, index) => (
          <StrainSegment
            key={`apical-${index}`}
            index={index + 12}
            value={segmentValue(index + 12)}
            label={segmentLabel(index + 12)}
            strainType={selectedStrainType}
            center={center}
            innerRadius={apicalInner}
            outerRadius={midInner}
            startAngle={-90 + index * 90}
            endAngle={-90 + (index + 1) * 90}
          />
        ))}

        <circle
          cx={center}
          cy={center}
          r={apicalInner}
          fill={getStrainColor(segmentValue(16), selectedStrainType)}
          stroke="#ffffff"
          strokeWidth="1"
        >
          <title>{segmentLabel(16)}: {segmentValue(16).toFixed(1)}%</title>
        </circle>
        <text x={center} y={center - 2} textAnchor="middle" fontSize="9" fontWeight="700" fill="#ffffff">
          17
        </text>
        <text x={center} y={center + 10} textAnchor="middle" fontSize="8" fontWeight="700" fill="#ffffff">
          {segmentValue(16).toFixed(1)}
        </text>

        <text x="150" y="18" textAnchor="middle" fontSize="11" fontWeight="700" fill="#475569">Anterior</text>
        <text x="282" y="154" textAnchor="middle" fontSize="11" fontWeight="700" fill="#475569">Septal</text>
        <text x="150" y="292" textAnchor="middle" fontSize="11" fontWeight="700" fill="#475569">Inferior</text>
        <text x="18" y="154" textAnchor="middle" fontSize="11" fontWeight="700" fill="#475569">Lateral</text>
      </svg>

      <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] text-muted-foreground">
        {[
          ["#15803d", "Excellent"],
          ["#22c55e", "Good"],
          ["#eab308", "Fair"],
          ["#f97316", "Reduced"],
          ["#dc2626", "Poor"],
        ].map(([color, label]) => (
          <span key={label} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>

      {!compact && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="bg-muted/30 p-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide">
              Per-Segment {selectedStrainType} Values
            </h3>
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

function StrainSegment({
  index,
  value,
  label,
  strainType,
  center,
  innerRadius,
  outerRadius,
  startAngle,
  endAngle,
}: {
  index: number;
  value: number;
  label: string;
  strainType: StrainType;
  center: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
}) {
  const midAngle = (startAngle + endAngle) / 2;
  const labelPoint = polarPoint(center, (innerRadius + outerRadius) / 2, midAngle);

  return (
    <g>
      <path
        d={annularSectorPath(center, innerRadius, outerRadius, startAngle, endAngle)}
        fill={getStrainColor(value, strainType)}
        stroke="#ffffff"
        strokeWidth="1"
      >
        <title>{label}: {value.toFixed(1)}%</title>
      </path>
      <text x={labelPoint.x} y={labelPoint.y - 1} textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#ffffff">
        {index + 1}
      </text>
      <text x={labelPoint.x} y={labelPoint.y + 10} textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#ffffff">
        {value.toFixed(1)}
      </text>
    </g>
  );
}

export default StrainBullseye;
