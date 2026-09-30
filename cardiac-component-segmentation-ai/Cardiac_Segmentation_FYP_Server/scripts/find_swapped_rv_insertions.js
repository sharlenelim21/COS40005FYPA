'use strict';

try { require('dotenv').config(); } catch {}
const mongoose = require('mongoose');

const DB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/visheart';
const projectFilter = process.argv[2] ? { projectid: String(process.argv[2]) } : {};

const yOf = (p) => (Array.isArray(p) ? p[1] : p && typeof p.y === 'number' ? p.y : null);
const fmt = (p) => {
  if (!p) return '—';
  const [x, y] = Array.isArray(p) ? p : [p.x, p.y];
  return `(${Number(x).toFixed(1)}, ${Number(y).toFixed(1)})`;
};
const isSwapped = (a, b) => {
  const ya = yOf(a);
  const yb = yOf(b);
  return ya !== null && yb !== null && ya > yb;
};

(async () => {
  await mongoose.connect(DB_URI);
  const db = mongoose.connection.db;
  const collName = (modelName) =>
    typeof mongoose.pluralize === 'function' && mongoose.pluralize()
      ? mongoose.pluralize()(modelName)
      : modelName.toLowerCase() + 's';

  const jobs = await db
    .collection(collName('Job'))
    .find(
      { ...projectFilter, model_used: /landmark/i, status: 'completed', result: { $exists: true, $ne: null } },
      { projection: { projectid: 1, uuid: 1, result: 1, updatedAt: 1, createdAt: 1 } },
    )
    .sort({ projectid: 1, updatedAt: -1, createdAt: -1 })
    .toArray();

  console.log(`\n=== Landmark jobs (${jobs.length} completed) ===`);
  const seenProjects = new Set();
  let jobHits = 0;
  for (const job of jobs) {
    const latest = !seenProjects.has(job.projectid);
    seenProjects.add(job.projectid);

    let r = job.result;
    if (typeof r === 'string') {
      try { r = JSON.parse(r); } catch { continue; }
    }
    const rows = [];
    if (Array.isArray(r?.slices)) {
      for (const s of r.slices) {
        if (isSwapped(s.lm1, s.lm2)) {
          rows.push(`  slice ${s.slice}: lm1=${fmt(s.lm1)} lm2=${fmt(s.lm2)} flag=${s.flag ?? '—'} confidence=${s.confidence ?? '—'}`);
        }
      }
    } else if (Array.isArray(r?.predictions)) {
      for (const p of r.predictions) {
        if (isSwapped(p.rv_insertion_1, p.rv_insertion_2)) {
          rows.push(`  frame ${p.frame_id} slice ${p.slice_id ?? 0}: rv1=${fmt(p.rv_insertion_1)} rv2=${fmt(p.rv_insertion_2)}`);
        }
      }
    }
    const avgSwapped = isSwapped(r?.avg_lm1, r?.avg_lm2);
    if (!rows.length && !avgSwapped) continue;

    jobHits += rows.length;
    const total = r?.slices?.length ?? r?.predictions?.length ?? 0;
    console.log(
      `\nproject ${job.projectid}  job ${job.uuid ?? job._id}${latest ? '  (latest)' : ''}  ` +
      `updated ${job.updatedAt ? new Date(job.updatedAt).toISOString() : '—'}  ` +
      `${rows.length}/${total} slice(s) with lm1 below lm2`,
    );
    if (avgSwapped) console.log(`  avg_lm1=${fmt(r.avg_lm1)} is BELOW avg_lm2=${fmt(r.avg_lm2)}`);
    rows.forEach((line) => console.log(line));
  }
  if (!jobHits) console.log('  none found');

  const docs = await db
    .collection(collName('Project Landmarks'))
    .find({ ...projectFilter, isModelOutput: false }, { projection: { projectid: 1, name: 1, frames: 1, updatedAt: 1 } })
    .toArray();

  console.log(`\n=== Saved landmark docs (${docs.length}) ===`);
  let docHits = 0;
  for (const doc of docs) {
    const rows = [];
    for (const frame of doc.frames ?? []) {
      for (const slice of frame.slices ?? []) {
        const p1 = (slice.landmarks ?? []).find((p) => p.key === 'rv_insertion_1');
        const p2 = (slice.landmarks ?? []).find((p) => p.key === 'rv_insertion_2');
        if (isSwapped(p1, p2)) {
          rows.push(`  frame ${frame.frameindex} slice ${slice.sliceindex}: rv1=${fmt(p1)} rv2=${fmt(p2)}`);
        }
      }
    }
    if (!rows.length) continue;
    docHits += rows.length;
    console.log(`\nproject ${doc.projectid}  doc ${doc._id} "${doc.name ?? ''}"  ${rows.length} slice(s) with rv1 below rv2`);
    rows.forEach((line) => console.log(line));
  }
  if (!docHits) console.log('  none found');

  console.log(`\nTotal: ${jobHits} job slice(s), ${docHits} saved slice(s) stored with anterior below inferior.\n`);
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
