/**
 * Which frames a 4D reconstruction builds (Jy, 2026-11-01): every frame, every 2nd or 3rd, or a hand-picked set, to
 * save time and storage. The server checks the same rules (Cardiac_Segmentation_FYP_Server
 * src/services/reconstruction_frames.ts) and renames the meshes back to these frame numbers. The end-diastole frame
 * is always built (every frame is fitted from it), and at least MIN_FRAMES, since the moving heart on the landmark
 * page fills the frames in between from their neighbours. It imports nothing, so tests can load it alone.
 */

export const MIN_FRAMES = 3;

export type FrameMode = "all" | "every2" | "every3" | "custom";

/**
 * The 1-based frames a mode builds. Every k-th frame starts at frame 1 and always keeps the end-diastole frame and the
 * last frame, so the moving heart still covers the whole cycle. "custom" returns `picked` with the ED frame added.
 */
export function framesFor(mode: FrameMode, totalFrames: number, edFrame: number, picked: number[] = []): number[] {
  const frames = new Set<number>();
  if (mode === "all") {
    for (let f = 1; f <= totalFrames; f++) frames.add(f);
  } else if (mode === "custom") {
    for (const f of picked) if (Number.isInteger(f) && f >= 1 && f <= totalFrames) frames.add(f);
  } else {
    const step = mode === "every2" ? 2 : 3;
    for (let f = 1; f <= totalFrames; f += step) frames.add(f);
    frames.add(totalFrames);
  }
  frames.add(edFrame);
  return [...frames].sort((a, b) => a - b);
}

/** Why a set of frames cannot be built, or null. */
export function frameProblem(frames: number[], totalFrames: number): string | null {
  const needed = Math.min(MIN_FRAMES, totalFrames);
  return frames.length < needed ? `Choose at least ${needed} frames: the moving heart needs ${MIN_FRAMES} to follow.` : null;
}

/** What the request sends: null builds every frame (the server's default, as before). */
export function requestFrames(frames: number[], totalFrames: number): number[] | null {
  return frames.length >= totalFrames ? null : frames;
}

/** True when the chosen frames are not evenly spaced, so the in-between motion is less even. */
export function unevenlySpaced(frames: number[]): boolean {
  if (frames.length < 3) return false;
  const gaps = frames.slice(1).map((f, i) => f - frames[i]);
  return Math.max(...gaps) - Math.min(...gaps) > 1;
}

/**
 * The built frame (0-based, as the mesh files are numbered) to show for a frame of the scan: the frame itself when it
 * was built, else the nearest built frame before it, else the first built frame. -1 when nothing is built.
 */
export function nearestBuiltFrame(frame: number, built: number[]): number {
  if (built.length === 0) return -1;
  let shown = -1;
  for (const b of built) if (b <= frame && b > shown) shown = b;
  return shown === -1 ? Math.min(...built) : shown;
}
