import path from 'path';
import crypto from 'crypto';
import fs from 'fs-extra';
import { loadEnvFromKnownLocations } from '../utils/env';
loadEnvFromKnownLocations(__dirname);          // before database.ts reads MONGODB_URI (see backfill_edit_tracking.ts)

import mongoose from 'mongoose';
import { projectSegmentationMaskModel, projectModel } from '../services/database';
import { extractS3KeyFromUrl, downloadFromS3 } from '../services/s3_handler';
import { classifyReviewProject } from '../services/review_candidates';

// Input for the active-learning review queue (visheart-retraining/review_queue.py, proposal 2.5).
// Run inside the app container, which already has the database and S3 settings:
//   docker exec -w /app/backend visheart-local node dist/scripts/export_review_volumes.js --out dist/temp_exports/review-v1 --dry-run
// Every eligible project's source NIfTI is downloaded to <out>/volumes/, and review_manifest.json records
// which projects already count as corrected (the same rule as the training export), so the queue can skip
// them and prefer cases unlike them. Nothing in the database is written.
const argValue = (name: string, fallback?: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
};
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const sha256File = (file: string): Promise<string> => new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('error', reject).on('data', d => hash.update(d)).on('end', () => resolve(hash.digest('hex')));
});

async function main() {
    const outDir = argValue('out');
    if (!outDir) throw new Error('--out is required');
    const minPixels = Number(argValue('min-pixels', '20'));
    const limit = Number(argValue('limit', '0'));
    const dryRun = hasFlag('dry-run');
    const bucket = process.env.AWS_BUCKET_NAME;

    // Connect directly: connectToDatabase() also creates the admin user and seeds the GPU host.
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/visheart');
    const projects = await projectModel.find({}).lean() as any[];
    const masks = await projectSegmentationMaskModel.find({}).select('-frames').lean() as any[];
    const masksByProject = new Map<string, any[]>();
    for (const mask of masks) {
        const projectId = String(mask.projectid);
        masksByProject.set(projectId, [...(masksByProject.get(projectId) ?? []), mask]);
    }

    const skipped: Record<string, number> = {};
    const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
    const entries: any[] = [];
    let downloaded = 0;
    await fs.ensureDir(path.join(outDir, 'volumes'));

    for (const project of projects) {
        const candidate = classifyReviewProject(project, masksByProject.get(String(project._id)) ?? [], minPixels);
        const entry: any = { ...candidate, volume: null, sha256: null };
        entries.push(entry);
        if (!candidate.eligible) { skip(candidate.reason!); continue; }
        if (dryRun) continue;
        if (limit && downloaded >= limit) { skip('over_limit'); continue; }

        const key = extractS3KeyFromUrl(project.originalfilepath);
        if (!key || !bucket) { skip('download_failed'); continue; }
        const source = path.basename(new URL(project.originalfilepath).pathname);
        const extension = /\.nii\.gz$/i.test(source) ? '.nii.gz' : '.nii';
        const relative = path.posix.join('volumes', `p${candidate.projectId}${extension}`);
        const local = path.join(outDir, relative);
        try {
            if (!(await fs.pathExists(local))) {       // source volumes never change, so a rerun reuses them
                const partial = `${local}.part`;
                await downloadFromS3(bucket, key, partial);
                await fs.move(partial, local, { overwrite: true });
            }
            entry.volume = relative;
            entry.sha256 = await sha256File(local);
            downloaded++;
        } catch (err) {
            skip('download_failed');
            console.warn(`${candidate.projectId}: ${(err as Error).message}`);
        }
    }

    const eligible = entries.filter(e => e.eligible);
    const manifest = {
        mode: dryRun ? 'dry-run' : 'review-volumes',
        created_at: new Date().toISOString(),
        min_pixels: minPixels,
        counts: {
            projects: entries.length,
            eligible: eligible.length,
            corrected: eligible.filter(e => e.corrected).length,
            uncorrected: eligible.filter(e => !e.corrected).length,
            uncorrected_without_unet_result: eligible.filter(e => !e.corrected && !e.hasUnetResult).length,
            downloaded,
            skipped,
        },
        projects: entries,
    };
    await fs.writeJson(path.join(outDir, dryRun ? 'review_dry_run.json' : 'review_manifest.json'), manifest, { spaces: 2 });
    console.log(JSON.stringify(manifest.counts, null, 2));
    await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
