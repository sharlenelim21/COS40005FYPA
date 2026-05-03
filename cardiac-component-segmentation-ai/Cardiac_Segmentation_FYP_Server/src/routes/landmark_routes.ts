import express, { Request, Response } from "express";
import { isAuth } from "../services/passportjs";
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware";
import { startLandmarkInference } from "../services/landmark_inference";
import { jobModel, projectLandmarkDetectionModel, readProject } from "../services/database";
import { JobStatus } from "../types/database_types";

const router = express.Router();

const parseCompletedLandmarkJobResult = (job: any): unknown | null => {
  try {
    const parsedResult =
      typeof job.result === "string" ? JSON.parse(job.result) : job.result;
    return parsedResult?.predictions?.length ? parsedResult : null;
  } catch {
    return null;
  }
};

const getExpectedLandmarkPredictionCount = (project: any): number => {
  const slices = Number(project?.dimensions?.slices || 0);
  const frames = Number(project?.dimensions?.frames || 0);
  if (frames > 1 && slices > 0) return frames * slices;
  if (slices > 0) return slices;
  if (frames > 0) return frames;
  return 1;
};

const hasExpectedLandmarkCoverage = (result: any, expectedCount: number): boolean => {
  const predictions = Array.isArray(result?.predictions) ? result.predictions : [];
  return predictions.length >= Math.max(1, expectedCount);
};

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

    const expectedPredictionCount = getExpectedLandmarkPredictionCount(project);

    const jobUuid = typeof req.query.jobUuid === "string" ? req.query.jobUuid : null;
    if (jobUuid) {
      const job = await jobModel
        .findOne({
          uuid: jobUuid,
          projectid: projectId,
          userid: req.user?._id?.toString(),
        })
        .lean();

      if (!job || job.status !== JobStatus.COMPLETED || !job.result) {
        res.status(200).json({
          success: true,
          result: null,
          job: job
            ? { uuid: job.uuid, status: job.status, message: job.message }
            : null,
        });
        return;
      }

      try {
        const parsedResult =
          typeof job.result === "string" ? JSON.parse(job.result) : job.result;

        res.status(200).json({
          success: true,
          result: hasExpectedLandmarkCoverage(parsedResult, expectedPredictionCount) ? parsedResult : null,
          source: "job_result",
          job: {
            uuid: job.uuid,
            status: job.status,
            expectedPredictionCount,
            predictionCount: Array.isArray(parsedResult?.predictions) ? parsedResult.predictions.length : 0,
          },
        });
        return;
      } catch {
        res.status(200).json({
          success: true,
          result: null,
          job: {
            uuid: job.uuid,
            status: job.status,
            message: "Completed landmark job result could not be parsed.",
          },
        });
        return;
      }
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
      if (parsedResult && hasExpectedLandmarkCoverage(parsedResult, expectedPredictionCount)) {
        res.status(200).json({
          success: true,
          result: parsedResult,
          source: "job_result",
        });
        return;
      }
    }

    if (!projectLandmarkDetectionModel) {
      res.status(200).json({
        success: true,
        result: null,
        source: "none",
        message: "No saved landmark result found yet.",
      });
      return;
    }

    const result = await projectLandmarkDetectionModel
      .findOne({ projectid: projectId })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      result: hasExpectedLandmarkCoverage(result, expectedPredictionCount) ? result : null,
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
