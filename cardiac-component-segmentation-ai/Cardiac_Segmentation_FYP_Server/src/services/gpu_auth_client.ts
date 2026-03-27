/**
 * @file src/services/gpu_auth_client.ts
 * @module gpu_auth_client
 * @description Manages authentication with the GPU server by self-generating
 * short-lived JWTs and automatically refreshing them.
 * This client acts on behalf of the Node.js server itself when
 * communicating with the GPU/FastAPI server.
 * Configuration is loaded from database with fallback to environment variables.
 */

import jwt from "jsonwebtoken";
import logger from "./logger"; // Assuming Winston logger instance
import LogError from "../utils/error_logger"; // Assuming custom error logging utility
import crypto from "crypto"; // Used for generating unique JWT IDs (jti claim)
import axios from "axios"; // For making HTTP requests to the GPU server
import { readGPUHost } from "./database"; // Fetch latest GPU config from database
import { IGPUHost } from "../types/database_types"; // Import GPU host interface from database types

/**
 * Service location identifier for logging purposes within this module.
 * @constant {string}
 */
const serviceLocation = "API(GPU Authentication)";

/**
 * Extended GPU configuration that includes computed properties.
 * This extends the database IGPUHost interface with runtime-computed values.
 * Makes some database-specific properties optional for runtime usage.
 */
interface GPUConfig extends Omit<IGPUHost, "setBy" | "description"> {
  fullAddress: string; // Computed property for the complete server URL
  description?: string; // Optional description
  setBy?: string; // Optional setBy field
}

/**
 * Current GPU configuration loaded from database or environment variables.
 * This variable is set during initialization and used throughout the module.
 */
let currentGPUConfig: GPUConfig | null = null;

/**
 * Loads GPU configuration from database with fallback to environment variables.
 * This function prioritizes database settings and only falls back to environment
 * variables if database fetch fails.
 *
 * @async
 * @function loadGPUConfig
 * @returns {Promise<GPUConfig>} The loaded GPU configuration
 * @throws {Error} If both database and environment variable loading fail
 */
async function loadGPUConfig(): Promise<GPUConfig> {
  logger.info(`${serviceLocation}: Fetching GPU configuration from database.`);

  try {
    // Try to load from database first
    const dbResult = await readGPUHost();

    if (dbResult.success && dbResult.gpuHost) {
      const gpuHost = dbResult.gpuHost;
      const protocol = gpuHost.isHTTPS ? "https" : "http";
      const fullAddress = `${protocol}://${gpuHost.host}:${gpuHost.port}`;

      // Extract plain object properties from the Mongoose document
      const config: GPUConfig = {
        host: gpuHost.host,
        port: gpuHost.port,
        isHTTPS: gpuHost.isHTTPS || false,
        gpuServerAuthJwtSecret: gpuHost.gpuServerAuthJwtSecret,
        serverIdForGpuServer: gpuHost.serverIdForGpuServer,
        gpuServerIdentity: gpuHost.gpuServerIdentity,
        jwtRefreshInterval: gpuHost.jwtRefreshInterval,
        jwtLifetimeSeconds: gpuHost.jwtLifetimeSeconds,
        fullAddress,
        description: gpuHost.description,
        setBy: gpuHost.setBy,
      };

      logger.info(
        `${serviceLocation}: Successfully loaded GPU configuration from database`
      );
      logger.info(`${serviceLocation}: GPU Server Address: ${fullAddress}`);

      // Debug: Log the configuration to see what we got from database
      logger.info(`${serviceLocation}: GPU configuration details:`);
      logger.info(`${serviceLocation}: - Host: ${config.host}`);
      logger.info(`${serviceLocation}: - Port: ${config.port}`);
      logger.info(`${serviceLocation}: - Is HTTPS: ${config.isHTTPS}`);
      logger.info(
        `${serviceLocation}: - Has JWT Secret: ${!!config.gpuServerAuthJwtSecret}`
      );
      logger.info(
        `${serviceLocation}: - JWT Secret: ${config.gpuServerAuthJwtSecret}`
      ); // Temporary debug
      logger.info(
        `${serviceLocation}: - Server ID for GPU Server: ${config.serverIdForGpuServer}`
      );
      logger.info(
        `${serviceLocation}: - GPU Server Identity: ${config.gpuServerIdentity}`
      );
      logger.info(
        `${serviceLocation}: - JWT Refresh Interval: ${config.jwtRefreshInterval}ms`
      );
      logger.info(
        `${serviceLocation}: - JWT Lifetime Seconds: ${config.jwtLifetimeSeconds}s`
      );

      return config;
    } else {
      logger.warn(
        `${serviceLocation}: Failed to load GPU configuration from database: ${dbResult.message}`
      );
      throw new Error(
        `Database configuration load failed: ${dbResult.message}`
      );
    }
  } catch (error: unknown) {
    logger.warn(
      `${serviceLocation}: Database configuration load failed, falling back to environment variables`
    );
    LogError(
      error as Error,
      serviceLocation,
      `Error fetching GPU configuration from database`
    );

    // Fallback to environment variables
    return loadConfigFromEnvironment();
  }
}

