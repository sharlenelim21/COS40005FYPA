import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { loadEnvFromKnownLocations } from '../utils/env';
loadEnvFromKnownLocations(__dirname);          // before database.ts reads MONGODB_URI (see backfill_edit_tracking.ts)

import mongoose from 'mongoose';
import { projectSegmentationMaskModel, projectModel } from '../services/database';
import { extractS3KeyFromUrl, downloadFromS3 } from '../services/s3_handler';
import { runEditTrackingScript } from '../services/edit_tracking';
import { selectTrainingSlices, sliceKey, TRAINING_MODELS } from '../services/training_selection';

// Run inside the app container, which already has the database and S3 settings. The container does not
// hold visheart-retraining/, so copy build_training_volumes.py and common.py in and pass --builder.
// UNet and MedSAM corrections both count; training_selection.ts decides which slices. When both models
// corrected the same slice differently, the dry run writes conflicts.json: set each "use", then pass the
// file back with --choices. A real export needs --frozen-slices (frozen_guard.py's index, copied in with the
// builder): a project whose source volume holds any frozen test slice is left out whole.
const argValue = (name: string, fallback?: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
};
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const runBuilder = (python: string, builder: string, payload: object): Promise<any> => new Promise((resolve, reject) => {
    const child = spawn(python, [builder], { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error(`builder exited ${code}: ${stderr.slice(0, 500)}`)); }
    });
    child.stdin.end(JSON.stringify(payload));
});

