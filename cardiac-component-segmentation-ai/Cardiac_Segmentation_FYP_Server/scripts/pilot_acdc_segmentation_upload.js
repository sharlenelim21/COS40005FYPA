/**
 * pilot_acdc_segmentation_upload.js
 * ==================================
 * Pilot batch for the "system-derived (model-predicted, manually QC'd)
 * reference range" approach: uploads a subset of ACDC Challenge training
 * patients' raw 4D cine NIfTIs into this app as real projects, under one
 * guest session, and triggers UNet segmentation on each — using the exact
 * same HTTP routes the frontend itself uses (PUT /project/upload-new-project,
 * POST /segmentation/start-segmentation/:projectId), not a shortcut.
 *
 * After this script finishes, the masks exist as normal projects in the app
 * and need the MANUAL step this script cannot do for you: open each one in
 * the UI, look at the segmentation (ED/ES at minimum), and correct anything
 * missing (e.g. a dropped RV or myocardium region on some slice) with the
 * brush tools, same as any real project. Only after that manual QC pass is
 * done should reference ranges be derived from these masks — deriving from
 * uncorrected model output would just be measuring the model's own
 * mistakes, not "what this pipeline + its intended correction workflow
 * actually produces."
 *
 * Writes patient->projectId->jobId mapping to
 * data/acdc/pilot_segmentation_projects.json so a later script can look up
 * each project once QC is done.
 *
 * Usage:
 *   node scripts/pilot_acdc_segmentation_upload.js
 *
 * Config via env vars (all optional):
 *   VISHEART_BASE_URL   default http://localhost:5000
 *   ACDC_DIR             default ../data/acdc (relative to this script)
 */

const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.VISHEART_BASE_URL || "http://localhost:5000";
const ACDC_DIR = path.resolve(__dirname, process.env.ACDC_DIR || "../data/acdc");
const TRAINING_DIR = path.join(ACDC_DIR, "training");
const CSV_PATH = path.join(ACDC_DIR, "training_info.csv");
const OUT_PATH = path.join(ACDC_DIR, "pilot_segmentation_projects.json");

// First 5 patients per group, by lowest numeric ID — deterministic, matches
// ACDC's own contiguous per-group ID blocks (DCM 1-20, HCM 21-40, MINF
// 41-60, NOR 61-80, RV 81-100).
const PILOT_PATIENT_IDS = [
  "patient001", "patient002", "patient003", "patient004", "patient005", // DCM
  "patient021", "patient022", "patient023", "patient024", "patient025", // HCM
  "patient041", "patient042", "patient043", "patient044", "patient045", // MINF
  "patient061", "patient062", "patient063", "patient064", "patient065", // NOR
  "patient081", "patient082", "patient083", "patient084", "patient085", // RV
];

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

async function postJson(cookie, pathname, body) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, cookie: res.headers.get("set-cookie"), json };
}

