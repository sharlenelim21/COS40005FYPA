import * as THREE from "three";

export function rdYlGn(t: number): THREE.Color {
  const r = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
  const g = t < 0.5 ? t * 2 : 1;
  return new THREE.Color(r, g, 0);
}

export function valueToColor(value: number, min: number, max: number, reverse = false): THREE.Color {
  if (!Number.isFinite(value) || max === min) return new THREE.Color(0.267, 0.267, 0.267);
  let t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  if (reverse) t = 1 - t;
  return rdYlGn(t);
}

const DEBUG_SEGMENT_COLORS: readonly [number, number, number][] = [
  [0, 0, 0],
  [0.90, 0.10, 0.10], [0.90, 0.45, 0.10], [0.90, 0.75, 0.10], [0.65, 0.90, 0.10],
  [0.30, 0.90, 0.10], [0.10, 0.90, 0.35], [0.10, 0.90, 0.70], [0.10, 0.75, 0.90],
  [0.10, 0.45, 0.90], [0.10, 0.10, 0.90], [0.45, 0.10, 0.90], [0.75, 0.10, 0.90],
  [0.90, 0.10, 0.75], [0.90, 0.10, 0.40], [0.55, 0.55, 0.55], [0.85, 0.65, 0.20],
  [0.20, 0.20, 0.20],
];

export function debugSegmentColor(segmentIndex1To17: number): THREE.Color {
  const c = DEBUG_SEGMENT_COLORS[segmentIndex1To17] ?? DEBUG_SEGMENT_COLORS[0];
  return new THREE.Color(c[0], c[1], c[2]);
}

// RV 9-segment identity palette -- exact hex values from Sharlene's
// rv-deformation repo's own analysis notebook (notebooks/rv_deform_walkthrough
// .ipynb: PALETTE + COLOR_OF = {n: PALETTE[i] for i, n in enumerate(sorted(atlas))}),
// so the app's RV coloring matches the notebook's segment-identity colors
// exactly. Index order matches cpd_rv_segmentation.py's segment_names (0-8):
// Apical_Seg1, Apical_Seg2, Apical_Seg3, Basal_Seg1, Basal_Seg2, Basal_Seg3,
// Mid_Seg1, Mid_Seg2, Mid_Seg3 -- the same alphabetical zone/file order
// sorted(atlas) produces. Unlike LV's DEBUG_SEGMENT_COLORS, RV's raw CPD
// labels are 0-indexed (no +1 AHA-style shift), so this indexes directly by
// the label value.
const RV_SEGMENT_PALETTE: readonly [number, number, number][] = [
  [0.902, 0.098, 0.294], // #e6194b Apical_Seg1
  [0.235, 0.706, 0.294], // #3cb44b Apical_Seg2
  [0.263, 0.388, 0.847], // #4363d8 Apical_Seg3
  [0.961, 0.510, 0.192], // #f58231 Basal_Seg1
  [0.569, 0.118, 0.706], // #911eb4 Basal_Seg2
  [0.259, 0.831, 0.957], // #42d4f4 Basal_Seg3
  [0.941, 0.196, 0.902], // #f032e6 Mid_Seg1
  [0.749, 0.937, 0.271], // #bfef45 Mid_Seg2
  [0.000, 0.502, 0.502], // #008080 Mid_Seg3
];

export function rvSegmentColor(segmentIndex0To8: number): THREE.Color {
  const c = RV_SEGMENT_PALETTE[segmentIndex0To8] ?? RV_SEGMENT_PALETTE[0];
  return new THREE.Color(c[0], c[1], c[2]);
}

// CSS hex-string form of RV_SEGMENT_PALETTE, for SVG/DOM consumers (fill
// attributes, etc.) that can't take a THREE.Color -- derived from the same
// float triples above, single source of truth, rather than a second
// hand-copied hex list that could drift out of sync.
export const RV_SEGMENT_PALETTE_HEX: readonly string[] = RV_SEGMENT_PALETTE.map(([r, g, b]) => {
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
});

// Atlas segment_names (cpd_rv_segmentation.py), same 0-8 order as
// RV_SEGMENT_PALETTE -- display names for legends/tooltips. Spelled exactly
// as Sharlene's rv-deformation analysis notebook names them (underscored,
// e.g. "Apical_Seg1"), not a prettified "Apical Seg 1" -- so a segment named
// here and one named in the notebook are unambiguously the same thing.
export const RV_SEGMENT_NAMES: readonly string[] = [
  "Apical_Seg1", "Apical_Seg2", "Apical_Seg3",
  "Basal_Seg1", "Basal_Seg2", "Basal_Seg3",
  "Mid_Seg1", "Mid_Seg2", "Mid_Seg3",
];
