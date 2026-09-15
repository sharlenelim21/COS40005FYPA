/**
 * check_health_status.js
 * ======================
 * Standalone runnable test for src/python/compute_health_status.py.
 *
 * No Mongo, no HTTP, no test framework — just spawns the Python script with
 * synthetic measurements on stdin, parses stdout, and asserts against the
 * rule engine's expected outputs.
 *
 * Scenarios:
 *   [1] Healthy         (EF 64, EDV 150, GCS -20, GRS 35, warnings empty)
 *   [2] Mild            (EF 50, everything else clean)
 *   [3] Moderate        (EF 38, everything else clean)
 *   [4] Severe          (EF 26, everything else clean)
 *   [5] Indeterminate   (EF null — one-phase / ED==ES case)
 *   [6] Low-confidence  (EF 64 but heartMetrics.warnings non-empty)
 *   [7] Null strain     (EF 64, EDV 150, PeakGRS/PeakGCS both null)
 *   [8] Downgrade       (EF 60 = Healthy but EDV 310 warn + GCS -12 warn
 *                        + GRS 18 warn → 3 warns → Healthy → Mild)
 *   [9] Reproduction    (RV-absent / myo-absent / ignored-BSA warnings with
 *                        clean volume_signals → output byte-identical to no
 *                        warnings; LV grade stays Mild, confidence normal)
 *  [10] Real problems   (suspicious voxel_mm3 / implausible LVEDV / duplicated
 *                        LV-cavity slice → EDV suppressed, reason names cause)
 *  [11] RV duplicate    (duplicated RV-cavity slice → LV evidence untouched)
 *  [12] Legacy caller   (no volume_signals → conservative suppression, without
 *                        blaming the affine)
 *
 * Run:  node scripts/check_health_status.js
 * Exits 0 on all assertions passing, 1 otherwise.
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_PATH = path.resolve(
    __dirname, '..', 'src', 'python', 'compute_health_status.py'
);

// ── Interpreter probe (identical to check_heart_metrics.js) ──────────────────

let _cachedPythonBin = null;
function findPython() {
    if (_cachedPythonBin) return _cachedPythonBin;
    for (const bin of ['python3', 'python', 'py']) {
        // The health-status script needs no numpy — a plain Python 3 works.
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

// Convenience: pull an evidence entry by label for detail-oriented asserts.
function evByLabel(out, label) {
    return (out.evidence ?? []).find(e => e.label === label);
}

// ── Scenarios ────────────────────────────────────────────────────────────────

function test_healthy() {
    console.log('\n[1] Healthy — EF 64 %, EDV 150 mL, PeakGCS -20 %, PeakGRS 35 %');
    const payload = {
        measurements: { EF: 64, EDV: 150, ESV: 54, StrokeVolume: 96, PeakGRS: 35, PeakGCS: -20 },
        heart_metrics_warnings: [],
    };
    const res = runPython(payload);
    const out = safeJson(res.stdout, res.stderr);
    console.log('  ->', JSON.stringify({ status: out.status, confidence: out.confidence, grade_from_ef: out.grade_from_ef }));

    assert('exits 0',                        res.status === 0);
    assert('status = Healthy',               out.status === 'Healthy');
    assert('confidence = normal',            out.confidence === 'normal');
    assert('grade_from_ef = Healthy',        out.grade_from_ef === 'Healthy');
    assert('EF evidence level=ok',           evByLabel(out, 'Ejection Fraction')?.level === 'ok');
    assert('EDV evidence level=ok',          evByLabel(out, 'End-Diastolic Volume')?.level === 'ok');
    assert('Peak GCS evidence level=ok',     evByLabel(out, 'Peak GCS')?.level === 'ok');
    assert('Peak GRS evidence level=ok',     evByLabel(out, 'Peak GRS')?.level === 'ok');
    assert('features_used has all four',     ['EF','EDV','PeakGCS','PeakGRS'].every(k => out.features_used?.includes(k)));
    assert('features_missing is empty',      (out.features_missing ?? []).length === 0);
    assert('warnings[] is empty',            (out.warnings ?? []).length === 0);
    assert('disclaimer mentions not diagnosis', /not a diagnosis/i.test(out.disclaimer ?? ''));
}

function test_mild() {
    console.log('\n[2] Mild — EF 50 %, everything else clean');
    const out = safeJson(runPython({
        measurements: { EF: 50, EDV: 150, ESV: 75, StrokeVolume: 75, PeakGRS: 35, PeakGCS: -20 },
        heart_metrics_warnings: [],
    }).stdout);
    console.log('  ->', JSON.stringify({ status: out.status, grade_from_ef: out.grade_from_ef }));
    assert('status = Mild',                  out.status === 'Mild');
    assert('grade_from_ef = Mild',           out.grade_from_ef === 'Mild');
    assert('EF evidence level=warn',         evByLabel(out, 'Ejection Fraction')?.level === 'warn');
    assert('no downgrade applied',           out.status === out.grade_from_ef);
    assert('confidence = normal',            out.confidence === 'normal');
}

function test_moderate() {
    console.log('\n[3] Moderate — EF 38 %, everything else clean');
    const out = safeJson(runPython({
        measurements: { EF: 38, EDV: 200, ESV: 124, StrokeVolume: 76, PeakGRS: 30, PeakGCS: -18 },
        heart_metrics_warnings: [],
    }).stdout);
    console.log('  ->', JSON.stringify({ status: out.status, grade_from_ef: out.grade_from_ef }));
    assert('status = Moderate',              out.status === 'Moderate');
    assert('grade_from_ef = Moderate',       out.grade_from_ef === 'Moderate');
    assert('EF evidence level=warn',         evByLabel(out, 'Ejection Fraction')?.level === 'warn');
    assert('no downgrade applied',           out.status === out.grade_from_ef);
}

function test_severe() {
    console.log('\n[4] Severe — EF 26 % (patient005_4d-style)');
    const out = safeJson(runPython({
        measurements: { EF: 26, EDV: 280, ESV: 207, StrokeVolume: 73, PeakGRS: 18, PeakGCS: -12 },
        heart_metrics_warnings: [],
    }).stdout);
    console.log('  ->', JSON.stringify({ status: out.status, grade_from_ef: out.grade_from_ef }));
    assert('status = Severe',                out.status === 'Severe');
    assert('grade_from_ef = Severe',         out.grade_from_ef === 'Severe');
    assert('EF evidence level=warn',         evByLabel(out, 'Ejection Fraction')?.level === 'warn');
    // Severe is the floor — even with multiple supporting warns it stays Severe.
    assert('Severe is the floor (no further downgrade)', out.status === 'Severe');
}

function test_indeterminate_null_ef() {
    console.log('\n[5] Indeterminate — EF null (single-phase / ED==ES)');
    const out = safeJson(runPython({
        measurements: { EF: null, EDV: 150, ESV: 150, StrokeVolume: null, PeakGRS: null, PeakGCS: null },
        heart_metrics_warnings: [],
    }).stdout);
    console.log('  ->', JSON.stringify({ status: out.status, confidence: out.confidence }));
    assert('status = Indeterminate',         out.status === 'Indeterminate');
    assert('grade_from_ef = Indeterminate',  out.grade_from_ef === 'Indeterminate');
    assert('confidence = low',               out.confidence === 'low');
    assert('EF evidence level=warn',         evByLabel(out, 'Ejection Fraction')?.level === 'warn');
    assert('EF evidence explains null',      /not computable/i.test(evByLabel(out, 'Ejection Fraction')?.detail ?? ''));
    assert('EF listed in features_missing',  (out.features_missing ?? []).includes('EF'));
}

function test_low_confidence_bad_affine() {
    console.log('\n[6] Low-confidence — EF 64 % but heart_metrics_warnings non-empty');
    const out = safeJson(runPython({
        measurements: { EF: 64, EDV: 1.3, ESV: 0.5, StrokeVolume: 0.8, PeakGRS: 35, PeakGCS: -20 },
        heart_metrics_warnings: [
            "LVEDV=1.3 mL is below the typical adult range (60-250 mL). Verify affine and segmentation coverage — this often indicates an identity/bad affine (voxel_mm3 too small) or missing basal slices.",
        ],
    }).stdout);
    console.log('  ->', JSON.stringify({ status: out.status, confidence: out.confidence }));
    // EF alone (64 %) puts this in Healthy; volumes are ignored, so no downgrade.
    assert('status = Healthy (EF-only)',     out.status === 'Healthy');
    assert('confidence = low',               out.confidence === 'low');
    // The EDV evidence line must be REPLACED by the suppression line, not the
    // raw 1.3-mL verdict — otherwise a bad affine would show a nonsense number
    // to the reader.
    const edvEv = evByLabel(out, 'End-Diastolic Volume');
    assert('EDV evidence line is NOT emitted', edvEv === undefined,
        `unexpected EDV evidence: ${JSON.stringify(edvEv)}`);
    const suppressedEv = evByLabel(out, 'Absolute volumes');
    assert('Absolute volumes suppression evidence is emitted', !!suppressedEv);
    assert('suppression evidence is warn',   suppressedEv?.level === 'warn');
    assert('EDV in features_missing',        (out.features_missing ?? []).includes('EDV'));
    assert('warnings mention suppression',   (out.warnings ?? []).some(w => /suppressed/i.test(w)));
}

function test_null_strain() {
    console.log('\n[7] Null strain — EF 64 %, EDV 150 mL, PeakGRS/PeakGCS both null');
    const out = safeJson(runPython({
        measurements: { EF: 64, EDV: 150, ESV: 54, StrokeVolume: 96, PeakGRS: null, PeakGCS: null },
        heart_metrics_warnings: [],
    }).stdout);
    console.log('  ->', JSON.stringify({ status: out.status, confidence: out.confidence, features_missing: out.features_missing }));
    assert('status = Healthy',               out.status === 'Healthy');
    // Missing strain is not a confidence hit — it's an absent feature, not
    // an abnormal one. This is defensive-behaviour (c) from the plan.
    assert('confidence = normal (null strain is NOT a low-confidence trigger)',
        out.confidence === 'normal');
    assert('Peak GCS NOT in evidence',       evByLabel(out, 'Peak GCS') === undefined);
    assert('Peak GRS NOT in evidence',       evByLabel(out, 'Peak GRS') === undefined);
    assert('PeakGCS in features_missing',    (out.features_missing ?? []).includes('PeakGCS'));
    assert('PeakGRS in features_missing',    (out.features_missing ?? []).includes('PeakGRS'));
    // Null strain must NOT count as a warn for downgrade purposes.
    assert('no downgrade applied',           out.status === out.grade_from_ef);
}

function test_downgrade_healthy_to_mild() {
    console.log('\n[8] Downgrade — EF 60 (Healthy) but EDV 310 + PeakGCS -12 + PeakGRS 18 (3 warns) → Mild');
    const out = safeJson(runPython({
        measurements: { EF: 60, EDV: 310, ESV: 124, StrokeVolume: 186, PeakGRS: 18, PeakGCS: -12 },
        heart_metrics_warnings: [],
    }).stdout);
    console.log('  ->', JSON.stringify({ status: out.status, grade_from_ef: out.grade_from_ef }));
    assert('grade_from_ef = Healthy',        out.grade_from_ef === 'Healthy');
    // 3 supporting warns >= 2 → downgrade Healthy → Mild.
    assert('status downgraded to Mild',      out.status === 'Mild');
    assert('EF evidence still level=ok',     evByLabel(out, 'Ejection Fraction')?.level === 'ok');
    assert('EDV evidence level=warn',        evByLabel(out, 'End-Diastolic Volume')?.level === 'warn');
    assert('Peak GCS evidence level=warn',   evByLabel(out, 'Peak GCS')?.level === 'warn');
    assert('Peak GRS evidence level=warn',   evByLabel(out, 'Peak GRS')?.level === 'warn');
    assert('warnings mention downgrade',     (out.warnings ?? []).some(w => /downgrad/i.test(w)));
}

// ── Non-volume heart-metrics warnings must not move the LV grade ─────────────
//
// compute_heart_metrics_from_rle.py writes EVERY warning into one
// heartMetrics.warnings list, and only some of them concern absolute-volume
// reliability (suspicious voxel_mm3, duplicated slices, implausible LVEDV).
// "No RV voxels at ED", "No myocardium ... at ED" and an ignored bsa_m2 say
// nothing about LV volumes. The service passes `volume_signals` (structured
// heartMetrics fields) so the grader decides from those, not from how many
// warnings exist. Scenarios [9]-[12] pin that.

// Warning strings copied verbatim from compute_heart_metrics_from_rle.py.
const RV_ABSENT_WARNING   = 'No RV voxels at ED — RVEF and RV_SV set to null.';
const MYO_ABSENT_WARNING  = 'No myocardium (class 2) voxels at ED frame (0) — LV_mass_g set to null.';
const BSA_IGNORED_WARNING = 'Ignoring non-positive bsa_m2=0.0 — indexed volumes (EDVI/ESVI) set to null.';

// EF 60 grades Healthy; EDV 280 (above 60-250) and PeakGCS -12 are two
// supporting warns, so a correctly graded result is downgraded to Mild.
const REPRO_MEASUREMENTS   = { EF: 60, EDV: 280, ESV: 112, StrokeVolume: 168, PeakGRS: 30, PeakGCS: -12 };
const CLEAN_VOLUME_SIGNALS = { voxel_mm3: 18.0, duplicate_slices: [] };

/** A heartMetrics.duplicate_slices entry; `cls` is "lvc" | "myo" | "rv". */
function dupEntry(cls, frame, keep, remove) {
    return { frame, class: cls, slice_keep: keep, slice_remove: remove,
             voxel_count: 900, iou: 1.0, est_inflation_ml: 16.2 };
}

