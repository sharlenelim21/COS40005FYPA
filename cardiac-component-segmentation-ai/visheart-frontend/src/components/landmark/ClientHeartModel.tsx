"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";

type HeartSegmentAsset = {
  ahaIndex: number;
  label: string;
  className: string;
  file: string;
};

const HEART_SEGMENTS: HeartSegmentAsset[] = [
  { ahaIndex: 1, label: "Basal Anterior", className: "InferiorPosteriorLV", file: "MM631_BP52012_FMA9561_Inferior.obj" },
  { ahaIndex: 2, label: "Basal Anteroseptal", className: "SeptalLV", file: "MM629_BP52013_FMA9345_Septal.obj" },
  { ahaIndex: 3, label: "Basal Inferoseptal", className: "SeptalLV", file: "MM613_BP52013_FMA9345_Septal.obj" },
  { ahaIndex: 4, label: "Basal Inferior", className: "AnteriorLV", file: "MM614_BP52011_FMA9560_Anterior.obj" },
  { ahaIndex: 5, label: "Basal Inferolateral", className: "LateralLV", file: "MM615_BP52010_FMA9563_Lateral.obj" },
  { ahaIndex: 6, label: "Basal Anterolateral", className: "InferiorPosteriorLV", file: "MM616_BP52012_FMA9561_Inferior.obj" },
  { ahaIndex: 7, label: "Mid Anterior", className: "InferiorPosteriorLV", file: "MM623_BP52012_FMA9561_Inferior.obj" },
  { ahaIndex: 8, label: "Mid Anteroseptal", className: "SeptalLV", file: "MM618_BP52013_FMA9345_Septal.obj" },
  { ahaIndex: 9, label: "Mid Inferoseptal", className: "SeptalLV", file: "MM619_BP52013_FMA9345_Septal.obj" },
  { ahaIndex: 10, label: "Mid Inferior", className: "AnteriorLV", file: "MM620_BP52011_FMA9560_Anterior.obj" },
  { ahaIndex: 11, label: "Mid Inferolateral", className: "LateralLV", file: "MM621_BP52010_FMA9563_Lateral.obj" },
  { ahaIndex: 12, label: "Mid Anterolateral", className: "InferiorPosteriorLV", file: "MM622_BP52012_FMA9561_Inferior.obj" },
  { ahaIndex: 13, label: "Apical Anterior", className: "InferiorPosteriorLV", file: "MM626_BP52012_FMA9561_Inferior.obj" },
  { ahaIndex: 14, label: "Apical Septal", className: "SeptalLV", file: "MM625_BP52013_FMA9345_Septal.obj" },
  { ahaIndex: 15, label: "Apical Inferior", className: "AnteriorLV", file: "MM624_BP52011_FMA9560_Anterior.obj" },
  { ahaIndex: 16, label: "Apical Lateral", className: "LateralLV", file: "MM627_BP52010_FMA9563_Lateral.obj" },
  { ahaIndex: 17, label: "Apex", className: "AnteriorLV", file: "MM628_BP52011_FMA9560_Anterior.obj" },
];

type AnimatedMesh = {
  mesh: THREE.Mesh;
  targetColor: THREE.Color;
};

interface ClientHeartModelProps {
  values: number[];
  min?: number;
  mid?: number;
  max?: number;
  className?: string;
  onZoomChange?: (fn: (delta: number) => void) => void;
  onResetZoom?: (fn: () => void) => void;
}

function valueToColor(value: number, min: number, mid: number, max: number) {
  const safeValue = Number.isFinite(value) ? value : mid;
  const normalized =
    safeValue <= mid
      ? 0.5 * (safeValue - min) / Math.max(mid - min, 0.0001)
      : 0.5 + 0.5 * (safeValue - mid) / Math.max(max - mid, 0.0001);
  const t = Math.max(0, Math.min(1, normalized));

  if (t < 0.5) {
    const local = t / 0.5;
    return new THREE.Color(
      1 - local,
      local,
      0,
    );
  }

  const local = (t - 0.5) / 0.5;
  return new THREE.Color(
    local,
    1 - local,
    0,
  );
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
  mid = 5,
  max = 45,
  className,
  onZoomChange,
  onResetZoom,
}: ClientHeartModelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const meshesRef = useRef<AnimatedMesh[]>([]);
  const valuesRef = useRef(values);
  const rangeRef = useRef({ min, mid, max });

  useEffect(() => {
    valuesRef.current = values;
    rangeRef.current = { min, mid, max };
    meshesRef.current.forEach((entry, index) => {
      entry.targetColor = valueToColor(values[index] ?? mid, min, mid, max);
    });
  }, [max, mid, min, values]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isDark = () => document.documentElement.classList.contains("dark");
    const getBg = () => new THREE.Color(isDark() ? "#18181b" : "#f8fafc"); // zinc-900 / slate-50 — matches bullseye panel

    const scene = new THREE.Scene();
    scene.background = getBg();

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
    camera.position.set(0, 0.5, 11);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
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

    const loader = new OBJLoader();
    let cancelled = false;
    let loaded = 0;
    const loadedObjects: THREE.Object3D[] = [];

    HEART_SEGMENTS.forEach((segment, index) => {
      loader.load(
        `/client-heart-assets/${segment.className}/${segment.file}`,
        (object) => {
          if (cancelled) {
            disposeObject(object);
            return;
          }

          object.name = segment.label;
          object.scale.setScalar(1 / 15);
          object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;

            const range = rangeRef.current;
            const color = valueToColor(valuesRef.current[index] ?? range.mid, range.min, range.mid, range.max);
            mesh.material = new THREE.MeshBasicMaterial({
              color,
              side: THREE.DoubleSide,
            });
            meshesRef.current.push({ mesh, targetColor: color.clone() });
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

    // Expose zoom control to parent (for +/- buttons)
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

    // Keep background in sync with light/dark mode
    const themeObserver = new MutationObserver(() => {
      scene.background = getBg();
    });
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

    let animationId = 0;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      pivot.rotation.x += 0.001;
      pivot.rotation.y += 0.006;
      pivot.rotation.z += 0.0002;

      meshesRef.current.forEach((entry) => {
        const material = entry.mesh.material as THREE.MeshBasicMaterial;
        material.color.lerp(entry.targetColor, 0.04);
      });

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationId);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      controls.dispose();
      loadedObjects.forEach(disposeObject);
      renderer.dispose();
      renderer.domElement.remove();
      meshesRef.current = [];
    };
  }, []);

  return <div ref={containerRef} className={className} aria-label="Client 3D AHA heart model" />;
}
