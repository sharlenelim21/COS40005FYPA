/**
 * check_duplicate_slices.js
 * =========================
 * Standalone runnable test for the duplicate-slice detection + soft-exclude
 * additions in src/python/compute_heart_metrics_from_rle.py (Part A + Part B).
 *
 * No Mongo, no HTTP, no test framework — spawns the Python script with synthetic
 * RLE frames on stdin, parses stdout, and asserts. Mirrors check_heart_metrics.js
 * exactly in structure (same interpreter probe, same RLE helpers, same assert()).
 *
 * Scenarios:
 *   [1] Detect      — a slice COPIED into a new sliceindex → one duplicate_slices
 *                     entry, iou == 1.0, est_inflation_ml == n*voxel_mm3/1000,
 *                     a warning is emitted, duplicate_slices_detected == true.
 *   [2] Exclude     — mark the copy excluded=true and recompute → LVEDV drops by
 *                     exactly est_inflation_ml, duplicate_slices empty, the
 *                     duplicate warning is gone.
 *   [3] Restore     — un-exclude → LVEDV back to the inflated value, duplicate
 *                     re-flagged. Proves the soft-exclude is reversible.
 *   [4] Keep        — Python-observable half: with no exclusion the numbers and
 *                     the flag/warning are unchanged (the acknowledgedDuplicates
 *                     persistence is a route/Mongo concern, covered by tsc + the
 *                     documented curl in HEART_METRICS_IMPLEMENTATION.md).
 *   [5] No false +  — two same-COUNT but different-SHAPE slices (IoU < 0.98) are
 *                     NOT flagged. Guards that Stage 2 (position) is doing the
 *                     rejecting, not Stage 1 accidentally separating them.
 *   [6] Clean       — a fully-uniform slice stack (all slices identical) is NOT
 *                     flagged: the minority rule treats it as a degenerate stack,
 *                     not accidental copies. This is the property that keeps the
 *                     existing check_heart_metrics.js / verify.py fixtures clean.
 *
 * Run:  node scripts/check_duplicate_slices.js
 * Exits 0 on all assertions passing, 1 otherwise.
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_PATH = path.resolve(
    __dirname, '..', 'src', 'python', 'compute_heart_metrics_from_rle.py'
);

// Anisotropic short-axis CINE-style affine: 1.5 mm in-plane, 8 mm through-plane.
// voxel_mm3 = 1.5 * 1.5 * 8.0 = 18.0 mm^3.
const H = 128, W = 128;
const VOX = 18.0;
const AFFINE = [
    [1.5, 0.0, 0.0, 0.0],
    [0.0, 1.5, 0.0, 0.0],
    [0.0, 0.0, 8.0, 0.0],
    [0.0, 0.0, 0.0, 1.0],
];

// ── RLE helpers (identical to check_heart_metrics.js) ────────────────────────

/** Encode a filled disk of radius r centred at (cx, cy) as RLE. One run per row. */
function rleFromDisk(H, W, cx, cy, r) {
    const parts = [];
    for (let y = 0; y < H; y++) {
        const dy = y - cy;
        const dx2 = r * r - dy * dy;
        if (dx2 < 0) continue;
        const dx = Math.sqrt(dx2);
        const xMin = Math.max(0, Math.ceil(cx - dx));
        const xMax = Math.min(W - 1, Math.floor(cx + dx));
        if (xMax < xMin) continue;
        parts.push(y * W + xMin, xMax - xMin + 1);
    }
    return parts.join(' ');
}

/** Encode an annulus (rInner < r <= rOuter) as RLE. Up to two runs per row. */
function rleFromAnnulus(H, W, cx, cy, rInner, rOuter) {
    const parts = [];
    for (let y = 0; y < H; y++) {
        const dy = y - cy;
        const rOut2 = rOuter * rOuter - dy * dy;
        if (rOut2 < 0) continue;
        const dxOut = Math.sqrt(rOut2);
        const xOutMin = Math.max(0, Math.ceil(cx - dxOut));
        const xOutMax = Math.min(W - 1, Math.floor(cx + dxOut));
        if (xOutMax < xOutMin) continue;

        const rIn2 = rInner * rInner - dy * dy;
        if (rIn2 < 0) {
            parts.push(y * W + xOutMin, xOutMax - xOutMin + 1);
        } else {
            const dxIn = Math.sqrt(rIn2);
            const xInMin = Math.max(0, Math.ceil(cx - dxIn));
            const xInMax = Math.min(W - 1, Math.floor(cx + dxIn));
            const leftLen = (xInMin - 1) - xOutMin + 1;
            if (leftLen > 0) parts.push(y * W + xOutMin, leftLen);
            const rightLen = xOutMax - (xInMax + 1) + 1;
            if (rightLen > 0) parts.push(y * W + (xInMax + 1), rightLen);
        }
    }
    return parts.join(' ');
}

