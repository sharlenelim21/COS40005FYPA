const mongoose = require("mongoose");
const MONGODB_URI = "mongodb://admin:P%40ssw0rd123%21@localhost:27017/visheart?authSource=admin&directConnection=true";

const IDS = ["6a13d29ca5405a2378a86477", "6a2574f3a83113fe00cc35e3", "6ac9a97c8cdc99e5859a3ae1"];

async function main() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db;
  for (const id of IDS) {
    const proj = await db.collection("projects").findOne({ _id: new mongoose.Types.ObjectId(id) });
    if (!proj) { console.log(`${id}: not found`); continue; }
    const user = await db.collection("users").findOne({ _id: proj.userid });
    console.log(`${id}  name=${proj.name}  owner=${user ? user.username : proj.userid}  createdAt=${proj.createdAt || proj.uploadedAt || "?"}`);
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