function test_non_volume_warnings_do_not_move_lv_grade() {
    console.log('\n[9] Reproduction — RV-absent / myo-absent / ignored-BSA warnings must not change the LV result');
    const baseline = runPython({
        measurements: REPRO_MEASUREMENTS,
        heart_metrics_warnings: [],
        volume_signals: CLEAN_VOLUME_SIGNALS,
    });
    const withWarnings = runPython({
        measurements: REPRO_MEASUREMENTS,
        heart_metrics_warnings: [RV_ABSENT_WARNING, MYO_ABSENT_WARNING, BSA_IGNORED_WARNING],
        volume_signals: CLEAN_VOLUME_SIGNALS,
    });
    const base = safeJson(baseline.stdout, baseline.stderr);
    const out = safeJson(withWarnings.stdout, withWarnings.stderr);
    console.log('  no warnings   ->', JSON.stringify({ status: base.status, confidence: base.confidence }));
    console.log('  with warnings ->', JSON.stringify({ status: out.status, confidence: out.confidence }));

    assert('baseline exits 0',                            baseline.status === 0, baseline.stderr);
    assert('baseline status = Mild (2 supporting warns)', base.status === 'Mild', base.status);
    assert('status unchanged by non-volume warnings',     out.status === 'Mild', out.status);
    assert('confidence stays normal',                     out.confidence === 'normal', out.confidence);
    assert('EDV evidence still emitted as warn',          evByLabel(out, 'End-Diastolic Volume')?.level === 'warn');
    assert('no Absolute volumes suppression line',        evByLabel(out, 'Absolute volumes') === undefined);
    assert('stdout byte-identical to the no-warning run', withWarnings.stdout.trim() === baseline.stdout.trim());
}

