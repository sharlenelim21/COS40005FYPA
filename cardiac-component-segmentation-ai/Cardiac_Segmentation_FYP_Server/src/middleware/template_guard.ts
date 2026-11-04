// File: src/middleware/template_guard.ts
// Description: Keeps TEMPLATE projects read-only.
//
// Template projects ("template hearts", IProject.isTemplate) can be viewed by
// every logged-in user (services/template_access.ts), so every request that
// could change one must come from its owner — the template account. Rather
// than relying on each route's own ownership check (they vary), this guard
// sits in front of every write route of the project / segmentation /
// reconstruction / landmark routers:
//
//   router.param("projectId" | "maskId" | "reconstructionId", ...) — URL ids
//   router.use(guardBodyIds)                                       — JSON body ids
//
// GET/HEAD/OPTIONS always pass (reads). A blocked request gets 403.

import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { projectModel, projectReconstructionModel, projectSegmentationMaskModel } from "../services/database";
import logger from "../services/logger";

const serviceLocation = "TemplateGuard";
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const isReadOnlyTemplate = async (projectId: unknown, user: any): Promise<boolean> => {
    const id = String(projectId ?? "");
    if (!mongoose.isValidObjectId(id)) return false;
    const project: any = await projectModel.findById(id).select({ isTemplate: 1, userid: 1 }).lean();
    return !!project?.isTemplate && String(project.userid) !== String(user?._id ?? "");
};

const projectOfMask = async (maskId: unknown): Promise<string | null> => {
    const id = String(maskId ?? "");
    if (!mongoose.isValidObjectId(id)) return null;
    const mask: any = await projectSegmentationMaskModel.findById(id).select({ projectid: 1 }).lean();
    return mask?.projectid ? String(mask.projectid) : null;
};

const projectOfReconstruction = async (reconstructionId: unknown): Promise<string | null> => {
    const id = String(reconstructionId ?? "");
    if (!mongoose.isValidObjectId(id)) return null;
    const recon: any = await projectReconstructionModel.findById(id).select({ projectid: 1 }).lean();
    return recon?.projectid ? String(recon.projectid) : null;
};

const reject = (req: Request, res: Response, projectId: string) => {
    logger.warn(`${serviceLocation}: Blocked ${req.method} ${req.originalUrl} on template project ${projectId} by user ${(req.user as any)?.username ?? "<anonymous>"}`);
    res.status(403).json({ success: false, message: "Template projects are read-only." });
};

type ParamGuard = (req: Request, res: Response, next: NextFunction, value: any) => Promise<void>;

const paramGuard = (toProjectId: (value: unknown) => Promise<string | null>): ParamGuard =>
    async (req, res, next, value) => {
        if (READ_METHODS.has(req.method)) return next();
        try {
            const projectId = await toProjectId(value);
            if (projectId && (await isReadOnlyTemplate(projectId, req.user))) return reject(req, res, projectId);
        } catch (err: any) {
            logger.warn(`${serviceLocation}: check failed for ${req.method} ${req.originalUrl}: ${err?.message}`);
        }
        next();
    };

export const guardProjectIdParam = paramGuard(async (v) => String(v ?? "") || null);
export const guardMaskIdParam = paramGuard(projectOfMask);
export const guardReconstructionIdParam = paramGuard(projectOfReconstruction);

/** Write requests that name the project (or a mask) in the JSON body or query. */
export const guardBodyIds = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (READ_METHODS.has(req.method)) return next();
    try {
        const body: any = req.body ?? {};
        const candidates: (string | null)[] = [
            body.projectId ?? (req.query?.projectId as string | undefined) ?? null,
            body.segmentationMaskId ? await projectOfMask(body.segmentationMaskId) : null,
            body.maskId ? await projectOfMask(body.maskId) : null,
        ];
        for (const projectId of candidates) {
            if (projectId && (await isReadOnlyTemplate(projectId, req.user))) return reject(req, res, projectId);
        }
    } catch (err: any) {
        logger.warn(`${serviceLocation}: body check failed for ${req.method} ${req.originalUrl}: ${err?.message}`);
    }
    next();
};

/** Attach every guard to a router (call once, before its routes are used). */
export const applyTemplateGuard = (router: any): void => {
    router.use(guardBodyIds);
    router.param("projectId", guardProjectIdParam);
    router.param("maskId", guardMaskIdParam);
    router.param("reconstructionId", guardReconstructionIdParam);
};
