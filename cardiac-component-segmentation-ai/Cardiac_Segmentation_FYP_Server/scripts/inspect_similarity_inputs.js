/**
 * inspect_similarity_inputs.js
 * ============================
 * For every segmentation mask in the DB, print EXACTLY what the Disease Pattern
 * Similarity module receives as input, and — most importantly — whether the
 * strain peaks (PeakGRS / PeakGCS) were USED or DROPPED.
 *
 * The backend only feeds strain into similarity when it was computed at the TRUE
 * auto-detected ED/ES frames (heartMetrics.ed_frame / es_frame). If the strain
 * was run on arbitrary user-picked frames, the peaks are dropped and similarity
 * runs on the volume features alone. This script makes that decision visible so
 * you can confirm, per patient, what drove the result.
 *
 * Mirrors the frame-match logic in segmentation_routes.ts
 * (assembleSimilarityMeasurements).
 *
 * Usage:  node scripts/inspect_similarity_inputs.js [projectId]
 *   - no arg  → every mask in the DB
 *   - projectId → only that project's masks
 */

'use strict';

const mongoose = require('mongoose');

const DB_URI =
  process.env.MONGODB_URI ||
  'mongodb://admin:P%40ssw0rd123%21@localhost:27017/visheart?authSource=admin';

function num(v) {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}

(async () => {
  await mongoose.connect(DB_URI);
  // Model "Segmentation Masks" → Mongoose collection "segmentation masks".
  const coll = mongoose.connection.db.collection('segmentation masks');

  const filter = process.argv[2] ? { projectid: String(process.argv[2]) } : {};
  const docs = await coll.find(filter).toArray();
  console.log(`\nInspecting ${docs.length} mask(s)${process.argv[2] ? ` for project ${process.argv[2]}` : ''}\n`);

  for (const d of docs) {
    const model = d.segmentationModel || d.model_used || (d.isMedSAMOutput ? '(medsam-output)' : 'unknown');
    const hm = d.heartMetrics || {};
    const m = hm.measurements || {};
    const strain = d.strain || null;

    // Replicate the frame-match gate from assembleSimilarityMeasurements().
    const strainAtCorrectFrames =
      strain &&
      typeof hm.ed_frame === 'number' && typeof hm.es_frame === 'number' &&
      strain.edFrameIndex === hm.ed_frame &&
      strain.esFrameIndex === hm.es_frame;

    const usedGRS = strainAtCorrectFrames ? num(strain.global_grs) : num(m.PeakGRS);
    const usedGCS = strainAtCorrectFrames ? num(strain.global_gcs) : num(m.PeakGCS);

    console.log('─'.repeat(70));
    console.log(`mask ${d._id}  [${model}]  project ${d.projectid}  name="${d.name || ''}"`);
    console.log(`  heartMetrics: EF=${num(m.EF)} EDV=${num(m.EDV)} ESV=${num(m.ESV)} SV=${num(m.StrokeVolume)}`);
    console.log(`  auto ED/ES frames: ed=${hm.ed_frame ?? '—'} es=${hm.es_frame ?? '—'}`);

    if (!strain) {
      console.log('  strain: NONE stored  → PeakGRS/GCS NOT used (volumes only)');
    } else {
      console.log(`  strain stored at: ed=${strain.edFrameIndex} es=${strain.esFrameIndex}  global_grs=${num(strain.global_grs)} global_gcs=${num(strain.global_gcs)}`);
      if (strainAtCorrectFrames) {
        console.log(`  ✅ strain frames MATCH auto ED/ES → PeakGRS/GCS ARE USED (GRS=${usedGRS}, GCS=${usedGCS})`);
      } else {
        console.log(`  ⚠️  strain frames (${strain.edFrameIndex}/${strain.esFrameIndex}) != auto ED/ES (${hm.ed_frame}/${hm.es_frame}) → strain DROPPED, volumes only`);
      }
    }

    // What similarity actually received.
    const inputUsed = {
      EF: num(m.EF), EDV: num(m.EDV), ESV: num(m.ESV), StrokeVolume: num(m.StrokeVolume),
      PeakGRS: usedGRS, PeakGCS: usedGCS,
    };
    const present = Object.entries(inputUsed).filter(([, v]) => v !== null).map(([k]) => k);
    console.log(`  → similarity INPUT: ${JSON.stringify(inputUsed)}`);
    console.log(`  → features used: [${present.join(', ')}]`);

    if (d.diseaseSimilarity) {
      const ds = d.diseaseSimilarity;
      const tops = (ds.similarities || []).map(s => `${s.code} ${Number(s.percent).toFixed(0)}%`).join(', ');
      console.log(`  → stored result: most_similar=${ds.most_similar}  (${tops})`);
    } else {
      console.log('  → stored result: none (similarity not run for this mask)');
    }
  }

  console.log('─'.repeat(70));
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
