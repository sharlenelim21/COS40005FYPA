const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const ACDC_DIR = path.resolve(__dirname, "../data/acdc");
const MAPPING_PATH = path.join(ACDC_DIR, "pilot_segmentation_projects.json");
const MONGODB_URI = "mongodb://admin:P%40ssw0rd123%21@localhost:27017/visheart?authSource=admin&directConnection=true";

const BATCH_2_PATIENT_IDS = [
  "patient006", "patient007", "patient008", "patient009", "patient010",
  "patient026", "patient027", "patient028", "patient029", "patient030",
  "patient046", "patient047", "patient048", "patient049", "patient050",
  "patient066", "patient067", "patient068", "patient069", "patient070",
  "patient086", "patient087", "patient088", "patient089", "patient090",
];

async function main() {
  const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, "utf8"));
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  let brokenCount = 0;
  const broken = [];
  for (const pid of BATCH_2_PATIENT_IDS) {
    const entry = mapping.patients.find((p) => p.patientId === pid);
    if (!entry || !entry.projectId) { console.log(`${pid}: not in mapping`); continue; }
    const proj = await db.collection("projects").findOne({ _id: new mongoose.Types.ObjectId(entry.projectId) });
    if (!proj || !proj.affineMatrix) { console.log(`${pid}: no project/affine found`); continue; }
    const a = proj.affineMatrix;
    const dx = Math.sqrt(a[0][0] ** 2 + a[1][0] ** 2 + a[2][0] ** 2);
    const dz = Math.sqrt(a[0][2] ** 2 + a[1][2] ** 2 + a[2][2] ** 2);
    const isBroken = dx < 1.01 && dx > 0.99;
    if (isBroken) { brokenCount++; broken.push(pid); }
    console.log(`${pid}: dx=${dx.toFixed(4)} dz=${dz.toFixed(4)} ${isBroken ? "BROKEN" : "ok"}`);
  }
  console.log(`\n${brokenCount}/${BATCH_2_PATIENT_IDS.length} broken: ${broken.join(", ")}`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
