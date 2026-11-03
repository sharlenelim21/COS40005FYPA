
import mongoose from "mongoose";
import logger from "./logger";
import { getCurrentToken } from "./gpu_auth_client";
import {
    jobModel,
    projectSegmentationMaskModel,
    projectReconstructionModel,
    readUser,
    JobStatus,
    IUserSafe,
} from "./database";
import { findBlockingSegmentationJob, startInference, startModel2Inference } from "./inference";
import { startReconstruction } from "./reconstruction";
import { startLandmarkInference } from "./landmark_inference";
import { SegmentationModel, ReconstructionChamber } from "../types/database_types";

const serviceLocation = "PipelineOrchestrator";

export type PipelineModelName = "medsam" | "unet";
export type PipelineChamber = "lv" | "rv";
export type PipelineStepKind = "seg" | "recon" | "landmark";
export type PipelineStepStatus = "pending" | "starting" | "queued" | "running" | "done" | "failed" | "skipped";

export interface IPipelineStep {
    kind: PipelineStepKind;
    model?: PipelineModelName;
    chamber?: PipelineChamber;
    status: PipelineStepStatus;
    jobUuid?: string | null;
    note?: string | null;
    claimedAt?: Date | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    reconRequest?: Record<string, unknown> | null;
}

export interface IPipeline {
    projectId: string;
    userId: string;
    status: "active" | "finished";
    steps: IPipelineStep[];
    createdAt?: Date;
    updatedAt?: Date;
}

const pipelineStepSchema = new mongoose.Schema({
    kind: { type: String, required: true, enum: ["seg", "recon", "landmark"] },
    model: { type: String, required: false, enum: ["medsam", "unet"] },
    chamber: { type: String, required: false, enum: ["lv", "rv"] },
    status: { type: String, required: true, enum: ["pending", "starting", "queued", "running", "done", "failed", "skipped"] },
    jobUuid: { type: String, required: false },
    note: { type: String, required: false },
    claimedAt: { type: Date, required: false },
    startedAt: { type: Date, required: false },
    finishedAt: { type: Date, required: false },
    reconRequest: { type: mongoose.Schema.Types.Mixed, required: false },
}, { _id: false });

const pipelineSchema = new mongoose.Schema({
    projectId: { type: String, required: true },
    userId: { type: String, required: true },
    status: { type: String, required: true, enum: ["active", "finished"], default: "active" },
    steps: { type: [pipelineStepSchema], required: true },
}, { timestamps: true });
pipelineSchema.index({ projectId: 1 }, { unique: true, partialFilterExpression: { status: "active" } });
pipelineSchema.index({ status: 1 });

export const pipelineModel = mongoose.model<IPipeline & mongoose.Document>("Pipeline", pipelineSchema);

const RECONCILE_INTERVAL_MS = 30_000;
const STARTING_CLAIM_TIMEOUT_MS = 2 * 60_000;
const MISSING_JOB_GRACE_MS = 2 * 60_000;
const MASK_WRITE_GRACE_MS = 2 * 60_000;
const STALE_MINUTES = {
    seg: { medsam: 30, unet: 90 } as Record<PipelineModelName, number>,
    recon: 60,
    landmark: 30,
};

const SEG_ORDER: PipelineModelName[] = ["medsam", "unet"];
const isTerminal = (s: PipelineStepStatus) => s === "done" || s === "failed" || s === "skipped";
const modelLabel = (m?: PipelineModelName) => (m === "unet" ? "UNet" : "MedSAM");
const ageMs = (d?: Date | null) => (d ? Date.now() - new Date(d).getTime() : Infinity);

export interface PipelineSelectionInput {
    segModels: PipelineModelName[];
    combos: { model: PipelineModelName; chamber: PipelineChamber; request?: Record<string, unknown> }[];
    runLandmark: boolean;
    landmarkModel?: PipelineModelName;
}

