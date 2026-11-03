import { retrainingApi } from "@/lib/retraining-api";
import { tarImageCache } from "@/lib/tar-image-cache";

/**
 * A project's slice images from this browser's image cache, the one the editor uses, downloaded only when the cache
 * does not have them yet (plan WS13 R1). Prepare lists every user's cases, so the link comes from Extend Training,
 * which serves the images of a corrected case whoever owns it.
 */
export async function ensureProjectImages(projectId: string): Promise<void> {
  await tarImageCache.init();
  if (tarImageCache.isProjectReady(projectId)) return;
  const { frames } = await tarImageCache.getAvailableFramesAndSlices(projectId);
  if (frames.length === 0) {
    const result = await tarImageCache.fetchAndExtractProjectImages(projectId, retrainingApi.caseImages);
    if (!result.success) throw new Error(result.errors[0] ?? "The scan images could not be downloaded.");
  }
  tarImageCache.markProjectReady(projectId);
}

export function sliceImageUrl(projectId: string, frame: number, slice: number): Promise<string | null> {
  return tarImageCache.getImageURL(projectId, frame, slice);
}
