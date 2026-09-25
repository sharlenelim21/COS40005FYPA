import mongoose from 'mongoose';
import path from 'path';
import { exec } from 'child_process';
import logger from "./logger";
import { projectSegmentationMaskModel } from "./database";
import { IProjectSegmentationMask } from "../types/database_types";

const serviceLocation = "EditTracking";
type MaskDoc = IProjectSegmentationMask & { _id: any; createdAt?: Date | string };

const modelTag = (m: MaskDoc): string =>
    String((m as any).segmentationModel || (m as any).model_used || "").toLowerCase();

/**
 * The preserved AI output this editable copy was deep-copied from: same model tag, created no later
 * than the copy, the most recent such. The webhook creates the AI document first and the copy right
 * after (webhook_routes.ts:339-348, 730-746); a re-run deletes both (764-778).
 */
export const findPairedAiMask = (editable: MaskDoc, masks: MaskDoc[]): MaskDoc | null => {
    const tag = modelTag(editable);
    if (!tag) return null;
    const time = (m: MaskDoc) => (m.createdAt ? new Date(m.createdAt).getTime() : 0);
    const limit = editable.createdAt ? time(editable) : Infinity;
    return masks
        .filter(m => m.isMedSAMOutput === true && modelTag(m) === tag && time(m) <= limit)
        .sort((a, b) => time(b) - time(a))[0] ?? null;
};

export const runEditTrackingScript = (payload: object): Promise<any | null> => new Promise(resolve => {
    const scriptPath = path.join(__dirname, '..', '..', 'src', 'python', 'compute_edit_tracking.py');
    const child = exec(`python3 "${scriptPath}"`, { maxBuffer: 1024 * 1024 * 20, timeout: 30000 }, (error, stdout, stderr) => {
        if (error) {
            logger.error(`${serviceLocation}: script failed: ${stderr || error.message}`);
            return resolve(null);
        }
        try {
            const out = JSON.parse(stdout);
            if (out.error) {
                logger.error(`${serviceLocation}: script reported: ${out.error}`);
                return resolve(null);
            }
            resolve(out);
        } catch (e) {
            logger.error(`${serviceLocation}: non-JSON output: ${(e as Error).message}`);
            resolve(null);
        }
    });
    child.stdin?.write(JSON.stringify(payload));
    child.stdin?.end();
});

/** Never throws: a tracking failure must not fail the doctor's save. */
export const computeAndStoreEditTracking = async (
    editable: MaskDoc, masks: MaskDoc[], plane: { height: number; width: number }, userId: string,
) => {
    const now = new Date().toISOString();
    const base = { model: modelTag(editable), editedBy: userId, editedAt: now, computed_at: now };
    const ai = findPairedAiMask(editable, masks);
    let editTracking: Record<string, any>;
    if (!ai) {
        editTracking = { status: "no_baseline", ...base };
    } else {
        const out = await runEditTrackingScript({ ai_frames: ai.frames, edited_frames: editable.frames, plane });
        editTracking = out
            ? { status: "computed", ...out, aiMaskId: String(ai._id), ...base }
            : { status: "failed", aiMaskId: String(ai._id), ...base };
    }
    try {
        await projectSegmentationMaskModel.collection.updateOne(
            { _id: new mongoose.Types.ObjectId(String(editable._id)) },
            { $set: { editTracking, updatedAt: new Date() } },
        );
    } catch (e) {
        logger.error(`${serviceLocation}: could not store editTracking on ${editable._id}: ${(e as Error).message}`);
        return null;
    }
    logger.info(`${serviceLocation}: mask ${editable._id} status=${editTracking.status} editedSlices=${editTracking.editedSliceCount ?? "n/a"}`);
    return {
        status: editTracking.status,
        editedSliceCount: editTracking.editedSliceCount ?? null,
        pixelsChanged: editTracking.pixelsChanged ?? null,
        manualPixels: editTracking.manualPixels ?? null,
    };
};
