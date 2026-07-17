// File: src/services/segmentation_export.ts
// Description: Service layer for segmentation NIfTI export functionality - extracted from routes for reuse.

import mongoose from 'mongoose';
import { IProjectSegmentationMask, IProjectDocument } from "../types/database_types";
import { projectSegmentationMaskModel, readProject, readProjectSegmentationMask, jobModel, JobStatus, projectLandmarkModel } from "./database";
import { generatePresignedGetUrl, generatePresignedGetUrlForInternalService } from "../utils/s3_presigned_url";
import { uploadMaskToS3, extractS3KeyFromUrl } from "./s3_handler";
import axios from 'axios';
import FormData from 'form-data';
import logger from "./logger";
import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { getCurrentToken, getFreshGPUServerAddress } from "./gpu_auth_client";

const serviceLocation = 'SegmentationExport';

/**
 * Compute AHA 17-segment bullseye analysis directly from the mask's RLE frame data
 * using the local Python script. No GPU or NIfTI file required.
 * Stores the result in MongoDB on the segmentation mask document.
 */
export const computeBullseyeFromMaskDoc = async (
    maskId: string,
    frames: any[],
    width: number,
    height: number,
): Promise<void> => {
    const scriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'compute_bullseye_from_rle.py');
    const input = JSON.stringify({ frames, width, height });

    return new Promise<void>((resolve) => {
        const child = exec(`python3 "${scriptPath}"`, async (error, stdout, stderr) => {
            if (error) {
                logger.warn(`${serviceLocation}: [Bullseye] Python script failed for mask ${maskId}: ${error.message}`);
                if (stderr) logger.warn(`${serviceLocation}: [Bullseye] stderr: ${stderr.substring(0, 500)}`);
                return resolve();
            }
            try {
                const result = JSON.parse(stdout.trim());
                if (result.error) {
                    logger.warn(`${serviceLocation}: [Bullseye] Script reported error for mask ${maskId}: ${result.error}`);
                    return resolve();
                }
                result.computed_at = new Date().toISOString();
                const writeResult = await projectSegmentationMaskModel.collection.updateOne(
                    { _id: new mongoose.Types.ObjectId(maskId) },
                    { $set: { bullseye: result, updatedAt: new Date() } },
                );
                logger.info(`${serviceLocation}: [Bullseye] Stored RLE-derived bullseye for mask ${maskId} — stats: ${JSON.stringify(result.stats)} | matched=${writeResult.matchedCount} modified=${writeResult.modifiedCount}`);
            } catch (parseErr: any) {
                logger.warn(`${serviceLocation}: [Bullseye] Failed to parse Python output for mask ${maskId}: ${parseErr?.message}`);
            }
            resolve();
        });
        child.stdin?.write(input);
        child.stdin?.end();
    });
};

/**
 * Compute cardiac clinical metrics (chamber volumes, ejection fraction, LV
 * mass) from a mask document's RLE frames plus the project's stored 4x4
 * affine, and store the result on the mask doc under `heartMetrics`.
 *
 * Mirrors computeBullseyeFromMaskDoc exactly: stdin JSON → local Python →
 * stdout JSON → $set on the mask doc. Never rejects; always resolves.
 * Callers can safely fire-and-forget in parallel with the bullseye compute.
 *
 * `affine` MUST be a 4x4 nested list (project.affineMatrix). Without it the
 * Python script refuses to compute — voxel volume is undefined without spacing.
 */
export const computeHeartMetricsFromMaskDoc = async (
    maskId: string,
    frames: any[],
    width: number,
    height: number,
    affine: number[][],
): Promise<void> => {
    const scriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'compute_heart_metrics_from_rle.py');
    const input = JSON.stringify({ frames, width, height, affine });

    return new Promise<void>((resolve) => {
        const child = exec(`python3 "${scriptPath}"`, async (error, stdout, stderr) => {
            if (error) {
                logger.warn(`${serviceLocation}: [HeartMetrics] Python script failed for mask ${maskId}: ${error.message}`);
                if (stderr) logger.warn(`${serviceLocation}: [HeartMetrics] stderr: ${stderr.substring(0, 500)}`);
                return resolve();
            }
            try {
                const result = JSON.parse(stdout.trim());
                if (result.error) {
                    logger.warn(`${serviceLocation}: [HeartMetrics] Script reported error for mask ${maskId}: ${result.error}`);
                    return resolve();
                }
                result.computed_at = new Date().toISOString();
                const writeResult = await projectSegmentationMaskModel.collection.updateOne(
                    { _id: new mongoose.Types.ObjectId(maskId) },
                    { $set: { heartMetrics: result, updatedAt: new Date() } },
                );
                logger.info(
                    `${serviceLocation}: [HeartMetrics] Stored heart metrics for mask ${maskId} — ` +
                    `LVEDV=${result.LVEDV} LVESV=${result.LVESV} LVEF=${result.LVEF} ` +
                    `LV_mass_g=${result.LV_mass_g} warnings=${result.warnings?.length ?? 0} | ` +
                    `matched=${writeResult.matchedCount} modified=${writeResult.modifiedCount}`
                );
            } catch (parseErr: any) {
                logger.warn(`${serviceLocation}: [HeartMetrics] Failed to parse Python output for mask ${maskId}: ${parseErr?.message}`);
            }
            resolve();
        });
        child.stdin?.write(input);
        child.stdin?.end();
    });
};

