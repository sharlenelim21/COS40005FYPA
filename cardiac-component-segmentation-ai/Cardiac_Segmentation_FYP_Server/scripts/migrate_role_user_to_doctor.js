// One-off migration for the ORIGINAL Admin/Doctor/Clinical Assistant RBAC redesign pass.
// Renames every user document's role value "user" -> "doctor" (same capabilities, new label).
//
// SUPERSEDED NOTE (educational-role + elevation-approval redesign): the role enum changed again
// after this script was written — "user" no longer exists at all; the restricted/default role is
// now "educational_user", and the value "doctor" means something DIFFERENT (an elevated, approved
// role) than it did when this script was written. A document with the literal string "user" at
// this point could be either (a) a true legacy account that predates ALL of this session's
// changes (wants "doctor" — this script's original intent), or (b) an account someone manually
// set to the short-lived mid-session "educational" role (wants "educational_user" instead) — the
// two are indistinguishable from the stored data alone. With only a couple of accounts in this
// dev database, the safer move is to leave this script alone and just set each account's role
// explicitly via /admin/user-management, rather than guessing here.
//
// Usage (only if you're sure every remaining role:"user" account is a true legacy/pre-session
// account): node scripts/migrate_role_user_to_doctor.js [--dry-run]
const mongoose = require("mongoose");
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/visheart";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;

  const matching = await db.collection("users").countDocuments({ role: "user" });
  console.log(`Found ${matching} user document(s) with role "user".`);

  if (matching === 0) {
    console.log("Nothing to migrate.");
  } else if (dryRun) {
    console.log("--dry-run: no changes made.");
  } else {
    const result = await db.collection("users").updateMany({ role: "user" }, { $set: { role: "doctor" } });
    console.log(`Updated ${result.modifiedCount} document(s): role "user" -> "doctor".`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
