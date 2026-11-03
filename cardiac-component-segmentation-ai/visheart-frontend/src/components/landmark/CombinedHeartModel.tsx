"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { valueToColor, rvSegmentColor } from "./heartColor";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { findFirstMesh, loadMesh, computeLvAlignment } from "./lvAlignment";
import {
  buildSegmentBoundaryTopology, createSegmentBoundaryLines, segmentBoundaryEdgesAt, type SegmentBoundaryTopology,
} from "./segmentBoundaryLines";
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import type { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

/**
 * Combined LV+RV 3D view for the Strain tab's "Combined" chamber focus.
 * Loads BOTH chambers' meshes into ONE scene and aligns them with a SINGLE
 * shared transform derived from the LV mesh's own apex/base/anchor labels
 * (the same convention ReconstructedHeartModel uses for LV alone) --
 * crucially NOT two independently-computed alignments, which would each
 * rotate/center its own mesh around its own long axis and destroy their
 * real relative position. This is safe specifically because LV and RV
 * reconstructions of the same patient/frame share one coordinate space:
 * `_extract_affine_matrix_sync` (the backend's NIfTI-to-world transform)
 * never takes a `chamber` argument, so both chambers' raw mesh vertices are
 * already expressed in the same real-world mm frame before either mesh is
 * touched here -- confirmed this session while building the LV-derived RV
 * septal anchor feature.
 *
 * Supports click-to-select + camera-focus like ReconstructedHeartModel (see
 * that file's updateFocusRotation) -- clicking a segment on either chamber
 * rotates the shared pivot to face it and pulses its color, independent of
 * the LV-only/RV-only views' own selection state (Combined has its own).
 */
interface CombinedHeartModelProps {
  lvMeshUrl?: string | null;
  lvMeshFormat?: "obj" | "glb";
  lvSegmentLabels?: number[] | null;
  lvValues?: (number | null)[];
  lvMin?: number;
  lvMax?: number;
  lvReverseColors?: boolean;
  rvMeshUrl?: string | null;
  rvMeshFormat?: "obj" | "glb";
  rvSegmentLabels?: number[] | null;
  /** Per-segment RV values (0-8, CPD atlas numbering — same indexing as
   *  rvSegmentLabels), for value-heatmap coloring. Omit to fall back to
   *  rvSegmentColor identity colors (e.g. before any RV strain/FAC has been
   *  computed for this project). */
  rvValues?: (number | null)[];
  rvMin?: number;
  rvMax?: number;
  rvReverseColors?: boolean;
  className?: string;
  /** Starting camera distance (world units, along +Z) -- see
   * ReconstructedHeartModel's identical prop. */
  initialCameraDistance?: number;
  /** LV segment (1-17, AHA numbering), -1/undefined = none selected. */
  selectedLvSegment?: number;
  onLvSegmentClick?: (segment: number) => void;
  /** RV segment (0-8, CPD atlas numbering), -1/undefined = none selected. */
  selectedRvSegment?: number;
  onRvSegmentClick?: (segment: number) => void;
  /** Smooth motion (hooks/useMotionMesh): this frame's vertex positions for the loaded LV / RV mesh, in the mesh
   * file's own coordinates and vertex order. Each mesh then stays loaded and only its vertices move (the shared
   * alignment is on the group, so raw positions go straight in); null keeps a mesh as loaded. */
  lvMotionPositions?: Float32Array | null;
  rvMotionPositions?: Float32Array | null;
  /** Called when that chamber's motion does not fit its loaded mesh (different vertex count). */
  onLvMotionUnusable?: () => void;
  onRvMotionUnusable?: () => void;
  /** Smooth motion: ease from the shown positions to new ones over this many ms (the page's frame interval), so
   * playback moves continuously instead of jumping once per frame. 0 = jump (default). */
  motionTransitionMs?: number;
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

/** Per-segment vertex index map + base (unselected) colors + the centroid of
 * each segment in the ALIGNED frame (post `alignment` matrix, pre pivot
 * rotation) -- everything click/hover/focus handling needs for one mesh. */
interface MeshSelectionState {
  mesh: THREE.Mesh;
  vertexIndicesBySegment: Map<number, number[]>;
  baseColors: Float32Array;
  centroidBySegment: Map<number, THREE.Vector3>;
}

function buildSelectionState(
  mesh: THREE.Mesh, labels: number[], alignment: THREE.Matrix4, colorOf: (segment: number) => THREE.Color,
): MeshSelectionState {
  const posAttr = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const colors = new Float32Array(posAttr.count * 3);
  const vertexIndicesBySegment = new Map<number, number[]>();
  const sumBySegment = new Map<number, THREE.Vector3>();
  const countBySegment = new Map<number, number>();
  const v = new THREE.Vector3();
  for (let i = 0; i < posAttr.count; i++) {
    const seg = labels[i] ?? 0;
    const color = colorOf(seg);
    colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;

    if (!vertexIndicesBySegment.has(seg)) vertexIndicesBySegment.set(seg, []);
    vertexIndicesBySegment.get(seg)!.push(i);

    v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(alignment);
    if (!sumBySegment.has(seg)) { sumBySegment.set(seg, v.clone()); countBySegment.set(seg, 1); }
    else { sumBySegment.get(seg)!.add(v); countBySegment.set(seg, (countBySegment.get(seg) ?? 0) + 1); }
  }
  mesh.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  mesh.material = new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide,
    // Pushes the surface back so the white segment outlines drawn on it stay visible.
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  });

  const centroidBySegment = new Map<number, THREE.Vector3>();
  for (const [seg, sum] of sumBySegment) centroidBySegment.set(seg, sum.divideScalar(countBySegment.get(seg) ?? 1));

  return { mesh, vertexIndicesBySegment, baseColors: colors.slice(), centroidBySegment };
}

