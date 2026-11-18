"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/** "Real time" plays one cardiac cycle per heartbeat at this rate. The scans carry no heart rate
 *  of their own (pixdim t is a placeholder 1), so a normal resting rate is assumed. */
export const REAL_TIME_BPM = 60;
/** Default cycle speed: slow enough to follow the walls (Jy, 2026-10-16: real time looked too
 *  fast to read). */
export const DEFAULT_CYCLE_FPS = 4;

export interface CyclePlayback {
  /** Frames in the cardiac cycle (at least 1). */
  frameCount: number;
  frame: number;
  setFrame: Dispatch<SetStateAction<number>>;
  playing: boolean;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  /** The chosen speed in frames per second, or null for "Real time". */
  fpsChoice: number | null;
  setFpsChoice: Dispatch<SetStateAction<number | null>>;
  /** The speed actually used (fpsChoice, or the real-time rate). */
  fps: number;
  realTimeFps: number;
}

/**
 * Cardiac-cycle playback for the landmark page's Structure and Strain tabs (the sidebar's
 * "Frame" playback bar). The page owns it rather than LandmarkSidebar: the page renders the
 * sidebar twice (the mobile layout is only CSS-hidden), and with the state inside the sidebar
 * each copy kept its own frame and ran its own timer.
 */
export function useCyclePlayback(frameCount: number): CyclePlayback {
  const count = Math.max(frameCount, 1);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fpsChoice, setFpsChoice] = useState<number | null>(DEFAULT_CYCLE_FPS);
  const realTimeFps = (count * REAL_TIME_BPM) / 60;
  const fps = fpsChoice ?? realTimeFps;

  useEffect(() => {
    if (!playing || count < 2) return;
    const id = setInterval(() => setFrame((f) => (f + 1) % count), 1000 / Math.max(fps, 0.5));
    return () => clearInterval(id);
  }, [playing, count, fps]);

  // Keep the index valid if the project's frame count arrives late or changes.
  useEffect(() => {
    setFrame((f) => Math.min(f, count - 1));
  }, [count]);

  return { frameCount: count, frame, setFrame, playing, setPlaying, fpsChoice, setFpsChoice, fps, realTimeFps };
}