/**
 * Disease Pattern Similarity Assessment — NOT a diagnosis.
 *
 * Compares a patient's cardiac measurements against literature-derived NOR/HCM/DCM
 * reference profiles and reports which pattern they most resemble, with per-metric
 * reasoning. Mirrors computeHeartMetricsFromMaskDoc's shape: stdin JSON → local
 * Python → stdout JSON → $set on the mask doc under `diseaseSimilarity`. Never
 * rejects; always resolves so it can be fired in parallel with the other computes.
 *
 * `measurements` is the flat block produced by heartMetrics.measurements with
 * PeakGRS/PeakGCS filled in from the strain pipeline. Any subset is accepted —
 * the Python side ignores nulls and warns when too few features are present.
 */
export const computeDiseaseSimilarityFromMetrics = async (
    maskId: string,
    measurements: {
        EF: number | null;
        EDV: number | null;
        ESV: number | null;
        StrokeVolume: number | null;
        PeakGRS: number | null;
        PeakGCS: number | null;
    },
): Promise<void> => {
    const scriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'compute_disease_similarity.py');
    const input = JSON.stringify({ measurements });

    return new Promise<void>((resolve) => {
        const child = exec(`python3 "${scriptPath}"`, async (error, stdout, stderr) => {
            if (error) {
                logger.warn(`${serviceLocation}: [DiseaseSimilarity] Python script failed for mask ${maskId}: ${error.message}`);
                if (stderr) logger.warn(`${serviceLocation}: [DiseaseSimilarity] stderr: ${stderr.substring(0, 500)}`);
                return resolve();
            }
            try {
                const result = JSON.parse(stdout.trim());
                if (result.error) {
                    logger.warn(`${serviceLocation}: [DiseaseSimilarity] Script reported error for mask ${maskId}: ${result.error}`);
                    return resolve();
                }
                result.computed_at = new Date().toISOString();
                const writeResult = await projectSegmentationMaskModel.collection.updateOne(
                    { _id: new mongoose.Types.ObjectId(maskId) },
                    { $set: { diseaseSimilarity: result, updatedAt: new Date() } },
                );
                logger.info(
                    `${serviceLocation}: [DiseaseSimilarity] Stored similarity for mask ${maskId} — ` +
                    `most_similar=${result.most_similar} ` +
                    `used=${result.features_used?.length ?? 0} warnings=${result.warnings?.length ?? 0} | ` +
                    `matched=${writeResult.matchedCount} modified=${writeResult.modifiedCount}`
                );
            } catch (parseErr: any) {
                logger.warn(`${serviceLocation}: [DiseaseSimilarity] Failed to parse Python output for mask ${maskId}: ${parseErr?.message}`);
            }
            resolve();
        });
        child.stdin?.write(input);
        child.stdin?.end();
    });
};

/**
 * Non-blocking: POSTs the NIfTI file at niftiPath to the GPU /bullseye/analyze endpoint,
 * then stores the result in MongoDB on the segmentation mask document.
 */
