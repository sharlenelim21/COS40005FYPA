// File: src/services/logger.ts
// Description: Logger service using Winston with daily rotation and colorized output.
import { createLogger, format, transports } from "winston";
const { combine, timestamp, printf } = format;
import "winston-daily-rotate-file";
import { TransformableInfo } from "logform";

// Define custom log format with colorization
const logFormat = printf((info: TransformableInfo) => {
  const { level, message, timestamp: ts } = info;
  let colorizedTimestamp = ts as string;
  if (level === "info") {
    colorizedTimestamp = `\x1b[32m${ts}\x1b[0m`; // Green for info
  } else if (level === "error") {
    colorizedTimestamp = `\x1b[31m${ts}\x1b[0m`; // Red for error
  } else if (level === "warn") {
    colorizedTimestamp = `\x1b[33m${ts}\x1b[0m`; // Yellow for warn
  }
  return `${colorizedTimestamp} [${level.toUpperCase()}]:\n${message}`;
});

// Create logger
/**
 * Custom logger service using Winston with daily rotation and colorized output.
 * @module logger
 * @description Logger service using Winston with daily rotation and colorized output.
 * @requires winston
 * @requires winston-daily-rotate-file
 * @exports logger
 * @type {Logger} - Winston logger instance with daily rotation and colorized output.
 * @example
 * import logger from './services/logger';
 * 
 * logger.info('This is an info message');
 * logger.error('This is an error message');
 * logger.warn('This is a warning message');
 */
const logger = createLogger({
  level: "info",
  format: combine(timestamp({ format: "DD-MM-YYYY HH:mm:ss" }), logFormat),
  transports: [
    new transports.Console(),
    // Daily log file rotation
    new transports.DailyRotateFile({
      filename: "logs/winston_logger/application-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "14d",
    }),
    // Separate log file for errors
    new transports.DailyRotateFile({
      level: "error",
      filename: "logs/winston_logger/error-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "14d",
    }),
    // Separate log file for warnings
    new transports.DailyRotateFile({
      level: "warn",
      filename: "logs/winston_logger/warn-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "14d",
    }),
  ],
});

export default logger;