/**
 * Loads GPU configuration from environment variables as a fallback.
 *
 * @function loadConfigFromEnvironment
 * @returns {GPUConfig} The configuration loaded from environment variables
 * @throws {Error} If critical environment variables are missing
 */
function loadConfigFromEnvironment(): GPUConfig {
  logger.info(
    `${serviceLocation}: Loading GPU configuration from environment variables (fallback)`
  );

  // Load with defaults matching the database schema defaults
  const host = process.env.GPU_SERVER_URL || "localhost";
  const port = parseInt(process.env.GPU_SERVER_PORT || "8000", 10);
  const isHTTPS = process.env.GPU_SERVER_SSL === "true";
  const gpuServerAuthJwtSecret =
    process.env.GPU_SERVER_AUTH_JWT_SECRET || "change-this";
  const serverIdForGpuServer =
    process.env.SERVER_ID_FOR_GPU_SERVER || "default-server-id";
  const gpuServerIdentity =
    process.env.GPU_SERVER_IDENTITY || "default-gpu-server-identity";
  const jwtRefreshInterval = parseInt(
    process.env.GPU_SERVER_JWT_REFRESH_INTERVAL || "480000",
    10
  ); // 8 minutes
  const jwtLifetimeSeconds = parseInt(
    process.env.GPU_SERVER_JWT_LIFETIME_SECONDS || "600",
    10
  ); // 10 minutes

  // Validate critical configuration
  if (!gpuServerAuthJwtSecret || gpuServerAuthJwtSecret === "change-this") {
    throw new Error(
      "GPU_SERVER_AUTH_JWT_SECRET is not properly configured in environment variables"
    );
  }

  const protocol = isHTTPS ? "https" : "http";
  const fullAddress = `${protocol}://${host}:${port}`;

  const config: GPUConfig = {
    host,
    port,
    isHTTPS,
    gpuServerAuthJwtSecret,
    serverIdForGpuServer,
    gpuServerIdentity,
    jwtRefreshInterval,
    jwtLifetimeSeconds,
    fullAddress,
  };

  logger.info(
    `${serviceLocation}: Successfully loaded GPU configuration from environment variables`
  );
  logger.info(`${serviceLocation}: GPU Server Address: ${fullAddress}`);
  return config;
}

// --- Module State ---

/**
 * Stores the most recently generated valid JWT string.
 * This variable holds the actual Bearer token used for API calls.
 * Initialized to `null` and updated periodically by the refresh mechanism.
 * @private
 * @type {string | null}
 */
let currentJwt: string | null = null;

/**
 * Stores the expiration timestamp (in milliseconds since the Unix epoch, UTC)
 * of the `currentJwt`. Used by `getCurrentToken` to check validity.
 * Initialized to `null` and updated whenever a new JWT is generated.
 * @private
 * @type {number | null}
 */
let tokenExpiresAt: number | null = null;