/** Colour inputs of both chambers; kept apart from loading so new per-frame values recolour the meshes in place. */
interface ColorInputs {
  lvValues?: (number | null)[]; lvMin: number; lvMax: number; lvReverseColors: boolean;
  rvValues?: (number | null)[]; rvMin: number; rvMax: number; rvReverseColors: boolean;
}
const lvColorOf = (c: ColorInputs) => (seg: number) => valueToColor(c.lvValues?.[seg - 1], c.lvMin, c.lvMax, c.lvReverseColors);
// Value-heatmap colouring when real per-segment RV values are available (same fallback convention
// ReconstructedHeartModel's RV-only view uses) -- identity colours only before any RV strain/FAC is computed.
const rvColorOf = (c: ColorInputs) => (seg: number) =>
  c.rvValues ? valueToColor(c.rvValues[seg], c.rvMin, c.rvMax, c.rvReverseColors) : rvSegmentColor(seg);

/** Recolours a loaded mesh in place (base colours too, so the selection pulse restores to the new ones). */
function recolor(state: MeshSelectionState, colorOf: (segment: number) => THREE.Color) {
  const colorAttr = state.mesh.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!colorAttr) return;
  for (const [seg, indices] of state.vertexIndicesBySegment) {
    const color = colorOf(seg);
    for (const vi of indices) {
      state.baseColors[vi * 3] = color.r; state.baseColors[vi * 3 + 1] = color.g; state.baseColors[vi * 3 + 2] = color.b;
      colorAttr.setXYZ(vi, color.r, color.g, color.b);
    }
  }
  colorAttr.needsUpdate = true;
}

