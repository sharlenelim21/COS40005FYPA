/**
 * check_rv_health_status.js
 * =========================
 * Standalone runnable test for src/python/compute_rv_health_status.py — RV
 * health status against sex-specific reference ranges.
 *
 * No Mongo, no HTTP, no test framework — spawns the Python module with
 * synthetic RV measurements on stdin, parses stdout, and asserts. Mirrors
 * scripts/check_health_status.js.
 *
 * The module deliberately has NO severity bands. The only formal CMR banding
 * for the RV (EACVI 2019) was copied from echocardiographic LVEF partitions and
 * never validated for the RV, so this compares against published lower/upper
 * limits of normal instead (SCMR 2025, blood-pool convention).
 *
 * It never uses a sex-blind threshold. Without a sex it applies BOTH sexes'
 * limits and gives a verdict only where they agree. A value normal for one sex
 * and abnormal for the other is reported as depending on sex, and the overall
 * status is "Depends on sex" unless another value is outside both ranges.
 *
 * Scenarios:
 *   [1]  Man, RVEF 45 %, BSA given       → within range (the old frontend
 *                                          48/40/30 bands called this "reduced")
 *   [2]  Woman, RVEF 46 %                → below her limit (47 %) → outside range
 *   [3]  Sex unspecified, mixed values   → each value checked against both sexes;
 *                                          "Depends on sex" where they disagree
 *   [3b] Sex unspecified, clear values   → Within / Outside when both agree;
 *                                          a value outside both settles it
 *   [4]  No BSA                          → RVEF assessed, indexed volumes unavailable
 *   [5]  RVEF null                       → not assessable, low confidence, volumes still shown
 *   [6]  Man, RVEDVi 105                 → within range (old frontend: amber "ARVC minor")
 *   [7]  Same RVEDVi 105 for a woman     → above her upper limit (99)
 *   [8]  Duplicated RV-cavity slice      → RV volumes withheld with the cause, low confidence
 *   [9]  Suspicious voxel volume         → RV volumes withheld with the cause, low confidence
 *   [10] Duplicated LV-cavity slice only → RV volumes unaffected
 *   [11] Boundaries                      → limits are inclusive, exactly as published,
 *                                          for each sex and for the both-sexes check
 *   [12] Every run above                 → exits 0, no severity words, sex and BSA echoed
 *
 * Run:  node scripts/check_rv_health_status.js
 * Exits 0 on all assertions passing, 1 otherwise.
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT_PATH = path.resolve(
    __dirname, '..', 'src', 'python', 'compute_rv_health_status.py'
);

// ── Interpreter probe (identical to check_health_status.js) ──────────────────

let _cachedPythonBin = null;
function findPython() {
    if (_cachedPythonBin) return _cachedPythonBin;
    for (const bin of ['python3', 'python', 'py']) {
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

// ── Assertion harness ────────────────────────────────────────────────────────

let PASS = 0, FAIL = 0;
function assert(name, cond, detail) {
    if (cond) { console.log(`  ✓ ${name}`); PASS++; }
    else      { console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`); FAIL++; }
}

function ev(out, label) {
    return (out.evidence ?? []).find(e => e.label === label);
}

const RVEF_LABEL   = 'RV Ejection Fraction';
const RVEDVI_LABEL = 'RV End-Diastolic Volume Index';
const RVESVI_LABEL = 'RV End-Systolic Volume Index';
const ABS_LABEL    = 'Absolute RV volumes';

const CLEAN_SIGNALS = { voxel_mm3: 18.0, duplicate_slices: [] };
const SEVERITY_WORDS = /\b(mild|mildly|moderate|moderately|severe|severely)\b/i;

// Every run is kept so [12] can check the contract across all of them.
const ALL_RUNS = [];

function grade({ rv, sex, bsa_m2 = null, volume_signals = CLEAN_SIGNALS }) {
    const res = runPython({ rv, sex, bsa_m2, volume_signals });
    const out = safeJson(res.stdout, res.stderr);
    ALL_RUNS.push({ input: { sex, bsa_m2 }, out, exit: res.status });
    return out;
}

/** A heartMetrics.duplicate_slices entry; `cls` is "lvc" | "myo" | "rv". */
function dupEntry(cls, frame, keep, remove) {
    return { frame, class: cls, slice_keep: keep, slice_remove: remove,
             voxel_count: 900, iou: 1.0, est_inflation_ml: 16.2 };
}