export const computeBullseyeAndStore = async (
    niftiPath: string,
    maskId: string,
    projectId: string,
): Promise<void> => {
    try {
        const gpuBaseUrl = await getFreshGPUServerAddress();
        const token = getCurrentToken();
        if (!gpuBaseUrl || !token) {
            logger.warn(`${serviceLocation}: [Bullseye] GPU address or token unavailable — skipping bullseye for mask ${maskId}`);
            return;
        }

        const fileExists = await fs.pathExists(niftiPath);
        if (!fileExists) {
            logger.warn(`${serviceLocation}: [Bullseye] NIfTI file not found at ${niftiPath} — skipping bullseye for mask ${maskId}`);
            return;
        }

        logger.info(`${serviceLocation}: [Bullseye] Sending NIfTI to GPU for mask ${maskId} (project ${projectId})`);

        let rv1: number[] | null = null;
        let rv2: number[] | null = null;

        // Prefer the user's SAVED landmark edits over the raw AI detection so the
        // bullseye alignment reflects the newest corrected RV insertion points.
        // Edits are shared across segmentation models (one editable doc per
        // project), so this is not filtered by model. Mirrors the strain routes.
        const savedLandmarkDoc = await projectLandmarkModel
            .findOne({ projectid: projectId, isModelOutput: false })
            .sort({ updatedAt: -1 })
            .lean();
        if (savedLandmarkDoc) {
            const lm1Points: number[][] = [];
            const lm2Points: number[][] = [];
            for (const frame of (savedLandmarkDoc as any).frames ?? []) {
                for (const slice of frame.slices ?? []) {
                    for (const point of slice.landmarks ?? []) {
                        if (point.key === "rv_insertion_1") lm1Points.push([point.x, point.y]);
                        if (point.key === "rv_insertion_2") lm2Points.push([point.x, point.y]);
                    }
                }
            }
            const meanPt = (pts: number[][]): number[] | null =>
                pts.length
                    ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
                    : null;
            rv1 = meanPt(lm1Points);
            rv2 = meanPt(lm2Points);
            if (rv1 && rv2) {
                logger.info(`${serviceLocation}: [Bullseye] Using saved landmark edits (doc ${savedLandmarkDoc._id}) for mask ${maskId}`);
            }
        }

        // Fall back to the most recent completed landmark job only when no saved edits exist.
        const landmarkJob = (rv1 && rv2) ? null : await jobModel
            .findOne({
                projectid: projectId,
                model_used: /landmark/i,
                status: JobStatus.COMPLETED,
                result: { $exists: true, $ne: null },
            })
            .sort({ updatedAt: -1, createdAt: -1 })
            .lean();

        // The landmark result uses new format: { slices, avg_lm1: {x,y}, avg_lm2: {x,y} }
        // or old format: { predictions: [{ rv_insertion_1: [x,y], rv_insertion_2: [x,y] }] }
        if (landmarkJob?.result) {
            const r = typeof landmarkJob.result === 'string'
                ? JSON.parse(landmarkJob.result)
                : landmarkJob.result;
            if (r.avg_lm1 && typeof r.avg_lm1.x === 'number' && typeof r.avg_lm1.y === 'number') {
                rv1 = [r.avg_lm1.x, r.avg_lm1.y];
            } else if (Array.isArray(r.avg_lm1) && r.avg_lm1.length >= 2) {
                rv1 = r.avg_lm1;
            } else if (Array.isArray(r.predictions) && r.predictions.length > 0) {
                rv1 = r.predictions[0].rv_insertion_1 ?? null;
            }
            if (r.avg_lm2 && typeof r.avg_lm2.x === 'number' && typeof r.avg_lm2.y === 'number') {
                rv2 = [r.avg_lm2.x, r.avg_lm2.y];
            } else if (Array.isArray(r.avg_lm2) && r.avg_lm2.length >= 2) {
                rv2 = r.avg_lm2;
            } else if (Array.isArray(r.predictions) && r.predictions.length > 0) {
                rv2 = r.predictions[0].rv_insertion_2 ?? null;
            }
        }

        if (rv1 && rv2) {
            logger.info(`${serviceLocation}: [Bullseye] Using landmark alignment — rv1=[${rv1}] rv2=[${rv2}] for mask ${maskId}`);
        } else {
            logger.info(`${serviceLocation}: [Bullseye] No landmark data found — using fixed-angle fallback for mask ${maskId}`);
        }

        const form = new FormData();
        form.append('file', fs.createReadStream(niftiPath), {
            filename: path.basename(niftiPath),
            contentType: 'application/gzip',
        });
        if (rv1 && rv2) {
            form.append('rv_insertion_1_x', String(rv1[0]));
            form.append('rv_insertion_1_y', String(rv1[1]));
            form.append('rv_insertion_2_x', String(rv2[0]));
            form.append('rv_insertion_2_y', String(rv2[1]));
        }

        const response = await axios.post(`${gpuBaseUrl}/bullseye/analyze`, form, {
            headers: {
                ...form.getHeaders(),
                Authorization: `Bearer ${token}`,
            },
            timeout: 120000,
        });

        if (response.status !== 200 || !response.data) {
            logger.warn(`${serviceLocation}: [Bullseye] GPU returned status ${response.status} for mask ${maskId} — skipping store`);
            return;
        }

        const bullseyeData = response.data;
        bullseyeData.computed_at = new Date().toISOString();

        const gpuWriteResult = await projectSegmentationMaskModel.collection.updateOne(
            { _id: new mongoose.Types.ObjectId(maskId) },
            { $set: { bullseye: bullseyeData, updatedAt: new Date() } },
        );

        logger.info(`${serviceLocation}: [Bullseye] Stored bullseye result for mask ${maskId} — stats: ${JSON.stringify(bullseyeData.stats)} | matched=${gpuWriteResult.matchedCount} modified=${gpuWriteResult.modifiedCount}`);
    } catch (err: any) {
        logger.warn(`${serviceLocation}: [Bullseye] GPU bullseye failed for mask ${maskId} (${err?.message}). Falling back to local RLE computation.`);
        // Fall back to local RLE-based computation using the mask document's frame data
        try {
            const maskDoc = await projectSegmentationMaskModel.findById(maskId).lean();
            const frames = (maskDoc as any)?.frames ?? [];
            if (!frames.length) {
                logger.warn(`${serviceLocation}: [Bullseye] No frame data on mask ${maskId} — cannot fall back to local computation.`);
                return;
            }
            const projectResult = await readProject(projectId);
            const project = projectResult.projects?.[0] as any;
            const W = project?.dimensions?.width;
            const H = project?.dimensions?.height;
            if (!W || !H) {
                logger.warn(`${serviceLocation}: [Bullseye] No dimensions for project ${projectId} — cannot fall back to local computation.`);
                return;
            }
            await computeBullseyeFromMaskDoc(maskId, frames, W, H);
        } catch (fallbackErr: any) {
            logger.warn(`${serviceLocation}: [Bullseye] Local fallback also failed for mask ${maskId}: ${fallbackErr?.message}`);
        }
    }
};

/**
 * Live-route entry point for the plain Bullseye tab: generates a temporary
 * NIfTI from a single mask document's stored RLE frames (same pattern as
 * recomputeBullseyeWithLandmarks' per-mask NIfTI build), then delegates to
 * computeBullseyeAndStore() — GPU-primary, landmark-aware when a completed
 * landmark job exists, with computeBullseyeAndStore's own internal fallback
 * to the subprocess path (compute_bullseye_from_rle.py) preserved for when
 * the GPU service is unreachable.
 *
 * Replaces the previous direct call to computeBullseyeFromMaskDoc(), which
 * had no landmark awareness at all and would silently overwrite any
 * landmark-aligned bullseye already stored by recomputeBullseyeWithLandmarks.
 */