/** Sum of run lengths in an RLE string = its voxel count. Used to prove two
 *  false-positive slices genuinely share a voxel count (so Stage 2 is tested). */
function rleCount(rle) {
    const t = rle.trim().split(/\s+/).map(Number);
    let c = 0;
    for (let i = 1; i < t.length; i += 2) c += t[i];
    return c;
}

// ── Frame factory ────────────────────────────────────────────────────────────

function makeFrame(frameindex, slices) {
    return { frameindex, frameinferred: true, slices };
}

function makeSlice(sliceindex, entries, excluded) {
    const slice = {
        sliceindex,
        segmentationmasks: entries.map(e => ({
            class: e.cls,
            segmentationmaskcontents: e.contents,
        })),
    };
    if (excluded) slice.excluded = true;
    return slice;
}

// ── Python invocation (identical probe to check_heart_metrics.js) ────────────

let _cachedPythonBin = null;
function findPython() {
    if (_cachedPythonBin) return _cachedPythonBin;
    for (const bin of ['python3', 'python', 'py']) {
        const probe = spawnSync(bin, ['-c', 'import numpy, sys; sys.stdout.write("ok")'], {
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
    throw new Error(
        "No Python interpreter with numpy on PATH. Tried python3, python, py. " +
        "Install numpy (`pip install numpy`) or run inside the project's container."
    );
}

function runPython(payload) {
    const bin = findPython();
    const res = spawnSync(bin, [SCRIPT_PATH], {
        input: JSON.stringify(payload),
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

// ── Assertion helpers ────────────────────────────────────────────────────────

let PASS = 0;
let FAIL = 0;

function assert(name, cond, detail) {
    if (cond) {
        console.log(`  ✓ ${name}`);
        PASS++;
    } else {
        console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`);
        FAIL++;
    }
}

function dupWarnings(out) {
    return (out.warnings ?? []).filter(w => /duplicate slice/i.test(w));
}

// ── Shared fixture: an ED frame with a copied LVC slice ──────────────────────
// ED frame (index 0): 3 slices.
//   slice 0 : LVC disc r=20                         (count A)
//   slice 1 : LVC disc r=18  (genuinely different)  (count B != A)
//   slice 2 : LVC disc r=20  (an EXACT copy of s0)  (count A)  <-- the duplicate
// Every slice also carries a CONSTANT myo ring + rv disc, so the myo and rv
// groups are uniform (minority rule skips them) and there are no missing-MYO /
// missing-RV warnings — leaving LVC as the only group that yields a duplicate,
// i.e. exactly one duplicate_slices entry.
// ES frame (index 1): one small slice, so ED stays frame 0 whether or not s2 is
// excluded (frame-0 LV >> frame-1 LV either way) and ES stays frame 1.
function buildDupFrames(excludeCopy) {
    const lvc0 = rleFromDisk(H, W, 64, 64, 20);
    const lvc1 = rleFromDisk(H, W, 64, 64, 18);
    const lvc2 = lvc0; // exact copy of slice 0
    const myo  = rleFromAnnulus(H, W, 64, 64, 22, 26); // constant, outside the LVC disc
    const rv   = rleFromDisk(H, W, 104, 64, 8);        // constant, disjoint from LV
    const edSlice = (si, lvc, excl) => makeSlice(si, [
        { cls: 'lvc', contents: lvc },
        { cls: 'myo', contents: myo },
        { cls: 'rv',  contents: rv },
    ], excl);
    const ed = makeFrame(0, [
        edSlice(0, lvc0, false),
        edSlice(1, lvc1, false),
        edSlice(2, lvc2, excludeCopy),
    ]);
    const es = makeFrame(1, [
        makeSlice(0, [
            { cls: 'lvc', contents: rleFromDisk(H, W, 64, 64, 10) },
            { cls: 'myo', contents: myo },
            { cls: 'rv',  contents: rleFromDisk(H, W, 104, 64, 6) },
        ], false),
    ]);
    return [ed, es];
}

// ── Tests 1–4: detect / exclude / restore / keep ─────────────────────────────

function test_detect_exclude_restore_keep() {
    console.log('\n[1-4] Detect / Exclude / Restore / Keep on a copied LVC slice');

    // Inflated run (copy present, not excluded) — this is also the "keep" and
    // "restore" state, since none of them exclude the slice.
    const inflated = runPython({ frames: buildDupFrames(false), width: W, height: H, affine: AFFINE });
    if (inflated.status !== 0) {
        console.log('  Python stderr:', inflated.stderr);
        assert('inflated run exits 0', false, `exit ${inflated.status}`);
        return;
    }
    const outInflated = safeJson(inflated.stdout, inflated.stderr);
    console.log('  inflated: LVEDV=', outInflated.LVEDV, ' duplicate_slices=', JSON.stringify(outInflated.duplicate_slices));

    // ── [1] Detect ──────────────────────────────────────────────────────────
    const dups = outInflated.duplicate_slices ?? [];
    assert('[1] exactly one duplicate_slices entry', dups.length === 1, `got ${dups.length}: ${JSON.stringify(dups)}`);
    assert('[1] duplicate_slices_detected == true', outInflated.duplicate_slices_detected === true);
    const d = dups[0] ?? {};
    assert('[1] duplicate is in frame 0', d.frame === 0, `got ${d.frame}`);
    assert('[1] duplicate class is lvc', d.class === 'lvc', `got ${d.class}`);
    assert('[1] slice_keep == 0 (lower index)', d.slice_keep === 0, `got ${d.slice_keep}`);
    assert('[1] slice_remove == 2 (higher index)', d.slice_remove === 2, `got ${d.slice_remove}`);
    assert('[1] iou == 1.0 (exact copy)', d.iou === 1.0, `got ${d.iou}`);
    assert('[1] est_inflation_ml == voxel_count * voxel_mm3 / 1000',
        Math.abs(d.est_inflation_ml - (d.voxel_count * outInflated.voxel_mm3 / 1000)) < 1e-9,
        `est=${d.est_inflation_ml}, expected=${d.voxel_count * outInflated.voxel_mm3 / 1000}`);
    assert('[1] a duplicate warning is emitted', dupWarnings(outInflated).length === 1, JSON.stringify(outInflated.warnings));
    assert('[1] voxel_mm3 == 18.0 (sanity)', Math.abs(outInflated.voxel_mm3 - VOX) < 1e-9, `got ${outInflated.voxel_mm3}`);
    assert('[1] ED auto-detected as frame 0', outInflated.ed_frame === 0, `got ${outInflated.ed_frame}`);

    // ── [2] Exclude ─────────────────────────────────────────────────────────
    const excludedRun = runPython({ frames: buildDupFrames(true), width: W, height: H, affine: AFFINE });
    if (excludedRun.status !== 0) {
        console.log('  Python stderr:', excludedRun.stderr);
        assert('[2] excluded run exits 0', false, `exit ${excludedRun.status}`);
        return;
    }
    const outExcluded = safeJson(excludedRun.stdout, excludedRun.stderr);
    console.log('  excluded: LVEDV=', outExcluded.LVEDV, ' duplicate_slices=', JSON.stringify(outExcluded.duplicate_slices));

    assert('[2] LVEDV drops by exactly est_inflation_ml',
        Math.abs((outInflated.LVEDV - outExcluded.LVEDV) - d.est_inflation_ml) < 1e-9,
        `drop=${outInflated.LVEDV - outExcluded.LVEDV}, est=${d.est_inflation_ml}`);
    assert('[2] duplicate_slices is now empty', (outExcluded.duplicate_slices ?? []).length === 0,
        JSON.stringify(outExcluded.duplicate_slices));
    assert('[2] duplicate_slices_detected == false', outExcluded.duplicate_slices_detected === false);
    assert('[2] the duplicate warning is gone', dupWarnings(outExcluded).length === 0, JSON.stringify(outExcluded.warnings));
    assert('[2] ED still frame 0 (exclusion did not flip ED/ES)', outExcluded.ed_frame === 0, `got ${outExcluded.ed_frame}`);

    // ── [3] Restore ─────────────────────────────────────────────────────────
    // Un-excluding = the inflated payload again. Prove reversibility by value.
    assert('[3] restore returns LVEDV to the inflated value',
        Math.abs(outInflated.LVEDV - outExcluded.LVEDV) > 1e-9 &&   // they really differ, and...
        outInflated.LVEDV > outExcluded.LVEDV,                       // ...restore is the larger one
        `inflated=${outInflated.LVEDV}, excluded=${outExcluded.LVEDV}`);
    assert('[3] duplicate re-flagged after restore', (outInflated.duplicate_slices ?? []).length === 1);

    // ── [4] Keep (Python-observable half) ────────────────────────────────────
    // "keep" performs NO exclusion, so the numbers + flag + warning are exactly
    // the inflated state. (acknowledgedDuplicates persistence is route/Mongo —
    // see HEART_METRICS_IMPLEMENTATION.md for the curl + it rides on tsc.)
    assert('[4] keep leaves LVEDV inflated (unchanged vs detection)',
        outInflated.LVEDV > outExcluded.LVEDV);
    assert('[4] keep leaves the duplicate flagged', (outInflated.duplicate_slices ?? []).length === 1);
    assert('[4] keep leaves the duplicate warning present', dupWarnings(outInflated).length === 1);
}

// ── Test 5: no false positive (same count, different shape) ──────────────────

function test_no_false_positive() {
    console.log('\n[5] Same voxel COUNT but different SHAPE (IoU < 0.98) → NOT flagged');
    // Two discs of the SAME radius: an integer x-shift preserves the rasterised
    // voxel count exactly but moves ~40% of the pixels, so IoU is well under 0.98.
    const d0 = rleFromDisk(H, W, 64, 64, 20);
    const d1 = rleFromDisk(H, W, 72, 64, 20);
    assert('[5] the two discs have EQUAL voxel count (so Stage 2 is what rejects)',
        rleCount(d0) === rleCount(d1), `${rleCount(d0)} vs ${rleCount(d1)}`);
    const frames = [
        makeFrame(0, [
            makeSlice(0, [{ cls: 'lvc', contents: d0 }], false),
            makeSlice(1, [{ cls: 'lvc', contents: d1 }], false),
        ]),
        makeFrame(1, [makeSlice(0, [{ cls: 'lvc', contents: rleFromDisk(H, W, 64, 64, 10) }], false)]),
    ];
    const res = runPython({ frames, width: W, height: H, affine: AFFINE });
    if (res.status !== 0) {
        console.log('  Python stderr:', res.stderr);
        assert('[5] exits 0', false, `exit ${res.status}`);
        return;
    }
    const out = safeJson(res.stdout, res.stderr);
    console.log('  duplicate_slices=', JSON.stringify(out.duplicate_slices));
    assert('[5] duplicate_slices empty', (out.duplicate_slices ?? []).length === 0, JSON.stringify(out.duplicate_slices));
    assert('[5] duplicate_slices_detected == false', out.duplicate_slices_detected === false);
    assert('[5] no duplicate warning', dupWarnings(out).length === 0, JSON.stringify(out.warnings));
}

// ── Test 6: clean uniform stack (minority rule) ──────────────────────────────

function test_uniform_stack_clean() {
    console.log('\n[6] Fully-uniform slice stack (all identical) → NOT flagged (minority rule)');
    // Three identical LVC slices in one frame — the exact shape of the
    // check_heart_metrics.js happy path and the verify.py fixture. The minority
    // rule treats a wholly-uniform group as a degenerate stack, not copies.
    const d = rleFromDisk(H, W, 64, 64, 20);
    const frames = [
        makeFrame(0, [
            makeSlice(0, [{ cls: 'lvc', contents: d }], false),
            makeSlice(1, [{ cls: 'lvc', contents: d }], false),
            makeSlice(2, [{ cls: 'lvc', contents: d }], false),
        ]),
        makeFrame(1, [makeSlice(0, [{ cls: 'lvc', contents: rleFromDisk(H, W, 64, 64, 10) }], false)]),
    ];
    const res = runPython({ frames, width: W, height: H, affine: AFFINE });
    if (res.status !== 0) {
        console.log('  Python stderr:', res.stderr);
        assert('[6] exits 0', false, `exit ${res.status}`);
        return;
    }
    const out = safeJson(res.stdout, res.stderr);
    console.log('  duplicate_slices=', JSON.stringify(out.duplicate_slices), ' warnings=', JSON.stringify(out.warnings));
    assert('[6] duplicate_slices empty on a uniform stack', (out.duplicate_slices ?? []).length === 0,
        JSON.stringify(out.duplicate_slices));
    assert('[6] duplicate_slices_detected == false', out.duplicate_slices_detected === false);
    assert('[6] no duplicate warning on a uniform stack', dupWarnings(out).length === 0, JSON.stringify(out.warnings));
}

// ── Main ─────────────────────────────────────────────────────────────────────

(function main() {
    console.log('Running duplicate-slice detection + soft-exclude assertions');
    console.log(`Script: ${SCRIPT_PATH}`);
    try {
        test_detect_exclude_restore_keep();
        test_no_false_positive();
        test_uniform_stack_clean();
    } catch (err) {
        console.error('Runner crashed:', err);
        process.exit(2);
    }
    console.log(`\n────────────`);
    console.log(`Assertions: ${PASS} passed, ${FAIL} failed`);
    process.exit(FAIL === 0 ? 0 : 1);
})();