// ── Scenarios ────────────────────────────────────────────────────────────────

function test_man_rvef_45_within() {
    console.log('\n[1] Man, RVEF 45 %, RVEDVi 84.2, RVESVi 46.3 — within range');
    const out = grade({ rv: { RVEF: 45, RVEDV: 160, RVESV: 88 }, sex: 'male', bsa_m2: 1.9 });
    console.log('  ->', JSON.stringify({ status: out.status, confidence: out.confidence }));
    assert('status = Within reference range',             out.status === 'Within reference range', out.status);
    assert('confidence = normal',                         out.confidence === 'normal', out.confidence);
    assert('RVEF evidence ok',                            ev(out, RVEF_LABEL)?.level === 'ok');
    assert('RVEF detail cites the male limit (44 %)',     /44 %/.test(ev(out, RVEF_LABEL)?.detail ?? ''), ev(out, RVEF_LABEL)?.detail);
    assert('RVEDVi evidence ok',                          ev(out, RVEDVI_LABEL)?.level === 'ok');
    assert('RVESVi evidence ok',                          ev(out, RVESVI_LABEL)?.level === 'ok');
    assert('reference names SCMR 2025',                   /SCMR/.test(out.reference?.source ?? '') && /2025/.test(out.reference?.source ?? ''));
    assert('reference states the segmentation convention', /blood.pool/i.test(out.reference?.convention ?? ''), out.reference?.convention);
    assert('reference RVEF limit = 44',                   out.reference?.rvef_lower_limit === 44);
    assert('reference RVEDVi range = [47,116]',           JSON.stringify(out.reference?.rvedvi_range) === '[47,116]', JSON.stringify(out.reference?.rvedvi_range));
    assert('reference RVESVi range = [16,52]',            JSON.stringify(out.reference?.rvesvi_range) === '[16,52]', JSON.stringify(out.reference?.rvesvi_range));
    assert('disclaimer says not a diagnosis',             /not a diagnosis/i.test(out.disclaimer ?? ''));
}

function test_woman_rvef_46_below() {
    console.log('\n[2] Woman, RVEF 46 % — below her limit (47 %)');
    const out = grade({ rv: { RVEF: 46, RVEDV: 130, RVESV: 70.2 }, sex: 'female', bsa_m2: 1.7 });
    console.log('  ->', JSON.stringify({ status: out.status, confidence: out.confidence }));
    assert('status = Outside reference range',            out.status === 'Outside reference range', out.status);
    assert('RVEF evidence warn',                          ev(out, RVEF_LABEL)?.level === 'warn');
    assert('RVEF detail cites the female limit (47 %)',   /47 %/.test(ev(out, RVEF_LABEL)?.detail ?? ''), ev(out, RVEF_LABEL)?.detail);
    assert('RVEDVi (76.5) still ok',                      ev(out, RVEDVI_LABEL)?.level === 'ok');
    assert('reference RVEF limit = 47',                   out.reference?.rvef_lower_limit === 47);
    assert('reference RVEDVi range = [44,99]',            JSON.stringify(out.reference?.rvedvi_range) === '[44,99]', JSON.stringify(out.reference?.rvedvi_range));
}

