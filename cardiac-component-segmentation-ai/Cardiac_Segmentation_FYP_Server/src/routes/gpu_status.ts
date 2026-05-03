// File: src/routes/gpu_status.ts
// Description: Routes for testing GPU token authentication and status.
import express, { Request, Response } from "express";
import axios from "axios"; // Import axios for HTTP requests

// Import the middleware to require GPU auth token
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware";
import { getFreshGPUServerAddress } from "../services/gpu_auth_client"; // Import fresh GPU server address function
import LogError from "../utils/error_logger";
import logger from "../services/logger";
const router = express.Router();

const serviceLocation = "API (GPU Status Route)";

// Define a type guard for checking axios errors
interface AxiosErrorLike {
  isAxiosError?: boolean;
  response?: {
    status: number;
    data: unknown;
  };
  request?: unknown;
  code?: string;
  message?: string;
}

function isAxiosErrorLike(error: unknown): error is AxiosErrorLike {
  return error !== null && typeof error === "object" && "isAxiosError" in error;
}

function resolveGpuAvailability(data: any): { gpuAvailable: boolean; mode: string } {
  const backend = typeof data?.backend === "string" ? data.backend.toLowerCase() : "";
  const nestedBackend =
    typeof data?.gpu?.backend === "string" ? data.gpu.backend.toLowerCase() : "";
  const status = typeof data?.status === "string" ? data.status.toLowerCase() : "";
  const gpuStatus =
    typeof data?.gpu?.status === "string" ? data.gpu.status.toLowerCase() : "";
  const mode = data?.mode || backend || nestedBackend || "unknown";
  const gpuAvailable =
    Boolean(data?.gpuAvailable) ||
    (status === "ok" && (backend === "cuda" || nestedBackend === "cuda")) ||
    gpuStatus === "ok";

  return {
    gpuAvailable,
    mode: gpuAvailable ? "gpu" : mode === "unknown" ? "cpu" : mode,
  };
}

// Returns if Cloud GPU is available
router.get(
  "/gpu-status",
  injectGpuAuthToken,
  async (req: Request, res: Response): Promise<void> => {
    // Make authenticated request to the GPU server
    try {
      const serverAddress = await getFreshGPUServerAddress();
      if (!serverAddress) {
        logger.error(`${serviceLocation}: GPU server address is not configured`);
        res.status(503).json({
          message: "GPU server address is not configured",
          status: "offline",
          details: { error: "No GPU server configuration found" },
        });
        return;
      }

      const fullAddress = `${serverAddress}/status/gpu`;
      logger.info(`${serviceLocation}: Checking GPU status at ${fullAddress}`);

      const response = await axios.get(fullAddress, {
        headers: {
          Authorization: `Bearer ${res.locals.gpuAuthToken}`,
        },
        timeout: 10000, // Add a 10-second timeout
      });

      if (response.status === 200) {
        const { gpuAvailable, mode } = resolveGpuAvailability(response.data);
        logger.info(
          `${serviceLocation}: GPU status mapped. gpuAvailable=${gpuAvailable}, mode=${mode}, backend=${response.data?.backend}, gpuStatus=${response.data?.gpu?.status}`
        );
        res.status(200).json({
          message: gpuAvailable ? "NVIDIA GPU is available." : "CPU mode is active.",
          status: "online",
          serviceOnline: true,
          gpuAvailable,
          mode,
          details: response.data,
        });
      } else {
        logger.warn(
          `${serviceLocation}: GPU returned non-200 status: ${response.status}`
        );
        res.status(response.status).json({
          message: `GPU returned status ${response.status}`,
          status: "degraded",
          serviceOnline: true,
          ...resolveGpuAvailability(response.data),
          details: response.data,
        });
      }
    } catch (error: unknown) {
      // Detailed error handling
      let errorMessage = "GPU is not available.";
      let statusCode = 503;
      let errorDetails: Record<string, unknown> = {};

      const serverAddress = await getFreshGPUServerAddress();

      if (isAxiosErrorLike(error)) {
        // Handle specific axios errors
        if (error.code === "ECONNREFUSED") {
          errorMessage =
            "Connection to GPU server refused. The server may be down.";
          logger.error(
            `${serviceLocation}: Connection refused to GPU server at ${serverAddress}`
          );
          errorDetails = {
            code: "ECONNREFUSED",
            serverAddress: serverAddress,
          };
        } else if (error.code === "ETIMEDOUT") {
          errorMessage =
            "Connection to GPU server timed out. The server may be overloaded.";
          logger.error(`${serviceLocation}: Connection timeout to GPU server`);
          errorDetails = { code: "ETIMEDOUT" };
        } else if (error.response) {
          // The server responded with a status code outside of 2xx
          statusCode = error.response.status;
          errorMessage = `GPU server returned error: ${error.response.status}`;
          logger.error(
            `${serviceLocation}: GPU server returned error status ${error.response.status}`
          );
          errorDetails = {
            status: error.response.status,
            data: error.response.data,
          };
        } else {
          // Something else happened while setting up the request
          errorMessage =
            error.message || "Unknown error occurred connecting to GPU server";
          logger.error(
            `${serviceLocation}: Request setup error: ${error.message}`
          );
          errorDetails = { code: error.code };
        }
      } else if (error instanceof Error) {
        // For standard Error objects
        errorMessage = error.message || "Unknown error";
        logger.error(`${serviceLocation}: Standard error: ${errorMessage}`);
        errorDetails = { name: error.name };
      } else {
        // For any other type of error
        errorMessage = String(error);
        logger.error(`${serviceLocation}: Non-standard error: ${errorMessage}`);
      }

      // Use the consistent serviceLocation for error logging
      LogError(
        error instanceof Error ? error : new Error(String(error)),
        serviceLocation,
        `Error while checking GPU status: ${errorMessage}`
      );

      res.status(statusCode).json({
        message: errorMessage,
        status: "offline",
        serviceOnline: false,
        gpuAvailable: false,
        mode: "unknown",
        details: errorDetails,
      });
    }
  }
);

// This route should fetch the System status (RAM, CPU) of the GPU server
router.get(
  "/gpu-system-status",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const serverAddress = await getFreshGPUServerAddress();
      if (!serverAddress) {
        logger.error(`${serviceLocation}: GPU server address is not configured`);
        res.status(503).json({
          message: "GPU server address is not configured",
          status: "offline",
          details: { error: "No GPU server configuration found" },
        });
        return;
      }

      const fullAddress = `${serverAddress}/status/server`;
      logger.info(
        `${serviceLocation}: Fetching GPU system status from ${fullAddress}`
      );

      const response = await axios.get(fullAddress, {
        timeout: 10000, // Add a 10-second timeout
      });

      if (response.status === 200) {
        logger.info(
          `${serviceLocation}: GPU system status fetched successfully`
        );
        res.status(200).json({
          message: "GPU system status fetched successfully.",
          status: "online",
          details: response.data,
        });
      } else {
        logger.warn(
          `${serviceLocation}: GPU system status returned non-200 status: ${response.status}`
        );
        res.status(response.status).json({
          message: `GPU system status returned status ${response.status}`,
          status: "degraded",
          details: response.data,
        });
      }
    } catch (error: unknown) {
      LogError(
        error instanceof Error ? error : new Error(String(error)),
        serviceLocation,
        "Error while fetching GPU system status"
      );
      res.status(503).json({
        message: "Failed to fetch GPU system status.",
        status: "offline",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
);

export default router;
