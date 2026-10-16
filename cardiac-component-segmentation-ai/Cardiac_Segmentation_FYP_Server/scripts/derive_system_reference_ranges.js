/**
 * derive_system_reference_ranges.js
 * ===================================
 * Phase 2 of the ACDC reference-range derivation: computes NOR/MINF/DCM/
 * HCM/RV statistics from this project's OWN segmentation model's output
 * (UNet), AFTER manual QC/correction in the app — the "system-derived"
 * complement to derive_acdc_reference_ranges.py's ground-truth-derived
 * numbers. Pulls each pilot patient's CURRENT editable mask doc
 * (isMedSAMOutput: false — confirmed via segmentation_routes.ts's own
 * "No editable (isMedSAMOutput: false) segmentation mask found" comment)
 * straight from the live app's database via its real HTTP API, then feeds
 * it through the EXACT SAME compute_heart_metrics_from_rle.py /
 * compute_bullseye_from_rle.py scripts the backend itself uses — same
 * pattern as pilot_acdc_segmentation_upload.js (session-cookie auth, no
 * shortcuts).
 *
 * Prerequisites:
 *   - pilot_acdc_segmentation_upload.js already run (creates the 25
 *     ACDC_patientXXX projects under the acdc_pilot account and writes
 *     data/acdc/pilot_segmentation_projects.json)
 *   - Manual QC/correction pass done in the app for each project
 *
 * Usage:
 *   node scripts/derive_system_reference_ranges.js
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const BASE_URL = process.env.VISHEART_BASE_URL || "http://localhost:5000";
const ACDC_DIR = path.resolve(__dirname, process.env.ACDC_DIR || "../data/acdc");
const CSV_PATH = path.join(ACDC_DIR, "training_info.csv");
const MAPPING_PATH = path.join(ACDC_DIR, "pilot_segmentation_projects.json");
const PY_DIR = path.join(__dirname, "..", "src", "python");

const PILOT_USERNAME = "acdc_pilot";
const PILOT_PASSWORD = "AcdcPilot2026!";

const GROUPS = ["NOR", "MINF", "DCM", "HCM", "RV"];
const FEATURES = ["EF", "EDVI", "LVMI", "MaxWallThicknessMm", "RVEDVI", "RVEF", "RVESVI"];

function parseCsv(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i]; });
    return row;
  });
}

function mostellerBsa(heightCm, weightKg) {
  return Math.sqrt((heightCm * weightKg) / 3600.0);
}

async function login() {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: PILOT_USERNAME, password: PILOT_PASSWORD }),
  });
  const setCookie = res.headers.get("set-cookie");
  const json = await res.json();
  if (!res.ok || !json.login) throw new Error(`Login failed: ${res.status} ${JSON.stringify(json)}`);
  return setCookie.split(";")[0];
}

async function getJson(cookie, pathname) {
  const res = await fetch(`${BASE_URL}${pathname}`, { headers: { Cookie: cookie } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

function runPython(scriptName, payload) {
  const scriptPath = path.join(PY_DIR, scriptName);
  const res = spawnSync("py", ["-3", scriptPath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
  });
  if (!res.stdout || !res.stdout.trim()) {
    throw new Error(`${scriptName} produced no output. stderr: ${(res.stderr || "").slice(0, 500)}`);
  }
  const result = JSON.parse(res.stdout);
  if (result.error) throw new Error(`${scriptName} reported: ${result.error}`);
  return result;
}

function extractLocalAffine(patientId) {
  // Recompute the affine FRESH from the original local file, rather than
  // trusting the project's stored affineMatrix -- confirmed live (2026-10)
  // that extract_metadata.py's affine (before today's fix) could be
  // silently wrong for some NIfTI files (unit-scale sform, no real spacing),
  // which was still the value stored for these pilot projects at upload
  // time. Re-running the now-fixed script against the source file sidesteps
  // needing to patch 25 already-stored project documents just to get
  // correct research numbers.
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

function summarize(values) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return {
    n,
    mean: Math.round(mean * 100) / 100,
    sd: Math.round(sd * 100) / 100,
    min: Math.round(Math.min(...values) * 100) / 100,
    max: Math.round(Math.max(...values) * 100) / 100,
  };
}

async function processPatient(cookie, patientId, projectId, row) {
  const ed0 = parseInt(row.ED, 10) - 1; // CSV's ED/ES are 1-indexed (matches _frameNN.nii.gz naming); stored frameindex is 0-indexed.
  const es0 = parseInt(row.ES, 10) - 1;
  const bsaM2 = mostellerBsa(parseFloat(row.Height), parseFloat(row.Weight));

  const { status: infoStatus, json: info } = await getJson(cookie, `/project/get-project-info/${projectId}`);
  if (infoStatus !== 200 || !info.project) {
    console.log(`  ${patientId}: skipped — project info fetch failed (${infoStatus})`);
    return null;
  }
  const { width, height } = info.project.dimensions || {};
  const affine = extractLocalAffine(patientId);
  if (!width || !height || !affine) {
    console.log(`  ${patientId}: skipped — missing dimensions/affine`);
    return null;
  }

  const { status: segStatus, json: segRes } = await getJson(cookie, `/segmentation/segmentation-results/${projectId}`);
  if (segStatus !== 200 || !Array.isArray(segRes.segmentations)) {
    console.log(`  ${patientId}: skipped — segmentation-results fetch failed (${segStatus})`);
    return null;
  }
  const editableDoc = segRes.segmentations.find((d) => d.isMedSAMOutput === false && d.segmentationModel === "unet")
    ?? segRes.segmentations.find((d) => d.isMedSAMOutput === false);
  if (!editableDoc || !Array.isArray(editableDoc.frames) || editableDoc.frames.length === 0) {
    console.log(`  ${patientId}: skipped — no editable UNet mask doc with frames found`);
    return null;
  }

  let hm;
  try {
    hm = runPython("compute_heart_metrics_from_rle.py", {
      frames: editableDoc.frames, width, height, affine,
      ed_frame: ed0, es_frame: es0, bsa_m2: bsaM2,
    });
  } catch (err) {
    console.log(`  ${patientId}: skipped — heart metrics failed: ${err.message}`);
    return null;
  }

  // ED frame ONLY for wall thickness -- build_mask_3d (compute_bullseye_from_rle.py)
  // keys purely by sliceindex and ignores frameindex, so ED+other frames together would merge.
  const edFrameEntry = editableDoc.frames.find((f) => f.frameindex === ed0);
  let maxWallMm = null;
  if (edFrameEntry) {
    try {
      const bullseye = runPython("compute_bullseye_from_rle.py", { frames: [edFrameEntry], width, height });
      const dx = hm.spacing_mm?.[0];
      const vals = (bullseye.segment_values || []).filter((v) => typeof v === "number" && Number.isFinite(v));
      if (vals.length && typeof dx === "number") {
        maxWallMm = Math.max(...vals) * dx; // pixels -> mm, same conversion as assembleDiseasePatternGateInputs
      }
    } catch (err) {
      console.log(`  ${patientId}: wall thickness unavailable (${err.message})`);
    }
  }

  const meas = hm.measurements || {};
  const bsaOk = bsaM2 > 0;
  return {
    EF: meas.EF ?? null,
    EDVI: hm.LVEDVI ?? null,
    LVMI: (hm.LV_mass_g != null && bsaOk) ? hm.LV_mass_g / bsaM2 : null,
    MaxWallThicknessMm: maxWallMm,
    RVEDVI: hm.RVEDVI ?? null,
    RVEF: hm.RVEF ?? null,
    RVESVI: hm.RVESVI ?? null,
  };
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`CSV not found: ${CSV_PATH}`);
  if (!fs.existsSync(MAPPING_PATH)) throw new Error(`Mapping not found: ${MAPPING_PATH} — run pilot_acdc_segmentation_upload.js first`);

  const csvById = Object.fromEntries(parseCsv(fs.readFileSync(CSV_PATH, "utf8")).map((r) => [r.PatientID, r]));
  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf8"));

  const cookie = await login();
  console.log(`Logged in as ${PILOT_USERNAME}\n`);

  const byGroup = Object.fromEntries(GROUPS.map((g) => [g, []]));
  let skipped = 0;

  for (const p of mapping.patients) {
    if (!p.projectId) { skipped++; continue; }
    const row = csvById[p.patientId];
    if (!row) { console.log(`  ${p.patientId}: skipped — not in CSV`); skipped++; continue; }

    const features = await processPatient(cookie, p.patientId, p.projectId, row);
    if (!features) { skipped++; continue; }
    byGroup[row.Group].push(features);
    console.log(`  ${p.patientId} (${row.Group}): EF=${features.EF?.toFixed?.(1)} EDVI=${features.EDVI?.toFixed?.(1)} ` +
      `LVMI=${features.LVMI?.toFixed?.(1)} wall=${features.MaxWallThicknessMm?.toFixed?.(1)} ` +
      `RVEDVI=${features.RVEDVI?.toFixed?.(1)} RVEF=${features.RVEF?.toFixed?.(1)}`);
  }

  console.log(`\n${mapping.patients.length - skipped} processed, ${skipped} skipped\n`);
  console.log("=".repeat(72));
  console.log("System-derived reference statistics — UNet + manual QC/correction");
  console.log("=".repeat(72));

  const stats = {};
  for (const group of GROUPS) {
    const rows = byGroup[group];
    console.log(`\n${group} (n=${rows.length}):`);
    stats[group] = {};
    for (const feat of FEATURES) {
      const vals = rows.map((r) => r[feat]).filter((v) => typeof v === "number" && Number.isFinite(v));
      if (!vals.length) { console.log(`  ${feat}: NO DATA`); continue; }
      const s = summarize(vals);
      stats[group][feat] = s;
      console.log(`  ${feat.padEnd(20)} n=${String(s.n).padStart(2)}  mean=${String(s.mean).padStart(7)}  sd=${String(s.sd).padStart(6)}  range=(${s.min}-${s.max})`);
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log("Raw JSON");
  console.log("=".repeat(72));
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
