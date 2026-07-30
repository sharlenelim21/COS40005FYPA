/**
 * check_regional_health_status.js
 * ===============================
 * Standalone runnable test for src/python/compute_regional_health_status.py
 * (Layer 2 — advisory per-AHA-segment health status).
 *
 * No Mongo, no HTTP, no test framework — spawns the Python module with synthetic
 * per-segment strain on stdin, parses stdout, and asserts. Mirrors
 * scripts/check_health_status.js in structure.
 *
 * Scenarios:
 *   [1] Healthy overall + a few weak BASAL segments → those segments flagged
 *       mild, summary names "basal", overall grade untouched.
 *   [2] All segments normal → "All segments within normal range", nothing flagged.
 *   [3] Regional strain absent → status "unavailable" (NOT "healthy"), no crash.
 *   [4] Globally-low heart (every segment equally weak) → the RELATIVE rule does
 *       NOT flag all 17 as focal defects. reduced_count === 0 and the summary
 *       says so explicitly. This is the core sanity check of the hybrid rule.
 *   [5] Layer-1 (compute_health_status.py) output is BYTE-IDENTICAL whether or
 *       not Layer 2 runs — proving this layer never moves the overall grade.
 *   [6] Defensive: NaN / null / missing GCS segments are skipped and reported,
 *       never invented, and a partial-coverage warning is emitted.
 *
 * Run:  node scripts/check_regional_health_status.js
 * Exits 0 on all assertions passing, 1 otherwise.
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const REGIONAL_SCRIPT = path.resolve(
    __dirname, '..', 'src', 'python', 'compute_regional_health_status.py'
);
const HEALTH_SCRIPT = path.resolve(
    __dirname, '..', 'src', 'python', 'compute_health_status.py'
);

// ── AHA segment names (idx → label), matching bullseye_analysis.py ──────────
const AHA_NAMES = [
    'Basal Anterior', 'Basal Anterolateral', 'Basal Inferolateral', 'Basal Inferior',
    'Basal Inferoseptal', 'Basal Anteroseptal',
    'Mid Anterior', 'Mid Anterolateral', 'Mid Inferolateral', 'Mid Inferior',
    'Mid Inferoseptal', 'Mid Anteroseptal',
    'Apical Anterior', 'Apical Lateral', 'Apical Inferior', 'Apical Septal',
    'Apex',
];

/** Build a 17-segment array. `overrides` maps 1-based idx → {gcs, grs}. */
function makeSegments(defaultGcs, overrides = {}, defaultGrs = 35) {
    return AHA_NAMES.map((label, i) => {
        const idx = i + 1;
        const o = overrides[idx] ?? {};
        return {
            segment: idx,
            label,
            gcs: 'gcs' in o ? o.gcs : defaultGcs,
            grs: 'grs' in o ? o.grs : defaultGrs,
        };
    });
}

// ── Python invocation ───────────────────────────────────────────────────────

let _cachedPythonBin = null;
function findPython() {
    if (_cachedPythonBin) return _cachedPythonBin;
    for (const bin of ['python3', 'python', 'py']) {
        const probe = spawnSync(bin, ['-c', 'import sys; sys.stdout.write("ok")'], {
            encoding: 'utf-8', timeout: 15000, windowsHide: true,
        });
        if (!probe.error && probe.status === 0 && probe.stdout.trim() === 'ok') {
            _cachedPythonBin = bin;
            console.log(`  (using interpreter: ${bin})`);
            return bin;
        }
    }
    throw new Error('No Python interpreter on PATH. Tried python3, python, py.');
}

function runPython(scriptPath, payload) {
    const bin = findPython();
    return spawnSync(bin, [scriptPath], {
        input: JSON.stringify(payload),
        encoding: 'utf-8', timeout: 30000, windowsHide: true,
    });
}

function safeJson(raw, stderr) {
    try {
        return JSON.parse((raw ?? '').trim());
    } catch (e) {
        return { error: `[non-JSON stdout] ${e.message}. stderr=${(stderr ?? '').substring(0, 300)}` };
    }
}

// ── Assertions ──────────────────────────────────────────────────────────────

