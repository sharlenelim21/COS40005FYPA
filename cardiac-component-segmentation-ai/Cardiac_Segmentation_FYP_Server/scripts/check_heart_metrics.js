/**
 * check_heart_metrics.js
 * ======================
 * Standalone runnable test for src/python/compute_heart_metrics_from_rle.py.
 *
 * No Mongo, no HTTP, no test framework — just spawns the Python script with
 * synthetic RLE frames on stdin, parses stdout, and asserts:
 *   1. Happy multi-frame path: 0 <= LVEF <= 100, LVEDV > LVESV,
 *      RVEDV > RVESV, LV_mass_g > 0, ed_frame != es_frame, warnings empty,
 *      volumes land in plausible adult ranges.
 *   2. Single-frame path (Addition A): script exits 0, per-frame volumes
 *      present, LVEF / LV_SV / RVEF / RV_SV are null, warnings explain it.
 *   3. Missing-MYO path (Addition B): LVEF is computed, LV_mass_g is null,
 *      warnings mention myocardium.
 *   4. No-LVC path: hard error JSON + exit 1.
 *   5. Missing / wrong-shape affine: hard error JSON + exit 1.
 *
 * Run:  node scripts/check_heart_metrics.js
 * Exits 0 on all assertions passing, 1 otherwise. Print-outs are verbose on
 * purpose so a student running this can trace the arithmetic by hand.
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_PATH = path.resolve(
    __dirname, '..', 'src', 'python', 'compute_heart_metrics_from_rle.py'
);

// ── RLE helpers ──────────────────────────────────────────────────────────────
// COCO-style RLE: space-separated "offset length ..." over a flat H*W row-major
// array. Value 1 means the pixel belongs to the class. Runs are non-overlapping
// but the Python decoder tolerates overlapping runs (last write wins).

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

// ── Frame factory ────────────────────────────────────────────────────────────

function makeFrame(frameindex, slices) {
    return { frameindex, frameinferred: true, slices };
}

function makeSlice(sliceindex, entries) {
    // entries: [{class, contents}, ...]
    return {
        sliceindex,
        segmentationmasks: entries.map(e => ({
            class: e.cls,
            segmentationmaskcontents: e.contents,
        })),
    };
}

// ── Python invocation ────────────────────────────────────────────────────────

/**
 * Locate a Python interpreter that has numpy installed. Some Windows setups
 * have both `python3` (msys2 mingw, often without numpy) and `python` (the
 * Windows installer, usually with numpy) — we need the one that can actually
 * import numpy, not just the first that starts.
 */
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

/** Spawn Python with a JSON stdin payload. */
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

/** Parse JSON stdout defensively — surface a useful message when the script
 *  crashed before printing valid JSON (e.g. a Python traceback on stderr). */
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

// ── Test 1: happy multi-frame path ──────────────────────────────────────────

