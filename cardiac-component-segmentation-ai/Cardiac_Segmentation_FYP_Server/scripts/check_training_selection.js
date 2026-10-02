/**
 * check_training_selection.js
 * ===========================
 * Standalone runnable test for src/services/training_selection.ts (compiled to dist/).
 *
 * No Mongo, no HTTP, no test framework — feeds synthetic editable masks of one project to
 * selectTrainingSlices and asserts which slices of which model become training labels.
 * Build first (pnpm run build); the test loads dist/services/training_selection.js.
 *
 * Scenarios:
 *   [1]  One UNet mask           (slices below min pixels are dropped)
 *   [2]  Manual pixels           (a slice with manual pixels is dropped)
 *   [3]  Different slices        (UNet and MedSAM corrections on different slices both count)
 *   [4]  Same slice              (the later save wins)
 *   [5]  Same slice, same time   (UNet wins the tie)
 *   [6]  Not usable              (suspect and untracked masks are skipped)
 *   [7]  Model tags              (case-insensitive; model_used fallback; unknown model skipped)
 *   [8]  Missing editedAt        (counts as oldest)
 *   [9]  Partial overlap         (only the shared slice is contested)
 *   [10] Ordering                (slices come out sorted by frame, then slice)
 *   [11] Identical corrections   (not a conflict: one copy, nothing to choose)
 *   [12] Differing corrections   (listed as a conflict, the later save suggested)
 *   [13] A reviewed choice       (overrides the suggestion)
 *   [14] An invalid choice       (ignored and counted)
 *
 * Run:  node scripts/check_training_selection.js
 * Exits 0 on all assertions passing, 1 otherwise.
 */

'use strict';

const path = require('path');
const { isDeepStrictEqual } = require('util');

let selectTrainingSlices;
try {
    ({ selectTrainingSlices } = require(path.resolve(__dirname, '..', 'dist', 'services', 'training_selection')));
} catch (err) {
    console.error(`Cannot load dist/services/training_selection.js (build first): ${err.message}`);
    process.exit(1);
}

// ── Assertion harness (same shape as check_health_status.js) ────────────────