export function buildPipelineSteps(selection: PipelineSelectionInput): IPipelineStep[] {
    const segModels = SEG_ORDER.filter((m) => selection.segModels.includes(m));
    const steps: IPipelineStep[] = [];
    for (const model of segModels) {
        steps.push({ kind: "seg", model, status: "pending" });
        for (const chamber of ["lv", "rv"] as PipelineChamber[]) {
            const combo = selection.combos.find((c) => c.model === model && c.chamber === chamber);
            if (combo) steps.push({ kind: "recon", model, chamber, status: "pending", reconRequest: combo.request ?? null });
        }
    }
    if (selection.runLandmark && segModels.length > 0) {
        const model = selection.landmarkModel && segModels.includes(selection.landmarkModel)
            ? selection.landmarkModel
            : segModels.includes("unet") ? "unet" : segModels[0];
        steps.push({ kind: "landmark", model, status: "pending" });
    }
    return steps;
}

async function patchStep(
    pipelineId: string,
    i: number,
    patch: Partial<IPipelineStep>,
    expect?: PipelineStepStatus,
): Promise<boolean> {
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) set[`steps.${i}.${k}`] = v;
    if (patch.status && isTerminal(patch.status) && !("finishedAt" in patch)) set[`steps.${i}.finishedAt`] = new Date();
    const filter: Record<string, unknown> = { _id: pipelineId, status: "active" };
    if (expect) filter[`steps.${i}.status`] = expect;
    const res = await pipelineModel.updateOne(filter, { $set: set });
    return res.modifiedCount === 1;
}

async function newestEditableMaskAt(projectId: string, model: PipelineModelName): Promise<Date | null> {
    const mask = await projectSegmentationMaskModel
        .findOne({ projectid: projectId, isMedSAMOutput: false, segmentationModel: model }, { createdAt: 1 })
        .sort({ createdAt: -1 })
        .lean<{ createdAt?: Date }>();
    return mask?.createdAt ?? null;
}

async function reconstructionExistsSince(projectId: string, model: PipelineModelName, chamber: PipelineChamber, since: Date): Promise<boolean> {
    const chamberFilter = chamber === "rv" ? { chamber: ReconstructionChamber.RV } : { chamber: { $in: [ReconstructionChamber.LV, null] } };
    const found = await projectReconstructionModel.exists({
        projectid: projectId,
        segmentationModel: model,
        ...chamberFilter,
        createdAt: { $gte: since },
    });
    return !!found;
}

async function reconstructionExistsForModel(projectId: string, model: PipelineModelName): Promise<boolean> {
    return !!(await projectReconstructionModel.exists({ projectid: projectId, segmentationModel: model }));
}

async function findInFlightReconJob(projectId: string, model: PipelineModelName, chamber: PipelineChamber) {
    const chamberFilter = chamber === "rv" ? { chamber: ReconstructionChamber.RV } : { chamber: { $in: [ReconstructionChamber.LV, null] } };
    return jobModel.findOne({
        projectid: projectId,
        segmentationModel: model,
        model_used: "4d_reconstruction",
        status: { $in: [JobStatus.PENDING, JobStatus.IN_PROGRESS] },
        ...chamberFilter,
    }).sort({ createdAt: -1 }).lean<{ uuid: string; status: string; createdAt?: Date }>();
}

async function findInFlightLandmarkJob(projectId: string, model: PipelineModelName) {
    return jobModel.findOne({
        projectid: projectId,
        model_used: /landmark/i,
        segmentationModel: model,
        status: { $in: [JobStatus.PENDING, JobStatus.IN_PROGRESS] },
        createdAt: { $gte: new Date(Date.now() - STALE_MINUTES.landmark * 60_000) },
    }).sort({ createdAt: -1 }).lean<{ uuid: string; status: string; createdAt?: Date }>();
}

const fromJobStatus = (s: unknown): PipelineStepStatus | null => {
    switch (String(s ?? "").toLowerCase()) {
        case JobStatus.PENDING: return "queued";
        case JobStatus.IN_PROGRESS: return "running";
        case JobStatus.COMPLETED: return "done";
        case JobStatus.FAILED: return "failed";
        default: return null;
    }
};

