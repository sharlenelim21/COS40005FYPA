/**
 * check_review_candidates.js
 * ==========================
 * Standalone runnable test for src/services/review_candidates.ts (compiled to dist/).
 *
 * No Mongo, no HTTP, no test framework — feeds one synthetic project and its masks to
 * classifyReviewProject and asserts whether the project can enter the active-learning review queue,
 * and whether it already counts as corrected under the same rule the training export uses.
 * Build first (pnpm run build); the test loads dist/services/review_candidates.js.
 *
 * Scenarios:
 *   [1]  Eligible, no results     (NIfTI on S3 with dimensions; nothing run, nothing corrected)
 *   [2]  Models with results      (AI outputs name the models; hasUnetResult follows)
 *   [3]  Not NIfTI                (DICOM cannot feed the UNet)
 *   [4]  No S3 volume             (local-mode uploads were deleted after processing)
 *   [5]  No dimensions            (checked first, as in the training export)
 *   [6]  Corrected                (a UNet slice at or above min pixels)
 *   [7]  Below min pixels         (edited, but not enough to count)
 *   [8]  AI outputs ignored       (tracking on a preserved AI document never counts)
 *   [9]  Suspect revert           (a cross-model revert never counts)
 *   [10] MedSAM correction        (counts toward corrected, D5)
 *   [11] Qualifying slice count   (one label per slice, as selectTrainingSlices decides)
 *
 * Run:  node scripts/check_review_candidates.js
 * Exits 0 on all assertions passing, 1 otherwise.
 */

'use strict';

const path = require('path');
const { isDeepStrictEqual } = require('util');

let classifyReviewProject;
try {
    ({ classifyReviewProject } = require(path.resolve(__dirname, '..', 'dist', 'services', 'review_candidates')));
} catch (err) {
    console.error(`Cannot load dist/services/review_candidates.js (build first): ${err.message}`);
    process.exit(1);
}

// ── Assertion harness (same shape as check_training_selection.js) ───────────

