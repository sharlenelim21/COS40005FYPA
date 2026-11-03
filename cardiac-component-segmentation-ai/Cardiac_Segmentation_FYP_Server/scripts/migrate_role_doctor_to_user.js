// One-off migration for the Admin/User/Guest role simplification (2026-10): renames every user
// document's role value "doctor" -> "user" (same capabilities, new label — UserRole.Doctor was
// renamed to UserRole.User in database_types.ts). The EducationalUser role was already fully
// dead by this point (no account could have it), so there is nothing to migrate for it.
//
// NOTE: this coincidentally lands on the same string ("user") that scripts/migrate_role_user_to_doctor.js
// used YEARS earlier for an unrelated, since-superseded role meaning. This script is not a revert
// of that one — it's a fresh rename of what is today's "doctor" role.
//
// Usage: node scripts/migrate_role_doctor_to_user.js [--dry-run]
const mongoose = require("mongoose");
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/visheart";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  const matching = await db.collection("users").countDocuments({ role: "doctor" });
  console.log(`Found ${matching} user document(s) with role "doctor".`);

  if (matching === 0) {
    console.log("Nothing to migrate.");
  } else if (dryRun) {
    console.log("--dry-run: no changes made.");
  } else {
    const result = await db.collection("users").updateMany({ role: "doctor" }, { $set: { role: "user" } });
    console.log(`Updated ${result.modifiedCount} document(s): role "doctor" -> "user".`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
