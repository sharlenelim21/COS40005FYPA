/**
 * Whether a project can enter the active-learning review queue (proposal 2.5), and whether it already
 * counts as corrected.
 *
 * Pure (no database), so it can be tested: export_review_volumes.ts loads a project and its masks and
 * calls this. Eligibility follows the training export (export_training_set.ts): the queue only suggests
 * projects whose corrections could later be exported. "Corrected" uses selectTrainingSlices with the same
 * min-pixels rule, so a project is corrected exactly when the export would take at least one of its slices.
 */
import { selectTrainingSlices, TrackedMask } from "./training_selection";

export interface ReviewProject {
    _id?: unknown;
    name?: string;
    originalfilename?: string;
    filename?: string;
    originalfilepath?: string;
    dimensions?: { height?: number; width?: number; slices?: number; frames?: number };
    createdAt?: Date | string;
    [key: string]: unknown;
}

export interface ReviewMask extends TrackedMask {
    isMedSAMOutput?: boolean;
}

export type IneligibleReason = "no_dimensions" | "not_nifti" | "no_s3_volume";

export interface ReviewCandidate {
    projectId: string;
    name: string | null;
    eligible: boolean;
    reason: IneligibleReason | null;
    corrected: boolean;
    qualifyingSlices: number;
    models: string[];
    hasUnetResult: boolean;
    dimensions: ReviewProject["dimensions"] | null;
    createdAt: string | null;
}

const modelTag = (m: TrackedMask) => String(m.segmentationModel || m.model_used || "").toLowerCase();

export const classifyReviewProject = (project: ReviewProject, masks: ReviewMask[], minPixels: number): ReviewCandidate => {
    const dims = project.dimensions;
    let reason: IneligibleReason | null = null;
    if (!dims?.height || !dims?.width) reason = "no_dimensions";
    else if (!/\.nii(\.gz)?$/i.test(String(project.originalfilename || project.filename || ""))) reason = "not_nifti";
    else if (!String(project.originalfilepath || "").startsWith("https://")) reason = "no_s3_volume";

    const models = [...new Set(masks.filter(m => m.isMedSAMOutput === true).map(modelTag).filter(Boolean))].sort();
    const { selected } = selectTrainingSlices(masks.filter(m => m.isMedSAMOutput === false), minPixels);
    const qualifyingSlices = selected.reduce((n, entry) => n + entry.slices.length, 0);

    return {
        projectId: String(project._id),
        name: project.name ?? null,
        eligible: reason === null,
        reason,
        corrected: qualifyingSlices > 0,
        qualifyingSlices,
        models,
        hasUnetResult: models.includes("unet"),
        dimensions: dims ?? null,
        createdAt: project.createdAt ? new Date(project.createdAt).toISOString() : null,
    };
};
