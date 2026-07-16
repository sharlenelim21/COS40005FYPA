/**
 * check_disease_similarity.js
 * ===========================
 * Standalone sanity harness for compute_disease_similarity.py.
 *
 * Feeds archetypal NOR / HCM / DCM measurement sets to the Python script and
 * asserts the expected pattern wins, plus a few edge cases. No DB, no server —
 * just spawns the Python script the same way the Node service does.
 *
 * Usage:  node scripts/check_disease_similarity.js
 * Exit:   0 = all checks passed, 1 = one or more failed.
 *
 * Mirrors the style of check_heart_metrics.js.
 */

const { spawnSync } = require("child_process");
const path = require("path");

const SCRIPT = path.join(__dirname, "..", "src", "python", "compute_disease_similarity.py");

// Try python3 first (matches the Node service), fall back to py/python.
const PY_CANDIDATES = ["python3", "py", "python"];

function runPython(inputObj) {
  const payload = JSON.stringify(inputObj);
  for (const exe of PY_CANDIDATES) {
    const res = spawnSync(exe, [SCRIPT], { input: payload, encoding: "utf8" });
    if (res.error) continue; // interpreter not found — try next
    return { exe, code: res.status, stdout: res.stdout, stderr: res.stderr };
  }
  throw new Error(`No usable Python interpreter (tried ${PY_CANDIDATES.join(", ")}).`);
}

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}\n      ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function parse(result) {
  assert(result.stdout && result.stdout.trim().length > 0, `no stdout (stderr: ${result.stderr?.slice(0, 200)})`);
  return JSON.parse(result.stdout.trim());
}

console.log("Disease Pattern Similarity — sanity checks\n");

// ── Archetype: healthy → NOR ──────────────────────────────────────────────
check("Healthy archetype ranks NOR first", () => {
  const out = parse(runPython({ measurements: { EF: 62, EDV: 142, ESV: 54, StrokeVolume: 88, PeakGRS: 40, PeakGCS: -20 } }));
  assert(out.most_similar === "NOR", `expected NOR, got ${out.most_similar}`);
  assert(out.similarities[0].percent > 50, `NOR % should dominate, got ${out.similarities[0].percent}`);
});

// ── Archetype: dilated → DCM ──────────────────────────────────────────────
check("DCM archetype ranks DCM first", () => {
  const out = parse(runPython({ measurements: { EF: 30, EDV: 225, ESV: 160, StrokeVolume: 65, PeakGRS: 16, PeakGCS: -9 } }));
  assert(out.most_similar === "DCM", `expected DCM, got ${out.most_similar}`);
  assert(out.similarities[0].percent > 60, `DCM % should dominate, got ${out.similarities[0].percent}`);
});

// ── Archetype: hypertrophic → HCM ─────────────────────────────────────────
check("HCM archetype ranks HCM first", () => {
  const out = parse(runPython({ measurements: { EF: 68, EDV: 120, ESV: 38, StrokeVolume: 82, PeakGRS: 32, PeakGCS: -14 } }));
  assert(out.most_similar === "HCM", `expected HCM, got ${out.most_similar}`);
});

// ── Real example from the project brief (should read NOR) ─────────────────
check("Brief's healthy example (EF 58/EDV 162/ESV 68) ranks NOR", () => {
  const out = parse(runPython({ measurements: { EF: 58.2, EDV: 162.4, ESV: 67.8, StrokeVolume: 94.6, PeakGRS: 38.5, PeakGCS: -21.7 } }));
  assert(out.most_similar === "NOR", `expected NOR, got ${out.most_similar}`);
});

// ── Real metrics output from the heart-metrics module (strain null) ───────
// This is an actual heartMetrics.measurements block: EF 64, normal cavity, no
// strain yet. Should read NOR using only the 4 volume features, no crash on the
// null PeakGRS/PeakGCS.
check("Real metrics output (EF 64, GRS/GCS null) ranks NOR without strain", () => {
  const out = parse(runPython({ measurements: { EF: 64.0, EDV: 144.0, ESV: 51.84, StrokeVolume: 92.16, PeakGRS: null, PeakGCS: null } }));
  assert(out.most_similar === "NOR", `expected NOR, got ${out.most_similar}`);
  assert(out.features_missing.includes("PeakGRS") && out.features_missing.includes("PeakGCS"),
    "strain features should be reported missing");
  assert(out.features_used.length === 4, `expected 4 volume features used, got ${out.features_used.length}`);
});

// ── Percentages sum to ~100 ───────────────────────────────────────────────
check("Similarity percentages sum to ~100", () => {
  const out = parse(runPython({ measurements: { EF: 45, EDV: 180, ESV: 100 } }));
  const total = out.similarities.reduce((a, s) => a + s.percent, 0);
  assert(Math.abs(total - 100) < 0.5, `percentages sum to ${total}, expected ~100`);
});

// ── Missing features handled + warning emitted ────────────────────────────
check("Single feature works and warns about low reliability", () => {
  const out = parse(runPython({ measurements: { EF: 30 } }));
  assert(out.features_used.length === 1, `expected 1 feature used, got ${out.features_used.length}`);
  assert(out.warnings.length > 0, "expected a low-reliability warning");
});

// ── Every output carries reasoning + disclaimer ───────────────────────────
check("Output includes reasons and non-diagnostic disclaimer", () => {
  const out = parse(runPython({ measurements: { EF: 62, EDV: 142, ESV: 54 } }));
  assert(Array.isArray(out.similarities[0].reasons) && out.similarities[0].reasons.length > 0, "winner has no reasons");
  assert(typeof out.disclaimer === "string" && /not a diagnosis/i.test(out.disclaimer), "disclaimer missing/incorrect");
});

// ── Empty measurements → clean error, non-zero exit ───────────────────────
check("Empty measurements errors gracefully", () => {
  const res = runPython({ measurements: {} });
  const out = JSON.parse(res.stdout.trim());
  assert(out.error, "expected an error field");
  assert(res.code === 1, `expected exit 1, got ${res.code}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
