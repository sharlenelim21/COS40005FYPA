import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

/**
 * White segment-outline overlay shared by the single-chamber heart model and the
 * combined LV+RV view, so every 3D heart outlines its segments the same way.
 */
// NOTE: this overlay does NOT fix the jagged/zigzag boundary look - that was
// tried (control-point decimation) and reverted; measured and confirmed a
// line-overlay-on-unchanged-fill approach can't do both (stay glued to the
// fill AND look smooth) without reshaping the fill geometry itself, which is
// out of scope. This only cleans up minor seam/gap artifacts between
// adjacent flat-colored triangles. Don't re-investigate "why is it still
// jagged" against this function - it's expected.
export function buildSegmentBoundaryEdges(mesh: THREE.Mesh, labels: number[]): Float32Array {
  const geometry = mesh.geometry;
  const posAttr = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const triangleCount = index ? index.count / 3 : posAttr.count / 3;

  // A labels array built for a DIFFERENT mesh (wrong vertex count) isn't just
  // incomplete, it's actively wrong here: every triangle corner would get a
  // near-random label, so almost every edge reads as a segment boundary --
  // this rendered as a dense web of fine white lines covering the whole
  // surface, which looked like the mesh geometry itself was corrupted/noisy
  // (it wasn't; same root cause and fix as applyVertexColorsRef's safeLabels
  // guard in ReconstructedHeartModel.tsx -- reported live, 2026-10).
  if (posAttr.count !== labels.length) {
    console.warn(
      `[buildSegmentBoundaryEdges] Vertex count mismatch: mesh has ${posAttr.count} vertices, ` +
      `labels has ${labels.length} — skipping boundary lines for this mesh instead of drawing ` +
      `them from a mismatched array.`,
    );
    return new Float32Array(0);
  }

  const cornerIndex = (t: number, corner: number) =>
    index ? index.getX(t * 3 + corner) : t * 3 + corner;

  const majorityLabel = (la: number, lb: number, lc: number) => {
    if (la === lb || la === lc) return la;
    if (lb === lc) return lb;
    return la;
  };

  const keyOf = (i: number) => `${posAttr.getX(i).toFixed(4)},${posAttr.getY(i).toFixed(4)},${posAttr.getZ(i).toFixed(4)}`;
  const groupIndexByKey = new Map<string, number>();
  const groupPosition = new Map<number, THREE.Vector3>();
  const groupOf = (i: number) => {
    const k = keyOf(i);
    let g = groupIndexByKey.get(k);
    if (g === undefined) {
      g = groupIndexByKey.size;
      groupIndexByKey.set(k, g);
      groupPosition.set(g, new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)));
    }
    return g;
  };

  const edgeFirstLabel = new Map<string, { label: number; ga: number; gb: number }>();
  const boundaryAdjacency = new Map<number, Set<number>>();
  const addBoundaryEdge = (ga: number, gb: number) => {
    if (!boundaryAdjacency.has(ga)) boundaryAdjacency.set(ga, new Set());
    if (!boundaryAdjacency.has(gb)) boundaryAdjacency.set(gb, new Set());
    boundaryAdjacency.get(ga)!.add(gb);
    boundaryAdjacency.get(gb)!.add(ga);
  };

  for (let t = 0; t < triangleCount; t++) {
    const a = cornerIndex(t, 0);
    const b = cornerIndex(t, 1);
    const c = cornerIndex(t, 2);
    const label = majorityLabel(labels[a] ?? 0, labels[b] ?? 0, labels[c] ?? 0);
    const ga = groupOf(a), gb = groupOf(b), gc = groupOf(c);

    for (const [x, y] of [[ga, gb], [gb, gc], [gc, ga]] as [number, number][]) {
      if (x === y) continue;
      const key = x < y ? `${x},${y}` : `${y},${x}`;
      const seen = edgeFirstLabel.get(key);
      if (!seen) {
        edgeFirstLabel.set(key, { label, ga: x, gb: y });
      } else if (seen.label !== label) {
        addBoundaryEdge(seen.ga, seen.gb);
      }
    }
  }

  const degreeOf = (g: number) => boundaryAdjacency.get(g)?.size ?? 0;
  const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const visitedEdges = new Set<string>();
  const chains: number[][] = [];

  for (const [g, neighbors] of boundaryAdjacency) {
    if (degreeOf(g) === 2) continue;
    for (const n of neighbors) {
      const startKey = edgeKey(g, n);
      if (visitedEdges.has(startKey)) continue;
      visitedEdges.add(startKey);
      const chain = [g, n];
      let prev = g, current = n;
      while (degreeOf(current) === 2) {
        const [n1, n2] = Array.from(boundaryAdjacency.get(current)!);
        const next = n1 === prev ? n2 : n1;
        const key = edgeKey(current, next);
        if (visitedEdges.has(key)) break;
        visitedEdges.add(key);
        chain.push(next);
        prev = current;
        current = next;
      }
      chains.push(chain);
    }
  }

  for (const [g, neighbors] of boundaryAdjacency) {
    for (const n of neighbors) {
      const startKey = edgeKey(g, n);
      if (visitedEdges.has(startKey)) continue;
      visitedEdges.add(startKey);
      const chain = [g, n];
      let prev = g, current = n;
      while (current !== g) {
        const [n1, n2] = Array.from(boundaryAdjacency.get(current)!);
        const next = n1 === prev ? n2 : n1;
        const key = edgeKey(current, next);
        if (visitedEdges.has(key)) break;
        visitedEdges.add(key);
        chain.push(next);
        prev = current;
        current = next;
      }
      chains.push(chain);
    }
  }

  const segmentPoints: number[] = [];
  for (const chain of chains) {
    const points = chain.map((g) => groupPosition.get(g)!);
    if (points.length < 3) {
      for (let i = 0; i < points.length - 1; i++) {
        segmentPoints.push(points[i].x, points[i].y, points[i].z, points[i + 1].x, points[i + 1].y, points[i + 1].z);
      }
      continue;
    }
    const closed = points.length > 3 && chain[0] === chain[chain.length - 1];
    const curvePoints = closed ? points.slice(0, -1) : points;
    const curve = new THREE.CatmullRomCurve3(curvePoints, closed);
    const smoothed = curve.getPoints(Math.max(curvePoints.length * 4, 8));
    for (let i = 0; i < smoothed.length - 1; i++) {
      segmentPoints.push(smoothed[i].x, smoothed[i].y, smoothed[i].z, smoothed[i + 1].x, smoothed[i + 1].y, smoothed[i + 1].z);
    }
    if (closed) {
      const first = smoothed[0], last = smoothed[smoothed.length - 1];
      segmentPoints.push(last.x, last.y, last.z, first.x, first.y, first.z);
    }
  }

  return new Float32Array(segmentPoints);
}


/**
 * Builds the white outline for one mesh. Positions are in the mesh's own geometry space, so the
 * result is meant to be added as a child of that mesh (it then follows whatever transform the
 * mesh carries). The caller owns `resolution` updates on resize via the returned material.
 */
export function createSegmentBoundaryLines(
  mesh: THREE.Mesh,
  labels: number[],
  resolution: { width: number; height: number },
): LineSegments2 {
  const lineGeometry = new LineSegmentsGeometry();
  lineGeometry.setPositions(buildSegmentBoundaryEdges(mesh, labels));
  const lineMaterial = new LineMaterial({
    color: 0xffffff,
    linewidth: 1.5,
    depthTest: true,
    transparent: true,
    opacity: 0.9,
  });
  lineMaterial.resolution.set(Math.max(resolution.width, 1), Math.max(resolution.height, 1));
  return new LineSegments2(lineGeometry, lineMaterial);
}
