"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { valueToColor, debugSegmentColor } from "./heartColor";

interface ReconstructedHeartModelProps {
  meshUrl: string;
  meshFormat: "obj" | "glb";
  segmentLabels: number[];
  colorMode: "debug-segment" | "strain";
  values?: number[];
  min?: number;
  max?: number;
  reverseColors?: boolean;
  className?: string;
  selectedSegment?: number;
  onSegmentClick?: (segment: number) => void;
}

function findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((child) => {
    if (!found && (child as THREE.Mesh).isMesh) found = child as THREE.Mesh;
  });
  return found;
}

function flattenToFaceLabels(mesh: THREE.Mesh, labels: number[]): number[] {
  const geometry = mesh.geometry;
  const posAttr = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const triangleCount = index ? index.count / 3 : posAttr.count / 3;

  const cornerIndex = (t: number, corner: number) =>
    index ? index.getX(t * 3 + corner) : t * 3 + corner;

  const majorityLabel = (la: number, lb: number, lc: number) => {
    if (la === lb || la === lc) return la;
    if (lb === lc) return lb;
    return la;
  };

  const newPositions = new Float32Array(triangleCount * 9);
  const newLabels = new Array<number>(triangleCount * 3);

  for (let t = 0; t < triangleCount; t++) {
    const a = cornerIndex(t, 0);
    const b = cornerIndex(t, 1);
    const c = cornerIndex(t, 2);
    const triangleLabel = majorityLabel(labels[a] ?? 0, labels[b] ?? 0, labels[c] ?? 0);
    const corners = [a, b, c];
    for (let corner = 0; corner < 3; corner++) {
      const srcIndex = corners[corner];
      const dst = (t * 3 + corner) * 3;
      newPositions[dst] = posAttr.getX(srcIndex);
      newPositions[dst + 1] = posAttr.getY(srcIndex);
      newPositions[dst + 2] = posAttr.getZ(srcIndex);
      newLabels[t * 3 + corner] = triangleLabel;
    }
  }

  const newGeometry = new THREE.BufferGeometry();
  newGeometry.setAttribute("position", new THREE.BufferAttribute(newPositions, 3));
  geometry.dispose();
  mesh.geometry = newGeometry;

  return newLabels;
}

// NOTE: this overlay does NOT fix the jagged/zigzag boundary look - that was
// tried (control-point decimation) and reverted; measured and confirmed a
// line-overlay-on-unchanged-fill approach can't do both (stay glued to the
// fill AND look smooth) without reshaping the fill geometry itself, which is
// out of scope. This only cleans up minor seam/gap artifacts between
// adjacent flat-colored triangles. Don't re-investigate "why is it still
// jagged" against this function - it's expected.
function buildSegmentBoundaryEdges(mesh: THREE.Mesh, labels: number[]): Float32Array {
  const geometry = mesh.geometry;
  const posAttr = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const triangleCount = index ? index.count / 3 : posAttr.count / 3;

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

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else mesh.material?.dispose();
  });
}