/**
 * Holds the `Timeout` object returned by `setInterval` used for scheduling
 * the periodic JWT refresh. Used by `stopTokenRefresh` to clear the interval
 * during graceful shutdown.
 * Initialized to `null`.
 * @private
 * @type {NodeJS.Timeout | null}
 */
let refreshIntervalId: NodeJS.Timeout | null = null;

/**
 * Flag to prevent concurrent JWT generation attempts.
 * When true, indicates that a JWT generation is already in progress.
 * @private
 * @type {boolean}
 */
let isGeneratingToken: boolean = false;

/**
 * @function generateAndStoreJwt
 * @private
 * @description Generates a new JWT using the current GPU configuration,
 * signs it, and stores it along with its expiration time in the
 * module's state variables (`currentJwt`, `tokenExpiresAt`).
 * Logs success or errors encountered during generation.
 * @throws {Error} If GPU configuration is not loaded or JWT generation fails.
 * @returns {void}
 */
function generateAndStoreJwt(): void {
  // --- Validate configuration ---
  if (!currentGPUConfig) {
    throw new Error(
      "GPU configuration is not loaded. Call initAndRefreshAuth first."
    );
  }

  const {
    gpuServerAuthJwtSecret,
    serverIdForGpuServer,
    gpuServerIdentity,
    jwtLifetimeSeconds,
  } = currentGPUConfig;

  // DEBUG LOG EVERYTHING
  logger.info(
    `${serviceLocation}: Generating new JWT with the following configuration:`,
    {
      serverIdForGpuServer,
      gpuServerIdentity,
      jwtLifetimeSeconds,
      jwtSecretConfigured:
        !!gpuServerAuthJwtSecret && gpuServerAuthJwtSecret !== "change-this",
    }
  );

  if (!gpuServerAuthJwtSecret || gpuServerAuthJwtSecret === "change-this") {
    // DEBUG
    logger.info(gpuServerAuthJwtSecret);
    throw new Error("GPU server JWT secret is not properly configured.");
  }

  try {
    // --- Calculate Timestamps ---
    const nowSeconds = Math.floor(Date.now() / 1000); // Current time in seconds
    const expiresSeconds = nowSeconds + jwtLifetimeSeconds; // Expiration time in seconds

    // --- Define JWT Payload ---
    const payload = {
      sub: serverIdForGpuServer, // Subject: Who this token represents
      iss: serverIdForGpuServer, // Issuer: Who created this token
      iat: nowSeconds, // Issued At: When the token was created
      exp: expiresSeconds, // Expiration Time: When the token becomes invalid
      aud: gpuServerIdentity, // Audience: Who this token is intended for
      jti: crypto.randomBytes(16).toString("hex"), // JWT ID: Unique identifier for this specific token
    };

    // --- Sign the JWT ---
    const newJwt = jwt.sign(payload, gpuServerAuthJwtSecret, {
      algorithm: "HS256", // Specify the algorithm consistent with the secret type
    });

    // --- Store the new token and its expiration ---
    currentJwt = newJwt;
    tokenExpiresAt = expiresSeconds * 1000; // Store expiration in milliseconds

    // Use verbose logging for the token itself only if necessary for debugging
    // logger.info(`Generated new JWT: ${currentJwt}`);
    logger.info(
      `${serviceLocation}: Successfully generated new JWT. Expires: ${new Date(tokenExpiresAt).toISOString()}`
    );
  } catch (error: unknown) {
    logger.error(`${serviceLocation}: Error generating JWT`, { error }); // Log the error object
    LogError(error as Error, serviceLocation, `Error generating JWT`);
    // Clear potentially invalid state after failure
    currentJwt = null;
    tokenExpiresAt = null;
    // Re-throw to signal failure to the caller (initAndRefreshAuth)
    throw error;
  }
}

/**
 * Checks if the GPU server is reachable and operational during initialization.
 * This function verifies connectivity without requiring authentication.
 *
 * @async
 * @function checkGpuStatusOnInitialization
 * @returns {Promise<void>} Resolves when the check is complete (regardless of result)
 */