let PASS = 0, FAIL = 0;
function assert(name, cond, detail) {
    if (cond) { console.log(`  ✓ ${name}`); PASS++; }
    else      { console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`); FAIL++; }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MIN = 20;

function project(extra = {}) {
    return {
        _id: 'p1',
        name: 'Case A',
        originalfilename: 'patient001_4d.nii.gz',
        originalfilepath: 'https://minio.local/bucket/source_nifti/u1/patient001_4d.nii.gz',
        dimensions: { height: 216, width: 256, slices: 10, frames: 30 },
        createdAt: '2026-09-01T00:00:00.000Z',
        ...extra,
    };
}

function aiMask(model) {
    return { _id: `ai-${model}`, isMedSAMOutput: true, segmentationModel: model };
}

function editable(model, slices, extra = {}) {   // slices: [frame, slice, pixelsChanged]
    return {
        _id: `ed-${model}`,
        isMedSAMOutput: false,
        segmentationModel: model,
        editTracking: {
            status: 'computed',
            editedSliceCount: slices.length,
            editedAt: '2026-09-15T10:00:00.000Z',
            slices: slices.map(([frameindex, sliceindex, pixelsChanged]) =>
                ({ frameindex, sliceindex, pixelsChanged, byClass: { lvc: pixelsChanged } })),
        },
        ...extra,
    };
}

// ── Scenarios ────────────────────────────────────────────────────────────────

function test_eligible_no_results() {
    console.log('\n[1] Eligible, no results');
    const r = classifyReviewProject(project(), [], MIN);
    assert('eligible', r.eligible === true, JSON.stringify(r));
    assert('no reason', r.reason === null, String(r.reason));
    assert('not corrected', r.corrected === false);
    assert('qualifyingSlices 0', r.qualifyingSlices === 0);
    assert('no models', isDeepStrictEqual(r.models, []), JSON.stringify(r.models));
    assert('hasUnetResult false', r.hasUnetResult === false);
    assert('projectId is a string', r.projectId === 'p1');
    assert('name carried', r.name === 'Case A');
    assert('dimensions carried', isDeepStrictEqual(r.dimensions, project().dimensions));
}

function test_models_with_results() {
    console.log('\n[2] Models with results');
    const r = classifyReviewProject(project(), [aiMask('UNet'), aiMask('medsam')], MIN);
    assert('models sorted, lower case', isDeepStrictEqual(r.models, ['medsam', 'unet']), JSON.stringify(r.models));
    assert('hasUnetResult true', r.hasUnetResult === true);
    const only = classifyReviewProject(project(), [aiMask('medsam')], MIN);
    assert('MedSAM only: hasUnetResult false', only.hasUnetResult === false);
}

function test_not_nifti() {
    console.log('\n[3] Not NIfTI');
    const r = classifyReviewProject(project({ originalfilename: 'study.zip', filename: 'u1_p1.zip',
        originalfilepath: 'https://minio.local/bucket/source/study.zip' }), [], MIN);
    assert('ineligible', r.eligible === false);
    assert('reason not_nifti', r.reason === 'not_nifti', String(r.reason));
    const plain = classifyReviewProject(project({ originalfilename: 'case.nii',
        originalfilepath: 'https://minio.local/bucket/case.nii' }), [], MIN);
    assert('.nii (uncompressed) is eligible', plain.eligible === true, String(plain.reason));
}

function test_no_s3_volume() {
    console.log('\n[4] No S3 volume');
    const r = classifyReviewProject(project({ originalfilepath: '/app/uploads/patient001_4d.nii.gz' }), [], MIN);
    assert('ineligible', r.eligible === false);
    assert('reason no_s3_volume', r.reason === 'no_s3_volume', String(r.reason));
}

function test_no_dimensions() {
    console.log('\n[5] No dimensions');
    const r = classifyReviewProject(project({ dimensions: undefined, originalfilename: 'x.zip' }), [], MIN);
    assert('reason no_dimensions (checked first)', r.reason === 'no_dimensions', String(r.reason));
}

function test_corrected() {
    console.log('\n[6] Corrected');
    const r = classifyReviewProject(project(), [aiMask('unet'), editable('unet', [[0, 3, 30]])], MIN);
    assert('corrected', r.corrected === true, JSON.stringify(r));
    assert('qualifyingSlices 1', r.qualifyingSlices === 1, String(r.qualifyingSlices));
    assert('still eligible (corrected is reported separately)', r.eligible === true);
}

function test_below_min_pixels() {
    console.log('\n[7] Below min pixels');
    const r = classifyReviewProject(project(), [editable('unet', [[0, 3, 10]])], MIN);
    assert('not corrected', r.corrected === false);
    assert('qualifyingSlices 0', r.qualifyingSlices === 0);
}

function test_ai_outputs_ignored() {
    console.log('\n[8] AI outputs ignored');
    const r = classifyReviewProject(project(), [editable('unet', [[0, 0, 500]], { isMedSAMOutput: true })], MIN);
    assert('not corrected', r.corrected === false, JSON.stringify(r));
}

function test_suspect_revert() {
    console.log('\n[9] Suspect revert');
    const m = editable('unet', [[0, 0, 500]]);
    m.editTracking.suspect = 'cross-model-revert';
    const r = classifyReviewProject(project(), [m], MIN);
    assert('not corrected', r.corrected === false);
}

function test_medsam_correction() {
    console.log('\n[10] MedSAM correction');
    const r = classifyReviewProject(project(), [aiMask('medsam'), editable('medsam', [[1, 2, 40]])], MIN);
    assert('corrected', r.corrected === true);
}

function test_qualifying_slice_count() {
    console.log('\n[11] Qualifying slice count');
    const unet = editable('unet', [[0, 0, 30], [0, 1, 30], [0, 2, 5]]);
    const medsam = editable('medsam', [[0, 1, 30], [0, 4, 30]]);
    const r = classifyReviewProject(project(), [unet, medsam], MIN);
    // (0,0) unet, (0,1) contested -> one owner, (0,2) below min, (0,4) medsam  => 3
    assert('qualifyingSlices 3', r.qualifyingSlices === 3, String(r.qualifyingSlices));
}

(async () => {
    try {
        test_eligible_no_results();
        test_models_with_results();
        test_not_nifti();
        test_no_s3_volume();
        test_no_dimensions();
        test_corrected();
        test_below_min_pixels();
        test_ai_outputs_ignored();
        test_suspect_revert();
        test_medsam_correction();
        test_qualifying_slice_count();
    } catch (err) {
        console.error('Runner crashed:', err);
        process.exit(2);
    }
    console.log(`\n────────────────────────`);
    console.log(`Assertions: ${PASS} passed, ${FAIL} failed`);
    process.exit(FAIL === 0 ? 0 : 1);
})();
