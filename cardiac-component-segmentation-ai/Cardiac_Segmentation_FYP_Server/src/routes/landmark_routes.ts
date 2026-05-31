import express, { Request, Response } from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import { isAuth } from "../services/passportjs";
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware";
import { startLandmarkInference } from "../services/landmark_inference";
import { jobModel, readProject } from "../services/database";
import { JobStatus } from "../types/database_types";
import logger from "../services/logger";
import { getFreshGPUServerAddress, getCurrentToken } from "../services/gpu_auth_client";

const memUpload = multer({ storage: multer.memoryStorage() });

const router = express.Router();
const serviceLocation = "LandmarkRoutes";

const parseCompletedLandmarkJobResult = (job: any) => {
  try {
    const r = typeof job.result === "string" ? JSON.parse(job.result) : job.result;
    if (!r) return null;

    // Old format already has predictions[]
    if (Array.isArray(r.predictions) && r.predictions.length > 0) return r;

    // New format: slices[] → translate to predictions[] the frontend understands.
    //
    // The GPU processes NIfTI shape[2] spatial slices from cardiac frame 0.
    // Each entry s.slice is the SPATIAL slice index (0, 1, 2 …).
    // The tar image cache keys are {projectId}_f{frame}_s{slice}, so:
    //   frame_id = 0     (always cardiac frame 0 — what the GPU ran on)
    //   slice_id = s.slice  (spatial position in the stack)
    // This lets getMRIImage(0, 0), getMRIImage(0, 1), getMRIImage(0, 2) resolve
    // correctly and the mask overlay lookup also matches editable_frame_0_slice_N_*.
    if (Array.isArray(r.slices) && r.slices.length > 0) {
      const predictions = r.slices.map((s: any) => ({
        frame_id: 0,
        slice_id: s.slice,
        rv_insertion_1: [s.lm1?.x ?? 0, s.lm1?.y ?? 0],
        rv_insertion_2: [s.lm2?.x ?? 0, s.lm2?.y ?? 0],
        // Carry through quality fields so the frontend can show confidence dots
        flag:        s.flag,
        confidence:  s.confidence,
        model_used:  s.model_used,
        display_mean: s.display_mean ?? null,
        hm1_max:     s.hm1_max,
        hm2_max:     s.hm2_max,
        lm_dist:     s.lm_dist,
      }));
      return {
        predictions,
        total_frames: r.n_total ?? predictions.length,
        model_used:   "UNetResNet34 Landmark",
        // image_dimensions from GPU response if present, else leave 0 so
        // the frontend falls back to projectData.dimensions (correct for this project).
        image_dimensions: r.image_dimensions ?? { width: 0, height: 0 },
        // Pass through the new top-level summary fields
        avg_lm1:       r.avg_lm1,
        avg_lm2:       r.avg_lm2,
        n_total:       r.n_total,
        n_collapsed:   r.n_collapsed,
        n_2ch:         r.n_2ch,
        n_1ch_fallback: r.n_1ch_fallback,
      };
    }

    return null;
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
          segmentationModel: req.body?.segmentationModel || "medsam",
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

// ── POST /compute-strain/:projectId ──────────────────────────────────────────
// Accepts ED + ES NIfTI uploads, proxies to GPU /bullseye/compute-strain.
// Landmark coordinates for this project are looked up automatically.
router.post(
  "/compute-strain/:projectId",
  isAuth,
  memUpload.fields([
    { name: "ed_file", maxCount: 1 },
    { name: "es_file", maxCount: 1 },
  ]),
  async (req: Request, res: Response): Promise<void> => {
    const projectId = String(req.params.projectId);
    const files = req.files as { [field: string]: Express.Multer.File[] } | undefined;
    const edFile = files?.["ed_file"]?.[0];
    const esFile = files?.["es_file"]?.[0];

    if (!edFile || !esFile) {
      res.status(400).json({ message: "Both ed_file and es_file are required." });
      return;
    }

    try {
      // Look up landmark coords for automatic alignment
      const landmarkJob = await jobModel
        .findOne({ projectid: projectId, model_used: /landmark/i, status: JobStatus.COMPLETED, result: { $exists: true, $ne: null } })
        .sort({ updatedAt: -1 })
        .lean();

      const extractCoord = (lm: any): { x: number; y: number } | null => {
        if (!lm) return null;
        if (typeof lm.x === "number" && typeof lm.y === "number") return { x: lm.x, y: lm.y };
        if (Array.isArray(lm) && lm.length >= 2) return { x: lm[0], y: lm[1] };
        return null;
      };
      const lmResult = landmarkJob?.result
        ? (typeof landmarkJob.result === "string" ? JSON.parse(landmarkJob.result) : landmarkJob.result)
        : null;
      const lm1 = extractCoord(lmResult?.avg_lm1);
      const lm2 = extractCoord(lmResult?.avg_lm2);

      const gpuBaseUrl = await getFreshGPUServerAddress();
      const token = getCurrentToken();
      if (!gpuBaseUrl || !token) {
        res.status(503).json({ message: "GPU service unavailable." });
        return;
      }

      const form = new FormData();
      form.append("ed_file", edFile.buffer, { filename: edFile.originalname, contentType: "application/octet-stream" });
      form.append("es_file", esFile.buffer, { filename: esFile.originalname, contentType: "application/octet-stream" });
      if (lm1) {
        form.append("rv_insertion_1_x", String(lm1.x));
        form.append("rv_insertion_1_y", String(lm1.y));
      }
      if (lm2) {
        form.append("rv_insertion_2_x", String(lm2.x));
        form.append("rv_insertion_2_y", String(lm2.y));
      }

      const response = await axios.post(`${gpuBaseUrl}/bullseye/compute-strain`, form, {
        headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
        timeout: 120000,
      });

      logger.info(`${serviceLocation}: Strain computed for project ${projectId} | alignment=${response.data?.alignment_source}`);
      res.status(200).json(response.data);
    } catch (err: any) {
      logger.error(`${serviceLocation}: compute-strain failed for project ${projectId}: ${err?.message}`);
      res.status(500).json({ message: err?.response?.data?.detail ?? err?.message ?? "Strain computation failed." });
    }
  },
);

export default router;