async function checkGpuStatusOnInitialization(): Promise<void> {
  if (!currentGPUConfig) {
    logger.warn(
      `${serviceLocation}: Cannot check GPU status - configuration not loaded`
    );
    return;
  }

  try {
    const statusUrl = `${currentGPUConfig.fullAddress}/status/gpu`;
    const response = await axios.get(statusUrl, { timeout: 10000 }); // Add a 10-second timeout

    if (response.status === 200) {
      logger.info(
        `${serviceLocation}: GPU server is reachable and operational at ${currentGPUConfig.fullAddress}`
      );
    }
  } catch (error: unknown) {
    logger.warn(
      `${serviceLocation}: GPU server is not reachable or operational at ${currentGPUConfig.fullAddress}`,
      { error }
    );
  }
}

/**
 * @function initAndRefreshAuth
 * @description Initializes the GPU server authentication process. It loads the
 * GPU configuration from database (with fallback to environment variables),
 * performs an immediate generation of the first JWT and then sets up a
 * `setInterval` timer to automatically regenerate the JWT based on the
 * configured refresh interval before the old one expires.
 * This function should be called once during application startup.
 * @throws {Error} If the configuration loading or initial JWT generation fails,
 * the error is re-thrown to potentially halt application startup.
 * @returns {Promise<void>}
 */
async function initAndRefreshAuth(): Promise<void> {
  // Ensure any previous interval is cleared if this function were ever called again
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }

  logger.info(
    `${serviceLocation}: Initializing GPU server authentication and starting refresh timer.`
  );

  try {
    // Load GPU configuration from database with fallback to environment variables
    currentGPUConfig = await loadGPUConfig();

    // Check GPU server status during initialization
    await checkGpuStatusOnInitialization();

    // Generate the first token immediately. If this fails, an error will be thrown.
    generateAndStoreJwt();

    // Schedule subsequent token refreshes based on the configured interval
    refreshIntervalId = setInterval(() => {
      logger.info(
        `${serviceLocation}: Refreshing the JWT token for GPU server authentication.`
      );
      
      // Skip if already generating to prevent race conditions
      if (isGeneratingToken) {
        logger.info(
          `${serviceLocation}: Skipping scheduled refresh - JWT generation already in progress.`
        );
        return;
      }
      
      try {
        isGeneratingToken = true;
        // Generate and store the new token in the background
        generateAndStoreJwt();
      } catch (refreshError) {
        // Log errors during refresh but don't crash the application
        // The previous token might still be valid for a short while.
        logger.error(
          `${serviceLocation}: Failed to refresh JWT during scheduled interval:`,
          { error: refreshError }
        );
        LogError(
          refreshError as Error,
          serviceLocation,
          `Error refreshing JWT`
        );
      } finally {
        isGeneratingToken = false;
      }
    }, currentGPUConfig.jwtRefreshInterval); // Refresh based on the configured interval

    logger.info(
      `${serviceLocation}: [INITIAL SETUP] JWT refresh scheduled every ${currentGPUConfig.jwtRefreshInterval}ms (${(currentGPUConfig.jwtRefreshInterval / 1000 / 60).toFixed(2)} minutes)`
    );
  } catch (initialError) {
    // Log the critical failure during initial setup
    logger.error(
      `${serviceLocation}: CRITICAL - Failed during initialization.`,
      { error: initialError }
    );
    LogError(
      initialError as Error,
      serviceLocation,
      `Critical error - initializing GPU server authentication`
    );
    // Rethrow the error so the main application startup process knows initialization failed
    throw initialError;
  }
}

/**
 * @function getCurrentToken
 * @description Retrieves the most recently generated JWT string, provided it exists
 * and has not expired (considering a small buffer). If the token is expired or about
 * to expire, it will attempt to generate a new one immediately (on-demand refresh).
 * @returns {string | null} The current valid JWT string, or `null` if no valid token
 * is currently available (e.g., initialization failed or token generation failed).
 */