function test_structured_volume_problems_still_suppress() {
    console.log('\n[10] Genuine volume problems still suppress EDV evidence, and the reason names the real cause');
    const cases = [
        {
            name: 'voxel size',
            measurements: { EF: 64, EDV: 150, ESV: 54, StrokeVolume: 96, PeakGRS: 35, PeakGCS: -20 },
            warnings: ['Suspicious voxel_mm3=0.0500 mm^3 (< 0.1). Typical cardiac MRI voxels are 1-30 mm^3. Check project.affineMatrix — absolute volumes may be scaled down by orders of magnitude. EF (a ratio) is unaffected.'],
            signals: { voxel_mm3: 0.05, duplicate_slices: [] },
            reason: /voxel volume 0\.05 mm³/i,
        },
        {
            name: 'implausible LVEDV',
            measurements: { EF: 64, EDV: 1.3, ESV: 0.5, StrokeVolume: 0.8, PeakGRS: 35, PeakGCS: -20 },
            warnings: ['LVEDV=1.3 mL is below the typical adult range (60-250 mL). Verify affine and segmentation coverage — this often indicates an identity/bad affine (voxel_mm3 too small) or missing basal slices.'],
            signals: CLEAN_VOLUME_SIGNALS,
            reason: /LVEDV 1\.3 mL/,
        },
        {
            name: 'duplicated LV-cavity slice',
            measurements: { EF: 64, EDV: 150, ESV: 54, StrokeVolume: 96, PeakGRS: 35, PeakGCS: -20 },
            warnings: ['Possible duplicate slice: frame 0, slices 4 & 5 (class lvc) — identical voxel count (900) and 100% overlap. Est. inflation +16.2 mL.'],
            signals: { voxel_mm3: 18.0, duplicate_slices: [dupEntry('lvc', 0, 4, 5)] },
            reason: /duplicated LV cavity slice.*frame 0, slices 4 & 5/i,
        },
    ];
    for (const c of cases) {
        const out = safeJson(runPython({
            measurements: c.measurements,
            heart_metrics_warnings: c.warnings,
            volume_signals: c.signals,
        }).stdout);
        const sup = evByLabel(out, 'Absolute volumes');
        console.log(`  ${c.name} ->`, JSON.stringify({ status: out.status, confidence: out.confidence, detail: sup?.detail }));
        assert(`${c.name}: suppression line emitted`,         sup?.level === 'warn');
        assert(`${c.name}: EDV evidence NOT emitted`,         evByLabel(out, 'End-Diastolic Volume') === undefined);
        assert(`${c.name}: confidence = low`,                 out.confidence === 'low', out.confidence);
        assert(`${c.name}: reason names the cause`,           c.reason.test(sup?.detail ?? ''), sup?.detail);
        assert(`${c.name}: no blanket affine/spacing claim`,  !/affine \/ spacing as suspicious/i.test(sup?.detail ?? ''));
    }
}