function test_sex_unspecified_checks_both_sexes() {
    console.log('\n[3] Sex unspecified, mixed values — both sexes checked; a verdict only where they agree');
    // RVEF 45: at/above the men's limit (44) but below the women's (47) -> depends on sex.
    // RVEDVi 84.2: inside men's 47-116 and women's 44-99 -> within for both.
    // RVESVi 46.3: inside men's 16-52 but above women's 13-43 -> depends on sex.
    const out = grade({ rv: { RVEF: 45, RVEDV: 160, RVESV: 88 }, sex: 'unspecified', bsa_m2: 1.9 });
    console.log('  ->', JSON.stringify({ status: out.status, levels: (out.evidence ?? []).map(e => e.level) }));
    assert('status = Depends on sex',                      out.status === 'Depends on sex', out.status);
    assert('RVEF unavailable: within for men, below for women',
        ev(out, RVEF_LABEL)?.level === 'unavailable' && /for men .*but below it for women/i.test(ev(out, RVEF_LABEL)?.detail ?? ''),
        JSON.stringify(ev(out, RVEF_LABEL)));
    assert('RVEDVi ok for both sexes',
        ev(out, RVEDVI_LABEL)?.level === 'ok' && /both men .*and women/i.test(ev(out, RVEDVI_LABEL)?.detail ?? ''),
        JSON.stringify(ev(out, RVEDVI_LABEL)));
    assert('RVESVi unavailable: within for men, above for women',
        ev(out, RVESVI_LABEL)?.level === 'unavailable' && /for men .*but above it for women/i.test(ev(out, RVESVI_LABEL)?.detail ?? ''),
        JSON.stringify(ev(out, RVESVI_LABEL)));
    assert('no single-sex limits reported',
        out.reference?.rvef_lower_limit === null && out.reference?.rvedvi_range === null && out.reference?.rvesvi_range === null,
        JSON.stringify(out.reference));
    assert("reference carries both sexes' limits",
        out.reference?.by_sex?.male?.rvef_lower_limit === 44 && out.reference?.by_sex?.female?.rvef_lower_limit === 47
        && JSON.stringify(out.reference?.by_sex?.female?.rvedvi_range) === '[44,99]'
        && JSON.stringify(out.reference?.by_sex?.male?.rvesvi_range) === '[16,52]',
        JSON.stringify(out.reference?.by_sex));
    assert('sex listed in features_missing',               (out.features_missing ?? []).includes('sex'));
    assert('warning explains the both-sexes check',        (out.warnings ?? []).some(w => /checked against both/i.test(w)), JSON.stringify(out.warnings));
    // A structured flag, so the report can say "Depends on sex" without parsing the sentence.
    assert('sex-dependent lines carry depends_on_sex; agreeing lines do not',
        ev(out, RVEF_LABEL)?.depends_on_sex === true && ev(out, RVESVI_LABEL)?.depends_on_sex === true
        && !ev(out, RVEDVI_LABEL)?.depends_on_sex,
        JSON.stringify((out.evidence ?? []).map(e => [e.label, e.depends_on_sex])));
    const male = grade({ rv: { RVEF: 45, RVEDV: 160, RVESV: 88 }, sex: 'male', bsa_m2: 1.9 });
    assert('no depends_on_sex flag when a sex is given',   (male.evidence ?? []).every(e => !e.depends_on_sex));
    const noBsa = grade({ rv: { RVEF: 45, RVEDV: 160, RVESV: 88 }, sex: 'unspecified', bsa_m2: null });
    assert('a line unavailable for missing BSA is not flagged depends_on_sex', !ev(noBsa, RVEDVI_LABEL)?.depends_on_sex);
    const other = grade({ rv: { RVEF: 45, RVEDV: 160, RVESV: 88 }, sex: 'M', bsa_m2: 1.9 });
    assert('an unrecognised sex string is treated as unspecified', other.status === 'Depends on sex' && other.sex === 'unspecified', `${other.status} / ${other.sex}`);
    // A missing RVEF is a data problem, not a sex question.
    const noEf = grade({ rv: { RVEF: null, RVEDV: 199.5, RVESV: 57 }, sex: 'unspecified', bsa_m2: 1.9 });
    assert('RVEF not computable stays Not assessable, not Depends on sex', noEf.status === 'Not assessable', noEf.status);
}

