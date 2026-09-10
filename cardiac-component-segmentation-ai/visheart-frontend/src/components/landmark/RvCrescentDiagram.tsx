"use client";

/**
 * Flattened 2D "crescent bullseye" for the RV's 9-segment scheme -- the RV
 * analogue of the LV's circular AHA-17 bullseye, shaped to match how the
 * CinC (Bazhutina et al. 2023) scheme actually covers the RV: 3 levels
 * (apical/mid/basal) x 3 free-wall sectors, spanning 180 degrees, not a
 * full revolution (the excluded other 180 degrees is the septum, assigned
 * to LV in that scheme -- see rv-deformation/README.md's "cinc9" section).
 *
 * Static/decorative, not data-driven: there's no real per-segment RV
 * measurement to plot yet (same "wall-thickness/FAC not computed" gap noted
 * throughout the Structure/Strain tabs), so this only ever shows segment
 * IDENTITY via RV_SEGMENT_PALETTE, matching the 3D model's own
 * colorMode="rv-segment" -- a legend/orientation aid, not a value plot.
 */

import { RV_SEGMENT_PALETTE_HEX, RV_SEGMENT_NAMES } from "./heartColor";

const CENTER_X = 150;
const CENTER_Y = 175;
const RING_RADII = [40, 75, 110, 145]; // apical | mid | basal boundaries, innermost to outermost
const START_ANGLE_DEG = 180; // left
const END_ANGLE_DEG = 0; // right, sweeping up and over (through 90deg / top)
// Atlas segment_names order (cpd_rv_segmentation.py): Apical_Seg1/2/3,
// Basal_Seg1/2/3, Mid_Seg1/2/3 -- radial ring order here is anatomical
// (apex-to-base, matching the LV bullseye's own apex-center convention),
// so Mid and Basal are swapped relative to the atlas's alphabetical list.
const RING_SEGMENT_INDICES = [
  [0, 1, 2], // Apical_Seg1/2/3
  [6, 7, 8], // Mid_Seg1/2/3
  [3, 4, 5], // Basal_Seg1/2/3
];

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

function wedgePath(innerR: number, outerR: number, startDeg: number, endDeg: number): string {
  const outerStart = polarToCartesian(CENTER_X, CENTER_Y, outerR, startDeg);
  const outerEnd = polarToCartesian(CENTER_X, CENTER_Y, outerR, endDeg);
  const innerEnd = polarToCartesian(CENTER_X, CENTER_Y, innerR, endDeg);
  const innerStart = polarToCartesian(CENTER_X, CENTER_Y, innerR, startDeg);
  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 0 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 0 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

interface RvCrescentDiagramProps {
  selectedSegment?: number; // 0-8, atlas index -- highlights that wedge if set
  onSegmentClick?: (segmentIndex: number) => void;
  className?: string;
}

export function RvCrescentDiagram({ selectedSegment, onSegmentClick, className }: RvCrescentDiagramProps) {
  const sectorSpan = (START_ANGLE_DEG - END_ANGLE_DEG) / 3; // 60deg per sector

  return (
    <svg viewBox="0 0 300 200" className={className} role="img" aria-label="RV 9-segment crescent diagram">
      {RING_SEGMENT_INDICES.map((segIndices, ringIdx) => {
        const innerR = RING_RADII[ringIdx];
        const outerR = RING_RADII[ringIdx + 1];
        return segIndices.map((segIndex, sectorIdx) => {
          const startDeg = START_ANGLE_DEG - sectorIdx * sectorSpan;
          const endDeg = startDeg - sectorSpan;
          const isSelected = selectedSegment === segIndex;
          return (
            <path
              key={segIndex}
              d={wedgePath(innerR, outerR, startDeg, endDeg)}
              fill={RV_SEGMENT_PALETTE_HEX[segIndex]}
              stroke="var(--background, #fff)"
              strokeWidth={isSelected ? 3 : 1.5}
              opacity={isSelected || selectedSegment === undefined ? 1 : 0.45}
              onClick={onSegmentClick ? () => onSegmentClick(segIndex) : undefined}
              style={onSegmentClick ? { cursor: "pointer" } : undefined}
            >
              <title>{RV_SEGMENT_NAMES[segIndex]}</title>
            </path>
          );
        });
      })}
      {/* Septal-side open-edge label, since the missing 180deg reads as "cut off" without it */}
      <text x={20} y={CENTER_Y + 14} textAnchor="start" className="fill-current text-muted-foreground" fontSize="8">
        Septal edge
      </text>
      <text x={280} y={CENTER_Y + 14} textAnchor="end" className="fill-current text-muted-foreground" fontSize="8">
        Septal edge
      </text>
    </svg>
  );
}
