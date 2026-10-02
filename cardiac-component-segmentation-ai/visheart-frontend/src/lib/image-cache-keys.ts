/**
 * The image cache's keys, `<projectId>_f<frame>_s<slice>`. Kept free of imports so that
 * tests/image-cache-keys.test.mjs can load it with the TypeScript compiler alone.
 */

export function imageId(projectId: string, frame: number, slice: number): string {
  return `${projectId}_f${frame}_s${slice}`;
}

const KEY = /_f(\d+)_s(\d+)$/;

/** A project's frames and slices, read from its cache keys, so no image has to be loaded to count them. */
export function framesAndSlices(ids: readonly unknown[]): { frames: number[]; slices: number[] } {
  const frames = new Set<number>();
  const slices = new Set<number>();
  for (const id of ids) {
    const match = typeof id === "string" ? KEY.exec(id) : null;
    if (!match) continue;
    frames.add(Number(match[1]));
    slices.add(Number(match[2]));
  }
  const ascending = (a: number, b: number) => a - b;
  return { frames: [...frames].sort(ascending), slices: [...slices].sort(ascending) };
}
