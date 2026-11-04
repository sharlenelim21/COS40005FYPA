/**
 * Building a 4D reconstruction from some of a scan's frames, to save time and storage (Jy, 2026-11-01).
 *
 * The GPU service builds every frame of the segmentation NIfTI it is sent and names each mesh by the frame's position
 * in that file (fourdreconstruction_handler.py, `..._frame{NN}[_ED].glb`). So the server sends a NIfTI holding only
 * the chosen frames, keeps the map from position to original frame on the job, and when the meshes come back renames
 * them, and re-keys the GPU's per-frame results, to the original frame numbers. Everything downstream (the viewer, the
 * landmark page, the motion build in motion_mesh.py, strain from the masks) then sees the scan's own frame numbers.
 * The motion build fills the frames in between linearly and needs at least 3 built frames, hence MIN_FRAMES.
 *
 * Pure (no database, no files), so it can be tested.
 */

export const MIN_FRAMES = 3;

export type FrameSelection =
    | { ok: true; frameMap: number[] | null } // 0-based original frames in build order; null: every frame
    | { ok: false; error: string };

/**
 * Checks a request's `frames` (1-based frame numbers) against the scan. Absent means every frame. The end-diastole
 * frame must be built (every frame is fitted from it), and at least MIN_FRAMES (or every frame of a shorter scan).
 */
export function checkFrameSelection(frames: unknown, totalFrames: number, edFrame: number): FrameSelection {
    if (frames === undefined || frames === null) return { ok: true, frameMap: null };
    if (!Array.isArray(frames) || !frames.every(f => Number.isInteger(f))) {
        return { ok: false, error: "frames must be a list of frame numbers." };
    }
    const chosen = [...new Set(frames as number[])].sort((a, b) => a - b);
    const outside = chosen.filter(f => f < 1 || f > totalFrames);
    if (outside.length > 0) {
        return { ok: false, error: `Frame ${outside[0]} is outside this scan's ${totalFrames} frames.` };
    }
    if (!chosen.includes(edFrame)) {
        return { ok: false, error: `The end-diastole frame (${edFrame}) must be built: every other frame is fitted from it.` };
    }
    const needed = Math.min(MIN_FRAMES, totalFrames);
    if (chosen.length < needed) {
        return { ok: false, error: `Choose at least ${needed} frames; the heart's motion needs ${MIN_FRAMES} to follow.` };
    }
    if (chosen.length === totalFrames) return { ok: true, frameMap: null };
    return { ok: true, frameMap: chosen.map(f => f - 1) };
}

/** Every k-th frame from the first, always with the end-diastole and end-systole frames (both 1-based). */
export function everyKthFrame(totalFrames: number, k: number, edFrame: number, esFrame?: number): number[] {
    const frames = new Set<number>();
    for (let f = 1; f <= totalFrames; f += Math.max(1, Math.floor(k))) frames.add(f);
    frames.add(edFrame);
    if (esFrame && esFrame >= 1 && esFrame <= totalFrames) frames.add(esFrame);
    return [...frames].sort((a, b) => a - b);
}

// The GPU's mesh names end in "frame<position>" or "frame<position>_ED", then the format.
const MESH_FRAME = /(frame)(\d+)((?:_ED)?\.(?:glb|obj))$/i;

/** A returned mesh's file name with its build position replaced by the original frame number. */
export function originalMeshName(name: string, frameMap: number[]): string {
    return name.replace(MESH_FRAME, (whole, word: string, position: string, rest: string) => {
        const original = frameMap[Number(position)];
        return original === undefined ? whole : `${word}${String(original).padStart(position.length, "0")}${rest}`;
    });
}

/** The GPU's result with every build position turned into the original frame (0-based, as the GPU reports them). */
export function originalFrameResult<R extends Record<string, any>>(result: R, frameMap: number[]): R {
    const original = (position: unknown) =>
        typeof position === "number" && frameMap[position] !== undefined ? frameMap[position] : position;
    const out: Record<string, any> = { ...result };
    if ("ed_frame_index" in out) out.ed_frame_index = original(out.ed_frame_index);
    if (out.frame_aha_vertex_labels && typeof out.frame_aha_vertex_labels === "object") {
        out.frame_aha_vertex_labels = Object.fromEntries(Object.entries(out.frame_aha_vertex_labels)
            .map(([position, labels]) => [String(original(Number(position))), labels]));
    }
    if (out.temporal_info && Array.isArray(out.temporal_info.processed_frame_indices)) {
        out.temporal_info = { ...out.temporal_info,
                              processed_frame_indices: out.temporal_info.processed_frame_indices.map(original) };
    }
    const span = Math.max(...frameMap) + 1;
    if (typeof out.total_frames !== "number" || out.total_frames < span) out.total_frames = span;
    out.built_frames = frameMap.map(f => f + 1);
    return out as R;
}
