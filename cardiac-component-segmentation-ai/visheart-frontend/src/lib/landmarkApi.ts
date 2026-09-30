import axios, { type AxiosError } from "axios";
import type {
  LandmarkCoord,
  LandmarkInferenceResponse,
  FramePrediction,
  PersistedLandmarkDoc,
} from "@/types/landmark";
import type { RealStrainResult, RvStrainResult } from "@/components/landmark/StrainVisualization";

const baseURL = process.env.NEXT_PUBLIC_API_URL;

if (!baseURL && process.env.NODE_ENV !== "test") {
  console.warn("[landmarkApi] NEXT_PUBLIC_API_URL is not defined. Stub mode will be used.");
}

const api = axios.create({
  baseURL: baseURL ?? "",
  withCredentials: true,
  timeout: 120_000,
});

const USE_STUB = process.env.NEXT_PUBLIC_LANDMARK_USE_STUB !== "false";
const ENDPOINT = process.env.NEXT_PUBLIC_LANDMARK_ENDPOINT ?? "/landmark-detection";
const DEFAULT_MODEL = "unetresnet34-landmark";
const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_ATTEMPTS = 100;
const SEG_STALE_MINUTES: Record<"medsam" | "unet", number> = { medsam: 30, unet: 90 };
const MASK_WRITE_GRACE_MS = 60_000;

const predictionCache = new Map<string, LandmarkInferenceResponse>();

