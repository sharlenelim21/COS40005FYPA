import axios from "axios";
import { URL } from "url";
import { v4 as uuidv4 } from "uuid";
import { IUserSafe, segmentationSource } from "../types/database_types";
import { createJob, IJob, JobStatus, readProject, updateJob } from "./database";
import logger from "./logger";
import { generatePresignedGetUrl } from "../utils/s3_presigned_url";
import { getFreshGPUServerAddress } from "./gpu_auth_client";

const serviceLocation = "LandmarkInference";

const uniqueBaseUrls = (urls: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  return urls
    .filter((url): url is string => Boolean(url))
    .map((url) => url.replace(/\/$/, ""))
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
};

const isDockerGpuAlias = (url?: string | null): boolean =>
  Boolean(url && /^https?:\/\/gpu(?::|\/|$)/i.test(url));

const resolveGpuBaseUrlCandidates = async (): Promise<string[]> => {
  const directGpuApiUrl = process.env.GPU_API_URL?.replace(/\/$/, "");

  const useLocalhost =
    (process.env.MEDSAM_USE_LOCALHOST ?? "true").toLowerCase() !== "false";

  const localhostUrl = useLocalhost
    ? (
      process.env.MEDSAM_LOCAL_BASE_URL ||
      `http://${process.env.GPU_SERVER_URL || "127.0.0.1"}:${process.env.GPU_SERVER_PORT || "8001"}`
    ).replace(/\/$/, "")
    : null;

  const remoteBaseUrl = await getFreshGPUServerAddress();
  return uniqueBaseUrls([
    process.env.LOCAL_GPU_API_URL,
    "http://host.docker.internal:8011",
    isDockerGpuAlias(directGpuApiUrl) ? null : directGpuApiUrl,
    isDockerGpuAlias(localhostUrl) ? null : localhostUrl,
    isDockerGpuAlias(remoteBaseUrl) ? null : remoteBaseUrl,
  ]);
};

const buildLocalCallbackUrl = (): string | null => {
  const configuredCallbackUrl = process.env.CALLBACK_URL;
  if (!configuredCallbackUrl) return null;

  const callbackBaseUrl =
    process.env.LOCAL_CALLBACK_URL ||
    (
      configuredCallbackUrl.includes("visheart-app") ||
      configuredCallbackUrl.includes("://backend") ||
      configuredCallbackUrl.includes("://api")
        ? "http://localhost:5000"
        : configuredCallbackUrl
    );

  return `${callbackBaseUrl.replace(/\/$/, "")}/webhook/landmark-callback`;
};

export async function startLandmarkInference(
  projectId: string,
  user?: IUserSafe,
  gpuAuthToken?: string,
  modelConfig?: {
    model?: string;
    deviceType?: "cpu" | "cuda" | "auto";
    checkpointPath?: string;
  }
): Promise<{ success: boolean; message: string; uuid?: string }> {
  if (!gpuAuthToken) {
    return { success: false, message: "GPU authentication token is missing. Cannot start landmark detection." };
  }

  const s3BucketName = process.env.AWS_BUCKET_NAME;
  const callbackBaseUrl = process.env.CALLBACK_URL;
  if (!s3BucketName || !callbackBaseUrl) {
    return { success: false, message: "S3 bucket or callback URL is missing." };
  }

  const projectResult = await readProject(projectId);
  if (!projectResult.success || !projectResult.projects?.length) {
    return { success: false, message: `Project with ID ${projectId} not found.` };
  }

  const project = projectResult.projects[0];
  if (!project.originalfilepath) {
    return { success: false, message: "Project original NIfTI file is missing." };
  }

  let s3Key = "";
  try {
    const parsedUrl = new URL(project.originalfilepath);
    s3Key = parsedUrl.pathname.startsWith("/") ? parsedUrl.pathname.substring(1) : parsedUrl.pathname;
  } catch (error: any) {
    return { success: false, message: `Invalid NIfTI source URL: ${error.message}` };
  }

  const niftiPresignedUrl = await generatePresignedGetUrl(s3BucketName, s3Key);
  if (!niftiPresignedUrl) {
    return { success: false, message: "Failed to prepare NIfTI URL for landmark detection." };
  }

  const gpuBaseUrls = await resolveGpuBaseUrlCandidates();
  if (!gpuBaseUrls.length) {
    return { success: false, message: "GPU API URL is not configured." };
  }

  const jobUuid = uuidv4();
  const jobData: IJob = {
    userid: user?._id?.toString() || "unknown",
    projectid: projectId,
    uuid: jobUuid,
    status: JobStatus.PENDING,
    segmentationSource: segmentationSource.AI_INFERENCE,
  };

  const jobCreationResult = await createJob(jobData);
  if (!jobCreationResult.success) {
    return { success: false, message: `Failed to create landmark job: ${jobCreationResult.message || "Unknown error"}` };
  }

  const callbackUrl = buildLocalCallbackUrl();
  if (!callbackUrl) {
    return { success: false, message: "Callback URL is missing." };
  }

  let lastErrorMessage = "";
  for (const gpuBaseUrl of gpuBaseUrls) {
    const endpoint = `${gpuBaseUrl}/inference/v2/landmark-detection`;
    try {
    const response = await axios.post(
      endpoint,
      {
        url: niftiPresignedUrl,
        uuid: jobUuid,
        callback_url: callbackUrl,
        model: modelConfig?.model || "unetresnet34-landmark",
        device: modelConfig?.deviceType || "auto",
        checkpoint_path: modelConfig?.checkpointPath || process.env.LANDMARK_CHECKPOINT_PATH,
      },
      {
        headers: {
          Authorization: `Bearer ${gpuAuthToken}`,
          "Content-Type": "application/json",
        },
        timeout: 30 * 1000,
      }
    );

    if (response.status !== 202) {
      await updateJob(jobUuid, { status: JobStatus.FAILED, message: `GPU returned status ${response.status}` });
      return { success: false, message: `Landmark GPU API returned status ${response.status}.` };
    }

    return { success: true, message: "Landmark detection job accepted.", uuid: jobUuid };
  } catch (error: any) {
      const responseData = error.response?.data;
      const gpuDetail =
        typeof responseData === "string"
          ? responseData
          : responseData?.detail || responseData?.error || responseData?.message;

      lastErrorMessage = `Landmark detection failed to start via ${endpoint}: ${error.message}`;
      if (error.response?.status) {
        lastErrorMessage += ` (Status: ${error.response.status})`;
      }
      if (gpuDetail) {
        lastErrorMessage += ` - ${typeof gpuDetail === "string" ? gpuDetail : JSON.stringify(gpuDetail)}`;
      }

      logger.error(`${serviceLocation}: Failed to start landmark detection`, {
        endpoint,
        responseStatus: error.response?.status,
        responseData,
        message: error.message,
      });
    }
  }

  await updateJob(jobUuid, { status: JobStatus.FAILED, message: lastErrorMessage });
  return { success: false, message: lastErrorMessage || "No local GPU endpoint accepted the landmark detection request." };
}
