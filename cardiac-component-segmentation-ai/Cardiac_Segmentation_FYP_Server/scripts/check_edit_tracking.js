/**
 * check_edit_tracking.js
 * ======================
 * Standalone runnable test for src/python/compute_edit_tracking.py.
 *
 * No Mongo, no HTTP, no test framework — just spawns the Python script with
 * synthetic AI and edited frames on stdin, parses stdout, and asserts the
 * changed-pixel counts. Every scenario uses a 10 × 10 plane unless it says
 * otherwise.
 *
 * Scenarios:
 *   [1]  Unchanged slice        (same RLE on both sides → nothing tracked)
 *   [2]  LV cavity grown        (exact slices entry)
 *   [3]  RV moved               (4 removed + 4 added → 8)
 *   [4]  Non-canonical RLE      (same pixels, different runs → 0)
 *   [5]  Out-of-plane run       (skipped whole, as decode_rle does → 0)
 *   [6]  Manual pixels          (counted separately, class listed)
 *   [7]  Slice missing from AI  (all edited pixels count, with a warning)
 *   [8]  No plane               (error, still exit 0)
 *   [9]  Two frames, unsorted   (sorted by frame then slice)
 *   [10] Unknown class          (ignored with a warning)
 *   [11] Duplicate class        (two entries of one class are OR-ed)
 *   [12] Upper-case class name  (class names are case-insensitive)
 *   [13] Non-integer plane      (error, still exit 0)
 *
 * Run:  node scripts/check_edit_tracking.js
 * Exits 0 on all assertions passing, 1 otherwise.
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { isDeepStrictEqual } = require('util');

const SCRIPT_PATH = path.resolve(
    __dirname, '..', 'src', 'python', 'compute_edit_tracking.py'
);

// ── Interpreter probe (identical to check_health_status.js) ──────────────────

let _cachedPythonBin = null;
function findPython() {
    if (_cachedPythonBin) return _cachedPythonBin;
    for (const bin of ['python3', 'python', 'py']) {
        // The edit-tracking script needs no numpy — a plain Python 3 works.
        const probe = spawnSync(bin, ['-c', 'import sys; sys.stdout.write("ok")'], {
            encoding: 'utf-8',
            timeout: 15000,
            windowsHide: true,
        });
        if (!probe.error && probe.status === 0 && probe.stdout.trim() === 'ok') {
            _cachedPythonBin = bin;
            console.log(`  (using interpreter: ${bin})`);
            return bin;
        }
    }
    throw new Error("No Python 3 interpreter on PATH (tried python3, python, py).");
}

function runPython(payload) {
    const bin = findPython();
    const stdinStr = JSON.stringify(payload);
    const res = spawnSync(bin, [SCRIPT_PATH], {
        input: stdinStr,
        encoding: 'utf-8',
        timeout: 30000,
        windowsHide: true,
    });
    return { bin, ...res };
}

function safeJson(raw, stderr) {
    try {
        return JSON.parse((raw ?? '').trim());
    } catch (e) {
        return { error: `[non-JSON stdout] ${e.message}. stderr=${(stderr ?? '').substring(0, 300)}` };
    }
}

// ── Assertion harness ────────────────────────────────────────────────────────

let PASS = 0, FAIL = 0;
function assert(name, cond, detail) {
    if (cond) { console.log(`  ✓ ${name}`); PASS++; }
    else      { console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`); FAIL++; }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PLANE = { height: 10, width: 10 };

function frames(...specs) {            // each spec: [frameindex, sliceindex, [[class, rle], ...]]
    const byFrame = new Map();
    for (const [fi, si, masks] of specs) {
        if (!byFrame.has(fi)) byFrame.set(fi, []);
        byFrame.get(fi).push({ sliceindex: si,
            segmentationmasks: masks.map(([c, r]) => ({ class: c, segmentationmaskcontents: r })) });
    }
    return [...byFrame].map(([frameindex, slices]) => ({ frameindex, slices }));
}

function track(ai, edited, plane = PLANE) {
    const res = runPython({ ai_frames: ai, edited_frames: edited, plane });
    return { status: res.status, out: safeJson(res.stdout, res.stderr) };
}

function show(result) {
    return `exit=${result.status} out=${JSON.stringify(result.out)}`;
}

// ── Scenarios ────────────────────────────────────────────────────────────────

function test_unchanged() {
    console.log('\n[1] Unchanged slice — same RLE on both sides');
    const ai = frames([0, 3, [['lvc', '10 5']]]);
    const r = track(ai, ai);
    const o = r.out;
    assert('nothing tracked; one slice compared',
        r.status === 0 && o.editedSliceCount === 0 && o.pixelsChanged === 0
            && Array.isArray(o.slices) && o.slices.length === 0 && o.slicesCompared === 1,
        show(r));
}

function test_lvc_grown() {
    console.log('\n[2] LV cavity grown from 5 to 10 pixels');
    const r = track(frames([0, 3, [['lvc', '10 5']]]), frames([0, 3, [['lvc', '10 10']]]));
    const expected = [{ frameindex: 0, sliceindex: 3, editedClasses: ['lvc'], pixelsChanged: 5, byClass: { lvc: 5 } }];
    assert('slices entry is exact', r.status === 0 && isDeepStrictEqual(r.out.slices, expected), show(r));
}

function test_rv_moved() {
    console.log('\n[3] RV run moved from 10 to 20');
    const r = track(frames([0, 0, [['rv', '10 4']]]), frames([0, 0, [['rv', '20 4']]]));
    assert('8 pixels changed', r.status === 0 && r.out.pixelsChanged === 8, show(r));
}

function test_non_canonical_rle() {
    console.log('\n[4] Same pixels written as different runs');
    const r = track(frames([0, 0, [['myo', '5 3 0 5']]]), frames([0, 0, [['myo', '0 8']]]));
    assert('0 pixels changed', r.status === 0 && r.out.pixelsChanged === 0, show(r));
}

function test_out_of_plane_run() {
    console.log('\n[5] A run that leaves the plane is skipped whole');
    const r = track(frames([0, 0, [['lvc', '0 4']]]), frames([0, 0, [['lvc', '0 4 95 10']]]));
    assert('0 pixels changed', r.status === 0 && r.out.pixelsChanged === 0, show(r));
}

function test_manual_pixels() {
    console.log('\n[6] Manual pixels added to an unchanged slice');
    const r = track(frames([0, 0, [['lvc', '0 4']]]), frames([0, 0, [['lvc', '0 4'], ['manual', '30 7']]]));
    const o = r.out;
    assert('manualPixels 7; editedClasses ["manual"]',
        r.status === 0 && o.manualPixels === 7 && Array.isArray(o.slices) && o.slices.length === 1
            && isDeepStrictEqual(o.slices[0].editedClasses, ['manual']),
        show(r));
}

function test_slice_missing_from_ai() {
    console.log('\n[7] Edited slice that the AI output does not have');
    const r = track([], frames([0, 2, [['lvc', '0 6']]]));
    const warnings = Array.isArray(r.out.warnings) ? r.out.warnings : [];
    assert('6 pixels changed, with a warning',
        r.status === 0 && r.out.pixelsChanged === 6 && warnings.some(w => /missing from the AI output/.test(w)),
        show(r));
}

function test_no_plane() {
    console.log('\n[8] No frames and no plane');
    const res = runPython({ ai_frames: [], edited_frames: [] });
    const r = { status: res.status, out: safeJson(res.stdout, res.stderr) };
    assert('error reported, exit 0', r.status === 0 && typeof r.out.error === 'string', show(r));
}

function test_two_frames_unsorted() {
    console.log('\n[9] Two frames given out of order');
    const r = track(
        frames([1, 0, [['rv', '0 2']]], [0, 5, [['rv', '0 2']]]),
        frames([1, 0, [['rv', '0 4']]], [0, 5, [['rv', '2 2']]]),
    );
    const o = r.out;
    const order = Array.isArray(o.slices) ? o.slices.map(s => [s.frameindex, s.sliceindex]) : null;
    assert('2 slices, 6 pixels, sorted [0,5] then [1,0]',
        r.status === 0 && o.editedSliceCount === 2 && o.pixelsChanged === 6
            && isDeepStrictEqual(order, [[0, 5], [1, 0]]),
        show(r));
}

function test_unknown_class() {
    console.log('\n[10] Unknown class next to an unchanged one');
    const r = track(frames([0, 0, [['lvc', '0 4']]]), frames([0, 0, [['lvc', '0 4'], ['la', '50 9']]]));
    const warnings = Array.isArray(r.out.warnings) ? r.out.warnings : [];
    assert("0 pixels changed, warning names 'la'",
        r.status === 0 && r.out.pixelsChanged === 0 && warnings.some(w => w.includes("unknown class 'la'")),
        show(r));
}

function test_duplicate_class() {
    console.log('\n[11] Two entries of one class are OR-ed together');
    const r = track(frames([0, 0, [['lvc', '0 6']]]), frames([0, 0, [['lvc', '0 4'], ['lvc', '2 4']]]));
    assert('0 pixels changed', r.status === 0 && r.out.pixelsChanged === 0, show(r));
}

function test_upper_case_class() {
    console.log('\n[12] Class names are case-insensitive');
    const r = track(frames([0, 0, [['lvc', '0 6']]]), frames([0, 0, [['LVC', '0 6']]]));
    assert('0 pixels changed', r.status === 0 && r.out.pixelsChanged === 0, show(r));
}

function test_non_integer_plane() {
    console.log('\n[13] Plane height that is not an integer');
    const r = track([], [], { height: true, width: 10 });
    assert('error reported, exit 0', r.status === 0 && typeof r.out.error === 'string', show(r));
}

// ── Runner ───────────────────────────────────────────────────────────────────

(async () => {
    try {
        test_unchanged();
        test_lvc_grown();
        test_rv_moved();
        test_non_canonical_rle();
        test_out_of_plane_run();
        test_manual_pixels();
        test_slice_missing_from_ai();
        test_no_plane();
        test_two_frames_unsorted();
        test_unknown_class();
        test_duplicate_class();
        test_upper_case_class();
        test_non_integer_plane();
    } catch (err) {
        console.error('Runner crashed:', err);
        process.exit(2);
    }
    console.log(`\n────────────────────────`);
    console.log(`Assertions: ${PASS} passed, ${FAIL} failed`);
    process.exit(FAIL === 0 ? 0 : 1);
})();
