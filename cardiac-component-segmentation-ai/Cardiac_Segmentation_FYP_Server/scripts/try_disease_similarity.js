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
 *   1) Named flags (any subset):
 *        node scripts/try_disease_similarity.js --EF 64 --EDV 144 --ESV 51.84 --StrokeVolume 92.16
 *        node scripts/try_disease_similarity.js --EF 35 --EDV 225 --ESV 145 --PeakGRS 18 --PeakGCS -15
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
const FEATURES = ["EF", "EDV", "ESV", "StrokeVolume", "PeakGRS", "PeakGCS"];

function runPython(measurements) {
  const payload = JSON.stringify({ measurements });
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
    return JSON.parse(args[jsonIdx + 1]);
  }
  // Named flags: --EF 64 --EDV 144 ...
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const val = args[i + 1];
      if (val !== undefined && !val.startsWith("--")) {
        out[key] = Number(val);
        i++;
      }
    }
  }
  return out;
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
  let measurements = parseArgs(process.argv);
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
  for (const f of FEATURES) console.log(`  ${f.padEnd(13)} ${f in clean ? clean[f] : "(not provided)"}`);
  console.log();

  const res = runPython(clean);
  const out = JSON.parse(res.stdout.trim());

  if (out.error) {
    console.log("Error:", out.error);
    process.exit(1);
  }

  console.log(`MOST SIMILAR PATTERN:  ${out.most_similar}  (${out.similarities[0].label})\n`);
  console.log("Similarity ranking:");
  for (const s of out.similarities) {
    const bar = "█".repeat(Math.round(s.percent / 3));
    console.log(`  ${s.code}  ${String(s.percent).padStart(5)}%  ${bar}`);
  }
  console.log("\nReasoning (top match):");
  for (const r of out.similarities[0].reasons) console.log("  -", r);

  if (out.features_missing.length) console.log(`\nMissing features: ${out.features_missing.join(", ")}`);
  if (out.warnings.length) console.log(`\nWarnings:\n${out.warnings.map((w) => "  ! " + w).join("\n")}`);
  console.log(`\n${out.disclaimer}`);
}

main();