async function main() {
    const outDir = argValue('out');
    if (!outDir) throw new Error('--out is required');
    const python = argValue('python', process.env.PYTHON_CMD || (process.platform === 'win32' ? 'python' : 'python3'))!;
    const builder = argValue('builder', path.resolve(__dirname, '..', '..', '..', 'visheart-retraining', 'build_training_volumes.py'))!;
    const minPixels = Number(argValue('min-pixels', '20'));
    const limit = Number(argValue('limit', '0'));
    const holdoutPath = argValue('holdout');
    const choicesPath = argValue('choices');
    const frozenSlices = argValue('frozen-slices');
    const dryRun = hasFlag('dry-run');
    const onlyHoldout = hasFlag('only-holdout');
    const holdout = holdoutPath ? await fs.readJson(holdoutPath) : null;
    const clinical = new Set<string>(holdout?.clinical?.project_ids ?? []);
    if (onlyHoldout && clinical.size === 0) throw new Error('--only-holdout needs a manifest with a drawn clinical arm');
    if (!dryRun && !(await fs.pathExists(builder))) throw new Error(`builder not found: ${builder} (pass --builder)`);
    if (!dryRun && !frozenSlices) throw new Error('--frozen-slices is required: no export may reach the frozen test set');
    if (!dryRun && !(await fs.pathExists(frozenSlices!))) throw new Error(`frozen-slice index not found: ${frozenSlices}`);
    const bucket = process.env.AWS_BUCKET_NAME;

    const choicesByProject = new Map<string, Record<string, string>>();
    for (const entry of (choicesPath ? (await fs.readJson(choicesPath)).conflicts : null) ?? []) {
        const perProject = choicesByProject.get(String(entry.projectId)) ?? {};
        if (entry.use) perProject[sliceKey(Number(entry.frameindex), Number(entry.sliceindex))] = String(entry.use);
        choicesByProject.set(String(entry.projectId), perProject);
    }

    // Connect directly: connectToDatabase() also creates the admin user and seeds the GPU host.
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/visheart');
    const masks = await projectSegmentationMaskModel.find({
        isMedSAMOutput: false, segmentationModel: { $in: [...TRAINING_MODELS] }, 'editTracking.status': 'computed',
    }).lean() as any[];

    const skipped: Record<string, number> = {};
    const skip = (reason: string, n = 1) => { skipped[reason] = (skipped[reason] ?? 0) + n; };
    const candidates: any[] = [];
    const cases: any[] = [];
    const conflictReport: any[] = [];
    const frozenExcluded: any[] = [];
    const byProject = new Map<string, any[]>();
    for (const mask of masks) {
        const projectId = String(mask.projectid);
        byProject.set(projectId, [...(byProject.get(projectId) ?? []), mask]);
    }
    let exportedProjects = 0;

    for (const [projectId, projectMasks] of byProject) {
        if (onlyHoldout !== clinical.has(projectId)) { skip(onlyHoldout ? 'not_in_clinical_arm' : 'clinical_arm'); continue; }
        const project = await projectModel.findById(projectId).lean() as any;
        const dims = project?.dimensions;
        if (!dims?.height || !dims?.width) { skip('no_dimensions'); continue; }
        if (!/\.nii(\.gz)?$/i.test(String(project.originalfilename || project.filename || ''))) { skip('not_nifti'); continue; }
        if (!String(project.originalfilepath || '').startsWith('https://')) { skip('no_s3_volume'); continue; }
        const plane = { height: dims.height, width: dims.width };

        const choices = choicesByProject.get(projectId);
        let selection = selectTrainingSlices(projectMasks, minPixels, { choices });
        const differing = new Map<string, number>();
        const ofModel = (model: string) => projectMasks.filter(m => String(m.segmentationModel).toLowerCase() === model);
        if (selection.conflicts.length > 0 && ofModel('unet').length === 1 && ofModel('medsam').length === 1) {
            // Pixel-identical corrections are not a real conflict: compare the two models' saved masks directly.
            const diff = await runEditTrackingScript({ ai_frames: ofModel('medsam')[0].frames, edited_frames: ofModel('unet')[0].frames, plane });
            if (diff) {
                for (const s of diff.slices ?? []) differing.set(sliceKey(s.frameindex, s.sliceindex), s.pixelsChanged);
                const identicalSlices = new Set(selection.conflicts
                    .map(c => sliceKey(c.frameindex, c.sliceindex))
                    .filter(key => !differing.has(key)));
                if (identicalSlices.size > 0) selection = selectTrainingSlices(projectMasks, minPixels, { choices, identicalSlices });
            }
        }
        for (const [reason, n] of Object.entries(selection.skipped)) skip(reason, n);
        for (const c of selection.conflicts) {
            conflictReport.push({ projectId, frameindex: c.frameindex, sliceindex: c.sliceindex, suggested: c.suggested, use: c.used,
                                  chosen: c.chosen, differingPixels: differing.get(sliceKey(c.frameindex, c.sliceindex)) ?? null,
                                  contenders: c.contenders });
        }
        if (selection.selected.length === 0) { skip('no_slice_qualified'); continue; }
        if (dryRun) {
            for (const entry of selection.selected) {
                candidates.push({ projectId, model: entry.model, maskId: String(entry.mask._id),
                                  editedSliceCount: entry.mask.editTracking.editedSliceCount, qualifyingSlices: entry.slices.length });
            }
            continue;
        }
        if (limit && exportedProjects >= limit) break;

        const key = extractS3KeyFromUrl(project.originalfilepath);
        if (!key || !bucket) { skip('download_or_build_failed'); continue; }
        const tmp = path.join(os.tmpdir(), `visheart-export-${uuidv4()}`);
        await fs.ensureDir(tmp);
        try {
            const local = path.join(tmp, path.basename(new URL(project.originalfilepath).pathname));
            await downloadFromS3(bucket, key, local);          // one download serves every model's corrections
            let exported = false;
            for (const entry of selection.selected) {
                const out = await runBuilder(python, builder, {
                    source_nifti: local, case_id: `p${projectId}_${entry.model}`, out_dir: outDir, plane, min_pixels: minPixels,
                    tracked_slices: entry.slices, frames: entry.mask.frames, frozen_slices: frozenSlices,
                });
                if (out.frozen_match) {
                    skip('frozen_test_patient');
                    frozenExcluded.push({ projectId, model: entry.model, frozen_match: out.frozen_match });
                    console.warn(`${projectId} (${entry.model}): left out, frame ${out.frozen_match.frame} slice ${out.frozen_match.slice} is frozen ${out.frozen_match.frozen}`);
                    continue;
                }
                if (out.error) { skip('builder_error'); console.warn(`${projectId} (${entry.model}): ${out.error}`); continue; }
                for (const [reason, n] of Object.entries(out.skipped as Record<string, number>)) skip(`slice_${reason}`, n);
                if (out.files.length === 0) { skip('no_slice_qualified'); continue; }
                cases.push({ projectId, model: entry.model, maskId: String(entry.mask._id), aiMaskId: entry.mask.editTracking.aiMaskId,
                             editTrackingComputedAt: entry.mask.editTracking.computed_at, files: out.files });
                exported = true;
            }
            if (exported) exportedProjects++;
        } catch (err) {
            skip('download_or_build_failed');
            console.warn(`${projectId}: ${(err as Error).message}`);
        } finally {
            await fs.remove(tmp);
        }
    }

    if (!onlyHoldout && cases.some(c => clinical.has(c.projectId))) {
        throw new Error('a clinical-arm project reached the training export');
    }
    const slices = cases.reduce((n, c) => n + c.files.reduce((m: number, f: any) => m + f.slices.length, 0), 0);
    const byModel: Record<string, number> = {};
    for (const c of cases) byModel[c.model] = (byModel[c.model] ?? 0) + 1;
    const createdAt = new Date().toISOString();
    const manifest = dryRun
        ? { mode: 'dry-run', created_at: createdAt, min_pixels: minPixels, choices_file: choicesPath ?? null,
            counts: { masks: masks.length, projects: new Set(candidates.map(c => c.projectId)).size, candidates: candidates.length,
                      conflicts: conflictReport.length, skipped },
            candidates, conflicts: conflictReport }
        : { mode: onlyHoldout ? 'clinical-holdout' : 'training', created_at: createdAt, min_pixels: minPixels,
            holdout_manifest: holdoutPath ?? null, choices_file: choicesPath ?? null, frozen_slices: frozenSlices ?? null,
            counts: { masks: masks.length, projects: exportedProjects, cases: cases.length, byModel, slices,
                      conflicts: conflictReport.length, skipped },
            cases, conflicts: conflictReport, frozen_excluded: frozenExcluded };
    await fs.ensureDir(outDir);
    await fs.writeJson(path.join(outDir, dryRun ? 'dry_run.json' : 'export_manifest.json'), manifest, { spaces: 2 });
    if (dryRun && conflictReport.length > 0) {
        // Never overwrite a conflicts file that may already hold reviewed choices.
        const conflictsPath = path.join(outDir, 'conflicts.json');
        if (await fs.pathExists(conflictsPath)) {
            console.warn(`${conflictsPath} already exists and was left untouched; the current conflicts are in dry_run.json`);
        } else {
            await fs.writeJson(conflictsPath, {
                created_at: createdAt,
                how_to_use: 'Each entry is one slice that both models corrected differently. "suggested" is the later save. '
                    + 'Set "use" to "unet" or "medsam", then pass this file with --choices.',
                conflicts: conflictReport.map(({ projectId, frameindex, sliceindex, suggested, use, differingPixels, contenders }) =>
                    ({ projectId, frameindex, sliceindex, suggested, use, differingPixels, contenders })),
            }, { spaces: 2 });
        }
    }
    console.log(JSON.stringify(manifest.counts, null, 2));
    await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