export const landmarkApi = {
  /**
   * Fetch a previously-persisted landmark detection result (if any) from the
   * backend without triggering a new GPU run. Hits GET /results/:projectId with
   * no jobUuid, which returns the most-recent completed job's parsed predictions
   * or null. Used on page mount so revisiting the page reuses the saved result
   * instead of re-running inference every time.
   *
   * Returns null when nothing is saved yet, on stub mode, or on any error — the
   * caller then falls back to running detection.
   */
  fetchPersistedResult: async (
    projectId: string,
  ): Promise<LandmarkInferenceResponse | null> => {
    if (USE_STUB) return null;
    try {
      const response = await api.get<{
        success: boolean;
        result: LandmarkInferenceResponse | null;
        source?: string;
      }>(`${ENDPOINT}/results/${projectId}`);
      const result = response.data?.result;
      if (result?.predictions?.length) {
        // Warm the in-memory cache too, so subsequent same-session reads are instant.
        predictionCache.set(`${projectId}::${DEFAULT_MODEL}::medsam`, result);
        return result;
      }
      return null;
    } catch {
      return null;
    }
  },

  runDetectionByProject: async (
    projectId: string,
    model = DEFAULT_MODEL,
    segmentationModel = "medsam",
  ): Promise<LandmarkInferenceResponse> => {
    const key = `${projectId}::${model}::${segmentationModel}`;

    if (predictionCache.has(key)) {
      if (process.env.NODE_ENV === "development") {
        console.log("[landmarkApi] Cache hit for project", projectId);
      }
      return predictionCache.get(key)!;
    }

    if (USE_STUB) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[landmarkApi] STUB MODE - set NEXT_PUBLIC_LANDMARK_USE_STUB=false to use UNetResNet34.",
        );
      }
      const result = await mockInferenceResponse(projectId);
      predictionCache.set(key, result);
      return result;
    }

    try {
      const jobUuid = await landmarkApi.startDetection(
        projectId,
        segmentationModel === "unet" ? "unet" : "medsam",
        model,
      );
      const result = await pollLandmarkResult(projectId, jobUuid);
      if (!result?.predictions?.length) {
        throw new LandmarkApiError(
          "empty_predictions",
          "The model returned no landmark predictions for this project.",
        );
      }

      predictionCache.set(key, result);
      return result;
    } catch (err) {
      if (err instanceof LandmarkApiError) throw err;
      return handleAxiosError(err as AxiosError);
    }
  },

  runDetectionWithFile: async (
    projectId: string,
    file: File,
    model = DEFAULT_MODEL,
    onProgress?: (pct: number) => void,
  ): Promise<LandmarkInferenceResponse> => {
    const key = `${projectId}::${model}::${file.name}`;

    if (predictionCache.has(key)) {
      return predictionCache.get(key)!;
    }

    if (USE_STUB) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[landmarkApi] STUB MODE (file re-upload path)");
      }
      const result = await mockInferenceResponse(projectId);
      predictionCache.set(key, result);
      return result;
    }

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("project_id", projectId);
      formData.append("model", model);

      const response = await api.post<LandmarkInferenceResponse>(
        `${ENDPOINT}/upload`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (evt) => {
            if (onProgress && evt.total) {
              onProgress(Math.round((evt.loaded / evt.total) * 100));
            }
          },
        },
      );

      if (!response.data.predictions?.length) {
        throw new LandmarkApiError("empty_predictions", "Model returned no predictions.");
      }

      predictionCache.set(key, response.data);
      return response.data;
    } catch (err) {
      if (err instanceof LandmarkApiError) throw err;
      return handleAxiosError(err as AxiosError);
    }
  },

  invalidateCache: (projectId: string) => {
    const toDelete: string[] = [];
    for (const key of predictionCache.keys()) {
      if (key === projectId || key.startsWith(`${projectId}::`)) {
        toDelete.push(key);
      }
    }
    toDelete.forEach((key) => predictionCache.delete(key));
  },

  hasCached: (projectId: string): boolean => {
    for (const key of predictionCache.keys()) {
      if (key === projectId || key.startsWith(`${projectId}::`)) return true;
    }
    return false;
  },

  getCached: (projectId: string): LandmarkInferenceResponse | null => {
    for (const [key, value] of predictionCache.entries()) {
      if (key === projectId || key.startsWith(`${projectId}::`)) return value;
    }
    return null;
  },

  startDetection: async (
    projectId: string,
    segmentationModel: "medsam" | "unet",
    model = DEFAULT_MODEL,
  ): Promise<string> => {
    let response;
    try {
      response = await api.post<{ success: boolean; message: string; uuid?: string }>(
        `${ENDPOINT}/start/${projectId}`,
        { model, deviceType: "auto", segmentationModel },
      );
    } catch (err) {
      const conflict = (err as AxiosError<{ jobUuid?: string }>).response;
      if (conflict?.status === 409 && conflict.data?.jobUuid) return conflict.data.jobUuid;
      throw err;
    }
    if (!response.data.success || !response.data.uuid) {
      throw new LandmarkApiError(
        "inference_failed",
        response.data.message || "Failed to start landmark detection.",
      );
    }
    return response.data.uuid;
  },

  probeJob: async (
    projectId: string,
    jobUuid: string,
    segmentationModel: "medsam" | "unet",
  ): Promise<{ status: "active" | "completed" | "failed" | "missing"; message?: string }> => {
    const response = await api.get<{
      success: boolean;
      result: LandmarkInferenceResponse | null;
      job?: { status?: string; message?: string } | null;
    }>(`${ENDPOINT}/results/${projectId}`, { params: { jobUuid } });
    const result = response.data.result;
    if (result?.predictions?.length) {
      predictionCache.set(`${projectId}::${DEFAULT_MODEL}::${segmentationModel}`, result);
      return { status: "completed" };
    }
    const status = (response.data.job?.status ?? "").toLowerCase();
    if (!response.data.job) return { status: "missing" };
    if (status === "failed") return { status: "failed", message: response.data.job.message };
    if (status === "completed") {
      return { status: "failed", message: "Landmark job completed but its result could not be read." };
    }
    return { status: "active" };
  },

  findActiveJob: async (
    projectId: string,
  ): Promise<{ uuid: string; segmentationModel: "medsam" | "unet"; createdAt: number | null } | null> => {
    if (USE_STUB) return null;
    try {
      const response = await api.get<{ success: boolean; jobs: Array<Record<string, unknown>> }>(
        `${ENDPOINT}/jobs/${projectId}`,
      );
      const cutoff = Date.now() - 30 * 60 * 1000;
      const job = (response.data?.jobs ?? []).find((j) => {
        if (!/landmark/i.test(String(j.model_used ?? ""))) return false;
        const status = String(j.status ?? "").toLowerCase();
        if (status !== "pending" && status !== "in_progress") return false;
        const created = Date.parse(String(j.createdAt ?? ""));
        return !Number.isFinite(created) || created >= cutoff;
      });
      if (!job?.uuid) return null;
      const seg = String(job.segmentationModel ?? "").toLowerCase() === "unet" ? "unet" : "medsam";
      const created = Date.parse(String(job.createdAt ?? ""));
      return { uuid: String(job.uuid), segmentationModel: seg, createdAt: Number.isFinite(created) ? created : null };
    } catch {
      return null;
    }
  },

  findCompletedJobSince: async (
    projectId: string,
    segmentationModel: "medsam" | "unet",
    since: number,
  ): Promise<string | null> => {
    if (USE_STUB) return null;
    try {
      const response = await api.get<{ success: boolean; jobs: Array<Record<string, unknown>> }>(
        `${ENDPOINT}/jobs/${projectId}`,
      );
      const job = (response.data?.jobs ?? []).find((j) => {
        if (!/landmark/i.test(String(j.model_used ?? ""))) return false;
        if (String(j.status ?? "").toLowerCase() !== "completed") return false;
        const seg = String(j.segmentationModel ?? "").toLowerCase() === "unet" ? "unet" : "medsam";
        if (seg !== segmentationModel) return false;
        const created = Date.parse(String(j.createdAt ?? ""));
        return Number.isFinite(created) && created >= since;
      });
      return job?.uuid ? String(job.uuid) : null;
    } catch {
      return null;
    }
  },

  segmentationPending: async (
    projectId: string,
    maskCreatedAt: Record<"medsam" | "unet", number | null>,
  ): Promise<boolean> => {
    if (USE_STUB) return false;
    try {
      const response = await api.get<{ success: boolean; jobs: Array<Record<string, unknown>> }>(
        `${ENDPOINT}/jobs/${projectId}`,
      );
      const now = Date.now();
      const seen = new Set<string>();
      for (const j of response.data?.jobs ?? []) {
        const used = String(j.model_used ?? "");
        if (/landmark|4d_reconstruction/i.test(used)) continue;
        const model = String(j.segmentationModel ?? "").toLowerCase() === "unet" ? "unet" : "medsam";
        if (seen.has(model)) continue;
        seen.add(model);

        const status = String(j.status ?? "").toLowerCase();
        const created = Date.parse(String(j.createdAt ?? ""));
        if (!Number.isFinite(created)) continue;
        if (status === "pending" || status === "in_progress") {
          if (created >= now - SEG_STALE_MINUTES[model] * 60 * 1000) return true;
        } else if (status === "completed") {
          const mask = maskCreatedAt[model];
          if (mask !== null && mask >= created) continue;
          const finished = Date.parse(String(j.updatedAt ?? ""));
          if (!Number.isFinite(finished) || finished >= now - MASK_WRITE_GRACE_MS) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  },

  jobSummary: async (
    projectId: string,
  ): Promise<{ active: "running" | "queued" | null; hasCompleted: boolean } | null> => {
    if (USE_STUB) return { active: null, hasCompleted: landmarkApi.hasCached(projectId) };
    try {
      const response = await api.get<{ success: boolean; jobs: Array<Record<string, unknown>> }>(
        `${ENDPOINT}/jobs/${projectId}`,
      );
      const cutoff = Date.now() - 30 * 60 * 1000;
      const landmarkJobs = (response.data?.jobs ?? []).filter((j) => /landmark/i.test(String(j.model_used ?? "")));
      let active: "running" | "queued" | null = null;
      for (const j of landmarkJobs) {
        const status = String(j.status ?? "").toLowerCase();
        if (status !== "pending" && status !== "in_progress") continue;
        const created = Date.parse(String(j.createdAt ?? ""));
        if (Number.isFinite(created) && created < cutoff) continue;
        if (status === "in_progress") active = "running";
        else active ??= "queued";
      }
      const hasCompleted = landmarkJobs.some((j) => String(j.status ?? "").toLowerCase() === "completed");
      return { active, hasCompleted };
    } catch {
      return null;
    }
  },

  attachToJob: async (
    projectId: string,
    jobUuid: string,
    segmentationModel: "medsam" | "unet",
  ): Promise<LandmarkInferenceResponse> => {
    const result = await pollLandmarkResult(projectId, jobUuid);
    predictionCache.set(`${projectId}::${DEFAULT_MODEL}::${segmentationModel}`, result);
    return result;
  },

  computeStrain: async (projectId: string, formData: FormData): Promise<RealStrainResult> => {
    const response = await api.post<RealStrainResult>(
      `${ENDPOINT}/compute-strain/${projectId}`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return response.data;
  },

  saveLandmarks: async (
    projectId: string,
    data: {
      name?: string;
      description?: string;
      frames: PersistedLandmarkDoc["frames"];
      segmentationModel?: "medsam" | "unet";
      landmarkModel?: string;
    },
  ): Promise<{ success: boolean; message?: string; landmark?: PersistedLandmarkDoc }> => {
    const response = await api.put(`${ENDPOINT}/save-landmarks/${projectId}`, data);
    return response.data;
  },

  loadSavedLandmarks: async (
    projectId: string,
    segmentationModel?: "medsam" | "unet",
  ): Promise<PersistedLandmarkDoc | null> => {
    const response = await api.get<{ success: boolean; result: PersistedLandmarkDoc | null }>(
      `${ENDPOINT}/load-landmarks/${projectId}`,
      { params: segmentationModel ? { segmentationModel } : undefined },
    );
    return response.data.result ?? null;
  },
};

export async function computeStrainFromFrames(
  projectId: string,
  edFrameIndex: number,
  esFrameIndex: number,
  modelType: "unet" | "medsam" = "unet",
): Promise<RealStrainResult> {
  const response = await api.post<RealStrainResult>(
    `/segmentation/compute-strain-from-frames`,
    { projectId, edFrameIndex, esFrameIndex, modelType },
  );
  return response.data;
}

export async function computeRvStrainFromFrames(
  projectId: string,
  edFrameIndex: number,
  esFrameIndex: number,
  modelType: "unet" | "medsam" = "unet",
): Promise<RvStrainResult> {
  const response = await api.post<RvStrainResult>(
    `/segmentation/compute-rv-strain-from-frames`,
    { projectId, edFrameIndex, esFrameIndex, modelType },
  );
  return response.data;
}

export async function computeStrainSeries(
  projectId: string,
  edFrameIndex: number,
  modelType: "unet" | "medsam" = "unet",
  frameStep = 1,
): Promise<{
  frames: { frameIndex: number; global_grs: number | null; global_gcs: number | null;
            segments: { segment: number; label: string; grs: number | null; gcs: number | null }[] }[];
  edFrameIndex: number;
  peakFrameIndex?: number | null;
  peak_global_grs: number | null;
  peak_global_gcs: number | null;
  framesRequested?: number;
  framesComputed?: number;
}> {
  const response = await api.post(
    `/segmentation/compute-strain-series`,
    { projectId, edFrameIndex, modelType, frameStep },
    // One GPU call per frame — well beyond the default client timeout.
    { timeout: 600000 },
  );
  return response.data;
}

export async function computeRvStrainSeries(
  projectId: string,
  edFrameIndex: number,
  modelType: "unet" | "medsam" = "unet",
  frameStep = 1,
): Promise<{
  frames: { frameIndex: number; global_rv_strain: number | null;
            regions: { region: number; label: string; strain: number | null; radius_mm?: number | null }[] }[];
  edFrameIndex: number;
  peakFrameIndex?: number | null;
  peak_global_rv_strain: number | null;
  framesRequested?: number;
  framesComputed?: number;
}> {
  const response = await api.post(
    `/segmentation/compute-rv-strain-series`,
    { projectId, edFrameIndex, modelType, frameStep },
    { timeout: 600000 },
  );
  return response.data;
}

export type LandmarkErrorCode =
  | "inference_failed"
  | "timeout"
  | "empty_predictions"
  | "network_error"
  | "server_error"
  | "invalid_project"
  | "unknown";

export class LandmarkApiError extends Error {
  constructor(
    public readonly code: LandmarkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LandmarkApiError";
  }
}

async function pollLandmarkResult(
  projectId: string,
  jobUuid: string,
): Promise<LandmarkInferenceResponse> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const response = await api.get<{
      success: boolean;
      result: LandmarkInferenceResponse | null;
      job?: { status?: string; message?: string } | null;
      message?: string;
    }>(`${ENDPOINT}/results/${projectId}`, {
      params: { jobUuid },
    });

    const polledResult = response.data.result;
    if (polledResult?.predictions?.length) {
      return polledResult;
    }

    if (response.data.job?.status === "failed") {
      throw new LandmarkApiError(
        "inference_failed",
        response.data.job.message || "Landmark detection failed.",
      );
    }

    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new LandmarkApiError(
    "timeout",
    "Landmark detection timed out. The server may still be processing this project.",
  );
}

function handleAxiosError(err: AxiosError): never {
  const serverMessage = extractServerErrorMessage(err.response?.data);
  if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
    throw new LandmarkApiError(
      "timeout",
      "Landmark detection timed out. The server may be busy. Please try again.",
    );
  }
  if (!err.response) {
    throw new LandmarkApiError(
      "network_error",
      "Could not reach the inference server. Check your connection and try again.",
    );
  }
  const status = err.response.status;
  if (status === 404) {
    throw new LandmarkApiError(
      "invalid_project",
      "Project MRI data not found. Please ensure the project has been fully uploaded.",
    );
  }
  if (status >= 500) {
    throw new LandmarkApiError(
      "server_error",
      serverMessage || `Inference server error (HTTP ${status}). Please try again or contact support.`,
    );
  }
  throw new LandmarkApiError("unknown", serverMessage || `Unexpected error (HTTP ${status}). Please try again.`);
}

function extractServerErrorMessage(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed.length > 0 && trimmed.length < 500 ? trimmed : null;
  }
  if (typeof data !== "object") return null;

  const record = data as Record<string, unknown>;
  for (const key of ["message", "detail", "error"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

async function mockInferenceResponse(projectId: string): Promise<LandmarkInferenceResponse> {
  await new Promise<void>((resolve) => setTimeout(resolve, 1500 + Math.random() * 800));

  const totalFrames = 10;
  const width = 256;
  const height = 256;
  const seed = projectId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const jitter = (base: number) => base + ((seed % 7) - 3);

  const basePositions = {
    rv1: [jitter(162), jitter(108)] as [number, number],
    rv2: [jitter(158), jitter(148)] as [number, number],
    apex: [jitter(128), jitter(220)] as [number, number],
    basalAnterior: [jitter(128), jitter(60)] as [number, number],
    basalInferior: [jitter(100), jitter(195)] as [number, number],
    basalLateral: [jitter(200), jitter(128)] as [number, number],
    midAnterior: [jitter(128), jitter(110)] as [number, number],
  };

  const motion = (frame: number, amplitude: number) =>
    Math.round(Math.sin((frame / totalFrames) * 2 * Math.PI) * amplitude);

  const predictions: FramePrediction[] = Array.from({ length: totalFrames }, (_, index) => ({
    frame_id: index,
    rv_insertion_1: [
      basePositions.rv1[0] + motion(index, 4),
      basePositions.rv1[1] + motion(index, 3),
    ] as LandmarkCoord,
    rv_insertion_2: [
      basePositions.rv2[0] + motion(index, 3),
      basePositions.rv2[1] + motion(index, 4),
    ] as LandmarkCoord,
    apex: [
      basePositions.apex[0] + motion(index, 2),
      basePositions.apex[1] + motion(index, 2),
    ] as LandmarkCoord,
    basal_anterior: [
      basePositions.basalAnterior[0] + motion(index, 3),
      basePositions.basalAnterior[1] + motion(index, 2),
    ] as LandmarkCoord,
    basal_inferior: [
      basePositions.basalInferior[0] + motion(index, 4),
      basePositions.basalInferior[1] + motion(index, 3),
    ] as LandmarkCoord,
    basal_lateral: [
      basePositions.basalLateral[0] + motion(index, 5),
      basePositions.basalLateral[1] + motion(index, 4),
    ] as LandmarkCoord,
    mid_anterior: [
      basePositions.midAnterior[0] + motion(index, 2),
      basePositions.midAnterior[1] + motion(index, 2),
    ] as LandmarkCoord,
  }));

  return {
    predictions,
    total_frames: totalFrames,
    model_used: "UNetResNet34 Landmark (stub)",
    image_dimensions: { width, height },
  };
}

export type { LandmarkInferenceResponse, FramePrediction };