function writePositions(attr: THREE.BufferAttribute, positions: Float32Array) {
  for (let i = 0; i < attr.count; i++) attr.setXYZ(i, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  attr.needsUpdate = true;
}

export function CombinedHeartModel({
  lvMeshUrl, lvMeshFormat = "glb", lvSegmentLabels, lvValues, lvMin = -10, lvMax = 45, lvReverseColors = false,
  rvMeshUrl, rvMeshFormat = "glb", rvSegmentLabels, rvValues, rvMin = -10, rvMax = 45, rvReverseColors = false,
  className,
  initialCameraDistance = 11,
  selectedLvSegment = -1,
  onLvSegmentClick,
  selectedRvSegment = -1,
  onRvSegmentClick,
  lvMotionPositions = null,
  rvMotionPositions = null,
  onLvMotionUnusable,
  onRvMotionUnusable,
  motionTransitionMs = 0,
}: CombinedHeartModelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pivotRef = useRef<THREE.Object3D | null>(null);
  const loadedRef = useRef<THREE.Object3D | null>(null);
  const isPausedRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);

  const lvStateRef = useRef<MeshSelectionState | null>(null);
  const rvStateRef = useRef<MeshSelectionState | null>(null);
  // Outline materials need the canvas size (in pixels) to draw their fixed-width lines.
  const lineMaterialsRef = useRef<LineMaterial[]>([]);
  const selectedLvSegmentRef = useRef(selectedLvSegment);
  const selectedRvSegmentRef = useRef(selectedRvSegment);
  const onLvSegmentClickRef = useRef(onLvSegmentClick);
  const onRvSegmentClickRef = useRef(onRvSegmentClick);
  useEffect(() => { selectedLvSegmentRef.current = selectedLvSegment; }, [selectedLvSegment]);
  useEffect(() => { selectedRvSegmentRef.current = selectedRvSegment; }, [selectedRvSegment]);
  useEffect(() => { onLvSegmentClickRef.current = onLvSegmentClick; }, [onLvSegmentClick]);
  useEffect(() => { onRvSegmentClickRef.current = onRvSegmentClick; }, [onRvSegmentClick]);

  // Smooth motion: positions are applied only to meshes loaded from the URLs wanted NOW (until a new file has
  // loaded, the previous one is still on screen), on load and whenever the frame's positions change.
  const motionRef = useRef({ lv: lvMotionPositions, rv: rvMotionPositions });
  const wantedUrlsRef = useRef({ lv: lvMeshUrl ?? null, rv: rvMeshUrl ?? null });
  const loadedUrlsRef = useRef<{ lv: string | null; rv: string | null }>({ lv: null, rv: null });
  const onMotionUnusableRef = useRef({ lv: onLvMotionUnusable, rv: onRvMotionUnusable });
  useEffect(() => { onMotionUnusableRef.current = { lv: onLvMotionUnusable, rv: onRvMotionUnusable }; },
    [onLvMotionUnusable, onRvMotionUnusable]);
  // Each chamber's segment outlines (children of its mesh) and labels, so the outlines can follow the motion.
  const outlinesRef = useRef<{ lv: LineSegments2 | null; rv: LineSegments2 | null }>({ lv: null, rv: null });
  const outlineLabelsRef = useRef<{ lv: number[] | null; rv: number[] | null }>({ lv: null, rv: null });
  // Outline topology per chamber, built once per loaded mesh (each frame only re-reads positions).
  const outlineTopologyRef = useRef<{ lv: SegmentBoundaryTopology | null; rv: SegmentBoundaryTopology | null }>({ lv: null, rv: null });
  // Easing between frames: what is on screen (raw file coordinates) and the running animation.
  const motionTransitionMsRef = useRef(motionTransitionMs);
  useEffect(() => { motionTransitionMsRef.current = motionTransitionMs; }, [motionTransitionMs]);
  const shownRef = useRef<{ lv: Float32Array | null; rv: Float32Array | null }>({ lv: null, rv: null });
  const motionAnimationRef = useRef<number | null>(null);
  const stopMotionAnimation = () => {
    if (motionAnimationRef.current !== null) cancelAnimationFrame(motionAnimationRef.current);
    motionAnimationRef.current = null;
  };
  useEffect(() => stopMotionAnimation, []);

  const applyMotionRef = useRef<() => void>(() => {});
  applyMotionRef.current = () => {
    stopMotionAnimation();
    const duration = motionTransitionMsRef.current;
    type Job = {
      key: "lv" | "rv"; mesh: THREE.Mesh; attr: THREE.BufferAttribute; target: Float32Array; from: Float32Array | null;
      lineGeometry: LineSegmentsGeometry | null; fromLines: Float32Array | null; targetLines: Float32Array | null;
      workingLines: Float32Array | null; current: Float32Array;
    };
    const jobs: Job[] = [];
    for (const key of ["lv", "rv"] as const) {
      const state = key === "lv" ? lvStateRef.current : rvStateRef.current;
      const target = motionRef.current[key];
      if (!state || !target || loadedUrlsRef.current[key] !== wantedUrlsRef.current[key]) continue;
      const attr = state.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      if (target.length !== attr.count * 3) {
        console.warn(`[CombinedHeartModel] ${key.toUpperCase()} motion does not fit the loaded mesh; ignoring it`);
        onMotionUnusableRef.current[key]?.();
        continue;
      }
      const outline = outlinesRef.current[key];
      const labels = outlineLabelsRef.current[key];
      const lineGeometry = outline && labels ? (outline.geometry as LineSegmentsGeometry) : null;
      const fromLines = lineGeometry
        ? ((lineGeometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute | undefined)?.data.array as
            Float32Array | undefined)?.slice() ?? null
        : null;
      // The new frame's outlines are built once, from the new positions; in between, both are eased.
      writePositions(attr, target);
      if (lineGeometry && labels && !outlineTopologyRef.current[key]) {
        outlineTopologyRef.current[key] = buildSegmentBoundaryTopology(state.mesh, labels);
      }
      const topology = outlineTopologyRef.current[key];
      const targetLines = lineGeometry && topology ? segmentBoundaryEdgesAt(topology, state.mesh) : null;
      const from = shownRef.current[key];
      const easeLines = !!(fromLines && targetLines && fromLines.length === targetLines.length);
      jobs.push({
        key, mesh: state.mesh, attr, target, from: from && from.length === target.length ? from : null,
        lineGeometry, fromLines: easeLines ? fromLines : null, targetLines,
        workingLines: easeLines ? fromLines!.slice() : null, current: new Float32Array(target.length),
      });
    }
    const finish = (job: Job) => {
      writePositions(job.attr, job.target);
      shownRef.current[job.key] = job.target;
      if (job.lineGeometry && job.targetLines) job.lineGeometry.setPositions(job.targetLines);
      job.mesh.geometry.computeBoundingSphere();
    };
    const easing = duration > 0 ? jobs.filter((job) => job.from) : [];
    jobs.filter((job) => !easing.includes(job)).forEach(finish);
    if (!easing.length) return;
    for (const job of easing) if (job.lineGeometry && job.workingLines) job.lineGeometry.setPositions(job.workingLines);
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      if (t >= 1) {
        easing.forEach(finish);
        motionAnimationRef.current = null;
        return;
      }
      for (const job of easing) {
        const from = job.from!;
        for (let i = 0; i < job.current.length; i++) job.current[i] = from[i] + (job.target[i] - from[i]) * t;
        writePositions(job.attr, job.current);
        shownRef.current[job.key] = job.current;
        if (job.lineGeometry && job.workingLines && job.fromLines && job.targetLines) {
          for (let i = 0; i < job.workingLines.length; i++) {
            job.workingLines[i] = job.fromLines[i] + (job.targetLines[i] - job.fromLines[i]) * t;
          }
          (job.lineGeometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
        }
      }
      motionAnimationRef.current = requestAnimationFrame(step);
    };
    step(start);                                       // same tick: the target is never drawn before the easing starts
  };

  // Colours follow the values without reloading the meshes (the values change every frame during playback).
  const colorInputs: ColorInputs = { lvValues, lvMin, lvMax, lvReverseColors, rvValues, rvMin, rvMax, rvReverseColors };
  const colorInputsRef = useRef(colorInputs);
  colorInputsRef.current = colorInputs;
  useLayoutEffect(() => {
    const inputs = colorInputsRef.current;
    if (lvStateRef.current) recolor(lvStateRef.current, lvColorOf(inputs));
    if (rvStateRef.current) recolor(rvStateRef.current, rvColorOf(inputs));
  }, [lvValues, lvMin, lvMax, lvReverseColors, rvValues, rvMin, rvMax, rvReverseColors]);
  useLayoutEffect(() => {
    wantedUrlsRef.current = { lv: lvMeshUrl ?? null, rv: rvMeshUrl ?? null };
  }, [lvMeshUrl, rvMeshUrl]);
  useLayoutEffect(() => {
    motionRef.current = { lv: lvMotionPositions, rv: rvMotionPositions };
    applyMotionRef.current();
  }, [lvMotionPositions, rvMotionPositions]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
    camera.position.set(0, 0.5, initialCameraDistance);
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
      for (const material of lineMaterialsRef.current) material.resolution.set(width, height);
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
    const meshesToHit = () => [lvStateRef.current?.mesh, rvStateRef.current?.mesh].filter((m): m is THREE.Mesh => !!m);
    const onClick = (event: MouseEvent) => {
      pointerFromEvent(event);
      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects(meshesToHit(), false);
      const hit = intersects[0];
      const vertexIndex = hit?.face?.a;
      if (vertexIndex === undefined) return;
      if (hit.object === lvStateRef.current?.mesh) {
        const seg = lvSegmentLabels?.[vertexIndex];
        if (seg !== undefined) onLvSegmentClickRef.current?.(seg);
      } else if (hit.object === rvStateRef.current?.mesh) {
        const seg = rvSegmentLabels?.[vertexIndex];
        if (seg !== undefined) onRvSegmentClickRef.current?.(seg);
      }
    };
    const onMouseMove = (event: MouseEvent) => {
      const meshes = meshesToHit();
      if (!meshes.length) return;
      pointerFromEvent(event);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(meshes, false).length > 0;
      renderer.domElement.style.cursor = hit && (onLvSegmentClickRef.current || onRvSegmentClickRef.current) ? "pointer" : "default";
    };
    renderer.domElement.addEventListener("click", onClick);
    renderer.domElement.addEventListener("mousemove", onMouseMove);

    // Pulses the selected segment's color, same effect as
    // ReconstructedHeartModel's updateSelectionHighlight -- tracked
    // separately for LV/RV since either (or neither, never both) can be
    // selected at once.
    let lastPulsed: { chamber: "lv" | "rv"; segment: number } | null = null;
    const clock = new THREE.Clock();
    const updateSelectionHighlight = () => {
      const lvSel = selectedLvSegmentRef.current ?? -1;
      const rvSel = selectedRvSegmentRef.current ?? -1;
      const current: { chamber: "lv" | "rv"; segment: number } | null =
        lvSel >= 1 ? { chamber: "lv", segment: lvSel } : rvSel >= 0 ? { chamber: "rv", segment: rvSel } : null;

      const restore = (target: { chamber: "lv" | "rv"; segment: number }) => {
        const state = target.chamber === "lv" ? lvStateRef.current : rvStateRef.current;
        if (!state) return;
        const colorAttr = state.mesh.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
        const indices = state.vertexIndicesBySegment.get(target.segment);
        if (!colorAttr || !indices) return;
        for (const vi of indices) colorAttr.setXYZ(vi, state.baseColors[vi * 3], state.baseColors[vi * 3 + 1], state.baseColors[vi * 3 + 2]);
        colorAttr.needsUpdate = true;
      };

      if (!current || lastPulsed?.chamber !== current.chamber || lastPulsed?.segment !== current.segment) {
        if (lastPulsed) restore(lastPulsed);
        lastPulsed = current;
      }
      if (!current) return;

      const state = current.chamber === "lv" ? lvStateRef.current : rvStateRef.current;
      if (!state) return;
      const colorAttr = state.mesh.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
      const indices = state.vertexIndicesBySegment.get(current.segment);
      if (!colorAttr || !indices) return;
      const t = ((Math.sin(clock.getElapsedTime() * 6) + 1) / 2) * 0.9;
      for (const vi of indices) {
        const r = state.baseColors[vi * 3], g = state.baseColors[vi * 3 + 1], b = state.baseColors[vi * 3 + 2];
        colorAttr.setXYZ(vi, r + (1 - r) * t, g + (1 - g) * t, b + (1 - b) * t);
      }
      colorAttr.needsUpdate = true;
    };

    // Rotates the pivot so a newly-selected segment (on EITHER chamber)
    // faces the camera -- same math as ReconstructedHeartModel's own
    // updateFocusRotation, using the segment's centroid in the ALIGNED
    // frame (already computed once at load time in buildSelectionState, so
    // this doesn't need to know about `group`'s transform at all).
    let lastFocused: { chamber: "lv" | "rv"; segment: number } | null = null;
    let focusTargetY: number | null = null;
    const FOCUS_LERP_RATE = 0.12;
    const updateFocusRotation = (): boolean => {
      const lvSel = selectedLvSegmentRef.current ?? -1;
      const rvSel = selectedRvSegmentRef.current ?? -1;
      const current: { chamber: "lv" | "rv"; segment: number } | null =
        lvSel >= 1 ? { chamber: "lv", segment: lvSel } : rvSel >= 0 ? { chamber: "rv", segment: rvSel } : null;

      if (!current || lastFocused?.chamber !== current.chamber || lastFocused?.segment !== current.segment) {
        lastFocused = current;
        if (current) {
          const state = current.chamber === "lv" ? lvStateRef.current : rvStateRef.current;
          const centroid = state?.centroidBySegment.get(current.segment);
          focusTargetY = centroid ? -Math.atan2(centroid.x, centroid.z) : null;
        } else {
          focusTargetY = null;
        }
      }

      if (focusTargetY === null || isDragging) return false;
      let delta = focusTargetY - pivot.rotation.y;
      delta = ((delta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      pivot.rotation.y += delta * FOCUS_LERP_RATE;
      return true;
    };

    let animationId = 0;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      const focusing = updateFocusRotation();
      const hasSelection = (selectedLvSegmentRef.current ?? -1) >= 1 || (selectedRvSegmentRef.current ?? -1) >= 0;
      if (!isDragging && !isPausedRef.current && !focusing && !hasSelection) {
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
      if (loadedRef.current) disposeObject(loadedRef.current);
      renderer.dispose();
      renderer.domElement.remove();
      pivotRef.current = null;
      loadedRef.current = null;
      lvStateRef.current = null;
      rvStateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const pivot = pivotRef.current;
    if (!pivot || !lvMeshUrl || !lvSegmentLabels?.length) return;
    let cancelled = false;

    (async () => {
      try {
        const lvObject = await loadMesh(lvMeshUrl, lvMeshFormat);
        const lvMesh = findFirstMesh(lvObject);
        if (!lvMesh) return;
        const lvPos = lvMesh.geometry.getAttribute("position") as THREE.BufferAttribute;

        const alignment = computeLvAlignment(lvPos, lvSegmentLabels);

        const lvState = buildSelectionState(lvMesh, lvSegmentLabels, alignment, lvColorOf(colorInputsRef.current));
        const outlineSize = {
          width: containerRef.current?.clientWidth ?? 1,
          height: containerRef.current?.clientHeight ?? 1,
        };
        const outlines: THREE.Object3D[] = [];
        const lvLines = createSegmentBoundaryLines(lvMesh, lvSegmentLabels, outlineSize);
        lvMesh.add(lvLines);
        outlines.push(lvLines);

        let rvObject: THREE.Object3D | null = null;
        let rvState: MeshSelectionState | null = null;
        let rvLines: LineSegments2 | null = null;
        if (rvMeshUrl && rvSegmentLabels?.length) {
          rvObject = await loadMesh(rvMeshUrl, rvMeshFormat);
          const rvMesh = findFirstMesh(rvObject);
          if (rvMesh) {
            rvState = buildSelectionState(rvMesh, rvSegmentLabels, alignment, rvColorOf(colorInputsRef.current));
            rvLines = createSegmentBoundaryLines(rvMesh, rvSegmentLabels, outlineSize);
            rvMesh.add(rvLines);
            outlines.push(rvLines);
          }
        }

        if (cancelled) return;

        if (loadedRef.current) {
          pivot.remove(loadedRef.current);
          disposeObject(loadedRef.current);
        }

        // ONE group carries the shared alignment transform; LV and RV are
        // added as its children in their RAW (un-rotated, un-scaled)
        // coordinates, so their real relative position/size is preserved
        // exactly -- only their shared frame moves, never one chamber
        // independently of the other.
        const group = new THREE.Object3D();
        group.applyMatrix4(alignment);
        group.add(lvObject);
        if (rvObject) group.add(rvObject);
        pivot.add(group);
        loadedRef.current = group;
        lineMaterialsRef.current = outlines.map((o) => (o as unknown as { material: LineMaterial }).material);
        lvStateRef.current = lvState;
        rvStateRef.current = rvState;
        loadedUrlsRef.current = { lv: lvMeshUrl, rv: rvState ? rvMeshUrl ?? null : null };
        outlinesRef.current = { lv: lvLines, rv: rvLines };
        outlineLabelsRef.current = { lv: lvSegmentLabels, rv: rvState ? rvSegmentLabels ?? null : null };
        outlineTopologyRef.current = { lv: null, rv: null };
        stopMotionAnimation();
        shownRef.current = { lv: null, rv: null };     // fresh meshes start from their own (ED) positions
        // Values may have changed while the files were loading.
        recolor(lvState, lvColorOf(colorInputsRef.current));
        if (rvState) recolor(rvState, rvColorOf(colorInputsRef.current));
        applyMotionRef.current();
      } catch (err) {
        console.error("[CombinedHeartModel] Failed to load combined LV+RV mesh:", err);
      }
    })();

    return () => { cancelled = true; };
    // Colour values are deliberately not dependencies: they change every frame and only recolour (effect above).
  }, [lvMeshUrl, lvMeshFormat, lvSegmentLabels, rvMeshUrl, rvMeshFormat, rvSegmentLabels]);

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`} aria-label="Combined LV+RV 3D heart model">
      <button
        type="button"
        onClick={() => { isPausedRef.current = !isPausedRef.current; setIsPaused((p) => !p); }}
        className="absolute bottom-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white transition-colors hover:bg-black/70"
        title={isPaused ? "Resume rotation" : "Pause rotation"}
      >
        {isPaused ? (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><path d="M0 0 L10 6 L0 12 Z" /></svg>
        ) : (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor"><rect x="0" y="0" width="3" height="12" /><rect x="7" y="0" width="3" height="12" /></svg>
        )}
      </button>
    </div>
  );
}
