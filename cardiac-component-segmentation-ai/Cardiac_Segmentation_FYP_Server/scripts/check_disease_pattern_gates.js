/**
 * check_disease_pattern_gates.js
 * ===============================
 * Standalone sanity harness for compute_disease_pattern_gates.py.
 *
 * Feeds archetypal LV+RV measurement sets to the Python script and asserts
 * each ACDC gate reads the way its own published criterion says it should,
 * plus the multi-gate and severity-layering cases. No DB, no server — just
 * spawns the Python script the same way the Node service does.
 *
 * Usage:  node scripts/check_disease_pattern_gates.js
 * Exit:   0 = all checks passed, 1 = one or more failed.
 *
 * Mirrors the style of check_disease_similarity.js.
 */

const { spawnSync } = require("child_process");
const path = require("path");

const SCRIPT = path.join(__dirname, "..", "src", "python", "compute_disease_pattern_gates.py");
const PY_CANDIDATES = ["python3", "py", "python"];

function runPython(inputObj) {
  const payload = JSON.stringify(inputObj);
  let last = null;
  for (const exe of PY_CANDIDATES) {
    const res = spawnSync(exe, [SCRIPT], { input: payload, encoding: "utf8" });
    // Keep trying the next candidate not just when the interpreter failed to
    // launch (res.error), but also when it launched and immediately failed
    // with no usable stdout — e.g. Windows' "python3"/"python" App Execution
    // Alias stubs exist as real executables that launch fine, print a
    // Microsoft Store nag to stderr, and exit non-zero, which res.error alone
    // never catches.
    if (res.error || !res.stdout || !res.stdout.trim()) {
      last = res;
      continue;
    }
    return { exe, code: res.status, stdout: res.stdout, stderr: res.stderr };
  }
  const hint = last?.stderr ? ` Last attempt's stderr: ${last.stderr.trim().slice(0, 200)}` : "";
  throw new Error(`No usable Python interpreter (tried ${PY_CANDIDATES.join(", ")}).${hint}`);
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

function gate(out, code) {
  const g = out.gates.find((g) => g.code === code);
  assert(g, `no ${code} gate in output`);
  return g;
}

console.log("Unified Disease Pattern Gates — sanity checks\n");

// ── Healthy archetype: only NOR met ─────────────────────────────────────────
check("Healthy archetype meets only NOR", () => {
  const out = parse(runPython({
    lv: { EF: 64, EDV: 137, EDVI: 72, LVMI: 50, MaxWallThicknessMm: 9 },
    rv: { RVEDVI: 65, RVEF: 55, RVEDV: 124, SVI: 45 },
    regional_lv_segments: [{ segment: 1, level: "normal" }, { segment: 2, level: "normal" }],
  }));
  assert(gate(out, "NOR").met === true, "NOR should be met");
  assert(gate(out, "DCM").met === false, "DCM should not be met");
  assert(gate(out, "HCM").met === false, "HCM should not be met");
  assert(gate(out, "RV").met === false, "RV should not be met");
  assert(out.met_codes.length === 1 && out.met_codes[0] === "NOR", `met_codes should be ["NOR"], got ${JSON.stringify(out.met_codes)}`);
  assert(out.rv_severity === null, "rv_severity should be null when RV gate isn't met");
});

// ── DCM archetype ────────────────────────────────────────────────────────────
check("DCM archetype meets DCM (EDVI>100 and EF<40)", () => {
  const out = parse(runPython({
    lv: { EF: 25, EDV: 275, EDVI: 145, LVMI: 65, MaxWallThicknessMm: 7 },
    rv: { RVEDVI: 80, RVEF: 55, RVEDV: 150 },
  }));
  assert(gate(out, "DCM").met === true, "DCM should be met");
  assert(gate(out, "NOR").met === false, "NOR should not be met");
});

// ── HCM archetype ────────────────────────────────────────────────────────────
check("HCM archetype meets HCM (LVMI>110, wall>15mm, EF>=50)", () => {
  const out = parse(runPython({
    lv: { EF: 60, EDV: 110, EDVI: 58, LVMI: 120, MaxWallThicknessMm: 18 },
    rv: { RVEDVI: 70, RVEF: 58, RVEDV: 133 },
  }));
  assert(gate(out, "HCM").met === true, "HCM should be met");
});

check("HCM gate NOT met when EF is reduced, even with thick wall + high mass", () => {
  const out = parse(runPython({
    lv: { EF: 35, EDV: 180, EDVI: 95, LVMI: 115, MaxWallThicknessMm: 17 },
    rv: { RVEDVI: 70, RVEF: 55, RVEDV: 133 },
  }));
  assert(gate(out, "HCM").met === false, "HCM should not be met — EF not preserved");
});

// ── MINF: EF alone isn't enough, needs regional abnormality too ────────────
check("MINF is pending (not false) when EF<40 but no regional data supplied", () => {
  const out = parse(runPython({
    lv: { EF: 28, EDV: 180, EDVI: 95, LVMI: 60, MaxWallThicknessMm: 8 },
    rv: { RVEDVI: 70, RVEF: 55, RVEDV: 133 },
  }));
  assert(gate(out, "MINF").met === null, `MINF should be pending (null), got ${gate(out, "MINF").met}`);
});

check("MINF met when EF<40 and >=1 regional segment is moderate/severe", () => {
  const out = parse(runPython({
    lv: { EF: 28, EDV: 180, EDVI: 95, LVMI: 60, MaxWallThicknessMm: 8 },
    rv: { RVEDVI: 70, RVEF: 55, RVEDV: 133 },
    regional_lv_segments: [{ segment: 1, level: "normal" }, { segment: 2, level: "severe" }],
  }));
  assert(gate(out, "MINF").met === true, "MINF should be met");
});

check("MINF not met when EF<40 but all regional segments normal", () => {
  const out = parse(runPython({
    lv: { EF: 28, EDV: 180, EDVI: 95, LVMI: 60, MaxWallThicknessMm: 8 },
    rv: { RVEDVI: 70, RVEF: 55, RVEDV: 133 },
    regional_lv_segments: [{ segment: 1, level: "normal" }, { segment: 2, level: "mild" }],
  }));
  assert(gate(out, "MINF").met === false, "MINF should not be met — no moderate/severe segment");
});

// ── RV gate: OR logic, either threshold alone is sufficient ────────────────
check("RV gate met from RVEDVI alone (RVEF normal)", () => {
  const out = parse(runPython({
    lv: { EF: 60, EDV: 140, EDVI: 74, LVMI: 55, MaxWallThicknessMm: 9 },
    rv: { RVEDVI: 120, RVEF: 55, RVEDV: 220 },
  }));
  assert(gate(out, "RV").met === true, "RV should be met from RVEDVI alone");
});

check("RV gate met from RVEF alone (RVEDVI normal)", () => {
  const out = parse(runPython({
    lv: { EF: 60, EDV: 140, EDVI: 74, LVMI: 55, MaxWallThicknessMm: 9 },
    rv: { RVEDVI: 70, RVEF: 32, RVEDV: 130 },
  }));
  assert(gate(out, "RV").met === true, "RV should be met from RVEF alone");
});

// ── Multi-gate: DCM and RV can both be met at once ──────────────────────────
check("DCM and RV can both be met simultaneously (independent gates)", () => {
  const out = parse(runPython({
    lv: { EF: 28, EDV: 286, EDVI: 150, LVMI: 60, MaxWallThicknessMm: 8 },
    rv: { RVEDVI: 115, RVESVI: 58, RVEF: 42, RVEDV: 220, SVI: 30 },
  }));
  assert(out.met_codes.includes("DCM") && out.met_codes.includes("RV"),
    `expected both DCM and RV in met_codes, got ${JSON.stringify(out.met_codes)}`);
});

// ── RV severity layering ─────────────────────────────────────────────────────
check("RV severity note present and disease-agnostic ratio note always included when gate met", () => {
  const out = parse(runPython({
    lv: { EF: 60, EDV: 150, EDVI: 80, LVMI: 55, MaxWallThicknessMm: 9 },
    rv: { RVEDVI: 115, RVEF: 55, RVEDV: 300 },
  }));
  assert(gate(out, "RV").met === true, "RV gate should be met");
  assert(out.rv_severity && typeof out.rv_severity.ratio_note === "string" && out.rv_severity.ratio_note.length > 0,
    "ratio_note should always be present when RV gate is met");
});

check("ARVC note fires when RV measurements sit close to the Kubler ARVC cohort range", () => {
  // RVEDVI 115 both clears ACDC's own >110 RV gate AND sits well within 1.5 SD
  // of Kubler's ARVC cohort mean (103±26, 56±23, 46±10) on all three features —
  // the ARVC cohort's own mean alone (103/56/46) does NOT clear the ACDC gate,
  // confirming these are two genuinely independent checks, not one disguised
  // as two.
  const out = parse(runPython({
    lv: { EF: 60, EDV: 150, EDVI: 80, LVMI: 55, MaxWallThicknessMm: 9 },
    rv: { RVEDVI: 115, RVESVI: 56, RVEF: 44, RVEDV: 230 },
  }));
  assert(gate(out, "RV").met === true, "RV gate should be met");
  assert(out.rv_severity.arvc_note !== null, "arvc_note should fire for values close to the ARVC cohort mean");
});

check("PAH note fires when values land in the ESC/ERS higher-risk band", () => {
  const out = parse(runPython({
    lv: { EF: 60, EDV: 150, EDVI: 80, LVMI: 55, MaxWallThicknessMm: 9 },
    rv: { RVEDVI: 112, RVEF: 30, RVEDV: 220, SVI: 20 },
  }));
  assert(gate(out, "RV").met === true, "RV gate should be met");
  assert(out.rv_severity.pah_note !== null, "pah_note should fire — RVEF 30 < 37, SVI 20 < 26");
});

check("generic_note fires when RV gate met but neither ARVC nor PAH note fires", () => {
  // RVEDVI alone, way outside the ARVC cohort's range (z >> 1.5) — RVEF/
  // RVESVI/SVI all withheld so the PAH bands (which need one of those) can
  // never fire either. Isolates the "met the gate, resembles neither named
  // pattern" case cleanly.
  const out = parse(runPython({
    lv: { EF: 60, EDV: 150, EDVI: 80, LVMI: 55, MaxWallThicknessMm: 9 },
    rv: { RVEDVI: 200, RVEDV: 380 },
  }));
  assert(gate(out, "RV").met === true, "RV gate should be met");
  assert(out.rv_severity.arvc_note === null, "arvc_note should not fire — RVEDVI 200 is far outside ARVC's 103±26");
  assert(out.rv_severity.pah_note === null, "pah_note should not fire — no RVEF/SVI/RVESVI supplied");
  assert(out.rv_severity.generic_note !== null, "generic_note should fire when neither secondary note did");
});

// ── DCM/HCM reference-BSA fallback when the patient's own BSA is missing ───
check("DCM gate estimates EDVI from EDV + reference BSA when EDVI/BSA missing", () => {
  // EDV=300 mL, no EDVI/bsa given -> fallback to male reference BSA (~1.818
  // m^2) -> EDVI ~= 165.0 mL/m^2, clears the >100 criterion.
  const out = parse(runPython({
    lv: { EF: 25, EDV: 300, LVMI: 60, MaxWallThicknessMm: 8 },
    rv: { RVEDVI: 70, RVEF: 55, RVEDV: 133 },
  }));
  const g = gate(out, "DCM");
  assert(g.met === true, `DCM should be met from the estimated EDVI, got ${g.met}`);
  assert(g.reasons[0].includes("Estimated"), "DCM's EDVI reason should flag it as estimated");
});

check("DCM gate is pending (not estimated) when neither EDVI nor EDV is available", () => {
  const out = parse(runPython({
    lv: { EF: 25, LVMI: 60, MaxWallThicknessMm: 8 },
    rv: { RVEDVI: 70, RVEF: 55, RVEDV: 133 },
  }));
  assert(gate(out, "DCM").met === null, "DCM should stay pending with no EDVI and no EDV to estimate from");
});

check("HCM gate estimates LVMI from LVMassG + sex-specific reference BSA when LVMI/BSA missing", () => {
  // LVMassG=250g, sex=female -> female reference BSA (~1.633 m^2) ->
  // LVMI ~= 153.1 g/m^2, clears the >110 criterion.
  const out = parse(runPython({
    lv: { EF: 60, EDV: 110, EDVI: 58, LVMassG: 250, MaxWallThicknessMm: 18 },
    rv: { RVEDVI: 70, RVEF: 58, RVEDV: 133 },
    sex: "female",
  }));
  const g = gate(out, "HCM");
  assert(g.met === true, `HCM should be met from the estimated LVMI, got ${g.met}`);
  assert(g.reasons[0].includes("Estimated"), "HCM's LVMI reason should flag it as estimated");
});

check("Gates do NOT estimate when the real indexed value is already available (no false 'Estimated' flag)", () => {
  const out = parse(runPython({
    lv: { EF: 25, EDV: 275, EDVI: 145, LVMassG: 250, LVMI: 65, MaxWallThicknessMm: 7 },
    rv: { RVEDVI: 80, RVEF: 55, RVEDV: 150 },
  }));
  assert(!gate(out, "DCM").reasons[0].includes("Estimated"), "DCM should use the real EDVI, not estimate one");
});

// ── Co-firing LV gates get ranked, RV never does ────────────────────────────
// Margins deliberately exclude EF (shared by both gates' met/not-met check):
// MINF's margin = fraction of assessed segments abnormal, DCM's = EDVI excess
// past 100. An earlier version blended EF into both, which made DCM's
// min(EDVI margin, EF margin) structurally incapable of ever beating MINF's
// EF-only margin — reported live against a real ground-truth-DCM patient
// (EF 26.4%, EDVI 160.9, 3/17 segments abnormal) that still ranked MINF as
// Primary match. The regression test below reproduces that exact case.
check("When MINF and DCM both fire, widespread abnormal segments (not EF) make MINF the stronger match", () => {
  // All 3 assessed segments abnormal -> MINF margin = 3/3 = 1.0. EDVI just
  // clears DCM's >100 -> DCM margin = (105-100)/100 = 0.05. MINF should win.
  const out = parse(runPython({
    lv: { EF: 25, EDV: 210, EDVI: 105, LVMI: 60, MaxWallThicknessMm: 8 },
    rv: { RVEDVI: 70, RVEF: 55, RVEDV: 133 },
    regional_lv_segments: [{ segment: 1, level: "severe" }, { segment: 2, level: "severe" }, { segment: 3, level: "moderate" }],
  }));
  assert(gate(out, "MINF").met === true && gate(out, "DCM").met === true, "both MINF and DCM should be met");
  assert(gate(out, "MINF").rank_label === "Primary match", `MINF should be Primary match (margin 1.0 vs DCM's 0.05), got ${gate(out, "MINF").rank_label}`);
  assert(gate(out, "DCM").rank_label === "Also meets", `DCM should be Also meets, got ${gate(out, "DCM").rank_label}`);
});

check("When MINF and DCM both fire, a large EDVI excess (not EF) makes DCM the stronger match", () => {
  // EDVI massively clears DCM's >100 -> DCM margin = (300-100)/100 = 2.0.
  // Only 3 of 17 segments abnormal -> MINF margin = 3/17 ~= 0.18. DCM wins.
  // EDV kept <= 400 (the volume-reliability plausibility ceiling) -- EDVI can
  // still be supplied directly at 300 since it isn't re-derived from EDV here.
  const out = parse(runPython({
    lv: { EF: 35, EDV: 380, EDVI: 300, LVMI: 60, MaxWallThicknessMm: 8 },
    rv: { RVEDVI: 70, RVEF: 55, RVEDV: 133 },
    regional_lv_segments: Array.from({ length: 17 }, (_, i) => ({ segment: i + 1, level: i < 3 ? "severe" : "normal" })),
  }));
  assert(gate(out, "MINF").met === true && gate(out, "DCM").met === true, "both MINF and DCM should be met");
  assert(gate(out, "DCM").rank_label === "Primary match", `DCM should be Primary match (margin 2.0 vs MINF's ~0.18), got ${gate(out, "DCM").rank_label}`);
  assert(gate(out, "MINF").rank_label === "Also meets", `MINF should be Also meets, got ${gate(out, "MINF").rank_label}`);
});

check("REGRESSION: ground-truth-DCM patient (EF 26.4, EDVI 160.9, 3/17 segments) ranks DCM as Primary match, not MINF", () => {
  const out = parse(runPython({
    lv: { EF: 26.4, EDV: 300, EDVI: 160.9, LVMI: 121.3, MaxWallThicknessMm: 9.3 },
    rv: { RVEDVI: 73.1, RVEF: 40.9, RVEDV: 135, RVESVI: 43.2 },
    regional_lv_segments: Array.from({ length: 17 }, (_, i) => ({ segment: i + 1, level: i < 3 ? "severe" : "normal" })),
  }));
  assert(gate(out, "MINF").met === true && gate(out, "DCM").met === true, "both MINF and DCM should be met, matching the live report");
  assert(gate(out, "DCM").rank_label === "Primary match", `DCM should be Primary match for this real-world case, got ${gate(out, "DCM").rank_label}`);
  assert(gate(out, "MINF").rank_label === "Also meets", `MINF should be Also meets, got ${gate(out, "MINF").rank_label}`);
});

check("rank_label is null when only one LV gate is met", () => {
  const out = parse(runPython({
    lv: { EF: 25, EDV: 275, EDVI: 145, LVMI: 65, MaxWallThicknessMm: 7 },
    rv: { RVEDVI: 80, RVEF: 55, RVEDV: 150 },
  }));
  assert(gate(out, "DCM").met === true, "DCM should be met");
  assert(gate(out, "DCM").rank_label === null, `rank_label should be null with no co-firing gate, got ${gate(out, "DCM").rank_label}`);
});

check("RV never gets a rank_label even when co-met with an LV gate", () => {
  const out = parse(runPython({
    lv: { EF: 28, EDV: 286, EDVI: 150, LVMI: 60, MaxWallThicknessMm: 8 },
    rv: { RVEDVI: 115, RVESVI: 58, RVEF: 42, RVEDV: 220, SVI: 30 },
  }));
  assert(out.met_codes.includes("DCM") && out.met_codes.includes("RV"), "both DCM and RV should be met");
  assert(gate(out, "RV").rank_label === null, `RV should never get a rank_label, got ${gate(out, "RV").rank_label}`);
  assert(gate(out, "DCM").rank_label === null, "DCM should NOT be ranked against RV (only 1 non-RV gate met here)");
});

check("No internal _margin field leaks into the output", () => {
  const out = parse(runPython({
    lv: { EF: 25, EDV: 275, EDVI: 145, LVMI: 65, MaxWallThicknessMm: 7 },
    rv: { RVEDVI: 80, RVEF: 55, RVEDV: 150 },
  }));
  for (const g of out.gates) {
    assert(!("_margin" in g), `_margin should never be exposed in gate ${g.code}`);
  }
});

// ── MINF label reflects the ACDC paper's own wording ────────────────────────
check("MINF label is 'Systolic Heart Failure with Infarction', not 'Previous Myocardial Infarction'", () => {
  const out = parse(runPython({ lv: { EF: 60 }, rv: {} }));
  assert(gate(out, "MINF").label === "MINF (Systolic Heart Failure with Infarction)", `unexpected MINF label: ${gate(out, "MINF").label}`);
});

// ── NOR gate uses Zhan ranges, sex-specific when given ──────────────────────
check("NOR gate resolves sex-specific when sex is supplied", () => {
  const out = parse(runPython({
    lv: { EF: 62, EDV: 150, EDVI: 79, LVMI: 55, MaxWallThicknessMm: 9 },
    rv: { RVEDVI: 65, RVEF: 55, RVEDV: 124 },
    sex: "male",
  }));
  assert(out.sex === "male", "sex should be echoed back");
  assert(gate(out, "NOR").met === true, "NOR should be met for this male patient");
});

// ── Missing data → pending, never a silent false ────────────────────────────
check("All gates pending (null) when no measurements at all are provided", () => {
  const out = parse(runPython({ lv: {}, rv: {} }));
  for (const code of ["NOR", "MINF", "DCM", "HCM", "RV"]) {
    assert(gate(out, code).met === null, `${code} should be pending with no data, got ${gate(out, code).met}`);
  }
  assert(out.warnings.length > 0, "should warn when every gate is pending");
});

// ── Output always carries the disclaimer + reference source ────────────────
check("Every output carries the disclaimer and reference_source", () => {
  const out = parse(runPython({ lv: { EF: 60 }, rv: {} }));
  assert(typeof out.disclaimer === "string" && out.disclaimer.length > 0, "disclaimer missing");
  assert(out.reference_source.includes("ACDC"), "reference_source should cite ACDC");
});

// ── Volume-reliability guard — withholds EDVI/LVMI/RVEDVI when the affine/
// voxel geometry is known-suspect, mirroring compute_health_status.py /
// compute_rv_health_status.py. Regression for a live report (2026-10): a
// mask with LVEDV=6.9 mL / LV mass=5.4 g (both ~20-30x below plausible, same
// mask's Health Status panel already "Low confidence") still had NOR/DCM/HCM
// confidently report EDVI/LVMI as "outside the normal range" — i.e. treating
// a known-corrupted number as real evidence.
check("REGRESSION: implausible LVEDV excludes EDVI/LVMI from NOR/DCM/HCM, but EF (a ratio) still works", () => {
  const out = parse(runPython({
    lv: { EF: 48.8, EDV: 6.9, EDVI: 3.2, LVMassG: 5.4, LVMI: 2.5, MaxWallThicknessMm: 5.4 },
    rv: { RVEDV: 7.6, RVEDVI: 3.5, RVESVI: 2.1, RVEF: 40.8, SVI: 1.4 },
    volume_signals: { voxel_mm3: 0.5, duplicate_slices: [] },
  }));
  assert(gate(out, "NOR").met === false, `NOR should resolve from EF alone (48.8 outside 52-75), got ${gate(out, "NOR").met}`);
  assert(gate(out, "NOR").reasons.some((r) => r.includes("unreliable")), "NOR should explain the EDVI/LVMI exclusion");
  assert(gate(out, "DCM").met === null, `DCM should be pending (EDVI excluded, not usable), got ${gate(out, "DCM").met}`);
  assert(gate(out, "HCM").met === null, `HCM should be pending (LVMI excluded, not usable), got ${gate(out, "HCM").met}`);
  assert(out.warnings.some((w) => w.includes("Absolute LV volumes flagged unreliable")), "should carry a top-level LV volume-reliability warning");
});

check("Volume-reliability guard also withholds RVEDVI/RVESVI/SVI from the RV gate and severity, but RVEF still works", () => {
  // compute_rv_health_status.py has no RVEDV plausibility-range check (only
  // LV has one, via lvedv_issue) -- the RV guard is driven purely by
  // voxel_size_issue/duplicate_slice_issue, so voxel_mm3 here is set OUTSIDE
  // the plausible (0.1, 200) range to actually trigger it.
  const out = parse(runPython({
    lv: { EF: 60, EDV: 150, EDVI: 80, LVMI: 55, MaxWallThicknessMm: 9 },
    rv: { RVEDV: 5.0, RVEDVI: 2.0, RVESVI: 1.0, RVEF: 32, SVI: 0.5 },
    volume_signals: { voxel_mm3: 0.01, duplicate_slices: [] },
  }));
  const rv = gate(out, "RV");
  assert(rv.met === true, `RV gate should still fire from RVEF alone (32% < 40%), got ${rv.met}`);
  assert(rv.reasons.some((r) => r.includes("RVEDVI not available")), "RVEDVI should read as not available, not as a (corrupted) 2.0");
  assert(rv.reasons.some((r) => r.includes("unreliable")), "RV gate should explain the RVEDVI exclusion");
  assert(out.rv_severity !== null, "rv_severity should still build (RV gate is met)");
  assert(out.rv_severity.ratio_note.includes("not available"), "ratio_note should say volumes aren't available, not compute a ratio from corrupted RVEDV");
});

check("Volume-reliability guard is a no-op when voxel_mm3/LVEDV are plausible", () => {
  const out = parse(runPython({
    lv: { EF: 25, EDV: 275, EDVI: 145, LVMassG: 250, LVMI: 65, MaxWallThicknessMm: 7 },
    rv: { RVEDVI: 80, RVEF: 55, RVEDV: 150 },
    volume_signals: { voxel_mm3: 1.5, duplicate_slices: [] },
  }));
  assert(gate(out, "DCM").met === true, "DCM should still fire normally when volumes are plausible");
  assert(!gate(out, "DCM").reasons.some((r) => r.includes("unreliable")), "no unreliability note should appear when volumes are plausible");
  assert(out.warnings.length === 0, "no volume-reliability warning when volumes are plausible");
});

check("A duplicated LV-cavity slice also triggers the guard, independent of voxel_mm3/LVEDV", () => {
  const out = parse(runPython({
    lv: { EF: 60, EDV: 150, EDVI: 80, LVMI: 55, MaxWallThicknessMm: 9 },
    rv: { RVEDVI: 65, RVEF: 55, RVEDV: 124 },
    volume_signals: {
      voxel_mm3: 1.5,
      duplicate_slices: [{ class: "lvc", frame: 0, slice_keep: 2, slice_remove: 3 }],
    },
  }));
  assert(gate(out, "NOR").reasons.some((r) => r.includes("duplicated")), "NOR should explain the duplicated-slice reason specifically");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