export function ReconstructedHeartModel({
  meshUrl,
  meshFormat,
  segmentLabels,
  colorMode,
  values,
  min = -10,
  max = 45,
  reverseColors = false,
  className,
  selectedSegment = -1,
  onSegmentClick,
}: ReconstructedHeartModelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const pivotRef = useRef<THREE.Object3D | null>(null);

  const currentMeshRef = useRef<THREE.Mesh | null>(null);
  const loadedObjectRef = useRef<THREE.Object3D | null>(null);
  const baseColorsRef = useRef<Float32Array | null>(null);
  const segmentVertexIndicesRef = useRef<Map<number, number[]> | null>(null);
  const boundaryLinesRef = useRef<LineSegments2 | null>(null);
  const lineMaterialRef = useRef<LineMaterial | null>(null);
  const flatSegmentLabelsRef = useRef<number[] | null>(null);

  const selectedSegmentRef = useRef(selectedSegment);
  const onSegmentClickRef = useRef(onSegmentClick);
  const segmentLabelsRef = useRef(segmentLabels);
  useEffect(() => { selectedSegmentRef.current = selectedSegment; }, [selectedSegment]);
  useEffect(() => { onSegmentClickRef.current = onSegmentClick; }, [onSegmentClick]);
  useEffect(() => { segmentLabelsRef.current = segmentLabels; }, [segmentLabels]);

  const applyVertexColorsRef = useRef<() => void>(() => {});
  applyVertexColorsRef.current = () => {
    const mesh = currentMeshRef.current;
    const labels = flatSegmentLabelsRef.current;
    if (!mesh || !labels) return;
    const posAttr = mesh.geometry.getAttribute("position");
    if (!posAttr) return;

    if (posAttr.count !== labels.length) {
      console.warn(
        `[ReconstructedHeartModel] Vertex count mismatch: mesh has ${posAttr.count} vertices, ` +
        `flattened labels has ${labels.length}.`,
      );
    }

    const colors = new Float32Array(posAttr.count * 3);
    const byLabel = new Map<number, number[]>();
    for (let i = 0; i < posAttr.count; i++) {
      const segment = labels[i] ?? 0;
      const color =
        colorMode === "debug-segment"
          ? debugSegmentColor(segment)
          : valueToColor(values?.[segment - 1] ?? min, min, max, reverseColors);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      if (!byLabel.has(segment)) byLabel.set(segment, []);
      byLabel.get(segment)!.push(i);
    }
    mesh.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    if (!(mesh.material instanceof THREE.MeshBasicMaterial)) {
      mesh.material = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
    }

    baseColorsRef.current = colors.slice();
    segmentVertexIndicesRef.current = byLabel;
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
    camera.position.set(0, 0.5, 11);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const pivot = new THREE.Object3D();
    scene.add(pivot);
    pivotRef.current = pivot;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = false;
    controls.minDistance = 5;
    controls.maxDistance = 20;
    controls.target.set(0, 0, 0);
    controls.update();

    let isDragging = false;
    const onStart = () => { isDragging = true; };
    const onEnd = () => { isDragging = false; };
    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      lineMaterialRef.current?.resolution.set(width, height);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pointerFromEvent = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };
    const onClick = (event: MouseEvent) => {
      const mesh = currentMeshRef.current;
      if (!mesh || !onSegmentClickRef.current) return;
      pointerFromEvent(event);
      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObject(mesh, false);
      const vertexIndex = intersects[0]?.face?.a;
      if (vertexIndex === undefined) return;
      const segment = flatSegmentLabelsRef.current?.[vertexIndex];
      if (segment !== undefined) onSegmentClickRef.current(segment);
    };
    const onMouseMove = (event: MouseEvent) => {
      const mesh = currentMeshRef.current;
      if (!mesh) return;
      pointerFromEvent(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(mesh, false).length > 0;
      renderer.domElement.style.cursor = hit && onSegmentClickRef.current ? "pointer" : "default";
    };
    renderer.domElement.addEventListener("click", onClick);
    renderer.domElement.addEventListener("mousemove", onMouseMove);

    let lastPulsedSegment = -1;
    const clock = new THREE.Clock();
    const updateSelectionHighlight = () => {
      const mesh = currentMeshRef.current;
      const baseColors = baseColorsRef.current;
      const segmentVertexIndices = segmentVertexIndicesRef.current;
      if (!mesh || !baseColors || !segmentVertexIndices) return;
      const colorAttr = mesh.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
      if (!colorAttr) return;
      const sel = selectedSegmentRef.current ?? -1;

      if (sel !== lastPulsedSegment) {
        const prevIndices = lastPulsedSegment >= 1 ? segmentVertexIndices.get(lastPulsedSegment) : undefined;
        if (prevIndices) {
          for (const vi of prevIndices) {
            colorAttr.setXYZ(vi, baseColors[vi * 3], baseColors[vi * 3 + 1], baseColors[vi * 3 + 2]);
          }
          colorAttr.needsUpdate = true;
        }
        lastPulsedSegment = sel;
      }

      if (sel >= 1) {
        const indices = segmentVertexIndices.get(sel);
        if (indices) {
          const t = ((Math.sin(clock.getElapsedTime() * 6) + 1) / 2) * 0.9;
          for (const vi of indices) {
            const r = baseColors[vi * 3], g = baseColors[vi * 3 + 1], b = baseColors[vi * 3 + 2];
            colorAttr.setXYZ(vi, r + (1 - r) * t, g + (1 - g) * t, b + (1 - b) * t);
          }
          colorAttr.needsUpdate = true;
        }
      }
    };

    let animationId = 0;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      if (!isDragging) {
        pivot.rotation.y += 0.006;
      }
      updateSelectionHighlight();
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("mousemove", onMouseMove);
      resizeObserver.disconnect();
      controls.dispose();
      if (loadedObjectRef.current) disposeObject(loadedObjectRef.current);
      if (boundaryLinesRef.current) {
        boundaryLinesRef.current.geometry.dispose();
        (boundaryLinesRef.current.material as LineMaterial).dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
      pivotRef.current = null;
      currentMeshRef.current = null;
      loadedObjectRef.current = null;
      baseColorsRef.current = null;
      segmentVertexIndicesRef.current = null;
      flatSegmentLabelsRef.current = null;
      boundaryLinesRef.current = null;
      lineMaterialRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const pivot = pivotRef.current;
    if (!pivot || !meshUrl) return;
    let cancelled = false;

    const labelCentroidLocal = (mesh: THREE.Mesh, wantedLabels: Set<number>): THREE.Vector3 | null => {
      const posAttr = mesh.geometry.getAttribute("position");
      if (!posAttr) return null;
      const labels = segmentLabelsRef.current;
      const sum = new THREE.Vector3();
      let count = 0;
      for (let i = 0; i < posAttr.count; i++) {
        const label = labels[i];
        if (label === undefined || !wantedLabels.has(label)) continue;
        sum.x += posAttr.getX(i);
        sum.y += posAttr.getY(i);
        sum.z += posAttr.getZ(i);
        count++;
      }
      return count >= 3 ? sum.divideScalar(count) : null;
    };

    const APEX_DIRECTION_SIGN = 1;

    const alignCenterAndScale = (mesh: THREE.Mesh) => {
      let rotation = new THREE.Quaternion();
      const apexCentroid = labelCentroidLocal(mesh, new Set([17]));
      const baseCentroid = labelCentroidLocal(mesh, new Set([1, 2, 3, 4, 5, 6]));
      if (!apexCentroid || !baseCentroid) {
        console.warn("[ReconstructedHeartModel] Apex/base labels too sparse to align long axis.");
      } else {
        const apexToBase = baseCentroid.clone().sub(apexCentroid);
        if (apexToBase.lengthSq() < 1e-8) {
          console.warn("[ReconstructedHeartModel] Apex and base centroids coincide.");
        } else {
          apexToBase.normalize();
          const targetBaseDirection = new THREE.Vector3(0, APEX_DIRECTION_SIGN, 0);
          rotation = new THREE.Quaternion().setFromUnitVectors(apexToBase, targetBaseDirection);
        }
      }
      mesh.geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(rotation));

      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z, 0.0001);
      const scale = 3.55 / maxDimension;
      const centerAndScale = new THREE.Matrix4()
        .makeScale(scale, scale, scale)
        .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
      mesh.geometry.applyMatrix4(centerAndScale);
    };

    const onLoaded = (object: THREE.Object3D) => {
      if (cancelled) return;
      const mesh = findFirstMesh(object);
      if (!mesh) {
        console.error("[ReconstructedHeartModel] Loaded mesh file contains no THREE.Mesh");
        return;
      }
      alignCenterAndScale(mesh);
      const boundaryLinePositions = buildSegmentBoundaryEdges(mesh, segmentLabelsRef.current);
      flatSegmentLabelsRef.current = flattenToFaceLabels(mesh, segmentLabelsRef.current);

      if (loadedObjectRef.current) {
        pivot.remove(loadedObjectRef.current);
        disposeObject(loadedObjectRef.current);
      }
      if (boundaryLinesRef.current) {
        pivot.remove(boundaryLinesRef.current);
        boundaryLinesRef.current.geometry.dispose();
        (boundaryLinesRef.current.material as LineMaterial).dispose();
      }

      const lineGeometry = new LineSegmentsGeometry();
      lineGeometry.setPositions(boundaryLinePositions);
      const lineMaterial = new LineMaterial({
        color: 0xffffff,
        linewidth: 1.5,
        depthTest: true,
        transparent: true,
        opacity: 0.9,
      });
      const container = containerRef.current;
      if (container) {
        lineMaterial.resolution.set(Math.max(container.clientWidth, 1), Math.max(container.clientHeight, 1));
      }
      const boundaryLines = new LineSegments2(lineGeometry, lineMaterial);
      pivot.add(boundaryLines);
      boundaryLinesRef.current = boundaryLines;
      lineMaterialRef.current = lineMaterial;

      pivot.add(object);
      loadedObjectRef.current = object;
      currentMeshRef.current = mesh;
      applyVertexColorsRef.current();
    };

    if (meshFormat === "glb") {
      new GLTFLoader().load(
        meshUrl,
        (gltf) => onLoaded(gltf.scene),
        undefined,
        (err) => console.error("[ReconstructedHeartModel] GLB load failed:", err),
      );
    } else {
      new OBJLoader().load(
        meshUrl,
        (object) => onLoaded(object),
        undefined,
        (err) => console.error("[ReconstructedHeartModel] OBJ load failed:", err),
      );
    }

    return () => { cancelled = true; };
  }, [meshUrl, meshFormat]);

  useEffect(() => {
    applyVertexColorsRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode, values, min, max, reverseColors, segmentLabels]);

  return (
    <div
      ref={containerRef}
      className={`relative ${className ?? ""}`}
      aria-label="Reconstructed patient-specific 3D heart model"
    />
  );
}
