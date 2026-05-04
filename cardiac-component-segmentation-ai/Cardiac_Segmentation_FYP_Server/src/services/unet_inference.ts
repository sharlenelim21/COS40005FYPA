import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import logger from "./logger";

const execFileAsync = promisify(execFile);
const serviceLocation = "UNETInference";

export interface UnetInferenceFrameMask {
  frameindex: number;
  frameinferred: boolean;
  slices: Array<{
    sliceindex: number;
    segmentationmasks: Array<{
      class: string;
      segmentationmaskcontents: string;
    }>;
  }>;
}

export interface UnetInferenceResult {
  success: boolean;
  mask?: {
    frames: UnetInferenceFrameMask[];
  };
  error?: string;
}

interface UnetInferenceScriptResult {
  success: boolean;
  mask?: {
    frames: UnetInferenceFrameMask[];
  };
  error?: string;
}

const resolvePythonScriptPath = (): string => {
  const candidatePaths = [
    path.join(process.cwd(), "src", "python", "unet_inference.py"),
    path.join(__dirname, "..", "python", "unet_inference.py"),
  ];

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return candidatePaths[0];
};

/**
 * DEVELOPER NOTE: Local UNet Inference Wrapper
 * 
 * This function serves as a TypeScript bridge to the Python UNet inference engine.
 * 
 * Input: Path to a NIfTI cardiac imaging file
 * Output: MedSAM-compatible frame/slice/mask JSON structure
 * 
 * @param niftiFilePath - Absolute path to the input NIfTI file (.nii or .nii.gz)
 * @param projectId - Optional project ID for logging purposes
 * @param userId - Optional user ID for logging purposes
 * @param modelConfig - Device and checkpoint configuration:
 *   - deviceType: "cpu" (cpu), "cuda" (NVIDIA GPU), or "auto" (automatic selection)
 *   - checkpointPath: Model weights file path (defaults to MODEL2_CHECKPOINT_PATH env var)
 * @returns Promise with inference result containing frame/slice/mask data or error details
 */
export async function inferModel2Mask(
  niftiFilePath: string,
  projectId?: string,
  userId?: string,
  modelConfig?: {
    deviceType?: "cpu" | "cuda" | "auto";
    batchSize?: number;
    checkpointPath?: string;
  }
): Promise<UnetInferenceResult> {
  // Device selection priority: 1) explicit config, 2) environment variable, 3) default to CPU
  const deviceType = modelConfig?.deviceType || process.env.MODEL2_DEVICE || "cpu";
  const checkpointPath = modelConfig?.checkpointPath || process.env.MODEL2_CHECKPOINT_PATH || "";
  const pythonScriptPath = resolvePythonScriptPath();

  logger.info(
    `${serviceLocation}: Preparing UNet inference for NIfTI file ${niftiFilePath}${projectId ? ` (project ${projectId})` : ""}${userId ? ` by user ${userId}` : ""}`
  );
  if (!fs.existsSync(niftiFilePath)) {
    return {
      success: false,
      error: `NIfTI file not found: ${niftiFilePath}`,
    };
  }

  if (!fs.existsSync(pythonScriptPath)) {
    return {
      success: false,
      error: `UNet Python wrapper not found at ${pythonScriptPath}`,
    };
  }

  try {
    // Build Python subprocess arguments: script path, input file, device selection, optional checkpoint
    const args = [
      pythonScriptPath,
      niftiFilePath,
      "--device",
      deviceType,
    ];

    if (checkpointPath) {
      args.push("--checkpoint-path", checkpointPath);
    }

    // DEVELOPER NOTE: execFileAsync spawns Python subprocess with:
    // - maxBuffer: 10MB allows processing large inference outputs (multiple cardiac slices per frame)
    // - timeout: 15 minutes accounts for CPU-based inference on larger cardiac volumes
    const { stdout, stderr } = await execFileAsync("python", args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });

    if (stderr) {
      logger.warn(`${serviceLocation}: Python wrapper warnings: ${stderr}`);
    }

    // Python wrapper outputs JSON on stdout; parse and validate structure
    const parsedOutput = JSON.parse(stdout) as UnetInferenceScriptResult;
    if (!parsedOutput.success) {
      return {
        success: false,
        error: parsedOutput.error || "UNet inference failed without a detailed error.",
      };
    }

    return {
      success: true,
      mask: parsedOutput.mask,
    };
  } catch (error: any) {
    logger.error(`${serviceLocation}: UNet inference failed for ${niftiFilePath}: ${error.message}`);
    return {
      success: false,
      error: `UNet inference failed: ${error.message}`,
    };
  }
}
