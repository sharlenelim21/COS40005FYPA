/**
 * Module-level (NOT per-component) record of which 4D reconstructions have had every frame's
 * mesh already preloaded into the Three.js/drei cache this browser session.
 *
 * A React ref or state would reset the moment whichever component owns it unmounts -- which is
 * exactly the problem this fixes: ProjectContext's own background "zero-lag" preload can finish
 * warming a reconstruction while the user is still on the project or landmark page, but the
 * standalone 4D viewer used to have no way of knowing that already happened, so it always redid
 * its own full preload pass (and blocked Play behind a "Processing reconstruction..." screen)
 * every single time it mounted. A plain module-level Set survives client-side navigation between
 * pages (the module is only ever loaded once per full page load), so either side can mark a
 * reconstruction done and the other will see it.
 */
const preloadedReconstructionIds = new Set<string>();

export function isReconstructionPreloaded(reconstructionId: string): boolean {
  return preloadedReconstructionIds.has(reconstructionId);
}

export function markReconstructionPreloaded(reconstructionId: string): void {
  preloadedReconstructionIds.add(reconstructionId);
}
