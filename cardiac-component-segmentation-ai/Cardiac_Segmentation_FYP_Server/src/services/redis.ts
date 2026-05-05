import { createClient } from "redis";
import path from "path";
import dotenv from "dotenv";
import logger from "./logger";
import LogError from "../utils/error_logger";
import { loadEnvFromKnownLocations } from "../utils/env";

const serviceLocation = "Redis";

// Load environment variables
try {
  loadEnvFromKnownLocations(__dirname);
} catch (error: unknown) {
  logger.error(
    `${serviceLocation}: Failed to load environment variables. Error: ${error instanceof Error ? error.message : "Unknown error"}`
  );
  LogError(
    error as Error,
    serviceLocation,
    "Error loading environment variables."
  );
}
// Check Redis configuration type
const redisAWS = process.env.REDIS_AWS === "true";
const redisCloud = process.env.REDIS_CLOUD === "true";

let redisConfig: any;

if (redisCloud) {
  // Cloud.redis.io configuration
  redisConfig = {
    username: process.env.REDIS_USERNAME || "default",
    password: process.env.REDIS_PASSWORD,
    socket: {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      reconnectStrategy: (retries: number) => {
        if (retries > 5) {
          logger.error(`${serviceLocation}: Exceeded maximum retry attempts.`);
          LogError(
            new Error("Exceeded maximum retry attempts"),
            serviceLocation,
            "Redis connection error."
          );
        }
        logger.warn(`Redis Client: Retry attempt ${retries}.`);
        return Math.min(retries * 100, 3000); // Retry with exponential backoff (max 3 seconds)
      },
    },
  };
} else {
  // AWS ElastiCache or Docker Redis/Valkey configuration
  let redisUrl = `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`;
  if (redisAWS) {
    redisUrl = `rediss://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`;
  }

  redisConfig = {
    url: redisUrl,
    password: process.env.REDIS_PASSWORD || undefined,
    socket: {
      tls: process.env.REDIS_TLS === "true",
      reconnectStrategy: (retries: number) => {
        if (retries > 5) {
          logger.error(`${serviceLocation}: Exceeded maximum retry attempts.`);
          LogError(
            new Error("Exceeded maximum retry attempts"),
            serviceLocation,
            "Redis connection error."
          );
        }
        logger.warn(`Redis Client: Retry attempt ${retries}.`);
        return Math.min(retries * 100, 3000); // Retry with exponential backoff (max 3 seconds)
      },
    },
  };
}

// Create Redis client with the appropriate configuration
const redisClient = createClient(redisConfig);

// Handle Redis client errors
redisClient.on("error", (err) => {
  logger.error(
    `${serviceLocation}: Client error. Error: ${err instanceof Error ? err.message : "Unknown error"}`
  );
  LogError(err as Error, serviceLocation, "Redis client error.");
});

// Connect to Redis
const connectRedis = async (): Promise<void> => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
      logger.info(`${serviceLocation}: Redis client connected successfully.`);
    }
  } catch (error: unknown) {
    logger.error(
      `${serviceLocation}: Failed to connect to Redis. Error: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    LogError(error as Error, serviceLocation, "Redis connection error.");
  }
};

// Check Redis health
const checkRedisHealth = async (): Promise<boolean> => {
  try {
    const reply = await redisClient.ping(); // Simple Redis ping check
    return reply === "PONG";
  } catch (error: unknown) {
    logger.error(
      `${serviceLocation}: Health check failed. Error: ${error instanceof Error ? error.message : "Unknown error"}`
    );
    LogError(error as Error, serviceLocation, "Redis health check error.");
    return false;
  }
};

export { redisClient, connectRedis, checkRedisHealth };