let PASS = 0, FAIL = 0;
function assert(name, cond, detail) {
    if (cond) { console.log(`  ✓ ${name}`); PASS++; }
    else { console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`); FAIL++; }
}

// ── Test 1: healthy overall + weak basal segments ───────────────────────────

function test_weak_basal_segments() {
    console.log('\n[1] Healthy heart with 3 weak BASAL segments → flagged, summary names basal');
    // Most segments contract well (-20). Segments 1,2,3 (all basal) are weak
    // enough to land in the "mild" absolute band AND stand out from the mean.
    const segments = makeSegments(-20, {
        1: { gcs: -13.5 },
        2: { gcs: -13.0 },
        3: { gcs: -12.5 },
    });
    const res = runPython(REGIONAL_SCRIPT, { segments, source: 'strain' });
    if (res.status !== 0) {
        console.log('  Python stderr:', res.stderr);
        assert('exits 0', false, `exit ${res.status}`);
        return;
    }
    const out = safeJson(res.stdout, res.stderr);
    console.log('  summary:', out.summary, '| affected:', JSON.stringify(out.affected_idx));

    assert('status ok', out.status === 'ok', out.status);
    assert('overall_grade_unchanged is true', out.overall_grade_unchanged === true);
    assert('exactly 3 segments reduced', out.reduced_count === 3, `got ${out.reduced_count}`);
    assert('affected are 1,2,3', JSON.stringify(out.affected_idx) === '[1,2,3]', JSON.stringify(out.affected_idx));
    assert('summary mentions basal', /basal/i.test(out.summary), out.summary);
    assert('summary level is Mild', /^Mild/.test(out.summary), out.summary);
    const seg1 = out.segments.find(s => s.idx === 1);
    assert('segment 1 level = mild', seg1?.level === 'mild', seg1?.level);
    assert('segment 1 region = basal', seg1?.region === 'basal', seg1?.region);
    const seg7 = out.segments.find(s => s.idx === 7);
    assert('a healthy mid segment stays normal', seg7?.level === 'normal', seg7?.level);
    assert('all 17 segments present', out.segments.length === 17, `got ${out.segments.length}`);
    assert('apex (17) maps to region apex',
        out.segments.find(s => s.idx === 17)?.region === 'apex');
    assert('disclaimer marks it advisory', /advisor/i.test(out.disclaimer ?? ''));
}

// ── Test 2: all normal ──────────────────────────────────────────────────────

function test_all_normal() {
    console.log('\n[2] All segments normal → "within normal range", nothing flagged');
    const segments = makeSegments(-20);
    const res = runPython(REGIONAL_SCRIPT, { segments, source: 'strain' });
    const out = safeJson(res.stdout, res.stderr);
    console.log('  summary:', out.summary);

    assert('status ok', out.status === 'ok', out.status);
    assert('reduced_count 0', out.reduced_count === 0, `got ${out.reduced_count}`);
    assert('affected_idx empty', Array.isArray(out.affected_idx) && out.affected_idx.length === 0,
        JSON.stringify(out.affected_idx));
    assert('summary says within normal range', /within normal range/i.test(out.summary), out.summary);
    assert('every segment level normal', out.segments.every(s => s.level === 'normal'));
}

// ── Test 3: regional strain absent → unavailable ────────────────────────────

function test_unavailable() {
    console.log('\n[3] Regional strain absent → "unavailable" (never "healthy")');

    // 3a. No segments at all.
    const resEmpty = runPython(REGIONAL_SCRIPT, { segments: [], source: null });
    assert('empty segments: exits 0 (not a crash)', resEmpty.status === 0, `exit ${resEmpty.status}`);
    const outEmpty = safeJson(resEmpty.stdout, resEmpty.stderr);
    console.log('  empty →', outEmpty.status, '|', outEmpty.summary);
    assert('empty: status unavailable', outEmpty.status === 'unavailable', outEmpty.status);
    assert('empty: NOT reported as healthy/normal',
        !/within normal range/i.test(outEmpty.summary ?? ''), outEmpty.summary);
    assert('empty: reduced_count 0', outEmpty.reduced_count === 0);
    assert('empty: overall_grade_unchanged still true', outEmpty.overall_grade_unchanged === true);

    // 3b. Caller-declared reason (e.g. ED/ES misalignment — the read-only path).
    const resReason = runPython(REGIONAL_SCRIPT, {
        segments: [], source: 'strain',
        unavailable_reason: 'stored strain was computed on frames 0→13, but heart metrics detected ED/ES at 4→13.',
    });
    const outReason = safeJson(resReason.stdout, resReason.stderr);
    console.log('  misaligned →', outReason.status, '|', outReason.summary);
    assert('misaligned: status unavailable', outReason.status === 'unavailable', outReason.status);
    assert('misaligned: reason surfaced in summary', /frames 0/.test(outReason.summary ?? ''), outReason.summary);
    assert('misaligned: reason also in warnings', (outReason.warnings ?? []).length > 0);

    // 3c. Missing key entirely.
    const resMissing = runPython(REGIONAL_SCRIPT, {});
    assert('missing key: exits 0', resMissing.status === 0, `exit ${resMissing.status}`);
    assert('missing key: unavailable', safeJson(resMissing.stdout).status === 'unavailable');
}

// ── Test 4: globally-low heart → relative rule prevents flagging everything ──

function test_globally_low_not_all_flagged() {
    console.log('\n[4] Globally-low heart (all segments equally weak) → NOT 17 focal defects');
    // Every segment at -8: absolutely "moderate", but none stands out from the
    // patient's own mean, so none is a FOCAL defect. Layer 1 grades the global
    // problem from EF; Layer 2 must not double-report it as 17 local lesions.
    const segments = makeSegments(-8);
    const res = runPython(REGIONAL_SCRIPT, { segments, source: 'strain' });
    const out = safeJson(res.stdout, res.stderr);
    console.log('  summary:', out.summary);
    console.log('  reduced_count:', out.reduced_count, '| mean GCS:', out.patient_mean_gcs);

    assert('status ok', out.status === 'ok', out.status);
    assert('reduced_count is 0 (no FOCAL defect)', out.reduced_count === 0, `got ${out.reduced_count}`);
    assert('affected_idx empty', (out.affected_idx ?? []).length === 0, JSON.stringify(out.affected_idx));
    assert('does NOT claim all segments are fine',
        !/All segments within normal range/i.test(out.summary), out.summary);
    assert('summary states uniform reduction explicitly',
        /uniformly reduced/i.test(out.summary), out.summary);
    assert('summary defers global grading to primary status',
        /primary health status/i.test(out.summary), out.summary);
    // Transparency: the absolute band still records that these are abnormal.
    assert('abs_level still records the abnormality',
        out.segments.every(s => s.abs_level === 'moderate'),
        JSON.stringify(out.segments.slice(0, 2)));
    assert('but hybrid level is normal (not focal)',
        out.segments.every(s => s.level === 'normal'));
}

// ── Test 5: Layer 1 is byte-identical with and without Layer 2 ──────────────

function test_layer1_byte_identical() {
    console.log('\n[5] Layer-1 overall grade is BYTE-IDENTICAL regardless of Layer 2');
    const measurements = {
        EF: 26.36, EDV: 306.87, ESV: 225.97, StrokeVolume: 80.9,
        PeakGRS: 14.42, PeakGCS: -10.23,
    };

    // Run Layer 1 alone.
    const before = runPython(HEALTH_SCRIPT, { measurements, heart_metrics_warnings: [] });
    // Run Layer 2 in between (it must not touch anything Layer 1 reads).
    runPython(REGIONAL_SCRIPT, { segments: makeSegments(-20, { 1: { gcs: -13 } }), source: 'strain' });
    // Run Layer 1 again.
    const after = runPython(HEALTH_SCRIPT, { measurements, heart_metrics_warnings: [] });

    if (before.status !== 0 || after.status !== 0) {
        assert('both Layer-1 runs exit 0', false, `${before.status} / ${after.status}`);
        return;
    }

    // computed_at is added by the SERVICE, not the module, so raw stdout is
    // deterministic and can be compared byte-for-byte.
    const a = before.stdout.trim();
    const b = after.stdout.trim();
    assert('Layer-1 stdout identical byte-for-byte', a === b,
        `lengths ${a.length} vs ${b.length}`);

    const outA = safeJson(a);
    assert('Layer-1 status still Severe (EF 26.4)', outA.status === 'Severe', outA.status);
    assert('Layer-1 output has no regional keys',
        outA.reduced_count === undefined && outA.affected_idx === undefined && outA.segments === undefined,
        Object.keys(outA).join(','));

    // And Layer 2 asserts its own non-interference contract.
    const reg = safeJson(runPython(REGIONAL_SCRIPT, { segments: makeSegments(-20), source: 'strain' }).stdout);
    assert('Layer-2 declares overall_grade_unchanged', reg.overall_grade_unchanged === true);
    assert('Layer-2 emits no status/grade_from_ef field of its own',
        reg.grade_from_ef === undefined, String(reg.grade_from_ef));
}

// ── Test 6: NaN / missing segments are skipped, never invented ───────────────

function test_skipped_segments() {
    console.log('\n[6] NaN / null / missing GCS → skipped and reported, never invented');
    const segments = makeSegments(-20, {
        5: { gcs: null },
        17: { gcs: null },
    }).filter(s => s.segment !== 12);   // drop segment 12 entirely

    const res = runPython(REGIONAL_SCRIPT, { segments, source: 'strainSeries' });
    const out = safeJson(res.stdout, res.stderr);
    console.log('  skipped_idx:', JSON.stringify(out.skipped_idx), '| warnings:', out.warnings?.length);

    assert('exits 0', res.status === 0, `exit ${res.status}`);
    assert('status ok (partial coverage is not fatal)', out.status === 'ok', out.status);
    assert('null-GCS segments recorded as skipped',
        JSON.stringify(out.skipped_idx) === '[5,17]', JSON.stringify(out.skipped_idx));
    assert('dropped segment 12 is absent, not fabricated',
        !out.segments.some(s => s.idx === 12));
    assert('no skipped segment leaks into the results',
        !out.segments.some(s => s.idx === 5 || s.idx === 17));
    assert('partial coverage produces a warning',
        (out.warnings ?? []).some(w => /segments had usable GCS|partial/i.test(w)),
        JSON.stringify(out.warnings));
    assert('source echoed back', out.source === 'strainSeries', out.source);
}

// ── Main ────────────────────────────────────────────────────────────────────

(function main() {
    console.log('Running compute_regional_health_status.py assertions (Layer 2 — advisory)');
    console.log(`Script: ${REGIONAL_SCRIPT}`);
    try {
        test_weak_basal_segments();
        test_all_normal();
        test_unavailable();
        test_globally_low_not_all_flagged();
        test_layer1_byte_identical();
        test_skipped_segments();
    } catch (err) {
        console.error('Runner crashed:', err);
        process.exit(2);
    }
    console.log(`\n────────────────────────`);
    console.log(`Assertions: ${PASS} passed, ${FAIL} failed`);
    process.exit(FAIL === 0 ? 0 : 1);
})();
