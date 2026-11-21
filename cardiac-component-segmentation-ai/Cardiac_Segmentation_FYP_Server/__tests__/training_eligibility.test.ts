import fs from 'fs';
import path from 'path';
import { dryRunEntries, DryRunCandidate, ExportCase } from '../src/services/training_export';
import { AiResult, caseExclusion, caseFacts, eligibleCorrections } from '../src/services/training_eligibility';
import {
  FALLBACK_MIN_PIXELS, MIN_EDIT_SHARE, selectTrainingSlices, TrackedMask, TrackedSlice,
} from '../src/services/training_selection';

// The examples the training job's tests (visheart-retraining/tests/test_eligibility.py) and the Prepare tab's tests
// (visheart-frontend/tests/extend-training-logic.test.mjs) check too: see the file's "about".
const fixture = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '../../visheart-retraining/tests/fixtures/training_eligibility.json'), 'utf8'));

/** The export dry run of the fixture's projects, built as export_training_set.ts builds it. */
function dryRunOf(projects: any[]) {
    const aiById = new Map<string, AiResult>(projects.flatMap(p => p.aiResults).map((ai: AiResult) => [String(ai._id), ai]));
    const planeSize = fixture.plane.height * fixture.plane.width;
    const excluded: Record<string, number> = {}, skipped: Record<string, number> = {};
    const cases: ExportCase[] = [], candidates: DryRunCandidate[] = [];
    for (const { project, masks } of projects) {
        const eligible = eligibleCorrections(project, masks, aiById, planeSize);
        for (const [reason, n] of Object.entries(eligible.excluded)) excluded[reason] = (excluded[reason] ?? 0) + n!;
        if (eligible.masks.length === 0) continue;
        const selection = selectTrainingSlices(eligible.masks, FALLBACK_MIN_PIXELS, { minShare: MIN_EDIT_SHARE });
        for (const [reason, n] of Object.entries(selection.skipped)) skipped[reason] = (skipped[reason] ?? 0) + n;
        const entries = dryRunEntries(project, eligible.masks, selection, { minPixels: FALLBACK_MIN_PIXELS, minShare: MIN_EDIT_SHARE });
        cases.push(...entries.cases);
        candidates.push(...entries.candidates);
    }
    return { counts: { projects: new Set(candidates.map(c => c.scanId)).size }, candidates, cases, excluded, skipped };
}

// What the page and the training job read of a case.
const asListed = (c: ExportCase) => ({
    maskId: c.maskId, projectId: c.projectId, projectName: c.projectName, model: c.model, scanId: c.scanId, frozen: c.frozen,
    slices: c.slices.map(s => ({ frameindex: s.frameindex, sliceindex: s.sliceindex })),
});

const AI_RESULTS: Record<string, AiResult | undefined> = {
    same_model: { _id: 'ai', isMedSAMOutput: true, segmentationModel: 'unet' },
    other_model: { _id: 'ai', isMedSAMOutput: true, segmentationModel: 'medsam' },
    not_ai_output: { _id: 'ai', isMedSAMOutput: false, segmentationModel: 'unet' },
    missing: undefined,
};
const unetCase = (slices: TrackedSlice[] = []): TrackedMask => ({
    _id: 'm1', segmentationModel: 'unet',
    editTracking: { status: 'computed', editedSliceCount: Math.max(1, slices.length), aiMaskId: 'ai', slices },
});
type Rule = { name: string; expected: string | null; [key: string]: any };
const named = (rules: Rule[]): [string, Rule][] => rules.map(rule => [rule.name, rule]);