export const generateNiftiAndComputeBullseye = async (
    maskDoc: any,
    project: IProjectDocument,
    maskId: string,
): Promise<void> => {
    const tempId = uuidv4();
    const baseTempDir = path.join(__dirname, '..', 'temp_exports', `bullseye_trigger_${tempId}`);
    const niftiPath = path.join(baseTempDir, `mask_${maskId}.nii.gz`);
    const segJsonPath = path.join(baseTempDir, `seg_${maskId}.json`);
    const projectId = project._id?.toString() ?? (maskDoc as any).projectid?.toString();

    try {
        const W = project.dimensions?.width;
        const H = project.dimensions?.height;
        if (!W || !H) {
            logger.warn(`${serviceLocation}: [BullseyeTrigger] Project ${projectId} missing dimensions — cannot generate NIfTI for mask ${maskId}`);
            return;
        }

        await fs.ensureDir(baseTempDir);
        await fs.writeJson(segJsonPath, [maskDoc], { spaces: 2 });

        let pythonCommand: string;
        if (project.affineMatrix && Array.isArray(project.affineMatrix) && project.affineMatrix.length > 0) {
            const affineFile = path.join(baseTempDir, `affine_${maskId}.json`);
            const dimsFile   = path.join(baseTempDir, `dims_${maskId}.json`);
            await fs.writeJson(affineFile, project.affineMatrix, { spaces: 2 });
            await fs.writeJson(dimsFile,   project.dimensions,   { spaces: 2 });
            const scriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'create_nifti_with_stored_affine.py');
            pythonCommand = `python3 "${scriptPath}" "${segJsonPath}" "${niftiPath}" "${affineFile}" "${dimsFile}" "uint8" ${H} ${W}`;
        } else {
            const s3Url = (project as any).extractedfolderpath;
            if (!s3Url) {
                logger.warn(`${serviceLocation}: [BullseyeTrigger] Mask ${maskId} — no affine and no S3 URL — cannot generate NIfTI`);
                return;
            }
            const scriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'create_nifti_from_segmentations.py');
            pythonCommand = `python3 "${scriptPath}" "${segJsonPath}" "${niftiPath}" ${W} ${H} "${s3Url}"`;
        }

        const pythonOk = await new Promise<boolean>((resolve) => {
            exec(pythonCommand, (error, _stdout, stderr) => {
                if (error) {
                    logger.warn(`${serviceLocation}: [BullseyeTrigger] NIfTI generation failed for mask ${maskId}: ${stderr || error.message}`);
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });

        if (!pythonOk || !(await fs.pathExists(niftiPath))) {
            logger.warn(`${serviceLocation}: [BullseyeTrigger] NIfTI not produced for mask ${maskId} — falling back to subprocess RLE path`);
            const frames = (maskDoc as any).frames ?? [];
            if (frames.length) {
                await computeBullseyeFromMaskDoc(maskId, frames, W, H);
            }
            return;
        }

        await computeBullseyeAndStore(niftiPath, maskId, projectId);
    } catch (err: any) {
        logger.warn(`${serviceLocation}: [BullseyeTrigger] Error generating NIfTI for mask ${maskId}: ${err?.message}`);
    } finally {
        try {
            if (await fs.pathExists(baseTempDir)) {
                await fs.remove(baseTempDir);
            }
        } catch { /* cleanup failure is non-fatal */ }
    }
};

/**
 * Recompute the bullseye for a project using landmark alignment.
 * Called after landmark detection completes to upgrade from fixed-angle
 * to anatomically-aligned bullseye orientation.
 *
 * Pipeline:
 *   1. Find all editable (isMedSAMOutput=false) masks for the project
 *   2. For each, generate a temporary NIfTI from the mask's RLE frame data
 *   3. POST to GPU /bullseye/analyze with landmark form fields
 *   4. Overwrite the bullseye field on the mask document
 *   5. Clean up temp files
 *
 * Never throws — failure must never affect the webhook response.
 */
export async function recomputeBullseyeWithLandmarks(
    projectId: string,
    avgLm1: [number, number],
    avgLm2: [number, number],
): Promise<void> {
    const tempId = uuidv4();
    const baseTempDir = path.join(__dirname, '..', 'temp_exports', `bullseye_lm_${tempId}`);

    try {
        logger.info(
            `${serviceLocation}: [BullseyeLM] Recomputing with landmark alignment for project ${projectId} ` +
            `avg_lm1=[${avgLm1}] avg_lm2=[${avgLm2}]`
        );

        // 1. GPU connection
        const gpuBaseUrl = await getFreshGPUServerAddress();
        const token = getCurrentToken();
        if (!gpuBaseUrl || !token) {
            logger.warn(`${serviceLocation}: [BullseyeLM] GPU unavailable — skipping landmark recompute for project ${projectId}`);
            return;
        }

        // 2. Project metadata (dimensions + affine)
        const projectResult = await readProject(projectId);
        const project = projectResult.projects?.[0] as any;
        if (!project) {
            logger.warn(`${serviceLocation}: [BullseyeLM] Project ${projectId} not found — skipping`);
            return;
        }
        const W: number | undefined = project?.dimensions?.width;
        const H: number | undefined = project?.dimensions?.height;
        if (!W || !H) {
            logger.warn(`${serviceLocation}: [BullseyeLM] Project ${projectId} has no dimensions — skipping`);
            return;
        }

        // 3. Find all editable masks
        const masksResult = await readProjectSegmentationMask(projectId);
        const editableMasks = (masksResult.projectsegmentationmasks ?? []).filter(
            (m: any) => m.isMedSAMOutput === false
        );
        if (editableMasks.length === 0) {
            logger.warn(`${serviceLocation}: [BullseyeLM] No editable masks for project ${projectId} — skipping`);
            return;
        }

        await fs.ensureDir(baseTempDir);

        // 4. Process each editable mask
        for (const mask of editableMasks) {
            const maskId: string = mask._id?.toString();
            if (!maskId) continue;

            const frames = mask.frames ?? [];
            if (!frames.length) {
                logger.warn(`${serviceLocation}: [BullseyeLM] Mask ${maskId} has no frames — skipping`);
                continue;
            }

            const niftiPath = path.join(baseTempDir, `mask_${maskId}.nii.gz`);
            const segJsonPath = path.join(baseTempDir, `seg_${maskId}.json`);

            try {
                // 4a. Generate NIfTI from RLE frames
                await fs.writeJson(segJsonPath, [mask], { spaces: 2 });

                let pythonCommand: string;
                if (project.affineMatrix && Array.isArray(project.affineMatrix) && project.affineMatrix.length > 0) {
                    const affineFile = path.join(baseTempDir, `affine_${maskId}.json`);
                    const dimsFile   = path.join(baseTempDir, `dims_${maskId}.json`);
                    await fs.writeJson(affineFile, project.affineMatrix, { spaces: 2 });
                    await fs.writeJson(dimsFile,   project.dimensions,   { spaces: 2 });
                    const scriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'create_nifti_with_stored_affine.py');
                    pythonCommand = `python3 "${scriptPath}" "${segJsonPath}" "${niftiPath}" "${affineFile}" "${dimsFile}" "uint8" ${H} ${W}`;
                } else {
                    const s3Url = project.extractedfolderpath;
                    if (!s3Url) {
                        logger.warn(`${serviceLocation}: [BullseyeLM] Mask ${maskId} — no affine and no S3 URL — skipping`);
                        continue;
                    }
                    const scriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'create_nifti_from_segmentations.py');
                    pythonCommand = `python3 "${scriptPath}" "${segJsonPath}" "${niftiPath}" ${W} ${H} "${s3Url}"`;
                }

                const pythonOk = await new Promise<boolean>((resolve) => {
                    exec(pythonCommand, (error, _stdout, stderr) => {
                        if (error) {
                            logger.warn(`${serviceLocation}: [BullseyeLM] NIfTI generation failed for mask ${maskId}: ${stderr || error.message}`);
                            resolve(false);
                        } else {
                            resolve(true);
                        }
                    });
                });

                if (!pythonOk || !(await fs.pathExists(niftiPath))) {
                    logger.warn(`${serviceLocation}: [BullseyeLM] NIfTI not produced for mask ${maskId} — skipping GPU call`);
                    continue;
                }

                // 4b. Call GPU /bullseye/analyze with landmark coords
                const form = new FormData();
                form.append('file', fs.createReadStream(niftiPath), {
                    filename: path.basename(niftiPath),
                    contentType: 'application/gzip',
                });
                form.append('rv_insertion_1_x', String(avgLm1[0]));
                form.append('rv_insertion_1_y', String(avgLm1[1]));
                form.append('rv_insertion_2_x', String(avgLm2[0]));
                form.append('rv_insertion_2_y', String(avgLm2[1]));

                const response = await axios.post(`${gpuBaseUrl}/bullseye/analyze`, form, {
                    headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
                    timeout: 120000,
                });

                if (response.status !== 200 || !response.data) {
                    logger.warn(`${serviceLocation}: [BullseyeLM] GPU returned ${response.status} for mask ${maskId} — skipping store`);
                    continue;
                }

                // 4c. Overwrite bullseye on the mask document
                const bullseyeData = {
                    ...response.data,
                    computed_at: new Date().toISOString(),
                };
                const writeResult = await projectSegmentationMaskModel.collection.updateOne(
                    { _id: new mongoose.Types.ObjectId(maskId) },
                    { $set: { bullseye: bullseyeData, updatedAt: new Date() } },
                );
                logger.info(
                    `${serviceLocation}: [BullseyeLM] Stored landmark-aligned bullseye for mask ${maskId} ` +
                    `alignment_source=${bullseyeData.alignment_source} alignment_angle_deg=${bullseyeData.alignment_angle_deg} ` +
                    `matched=${writeResult.matchedCount} modified=${writeResult.modifiedCount}`
                );
            } catch (maskErr: any) {
                logger.warn(`${serviceLocation}: [BullseyeLM] Failed for mask ${maskId}: ${maskErr?.message}`);
            }
        }

        logger.info(`${serviceLocation}: [BullseyeLM] Landmark-aligned recompute complete for project ${projectId}`);
    } catch (err: any) {
        logger.warn(`${serviceLocation}: [BullseyeLM] Outer error for project ${projectId}: ${err?.message}`);
    } finally {
        try {
            if (await fs.pathExists(baseTempDir)) {
                await fs.remove(baseTempDir);
            }
        } catch { /* cleanup failure is non-fatal */ }
    }
}

