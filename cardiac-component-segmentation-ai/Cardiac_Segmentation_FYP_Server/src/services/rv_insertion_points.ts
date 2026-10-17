import { jobModel, JobStatus, projectLandmarkModel } from "./database";
import { normalizeLandmarkFrames, normalizeLandmarkJobResult } from "../utils/landmark_order";

export type RvPoint = { x: number; y: number };

export const extractCoord = (lm: any): RvPoint | null => {
    if (!lm) return null;
    if (typeof lm.x === "number" && typeof lm.y === "number") return { x: lm.x, y: lm.y };
    if (Array.isArray(lm) && lm.length >= 2) return { x: lm[0], y: lm[1] };
    return null;
};

/**
 * The project's saved (user-edited) landmark doc. Landmark edits are shared
 * across segmentation models (one editable doc per project) — a corrected RV
 * insertion point is an anatomical image location, not a per-model value — so
 * this is deliberately NOT filtered by segmentationModel.
 */
export const findSavedLandmarkDoc = async (projectId: string) =>
    projectLandmarkModel
        .findOne({ projectid: projectId, isModelOutput: false })
        .sort({ updatedAt: -1 })
        .lean();

/**
 * Average rv_insertion_1 / rv_insertion_2 across every slice of ED (frame 0)
 * only, matching the GPU's own per-frame avg_lm1/avg_lm2 aggregation
 * (visheart-inference-gpu/app/helpers/landmark_inference_api.py). A saved doc
 * can hold every cardiac frame's landmarks, and averaging across cardiac phases
 * (not just slices within one phase) would blend positions from a heart that's
 * moved throughout the cycle into a physically meaningless point.
 */
export const meanSavedRvInsertionPoints = (savedDoc: any): { lm1: RvPoint | null; lm2: RvPoint | null } => {
    const lm1Points: RvPoint[] = [];
    const lm2Points: RvPoint[] = [];
    const edFrame = normalizeLandmarkFrames<any>(savedDoc?.frames ?? []).find((f: any) => f.frameindex === 0);
    for (const slice of edFrame?.slices ?? []) {
        for (const point of slice.landmarks ?? []) {
            if (point.key === "rv_insertion_1") lm1Points.push({ x: point.x, y: point.y });
            if (point.key === "rv_insertion_2") lm2Points.push({ x: point.x, y: point.y });
        }
    }
    const mean = (points: RvPoint[]): RvPoint | null =>
        points.length
            ? { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length }
            : null;
    return { lm1: mean(lm1Points), lm2: mean(lm2Points) };
};

export const findLatestLandmarkJobResult = async (
    projectId: string,
    sort: Record<string, 1 | -1> = { updatedAt: -1 },
): Promise<any | null> => {
    const landmarkJob = await jobModel
        .findOne({ projectid: projectId, model_used: /landmark/i, status: JobStatus.COMPLETED, result: { $exists: true, $ne: null } })
        .sort(sort)
        .lean();
    return landmarkJob?.result
        ? normalizeLandmarkJobResult(typeof landmarkJob.result === "string" ? JSON.parse(landmarkJob.result) : landmarkJob.result)
        : null;
};

/**
 * Both RV insertion points of one slice, as sent to the GPU / the RLE script
 * in the `rv_insertion_slices` field. `slice` is the stored sliceindex. Which
 * of p1/p2 is anterior does not matter: the analysis picks the anterior one
 * from the mask (select_anterior_insertions in bullseye_analysis.py).
 */
export type RvInsertionSlice = { slice: number; p1: [number, number]; p2: [number, number] };

const isNum = (v: any): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Per-slice RV insertion points of one cardiac frame from a saved landmark doc
 * (falls back to frame 0 when that frame is not stored, unless
 * `fallbackToFrame0` is false). Only slices that have both points are returned.
 */
export const savedDocRvInsertionSlices = (savedDoc: any, frameIndex = 0, fallbackToFrame0 = true): RvInsertionSlice[] => {
    const frames: any[] = savedDoc?.frames ?? [];
    const frame = frames.find((f) => f.frameindex === frameIndex)
        ?? (fallbackToFrame0 ? frames.find((f) => f.frameindex === 0) : undefined);
    const out: RvInsertionSlice[] = [];
    for (const slice of frame?.slices ?? []) {
        const p1 = (slice.landmarks ?? []).find((p: any) => p.key === "rv_insertion_1");
        const p2 = (slice.landmarks ?? []).find((p: any) => p.key === "rv_insertion_2");
        if (isNum(slice.sliceindex) && p1 && p2 && isNum(p1.x) && isNum(p1.y) && isNum(p2.x) && isNum(p2.y)) {
            out.push({ slice: slice.sliceindex, p1: [p1.x, p1.y], p2: [p2.x, p2.y] });
        }
    }
    return out;
};

