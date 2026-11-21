/**
 * Which saved corrections may train the UNet (UNet Extend Training), in one place (option C, 2026-11-22).
 *
 * The Prepare tab's list, its "N of M cases · X projects · Y slices" summary and its 5-project gate all read the
 * export dry run, and the training job runs the same export again before it trains (visheart-retraining/pipeline.py):
 * both are scripts/export_training_set.ts, which decides with this module.
 *
 * - A template project never trains: a published one (`isTemplate`), and one that came from a template
 *   (`fromTemplate`), such as a template given back to a user by template_tool.py `unpublish`, or one being prepared
 *   before it is published. Its saved masks are the experts' reference masks for the template hearts, not corrections
 *   of an AI result, even after it has its own UNet result and edits; before this rule they were every one of the
 *   page's corrected slices. The held-out comparison (--only-holdout) keeps them.
 * - A case trains only against its own model's AI result: the AI output (`isMedSAMOutput` is set on every model's AI
 *   output) of the same model, which edit tracking paired with it (`editTracking.aiMaskId`). Without it no slice of the
 *   case trains: a missing AI result is never read as an empty mask.
 * - A slice that its AI result does not hold is skipped, and the rest of the case stays (training_export.ts
 *   withTrainingPixelCounts marks it, training_selection.ts editTooSmall skips it).
 *
 * The training builder checks the same rule in Python (visheart-retraining/eligibility.py) on the facts the export
 * sends it (caseFacts); visheart-retraining/tests/fixtures/training_eligibility.json is checked against both.
 */
import { TrackedMask } from './training_selection';
import { FramedMask, withTrainingPixelCounts } from './training_export';

export type CaseExclusion = 'template_project' | 'no_ai_result';

export interface EligibilityProject {
    isTemplate?: unknown;
    fromTemplate?: unknown;
}

export interface AiResult extends FramedMask {
    _id?: unknown;
    segmentationModel?: unknown;
    model_used?: unknown;
    isMedSAMOutput?: unknown;
}

export interface EligibilityOptions {
    /** The --only-holdout export of the clinical arm: templates stay there, only training leaves them out. */
    heldOut?: boolean;
}

/** What the training builder checks again (eligibility.py case_exclusion). */
export interface CaseFacts {
    isTemplate: boolean;
    fromTemplate: boolean;
    aiResult: boolean;
    heldOut: boolean;
}

/** A published template, or a project that came from one (IProject.fromTemplate). */
const isTemplateProject = (project: EligibilityProject | null | undefined): boolean =>
    Boolean(project?.isTemplate || project?.fromTemplate);

const modelOf = (mask: { segmentationModel?: unknown; model_used?: unknown }): string =>
    String(mask.segmentationModel || mask.model_used || '').toLowerCase();

/** Whether `aiMask` is the AI result of `mask`'s own model. */
export function hasAiResult(mask: TrackedMask, aiMask: AiResult | null | undefined): boolean {
    const model = modelOf(mask);
    return !!aiMask && aiMask.isMedSAMOutput === true && model !== '' && modelOf(aiMask) === model;
}

/** Why a case may not train, or null when it may. */
export function caseExclusion(project: EligibilityProject | null | undefined, mask: TrackedMask,
                              aiMask: AiResult | null | undefined, options: EligibilityOptions = {}): CaseExclusion | null {
    if (isTemplateProject(project) && !options.heldOut) return 'template_project';
    return hasAiResult(mask, aiMask) ? null : 'no_ai_result';
}

export function caseFacts(project: EligibilityProject | null | undefined, mask: TrackedMask,
                          aiMask: AiResult | null | undefined, options: EligibilityOptions = {}): CaseFacts {
    return { isTemplate: Boolean(project?.isTemplate), fromTemplate: Boolean(project?.fromTemplate),
             aiResult: hasAiResult(mask, aiMask), heldOut: Boolean(options.heldOut) };
}

/**
 * A project's cases that may train, each recounted against its AI result (slices the AI result lacks are marked, so
 * the selection skips them), and how many were left out and why.
 */
export function eligibleCorrections<M extends TrackedMask & FramedMask>(
    project: EligibilityProject | null | undefined, masks: M[], aiById: Map<string, AiResult>, planeSize: number,
    options: EligibilityOptions = {}): { masks: M[]; excluded: Partial<Record<CaseExclusion, number>> } {
    const kept: M[] = [];
    const excluded: Partial<Record<CaseExclusion, number>> = {};
    for (const mask of masks) {
        const aiMask = aiById.get(String(mask.editTracking?.aiMaskId));
        const reason = caseExclusion(project, mask, aiMask, options);
        if (reason) {
            excluded[reason] = (excluded[reason] ?? 0) + 1;
            continue;
        }
        kept.push(withTrainingPixelCounts(mask, aiMask, planeSize));
    }
    return { masks: kept, excluded };
}
