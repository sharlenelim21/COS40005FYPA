"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useProject } from "@/context/ProjectContext";
import { decodeMotion, framePositions, MotionData, reconstructionMotionApi } from "@/lib/reconstruction-motion";

const POLL_MS = 4000;
const GIVE_UP_MS = 20 * 60 * 1000;

export type MotionState = "off" | "preparing" | "ready" | "unavailable";

// One request per reconstruction for the whole page, however many panels show it: the result (or "unavailable") is
// remembered for the page's lifetime, and polling stops as soon as no panel is waiting for it.
const results = new Map<string, MotionData | null>();
const pending = new Map<string, Promise<MotionData | null>>();
const waiting = new Map<string, number>();

async function loadMotion(projectId: string, reconstructionId: string): Promise<MotionData | null> {
  const startedAt = Date.now();
  let started = false;
  while ((waiting.get(reconstructionId) ?? 0) > 0) {
    let status = await reconstructionMotionApi.status(projectId, reconstructionId);
    if (status.status === "missing" && !started) {
      status = await reconstructionMotionApi.start(projectId, reconstructionId);
      started = true;
    }
    if (status.status === "ready") {
      const response = await fetch(status.url);
      if (!response.ok) throw new Error(`motion download failed (${response.status})`);
      return decodeMotion(await response.arrayBuffer());
    }
    if (status.status === "failed") throw new Error(status.error);
    if (status.status === "missing") throw new Error("the motion was not built");
    if (Date.now() - startedAt > GIVE_UP_MS) throw new Error("the motion took too long to build");
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error("nobody is waiting");   // not remembered: the next panel to ask starts again
}

/**
 * A reconstruction's smooth motion: asks the backend for it (building it the first time, about 20 s per chamber on a
 * desktop CPU), waits while it is being built, and downloads it once. Null until ready, and for good if it cannot be
 * built: callers then keep the per-frame meshes, exactly as before.
 */
export function useReconstructionMotion(projectId: string | undefined, reconstructionId: string | undefined) {
  const known = reconstructionId !== undefined && results.has(reconstructionId);
  const [motion, setMotion] = useState<MotionData | null>(known ? results.get(reconstructionId!) ?? null : null);
  const [state, setState] = useState<MotionState>(
    !reconstructionId ? "off" : known ? (results.get(reconstructionId) ? "ready" : "unavailable") : "preparing",
  );

  useEffect(() => {
    if (!projectId || !reconstructionId) {
      setMotion(null);
      setState("off");
      return;
    }
    if (results.has(reconstructionId)) {
      const done = results.get(reconstructionId) ?? null;
      setMotion(done);
      setState(done ? "ready" : "unavailable");
      return;
    }
    setMotion(null);
    setState("preparing");
    let active = true;
    waiting.set(reconstructionId, (waiting.get(reconstructionId) ?? 0) + 1);
    let request = pending.get(reconstructionId);
    if (!request) {
      request = loadMotion(projectId, reconstructionId)
        .then((data) => {
          results.set(reconstructionId, data);
          return data;
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (message !== "nobody is waiting") {
            console.warn("[useReconstructionMotion] smooth motion unavailable, keeping per-frame meshes:", message);
            results.set(reconstructionId, null);
          }
          return null;
        })
        .finally(() => pending.delete(reconstructionId));
      pending.set(reconstructionId, request);
    }
    void request.then((data) => {
      if (!active) return;
      setMotion(data);
      setState(data ? "ready" : "unavailable");
    });
    return () => {
      active = false;
      waiting.set(reconstructionId, Math.max(0, (waiting.get(reconstructionId) ?? 1) - 1));
    };
  }, [projectId, reconstructionId]);

  return { motion, state };
}

/**
 * What the 3D heart shows for one reconstruction at `frame`. With motion: the END-DIASTOLE mesh and its labels, plus
 * this frame's vertex positions (the mesh is loaded once and only its vertices move). Without: this frame's own mesh
 * and labels, as before. The labels always belong to the mesh file returned, and positions are only given once that
 * file is the ED mesh, so a panel never pairs one frame's labels or positions with another frame's mesh.
 * `markUnusable` drops back to per-frame meshes for good, e.g. when the loaded mesh does not match the motion.
 */
export function useMotionMesh(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reconstruction: any | null,
  model: "unet" | "medsam",
  frame: number,
) {
  const params = useParams<{ projectId: string }>();
  const { getReconstructionGLB } = useProject();
  const reconstructionId: string | undefined = reconstruction?.reconstructionId;
  // Every 3D heart on the page needs segment labels to draw; reconstructions made before AHA labelling have none,
  // so neither their meshes nor their motion are fetched.
  const hasLabels =
    (Array.isArray(reconstruction?.ahaVertexLabels) && reconstruction.ahaVertexLabels.length > 0) ||
    (!!reconstruction?.frameAhaVertexLabels && typeof reconstruction.frameAhaVertexLabels === "object" &&
      Object.keys(reconstruction.frameAhaVertexLabels).length > 0);
  const { motion: built, state } = useReconstructionMotion(
    hasLabels ? params?.projectId : undefined,
    hasLabels ? reconstructionId : undefined,
  );
  const [unusable, setUnusable] = useState<string | null>(null);   // the reconstruction whose motion did not fit
  const motion = unusable === reconstructionId ? null : built;
  const meshFrame = motion ? motion.edFrame : frame;

  // The mesh file resolved for (reconstruction, model, frame); the previous one stays until the next resolves, so
  // playback and the switch to motion never blank the panel.
  const [resolved, setResolved] = useState<{ id: string; model: string; frame: number; url: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!reconstructionId || !hasLabels) return;
    (async () => {
      const url = await getReconstructionGLB(meshFrame, model, reconstructionId);
      if (!cancelled && url) setResolved({ id: reconstructionId, model, frame: meshFrame, url });
    })();
    return () => {
      cancelled = true;
    };
  }, [reconstructionId, hasLabels, model, meshFrame, getReconstructionGLB]);
  const current = resolved && resolved.id === reconstructionId && resolved.model === model ? resolved : null;

  const segmentLabels: number[] | null = useMemo(() => {
    if (!current) return null;
    const perFrame = reconstruction?.frameAhaVertexLabels?.[String(current.frame)];
    if (Array.isArray(perFrame)) return perFrame;
    return Array.isArray(reconstruction?.ahaVertexLabels) ? reconstruction.ahaVertexLabels : null;
  }, [reconstruction, current]);

  const motionPositions = useMemo(() => {
    if (!motion || !current || current.frame !== motion.edFrame) return null;
    const first = motion.frames[0];
    const last = motion.frames[motion.frames.length - 1];
    return framePositions(motion, Math.min(Math.max(frame, first), last));
  }, [motion, current, frame]);

  const markUnusable = useCallback(() => {
    if (reconstructionId) setUnusable(reconstructionId);
  }, [reconstructionId]);

  return {
    meshUrl: current?.url ?? null,
    segmentLabels,
    motionPositions,
    motionState: (unusable === reconstructionId && reconstructionId ? "unavailable" : state) as MotionState,
    markUnusable,
  };
}
