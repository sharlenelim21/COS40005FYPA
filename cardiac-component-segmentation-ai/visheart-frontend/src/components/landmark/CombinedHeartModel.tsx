"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { valueToColor, rvSegmentColor } from "./heartColor";

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
 * A simpler, lower-risk sibling of ReconstructedHeartModel rather than a
 * merge into it: no click/hover/boundary-line support yet (this is the
 * first combined view at all, previously a stub placeholder), just the two
 * meshes correctly positioned, colored, and orbitable together.
 */
interface CombinedHeartModelProps {
  lvMeshUrl?: string | null;
  lvMeshFormat?: "obj" | "glb";
  lvSegmentLabels?: number[] | null;
  lvValues?: number[];
  lvMin?: number;
  lvMax?: number;
  lvReverseColors?: boolean;
  rvMeshUrl?: string | null;
  rvMeshFormat?: "obj" | "glb";
  rvSegmentLabels?: number[] | null;
  className?: string;
}

function findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((child) => {
    if (!found && (child as THREE.Mesh).isMesh) found = child as THREE.Mesh;
  });
  return found;
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

function loadMesh(url: string, format: "obj" | "glb"): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    if (format === "glb") {
      new GLTFLoader().load(url, (gltf) => resolve(gltf.scene), undefined, reject);
    } else {
      new OBJLoader().load(url, (object) => resolve(object), undefined, reject);
    }
  });
}

// Same apex/base/azimuth-anchor convention as ReconstructedHeartModel's LV
// case (see that file's alignCenterAndScale) -- duplicated rather than
// imported since that logic is tangled with per-mesh state there; kept
// small and in sync manually.
const LV_APEX_LABELS = [17];
const LV_BASE_LABELS = [1, 2, 3, 4, 5, 6];
const LV_AZIMUTH_ANCHOR_LABEL = 1;
const AZIMUTH_TARGET_DIRECTION = new THREE.Vector3(0, 0, 1);
const LV_TARGET_SIZE = 3.55;

function computeSharedAlignment(lvVertices: THREE.BufferAttribute, lvLabels: number[]): THREE.Matrix4 {
  const centroidOf = (wanted: Set<number>): THREE.Vector3 | null => {
    const sum = new THREE.Vector3();
    let count = 0;
    for (let i = 0; i < lvVertices.count; i++) {
      const label = lvLabels[i];
      if (label === undefined || !wanted.has(label)) continue;
      sum.x += lvVertices.getX(i);
      sum.y += lvVertices.getY(i);
      sum.z += lvVertices.getZ(i);
      count++;
    }
    return count >= 3 ? sum.divideScalar(count) : null;
  };

  let rotation = new THREE.Quaternion();
  const apex = centroidOf(new Set(LV_APEX_LABELS));
  const base = centroidOf(new Set(LV_BASE_LABELS));
  if (apex && base) {
    const apexToBase = base.clone().sub(apex);
    if (apexToBase.lengthSq() > 1e-8) {
      apexToBase.normalize();
      rotation = new THREE.Quaternion().setFromUnitVectors(apexToBase, new THREE.Vector3(0, 1, 0));
      const anchor = centroidOf(new Set([LV_AZIMUTH_ANCHOR_LABEL]));
      if (anchor) {
        const rotatedAnchor = anchor.clone().sub(base).applyQuaternion(rotation);
        rotatedAnchor.y = 0;
        if (rotatedAnchor.lengthSq() > 1e-8) {
          rotatedAnchor.normalize();
          const azimuthRotation = new THREE.Quaternion().setFromUnitVectors(rotatedAnchor, AZIMUTH_TARGET_DIRECTION);
          rotation = azimuthRotation.multiply(rotation);
        }
      }
    }
  }

  const rotationMatrix = new THREE.Matrix4().makeRotationFromQuaternion(rotation);

  // Bounding box of the ROTATED LV mesh only -- RV rides along at whatever
  // size that puts it at, which is correct (it's the real chamber whose
  // size is relative to LV, not something to independently normalize).
  const rotatedLv = new Float32Array(lvVertices.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < lvVertices.count; i++) {
    v.set(lvVertices.getX(i), lvVertices.getY(i), lvVertices.getZ(i)).applyMatrix4(rotationMatrix);
    rotatedLv[i * 3] = v.x; rotatedLv[i * 3 + 1] = v.y; rotatedLv[i * 3 + 2] = v.z;
  }
  const box = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(rotatedLv, 3));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 0.0001);
  const scale = LV_TARGET_SIZE / maxDimension;

  const centerAndScale = new THREE.Matrix4()
    .makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));

  return centerAndScale.multiply(rotationMatrix);
}

export function CombinedHeartModel({
  lvMeshUrl, lvMeshFormat = "glb", lvSegmentLabels, lvValues, lvMin = -10, lvMax = 45, lvReverseColors = false,
  rvMeshUrl, rvMeshFormat = "glb", rvSegmentLabels,
  className,
}: CombinedHeartModelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pivotRef = useRef<THREE.Object3D | null>(null);
  const loadedRef = useRef<THREE.Object3D | null>(null);
  const isPausedRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);

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
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    let animationId = 0;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      if (!isDragging && !isPausedRef.current) {
        pivot.rotation.y += 0.006;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationId);
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
      resizeObserver.disconnect();
      controls.dispose();
      if (loadedRef.current) disposeObject(loadedRef.current);
      renderer.dispose();
      renderer.domElement.remove();
      pivotRef.current = null;
      loadedRef.current = null;
    };
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

        const alignment = computeSharedAlignment(lvPos, lvSegmentLabels);

        const colorLv = () => {
          const colors = new Float32Array(lvPos.count * 3);
          for (let i = 0; i < lvPos.count; i++) {
            const seg = lvSegmentLabels[i] ?? 0;
            const value = lvValues?.[seg - 1];
            const color = value !== undefined
              ? valueToColor(value, lvMin, lvMax, lvReverseColors)
              : new THREE.Color(0.6, 0.2, 0.2);
            colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
          }
          lvMesh.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
          lvMesh.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
        };
        colorLv();

        let rvObject: THREE.Object3D | null = null;
        if (rvMeshUrl && rvSegmentLabels?.length) {
          rvObject = await loadMesh(rvMeshUrl, rvMeshFormat);
          const rvMesh = findFirstMesh(rvObject);
          if (rvMesh) {
            const rvPos = rvMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
            const colors = new Float32Array(rvPos.count * 3);
            for (let i = 0; i < rvPos.count; i++) {
              const seg = rvSegmentLabels[i] ?? 0;
              const color = rvSegmentColor(seg);
              colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
            }
            rvMesh.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
            rvMesh.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
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
      } catch (err) {
        console.error("[CombinedHeartModel] Failed to load combined LV+RV mesh:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [lvMeshUrl, lvMeshFormat, lvSegmentLabels, lvValues, lvMin, lvMax, lvReverseColors, rvMeshUrl, rvMeshFormat, rvSegmentLabels]);

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`} aria-label="Combined LV+RV 3D heart model">
      <button
        type="button"
        onClick={() => { isPausedRef.current = !isPausedRef.current; setIsPaused((p) => !p); }}
        className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white transition-colors hover:bg-black/70"
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
