import axios, { AxiosError } from "axios";
import type {
  LandmarkInferenceResponse,
  FramePrediction,
} from "@/types/landmark";

const baseURL = process.env.NEXT_PUBLIC_API_URL;
if (!baseURL) {
  console.error("[landmarkApi] NEXT_PUBLIC_API_URL is not defined.");
}

const api = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 120_000, 
});

const LANDMARK_USE_STUB =
  process.env.NEXT_PUBLIC_LANDMARK_USE_STUB !== "false";

/**
 * ⚠️ SWAP THIS when real model is ready:
 *   NEXT_PUBLIC_LANDMARK_USE_STUB=false
 *   NEXT_PUBLIC_LANDMARK_ENDPOINT=/landmark-detection/infer
 *
 * Real endpoint POST body: multipart/form-data { file: File }
 * Real endpoint response:  LandmarkInferenceResponse
 */
const LANDMARK_ENDPOINT =
  process.env.NEXT_PUBLIC_LANDMARK_ENDPOINT ?? "/landmark-detection/infer";

const predictionCache = new Map<string, LandmarkInferenceResponse>();

function cacheKey(projectId: string, filename: string): string {
  return `${projectId}::${filename}`;
}

export const landmarkApi = {
  /**
   * @param projectId   - VisHeart project ID (for cache key + API path)
   * @param file        - .nii or .nii.gz File object from upload picker
   * @param onProgress  - optional 0–100 progress callback during upload
   */
  runDetection: async (
    projectId: string,
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<LandmarkInferenceResponse> => {
    const key = cacheKey(projectId, file.name);

    if (predictionCache.has(key)) {
      console.log("[landmarkApi] ✅ Returning cached predictions for", file.name);
      return predictionCache.get(key)!;
    }

    if (LANDMARK_USE_STUB) {
      console.warn(
        "[landmarkApi] ⚠️  Using STUB response. " +
        "Set NEXT_PUBLIC_LANDMARK_USE_STUB=false when real model is ready.",
      );
      const result = await mockInferenceResponse(file);
      predictionCache.set(key, result);
      return result;
    }
    console.log("[landmarkApi] 🚀 Calling real inference endpoint:", LANDMARK_ENDPOINT);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await api.post<LandmarkInferenceResponse>(
        LANDMARK_ENDPOINT,
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
        throw new LandmarkApiError(
          "empty_predictions",
          "The model returned no landmark predictions. Please check the uploaded file.",
        );
      }

      predictionCache.set(key, response.data);
      return response.data;
    } catch (err) {
      if (err instanceof LandmarkApiError) throw err;
      handleAxiosError(err as AxiosError);
    }

    // unreachable, but TypeScript needs it
    throw new LandmarkApiError("unknown", "Unknown error occurred.");
  },

  clearCache: (projectId: string, filename: string) => {
    predictionCache.delete(cacheKey(projectId, filename));
  },

  clearAllCache: () => {
    predictionCache.clear();
  },
};

// Error class 
export type LandmarkErrorCode =
  | "invalid_file"
  | "upload_failed"
  | "inference_failed"
  | "timeout"
  | "empty_predictions"
  | "unknown";

export class LandmarkApiError extends Error {
  constructor(
    public code: LandmarkErrorCode,
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
      "Landmark detection timed out. The file may be too large or the server is busy. Please try again.",
    );
  }
  if (!err.response) {
    throw new LandmarkApiError(
      "upload_failed",
      "Could not reach the inference server. Please check your connection and try again.",
    );
  }
  const status = err.response.status;
  if (status === 422) {
    throw new LandmarkApiError(
      "invalid_file",
      "The server rejected the file. Please ensure it is a valid NIfTI cardiac MRI file.",
    );
  }
  if (status >= 500) {
    throw new LandmarkApiError(
      "inference_failed",
      `Inference failed on the server (HTTP ${status}). Please try again or contact support.`,
    );
  }
  throw new LandmarkApiError(
    "unknown",
    `Unexpected error (HTTP ${status}). Please try again.`,
  );
}

// ⚠️ STUB: mock response generator 
/**
 * Generates realistic-looking per-frame landmark predictions.
 * Simulates cardiac motion across frames with slight coordinate variation.
 *
 * ⚠️ DELETE this function after W2 D3 real integration is confirmed.
 */
async function mockInferenceResponse(file: File): Promise<LandmarkInferenceResponse> {
  const delay = 1500 + Math.random() * 1000;
  await new Promise((r) => setTimeout(r, delay));

  const TOTAL_FRAMES = 10; 
  const W = 256, H = 256;

  // Base positions (centre of image)
  const baseRV1: [number, number] = [162, 108];
  const baseRV2: [number, number] = [158, 148];
  const baseApex: [number, number] = [128, 220];
  const baseBasalAnt: [number, number] = [128, 60];
  const motion = (frame: number, amplitude: number) =>
    Math.round(Math.sin((frame / TOTAL_FRAMES) * 2 * Math.PI) * amplitude);

  const predictions: FramePrediction[] = Array.from(
    { length: TOTAL_FRAMES },
    (_, i) => ({
      frame_id: i,
      rv_insertion_1: [baseRV1[0] + motion(i, 4),  baseRV1[1] + motion(i, 3)]  as [number,number],
      rv_insertion_2: [baseRV2[0] + motion(i, 3),  baseRV2[1] + motion(i, 4)]  as [number,number],
      apex:           [baseApex[0] + motion(i, 2),  baseApex[1] + motion(i, 2)] as [number,number],
      basal_anterior: [baseBasalAnt[0] + motion(i, 3), baseBasalAnt[1] + motion(i, 2)] as [number,number],
      basal_inferior: [100 + motion(i, 4), 195 + motion(i, 3)] as [number,number],
      basal_lateral:  [200 + motion(i, 5), 128 + motion(i, 4)] as [number,number],
      mid_anterior:   [128 + motion(i, 2), 110 + motion(i, 2)] as [number,number],
    }),
  );

  return {
    predictions,
    total_frames: TOTAL_FRAMES,
    model_used: "HRNet-LV (stub)",
    image_dimensions: { width: W, height: H },
  };
}
