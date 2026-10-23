// File: src/routes/assignment_review_routes.ts
// Admin's queue of segmentation masks flagged "consider for retraining" — feeds the existing
// /extend-training (retraining_routes.ts) workflow. Kept separate from retraining_routes.ts,
// which runs the actual retraining job; this is just the lightweight flagging scaffold that
// surfaces what's waiting for Admin's attention (see flaggedForRetrain).

import { Request, Response, Router } from "express";
import { isAuthAndAdmin } from "../services/passportjs";
import { projectSegmentationMaskModel, projectModel } from "../services/database";
import LogError from "../utils/error_logger";
import logger from "../services/logger";

const router = Router();
const serviceLocation = "AssignmentReviewRoutes";

// GET /admin/flagged-masks — every mask flagged for retraining consideration, across all
// projects, newest first, joined with its project's name/owner for display.
router.get("/flagged-masks", isAuthAndAdmin, async (req: Request, res: Response) => {
    try {
        const flaggedMasks = await projectSegmentationMaskModel
            .find({ flaggedForRetrain: true })
            .sort({ flaggedAt: -1 })
            .lean();

        const projectIds = [...new Set(flaggedMasks.map((m) => String(m.projectid)))];
        const projects = await projectModel.find({ _id: { $in: projectIds } }).lean();
        const projectById = new Map(projects.map((p) => [String(p._id), p]));

        const results = flaggedMasks.map((mask) => {
            const project = projectById.get(String(mask.projectid));
            return {
                maskId: mask._id,
                maskName: mask.name,
                projectId: mask.projectid,
                projectName: project?.name ?? "(project not found)",
                flaggedAt: (mask as any).flaggedAt,
                flaggedByUserId: (mask as any).flaggedByUserId,
            };
        });

        logger.info(`${serviceLocation}: Admin ${req.user?.username} listed ${results.length} flagged mask(s).`);
        return res.status(200).json({ success: true, flaggedMasks: results });
    } catch (error) {
        LogError(error as Error, serviceLocation, "Error listing flagged masks");
        return res.status(500).json({ success: false, message: "An unexpected error occurred while listing flagged masks." });
    }
});

export default router;