function test_sex_unspecified_agreeing_verdicts() {
    console.log('\n[3b] Sex unspecified, clear values — Within / Outside when both sexes agree');
    // RVEF 60, RVEDVi 80.0, RVESVi 30.0: inside both sexes' limits.
    const within = grade({ rv: { RVEF: 60, RVEDV: 152, RVESV: 57 }, sex: 'unspecified', bsa_m2: 1.9 });
    console.log('  within  ->', JSON.stringify({ status: within.status, levels: (within.evidence ?? []).map(e => e.level) }));
    assert('inside both sexes → Within reference range',  within.status === 'Within reference range', within.status);
    assert('RVEF ok for both sexes',
        ev(within, RVEF_LABEL)?.level === 'ok' && /both men .*and women/i.test(ev(within, RVEF_LABEL)?.detail ?? ''),
        JSON.stringify(ev(within, RVEF_LABEL)));
    // RVEF 40, RVEDVi 120.0, RVESVi 72.0: outside both sexes' limits.
    const outside = grade({ rv: { RVEF: 40, RVEDV: 228, RVESV: 136.8 }, sex: 'unspecified', bsa_m2: 1.9 });
    console.log('  outside ->', JSON.stringify({ status: outside.status, levels: (outside.evidence ?? []).map(e => e.level) }));
    assert('outside both sexes → Outside reference range', outside.status === 'Outside reference range', outside.status);
    assert('RVEF warn, below both',
        ev(outside, RVEF_LABEL)?.level === 'warn' && /below .*both men .*and women/i.test(ev(outside, RVEF_LABEL)?.detail ?? ''),
        JSON.stringify(ev(outside, RVEF_LABEL)));
    assert('RVEDVi warn, above both',
        ev(outside, RVEDVI_LABEL)?.level === 'warn' && /above .*both men .*and women/i.test(ev(outside, RVEDVI_LABEL)?.detail ?? ''),
        JSON.stringify(ev(outside, RVEDVI_LABEL)));
    assert('confidence normal (a missing sex is not a data problem)',
        within.confidence === 'normal' && outside.confidence === 'normal', `${within.confidence} / ${outside.confidence}`);
    // RVEF 60 is fine for both sexes, but RVEDVi 105.0 is inside men's range and above women's.
    const mixed = grade({ rv: { RVEF: 60, RVEDV: 199.5, RVESV: 57 }, sex: 'unspecified', bsa_m2: 1.9 });
    console.log('  mixed   ->', JSON.stringify({ status: mixed.status, levels: (mixed.evidence ?? []).map(e => e.level) }));
    assert('RVEF fine for both but RVEDVi differs → Depends on sex, not Within',
        mixed.status === 'Depends on sex' && ev(mixed, RVEF_LABEL)?.level === 'ok' && ev(mixed, RVEDVI_LABEL)?.level === 'unavailable',
        JSON.stringify({ status: mixed.status, rvef: ev(mixed, RVEF_LABEL)?.level, rvedvi: ev(mixed, RVEDVI_LABEL)?.level }));
    // A value outside both ranges settles the status even when RVEF depends on sex.
    const settled = grade({ rv: { RVEF: 45, RVEDV: 228, RVESV: 136.8 }, sex: 'unspecified', bsa_m2: 1.9 });
    assert('a value outside both ranges → Outside even when RVEF depends on sex',
        settled.status === 'Outside reference range' && ev(settled, RVEF_LABEL)?.level === 'unavailable',
        JSON.stringify({ status: settled.status, rvef: ev(settled, RVEF_LABEL)?.level }));
}

function test_no_bsa() {
    console.log('\n[4] No BSA — RVEF assessed, indexed volumes unavailable');
    const out = grade({ rv: { RVEF: 50, RVEDV: 160, RVESV: 80 }, sex: 'male', bsa_m2: null });
    console.log('  ->', JSON.stringify({ status: out.status, confidence: out.confidence, warnings: out.warnings }));
    assert('status = Within reference range',             out.status === 'Within reference range', out.status);
    assert('RVEF evidence ok',                            ev(out, RVEF_LABEL)?.level === 'ok');
    assert('RVEDVi unavailable and asks for height and weight',
        ev(out, RVEDVI_LABEL)?.level === 'unavailable' && /height and weight/i.test(ev(out, RVEDVI_LABEL)?.detail ?? ''),
        JSON.stringify(ev(out, RVEDVI_LABEL)));
    assert('RVESVi unavailable',                          ev(out, RVESVI_LABEL)?.level === 'unavailable');
    assert('RVEDVi and RVESVi in features_missing',       ['RVEDVi', 'RVESVi'].every(k => (out.features_missing ?? []).includes(k)));
    assert('warnings say the status rests on RVEF alone', (out.warnings ?? []).some(w => /RVEF alone/i.test(w)), JSON.stringify(out.warnings));
    assert('confidence stays normal (missing BSA is not a data problem)', out.confidence === 'normal', out.confidence);
}

