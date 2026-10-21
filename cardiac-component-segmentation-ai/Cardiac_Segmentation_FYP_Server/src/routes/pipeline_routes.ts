
import { Request, Response, Router } from "express";
import logger from "../services/logger";
import LogError from "../utils/error_logger";
import { isAuth } from "../services/passportjs";
import { UserRole, userCanAccessProject } from "../services/database";
import {
    advancePipeline,
    buildPipelineSteps,
    pipelineModel,
    PipelineChamber,
    PipelineModelName,
    PipelineSelectionInput,
} from "../services/pipeline_orchestrator";

const router = Router();
const serviceLocation = "PipelineRoutes";

const asModel = (v: unknown): PipelineModelName | null =>
    v === "medsam" || v === "unet" ? v : null;
const asChamber = (v: unknown): PipelineChamber | null =>
    v === "lv" || v === "rv" ? v : null;

function toClient(doc: any) {
    if (!doc) return null;
    return {
        id: String(doc._id),
        status: doc.status,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        steps: (doc.steps ?? []).map((s: any) => ({
            kind: s.kind,
            model: s.model,
            chamber: s.chamber,
            status: s.status,
            jobUuid: s.jobUuid ?? undefined,
            note: s.note ?? undefined,
        })),
    };
}

router.post("/start/:projectId", isAuth, async (req: Request, res: Response) => {
    const projectId = String(req.params.projectId ?? "");
    const userId = String(req.user?._id ?? "");
    try {
        // Owner, an assigned Run-mode Clinical Assistant, or Admin may start the pipeline.
        // This used to check strict ownership only, which made "Run" mode meaningless for the
        // one-click pipeline — any assigned assistant always got 404 "Project not found."
        if (!projectId) {
            return res.status(404).json({ message: "Project not found." });
        }
        const access = await userCanAccessProject(projectId, req.user!);
        if (!access.canRun || !access.project) {
            return res.status(404).json({ message: "Project not found." });
        }

        const body = req.body ?? {};
        const segModels = (Array.isArray(body.segModels) ? body.segModels : [])
            .map(asModel)
            .filter((m: PipelineModelName | null): m is PipelineModelName => !!m);
        if (segModels.length === 0) {
            return res.status(400).json({ message: "Select at least one segmentation model." });
        }
        const isGuest = req.user?.role === UserRole.Guest;
        const combos = isGuest ? [] : (Array.isArray(body.combos) ? body.combos : [])
            .map((c: any) => ({
                model: asModel(c?.model),
                chamber: asChamber(c?.chamber),
                request: c?.request && typeof c.request === "object" ? c.request : undefined,
            }))
            .filter((c: any) => c.model && c.chamber) as PipelineSelectionInput["combos"];
        const selection: PipelineSelectionInput = {
            segModels,
            combos,
            runLandmark: !isGuest && !!body.runLandmark,
            landmarkModel: asModel(body.landmarkModel) ?? undefined,
        };

        const existing = await pipelineModel.findOne({ projectId, status: "active" }).lean();
        if (existing) {
            return res.status(409).json({ message: "A pipeline is already running for this project.", pipeline: toClient(existing) });
        }

        let created;
        try {
            created = await pipelineModel.create({ projectId, userId, status: "active", steps: buildPipelineSteps(selection) });
        } catch (error: any) {
            if (error?.code === 11000) {
                const winner = await pipelineModel.findOne({ projectId, status: "active" }).lean();
                return res.status(409).json({ message: "A pipeline is already running for this project.", pipeline: toClient(winner) });
            }
            throw error;
        }
        logger.info(`${serviceLocation}: Pipeline ${created._id} created for project ${projectId} by user ${userId}.`);

        const id = String(created._id);
        advancePipeline(id).catch((error: any) =>
            logger.error(`${serviceLocation}: Initial advance of pipeline ${id} failed: ${error?.message}`),
        );
        return res.status(202).json({ pipeline: toClient(created.toObject()) });
    } catch (error: unknown) {
        LogError(error as Error, serviceLocation, "Error starting pipeline");
        if (!res.headersSent) res.status(500).json({ message: "Failed to start pipeline." });
    }
});

router.get("/:projectId", isAuth, async (req: Request, res: Response) => {
    const projectId = String(req.params.projectId ?? "");
    try {
        // View-class: owner, ANY assigned Clinical Assistant (Run or View-Only), or Admin may
        // see the pipeline's status — only starting it is Run-gated (see POST /start above).
        if (!projectId) {
            return res.status(404).json({ message: "Project not found." });
        }
        const access = await userCanAccessProject(projectId, req.user!);
        if (!access.allowed || !access.project) {
            return res.status(404).json({ message: "Project not found." });
        }
        const doc = await pipelineModel.findOne({ projectId }).sort({ createdAt: -1 }).lean();
        return res.status(200).json({ pipeline: toClient(doc) });
    } catch (error: unknown) {
        LogError(error as Error, serviceLocation, "Error reading pipeline");
        if (!res.headersSent) res.status(500).json({ message: "Failed to read pipeline." });
    }
});

export default router;
