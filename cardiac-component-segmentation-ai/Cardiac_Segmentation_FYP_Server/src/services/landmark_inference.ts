import axios from "axios";
import { URL } from "url";
import { v4 as uuidv4 } from "uuid";
import { generatePresignedGetUrlForInternalService } from "../utils/s3_presigned_url";
import { getFreshGPUServerAddress } from "./gpu_auth_client";
import {
  createJob,
  IJob,
  JobStatus,
  jobModel,
  readProject,
  updateJob,
} from "./database";
import {
  segmentationSource,
  SegmentationModel,
} from "../types/database_types";
import { generateAISegmentationForReconstruction } from "./segmentation_export";
import logger from "./logger";

const serviceLocation = "LandmarkInference";

interface LandmarkModelConfig {
  model?: string;
  deviceType?: "cpu" | "cuda" | "auto";
  checkpointPath?: string;
  segmentationModel?: string;
}


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
    remoteBaseUrl,
    "http://gpu:8001",
    process.env.LOCAL_GPU_API_URL,
    directGpuApiUrl,
    localhostUrl,
    "http://host.docker.internal:8001",
    "http://host.docker.internal:8001",
  ]);
};

const buildCallbackUrl = (): string | null => {
  const configuredCallbackUrl = process.env.CALLBACK_URL;
  if (!configuredCallbackUrl) return null;
  return `${configuredCallbackUrl.replace(/\/$/, "")}/webhook/landmark-callback`;
};

const STALE_LANDMARK_JOB_MINUTES = 30;

export const findBlockingLandmarkJob = async (
  projectId: string,
  userId: string,
  segModel: "medsam" | "unet",
): Promise<{ uuid: string; status: string; startedAt?: Date } | null> => {
  const modelFilter = segModel === "unet"
    ? { segmentationModel: SegmentationModel.UNET }
    : { segmentationModel: { $in: [SegmentationModel.MEDSAM, null] } };

  try {
    const job = await jobModel.findOne({
      projectid: projectId,
      userid: userId,
      model_used: /landmark/i,
      status: { $in: [JobStatus.PENDING, JobStatus.IN_PROGRESS] },
      createdAt: { $gte: new Date(Date.now() - STALE_LANDMARK_JOB_MINUTES * 60 * 1000) },
      ...modelFilter,
    }).sort({ createdAt: -1 }).lean();

    if (!job) return null;
    return {
      uuid: job.uuid,
      status: job.status,
      startedAt: (job as unknown as { createdAt?: Date }).createdAt,
    };
  } catch (error: any) {
    logger.error(`${serviceLocation}: Failed to check for in-flight landmark jobs for project ${projectId}: ${error?.message}`);
    return null;
  }
};

