"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

type HeartSegmentAsset = {
  ahaIndex: number;
  // Label must match AHA_SEGMENTS order in page.tsx:
  // 1=Basal Anterior, 2=Basal Anterolateral, 3=Basal Inferolateral,
  // 4=Basal Inferior,  5=Basal Inferoseptal,  6=Basal Anteroseptal,
  // 7=Mid Anterior,    8=Mid Anterolateral,    9=Mid Inferolateral,
  // 10=Mid Inferior,   11=Mid Inferoseptal,    12=Mid Anteroseptal,
  // 13=Apical Anterior, 14=Apical Lateral, 15=Apical Inferior,
  // 16=Apical Septal,   17=Apex
  label: string;
  className: string;
  file: string;
};

// Fix 1: labels corrected to match page.tsx AHA_SEGMENTS order exactly.
// Previously indices 1,2,4,5 (and 7,8,10,11 and 13,15) had Lateral/Septal swapped.
const HEART_SEGMENTS: HeartSegmentAsset[] = [
  { ahaIndex: 1,  label: "Basal Anterior",     className: "InferiorPosteriorLV", file: "MM631_BP52012_FMA9561_Inferior.obj" },
  { ahaIndex: 2,  label: "Basal Anterolateral", className: "SeptalLV",            file: "MM629_BP52013_FMA9345_Septal.obj" },
  { ahaIndex: 3,  label: "Basal Inferolateral", className: "SeptalLV",            file: "MM613_BP52013_FMA9345_Septal.obj" },
  { ahaIndex: 4,  label: "Basal Inferior",      className: "AnteriorLV",          file: "MM614_BP52011_FMA9560_Anterior.obj" },
  { ahaIndex: 5,  label: "Basal Inferoseptal",  className: "LateralLV",           file: "MM615_BP52010_FMA9563_Lateral.obj" },
  { ahaIndex: 6,  label: "Basal Anteroseptal",  className: "InferiorPosteriorLV", file: "MM616_BP52012_FMA9561_Inferior.obj" },
  { ahaIndex: 7,  label: "Mid Anterior",        className: "InferiorPosteriorLV", file: "MM623_BP52012_FMA9561_Inferior.obj" },
  { ahaIndex: 8,  label: "Mid Anterolateral",   className: "SeptalLV",            file: "MM618_BP52013_FMA9345_Septal.obj" },
  { ahaIndex: 9,  label: "Mid Inferolateral",   className: "SeptalLV",            file: "MM619_BP52013_FMA9345_Septal.obj" },
  { ahaIndex: 10, label: "Mid Inferior",        className: "AnteriorLV",          file: "MM620_BP52011_FMA9560_Anterior.obj" },
  { ahaIndex: 11, label: "Mid Inferoseptal",    className: "LateralLV",           file: "MM621_BP52010_FMA9563_Lateral.obj" },
  { ahaIndex: 12, label: "Mid Anteroseptal",    className: "InferiorPosteriorLV", file: "MM622_BP52012_FMA9561_Inferior.obj" },
  { ahaIndex: 13, label: "Apical Anterior",     className: "InferiorPosteriorLV", file: "MM626_BP52012_FMA9561_Inferior.obj" },
  { ahaIndex: 14, label: "Apical Lateral",      className: "SeptalLV",            file: "MM625_BP52013_FMA9345_Septal.obj" },
  { ahaIndex: 15, label: "Apical Inferior",     className: "AnteriorLV",          file: "MM624_BP52011_FMA9560_Anterior.obj" },
  { ahaIndex: 16, label: "Apical Septal",       className: "LateralLV",           file: "MM627_BP52010_FMA9563_Lateral.obj" },
  { ahaIndex: 17, label: "Apex",                className: "AnteriorLV",          file: "MM628_BP52011_FMA9560_Anterior.obj" },
];


type AnimatedMesh = {
  mesh: THREE.Mesh;
  targetColor: THREE.Color;
  baseColor: THREE.Color;
  segmentIndex: number;
};

interface ClientHeartModelProps {
  values: number[];
  min?: number;
  mid?: number;
  max?: number;
  className?: string;
  onZoomChange?: (fn: (delta: number) => void) => void;
  onResetZoom?: (fn: () => void) => void;
  // Fix 3: 0-based selected segment index, -1 = none
  selectedSegment?: number;
  // When true, low value = green (used for GCS where more negative = healthier)
  reverseColors?: boolean;
}