async function refreshInFlightStep(projectId: string, step: IPipelineStep): Promise<Partial<IPipelineStep> | null> {
    const startedAt = step.startedAt ? new Date(step.startedAt) : null;

    if (step.kind === "seg" && step.model && startedAt) {
        const maskAt = await newestEditableMaskAt(projectId, step.model);
        if (maskAt && maskAt >= startedAt) return { status: "done", note: null };
    }
    if (step.kind === "recon" && step.model && step.chamber && startedAt) {
        if (await reconstructionExistsSince(projectId, step.model, step.chamber, startedAt)) return { status: "done", note: null };
    }

    const job = step.jobUuid
        ? await jobModel.findOne({ uuid: step.jobUuid }).lean<{ status: string; message?: string; updatedAt?: Date }>()
        : null;
    const what = step.kind === "seg" ? `${modelLabel(step.model)} segmentation`
        : step.kind === "recon" ? `${modelLabel(step.model)} ${String(step.chamber).toUpperCase()} reconstruction`
        : "Landmark detection";

    if (!job) {
        if (step.kind === "recon" && !step.jobUuid && step.model && step.chamber) {
            const inflight = await findInFlightReconJob(projectId, step.model, step.chamber);
            if (inflight) return { jobUuid: inflight.uuid, status: fromJobStatus(inflight.status) ?? step.status };
        }
        if (ageMs(startedAt) > MISSING_JOB_GRACE_MS) return { status: "failed", note: `${what} job was not found.` };
        return null;
    }

    const status = fromJobStatus(job.status);
    if (status === "failed") return { status: "failed", note: job.message || `${what} failed.` };
    if (status === "done") {
        if (step.kind === "seg") {
            if (ageMs(job.updatedAt) > MASK_WRITE_GRACE_MS) {
                return { status: "failed", note: "Segmentation finished but no editable mask was found." };
            }
            return step.status === "running" ? null : { status: "running" };
        }
        return { status: "done", note: null };
    }

    const staleMinutes = step.kind === "seg" ? STALE_MINUTES.seg[step.model ?? "medsam"]
        : step.kind === "recon" ? STALE_MINUTES.recon
        : STALE_MINUTES.landmark;
    if (ageMs(startedAt) > staleMinutes * 60_000) {
        return { status: "failed", note: `No completion received for ${what} within ${staleMinutes} min (GPU callback lost?).` };
    }
    if (status && status !== step.status) return { status };
    return null;
}

async function recoverStaleClaim(projectId: string, step: IPipelineStep): Promise<Partial<IPipelineStep>> {
    const since = step.claimedAt ? new Date(step.claimedAt) : new Date(0);
    let job: { uuid: string; status: string; createdAt?: Date } | null = null;
    if (step.kind === "seg" && step.model) {
        const blocking = await findBlockingSegmentationJob(projectId, step.model === "unet" ? SegmentationModel.UNET : SegmentationModel.MEDSAM);
        if (blocking) job = { uuid: blocking.uuid, status: blocking.status, createdAt: blocking.startedAt };
    } else if (step.kind === "recon" && step.model && step.chamber) {
        job = await findInFlightReconJob(projectId, step.model, step.chamber);
    } else if (step.kind === "landmark" && step.model) {
        job = await findInFlightLandmarkJob(projectId, step.model);
    }
    if (job && job.createdAt && new Date(job.createdAt) >= since) {
        return { status: fromJobStatus(job.status) ?? "queued", jobUuid: job.uuid, startedAt: since, note: "resumed after restart" };
    }
    return { status: "pending", claimedAt: null, note: null };
}

type StartOutcome = Partial<IPipelineStep>;

async function startSegStep(projectId: string, user: IUserSafe, token: string, step: IPipelineStep): Promise<StartOutcome> {
    const model = step.model ?? "medsam";
    const blocking = await findBlockingSegmentationJob(projectId, model === "unet" ? SegmentationModel.UNET : SegmentationModel.MEDSAM);
    if (blocking) {
        return { status: fromJobStatus(blocking.status) ?? "queued", jobUuid: blocking.uuid, startedAt: new Date(), note: "already running" };
    }
    const result = model === "unet"
        ? await startModel2Inference(projectId, user, token, { deviceType: "auto" })
        : await startInference(projectId, user, token);
    if (result.success && result.uuid) return { status: "queued", jobUuid: result.uuid, startedAt: new Date(), note: null };
    return { status: "failed", note: result.message || "Could not start segmentation." };
}

