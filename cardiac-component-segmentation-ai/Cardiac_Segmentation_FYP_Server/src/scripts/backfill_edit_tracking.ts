import { loadEnvFromKnownLocations } from '../utils/env';
loadEnvFromKnownLocations(__dirname);          // must run before database.ts is imported

import mongoose from 'mongoose';
import { projectSegmentationMaskModel, projectModel } from '../services/database';
import { findPairedAiMask, runEditTrackingScript } from '../services/edit_tracking';
import { TRAINING_MODELS } from '../services/training_selection';

// Run inside the app container, which already has the database settings:
//   docker exec -w /app/backend visheart-local node dist/scripts/backfill_edit_tracking.js --dry-run
// UNet and MedSAM masks are both backfilled, since corrections from either model can train the UNet.
const dryRun = process.argv.includes('--dry-run');
const modelOf = (m: any) => String(m.segmentationModel || m.model_used || '').toLowerCase();

async function main() {
    // Connect directly: connectToDatabase() also creates the admin user and seeds the GPU host,
    // which a backfill, and above all a dry run, must not do.
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/visheart');
    const editable = await projectSegmentationMaskModel.find({
        isMedSAMOutput: false, segmentationModel: { $in: [...TRAINING_MODELS] }, isSaved: true, editTracking: { $exists: false },
    }).lean() as any[];
    // Legacy masks carry no model tag, so there is no AI output to pair them with; they are only counted.
    const untagged = await projectSegmentationMaskModel.countDocuments({
        isMedSAMOutput: false, isSaved: true, segmentationModel: { $exists: false }, editTracking: { $exists: false },
    });
    const counts = { candidates: editable.length, byModel: {} as Record<string, number>, computed: 0, no_baseline: 0,
                     no_dimensions: 0, failed: 0, suspect: 0, untagged_skipped: untagged };

    for (const mask of editable) {
        const model = modelOf(mask);
        counts.byModel[model] = (counts.byModel[model] ?? 0) + 1;
        const siblings = await projectSegmentationMaskModel.find({ projectid: mask.projectid }).lean() as any[];
        const project = await projectModel.findById(mask.projectid).lean() as any;
        if (!project?.dimensions?.height || !project?.dimensions?.width) { counts.no_dimensions++; continue; }
        const plane = { height: project.dimensions.height, width: project.dimensions.width };
        const now = new Date().toISOString();
        const base = { model, editedAt: new Date(mask.updatedAt).toISOString(), computed_at: now, backfilled: true };

        let editTracking: Record<string, any>;
        const ai = findPairedAiMask(mask, siblings);
        if (!ai) {
            counts.no_baseline++;
            editTracking = { status: 'no_baseline', ...base };
        } else {
            const out = await runEditTrackingScript({ ai_frames: ai.frames, edited_frames: mask.frames, plane });
            if (!out) { counts.failed++; continue; }
            editTracking = { status: 'computed', ...out, aiMaskId: String(ai._id), ...base };
            // F11's signature, in either direction: identical to the other model's AI output, yet different from its own.
            const otherAi = siblings.filter(m => m.isMedSAMOutput === true && modelOf(m) !== model
                && (TRAINING_MODELS as readonly string[]).includes(modelOf(m)));
            for (const other of otherAi) {
                const cross = await runEditTrackingScript({ ai_frames: other.frames, edited_frames: mask.frames, plane });
                if (cross && cross.pixelsChanged === 0 && out.pixelsChanged > 0) {
                    editTracking.suspect = 'cross-model-revert';
                    counts.suspect++;
                    break;
                }
            }
            counts.computed++;
        }
        if (!dryRun) {
            // updatedAt is left alone so it still dates the doctor's last save.
            await projectSegmentationMaskModel.collection.updateOne(
                { _id: new mongoose.Types.ObjectId(String(mask._id)) }, { $set: { editTracking } });
        }
    }
    console.log(JSON.stringify({ dryRun, ...counts }, null, 2));
    await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