async function getJson(cookie, pathname) {
  const res = await fetch(`${BASE_URL}${pathname}`, { headers: { Cookie: cookie } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function guestLogin() {
  const res = await fetch(`${BASE_URL}/auth/guest`, { method: "POST" });
  const setCookie = res.headers.get("set-cookie");
  const json = await res.json();
  if (!res.ok || !json.login) throw new Error(`Guest login failed: ${res.status} ${JSON.stringify(json)}`);
  // Keep only the cookie pair itself (strip Path/HttpOnly/etc attributes) for reuse in later requests.
  const cookie = setCookie.split(";")[0];
  console.log(`Guest login OK — username=${json.username}`);
  return cookie;
}

// Dedicated persistent account for this pilot batch — NOT a guest login.
// Guest-owned projects are deleted on logout/session expiry and aren't
// visible under the user's own normal login, so they can't actually be
// opened for the manual QC/correction pass this whole exercise needs
// (confirmed live, 2026-10, after the first guest-session run succeeded
// but left projects the user couldn't reach). Registering a real account
// once and reusing it keeps the projects around indefinitely.
const PILOT_USERNAME = "acdc_pilot";
const PILOT_PASSWORD = "AcdcPilot2026!";
const PILOT_EMAIL = "acdc.pilot@example.com";
const PILOT_PHONE = "0123456789";

async function registerAndLogin() {
  const regRes = await fetch(`${BASE_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: PILOT_USERNAME, password: PILOT_PASSWORD, email: PILOT_EMAIL, phone: PILOT_PHONE }),
  });
  const regJson = await regRes.json().catch(() => ({}));
  if (regRes.ok) {
    console.log(`Registered new account "${PILOT_USERNAME}".`);
  } else {
    console.log(`Register returned ${regRes.status} (${JSON.stringify(regJson)}) — assuming it already exists, proceeding to login.`);
  }

  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: PILOT_USERNAME, password: PILOT_PASSWORD }),
  });
  const setCookie = loginRes.headers.get("set-cookie");
  const loginJson = await loginRes.json();
  if (!loginRes.ok || !loginJson.login) {
    throw new Error(`Login as ${PILOT_USERNAME} failed: ${loginRes.status} ${JSON.stringify(loginJson)}`);
  }
  console.log(`Logged in as "${PILOT_USERNAME}" — username=${loginJson.username}`);
  return setCookie.split(";")[0];
}

async function uploadProject(cookie, patientId, filePath) {
  const bytes = fs.readFileSync(filePath);
  const form = new FormData();
  form.append("files", new Blob([bytes]), `${patientId}_4d.nii.gz`);
  form.append("name", `ACDC_${patientId}`);
  form.append("description", `ACDC Challenge training patient ${patientId} — pilot system-derived reference range batch.`);

  const res = await fetch(`${BASE_URL}/project/upload-new-project`, {
    method: "PUT",
    headers: { Cookie: cookie },
    body: form,
  });
  const json = await res.json();
  if (!res.ok || !json.projects || !json.projects[0]) {
    throw new Error(`Upload failed for ${patientId}: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.projects[0].projectId || json.projects[0].id;
}

async function triggerSegmentation(cookie, projectId) {
  const { status, json } = await postJson(cookie, `/segmentation/start-segmentation/${projectId}`, {
    segmentationModel: "unet",
    deviceType: "auto",
  });
  if (status === 409) {
    console.log(`  (job already running for ${projectId}, reusing: ${json.jobUuid})`);
    return json.jobUuid;
  }
  if (status !== 200 || !json.uuid) {
    throw new Error(`Segmentation trigger failed for ${projectId}: ${status} ${JSON.stringify(json)}`);
  }
  return json.uuid;
}

async function projectHasMasks(cookie, projectId) {
  const { json } = await getJson(cookie, `/segmentation/segmentation-results/${projectId}`);
  return Array.isArray(json.segmentations) && json.segmentations.length > 0;
}

async function pollUntilDone(cookie, pending, { intervalMs = 10000, maxAttempts = 90 } = {}) {
  // pending: array of {patientId, projectId, jobId}, mutated in place as entries complete.
  //
  // Completion is decided SOLELY by /segmentation/segmentation-results/:projectId
  // (masks exist or they don't) — never by /segmentation/user-check-jobs, which
  // only returns the current user's last 20 jobs. Confirmed live (2026-10): in a
  // 25-job batch under one guest session, the first 5 submitted fell off that
  // list once the other 20 were created, and were wrongly reported as "timeout"
  // even though they'd already completed (maskCount=2 each) — direct per-project
  // checks found all 25 had actually finished. user-check-jobs is still polled
  // below, but ONLY for progress%/failure visibility, never to decide done-ness.
  const remaining = new Map(pending.map((p) => [p.projectId, p]));
  for (let attempt = 0; attempt < maxAttempts && remaining.size > 0; attempt++) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const checks = await Promise.all(
      [...remaining.entries()].map(async ([projectId, entry]) => [projectId, entry, await projectHasMasks(cookie, projectId)]),
    );
    for (const [projectId, entry, hasMasks] of checks) {
      if (hasMasks) {
        entry.status = "completed";
        remaining.delete(projectId);
        console.log(`  [COMPLETED] ${entry.patientId} (project ${projectId})`);
      }
    }
    if (remaining.size === 0) break;

    // Best-effort progress/failure visibility only — see note above.
    const { json } = await getJson(cookie, "/segmentation/user-check-jobs");
    for (const job of json.jobs || []) {
      const entry = remaining.get(job.projectId);
      if (!entry) continue;
      if (job.status === "failed") {
        entry.status = "failed";
        entry.message = job.message;
        remaining.delete(job.projectId);
        console.log(`  [FAILED] ${entry.patientId} (project ${job.projectId}): ${job.message}`);
      } else {
        console.log(`  ...${entry.patientId}: ${job.status}${job.progress != null ? ` (${job.progress}%)` : ""}`);
      }
    }
  }
  for (const entry of remaining.values()) {
    entry.status = "timeout";
    console.log(`  [TIMEOUT] ${entry.patientId} (project ${entry.projectId}) — still not complete after polling window`);
  }
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) throw new Error(`CSV not found: ${CSV_PATH}`);
  const rows = parseCsv(fs.readFileSync(CSV_PATH, "utf8"));
  const byId = Object.fromEntries(rows.map((r) => [r.PatientID, r]));

  const cookie = await registerAndLogin();

  const pending = [];
  console.log(`\nUploading ${PILOT_PATIENT_IDS.length} patients...`);
  for (const pid of PILOT_PATIENT_IDS) {
    const row = byId[pid];
    if (!row) { console.log(`  ${pid}: skipped — not found in CSV`); continue; }
    const filePath = path.join(TRAINING_DIR, pid, `${pid}_4d.nii.gz`);
    if (!fs.existsSync(filePath)) { console.log(`  ${pid}: skipped — ${filePath} not found`); continue; }

    try {
      const projectId = await uploadProject(cookie, pid, filePath);
      const jobId = await triggerSegmentation(cookie, projectId);
      console.log(`  ${pid} (${row.Group}): project=${projectId} job=${jobId}`);
      pending.push({ patientId: pid, group: row.Group, projectId, jobId, status: "pending" });
    } catch (err) {
      console.log(`  ${pid}: ERROR — ${err.message}`);
      pending.push({ patientId: pid, group: row.Group, projectId: null, jobId: null, status: "error", message: err.message });
    }
  }

  const toPoll = pending.filter((p) => p.jobId);
  console.log(`\nPolling ${toPoll.length} segmentation jobs (this can take a while)...`);
  await pollUntilDone(cookie, toPoll);

  // Note: the session cookie itself is deliberately NOT persisted here (it's
  // a live credential) — re-run registerAndLogin() (or log in as
  // PILOT_USERNAME in the app) to get a fresh one.
  fs.writeFileSync(OUT_PATH, JSON.stringify({ generated_at: new Date().toISOString(), account: PILOT_USERNAME, patients: pending }, null, 2));
  console.log(`\nWrote mapping to ${OUT_PATH}`);
  console.log("\nNext step (MANUAL, cannot be scripted): open each project in the app, review the");
  console.log("segmentation (ED/ES at minimum) and brush-correct anything missing (dropped RV/");
  console.log("myocardium region on any slice) before deriving reference ranges from these masks.");
}

main().catch((err) => { console.error(err); process.exit(1); });