describe('Which corrections may train the UNet (option C)', () => {
    const dry = dryRunOf(fixture.projects);

    it('builds exactly the dry run the page and the training job read', () => {
        expect({ counts: dry.counts, candidates: dry.candidates, cases: dry.cases.map(asListed) }).toEqual(fixture.dryRun);
    });

    it('leaves a template project out, and does not list it', () => {
        expect(dry.excluded.template_project).toBe(2);   // the published template and the unpublished one
        expect(dry.cases.map(c => c.projectId)).not.toContain('p-template');
        expect(dry.candidates.map(c => c.projectId)).not.toContain('p-template');
    });

    it('an unpublished template with its own UNet result and edits is still not eligible', () => {
        const unpublished = fixture.projects.find((p: any) => p.project._id === 'p-unpublished');
        expect(unpublished.project).toMatchObject({ isTemplate: false, fromTemplate: true });
        const aiById = new Map<string, AiResult>(unpublished.aiResults.map((ai: AiResult) => [String(ai._id), ai]));
        // It has everything a real correction has: its own UNet result, and edits large enough to train.
        expect(caseExclusion({ isTemplate: false }, unpublished.masks[0], aiById.get('ai-unpublished'))).toBeNull();
        // Its origin alone keeps it out.
        expect(eligibleCorrections(unpublished.project, unpublished.masks, aiById, 16))
            .toEqual({ masks: [], excluded: { template_project: 1 } });
        expect(dry.cases.map(c => c.projectId)).not.toContain('p-unpublished');
    });

    it('leaves out a case whose AI result is missing, never reading it as an empty mask', () => {
        expect(dry.excluded.no_ai_result).toBe(1);
        expect(dry.cases.map(c => c.projectId)).not.toContain('p-c');   // its 400 "changed" pixels would have trained
    });

    it('keeps a normal corrected project whole', () => {
        expect(dry.cases.find(c => c.projectId === 'p-a')?.slices).toHaveLength(2);
    });

    it('skips only the slices its AI result does not hold', () => {
        expect(dry.skipped).toEqual(fixture.expected.skipped);
        expect(dry.cases.find(c => c.projectId === 'p-b')?.slices.map(s => s.sliceindex)).toEqual([0]);
    });

    it("counts a user's own copy of a template's scan once it has its UNet result and a real correction", () => {
        const copy = fixture.projects.find((p: any) => p.project._id === 'p-copy');
        expect(copy.project.isTemplate).toBeUndefined();         // a new upload gets the schema default, false
        expect(dry.candidates.find(c => c.projectId === 'p-copy')?.scanId).toBe('hash-template');
        // Before its UNet run nothing pairs with the correction (edit tracking records no_baseline): it does not count.
        const notRunYet = { ...copy, aiResults: [] };
        expect(dryRunOf([notRunYet]).excluded).toEqual({ no_ai_result: 1 });
    });

    it('the held-out export keeps templates; training never does', () => {
        const template = fixture.projects[0];
        const aiById = new Map<string, AiResult>(template.aiResults.map((ai: AiResult) => [String(ai._id), ai]));
        expect(eligibleCorrections(template.project, template.masks, aiById, 16, { heldOut: true }).masks).toHaveLength(1);
        expect(eligibleCorrections(template.project, template.masks, aiById, 16).masks).toHaveLength(0);
    });

    it.each(named(fixture.caseRules))('case rule: %s (as eligibility.py decides)', (_name, rule) => {
        const project = { isTemplate: rule.isTemplate, fromTemplate: rule.fromTemplate };
        const ai = AI_RESULTS[rule.ai], options = { heldOut: rule.heldOut };
        expect(caseExclusion(project, unetCase(), ai, options)).toBe(rule.expected);
        // The facts the builder is sent, as test_eligibility.py derives them from the same example.
        expect(caseFacts(project, unetCase(), ai, options)).toEqual({
            isTemplate: rule.isTemplate, fromTemplate: rule.fromTemplate, aiResult: rule.ai === 'same_model', heldOut: rule.heldOut,
        });
    });

    it.each(named(fixture.sliceRules))('slice rule: %s (as eligibility.py decides)', (_name, rule) => {
        const slice: TrackedSlice = { frameindex: 0, sliceindex: 0, editedClasses: ['lvc'], ...rule.slice };
        const { selected, skipped } = selectTrainingSlices([unetCase([slice])], FALLBACK_MIN_PIXELS, { minShare: MIN_EDIT_SHARE });
        const reason = Object.keys(skipped)[0]?.replace(/^slice_/, '') ?? null;
        expect(selected.length === 1 ? null : reason).toBe(rule.expected);
    });
});