function test_rvef_null() {
    console.log('\n[5] RVEF null — not assessable, low confidence, volumes still shown');
    const out = grade({ rv: { RVEF: null, RVEDV: 160, RVESV: null }, sex: 'male', bsa_m2: 1.9 });
    console.log('  ->', JSON.stringify({ status: out.status, confidence: out.confidence }));
    assert('status = Not assessable',                     out.status === 'Not assessable', out.status);
    assert('confidence = low',                            out.confidence === 'low', out.confidence);
    assert('RVEF unavailable and explains why',
        ev(out, RVEF_LABEL)?.level === 'unavailable' && /not computable/i.test(ev(out, RVEF_LABEL)?.detail ?? ''),
        JSON.stringify(ev(out, RVEF_LABEL)));
    assert('RVEDVi still assessed (ok)',                  ev(out, RVEDVI_LABEL)?.level === 'ok');
    assert('RVESVi unavailable (raw volume missing)',     ev(out, RVESVI_LABEL)?.level === 'unavailable');
    assert('RVEF in features_missing',                    (out.features_missing ?? []).includes('RVEF'));
}

function test_man_rvedvi_105_within() {
    console.log('\n[6] Man, RVEDVi 105.0 — within range (old frontend showed amber "ARVC minor")');
    const out = grade({ rv: { RVEF: 55, RVEDV: 199.5, RVESV: 89.8 }, sex: 'male', bsa_m2: 1.9 });
    console.log('  ->', JSON.stringify({ status: out.status, rvedvi: ev(out, RVEDVI_LABEL)?.detail }));
    assert('RVEDVi evidence ok',                          ev(out, RVEDVI_LABEL)?.level === 'ok');
    assert('RVEDVi detail shows 105.0',                   /105\.0/.test(ev(out, RVEDVI_LABEL)?.detail ?? ''), ev(out, RVEDVI_LABEL)?.detail);
    assert('status = Within reference range',             out.status === 'Within reference range', out.status);
}

function test_woman_rvedvi_105_above() {
    console.log('\n[7] Woman, RVEDVi 105.0 — above her upper limit (99)');
    const out = grade({ rv: { RVEF: 55, RVEDV: 168, RVESV: 75.6 }, sex: 'female', bsa_m2: 1.6 });
    console.log('  ->', JSON.stringify({ status: out.status, rvedvi: ev(out, RVEDVI_LABEL)?.detail }));
    assert('RVEDVi evidence warn',                        ev(out, RVEDVI_LABEL)?.level === 'warn');
    assert('RVEDVi detail says above',                    /above/i.test(ev(out, RVEDVI_LABEL)?.detail ?? ''), ev(out, RVEDVI_LABEL)?.detail);
    assert('status = Outside reference range',            out.status === 'Outside reference range', out.status);
}

function test_rv_duplicate_withholds_volumes() {
    console.log('\n[8] Duplicated RV-cavity slice — RV volumes withheld with the cause');
    const out = grade({
        rv: { RVEF: 50, RVEDV: 160, RVESV: 80 }, sex: 'male', bsa_m2: 1.9,
        volume_signals: { voxel_mm3: 18.0, duplicate_slices: [dupEntry('rv', 3, 6, 7)] },
    });
    const abs = ev(out, ABS_LABEL);
    console.log('  ->', JSON.stringify({ status: out.status, confidence: out.confidence, abs: abs?.detail }));
    assert('Absolute RV volumes line is unavailable',     abs?.level === 'unavailable');
    assert('reason names the duplicated RV-cavity slice', /duplicated RV cavity slice.*frame 3, slices 6 & 7/i.test(abs?.detail ?? ''), abs?.detail);
    assert('no RVEDVi / RVESVi verdict emitted',          ev(out, RVEDVI_LABEL) === undefined && ev(out, RVESVI_LABEL) === undefined);
    assert('RVEF still assessed',                         ev(out, RVEF_LABEL)?.level === 'ok');
    assert('confidence = low',                            out.confidence === 'low', out.confidence);
}

