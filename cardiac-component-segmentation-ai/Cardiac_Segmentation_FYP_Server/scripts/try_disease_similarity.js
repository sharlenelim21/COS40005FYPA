/**
 * try_disease_similarity.js
 * =========================
 * Interactive helper to run the Disease Pattern Similarity module on ANY set of
 * measurements from the terminal and print a readable result. Handy for
 * experimenting, demos, and screenshotting for the FYP report.
 *
 * NOT a diagnostic tool — this reports pattern SIMILARITY only.
 *
 * Usage — three ways to give it numbers:
 *
 *   1) Named flags (any subset — include EDVI/ESVI/LVMI to get indexed mode,
 *      MaxWallThicknessMm for HCM/DCM gate checking, --sex male|female for the
 *      sex-specific NOR reference band):
 *        node scripts/try_disease_similarity.js --EF 64 --EDV 144 --ESV 51.84 --StrokeVolume 92.16
 *        node scripts/try_disease_similarity.js --EF 65 --EDVI 75 --ESVI 25 --LVMI 135 --MaxWallThicknessMm 20 --sex male
 *
 *   2) Inline JSON:
 *        node scripts/try_disease_similarity.js --json "{\"EF\":64,\"EDV\":144,\"ESV\":51.84}"
 *
 *   3) Pipe a full metrics object on stdin (accepts either a bare measurements
 *      object OR a whole heartMetrics output with a `.measurements` field):
 *        cat sample_metrics.json | node scripts/try_disease_similarity.js
 */

const { spawnSync } = require("child_process");
const path = require("path");

const SCRIPT = path.join(__dirname, "..", "src", "python", "compute_disease_similarity.py");
const PY_CANDIDATES = ["python3", "py", "python"];
const FEATURES = [
  "EF", "EDV", "ESV", "EDVI", "ESVI", "LVMassG", "LVMI", "MaxWallThicknessMm",
  "StrokeVolume", "StrokeVolumeIndex", "PeakGRS", "PeakGCS",
];

function runPython(measurements, sex) {
  const payload = JSON.stringify({ measurements, sex: sex || "unspecified" });
  for (const exe of PY_CANDIDATES) {
    const res = spawnSync(exe, [SCRIPT], { input: payload, encoding: "utf8" });
    if (res.error) continue;
    return res;
  }
  throw new Error(`No usable Python interpreter (tried ${PY_CANDIDATES.join(", ")}).`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const jsonIdx = args.indexOf("--json");
  if (jsonIdx !== -1 && args[jsonIdx + 1]) {
    return { measurements: JSON.parse(args[jsonIdx + 1]), sex: null };
  }
  // Named flags: --EF 64 --EDV 144 ... --sex male
  const out = {};
  let sex = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const val = args[i + 1];
      if (val !== undefined && !val.startsWith("--")) {
        if (key === "sex") sex = val;
        else out[key] = Number(val);
        i++;
      }
    }
  }
  return { measurements: out, sex };
}

function readStdin() {
  try {
    const raw = require("fs").readFileSync(0, "utf8").trim();
    if (!raw) return null;
    const obj = JSON.parse(raw);
    // Accept a full metrics object (with .measurements) or a bare measurements object.
    return obj.measurements ?? obj;
  } catch {
    return null;
  }
}

function main() {
  let { measurements, sex } = parseArgs(process.argv);
  if (Object.keys(measurements).length === 0) {
    const fromStdin = readStdin();
    if (fromStdin) measurements = fromStdin;
  }

  if (Object.keys(measurements).length === 0) {
    console.log("No measurements given. Example:\n  node scripts/try_disease_similarity.js --EF 64 --EDV 144 --ESV 51.84");
    process.exit(1);
  }

  // Keep only known feature keys, so a full metrics object works too.
  const clean = {};
  for (const f of FEATURES) if (f in measurements) clean[f] = measurements[f];

  console.log("Input measurements:");
  for (const f of FEATURES) console.log(`  ${f.padEnd(19)} ${f in clean ? clean[f] : "(not provided)"}`);
  console.log(`  ${"sex".padEnd(19)} ${sex || "(unspecified)"}`);
  console.log();

  const res = runPython(clean, sex);
  const out = JSON.parse(res.stdout.trim());

  if (out.error) {
    console.log("Error:", out.error);
    process.exit(1);
  }

  console.log(`MODE:  ${out.mode}   CONFIDENCE:  ${out.confidence}`);
  console.log(`HEADLINE:  ${out.phenotype_headline}\n`);
  console.log("Similarity ranking (raw, always shown regardless of gate status):");
  for (const s of out.similarities) {
    const bar = "█".repeat(Math.round(s.percent / 3));
    console.log(`  ${s.code}  ${String(s.percent).padStart(5)}%  ${bar}`);
  }
  console.log("\nReasoning (top match):");
  for (const r of out.similarities[0].reasons) console.log("  -", r);

  console.log(`\nGate (${out.gate.code}): met=${out.gate.met}  — ${out.gate.reason}`);
  if (out.confidence_notes.length) console.log(`\nConfidence notes:\n${out.confidence_notes.map((n) => "  ! " + n).join("\n")}`);

  if (out.features_missing.length) console.log(`\nMissing features: ${out.features_missing.join(", ")}`);
  if (out.informational && Object.values(out.informational).some((v) => v != null)) {
    console.log(`\nInformational (not scored): ${JSON.stringify(out.informational)}`);
  }
  if (out.warnings.length) console.log(`\nWarnings:\n${out.warnings.map((w) => "  ! " + w).join("\n")}`);
  console.log(`\n${out.disclaimer}`);
}

main();