async function startReconStep(projectId: string, user: IUserSafe, steps: IPipelineStep[], step: IPipelineStep): Promise<StartOutcome> {
    const model = step.model ?? "medsam";
    const chamber = step.chamber ?? "lv";
    const seg = steps.find((s) => s.kind === "seg" && s.model === model);
    if (seg?.status !== "done") return { status: "skipped", note: "segmentation failed" };

    const req = (step.reconRequest ?? {}) as Record<string, any>;
    const startedAt = new Date();
    const result = await startReconstruction(
        projectId,
        user,
        req.reconstructionName,
        req.reconstructionDescription,
        req.parameters,
        req.ed_frame,
        req.export_format,
        model,
        chamber,
    );
    if (result.success && result.uuid) return { status: "queued", jobUuid: result.uuid, startedAt, note: null };
    if (result.statusCode === 409 && result.reason === "already_exists") return { status: "skipped", note: "already exists" };
    if (result.statusCode === 409 && result.reason === "job_in_progress") {
        const job = await findInFlightReconJob(projectId, model, chamber);
        return { status: fromJobStatus(job?.status) ?? "queued", jobUuid: job?.uuid ?? null, startedAt, note: "already building" };
    }
    return { status: "failed", note: result.message || "could not start" };
}

async function startLandmarkStep(projectId: string, user: IUserSafe, token: string, steps: IPipelineStep[], step: IPipelineStep): Promise<StartOutcome> {
    const segs = steps.filter((s) => s.kind === "seg");
    const preferred = segs.find((s) => s.model === (step.model ?? "unet")) ?? segs[0];
    const candidates = [preferred, ...segs.filter((s) => s !== preferred)].filter(
        (s): s is IPipelineStep => !!s?.model && s.status === "done",
    );
    if (candidates.length === 0) return { status: "skipped", note: "no segmentation mask" };
    let source: IPipelineStep | undefined;
    for (const candidate of candidates) {
        if (await reconstructionExistsForModel(projectId, candidate.model as PipelineModelName)) {
            source = candidate;
            break;
        }
    }
    if (!source?.model) {
        return {
            status: "skipped",
            note: `no finished 4D reconstruction for ${candidates.map((c) => modelLabel(c.model)).join(" or ")} — build one, then run landmark detection`,
        };
    }
    const model = source.model;

    const maskAt = await newestEditableMaskAt(projectId, model);
    if (maskAt) {
        const completed = await jobModel.findOne({
            projectid: projectId,
            model_used: /landmark/i,
            segmentationModel: model,
            status: JobStatus.COMPLETED,
            createdAt: { $gte: maskAt },
        }).lean<{ uuid: string }>();
        if (completed) return { model, status: "done", jobUuid: completed.uuid, note: "already detected on this mask" };
    }

    const startedAt = new Date();
    const result = await startLandmarkInference(projectId, user, token, {
        model: "unetresnet34-landmark",
        deviceType: "auto",
        segmentationModel: model,
    });
    if (result.success && result.uuid) return { model, status: "running", jobUuid: result.uuid, startedAt, note: null };
    if (result.statusCode === 409) {
        const runningAt = result.startedAt ? new Date(result.startedAt) : null;
        if (maskAt && runningAt && runningAt < maskAt) {
            return { model, status: "pending", claimedAt: null, note: "waiting for an earlier landmark run to finish" };
        }
        return { model, status: "running", jobUuid: result.uuid ?? null, startedAt, note: null };
    }
    return { model, status: "failed", note: result.message || "Could not start landmark detection." };
}

const locks = new Map<string, Promise<void>>();