function test_voxel_size_withholds_volumes() {
    console.log('\n[9] Suspicious voxel volume — RV volumes withheld with the cause');
    const out = grade({
        rv: { RVEF: 50, RVEDV: 160, RVESV: 80 }, sex: 'male', bsa_m2: 1.9,
        volume_signals: { voxel_mm3: 0.05, duplicate_slices: [] },
    });
    const abs = ev(out, ABS_LABEL);
    console.log('  ->', JSON.stringify({ status: out.status, confidence: out.confidence, abs: abs?.detail }));
    assert('Absolute RV volumes line is unavailable',     abs?.level === 'unavailable');
    assert('reason names the voxel volume',               /voxel volume 0\.05 mm³/i.test(abs?.detail ?? ''), abs?.detail);
    assert('no RVEDVi / RVESVi verdict emitted',          ev(out, RVEDVI_LABEL) === undefined && ev(out, RVESVI_LABEL) === undefined);
    assert('confidence = low',                            out.confidence === 'low', out.confidence);
}

function test_lv_duplicate_leaves_rv_alone() {
    console.log('\n[10] Duplicated LV-cavity slice only — RV volumes unaffected');
    const out = grade({
        rv: { RVEF: 50, RVEDV: 160, RVESV: 80 }, sex: 'male', bsa_m2: 1.9,
        volume_signals: { voxel_mm3: 18.0, duplicate_slices: [dupEntry('lvc', 0, 4, 5)] },
    });
    console.log('  ->', JSON.stringify({ status: out.status, confidence: out.confidence }));
    assert('no Absolute RV volumes line',                 ev(out, ABS_LABEL) === undefined);
    assert('RVEDVi assessed (ok)',                        ev(out, RVEDVI_LABEL)?.level === 'ok');
    assert('confidence = normal',                         out.confidence === 'normal', out.confidence);
}

function test_boundaries_are_inclusive() {
    console.log('\n[11] Boundaries — published limits are inclusive, per sex and for the both-sexes check');
    const cases = [
        ['male RVEF 44.0 is within',                      { rv: { RVEF: 44.0 },             sex: 'male' },                     RVEF_LABEL,   'ok'],
        ['male RVEF 43.9 is below',                       { rv: { RVEF: 43.9 },             sex: 'male' },                     RVEF_LABEL,   'warn'],
        ['female RVEF 47.0 is within',                    { rv: { RVEF: 47.0 },             sex: 'female' },                   RVEF_LABEL,   'ok'],
        ['female RVEF 46.9 is below',                     { rv: { RVEF: 46.9 },             sex: 'female' },                   RVEF_LABEL,   'warn'],
        ['male RVEDVi 116.0 is within',                   { rv: { RVEF: 50, RVEDV: 116.0 }, sex: 'male',        bsa_m2: 1.0 }, RVEDVI_LABEL, 'ok'],
        ['male RVEDVi 116.1 is above',                    { rv: { RVEF: 50, RVEDV: 116.1 }, sex: 'male',        bsa_m2: 1.0 }, RVEDVI_LABEL, 'warn'],
        ['female RVEDVi 44.0 is within',                  { rv: { RVEF: 50, RVEDV: 44.0 },  sex: 'female',      bsa_m2: 1.0 }, RVEDVI_LABEL, 'ok'],
        ['female RVEDVi 43.9 is below',                   { rv: { RVEF: 50, RVEDV: 43.9 },  sex: 'female',      bsa_m2: 1.0 }, RVEDVI_LABEL, 'warn'],
        ['male RVESVi 52.0 is within',                    { rv: { RVEF: 50, RVESV: 52.0 },  sex: 'male',        bsa_m2: 1.0 }, RVESVI_LABEL, 'ok'],
        ['female RVESVi 43.1 is above',                   { rv: { RVEF: 50, RVESV: 43.1 },  sex: 'female',      bsa_m2: 1.0 }, RVESVI_LABEL, 'warn'],
        ['unspecified RVEF 47.0 is within for both',      { rv: { RVEF: 47.0 },             sex: 'unspecified' },              RVEF_LABEL,   'ok'],
        ['unspecified RVEF 44.0 depends on sex',          { rv: { RVEF: 44.0 },             sex: 'unspecified' },              RVEF_LABEL,   'unavailable'],
        ['unspecified RVEF 43.9 is below for both',       { rv: { RVEF: 43.9 },             sex: 'unspecified' },              RVEF_LABEL,   'warn'],
        ['unspecified RVEDVi 99.0 is within for both',    { rv: { RVEF: 50, RVEDV: 99.0 },  sex: 'unspecified', bsa_m2: 1.0 }, RVEDVI_LABEL, 'ok'],
        ['unspecified RVEDVi 99.1 depends on sex',        { rv: { RVEF: 50, RVEDV: 99.1 },  sex: 'unspecified', bsa_m2: 1.0 }, RVEDVI_LABEL, 'unavailable'],
        ['unspecified RVEDVi 116.1 is above for both',    { rv: { RVEF: 50, RVEDV: 116.1 }, sex: 'unspecified', bsa_m2: 1.0 }, RVEDVI_LABEL, 'warn'],
    ];
    for (const [name, input, label, expected] of cases) {
        const got = ev(grade(input), label)?.level;
        assert(name, got === expected, `got ${got}`);
    }
}