let PASS = 0, FAIL = 0;
function assert(name, cond, detail) {
    if (cond) { console.log(`  ✓ ${name}`); PASS++; }
    else      { console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`); FAIL++; }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MIN = 20;
let nextId = 1;

function mask(model, editedAt, slices, extra = {}) {   // slices: [frame, slice, pixelsChanged, byClass?]
    return {
        _id: `m${nextId++}`,
        segmentationModel: model,
        editTracking: {
            status: 'computed',
            editedSliceCount: slices.length,
            editedAt,
            slices: slices.map(([frameindex, sliceindex, pixelsChanged, byClass]) =>
                ({ frameindex, sliceindex, pixelsChanged, byClass: byClass ?? { rv: pixelsChanged } })),
            ...extra,
        },
    };
}

const keys = (entry) => entry.slices.map((s) => [s.frameindex, s.sliceindex]);
const byModel = (out, model) => out.selected.find((entry) => entry.model === model);
const show = (out) => JSON.stringify({
    selected: out.selected.map((e) => ({ model: e.model, id: e.mask._id, slices: keys(e) })),
    skipped: out.skipped,
    conflicts: out.conflicts,
});
const contested = () => [
    mask('unet', '2026-09-15T10:00:00Z', [[0, 5, 30]]),
    mask('medsam', '2026-09-15T11:00:00Z', [[0, 5, 30]]),
];

// ── Scenarios ────────────────────────────────────────────────────────────────

function test_one_unet_mask() {
    console.log('\n[1] One UNet mask — slices below min pixels are dropped');
    const out = selectTrainingSlices([mask('unet', '2026-09-15T10:00:00Z', [[0, 3, 25], [0, 4, 10]])], MIN);
    assert('keeps [0,3] only; counts one slice below min pixels',
        out.selected.length === 1 && isDeepStrictEqual(keys(out.selected[0]), [[0, 3]])
            && out.skipped.slice_below_min_pixels === 1,
        show(out));
}

function test_manual_pixels() {
    console.log('\n[2] Manual pixels — the slice is dropped');
    const out = selectTrainingSlices([mask('medsam', '2026-09-15T10:00:00Z', [[0, 2, 40, { rv: 30, manual: 10 }]])], MIN);
    assert('nothing selected; one manual slice counted',
        out.selected.length === 0 && out.skipped.slice_manual === 1, show(out));
}

function test_different_slices() {
    console.log('\n[3] UNet and MedSAM corrections on different slices both count');
    const out = selectTrainingSlices([
        mask('unet', '2026-09-15T10:00:00Z', [[0, 1, 30]]),
        mask('medsam', '2026-09-15T11:00:00Z', [[0, 2, 30]]),
    ], MIN);
    assert('UNet keeps [0,1]; MedSAM keeps [0,2]',
        isDeepStrictEqual(keys(byModel(out, 'unet') ?? { slices: [] }), [[0, 1]])
            && isDeepStrictEqual(keys(byModel(out, 'medsam') ?? { slices: [] }), [[0, 2]]),
        show(out));
}

function test_same_slice_later_save_wins() {
    console.log('\n[4] Same slice corrected in both models — the later save wins');
    const out = selectTrainingSlices(contested(), MIN);
    assert('only MedSAM keeps [0,5]; one conflict counted',
        out.selected.length === 1 && out.selected[0].model === 'medsam'
            && isDeepStrictEqual(keys(out.selected[0]), [[0, 5]]) && out.skipped.slice_conflict_older_save === 1,
        show(out));
}

function test_same_time_unet_wins() {
    console.log('\n[5] Same slice, same save time — UNet wins the tie');
    const out = selectTrainingSlices([
        mask('medsam', '2026-09-15T10:00:00Z', [[1, 0, 30]]),
        mask('unet', '2026-09-15T10:00:00Z', [[1, 0, 30]]),
    ], MIN);
    assert('only UNet keeps [1,0]',
        out.selected.length === 1 && out.selected[0].model === 'unet', show(out));
}

function test_not_usable() {
    console.log('\n[6] Suspect and untracked masks are skipped');
    const suspect = mask('unet', '2026-09-15T10:00:00Z', [[0, 1, 30]], { suspect: 'cross-model-revert' });
    const untracked = mask('medsam', '2026-09-15T10:00:00Z', [[0, 2, 30]], { status: 'no_baseline' });
    const empty = mask('medsam', '2026-09-15T10:00:00Z', [], { editedSliceCount: 0 });
    const out = selectTrainingSlices([suspect, untracked, empty], MIN);
    assert('nothing selected; 1 suspect and 2 not tracked',
        out.selected.length === 0 && out.skipped.suspect === 1 && out.skipped.not_tracked === 2, show(out));
}

function test_model_tags() {
    console.log('\n[7] Model tags — case-insensitive, model_used fallback, unknown skipped');
    const upper = mask('UNet', '2026-09-15T10:00:00Z', [[0, 1, 30]]);
    const fallback = mask(undefined, '2026-09-15T10:00:00Z', [[0, 2, 30]]);
    fallback.model_used = 'medsam';
    const unknown = mask('yolo', '2026-09-15T10:00:00Z', [[0, 3, 30]]);
    const out = selectTrainingSlices([upper, fallback, unknown], MIN);
    assert('unet and medsam selected; one unknown model',
        Boolean(byModel(out, 'unet')) && Boolean(byModel(out, 'medsam')) && out.selected.length === 2
            && out.skipped.unknown_model === 1,
        show(out));
}

function test_missing_edited_at() {
    console.log('\n[8] Missing editedAt counts as oldest');
    const out = selectTrainingSlices([
        mask('unet', undefined, [[0, 7, 30]]),
        mask('medsam', '2026-09-15T09:00:00Z', [[0, 7, 30]]),
    ], MIN);
    assert('MedSAM keeps [0,7]',
        out.selected.length === 1 && out.selected[0].model === 'medsam', show(out));
}

function test_partial_overlap() {
    console.log('\n[9] Partial overlap — only the shared slice is contested');
    const out = selectTrainingSlices([
        mask('unet', '2026-09-15T10:00:00Z', [[0, 1, 30], [0, 2, 30]]),
        mask('medsam', '2026-09-15T11:00:00Z', [[0, 2, 30], [0, 3, 30]]),
    ], MIN);
    assert('UNet keeps [0,1]; MedSAM keeps [0,2],[0,3]; one conflict',
        isDeepStrictEqual(keys(byModel(out, 'unet') ?? { slices: [] }), [[0, 1]])
            && isDeepStrictEqual(keys(byModel(out, 'medsam') ?? { slices: [] }), [[0, 2], [0, 3]])
            && out.skipped.slice_conflict_older_save === 1,
        show(out));
}

function test_ordering() {
    console.log('\n[10] Slices come out sorted by frame, then slice');
    const out = selectTrainingSlices([mask('unet', '2026-09-15T10:00:00Z', [[1, 0, 30], [0, 9, 30], [0, 2, 30]])], MIN);
    assert('order [0,2], [0,9], [1,0]',
        out.selected.length === 1 && isDeepStrictEqual(keys(out.selected[0]), [[0, 2], [0, 9], [1, 0]]), show(out));
}

function test_identical_corrections() {
    console.log('\n[11] Identical corrections on the same slice are not a conflict');
    const out = selectTrainingSlices(contested(), MIN, { identicalSlices: new Set(['0:5']) });
    assert('one copy kept; counted as a duplicate; no conflict listed',
        out.selected.length === 1 && out.skipped.slice_duplicate_identical === 1
            && !out.skipped.slice_conflict_older_save && Array.isArray(out.conflicts) && out.conflicts.length === 0,
        show(out));
}

function test_conflict_listed_with_suggestion() {
    console.log('\n[12] Differing corrections are listed as a conflict, the later save suggested');
    const out = selectTrainingSlices(contested(), MIN);
    const c = Array.isArray(out.conflicts) ? out.conflicts[0] : undefined;
    assert('conflict [0,5]: suggested and used medsam, not chosen, two contenders',
        Boolean(c) && out.conflicts.length === 1 && c.frameindex === 0 && c.sliceindex === 5
            && c.suggested === 'medsam' && c.used === 'medsam' && c.chosen === false && c.contenders.length === 2,
        show(out));
}

function test_choice_overrides_suggestion() {
    console.log('\n[13] A reviewed choice overrides the suggestion');
    const out = selectTrainingSlices(contested(), MIN, { choices: { '0:5': 'unet' } });
    const c = Array.isArray(out.conflicts) ? out.conflicts[0] : undefined;
    assert('UNet keeps [0,5]; conflict shows suggested medsam, used unet, chosen',
        out.selected.length === 1 && out.selected[0].model === 'unet' && out.skipped.slice_conflict_other_choice === 1
            && Boolean(c) && c.suggested === 'medsam' && c.used === 'unet' && c.chosen === true,
        show(out));
}

function test_invalid_choice_ignored() {
    console.log('\n[14] A choice naming neither contender is ignored');
    const out = selectTrainingSlices(contested(), MIN, { choices: { '0:5': 'yolo' } });
    assert('MedSAM (the later save) keeps [0,5]; one invalid choice counted',
        out.selected.length === 1 && out.selected[0].model === 'medsam' && out.skipped.invalid_choice === 1,
        show(out));
}

// ── Runner ───────────────────────────────────────────────────────────────────

(async () => {
    try {
        test_one_unet_mask();
        test_manual_pixels();
        test_different_slices();
        test_same_slice_later_save_wins();
        test_same_time_unet_wins();
        test_not_usable();
        test_model_tags();
        test_missing_edited_at();
        test_partial_overlap();
        test_ordering();
        test_identical_corrections();
        test_conflict_listed_with_suggestion();
        test_choice_overrides_suggestion();
        test_invalid_choice_ignored();
    } catch (err) {
        console.error('Runner crashed:', err);
        process.exit(2);
    }
    console.log(`\n────────────────────────`);
    console.log(`Assertions: ${PASS} passed, ${FAIL} failed`);
    process.exit(FAIL === 0 ? 0 : 1);
})();
