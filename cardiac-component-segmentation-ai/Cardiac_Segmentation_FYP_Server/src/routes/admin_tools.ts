// File: src/routes/admin_tools.ts
/**
 * This file defines administrative tools and routes for managing the application.
 */

import { Request, Response, Router } from "express";
import { readGPUHost, updateGPUHost, IGPUHost } from "../services/database";
import { isAuthAndAdmin } from "../services/passportjs";
import { reloadGPUConfig, getFreshGPUServerAddress, forceTokenRegeneration } from "../services/gpu_auth_client"; // Import new functions
import logger from "../services/logger";
import LogError from "../utils/error_logger";
import axios from "axios"; // For testing GPU server connection

const router = Router();
const serviceLocation = "API (Admin Tools)";

// Get current GPU configuration
router.get("/gpu-config", isAuthAndAdmin, async (req: Request, res: Response) => {
  try {
    const result = await readGPUHost();
    if (result.success && result.gpuHost) {
      // Remove sensitive JWT secret before sending, but include other JWT config
      const safeConfig = {
        host: result.gpuHost.host,
        port: result.gpuHost.port,
        isHTTPS: result.gpuHost.isHTTPS,
        description: result.gpuHost.description,
        serverIdForGpuServer: result.gpuHost.serverIdForGpuServer,
        gpuServerIdentity: result.gpuHost.gpuServerIdentity,
        jwtRefreshInterval: result.gpuHost.jwtRefreshInterval,
        jwtLifetimeSeconds: result.gpuHost.jwtLifetimeSeconds,
        createdAt: result.gpuHost.createdAt,
        updatedAt: result.gpuHost.updatedAt,
        setBy: result.gpuHost.setBy,
        // Note: gpuServerAuthJwtSecret is intentionally excluded for security
        hasJwtSecret: !!(result.gpuHost.gpuServerAuthJwtSecret && result.gpuHost.gpuServerAuthJwtSecret !== 'change-this')
      };

      return res.status(200).json({
        success: true,
        gpuHost: safeConfig
      });
    } else {
      return res.status(404).json({
        success: false,
        message: result.message || "No GPU configuration found"
      });
    }
  } catch (error) {
    LogError(error as Error, serviceLocation, "Error reading GPU configuration");
    return res.status(500).json({
      success: false,
      message: "An error occurred while reading GPU configuration"
    });
  }
});

// Update GPU configuration
router.patch("/gpu-config", isAuthAndAdmin, async (req: Request, res: Response) => {
  try {
    const {
      host,
      port,
      isHTTPS,
      description,
      serverIdForGpuServer,
      gpuServerIdentity,
      gpuServerAuthJwtSecret,
      jwtRefreshInterval,
      jwtLifetimeSeconds
    } = req.body;

    const adminUserId = (req.user as { _id: string })?._id;

    if (!adminUserId) {
      return res.status(401).json({
        success: false,
        message: "Admin user ID not found"
      });
    }

    // Input validation
    if (host && (typeof host !== 'string' || host.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: "Invalid host format"
      });
    }

    if (port !== undefined && (typeof port !== 'number' || port < 1 || port > 65535)) {
      return res.status(400).json({
        success: false,
        message: "Port must be between 1 and 65535"
      });
    }

    if (serverIdForGpuServer && (typeof serverIdForGpuServer !== 'string' || serverIdForGpuServer.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: "Invalid server ID format"
      });
    }

    if (gpuServerIdentity && (typeof gpuServerIdentity !== 'string' || gpuServerIdentity.trim() === '')) {
      return res.status(400).json({
        success: false,
        message: "Invalid GPU server identity format"
      });
    }

    if (gpuServerAuthJwtSecret && (typeof gpuServerAuthJwtSecret !== 'string' || gpuServerAuthJwtSecret.trim() === '' || gpuServerAuthJwtSecret === 'change-this')) {
      return res.status(400).json({
        success: false,
        message: "Invalid JWT secret - must be a non-empty string and not default value"
      });
    }

    if (jwtRefreshInterval !== undefined && (typeof jwtRefreshInterval !== 'number' || jwtRefreshInterval < 60000)) {
      return res.status(400).json({
        success: false,
        message: "JWT refresh interval must be at least 60 seconds (60000ms)"
      });
    }

    if (jwtLifetimeSeconds !== undefined && (typeof jwtLifetimeSeconds !== 'number' || jwtLifetimeSeconds < 60)) {
      return res.status(400).json({
        success: false,
        message: "JWT lifetime must be at least 60 seconds"
      });
    }

    const updates: Partial<IGPUHost> = {
      setBy: adminUserId
    };

    if (host) updates.host = host.trim();
    if (port !== undefined) updates.port = port;
    if (isHTTPS !== undefined) updates.isHTTPS = isHTTPS;
    if (description !== undefined) updates.description = description;
    if (serverIdForGpuServer) updates.serverIdForGpuServer = serverIdForGpuServer.trim();
    if (gpuServerIdentity) updates.gpuServerIdentity = gpuServerIdentity.trim();
    if (gpuServerAuthJwtSecret) updates.gpuServerAuthJwtSecret = gpuServerAuthJwtSecret.trim();
    if (jwtRefreshInterval !== undefined) updates.jwtRefreshInterval = jwtRefreshInterval;
    if (jwtLifetimeSeconds !== undefined) updates.jwtLifetimeSeconds = jwtLifetimeSeconds;

    const result = await updateGPUHost(updates);

    if (result.success && result.gpuHost) {
      logger.info(`Admin ${adminUserId} updated GPU configuration`);

      // 🆕 CRITICAL: Automatically reload GPU configuration and regenerate JWT immediately after database update
      try {
        await forceTokenRegeneration();
        logger.info(`${serviceLocation}: Auto-reloaded GPU configuration and regenerated JWT immediately after update`);
      } catch (reloadError) {
        logger.warn(`${serviceLocation}: Failed to auto-reload GPU configuration and regenerate JWT after update:`, { error: reloadError });
        LogError(reloadError as Error, serviceLocation, `Auto-reload GPU config and JWT regeneration after update failed`);
        // Don't fail the whole operation, but warn the admin
      }

      // Remove sensitive JWT secret before sending
      const safeConfig = {
        host: result.gpuHost.host,
        port: result.gpuHost.port,
        isHTTPS: result.gpuHost.isHTTPS,
        description: result.gpuHost.description,
        serverIdForGpuServer: result.gpuHost.serverIdForGpuServer,
        gpuServerIdentity: result.gpuHost.gpuServerIdentity,
        jwtRefreshInterval: result.gpuHost.jwtRefreshInterval,
        jwtLifetimeSeconds: result.gpuHost.jwtLifetimeSeconds,
        updatedAt: result.gpuHost.updatedAt,
        setBy: result.gpuHost.setBy,
        hasJwtSecret: !!(result.gpuHost.gpuServerAuthJwtSecret && result.gpuHost.gpuServerAuthJwtSecret !== 'change-this')
      };

      return res.status(200).json({
        success: true,
        message: "GPU configuration updated and reloaded successfully",
        gpuHost: safeConfig,
        configReloaded: true
      });
    } else {
      return res.status(400).json({
        success: false,
        message: result.message || "Failed to update GPU configuration"
      });
    }
  } catch (error) {
    LogError(error as Error, serviceLocation, "Error updating GPU configuration");
    return res.status(500).json({
      success: false,
      message: "An error occurred while updating GPU configuration"
    });
  }
});