// Identical colour ramp to the 2D bullseye's rdYlGn + segmentColor:
// Red (0) → Yellow (0.5) → Green (1)
function rdYlGn(t: number): THREE.Color {
  const r = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
  const g = t < 0.5 ? t * 2 : 1;
  return new THREE.Color(r, g, 0);
}

function valueToColor(value: number, min: number, max: number, reverse = false): THREE.Color {
  if (!Number.isFinite(value) || max === min) return new THREE.Color(0.267, 0.267, 0.267); // #444
  let t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  if (reverse) t = 1 - t;
  return rdYlGn(t);
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((material) => material.dispose());
    } else {
      mesh.material?.dispose();
    }
  });
}

export function ClientHeartModel({
  values,
  min = -10,
  mid: _mid = 5,
  max = 45,
  className,
  onZoomChange,
  onResetZoom,
  selectedSegment = -1,
  reverseColors = false,
}: ClientHeartModelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const meshesRef = useRef<AnimatedMesh[]>([]);
  const valuesRef = useRef(values);
  const rangeRef = useRef({ min, max });
  const reverseColorsRef = useRef(reverseColors);
  // Fix 3: ref so the animation loop closure reads the latest value
  const selectedSegmentRef = useRef(selectedSegment);

  // Tooltip state
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    label: string;
    value: number;
  } | null>(null);

  // Fix 2: pause/resume state — ref for animation loop, state for button render
  const isPausedRef = useRef(false);
  const [isPaused, setIsPaused] = useState(false);

  // Sync latest values/range/reverseColors into refs and update target colours
  useEffect(() => {
    valuesRef.current = values;
    rangeRef.current = { min, max };
    reverseColorsRef.current = reverseColors;
    meshesRef.current.forEach((entry) => {
      const c = valueToColor(values[entry.segmentIndex] ?? min, min, max, reverseColors);
      entry.targetColor = c.clone();
      entry.baseColor = c.clone();
    });
  }, [max, min, values, reverseColors]);

  // Sync selectedSegment ref for the animation loop
  useEffect(() => {
    selectedSegmentRef.current = selectedSegment;
  }, [selectedSegment]);

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
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x333333, 1.25);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(-4, 3, 6);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.55);
    fillLight.position.set(4, 0, 4);
    const backLight = new THREE.DirectionalLight(0xffffff, 0.65);
    backLight.position.set(3, 2, -5);
    scene.add(hemiLight, keyLight, fillLight, backLight);

    const pivot = new THREE.Object3D();
    const group = new THREE.Group();
    pivot.add(group);
    scene.add(pivot);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enablePan = false;
    controls.enableZoom = true;
    controls.minDistance = 5;
    controls.maxDistance = 20;
    controls.autoRotate = false;
    controls.target.set(0, 0, 0);
    controls.update();

    // Pause auto-rotation while dragging
    let isDragging = false;
    const onControlsStart = () => { isDragging = true; };
    const onControlsEnd = () => { isDragging = false; };
    controls.addEventListener("start", onControlsStart);
    controls.addEventListener("end", onControlsEnd);

    const loader = new OBJLoader();
    let cancelled = false;
    let loaded = 0;
    const loadedObjects: THREE.Object3D[] = [];

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const meshToSegmentIndex = new Map<string, number>();

    const onMouseMove = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const allMeshes = meshesRef.current.map((e) => e.mesh);
      const intersects = raycaster.intersectObjects(allMeshes, false);

      if (intersects.length > 0) {
        const hit = intersects[0].object as THREE.Mesh;
        const segIdx = meshToSegmentIndex.get(hit.uuid);
        if (segIdx !== undefined) {
          const seg = HEART_SEGMENTS[segIdx];
          const val = valuesRef.current[segIdx];
          setTooltip({
            x: event.clientX,
            y: event.clientY,
            label: seg?.label ?? `Segment ${segIdx + 1}`,
            value: val,
          });
          renderer.domElement.style.cursor = "pointer";
          return;
        }
      }
      setTooltip(null);
      renderer.domElement.style.cursor = "default";
    };

    const onMouseLeave = () => {
      setTooltip(null);
      renderer.domElement.style.cursor = "default";
    };

    renderer.domElement.addEventListener("mousemove", onMouseMove);
    renderer.domElement.addEventListener("mouseleave", onMouseLeave);

    HEART_SEGMENTS.forEach((segment, index) => {
      loader.load(
        `/client-heart-assets/${segment.className}/${segment.file}`,
        (object) => {
          if (cancelled) { disposeObject(object); return; }

          object.name = segment.label;
          object.scale.setScalar(1 / 15);
          object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;

            const range = rangeRef.current;
            const color = valueToColor(valuesRef.current[index] ?? range.min, range.min, range.max, reverseColorsRef.current);
            mesh.material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
            meshesRef.current.push({
              mesh,
              targetColor: color.clone(),
              baseColor: color.clone(),
              segmentIndex: index,
            });
            meshToSegmentIndex.set(mesh.uuid, index);
          });

          group.add(object);
          loadedObjects.push(object);
          loaded += 1;

          if (loaded === HEART_SEGMENTS.length) {
            const box = new THREE.Box3().setFromObject(group);
            const center = box.getCenter(new THREE.Vector3());
            group.position.sub(center);
            const centeredBox = new THREE.Box3().setFromObject(group);
            const size = centeredBox.getSize(new THREE.Vector3());
            const maxDimension = Math.max(size.x, size.y, size.z, 0.0001);
            group.scale.setScalar(3.55 / maxDimension);
            group.updateMatrixWorld(true);
            const scaledCenter = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
            group.position.sub(scaledCenter);
          }
        },
      );
    });

    if (onZoomChange) {
      onZoomChange((delta: number) => {
        const zoomFactor = delta > 0 ? 1.2 : 0.85;
        const newDist = Math.min(
          controls.maxDistance,
          Math.max(controls.minDistance, camera.position.distanceTo(controls.target) * zoomFactor),
        );
        const dir = camera.position.clone().sub(controls.target).normalize();
        camera.position.copy(controls.target).addScaledVector(dir, newDist);
        controls.update();
      });
    }
    if (onResetZoom) {
      onResetZoom(() => {
        camera.position.set(0, 0.5, 11);
        camera.lookAt(0, 0, 0);
        controls.target.set(0, 0, 0);
        controls.update();
      });
    }

    const themeObserver = new MutationObserver(() => { /* no-op — background is transparent */ });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

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

    const clock = new THREE.Clock();
    let animationId = 0;
    const animate = () => {
      animationId = requestAnimationFrame(animate);

      const sel = selectedSegmentRef.current;
      const paused = isPausedRef.current;

      // Auto-rotate unless dragging or paused
      if (!isDragging && !paused) {
        pivot.rotation.x += 0.001;
        pivot.rotation.y += 0.006;
        pivot.rotation.z += 0.0002;
      }

      // Colour blink pulse for selected segment
      const elapsed = clock.getElapsedTime();
      const pulse = (Math.sin(elapsed * 6) + 1) / 2; // 0–1

      meshesRef.current.forEach((entry) => {
        const material = entry.mesh.material as THREE.MeshBasicMaterial;
        if (entry.segmentIndex === sel) {
          material.color.lerpColors(entry.baseColor, new THREE.Color(1, 1, 1), pulse * 0.9);
        } else {
          material.color.lerp(entry.targetColor, 0.04);
        }
      });

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationId);
      controls.removeEventListener("start", onControlsStart);
      controls.removeEventListener("end", onControlsEnd);
      renderer.domElement.removeEventListener("mousemove", onMouseMove);
      renderer.domElement.removeEventListener("mouseleave", onMouseLeave);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      controls.dispose();
      loadedObjects.forEach(disposeObject);
      renderer.dispose();
      renderer.domElement.remove();
      meshesRef.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`} aria-label="Client 3D AHA heart model">
      {/* Fix 2: pause/resume rotation button */}
      <button
        type="button"
        onClick={() => {
          isPausedRef.current = !isPausedRef.current;
          setIsPaused((p) => !p);
        }}
        className="absolute bottom-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/50 text-white transition-colors hover:bg-black/70"
        title={isPaused ? "Resume rotation" : "Pause rotation"}
      >
        {isPaused ? (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
            <path d="M0 0 L10 6 L0 12 Z" />
          </svg>
        ) : (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
            <rect x="0" y="0" width="3" height="12" />
            <rect x="7" y="0" width="3" height="12" />
          </svg>
        )}
      </button>

      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none rounded px-2 py-1 text-xs border border-white/20 bg-black/80 text-white"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          <span className="font-semibold">{tooltip.label}</span>
          <br />
          {Number.isFinite(tooltip.value) ? tooltip.value.toFixed(2) : "—"} mm
        </div>
      )}
    </div>
  );
}
