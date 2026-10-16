/**
 * patch_broken_affine_pilot_projects.js
 * =======================================
 * One-off fix for the 8 pilot projects that were uploaded BEFORE
 * extract_metadata.py's affine fix (2026-10) existed, so their stored
 * `affineMatrix` is still the old unit-scale (broken) value. Recomputes the
 * correct affine fresh from each patient's local source file (same helper
 * derive_system_reference_ranges.js uses) and patches it directly into
 * MongoDB via a raw driver update — no REST route for this exists, project
 * metadata is written once at upload time and not meant to be edited
 * through the API afterward.
 *
 * Scope: ONLY updates the `affineMatrix` field on these 8 known-affected
 * projects. Does not touch segmentation masks, heartMetrics, or anything
 * else — those get recomputed fresh (correctly) the next time the app
 * triggers heart metrics/bullseye for these projects.
 *
 * Usage:
 *   node scripts/patch_broken_affine_pilot_projects.js
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const mongoose = require("mongoose");

const ACDC_DIR = path.resolve(__dirname, "../data/acdc");
const MAPPING_PATH = path.join(ACDC_DIR, "pilot_segmentation_projects.json");
const PY_DIR = path.join(__dirname, "..", "src", "python");
// directConnection=true: the replica set's own member list is registered
// under the internal Docker hostname "mongodb", which doesn't resolve from
// the host -- this skips replica-set topology discovery and connects
// straight to the given host/port instead of re-resolving via rs0's members.
const MONGODB_URI = "mongodb://admin:P%40ssw0rd123%21@localhost:27017/visheart?authSource=admin&directConnection=true";

// Confirmed broken (unit-scale affine) via direct check against all 25 batch-1 pilot projects, 2026-10.
const BATCH_1_AFFECTED_PATIENT_IDS = ["patient041", "patient043", "patient045", "patient081", "patient082", "patient083", "patient084", "patient085"];
// Confirmed broken via scripts/check_batch2_affines.js against all 25 batch-2 pilot projects, 2026-10.
// Same root cause as batch 1 -- NOT re-introduced by a regression; the real bug (nifti_parser.ts
// pointing at a stale dist/python copy instead of the live src/python bind mount, see that file's
// own comment) was still live when batch 2 was uploaded, only fixed after this list was collected.
const BATCH_2_AFFECTED_PATIENT_IDS = ["patient009", "patient010", "patient046", "patient047", "patient048", "patient068", "patient069", "patient070", "patient086", "patient087", "patient088", "patient089", "patient090"];
const AFFECTED_PATIENT_IDS = [...BATCH_1_AFFECTED_PATIENT_IDS, ...BATCH_2_AFFECTED_PATIENT_IDS];

function extractLocalAffine(patientId) {
  const scriptPath = path.join(PY_DIR, "extract_metadata.py");
  const niftiPath = path.join(ACDC_DIR, "training", patientId, `${patientId}_4d.nii.gz`);
  const res = spawnSync("py", ["-3", scriptPath, niftiPath], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (!res.stdout || !res.stdout.trim()) {
    throw new Error(`extract_metadata.py produced no output for ${patientId}. stderr: ${(res.stderr || "").slice(0, 500)}`);
  }
  const result = JSON.parse(res.stdout);
  if (result.error) throw new Error(`extract_metadata.py reported: ${result.error}`);
  return result.affineMatrix;
}

async function main() {
  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf8"));
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB.\n");

  const db = mongoose.connection.db;
  let patched = 0;

  for (const patientId of AFFECTED_PATIENT_IDS) {
    const entry = mapping.patients.find((p) => p.patientId === patientId);
    if (!entry || !entry.projectId) {
      console.log(`  ${patientId}: skipped — not in mapping`);
      continue;
    }
    const correctedAffine = extractLocalAffine(patientId);
    const dx = Math.sqrt(correctedAffine[0][0] ** 2 + correctedAffine[1][0] ** 2 + correctedAffine[2][0] ** 2);

    const result = await db.collection("projects").updateOne(
      { _id: new mongoose.Types.ObjectId(entry.projectId) },
      { $set: { affineMatrix: correctedAffine } },
    );
    console.log(`  ${patientId} (project ${entry.projectId}): dx=${dx.toFixed(4)} matched=${result.matchedCount} modified=${result.modifiedCount}`);
    if (result.modifiedCount > 0 || result.matchedCount > 0) patched++;
  }

  console.log(`\n${patched}/${AFFECTED_PATIENT_IDS.length} projects patched.`);
  console.log("\nNext: re-trigger heart metrics / bullseye / disease pattern gates for these");
  console.log("8 projects in the app (or via their trigger-* routes) so the stored results");
  console.log("reflect the corrected affine — the old ones computed from the broken affine");
  console.log("are still sitting in heartMetrics/diseasePatternGates until recomputed.");

  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