// Reload GPU configuration from database
router.post("/gpu-config/reload", isAuthAndAdmin, async (req: Request, res: Response) => {
  try {
    const adminUserId = (req.user as { _id: string })?._id;

    if (!adminUserId) {
      return res.status(401).json({
        success: false,
        message: "Admin user ID not found"
      });
    }

    await reloadGPUConfig();
    logger.info(`Admin ${adminUserId} reloaded GPU configuration`);

    return res.status(200).json({
      success: true,
      message: "GPU configuration reloaded successfully from database"
    });
  } catch (error) {
    LogError(error as Error, serviceLocation, "Error reloading GPU configuration");
    return res.status(500).json({
      success: false,
      message: "An error occurred while reloading GPU configuration"
    });
  }
});

// Force JWT token regeneration with fresh configuration
router.post("/gpu-config/force-jwt-regeneration", isAuthAndAdmin, async (req: Request, res: Response) => {
  try {
    const adminUserId = (req.user as { _id: string })?._id;

    if (!adminUserId) {
      return res.status(401).json({
        success: false,
        message: "Admin user ID not found"
      });
    }

    await forceTokenRegeneration();
    logger.info(`Admin ${adminUserId} forced JWT token regeneration`);

    return res.status(200).json({
      success: true,
      message: "JWT token regenerated successfully with latest configuration"
    });
  } catch (error) {
    LogError(error as Error, serviceLocation, "Error forcing JWT token regeneration");
    return res.status(500).json({
      success: false,
      message: "An error occurred while regenerating JWT token"
    });
  }
});

// Test GPU server connection
router.post("/gpu-config/test-connection", isAuthAndAdmin, async (req: Request, res: Response) => {
  try {
    const adminUserId = (req.user as { _id: string })?._id;

    if (!adminUserId) {
      return res.status(401).json({
        success: false,
        message: "Admin user ID not found"
      });
    }

    const serverAddress = await getFreshGPUServerAddress();
    if (!serverAddress) {
      return res.status(400).json({
        success: false,
        message: "GPU server address is not configured"
      });
    }

    try {
      const testUrl = `${serverAddress}/status/gpu`;
      const response = await axios.get(testUrl, {
        timeout: 10000,
        validateStatus: (status) => status < 500 // Accept any response that's not a server error
      });

      logger.info(`Admin ${adminUserId} tested GPU server connection - Status: ${response.status}`);

      return res.status(200).json({
        success: true,
        message: "GPU server connection test completed",
        serverAddress,
        testUrl,
        status: response.status,
        statusText: response.statusText,
        reachable: response.status >= 200 && response.status < 300
      });
    } catch (connectionError: unknown) {
      const errorMessage = connectionError instanceof Error ? connectionError.message : 'Unknown connection error';
      logger.warn(`Admin ${adminUserId} tested GPU server connection - Failed: ${errorMessage}`);

      return res.status(200).json({
        success: false,
        message: "GPU server is not reachable",
        serverAddress,
        error: errorMessage,
        reachable: false
      });
    }
  } catch (error) {
    LogError(error as Error, serviceLocation, "Error testing GPU server connection");
    return res.status(500).json({
      success: false,
      message: "An error occurred while testing GPU server connection"
    });
  }
});

export default router;