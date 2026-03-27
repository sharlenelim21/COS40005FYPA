// File: src/utils/error_logger.ts
// Description: Utility function to log errors using the Winston logger service.
import logger from '../services/logger';

// Helper function to log errors especially for catching exceptions
/**
 * Logs an error message with a stack trace using the custom logger.
 * @param error {Error} - The error object to log
 * @param service {string} - The name of the service where the error occurred (e.g. 'Database', 'API', etc.)
 * @param description {string} - A brief description of the error context.
 */
function LogError(error: Error, service: string, description: string): void {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : 'No stack trace available';
    logger.error(`${service}: ${description}\nError: ${errorMessage}\nStack: ${errorStack}`);
}

export default LogError;