function test_happy_path() {
    console.log('\n[1] Happy multi-frame path (3 frames × 3 slices)');
    const H = 256, W = 256;
    // Anisotropic short-axis CINE-style affine: 1.5 mm in-plane, 8 mm through-plane.
    // Diagonal is fine for the test — only column norms matter.
    const affine = [
        [1.5, 0.0, 0.0, 0.0],
        [0.0, 1.5, 0.0, 0.0],
        [0.0, 0.0, 8.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ];
    // Expected voxel_mm3 = 1.5 * 1.5 * 8.0 = 18.0 mm^3

    // Frame 0 (ED): big LVC + MYO ring + medium RV, 3 slices.
    // Frame 1 (mid): intermediate.
    // Frame 2 (ES): smallest LVC + small RV.
    const cx = 128, cy = 128;
    const buildFrame = (idx, rLV, rRV, includeMyo) => {
        const slices = [];
        for (let s = 0; s < 3; s++) {
            const entries = [
                { cls: 'lvc', contents: rleFromDisk(H, W, cx, cy, rLV) },
                { cls: 'rv',  contents: rleFromDisk(H, W, cx + 60, cy, rRV) },
            ];
            if (includeMyo) {
                entries.push({ cls: 'myo', contents: rleFromAnnulus(H, W, cx, cy, rLV, rLV + 8) });
            }
            slices.push(makeSlice(s, entries));
        }
        return makeFrame(idx, slices);
    };

    const frames = [
        buildFrame(0, 30, 16, true),   // ED
        buildFrame(1, 24, 13, false),
        buildFrame(2, 18, 10, false),  // ES
    ];

    const res = runPython({ frames, width: W, height: H, affine });
    if (res.status !== 0) {
        console.log('  Python stderr:', res.stderr);
        assert('Python exits 0', false, `exit ${res.status}`);
        return;
    }
    const out = safeJson(res.stdout, res.stderr);
    console.log('  raw output:', JSON.stringify(out, null, 2));

    assert('no warnings on happy path', (out.warnings ?? []).length === 0, JSON.stringify(out.warnings));
    assert('ed_frame == 0 (auto-detect argmax)', out.ed_frame === 0, `got ${out.ed_frame}`);
    assert('es_frame == 2 (auto-detect argmin over positives)', out.es_frame === 2, `got ${out.es_frame}`);
    assert('LVEDV > LVESV', out.LVEDV > out.LVESV, `${out.LVEDV} vs ${out.LVESV}`);
    assert('RVEDV > RVESV', out.RVEDV > out.RVESV, `${out.RVEDV} vs ${out.RVESV}`);
    assert('0 <= LVEF <= 100', out.LVEF >= 0 && out.LVEF <= 100, `LVEF=${out.LVEF}`);
    assert('0 <= RVEF <= 100', out.RVEF >= 0 && out.RVEF <= 100, `RVEF=${out.RVEF}`);
    assert('LV_mass_g > 0',    out.LV_mass_g > 0,               `mass=${out.LV_mass_g}`);
    assert('voxel_mm3 ≈ 18.0', Math.abs(out.voxel_mm3 - 18.0) < 1e-6, `got ${out.voxel_mm3}`);
    // Sanity range — plausible adult LVEDV is ~60-250 mL for our synthetic sizes.
    assert('LVEDV in adult range (60-250 mL)', out.LVEDV >= 60 && out.LVEDV <= 250, `LVEDV=${out.LVEDV}`);
    assert('per-frame LV curve has 3 entries', Array.isArray(out.lv_volumes_ml) && out.lv_volumes_ml.length === 3,
        `len=${out.lv_volumes_ml?.length}`);
    assert('LV curve decreasing ED → ES', out.lv_volumes_ml[0] > out.lv_volumes_ml[1] && out.lv_volumes_ml[1] > out.lv_volumes_ml[2],
        JSON.stringify(out.lv_volumes_ml));

    // Report-page integration contract: measurements is the flat, generic-
    // keyed block the report reads. EF must be exactly LVEF (not rounded,
    // not recomputed) — it's an alias, not a duplicate calculation.
    assert('measurements.EF === LVEF', out.measurements?.EF === out.LVEF,
        `measurements.EF=${out.measurements?.EF} LVEF=${out.LVEF}`);
    assert('measurements.EDV === LVEDV', out.measurements?.EDV === out.LVEDV,
        `${out.measurements?.EDV} vs ${out.LVEDV}`);
    assert('measurements.ESV === LVESV', out.measurements?.ESV === out.LVESV,
        `${out.measurements?.ESV} vs ${out.LVESV}`);
    assert('measurements.StrokeVolume === LV_SV', out.measurements?.StrokeVolume === out.LV_SV,
        `${out.measurements?.StrokeVolume} vs ${out.LV_SV}`);
    assert('measurements.PeakGRS is null (filled by strain later)', out.measurements?.PeakGRS === null);
    assert('measurements.PeakGCS is null (filled by strain later)', out.measurements?.PeakGCS === null);
}

// ── Test 2: single-frame → EF null with warning ─────────────────────────────

function test_single_frame_ef_null() {
    console.log('\n[2] Single-frame → LVEF/LV_SV/RVEF/RV_SV null (Addition A)');
    const H = 128, W = 128;
    const affine = [
        [1.5, 0, 0, 0],
        [0, 1.5, 0, 0],
        [0, 0, 8.0, 0],
        [0, 0, 0,   1],
    ];
    const frames = [
        makeFrame(0, [
            makeSlice(0, [
                { cls: 'lvc', contents: rleFromDisk(H, W, 64, 64, 20) },
                { cls: 'myo', contents: rleFromAnnulus(H, W, 64, 64, 20, 26) },
                { cls: 'rv',  contents: rleFromDisk(H, W, 100, 64, 10) },
            ]),
        ]),
    ];
    const res = runPython({ frames, width: W, height: H, affine });
    if (res.status !== 0) {
        console.log('  Python stderr:', res.stderr);
        assert('Python exits 0 (single frame is not a hard error)', false, `exit ${res.status}`);
        return;
    }
    const out = safeJson(res.stdout, res.stderr);
    console.log('  raw output:', JSON.stringify(out, null, 2));

    assert('exits 0, not a hard error',  res.status === 0);
    assert('LVEDV computed (not null)',  out.LVEDV !== null && out.LVEDV > 0);
    assert('LVEF is null',               out.LVEF === null);
    assert('LV_SV is null',              out.LV_SV === null);
    assert('RVEF is null',               out.RVEF === null);
    assert('RV_SV is null',              out.RV_SV === null);
    assert('LV_mass_g still computed',   out.LV_mass_g !== null && out.LV_mass_g > 0);
    assert('warnings explain the reason',
        (out.warnings ?? []).some(w => /one frame|EF requires/i.test(w)),
        JSON.stringify(out.warnings));
}

// ── Test 3: missing MYO → mass null with warning, EF still computed ─────────

function test_missing_myo_mass_null() {
    console.log('\n[3] Missing MYO at ED → LV_mass_g null (Addition B)');
    const H = 128, W = 128;
    const affine = [
        [1.5, 0, 0, 0],
        [0, 1.5, 0, 0],
        [0, 0, 8.0, 0],
        [0, 0, 0,   1],
    ];
    const frames = [
        makeFrame(0, [
            makeSlice(0, [
                { cls: 'lvc', contents: rleFromDisk(H, W, 64, 64, 20) },
                { cls: 'rv',  contents: rleFromDisk(H, W, 100, 64, 10) },
            ]),
        ]),
        makeFrame(1, [
            makeSlice(0, [
                { cls: 'lvc', contents: rleFromDisk(H, W, 64, 64, 12) },
                { cls: 'rv',  contents: rleFromDisk(H, W, 100, 64, 6) },
            ]),
        ]),
    ];
    const res = runPython({ frames, width: W, height: H, affine });
    if (res.status !== 0) {
        console.log('  Python stderr:', res.stderr);
        assert('Python exits 0 (missing MYO is not a hard error)', false, `exit ${res.status}`);
        return;
    }
    const out = safeJson(res.stdout, res.stderr);
    console.log('  raw output:', JSON.stringify(out, null, 2));

    assert('exits 0, not a hard error',    res.status === 0);
    assert('LVEF computed (mass absence should not block EF)', typeof out.LVEF === 'number' && out.LVEF >= 0);
    assert('LV_mass_g null when MYO missing', out.LV_mass_g === null);
    assert('warnings mention myocardium',
        (out.warnings ?? []).some(w => /myocardium|MYO/i.test(w)),
        JSON.stringify(out.warnings));
}

// ── Test 4: no LVC anywhere → hard error ────────────────────────────────────

function test_no_lvc_hard_error() {
    console.log('\n[4] No LVC in any frame → error JSON + exit 1');
    const H = 64, W = 64;
    const affine = [
        [1.5, 0, 0, 0],
        [0, 1.5, 0, 0],
        [0, 0, 8.0, 0],
        [0, 0, 0,   1],
    ];
    const frames = [
        makeFrame(0, [
            makeSlice(0, [
                { cls: 'rv',  contents: rleFromDisk(H, W, 32, 32, 8) },
            ]),
        ]),
    ];
    const res = runPython({ frames, width: W, height: H, affine });
    console.log('  stdout:', res.stdout?.trim());
    console.log('  status:', res.status);
    assert('exits 1', res.status === 1);
    const out = safeJson(res.stdout, res.stderr);
    assert('error JSON contains "LV cavity"', /LV cavity/i.test(out.error ?? ''), JSON.stringify(out));
}

// ── Test 5b: duplicate (frameindex, sliceindex, class) → no double-count ───
// A frame is allowed to appear more than once, or the same slice within a
// frame to appear more than once — e.g. after a manual edit re-appended to
// the mask doc instead of replacing. The output must match the union, not
// the sum. Regression guard for the "very large in another run" side of the
// 30x-volume-swing incident (PIPELINE_INTEGRATION.md §6).

function test_duplicate_slice_no_double_count() {
    console.log('\n[6] Duplicate (frameindex, sliceindex, class) → union, not sum');
    const H = 128, W = 128;
    const affine = [
        [1.5, 0, 0, 0],
        [0, 1.5, 0, 0],
        [0, 0, 8.0, 0],
        [0, 0, 0,   1],
    ];
    // Two ED entries with an identical LVC disc on slice 0. If the deduper
    // works, LVEDV should equal the single-disc volume; if it doesn't, it
    // will be exactly 2x.
    const lvcRle = rleFromDisk(H, W, 64, 64, 20);
    const framesSingle = [
        makeFrame(0, [makeSlice(0, [{ cls: 'lvc', contents: lvcRle }])]),
        makeFrame(1, [makeSlice(0, [{ cls: 'lvc', contents: rleFromDisk(H, W, 64, 64, 10) }])]),
    ];
    const framesDup = [
        makeFrame(0, [makeSlice(0, [{ cls: 'lvc', contents: lvcRle }])]),
        makeFrame(0, [makeSlice(0, [{ cls: 'lvc', contents: lvcRle }])]),  // exact duplicate
        makeFrame(1, [makeSlice(0, [{ cls: 'lvc', contents: rleFromDisk(H, W, 64, 64, 10) }])]),
    ];
    const resSingle = runPython({ frames: framesSingle, width: W, height: H, affine });
    const resDup    = runPython({ frames: framesDup,    width: W, height: H, affine });
    if (resSingle.status !== 0 || resDup.status !== 0) {
        assert('both runs exit 0', false, `single=${resSingle.status}, dup=${resDup.status}`);
        return;
    }
    const outSingle = safeJson(resSingle.stdout, resSingle.stderr);
    const outDup    = safeJson(resDup.stdout,    resDup.stderr);
    console.log('  LVEDV single:', outSingle.LVEDV, '  LVEDV dup:', outDup.LVEDV);
    assert('LVEDV unchanged by duplicate (frame,slice,class)',
        Math.abs(outSingle.LVEDV - outDup.LVEDV) < 1e-6,
        `single=${outSingle.LVEDV}, dup=${outDup.LVEDV}`);
    assert('LVEDV(dup) is NOT ~2x LVEDV(single)',
        Math.abs(outDup.LVEDV - 2 * outSingle.LVEDV) > 1e-3,
        `dup=${outDup.LVEDV}, 2x=${2 * outSingle.LVEDV}`);
    assert('LVEF unchanged by duplicate',
        Math.abs(outSingle.LVEF - outDup.LVEF) < 1e-6,
        `single=${outSingle.LVEF}, dup=${outDup.LVEF}`);
}

// ── Test 8: sheared / oblique affine → det-based voxel_mm3, exact ──────────
// Regression guard for the Part-A1 hardening. On an oblique affine the true
// voxel-parallelepiped volume is |det(affine[:3,:3])|, NOT the product of
// the column norms — column norms over-estimate by the sine of the inter-
// axis angles. Cardiac short-axis data is almost always orthogonal, but if
// a project has a sheared or rotated affine the switch to det makes the
// stored volume geometrically correct.

function test_sheared_affine_uses_det() {
    console.log('\n[8] Sheared/oblique affine → voxel_mm3 uses |det|, not column-norm product');
    const H = 128, W = 128;
    // Off-diagonal 0.5 in row 0 col 1 injects an in-plane shear. Column norms:
    //   col0 = |(1.5, 0, 0)|         = 1.5
    //   col1 = |(0.5, 1.5, 0)|       = sqrt(0.25 + 2.25) = sqrt(2.5) ≈ 1.5811
    //   col2 = |(0, 0, 8)|           = 8
    //   product = 1.5 * 1.5811 * 8   ≈ 18.973 mm^3   (over-estimate)
    //   |det|   = 1.5 * 1.5 * 8      = 18.0 mm^3     (correct parallelepiped)
    const affine = [
        [1.5, 0.5, 0.0, 0.0],
        [0.0, 1.5, 0.0, 0.0],
        [0.0, 0.0, 8.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ];
    const frames = [
        makeFrame(0, [makeSlice(0, [
            { cls: 'lvc', contents: rleFromDisk(H, W, 64, 64, 20) },
            { cls: 'myo', contents: rleFromAnnulus(H, W, 64, 64, 20, 26) },
        ])]),
        makeFrame(1, [makeSlice(0, [
            { cls: 'lvc', contents: rleFromDisk(H, W, 64, 64, 12) },
        ])]),
    ];
    const res = runPython({ frames, width: W, height: H, affine });
    if (res.status !== 0) {
        console.log('  Python stderr:', res.stderr);
        assert('Python exits 0', false, `exit ${res.status}`);
        return;
    }
    const out = safeJson(res.stdout, res.stderr);
    console.log('  voxel_mm3:', out.voxel_mm3, '  spacing_mm:', out.spacing_mm);

    // voxel_mm3 must be exactly the det value (18.0), not the column-norm
    // product (~18.973). A regression that reverts to the product would land
    // at ~18.973 and this assertion would fail.
    assert('voxel_mm3 == |det| = 18.0 (not column-norm product ≈ 18.973)',
        Math.abs(out.voxel_mm3 - 18.0) < 1e-9,
        `got ${out.voxel_mm3}`);

    // spacing_mm still reports the per-column norms for display — so the
    // sheared column 1 shows up as ~1.5811, not 1.5. This confirms the two
    // fields serve different roles (display vs. exact geometric volume).
    const expectedCol1 = Math.sqrt(0.25 + 2.25);
    assert('spacing_mm[1] uses column norm (~1.5811)',
        Math.abs(out.spacing_mm[1] - expectedCol1) < 1e-6,
        `got ${out.spacing_mm[1]}, expected ~${expectedCol1}`);
    assert('spacing_mm[0] and [2] unaffected by shear',
        Math.abs(out.spacing_mm[0] - 1.5) < 1e-9 && Math.abs(out.spacing_mm[2] - 8.0) < 1e-9,
        `spacing_mm=${JSON.stringify(out.spacing_mm)}`);

    // LVEDV must have been computed with the det-based voxel_mm3. If the
    // regression put the column-norm product back in place, LVEDV would be
    // ~5.4% larger and this equality check would fail.
    // On the disk r=20 the raster count is deterministic; compute it once
    // by dividing back through the emitted voxel_mm3.
    const lvVoxelsAtED = Math.round(out.LVEDV * 1000 / out.voxel_mm3);
    const expectedLVEDV = lvVoxelsAtED * 18.0 / 1000;
    assert('LVEDV consistent with voxel_mm3 = 18.0',
        Math.abs(out.LVEDV - expectedLVEDV) < 1e-6,
        `LVEDV=${out.LVEDV}, expected=${expectedLVEDV}`);
}

// ── Test 7: implausible affine → warning, NOT hard error ────────────────────
// Identity affine (voxel_mm3 = 1.0) is a common silent-fallback mode and
// produces volumes that look ~18x too small compared to real cardiac data.
// The script should still return numbers (EF, per-frame curves) but MUST
// push a warning so the downstream disease-similarity module can see the
// anomaly rather than consuming poisoned volumes silently.

function test_identity_affine_warns() {
    console.log('\n[7] Identity affine (voxel_mm3 = 1.0) → plausibility warning');
    const H = 128, W = 128;
    const affine = [
        [1, 0, 0, 0],
        [0, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 0, 1],
    ];
    const frames = [
        makeFrame(0, [makeSlice(0, [
            { cls: 'lvc', contents: rleFromDisk(H, W, 64, 64, 20) },
            { cls: 'myo', contents: rleFromAnnulus(H, W, 64, 64, 20, 26) },
        ])]),
        makeFrame(1, [makeSlice(0, [
            { cls: 'lvc', contents: rleFromDisk(H, W, 64, 64, 12) },
        ])]),
    ];
    const res = runPython({ frames, width: W, height: H, affine });
    if (res.status !== 0) {
        assert('exits 0 (identity affine is not a hard error)', false, `exit ${res.status}`);
        return;
    }
    const out = safeJson(res.stdout, res.stderr);
    console.log('  voxel_mm3:', out.voxel_mm3, ' LVEDV:', out.LVEDV, ' warnings:', out.warnings);

    assert('exits 0, not a hard error', res.status === 0);
    assert('voxel_mm3 is 1.0 (identity)', Math.abs(out.voxel_mm3 - 1.0) < 1e-9, `got ${out.voxel_mm3}`);
    assert('warnings include a spacing/affine flag',
        (out.warnings ?? []).some(w => /voxel_mm3|affine/i.test(w)),
        JSON.stringify(out.warnings));
    assert('warnings include an LVEDV plausibility flag',
        (out.warnings ?? []).some(w => /LVEDV/.test(w)),
        JSON.stringify(out.warnings));
    // EF is body-size-independent; even with a bad affine EF must still be sane.
    assert('LVEF still valid (0-100) despite bad affine',
        typeof out.LVEF === 'number' && out.LVEF >= 0 && out.LVEF <= 100,
        `LVEF=${out.LVEF}`);
}

// ── Test 5: missing / wrong-shape affine → hard error ───────────────────────

function test_bad_affine_hard_error() {
    console.log('\n[5] Wrong-shape affine → error JSON + exit 1');
    const H = 64, W = 64;
    const affine = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; // 3x3, not 4x4
    const frames = [
        makeFrame(0, [
            makeSlice(0, [{ cls: 'lvc', contents: rleFromDisk(H, W, 32, 32, 10) }]),
        ]),
    ];
    const res = runPython({ frames, width: W, height: H, affine });
    console.log('  stdout:', res.stdout?.trim());
    console.log('  status:', res.status);
    assert('exits 1', res.status === 1);
    const out = safeJson(res.stdout, res.stderr);
    assert('error JSON mentions 4x4 / shape', /4x4|shape/i.test(out.error ?? ''), JSON.stringify(out));
}

// ── Main ─────────────────────────────────────────────────────────────────────

(function main() {
    console.log(`Running compute_heart_metrics_from_rle.py assertions`);
    console.log(`Script: ${SCRIPT_PATH}`);
    try {
        test_happy_path();
        test_single_frame_ef_null();
        test_missing_myo_mass_null();
        test_no_lvc_hard_error();
        test_bad_affine_hard_error();
        test_duplicate_slice_no_double_count();
        test_identity_affine_warns();
        test_sheared_affine_uses_det();
    } catch (err) {
        console.error('Runner crashed:', err);
        process.exit(2);
    }
    console.log(`\n────────────────────────`);
    console.log(`Assertions: ${PASS} passed, ${FAIL} failed`);
    process.exit(FAIL === 0 ? 0 : 1);
})();
