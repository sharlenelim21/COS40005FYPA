// One-off migration for the View/Run assignment-mode redesign.
//
// Before this feature, `projects.assignedAssistants` was a plain array of assistant user-ID
// strings: ["<assistantId>", ...]. The new schema expects an array of objects:
// [{ userId, mode, instructions, assignedByUserId, assignedAt }, ...]. Any project shared BEFORE
// this feature shipped still has the old raw-string shape sitting in MongoDB, and Mongoose's
// schema casting on read can behave inconsistently with it (silently drop fields, miscast, or
// throw) — this is the likely cause of "View Only shows as Can Run" and "view-only/already-run
// pages mysteriously re-running" for any project shared before today.
//
// This script finds every project whose assignedAssistants array contains a raw string (not an
// object) and rewrites those entries to the new shape with mode: "run" (preserving the original
// behavior — pre-this-feature shares always had full run access) and assignedAt backdated to the
// project's own createdAt so it doesn't look newer than it is.
//
// Usage: node scripts/migrate_assigned_assistants_shape.js [--dry-run]
const mongoose = require("mongoose");
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/visheart";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  const projects = await db.collection("projects").find({ assignedAssistants: { $exists: true, $ne: [] } }).toArray();
  console.log(`Found ${projects.length} project(s) with a non-empty assignedAssistants array.`);

  let fixedCount = 0;
  for (const project of projects) {
    const raw = project.assignedAssistants || [];
    const hasLegacyString = raw.some((entry) => typeof entry === "string");
    if (!hasLegacyString) continue;

    const normalized = raw.map((entry) => {
      if (typeof entry === "string") {
        return {
          userId: entry,
          mode: "run",
          assignedByUserId: project.userid,
          assignedAt: (project.createdAt || new Date()).toISOString ? (project.createdAt || new Date()).toISOString() : new Date().toISOString(),
        };
      }
      return entry;
    });

    console.log(`Project ${project._id} (${project.name}): ${raw.length} entries, ${raw.filter((e) => typeof e === "string").length} legacy string entries -> normalized.`);
    fixedCount++;

    if (!dryRun) {
      await db.collection("projects").updateOne({ _id: project._id }, { $set: { assignedAssistants: normalized } });
    }
  }

  console.log(dryRun ? `--dry-run: would fix ${fixedCount} project(s).` : `Fixed ${fixedCount} project(s).`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