function withLock(pipelineId: string, fn: () => Promise<void>): Promise<void> {
    const prev = locks.get(pipelineId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    const tracked = next.finally(() => {
        if (locks.get(pipelineId) === tracked) locks.delete(pipelineId);
    });
    locks.set(pipelineId, tracked);
    return tracked;
}

export function advancePipeline(pipelineId: string): Promise<void> {
    return withLock(pipelineId, () => advanceUnlocked(pipelineId));
}

async function advanceUnlocked(pipelineId: string): Promise<void> {
    for (let guard = 0; guard < 16; guard++) {
        const doc = await pipelineModel.findById(pipelineId).lean<IPipeline & { _id: unknown }>();
        if (!doc || doc.status !== "active") return;
        const steps = doc.steps;

        let refreshed = false;
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            if (step.status === "starting") {
                if (ageMs(step.claimedAt) > STARTING_CLAIM_TIMEOUT_MS) {
                    const patch = await recoverStaleClaim(doc.projectId, step);
                    if (await patchStep(pipelineId, i, patch, "starting")) refreshed = true;
                    logger.warn(`${serviceLocation}: Recovered stale claim on step ${i} (${step.kind}) of pipeline ${pipelineId} -> ${patch.status}.`);
                }
                continue;
            }
            if (step.status !== "queued" && step.status !== "running") continue;
            const patch = await refreshInFlightStep(doc.projectId, step);
            if (patch && (await patchStep(pipelineId, i, patch, step.status))) {
                refreshed = true;
                if (patch.status && isTerminal(patch.status)) {
                    logger.info(`${serviceLocation}: Pipeline ${pipelineId} step ${i} (${step.kind} ${step.model ?? ""} ${step.chamber ?? ""}) -> ${patch.status}${patch.note ? ` (${patch.note})` : ""}.`);
                }
            }
        }
        if (refreshed) continue;

        const nextIndex = steps.findIndex((s) => !isTerminal(s.status));
        if (nextIndex === -1) {
            await pipelineModel.updateOne({ _id: pipelineId, status: "active" }, { $set: { status: "finished" } });
            logger.info(`${serviceLocation}: Pipeline ${pipelineId} for project ${doc.projectId} finished.`);
            return;
        }

        const step = steps[nextIndex];
        if (step.status !== "pending") return;

        const token = getCurrentToken();
        if (!token) {
            await patchStep(pipelineId, nextIndex, { note: "waiting for GPU service authentication" }, "pending");
            return;
        }

        if (!(await patchStep(pipelineId, nextIndex, { status: "starting", claimedAt: new Date() }, "pending"))) return;

        let outcome: StartOutcome;
        try {
            const userResult = await readUser({ _id: doc.userId });
            const user: IUserSafe | undefined = userResult.user;
            if (!userResult.success || !user) {
                outcome = { status: "failed", note: "Pipeline owner could not be loaded." };
            } else if (step.kind === "seg") {
                outcome = await startSegStep(doc.projectId, user, token, step);
            } else if (step.kind === "recon") {
                outcome = await startReconStep(doc.projectId, user, steps, step);
            } else {
                outcome = await startLandmarkStep(doc.projectId, user, token, steps, step);
            }
        } catch (error: any) {
            logger.error(`${serviceLocation}: Error starting step ${nextIndex} (${step.kind}) of pipeline ${pipelineId}: ${error?.message}`);
            return;
        }
        await patchStep(pipelineId, nextIndex, outcome, "starting");
        logger.info(`${serviceLocation}: Pipeline ${pipelineId} step ${nextIndex} (${step.kind} ${outcome.model ?? step.model ?? ""} ${step.chamber ?? ""}) -> ${outcome.status}${outcome.note ? ` (${outcome.note})` : ""}.`);
        if (outcome.status === "pending") return;
    }
}

export function notifyPipelineJobEvent(jobUuid: string | undefined | null): void {
    if (!jobUuid) return;
    setImmediate(async () => {
        try {
            const job = await jobModel.findOne({ uuid: jobUuid }, { projectid: 1 }).lean<{ projectid?: string }>();
            if (!job?.projectid) return;
            const pipelines = await pipelineModel.find({ projectId: job.projectid, status: "active" }, { _id: 1 }).lean();
            for (const p of pipelines) await advancePipeline(String(p._id));
        } catch (error: any) {
            logger.warn(`${serviceLocation}: Failed to advance pipeline after job ${jobUuid}: ${error?.message}`);
        }
    });
}

let reconcileTimer: NodeJS.Timeout | null = null;

async function reconcileAll(): Promise<void> {
    try {
        const active = await pipelineModel.find({ status: "active" }, { _id: 1 }).lean();
        for (const p of active) await advancePipeline(String(p._id));
    } catch (error: any) {
        logger.warn(`${serviceLocation}: Reconcile pass failed: ${error?.message}`);
    }
}

export function startPipelineReconciler(): void {
    if (reconcileTimer) return;
    void reconcileAll();
    reconcileTimer = setInterval(() => { void reconcileAll(); }, RECONCILE_INTERVAL_MS);
    if (typeof reconcileTimer.unref === "function") reconcileTimer.unref();
    logger.info(`${serviceLocation}: Pipeline reconciler started (every ${RECONCILE_INTERVAL_MS / 1000}s).`);
}

export function stopPipelineReconciler(): void {
    if (reconcileTimer) clearInterval(reconcileTimer);
    reconcileTimer = null;
}