function getCurrentToken(): string | null {
  if (!currentJwt) {
    logger.warn(
      `${serviceLocation}: Attempted to get JWT, but none is available. Initialization might have failed or is pending.`
    );
    return null;
  }

  // Check if the token is expired or about to expire (using a buffer)
  const bufferSeconds = 30; // Check 30 seconds before actual expiry for safety margin
  if (!tokenExpiresAt || Date.now() >= tokenExpiresAt - bufferSeconds * 1000) {
    logger.warn(
      `${serviceLocation}: Current JWT is expired or nearing expiration (expires: ${tokenExpiresAt ? new Date(tokenExpiresAt).toISOString() : "N/A"}). Attempting on-demand refresh...`
    );
    
    // Check if another thread is already generating a token
    if (isGeneratingToken) {
      logger.info(
        `${serviceLocation}: JWT generation already in progress, returning current token (may be expired).`
      );
      return currentJwt; // Return current token even if expired, rather than null
    }
    
    // Ensure we have configuration before attempting to generate
    if (!currentGPUConfig) {
      logger.error(
        `${serviceLocation}: Cannot refresh JWT on-demand - GPU configuration not loaded.`
      );
      return null;
    }
    
    // Try to generate a new token immediately instead of just returning null
    try {
      isGeneratingToken = true; // Set flag to prevent concurrent generation
      generateAndStoreJwt();
      logger.info(
        `${serviceLocation}: Successfully generated new JWT on-demand. New expiry: ${tokenExpiresAt ? new Date(tokenExpiresAt).toISOString() : "N/A"}`
      );
      return currentJwt; // Return the newly generated token
    } catch (error) {
      logger.error(
        `${serviceLocation}: Failed to generate JWT on-demand. Requests will fail until next scheduled refresh.`,
        { error }
      );
      LogError(
        error as Error,
        serviceLocation,
        `On-demand JWT generation failed`
      );
      return null; // Return null if we couldn't generate a new token
    } finally {
      isGeneratingToken = false; // Always clear the generation flag
    }
  }

  // Token exists and is within its validity period (including buffer)
  return currentJwt;
}

/**
 * @function getGPUServerAddress
 * @description Returns the full address (URL) of the configured GPU server.
 * This is useful for making requests to the GPU server.
 * @returns {string | null} The full GPU server address, or null if not configured.
 */
function getGPUServerAddress(): string | null {
  return currentGPUConfig?.fullAddress || null;
}

/**
 * @function reloadGPUConfig
 * @description Reloads the GPU configuration from the database. This can be used
 * to pick up configuration changes without restarting the application.
 * The JWT refresh interval will be updated but existing tokens remain valid.
 * @returns {Promise<void>}
 * @throws {Error} If configuration loading fails
 */
async function reloadGPUConfig(): Promise<void> {
  logger.info(`${serviceLocation}: Reloading GPU configuration...`);

  try {
    const newConfig = await loadGPUConfig();
    currentGPUConfig = newConfig;

    // ALWAYS clear any existing timer and create a new one to ensure proper refresh
    if (refreshIntervalId) {
      clearInterval(refreshIntervalId);
      refreshIntervalId = null;
    }

    // Always create a new timer if we have valid configuration
    if (currentGPUConfig) {
      const refreshInterval = currentGPUConfig.jwtRefreshInterval; // Capture for closure
      refreshIntervalId = setInterval(() => {
        logger.info(
          `${serviceLocation}: [SCHEDULED REFRESH] Refreshing JWT token (interval: ${refreshInterval}ms)`
        );
        
        // Skip if already generating to prevent race conditions
        if (isGeneratingToken) {
          logger.info(
            `${serviceLocation}: Skipping scheduled refresh - JWT generation already in progress.`
          );
          return;
        }
        
        try {
          isGeneratingToken = true;
          generateAndStoreJwt();
        } catch (refreshError) {
          logger.error(
            `${serviceLocation}: Failed to refresh JWT during scheduled interval:`,
            { error: refreshError }
          );
          LogError(
            refreshError as Error,
            serviceLocation,
            `Error refreshing JWT`
          );
        } finally {
          isGeneratingToken = false;
        }
      }, currentGPUConfig.jwtRefreshInterval);

      logger.info(
        `${serviceLocation}: [CONFIG RELOAD] JWT refresh timer recreated - interval: ${currentGPUConfig.jwtRefreshInterval}ms (${(currentGPUConfig.jwtRefreshInterval / 1000 / 60).toFixed(2)} minutes)`
      );
    }

    logger.info(`${serviceLocation}: GPU configuration reloaded successfully`);
  } catch (error: unknown) {
    logger.error(`${serviceLocation}: Failed to reload GPU configuration`, {
      error,
    });
    LogError(
      error as Error,
      serviceLocation,
      `Error reloading GPU configuration`
    );
    throw error;
  }
}

