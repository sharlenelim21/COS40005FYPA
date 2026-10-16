/**
 * retrigger_heart_metrics_batch2.js
 * ===================================
 * Re-triggers heart-metrics/bullseye/disease-pattern-gates recompute for the
 * 13 batch-2 pilot projects whose stored affineMatrix was just corrected by
 * patch_broken_affine_pilot_projects.js, so their stored heartMetrics stop
 * reflecting the old broken (unit-scale) affine.
 */
const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.VISHEART_BASE_URL || "http://localhost:5000";
const ACDC_DIR = path.resolve(__dirname, "../data/acdc");
const MAPPING_PATH = path.join(ACDC_DIR, "pilot_segmentation_projects.json");

const PILOT_USERNAME = "acdc_pilot";
const PILOT_PASSWORD = "AcdcPilot2026!";

const PATIENT_IDS = ["patient009", "patient010", "patient046", "patient047", "patient048", "patient068", "patient069", "patient070", "patient086", "patient087", "patient088", "patient089", "patient090"];

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

async function postJson(cookie, pathname) {
  const res = await fetch(`${BASE_URL}${pathname}`, { method: "POST", headers: { Cookie: cookie } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function main() {
  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf8"));
  const cookie = await login();
  console.log(`Logged in as ${PILOT_USERNAME}\n`);

  for (const pid of PATIENT_IDS) {
    const entry = mapping.patients.find((p) => p.patientId === pid);
    if (!entry || !entry.projectId) { console.log(`${pid}: not in mapping, skipped`); continue; }

    const { status: segStatus, json: segRes } = await getJson(cookie, `/segmentation/segmentation-results/${entry.projectId}`);
    if (segStatus !== 200 || !Array.isArray(segRes.segmentations)) {
      console.log(`${pid}: could not fetch segmentation results (${segStatus})`);
      continue;
    }
    const editableDoc = segRes.segmentations.find((d) => d.isMedSAMOutput === false);
    if (!editableDoc) { console.log(`${pid}: no editable mask doc found`); continue; }

    const { status, json } = await postJson(cookie, `/segmentation/trigger-heart-metrics/${editableDoc._id}`);
    console.log(`${pid} (mask ${editableDoc._id}): trigger -> ${status} ${JSON.stringify(json).slice(0, 150)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