/**
 * Generates a segmentation NIfTI file specifically for 4D reconstruction
 * Uses editable masks (user-refined segmentation) for better reconstruction accuracy
 * 
 * @param projectId - The project ID to generate segmentation NIfTI for
 * @param userId - The user ID (for access validation)
 * @returns Promise with success status, S3 URL, and metadata
 */
/**
 * Resolve a mask doc to a model. Mirrors the frontend `inferDocModel`
 * and the backend reconstruction.ts copy so behaviour is consistent
 * across all three call sites. Returns null when there's no signal —
 * never guesses a model.
 */
const inferMaskModelForExport = (mask: IProjectSegmentationMask): "medsam" | "unet" | null => {
    const tag = (
        (mask as any).segmentationModel ||
        (mask as any).model_used ||
        ""
    )
        .toString()
        .toLowerCase();
    if (tag === "medsam" || tag === "unet") return tag;
    const name = (mask.name || "").toString().toLowerCase();
    if (name.includes("unet")) return "unet";
    if (name.includes("medsam")) return "medsam";
    if (name.startsWith("ai output")) return "medsam";
    if (name.startsWith("manual edit -") || name === "manual edit") return "medsam";
    return null;
};

export const generateAISegmentationForReconstruction = async (
    projectId: string,
    userId?: string,
    /**
     * Optional segmentation-model scope. When set to "medsam" or "unet",
     * the function will only consider masks resolving to that model and
     * fail explicitly if none are available. When omitted, behaviour
     * matches the original (model-agnostic) implementation.
     */
    segmentationModel?: "medsam" | "unet"
): Promise<{
    success: boolean;
    message?: string;
    s3Url?: string;
    fileSizeBytes?: number;
    s3Key?: string;
}> => {
    const tempExportId = uuidv4();
    const baseTempDir = path.join(__dirname, '..', 'temp_exports', tempExportId);
    const segmentationsJsonPath = path.join(baseTempDir, 'segmentations.json');
    const localOutputSegmentationNiftiPath = path.join(baseTempDir, `reconstruction_${tempExportId}.nii.gz`);

    logger.info(`${serviceLocation}: Generating AI segmentation NIfTI for project ${projectId}`);

    try {
        const s3BucketName = process.env.AWS_BUCKET_NAME;
        if (!s3BucketName) {
            return { success: false, message: "AWS S3 bucket configuration is missing." };
        }

        await fs.ensureDir(baseTempDir);

        // 1. Validate segmentation masks exist
        const hasMasksResult = await readProjectSegmentationMask(projectId);
        if (!hasMasksResult.projectsegmentationmasks || hasMasksResult.projectsegmentationmasks.length === 0) {
            return { success: false, message: "No segmentation masks found. Run AI segmentation first for reconstruction." };
        }

        // 2. Read Project Details (including dimensions and original NIfTI path)
        const projectResult = await readProject(projectId, userId);
        if (!projectResult.success || !projectResult.projects || projectResult.projects.length === 0) {
            logger.warn(`${serviceLocation}: Project ${projectId} not found or user ${userId} does not have access.`);
            return { success: false, message: "Project not found or access denied." };
        }
        
        const project: IProjectDocument = projectResult.projects[0];

        if (!project.dimensions || project.dimensions.width == null || project.dimensions.height == null) {
            logger.error(`${serviceLocation}: Project ${projectId} is missing critical dimension data (width/height).`);
            return { success: false, message: "Project is missing critical dimension data." };
        }

        const planeHeightForRLE = project.dimensions.height;
        const planeWidthForRLE = project.dimensions.width;

        // 3. Select the best reconstruction mask set.
        // Prefer the editable mask, but fall back to the AI mask if the editable export is missing myocardium labels.
        // When `segmentationModel` is provided, candidates are restricted
        // to that model so MedSAM and UNet results never leak into each
        // other. When omitted, original (legacy) behaviour is preserved.
        const candidatePool = segmentationModel
            ? hasMasksResult.projectsegmentationmasks!.filter(
                  m => inferMaskModelForExport(m) === segmentationModel
              )
            : hasMasksResult.projectsegmentationmasks!;

        if (segmentationModel) {
            logger.info(
                `${serviceLocation}: Scoped to segmentationModel=${segmentationModel} for project ${projectId}. Pool size: ${candidatePool.length}/${hasMasksResult.projectsegmentationmasks!.length}.`
            );
            if (candidatePool.length === 0) {
                logger.error(
                    `${serviceLocation}: No mask docs resolve to segmentationModel=${segmentationModel} for project ${projectId}.`
                );
                return {
                    success: false,
                    message: `No ${segmentationModel.toUpperCase()} segmentation masks found for reconstruction. Run ${segmentationModel.toUpperCase()} segmentation first.`,
                };
            }
        }

        const editableMask = candidatePool.find(mask => mask.isMedSAMOutput === false);
        const aiMask = candidatePool.find(mask => mask.isMedSAMOutput === true);

        const maskHasMyocardium = (mask?: IProjectSegmentationMask) =>
            !!mask?.frames?.some(frame =>
                frame.slices?.some(slice =>
                    slice.segmentationmasks?.some(entry => String(entry.class).toLowerCase() === "myo")
                )
            );

        let segmentationsToProcess: IProjectSegmentationMask[] = [];
        let exportMask: IProjectSegmentationMask | undefined;
        if (editableMask && maskHasMyocardium(editableMask)) {
            segmentationsToProcess = [editableMask];
            exportMask = editableMask;
            logger.info(`${serviceLocation}: Using editable mask for reconstruction`);
        } else if (aiMask && maskHasMyocardium(aiMask)) {
            segmentationsToProcess = [aiMask];
            exportMask = aiMask;
            logger.warn(`${serviceLocation}: Editable mask has no myocardium labels; falling back to AI mask for reconstruction`);
        } else if (editableMask) {
            logger.error(`${serviceLocation}: No myocardium (myo/label 2) found in editable or AI masks for project ${projectId}`);
            return { success: false, message: "Reconstruction requires myocardium labels in the segmentation masks. Please re-run segmentation or verify the saved masks." };
        } else {
            logger.error(`${serviceLocation}: No editable mask found for project ${projectId}`);
            return { success: false, message: "No editable segmentation mask available for reconstruction. Please complete or refine segmentation first." };
        }

        if (!exportMask) {
            throw new Error("Editable mask not found for this segmentation export");
        }

        // Write segmentation data for Python processing
        await fs.writeJson(segmentationsJsonPath, segmentationsToProcess, { spaces: 2 });
        
        // Log segmentation data being processed
        const maskStructure = {
            maskId: exportMask._id,
            frameCount: exportMask.frames?.length || 0,
            isMedSAMOutput: exportMask.isMedSAMOutput,
            firstFrameIndex: exportMask.frames?.[0]?.frameindex,
            lastFrameIndex: exportMask.frames?.[exportMask.frames.length - 1]?.frameindex
        };
        logger.info(`${serviceLocation}: Segmentation mask structure for project ${projectId}: ${JSON.stringify(maskStructure)}`);
        
        // Log detailed class distribution across frames for debugging
        const classDistribution: Record<string, number> = {};
        let totalMasks = 0;
        exportMask.frames?.forEach(frame => {
            frame.slices?.forEach(slice => {
                slice.segmentationmasks?.forEach(mask => {
                    const className = mask.class || 'unknown';
                    classDistribution[className] = (classDistribution[className] || 0) + 1;
                    totalMasks++;
                });
            });
        });
        const classInfo = {
            classes: classDistribution,
            totalMasks,
            hasLVC: !!classDistribution['LVC'],
            hasMYO: !!classDistribution['MYO'],
            hasRV: !!classDistribution['RV']
        };
        logger.info(`${serviceLocation}: Segmentation class distribution for project ${projectId}: ${JSON.stringify(classInfo)}`);

        // 4. Generate NIfTI using Python script
        let pythonScriptPath: string;
        let pythonCommand: string;

        if (project.affineMatrix && Array.isArray(project.affineMatrix) && project.affineMatrix.length > 0) {
            // Use stored affine matrix approach (faster, no S3 download required)
            pythonScriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'create_nifti_with_stored_affine.py');

            const affineMatrixFile = path.join(baseTempDir, 'affine_matrix.json');
            const dimensionsFile = path.join(baseTempDir, 'dimensions.json');

            await fs.writeJson(affineMatrixFile, project.affineMatrix, { spaces: 2 });
            await fs.writeJson(dimensionsFile, project.dimensions, { spaces: 2 });
            
            // Log critical NIfTI generation parameters
            const niftiParams = {
                dimensions: project.dimensions,
                planeWidth: planeWidthForRLE,
                planeHeight: planeHeightForRLE,
                affineMatrixShape: `${project.affineMatrix.length}x${project.affineMatrix[0]?.length}`,
                expectedShape: project.dimensions.frames 
                    ? `(${project.dimensions.height}, ${project.dimensions.width}, ${project.dimensions.slices}, ${project.dimensions.frames})`
                    : `(${project.dimensions.height}, ${project.dimensions.width}, ${project.dimensions.slices})`
            };
            logger.info(`${serviceLocation}: NIfTI generation parameters for project ${projectId}: ${JSON.stringify(niftiParams)}`);

            pythonCommand = `python3 "${pythonScriptPath}" "${segmentationsJsonPath}" "${localOutputSegmentationNiftiPath}" "${affineMatrixFile}" "${dimensionsFile}" "uint8" ${planeHeightForRLE} ${planeWidthForRLE}`;
        } else {
            // Use download and extract approach (legacy)
            logger.info(`${serviceLocation}: No stored affine matrix found for reconstruction of project ${projectId}. Using download approach.`);

            pythonScriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'create_nifti_segmentation.py');
            const s3Url = project.extractedfolderpath;

            if (!s3Url) {
                return { success: false, message: "Project has no associated S3 file path." };
            }

            pythonCommand = `python3 "${pythonScriptPath}" "${segmentationsJsonPath}" "${localOutputSegmentationNiftiPath}" ${planeWidthForRLE} ${planeHeightForRLE} "${s3Url}"`;
        }

        logger.info(`${serviceLocation}: Saving output - executing Python script for reconstruction NIfTI generation of project ${projectId}`);
        logger.debug(`${serviceLocation}: Python command: ${pythonCommand}`);

        const pythonResult = await new Promise<{ success: boolean; stdout?: string; stderr?: string; error?: string }>((resolve) => {
            exec(pythonCommand, (error, stdout, stderr) => {
                if (error) {
                    logger.error(`${serviceLocation}: Python script execution failed for reconstruction of project ${projectId}: ${error.message}`);
                    logger.error(`${serviceLocation}: Python stderr: ${stderr}`);
                    resolve({ success: false, error: error.message, stderr });
                } else {
                    logger.info(`${serviceLocation}: Python script completed successfully for reconstruction of project ${projectId}`);
                    if (stdout) {
                        logger.info(`${serviceLocation}: Python stdout: ${stdout}`);
                    }
                    if (stderr) {
                        logger.warn(`${serviceLocation}: Python stderr (warnings): ${stderr}`);
                    }
                    resolve({ success: true, stdout, stderr });
                }
            });
        });

        if (!pythonResult.success) {
            return { success: false, message: `NIfTI generation failed for reconstruction: ${pythonResult.error}` };
        }

        // 5. Check if the output file was created
        const outputExists = await fs.pathExists(localOutputSegmentationNiftiPath);
        if (!outputExists) {
            logger.error(`${serviceLocation}: Expected NIfTI output file not created for reconstruction of project ${projectId}: ${localOutputSegmentationNiftiPath}`);
            return { success: false, message: "NIfTI file was not generated successfully for reconstruction." };
        }

        const fileStats = await fs.stat(localOutputSegmentationNiftiPath);
        logger.info(`${serviceLocation}: Successfully generated reconstruction NIfTI for project ${projectId}. File size: ${fileStats.size} bytes`);

        // 6. Upload to S3
        const fileStream = fs.createReadStream(localOutputSegmentationNiftiPath);
        const uploadedUrl = await uploadMaskToS3(
            fileStream,
            userId || 'system',
            tempExportId,
            '.nii.gz',
            'reconstruction_nifti/',
            `reconstruction_${projectId}_${tempExportId}.nii.gz`
        );

        // Extract S3 key from the returned URL
        const s3Key = extractS3KeyFromUrl(uploadedUrl);
        if (!s3Key) {
            logger.error(`${serviceLocation}: Failed to extract S3 key from uploaded URL: ${uploadedUrl}`);
            return { success: false, message: "Failed to extract S3 key after upload." };
        }

        logger.info(`${serviceLocation}: Saving output - successfully uploaded reconstruction NIfTI to S3`);

        // Generate presigned URL for GPU server access (internal endpoint so GPU container can resolve it)
        const presignedUrl = await generatePresignedGetUrlForInternalService(s3BucketName, s3Key, 3600);

        // Fire bullseye analysis non-blocking for ALL editable masks in the project,
        // using each mask's own RLE frame data so MedSAM and UNet produce independent results.
        const allEditableMasks = hasMasksResult.projectsegmentationmasks!.filter(
            m => m.isMedSAMOutput === false
        );
        for (const editableMaskForBullseye of allEditableMasks) {
            const bullseyeMaskId = editableMaskForBullseye._id?.toString();
            if (!bullseyeMaskId) continue;

            const maskFrames = editableMaskForBullseye.frames ?? [];
            if (!maskFrames.length) {
                logger.warn(`${serviceLocation}: [Bullseye] Skipping mask ${bullseyeMaskId} (${editableMaskForBullseye.name}) — no frame data`);
                continue;
            }

            // Use each mask's own RLE frame data (not the shared reconstruction NIfTI)
            computeBullseyeFromMaskDoc(bullseyeMaskId, maskFrames, planeWidthForRLE, planeHeightForRLE)
                .catch((err: any) => {
                    logger.warn(`${serviceLocation}: [Bullseye] Failed for mask ${bullseyeMaskId} (${editableMaskForBullseye.name}): ${err?.message}`);
                });
            logger.info(`${serviceLocation}: [Bullseye] Fired non-blocking bullseye analysis for mask ${bullseyeMaskId} (${editableMaskForBullseye.name})`);

            // Heart metrics (volumes / EF / LV mass) — parallel to bullseye. Requires the project's
            // stored affine matrix; without it voxel volume is undefined and the script would refuse.
            if (project.affineMatrix && Array.isArray(project.affineMatrix) && project.affineMatrix.length > 0) {
                computeHeartMetricsFromMaskDoc(bullseyeMaskId, maskFrames, planeWidthForRLE, planeHeightForRLE, project.affineMatrix)
                    .catch((err: any) => {
                        logger.warn(`${serviceLocation}: [HeartMetrics] Failed for mask ${bullseyeMaskId} (${editableMaskForBullseye.name}): ${err?.message}`);
                    });
                logger.info(`${serviceLocation}: [HeartMetrics] Fired non-blocking heart-metrics compute for mask ${bullseyeMaskId} (${editableMaskForBullseye.name})`);
            } else {
                logger.warn(`${serviceLocation}: [HeartMetrics] Skipped mask ${bullseyeMaskId} (${editableMaskForBullseye.name}) — project ${projectId} has no stored affineMatrix`);
            }
        }

        return {
            success: true,
            message: "AI segmentation NIfTI generated successfully for reconstruction.",
            s3Key: s3Key,
            s3Url: presignedUrl || undefined,
            fileSizeBytes: fileStats.size
        };

    } catch (error: any) {
        logger.error(`${serviceLocation}: Error generating AI segmentation NIfTI for reconstruction of project ${projectId}:`, error);
        return { success: false, message: `Error generating AI segmentation NIfTI for reconstruction: ${error.message}` };
    } finally {
        // Clean up temporary files
        if (await fs.pathExists(baseTempDir)) {
            await fs.remove(baseTempDir);
        }
    }
};
