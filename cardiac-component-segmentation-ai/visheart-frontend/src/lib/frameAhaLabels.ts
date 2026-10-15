/**
 * Decodes a reconstruction's gzip+base64 `frameAhaVertexLabelsGz` field (see
 * reconstruction_handler.ts) back into the same `Record<string, number[]>` shape as
 * the plain `frameAhaVertexLabels` field. The backend sends ONE of the two, never
 * both -- large reconstructions (most multi-frame LV ones) get the compressed field
 * instead of the plain one, to stay inside MongoDB's BSON size limits.
 *
 * Uses the browser's native DecompressionStream('gzip') rather than pulling in a JS
 * gzip library -- this app already targets browsers new enough to have it (Chrome/
 * Edge 80+), and the payload here is large enough (can be several MB uncompressed)
 * that a per-frame label lookup belongs behind a decode-once-and-cache, not decoded
 * from base64 + inflated on every render.
 */

import { useEffect, useState } from "react";

const decodeCache = new WeakMap<object, Promise<Record<string, number[]> | null>>();

async function decodeGz(gz: string): Promise<Record<string, number[]> | null> {
  try {
    const binary = atob(gz);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    if (typeof DecompressionStream === "undefined") {
      console.warn("[frameAhaLabels] DecompressionStream unsupported in this browser -- per-frame AHA labels unavailable for this reconstruction.");
      return null;
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const json = await new Response(stream).text();
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, number[]>;
    }
    return null;
  } catch (err) {
    console.warn("[frameAhaLabels] Failed to decode frameAhaVertexLabelsGz:", err);
    return null;
  }
}

/**
 * Resolves a reconstruction record's per-frame AHA labels regardless of whether the
 * backend sent them plain or gzip-compressed. Pass the reconstruction object itself
 * (not just the field) so the decode can be cached per-object -- callers that
 * re-render with the same reconstruction reference get the cached promise instead of
 * re-decoding every time.
 */
export function getFrameAhaVertexLabels(
  reconstruction: { frameAhaVertexLabels?: Record<string, number[]> | null; frameAhaVertexLabelsGz?: string | null } | null | undefined,
): Promise<Record<string, number[]> | null> {
  if (!reconstruction) return Promise.resolve(null);
  if (reconstruction.frameAhaVertexLabels) return Promise.resolve(reconstruction.frameAhaVertexLabels);
  if (!reconstruction.frameAhaVertexLabelsGz) return Promise.resolve(null);

  const cached = decodeCache.get(reconstruction);
  if (cached) return cached;
  const promise = decodeGz(reconstruction.frameAhaVertexLabelsGz);
  decodeCache.set(reconstruction, promise);
  return promise;
}

/**
 * React hook wrapping getFrameAhaVertexLabels: re-resolves whenever the reconstruction
 * object identity changes (a new fetch/reconstruction), null while decoding or when
 * there's nothing to decode. Three call sites in landmark-detection/page.tsx share this
 * instead of each hand-rolling their own decode-and-cache effect.
 */
export function useFrameAhaVertexLabels(
  reconstruction: { frameAhaVertexLabels?: Record<string, number[]> | null; frameAhaVertexLabelsGz?: string | null } | null | undefined,
): Record<string, number[]> | null {
  const [resolved, setResolved] = useState<Record<string, number[]> | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Plain field (if present) resolves synchronously via the cache below anyway, but
    // setting it straight away avoids a one-render flash of null while that resolves.
    if (reconstruction?.frameAhaVertexLabels) {
      setResolved(reconstruction.frameAhaVertexLabels);
      return;
    }
    setResolved(null);
    getFrameAhaVertexLabels(reconstruction).then((labels) => {
      if (!cancelled) setResolved(labels);
    });
    return () => {
      cancelled = true;
    };
  }, [reconstruction]);

  return resolved;
}
