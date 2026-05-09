import express, { Request, Response } from "express";
import { isAuth } from "../services/passportjs";
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware";
import { startLandmarkInference } from "../services/landmark_inference";
import { jobModel, readProject } from "../services/database";
import { JobStatus } from "../types/database_types";
import logger from "../services/logger";

const router = express.Router();
const serviceLocation = "LandmarkRoutes";

const parseCompletedLandmarkJobResult = (job: any) => {
  try {
    const parsedResult =
      typeof job.result === "string" ? JSON.parse(job.result) : job.result;
    return parsedResult?.predictions?.length ? parsedResult : null;
  } catch {
    return null;
  }
};

router.post(
  "/start/:projectId",
  isAuth,
  injectGpuAuthToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const projectId = String(req.params.projectId);
      const result = await startLandmarkInference(
        projectId,
        req.user,
        res.locals.gpuAuthToken,
        {
          model: req.body?.model || "unetresnet34-landmark",
          deviceType: req.body?.deviceType || "auto",
          checkpointPath: req.body?.checkpointPath,
        },
      );

      if (!result.success) {
        res.status(500).json(result);
        return;
      }

      res.status(202).json(result);
    } catch (error: any) {
      logger.error(`${serviceLocation}: Error starting landmark detection`, {
        projectId: req.params.projectId,
        message: error?.message,
        stack: error?.stack,
      });
      res.status(500).json({
        success: false,
        message: error?.message || "Failed to start landmark detection.",
      });
    }
  },
);

router.get(
  "/results/:projectId",
  isAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const projectId = String(req.params.projectId);
      const projectResult = await readProject(projectId);
      const project = projectResult.projects?.[0];

      if (
        !projectResult.success ||
        !project ||
        project.userid?.toString() !== req.user?._id?.toString()
      ) {
        res.status(404).json({ success: false, message: "Project not found.", result: null });
        return;
      }

      const jobUuid = typeof req.query.jobUuid === "string" ? req.query.jobUuid : null;
      if (jobUuid) {
        const job = await jobModel
          .findOne({
            uuid: jobUuid,
            projectid: projectId,
            userid: req.user?._id?.toString(),
          })
          .lean();

        if (!job) {
          res.status(200).json({ success: true, result: null, job: null });
          return;
        }

        if (job.status !== JobStatus.COMPLETED || !job.result) {
          res.status(200).json({
            success: true,
            result: null,
            job: { uuid: job.uuid, status: job.status, message: job.message },
          });
          return;
        }

        const parsedResult = parseCompletedLandmarkJobResult(job);
        res.status(200).json({
          success: true,
          result: parsedResult,
          source: parsedResult ? "job_result" : "none",
          job: {
            uuid: job.uuid,
            status: job.status,
            message: parsedResult ? undefined : "Completed landmark job result could not be parsed.",
          },
        });
        return;
      }

      const completedJobs = await jobModel
        .find({
          projectid: projectId,
          userid: req.user?._id?.toString(),
          status: JobStatus.COMPLETED,
          result: { $exists: true, $ne: null },
        })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(10)
        .lean();

      for (const job of completedJobs) {
        const parsedResult = parseCompletedLandmarkJobResult(job);
        if (parsedResult) {
          res.status(200).json({
            success: true,
            result: parsedResult,
            source: "job_result",
          });
          return;
        }
      }

      res.status(200).json({
        success: true,
        result: null,
        source: "none",
        message: "No saved landmark result found yet.",
      });
    } catch (error: any) {
      logger.error(`${serviceLocation}: Error reading landmark results`, {
        projectId: req.params.projectId,
        message: error?.message,
        stack: error?.stack,
      });
      res.status(500).json({
        success: false,
        result: null,
        message: error?.message || "Failed to read landmark results.",
      });
    }
  },
);

router.get(
  "/jobs/:projectId",
  isAuth,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const projectId = String(req.params.projectId);
      const jobs = await jobModel
        .find({ projectid: projectId, userid: req.user?._id?.toString() })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      res.status(200).json({ success: true, jobs });
    } catch (error: any) {
      logger.error(`${serviceLocation}: Error reading landmark jobs`, {
        projectId: req.params.projectId,
        message: error?.message,
        stack: error?.stack,
      });
      res.status(500).json({
        success: false,
        message: error?.message || "Failed to read landmark jobs.",
        jobs: [],
      });
    }
  },
);

export default router;
