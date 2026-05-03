import axios, { type AxiosError } from "axios";
import type { LandmarkCoord, LandmarkInferenceResponse, FramePrediction } from "@/types/landmark";

const baseURL = process.env.NEXT_PUBLIC_API_URL;

if (!baseURL && process.env.NODE_ENV !== "test") {
  console.warn("[landmarkApi] NEXT_PUBLIC_API_URL is not defined. Stub mode will be used.");
}

const api = axios.create({
  baseURL: baseURL ?? "",
  withCredentials: true,
  timeout: 120_000,  
});

const USE_STUB =
  process.env.NEXT_PUBLIC_LANDMARK_USE_STUB !== "false"; 

const ENDPOINT =
  process.env.NEXT_PUBLIC_LANDMARK_ENDPOINT ?? "/landmark-detection/infer";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 300; // 15 minutes for CPU-backed local inference.

function normaliseStoredResult(data: any): LandmarkInferenceResponse | null {
  const result = data?.result ?? data;
  if (!result?.predictions?.length) return null;
  return {
    predictions: result.predictions,
    total_frames: result.totalFrames ?? result.total_frames ?? result.predictions.length,
    model_used: result.modelUsed ?? result.model_used ?? "UNetResNet34 Landmark",
    image_dimensions: result.imageDimensions ?? result.image_dimensions ?? { width: 256, height: 256 },
  };
}

const predictionCache = new Map<string, LandmarkInferenceResponse>();


export const landmarkApi = {
  /**
   * @param projectId  -
   * @param model     
   */
  runDetectionByProject: async (
    projectId: string,
    model = "unetresnet34-landmark",
    forceNew = false,
    minPredictions = 1,
  ): Promise<LandmarkInferenceResponse> => {
    const cachedPrediction = predictionCache.get(projectId);
    if (!forceNew && cachedPrediction && cachedPrediction.predictions.length < minPredictions) {
      predictionCache.delete(projectId);
    }

    if (!forceNew && predictionCache.has(projectId)) {
      if (process.env.NODE_ENV === "development") {
        console.log("[landmarkApi] ✅ Cache hit for project", projectId);
      }
      return predictionCache.get(projectId)!;
    }

    if (USE_STUB) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[landmarkApi] ⚠️  STUB MODE — set NEXT_PUBLIC_LANDMARK_USE_STUB=false when model is ready.",
        );
      }
      const result = await mockInferenceResponse(projectId);
      predictionCache.set(projectId, result);
      return result;
    }

    try {
      if (!forceNew) {
        const existing = await api.get(`/landmark-detection/results/${projectId}`);
        const existingResult = normaliseStoredResult(existing.data);
        if (existingResult && existingResult.predictions.length >= minPredictions) {
          predictionCache.set(projectId, existingResult);
          return existingResult;
        }
      }

      const startResponse = await api.post(`/landmark-detection/start/${projectId}`, {
        model,
        deviceType: "auto",
      });
      const jobUuid = startResponse.data?.uuid;

      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
        await sleep(POLL_INTERVAL_MS);
        const response = await api.get(`/landmark-detection/results/${projectId}`, {
          params: jobUuid ? { jobUuid } : undefined,
        });
        const result = normaliseStoredResult(response.data);
        if (result && result.predictions.length >= minPredictions) {
          predictionCache.set(projectId, result);
          return result;
        }
      }

      throw new LandmarkApiError(
        "timeout",
        "Landmark detection is taking longer than expected. It may still finish in the background, especially when running on CPU.",
      );
    } catch (err) {
      if (err instanceof LandmarkApiError) throw err;
      return handleAxiosError(err as AxiosError);
    }
  },

  /**
   * @param projectId    
   * @param file       
   * @param model      
   * @param onProgress   
   */
  runDetectionWithFile: async (
    projectId: string,
    file: File,
    model = "unetresnet34-landmark",
    onProgress?: (pct: number) => void,
  ): Promise<LandmarkInferenceResponse> => {
    const key = `${projectId}::${file.name}`;

    if (predictionCache.has(key)) {
      return predictionCache.get(key)!;
    }

    if (USE_STUB) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[landmarkApi] ⚠️  STUB MODE (file re-upload path)");
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
    // Remove both primary and any file-keyed entries for this project
    const toDelete: string[] = [];
    for (const k of predictionCache.keys()) {
      if (k === projectId || k.startsWith(`${projectId}::`)) toDelete.push(k);
    }
    toDelete.forEach((k) => predictionCache.delete(k));
  },

  hasCached: (projectId: string): boolean => predictionCache.has(projectId),
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

function handleAxiosError(err: AxiosError): never {
  if (err.code === "ECONNABORTED" || err.message?.includes("timeout")) {
    throw new LandmarkApiError(
      "timeout",
      "Landmark detection timed out. The server may be busy — please try again.",
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
    const data = err.response.data as any;
    const message =
      data?.message ||
      data?.detail ||
      data?.error ||
      `Inference server error (HTTP ${status}). Please try again or contact support.`;
    throw new LandmarkApiError(
      "server_error",
      typeof message === "string" ? message : JSON.stringify(message),
    );
  }
  throw new LandmarkApiError("unknown", `Unexpected error (HTTP ${status}). Please try again.`);
}

async function mockInferenceResponse(projectId: string): Promise<LandmarkInferenceResponse> {
  await new Promise<void>((r) => setTimeout(r, 1500 + Math.random() * 800));

  const TOTAL_FRAMES = 10;
  const W = 256, H = 256;
  const seed = projectId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const jitter = (base: number) => base + ((seed % 7) - 3);

  const basePositions = {
    rv1:  [jitter(162), jitter(108)] as [number, number],
    rv2:  [jitter(158), jitter(148)] as [number, number],
    apex: [jitter(128), jitter(220)] as [number, number],
    bant: [jitter(128), jitter(60)]  as [number, number],
    binf: [jitter(100), jitter(195)] as [number, number],
    blat: [jitter(200), jitter(128)] as [number, number],
    mant: [jitter(128), jitter(110)] as [number, number],
  };

  const mo = (frame: number, amp: number) =>
    Math.round(Math.sin((frame / TOTAL_FRAMES) * 2 * Math.PI) * amp);

  const predictions: FramePrediction[] = Array.from({ length: TOTAL_FRAMES }, (_, i) => ({
    frame_id:       i,
    rv_insertion_1: [basePositions.rv1[0]  + mo(i, 4), basePositions.rv1[1]  + mo(i, 3)] as LandmarkCoord,
    rv_insertion_2: [basePositions.rv2[0]  + mo(i, 3), basePositions.rv2[1]  + mo(i, 4)] as LandmarkCoord,
    apex:           [basePositions.apex[0] + mo(i, 2), basePositions.apex[1] + mo(i, 2)] as LandmarkCoord,
    basal_anterior: [basePositions.bant[0] + mo(i, 3), basePositions.bant[1] + mo(i, 2)] as LandmarkCoord,
    basal_inferior: [basePositions.binf[0] + mo(i, 4), basePositions.binf[1] + mo(i, 3)] as LandmarkCoord,
    basal_lateral:  [basePositions.blat[0] + mo(i, 5), basePositions.blat[1] + mo(i, 4)] as LandmarkCoord,
    mid_anterior:   [basePositions.mant[0] + mo(i, 2), basePositions.mant[1] + mo(i, 2)] as LandmarkCoord,
  }));

  return {
    predictions,
    total_frames: TOTAL_FRAMES,
    model_used: "UNetResNet34 Landmark (stub)",
    image_dimensions: { width: W, height: H },
  };
}

export type { LandmarkInferenceResponse, FramePrediction };