function test_rv_duplicate_does_not_suppress_lv() {
    console.log('\n[11] A duplicated RV-cavity slice cannot inflate LVEDV, so LV volume evidence stays');
    const out = safeJson(runPython({
        measurements: REPRO_MEASUREMENTS,
        heart_metrics_warnings: ['Possible duplicate slice: frame 0, slices 7 & 8 (class rv) — identical voxel count (900) and 100% overlap. Est. inflation +16.2 mL.'],
        volume_signals: { voxel_mm3: 18.0, duplicate_slices: [dupEntry('rv', 0, 7, 8)] },
    }).stdout);
    console.log('  ->', JSON.stringify({ status: out.status, confidence: out.confidence }));
    assert('status = Mild (same as the clean run)',  out.status === 'Mild', out.status);
    assert('confidence = normal',                    out.confidence === 'normal', out.confidence);
    assert('EDV evidence emitted as warn',           evByLabel(out, 'End-Diastolic Volume')?.level === 'warn');
    assert('no Absolute volumes suppression line',   evByLabel(out, 'Absolute volumes') === undefined);
}

function test_legacy_caller_without_volume_signals() {
    console.log('\n[12] Legacy caller (no volume_signals) — stays conservative, but no longer blames the affine');
    const out = safeJson(runPython({
        measurements: REPRO_MEASUREMENTS,
        heart_metrics_warnings: [RV_ABSENT_WARNING],
    }).stdout);
    const sup = evByLabel(out, 'Absolute volumes');
    console.log('  ->', JSON.stringify({ status: out.status, confidence: out.confidence, detail: sup?.detail }));
    assert('suppression line still emitted (conservative)', sup?.level === 'warn');
    assert('confidence = low',                              out.confidence === 'low', out.confidence);
    assert('reason does not claim a bad affine or spacing', !/affine|spacing/i.test(sup?.detail ?? ''), sup?.detail);
    assert('reason says structured signals were missing',   /no structured volume signals/i.test(sup?.detail ?? ''), sup?.detail);
}

// ── Main ─────────────────────────────────────────────────────────────────────

(function main() {
    console.log(`Running compute_health_status.py assertions`);
    console.log(`Script: ${SCRIPT_PATH}`);
    try {
        test_healthy();
        test_mild();
        test_moderate();
        test_severe();
        test_indeterminate_null_ef();
        test_low_confidence_bad_affine();
        test_null_strain();
        test_downgrade_healthy_to_mild();
        test_non_volume_warnings_do_not_move_lv_grade();
        test_structured_volume_problems_still_suppress();
        test_rv_duplicate_does_not_suppress_lv();
        test_legacy_caller_without_volume_signals();
    } catch (err) {
        console.error('Runner crashed:', err);
        process.exit(2);
    }
    console.log(`\n────────────────────────`);
    console.log(`Assertions: ${PASS} passed, ${FAIL} failed`);
    process.exit(FAIL === 0 ? 0 : 1);
})();
