/**
 * Loads js-untar with a few retries, instead of a bare `import('js-untar')`.
 *
 * js-untar touches `window` at module scope (it's browser-only), so it MUST
 * stay a runtime dynamic import — a static import pulls it into SSR'd
 * modules too (reconstruction-cache.ts / tar-image-cache.ts are both
 * imported, transitively, from ProjectContext.tsx, which Next.js server-
 * renders) and crashes with "window is not defined" the moment the module
 * loads, not even when untar() is called (reported live, 2026-10 — a static
 * import was tried first and broke this exact way).
 *
 * The dynamic import's own webpack chunk fetch can still fail on an
 * ordinary network hiccup ("TypeError: Failed to fetch" / ChunkLoadError),
 * which previously surfaced as the entire TAR extraction — and with it, the
 * whole 4D reconstruction — failing outright. A short retry is the standard
 * mitigation for a transient chunk-load failure, so that's what this does,
 * once, from the one place both callers already share.
 */
export async function loadUntar(): Promise<(buffer: ArrayBuffer) => Promise<{ name: string; buffer: ArrayBuffer }[]>> {
  const attempts = 3;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const untarModule = await import("js-untar");
      const untar = untarModule.default ?? untarModule.untar;
      if (typeof untar !== "function") {
        throw new Error(`js-untar did not export a function. Got: ${typeof untar}.`);
      }
      return untar;
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        console.warn(`[load-untar] Failed to load js-untar chunk (attempt ${i + 1}/${attempts}), retrying...`, err);
        await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)));
      }
    }
  }
  const msg = lastError instanceof Error ? lastError.message : "Unknown error";
  throw new Error(`Failed to load js-untar after ${attempts} attempts: ${msg}`);
}
