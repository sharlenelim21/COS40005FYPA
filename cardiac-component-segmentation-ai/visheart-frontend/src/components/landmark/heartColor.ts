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