/**
 * @function stopTokenRefresh
 * @description Clears the `setInterval` timer responsible for periodically refreshing
 * the JWT. This should be called during a graceful shutdown sequence of the
 * Node.js application to prevent the timer callback from executing during
 * or after shutdown.
 * @returns {void}
 */
function stopTokenRefresh(): void {
  if (refreshIntervalId) {
    logger.info(`${serviceLocation}: Stopping JWT refresh interval...`);
    clearInterval(refreshIntervalId);
    refreshIntervalId = null; // Clear the reference
  }
}

/**
 * @function forceTokenRegeneration
 * @description Forces immediate regeneration of the JWT token using current configuration.
 * This is useful when configuration changes and you want to generate a new token immediately
 * instead of waiting for the next scheduled refresh.
 * @returns {Promise<void>}
 * @throws {Error} If JWT generation fails or configuration is not loaded
 */
async function forceTokenRegeneration(): Promise<void> {
  logger.info(
    `${serviceLocation}: Forcing immediate JWT token regeneration...`
  );

  try {
    // Reload configuration first to ensure we have the latest settings
    // This will also recreate the refresh timer with the new interval
    await reloadGPUConfig();

    // Generate a fresh token immediately (reloadGPUConfig doesn't generate a token)
    if (currentGPUConfig) {
      // Use the race condition protection here too
      if (isGeneratingToken) {
        logger.info(
          `${serviceLocation}: JWT generation already in progress during force regeneration, waiting for completion...`
        );
        // Wait briefly for the current generation to complete
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (!isGeneratingToken) {
        try {
          isGeneratingToken = true;
          generateAndStoreJwt();
          logger.info(
            `${serviceLocation}: [FORCE REGEN] JWT token regenerated immediately with new configuration`
          );
        } finally {
          isGeneratingToken = false;
        }
      }
    }

    logger.info(
      `${serviceLocation}: JWT token regeneration completed successfully`
    );
  } catch (error: unknown) {
    logger.error(`${serviceLocation}: Failed to force JWT token regeneration`, {
      error,
    });
    LogError(
      error as Error,
      serviceLocation,
      `Error forcing JWT token regeneration`
    );
    throw error;
  }
}

/**
 * @function getFreshGPUServerAddress
 * @description Reloads the GPU configuration from database and returns the full address.
 * This ensures that the latest configuration is always used for API calls.
 * @returns {Promise<string | null>} The full GPU server address with fresh config, or null if not configured.
 */
async function getFreshGPUServerAddress(): Promise<string | null> {
  try {
    // Reload configuration from database to get latest settings
    await reloadGPUConfig();
    return currentGPUConfig?.fullAddress || null;
  } catch (error: unknown) {
    logger.error(`${serviceLocation}: Failed to get fresh GPU server address`, {
      error,
    });
    LogError(
      error as Error,
      serviceLocation,
      `Error getting fresh GPU server address`
    );
    return null;
  }
}

// Export the public functions needed by the rest of the application
export {
  initAndRefreshAuth,
  getCurrentToken,
  getGPUServerAddress,
  reloadGPUConfig,
  stopTokenRefresh,
  checkGpuStatusOnInitialization,
  getFreshGPUServerAddress,
  forceTokenRegeneration,
};