function test_contract_across_all_runs() {
    console.log('\n[12] Every run above — exits 0, no severity words, sex and BSA echoed');
    assert('at least 25 runs collected',                  ALL_RUNS.length >= 25, String(ALL_RUNS.length));
    const crashed = ALL_RUNS.filter(r => r.exit !== 0);
    assert('every run exits 0',                           crashed.length === 0, JSON.stringify(crashed.map(r => r.out.error)));
    const worded = ALL_RUNS.filter(r => SEVERITY_WORDS.test(JSON.stringify(r.out)));
    assert('no output uses mild / moderate / severe',     worded.length === 0, JSON.stringify(worded.map(r => r.out.status)));
    const normalSex = s => (s === 'male' || s === 'female' ? s : 'unspecified');
    const wrongSex = ALL_RUNS.filter(r => r.out.sex !== normalSex(r.input.sex));
    assert('sex echoed back (normalised)',                wrongSex.length === 0, JSON.stringify(wrongSex.map(r => [r.input.sex, r.out.sex])));
    const wrongBsa = ALL_RUNS.filter(r => (r.out.bsa_m2 ?? null) !== (r.input.bsa_m2 ?? null));
    assert('bsa_m2 echoed back',                          wrongBsa.length === 0, JSON.stringify(wrongBsa.map(r => [r.input.bsa_m2, r.out.bsa_m2])));
}

// ── Main ─────────────────────────────────────────────────────────────────────

(function main() {
    console.log(`Running compute_rv_health_status.py assertions`);
    console.log(`Script: ${SCRIPT_PATH}`);
    try {
        test_man_rvef_45_within();
        test_woman_rvef_46_below();
        test_sex_unspecified_checks_both_sexes();
        test_sex_unspecified_agreeing_verdicts();
        test_no_bsa();
        test_rvef_null();
        test_man_rvedvi_105_within();
        test_woman_rvedvi_105_above();
        test_rv_duplicate_withholds_volumes();
        test_voxel_size_withholds_volumes();
        test_lv_duplicate_leaves_rv_alone();
        test_boundaries_are_inclusive();
        test_contract_across_all_runs();
    } catch (err) {
        console.error('Runner crashed:', err);
        process.exit(2);
    }
    console.log(`\n────────────────────────`);
    console.log(`Assertions: ${PASS} passed, ${FAIL} failed`);
    process.exit(FAIL === 0 ? 0 : 1);
})();
