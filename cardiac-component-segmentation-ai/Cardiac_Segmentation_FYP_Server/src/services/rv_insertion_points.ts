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