/**
 * Per-slice RV insertion points of one cardiac frame from a landmark job
 * result. Handles the multi-frame format ({ frames: [{ frameindex, slices }] })
 * and the flat format ({ slices: [{ frame?, slice, lm1, lm2 }] }); falls back
 * to frame 0 when the requested frame is not in the result.
 */
export const jobResultRvInsertionSlices = (result: any, frameIndex = 0, fallbackToFrame0 = true): RvInsertionSlice[] => {
    if (!result) return [];
    let slices: any[] = [];
    if (Array.isArray(result.frames)) {
        const frame = result.frames.find((f: any) => f.frameindex === frameIndex)
            ?? (fallbackToFrame0 ? result.frames.find((f: any) => f.frameindex === 0) : undefined);
        slices = frame?.slices ?? [];
    } else if (Array.isArray(result.slices)) {
        const wanted = result.slices.filter((s: any) => (s?.frame ?? 0) === frameIndex);
        slices = wanted.length || !fallbackToFrame0 ? wanted : result.slices.filter((s: any) => (s?.frame ?? 0) === 0);
    }
    const out: RvInsertionSlice[] = [];
    for (const s of slices) {
        const z = s?.slice ?? s?.sliceindex;
        const p1 = extractCoord(s?.lm1);
        const p2 = extractCoord(s?.lm2);
        if (isNum(z) && p1 && p2 && isNum(p1.x) && isNum(p1.y) && isNum(p2.x) && isNum(p2.y)) {
            out.push({ slice: z, p1: [p1.x, p1.y], p2: [p2.x, p2.y] });
        }
    }
    return out;
};

/**
 * Per-slice RV insertion points for aligning each bullseye ring to its own
 * slices. Same source order as resolveRvInsertionPoints: the saved
 * (user-edited) landmark doc first, then the latest completed landmark job.
 * `frameIndex` is the cardiac frame the alignment refers to (the strain's ED
 * frame); it falls back to frame 0. Never throws — returns [] on any failure,
 * in which case callers keep using the single averaged point.
 */
export const resolveRvInsertionSlices = async (projectId: string, frameIndex = 0): Promise<RvInsertionSlice[]> => {
    try {
        const fromSaved = savedDocRvInsertionSlices(await findSavedLandmarkDoc(projectId), frameIndex);
        if (fromSaved.length) return fromSaved;
        return jobResultRvInsertionSlices(await findLatestLandmarkJobResult(projectId), frameIndex);
    } catch {
        return [];
    }
};

/**
 * Every cardiac frame's own per-slice RV insertion points, for aligning each
 * frame's bullseye to that frame's landmarks (the segments then follow the
 * heart through the cycle). Loads the source once — the saved landmark doc if
 * it holds any usable slice, else the latest landmark job — and returns a
 * lookup by frame index. The lookup does NOT fall back to frame 0: a frame
 * with no landmarks returns [], so the caller keeps the reference frame's
 * points for it. Never throws.
 */
export const loadRvInsertionSlicesByFrame = async (
    projectId: string,
): Promise<(frameIndex: number) => RvInsertionSlice[]> => {
    try {
        const saved: any = await findSavedLandmarkDoc(projectId);
        if ((saved?.frames ?? []).some((f: any) => savedDocRvInsertionSlices(saved, f.frameindex, false).length)) {
            return (frameIndex: number) => savedDocRvInsertionSlices(saved, frameIndex, false);
        }
        const job = await findLatestLandmarkJobResult(projectId);
        return (frameIndex: number) => jobResultRvInsertionSlices(job, frameIndex, false);
    } catch {
        return () => [];
    }
};

export const resolveRvInsertionPoints = async (
    projectId: string,
): Promise<{ lm1: RvPoint | null; lm2: RvPoint | null; savedDocId: string | null; usedSavedEdits: boolean }> => {
    let lm1: RvPoint | null = null;
    let lm2: RvPoint | null = null;

    const savedLandmarkDoc = await findSavedLandmarkDoc(projectId);
    if (savedLandmarkDoc) {
        ({ lm1, lm2 } = meanSavedRvInsertionPoints(savedLandmarkDoc));
    }
    const usedSavedEdits = !!(lm1 && lm2);

    if (!lm1 || !lm2) {
        const lmResult = await findLatestLandmarkJobResult(projectId);
        lm1 = lm1 ?? extractCoord(lmResult?.avg_lm1);
        lm2 = lm2 ?? extractCoord(lmResult?.avg_lm2);
    }

    return { lm1, lm2, savedDocId: savedLandmarkDoc ? String(savedLandmarkDoc._id) : null, usedSavedEdits };
};
