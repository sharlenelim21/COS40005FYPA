import express, { Request, Response } from "express";
import { isAuth } from "../services/passportjs";
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware";
import { startLandmarkInference } from "../services/landmark_inference";
import { jobModel, projectLandmarkDetectionModel, readProject } from "../services/database";

const router = express.Router();

router.post(
  "/start/:projectId",
  isAuth,
  injectGpuAuthToken,
  async (req: Request, res: Response): Promise<void> => {
    const projectId = String(req.params.projectId);
    const model = req.body?.model || "unetresnet34-landmark";
    const deviceType = req.body?.deviceType || "auto";

    const result = await startLandmarkInference(projectId, req.user, res.locals.gpuAuthToken, {
      model,
      deviceType,
      checkpointPath: req.body?.checkpointPath,
    });

    if (!result.success) {
      res.status(500).json(result);
      return;
    }

    res.status(202).json(result);
  }
);

router.get(
  "/results/:projectId",
  isAuth,
  async (req: Request, res: Response): Promise<void> => {
    const projectId = String(req.params.projectId);
    const projectResult = await readProject(projectId);
    const project = projectResult.projects?.[0];

    if (!projectResult.success || !project || project.userid?.toString() !== req.user?._id?.toString()) {
      res.status(404).json({ success: false, message: "Project not found.", result: null });
      return;
    }

    const result = await projectLandmarkDetectionModel
      .findOne({ projectid: projectId })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      result,
    });
  }
);

router.get(
  "/jobs/:projectId",
  isAuth,
  async (req: Request, res: Response): Promise<void> => {
    const projectId = String(req.params.projectId);
    const jobs = await jobModel
      .find({ projectid: projectId, userid: req.user?._id?.toString() })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.status(200).json({ success: true, jobs });
  }
);

export default router;
