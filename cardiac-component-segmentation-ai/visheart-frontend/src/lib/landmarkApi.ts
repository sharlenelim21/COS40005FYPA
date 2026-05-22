import axios, { type AxiosError } from "axios";
import type {
  LandmarkCoord,
  LandmarkInferenceResponse,
  FramePrediction,
} from "@/types/landmark";

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

const predictionCache = new Map<string, LandmarkInferenceResponse>();

export const landmarkApi = {
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
      const startResponse = await api.post<{
        success: boolean;
        message: string;
        uuid?: string;
      }>(`${ENDPOINT}/start/${projectId}`, {
        model,
        deviceType: "auto",
        segmentationModel,
      });

      if (!startResponse.data.success || !startResponse.data.uuid) {
        throw new LandmarkApiError(
          "inference_failed",
          startResponse.data.message || "Failed to start landmark detection.",
        );
      }

      const result = await pollLandmarkResult(projectId, startResponse.data.uuid);
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
};

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
