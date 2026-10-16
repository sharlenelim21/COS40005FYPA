/**
 * scan_all_projects_affine.js
 * ============================
 * One-off sweep: checks EVERY project in the database (not just the ACDC
 * pilot batch) for the unit-scale-affine bug (root-caused and fixed in
 * nifti_parser.ts + extract_metadata.py, 2026-10 — see those files' own
 * comments). Reports which projects are affected and whether their original
 * source file is still reachable locally (needed to recompute a corrected
 * affine) or only in S3/MinIO (needs a different recovery path).
 *
 * Read-only. Does not modify anything.
 *
 * Usage:
 *   node scripts/scan_all_projects_affine.js
 */
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const MONGODB_URI = "mongodb://admin:P%40ssw0rd123%21@localhost:27017/visheart?authSource=admin&directConnection=true";

function isBrokenAffine(affineMatrix) {
  if (!Array.isArray(affineMatrix) || affineMatrix.length < 3) return null; // no data
  const a = affineMatrix;
  const dx = Math.sqrt((a[0][0] ?? 0) ** 2 + (a[1][0] ?? 0) ** 2 + (a[2][0] ?? 0) ** 2);
  return dx > 0.99 && dx < 1.01;
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  const projects = await db.collection("projects").find({}).toArray();
  console.log(`${projects.length} total projects in the database.\n`);

  let brokenCount = 0, okCount = 0, noAffineCount = 0;
  const brokenLocal = [];
  const brokenNoLocal = [];

  for (const p of projects) {
    const broken = isBrokenAffine(p.affineMatrix);
    if (broken === null) { noAffineCount++; continue; }
    if (!broken) { okCount++; continue; }
    brokenCount++;
    const localPath = p.originalfilepath || p.basepath || null;
    const existsLocally = localPath ? fs.existsSync(localPath) : false;
    const entry = { id: p._id.toString(), name: p.name, localPath, existsLocally };
    if (existsLocally) brokenLocal.push(entry); else brokenNoLocal.push(entry);
  }

  console.log(`OK (plausible spacing): ${okCount}`);
  console.log(`No affineMatrix stored: ${noAffineCount}`);
  console.log(`BROKEN (unit-scale): ${brokenCount}`);
  console.log(`  - recoverable from local file: ${brokenLocal.length}`);
  console.log(`  - local file NOT found (needs S3 or re-upload): ${brokenNoLocal.length}\n`);

  console.log("Broken, recoverable locally:");
  for (const e of brokenLocal) console.log(`  ${e.id}  ${e.name}  -> ${e.localPath}`);
  console.log("\nBroken, NOT recoverable locally:");
  for (const e of brokenNoLocal) console.log(`  ${e.id}  ${e.name}  -> ${e.localPath || "(no path stored)"}`);

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
