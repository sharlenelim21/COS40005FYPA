"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import * as THREE from "three";

/**
 * Forces a real GPU draw of a reconstruction frame's GLB, hidden off-screen, so the FIRST time
 * that frame is shown for real (in ReconstructionGLBViewer's own canvas) there's no buffer-upload/
 * shader-compile stall -- the "first few frames show a black box" symptom (reported live,
 * 2026-11-14). `useGLTF.preload()` (used by ProjectContext's and the standalone viewer's own
 * preload passes) only warms the JS-side parsed geometry; it never asks any WebGLRenderer to
 * actually draw it, so the GPU-side upload + shader compile was still happening lazily on first
 * real render, in whichever canvas the user was looking at.
 *
 * This can't warm the *exact* GPU buffer objects the real viewer's own canvas will later use --
 * those are tied to that canvas's own WebGL context, not shareable across contexts. What it does
 * warm is shader compilation (same MeshStandardMaterial + Environment map setup, so the same
 * shader permutation), which is the dominant cost for a mesh this size and -- unlike raw buffer
 * uploads -- is commonly cached by the browser/driver across contexts in the same process.
 *
 * Mounted once, globally (see layout.tsx), so it's already warm from whichever page triggers a
 * reconstruction's preload (normally the project page, well before the user opens the standalone
 * viewer) rather than warming inside the viewer itself, where the user would see it happen.
 */

type QueueItem = { url: string; resolve: () => void };

let queue: QueueItem[] = [];
let pump: (() => void) | null = null;

/** Enqueues one frame's GLB for a real (hidden) draw; resolves once it has actually been rendered. */
export function warmupReconstructionFrame(url: string): Promise<void> {
  return new Promise((resolve) => {
    queue.push({ url, resolve });
    pump?.();
  });
}

function WarmupModel({ url, onDrawn }: { url: string; onDrawn: () => void }) {
  const { scene } = useGLTF(url);
  // useFrame fires just before this tick's gl.render() call -- waiting for the SECOND tick (not
  // the first) means the first tick's render(), the one that actually uploads this mesh's
  // buffers and compiles its shader, has already fully completed by the time we signal "drawn".
  const ticksRef = useRef(0);
  useFrame(() => {
    ticksRef.current += 1;
    if (ticksRef.current === 2) onDrawn();
  });

  useEffect(() => {
    scene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.material = new THREE.MeshStandardMaterial({
          roughness: 0.5,
          metalness: 0.3,
          envMapIntensity: 1.2,
          side: THREE.DoubleSide,
        });
      }
    });
  }, [scene]);

  return <primitive object={scene} />;
}

export function ReconstructionWarmupHost() {
  const [current, setCurrent] = useState<QueueItem | null>(null);

  useEffect(() => {
    pump = () => setCurrent((prev) => prev ?? queue.shift() ?? null);
    pump();
    return () => {
      pump = null;
    };
  }, []);

  const handleDrawn = () => {
    current?.resolve();
    setCurrent(queue.shift() ?? null);
  };

  return (
    <div
      aria-hidden
      style={{ position: "fixed", left: -9999, top: -9999, width: 2, height: 2, overflow: "hidden", pointerEvents: "none" }}
    >
      <Canvas dpr={1} gl={{ antialias: false, alpha: true }} camera={{ position: [70, 20, -75], fov: 50 }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[80, 60, 40]} intensity={1.4} />
        {/* Same HDRI as ReconstructionGLBViewer's "studio" preset (ENVIRONMENT_FILES) -- shader
            compilation is keyed partly on the environment map being present, so this needs to
            match for the warm-up to actually apply later. */}
        <Suspense fallback={null}>
          <Environment files="/hdri/studio_small_03_1k.hdr" />
        </Suspense>
        {current && (
          <Suspense fallback={null}>
            <WarmupModel key={current.url} url={current.url} onDrawn={handleDrawn} />
          </Suspense>
        )}
      </Canvas>
    </div>
  );
}
