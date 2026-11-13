import { LvRayCastingDiagram } from "@/components/doc/diagrams/LvRayCastingDiagram";
import { RvNineSegmentDiagram } from "@/components/doc/diagrams/RvNineSegmentDiagram";
import { RvRayCastingDiagram } from "@/components/doc/diagrams/RvRayCastingDiagram";
import { SliceRingsDiagram } from "@/components/doc/diagrams/SliceRingsDiagram";

/** Schematic SVG diagrams the guides can show by name (medical guide `diagram` blocks, technical guide). */
export const DIAGRAMS = {
  rvNineSegments: RvNineSegmentDiagram,
  sliceRings: SliceRingsDiagram,
  rvRayCasting: RvRayCastingDiagram,
  lvRayCasting: LvRayCastingDiagram,
} as const;

export type DiagramId = keyof typeof DIAGRAMS;