export async function startLandmarkInference(
  projectId: string,
  user: any,
  gpuAuthToken: string,
  modelConfig?: LandmarkModelConfig,
): Promise<{
  success: boolean;
  message: string;
  uuid?: string;
  statusCode?: number;
  reason?: "job_in_progress";
  jobStatus?: string;
  startedAt?: Date;
}> {
  if (!gpuAuthToken) {
    return {
      success: false,
      message: "GPU authentication token is missing. Cannot start landmark detection.",
    };
  }

  const s3BucketName = process.env.AWS_BUCKET_NAME;
  if (!s3BucketName) {
    return { success: false, message: "S3 bucket is missing." };
  }

  const projectResult = await readProject(projectId);
  if (!projectResult.success || !projectResult.projects?.length) {
    return { success: false, message: `Project with ID ${projectId} not found.` };
  }

  const project = projectResult.projects[0];
  if (project.userid?.toString() !== user?._id?.toString()) {
    return { success: false, message: "Project not found." };
  }

  if (!project.originalfilepath) {
    return { success: false, message: "Project original NIfTI file is missing." };
  }

  let s3Key = "";
  try {
    const parsedUrl = new URL(project.originalfilepath);
    s3Key = parsedUrl.pathname.startsWith("/")
      ? parsedUrl.pathname.substring(1)
      : parsedUrl.pathname;
  } catch (error: any) {
    return { success: false, message: `Invalid NIfTI source URL: ${error.message}` };
  }

  const callbackUrl = buildCallbackUrl();
  if (!callbackUrl) {
    return { success: false, message: "Callback URL is missing." };
  }

  const requestedSegModel = (
    (modelConfig?.segmentationModel ?? "medsam").toLowerCase() === "unet"
      ? "unet"
      : "medsam"
  ) as "medsam" | "unet";

  const blockingJob = await findBlockingLandmarkJob(projectId, user?._id?.toString(), requestedSegModel);
  if (blockingJob) {
    const modelLabel = requestedSegModel === "unet" ? "UNet" : "MedSAM";
    logger.info(
      `${serviceLocation}: Rejected duplicate ${modelLabel} landmark detection for project ${projectId}; job ${blockingJob.uuid} is still ${blockingJob.status}.`
    );
    return {
      success: false,
      statusCode: 409,
      reason: "job_in_progress",
      message: `Landmark detection on the ${modelLabel} mask is already running for this project.`,
      uuid: blockingJob.uuid,
      jobStatus: blockingJob.status,
      startedAt: blockingJob.startedAt,
    };
  }

  const jobUuid = uuidv4();
  const jobData: IJob = {
    userid: user?._id?.toString() || "unknown",
    projectid: projectId,
    uuid: jobUuid,
    status: JobStatus.PENDING,
    segmentationSource: segmentationSource.AI_INFERENCE,
    model_used: modelConfig?.model || "unetresnet34-landmark",
    segmentationModel:
      requestedSegModel === "unet" ? SegmentationModel.UNET : SegmentationModel.MEDSAM,
  };

  const jobCreationResult = await createJob(jobData);
  if (!jobCreationResult.success) {
    return {
      success: false,
      message: `Failed to create landmark job: ${jobCreationResult.message || "Unknown error"}`,
    };
  }

  const failJob = async (message: string) => {
    await updateJob(jobUuid, { status: JobStatus.FAILED, message });
    return { success: false, message };
  };

  let niftiPresignedUrl: string | null | undefined;
  try {
    niftiPresignedUrl = await generatePresignedGetUrlForInternalService(s3BucketName, s3Key);
  } catch (error: any) {
    return failJob(`Failed to prepare NIfTI URL for landmark detection: ${error?.message}`);
  }
  if (!niftiPresignedUrl) {
    return failJob("Failed to prepare NIfTI URL for landmark detection.");
  }

  let segMaskPresignedUrl: string | null = null;
  try {
    const segResult = await generateAISegmentationForReconstruction(
      projectId,
      user?._id?.toString(),
      requestedSegModel,
    );
    if (segResult.success && segResult.s3Url) {
      segMaskPresignedUrl = segResult.s3Url;
      logger.info(
        `${serviceLocation}: Generated ${requestedSegModel.toUpperCase()} seg mask NIfTI for project ${projectId} — GPU will use 2ch model.`
      );
    } else {
      logger.warn(
        `${serviceLocation}: Could not generate ${requestedSegModel.toUpperCase()} seg mask NIfTI for project ${projectId} — GPU will use 1ch fallback. Reason: ${segResult.message ?? "unknown"}`
      );
    }
  } catch (segErr: any) {
    logger.warn(
      `${serviceLocation}: Error generating seg mask NIfTI for project ${projectId} — GPU will use 1ch fallback. Error: ${segErr?.message}`
    );
  }
  // Landmark detection ALWAYS proceeds regardless of seg mask availability.
  // GPU handles null seg_mask_url by using the 1ch model automatically.

  let gpuBaseUrls: string[];
  try {
    gpuBaseUrls = await resolveGpuBaseUrlCandidates();
  } catch (error: any) {
    return failJob(`Could not resolve the GPU API URL: ${error?.message}`);
  }
  if (!gpuBaseUrls.length) {
    return failJob("GPU API URL is not configured.");
  }

  let lastErrorMessage = "";
  for (const gpuBaseUrl of gpuBaseUrls) {
    const endpoint = `${gpuBaseUrl}/inference/v2/landmark-detection`;
    try {
      const response = await axios.post(
        endpoint,
        {
          url: niftiPresignedUrl,
          ...(segMaskPresignedUrl ? { seg_mask_url: segMaskPresignedUrl } : {}),
          uuid: jobUuid,
          callback_url: callbackUrl,
          model: modelConfig?.model || "unetresnet34-landmark",
          device: modelConfig?.deviceType || "auto",
          checkpoint_path:
            modelConfig?.checkpointPath || process.env.LANDMARK_CHECKPOINT_PATH,
        },
        {
          headers: {
            Authorization: `Bearer ${gpuAuthToken}`,
            "Content-Type": "application/json",
          },
          timeout: 30_000,
        },
      );

      if (response.status !== 202) {
        await updateJob(jobUuid, {
          status: JobStatus.FAILED,
          message: `GPU returned status ${response.status}`,
        });
        return {
          success: false,
          message: `Landmark GPU API returned status ${response.status}.`,
        };
      }

      await updateJob(jobUuid, {
        status: JobStatus.IN_PROGRESS,
        message: "Landmark detection is running.",
      });
      return {
        success: true,
        message: "Landmark detection job accepted.",
        uuid: jobUuid,
      };
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

  await updateJob(jobUuid, {
    status: JobStatus.FAILED,
    message: lastErrorMessage,
  });
  return {
    success: false,
    message:
      lastErrorMessage || "No GPU endpoint accepted the landmark detection request.",
  };
}
