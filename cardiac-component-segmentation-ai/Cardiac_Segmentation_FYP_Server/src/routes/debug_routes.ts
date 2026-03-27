// DEBUG only - Strictly do not use in production
import express, { Request, Response } from "express";
import { getCurrentToken, getFreshGPUServerAddress } from "../services/gpu_auth_client"; // Import the function to get the current token and fresh GPU address
const router = express.Router();
import logger from "../services/logger"; // Import the logger
import LogError from "../utils/error_logger"; // Import the error logging utility
import { jobModel, createJob, readJob, updateJob, deleteJob, JobStatus, IJobDocument, IJob } from "../services/database"; // Import the job model and functions
import { injectGpuAuthToken } from "../middleware/gpuauthmiddleware";
import { v4 as uuidv4 } from "uuid"; // Import UUID generator
import { isAuth } from "../services/passportjs"; // Import the authentication middleware
import axios from "axios"; // Import axios for HTTP requests

// fetch env variables
const { PORT, NODE_ENV } = process.env; // Fetch environment variables for host and port

const serviceLocation = "API (Debug Route)"; // Define a service location for logging

// Define a type guard for checking axios errors
interface AxiosErrorLike {
    isAxiosError?: boolean;
    response?: {
        status: number;
        data: any;
    };
    request?: any;
    code?: string;
    message?: string;
}

function isAxiosErrorLike(error: any): error is AxiosErrorLike {
    return error && typeof error === 'object' && 'isAxiosError' in error;
}

router.get("/get-gpu_token", async (req: Request, res: Response): Promise<void> => {
    const token = getCurrentToken(); // Get the current token
    if (token) {
        res.status(200).json({ token });
    } else {
        res.status(500).json({ error: "Failed to retrieve GPU token." });
    }
});

// route to start bbox inferencing via the gpu with self-generated callback_url (below), presigned_url, uuid
router.get('/start-bbox-inferencing', /*isAuth,*/ injectGpuAuthToken, async (req: Request, res: Response): Promise<void> => {
    logger.warn("DEBUG: Starting bbox inferencing..."); // Log the start of the process
    // Create sample job data
    const uuid = uuidv4(); // Generate a unique UUID for the job
    const url = "https://devel-visheart-s3-bucket.s3.ap-southeast-1.amazonaws.com/source_nifti/test-folder-dont-delete/smaltarsample.tar?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=ASIAQB4Y5V67QHZAMQHH%2F20250504%2Fap-southeast-1%2Fs3%2Faws4_request&X-Amz-Date=20250504T133649Z&X-Amz-Expires=10000&X-Amz-Security-Token=IQoJb3JpZ2luX2VjEG0aDmFwLXNvdXRoZWFzdC0xIkcwRQIhALKexDOY8PuMNY8KJRCz%2FvaRs4byuuUokcATKhGZXd6zAiAYYZkyu7qZEFN0SvB0D%2F3OUtkM3OqzMMDzYrtj7TvITCrJBQgWEAAaDDAwNDA3ODgwOTAyMyIMK%2FUUro7ONJ0mpyjvKqYFuCCbgBDjemN%2F82n8oNN2rXu7ybzmSinlnYMJjphid%2BYTg%2Bf3P9doUtKPO9FGoVaPu%2FoAps0YjQifw%2FJ4ZNjcc7nsWaYI4Kd%2FsPMFtlDfW3KmMdESTjzyb08Av%2FCLGmzQO0EIkd0%2B5SHKImnWcFOZMGqqLXRmoIskScnc6TZJmMxzFetr5dLcyTjXNGcrqwl%2B8W1AF7ZcrIL6Q5733G02bdHJfE5fJReE97z8B%2Ft5YpppSNmugaazJ1tNCLdVcs0hUE5BbdwGr1V5mASWnjyduG6KXFrOdepy%2BnRZOuUlSGPPUCJ7XkOBP8WmX0s5MHX3clPXp2jd8sIQK0jlWO8I0z8Pv5UmIxcKEf1fWbFfoIxba3QYld87t4%2FCozmPeQYvfPNOg2G1hRAAkgvshE2XW9etIflZOCWzA8LBawlRZU0%2BARXHpl1ubrpfMRYEcNtOg6%2BzIBRlpShOoKptgI032U0QvnISXJuK7tWpJzfXZZ1axcS6BiWB%2BqE3TJJRWJc%2F%2Brmz%2FE2n5OobSrWLoSvrK89DBI5IvPhEjbvVt9N9BN91C5cSoQwQYQ4mv0t7sb8%2FcBYGxHy%2F7NC8xpbgUFUCyJonr3FUHoP18ZVikxUGCTLdJGmigVrQY93XYMRg7s6MMDu5KiYcSKp4XHlIbb8V9yGm%2B%2FN%2FXax5kvhwOzHKCu8uzUHIKCQuYT%2FH6jnem3jO%2FQFQ8KrgvfA6oMMYyzE%2FaoXnNxYFfnRNFNu%2F2oC8ug36kUhZ6o6j8BG5EoXj69YccvCs9xyzJ01syUYkzngit7CgYQRA7dbfjF79sFpUc%2FVyTJu0zhrr%2FRE7XJ4amyMfPrvHCdrK2PoN9NA0eum3LIrWjxld9we9FRhli6189pxVNstqTIArMO6I1Sg4qvv8Ai5IFqJBMLvE3cAGOrIBDFBmdrLIPYAgQS45gThvbnpMGcgR5T97UJEwiU4w7t6ma0XVihKk4lWkNOilsjTJ1Fa1z%2FHYTyKrecSKpGA9eET%2BTSV74hrLRJ3jmUuKrtw0gH9HQKxAb%2B4%2BRDpUKcgc2xITsDpXJgy0iypVIfm5c5ifOJ4dQ4Om2hhrQ6ibEEJ5IDxs0PVzKc%2FqXTsMptx4PYmb%2FRO3z83Yax5WgV3srs%2Bsenmy1wvWvGxD9XpapIJOfg%3D%3D&X-Amz-Signature=dc23c954d99b822ef0aeb72dba0c12617b70128f39544a6b707b14605f5c74d5&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject"; // Presigned URL for the source NIfTI file
    const httpOrHttps = NODE_ENV === "development" ? "http" : "https"; // Use http for development and https for production
    const callback_url = `${httpOrHttps}://192.168.0.2:${PORT}/gpu-webhook`; // Callback URL for the webhook
    // const callback_url = `https://webhook-test.com/618bf16792c7dd3f3c61fe1204de78cd`; // Debug webhook URL for testing   

    // Get fresh GPU server configuration from database
    const gpuServerAddress = await getFreshGPUServerAddress();
    if (!gpuServerAddress) {
        logger.error(`${serviceLocation}: GPU server configuration is not available.`);
        res.status(500).json({ error: "GPU server configuration is not available." });
        return;
    }
    
    const fullAddress = `${gpuServerAddress}/inference/v2/medsam-inference`; // Full address for the GPU server

    // use axios to send a POST request to the GPU server with the job data
    try {
        const job: IJob = {
            userid: "dummyUserId", // Replace with actual user ID if available
            projectid: "dummyProjectId", // Replace with actual project ID if available
            uuid: uuid,
            status: JobStatus.PENDING,
        };
        // Create a new job in the database
        const createResult = await createJob(job);

        if (!createResult.success) {
            logger.error(`${serviceLocation}: Failed to create job in database: ${createResult.message}`);
            res.status(500).json({ error: "Failed to create job in database." });
            return;
        }
        logger.info(`${serviceLocation}: Job ${uuid} created in database successfully`)

        const response = await axios.post(
            fullAddress,
            {  // This is the request body
                url: url,
                callback_url: callback_url,
                uuid: uuid,
            },
            {  // This is the axios configuration
                headers: {
                    Authorization: `Bearer ${res.locals.gpuAuthToken}`,
                },
                timeout: 100000000,
            }
        );
        if (response.status === 202) {
            logger.info(`${serviceLocation}: GPU server started job successfully`);
            res.status(200).json({
                message: "Job started successfully.",
                status: "online",
                uuid: uuid,
                gpuServerResponse: response.data
            });
        }
    }
    catch (error: any) { // Use 'any' as the error type to avoid TypeScript issues
        // Detailed error handling
        let errorMessage = "GPU is not available.";
        let statusCode = 503;
        let errorDetails: Record<string, any> = {};

        if (isAxiosErrorLike(error)) {
            // Handle specific axios errors
            if (error.code === 'ECONNREFUSED') {
                errorMessage = "Connection to GPU server refused. The server may be down.";
                logger.error(`${serviceLocation}: Connection refused to GPU server at ${fullAddress}`);
                errorDetails = { code: 'ECONNREFUSED', serverAddress: fullAddress };
            }
            else if (error.code === 'ETIMEDOUT') {
                errorMessage = "Connection to GPU server timed out. The server may be overloaded.";
                logger.error(`${serviceLocation}: Connection timeout to GPU server`);
                errorDetails = { code: 'ETIMEDOUT' };
            }
            else if (error.response) {
                // The server responded with a status code outside of 2xx
                statusCode = error.response.status;
                errorMessage = `GPU server returned error: ${error.response.status}`;
                logger.error(`${serviceLocation}: GPU server returned error status ${error.response.status}`);
                errorDetails = {
                    status: error.response.status,
                    data: error.response.data
                };
            }
            else {
                // Something else happened while setting up the request
                errorMessage = error.message || "Unknown error occurred connecting to GPU server";
                logger.error(`${serviceLocation}: Request setup error: ${error.message}`);
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
        LogError(error, serviceLocation, `Error while checking GPU status: ${errorMessage}`);

        res.status(statusCode).json({
            message: errorMessage,
            status: "offline",
            details: errorDetails
        });
    }
})

// webhook to receive the result of the bbox inferencing
router.post('/gpu-webhook', async (req: Request, res: Response): Promise<void> => {
    logger.info(`${serviceLocation}: Received webhook call from GPU server`, req.body);

    // Extract all fields from the callback payload
    const { uuid, status, result, error } = req.body;

    // Validate required fields
    if (!uuid) {
        logger.warn(`${serviceLocation}: Missing uuid in webhook payload`);
        res.status(400).json({ error: "Missing uuid in the request body" });
        return;
    }

    try {
        // First, check if the job exists
        const jobResult = await readJob(uuid);

        if (!jobResult.success) {
            logger.warn(`${serviceLocation}: Job ${uuid} not found in database during webhook processing`);
            res.status(404).json({ error: `Job with uuid ${uuid} not found` });
            return;
        }

        // Get the results of the bounding boxes here:
        // logger.info(`Result: ${JSON.stringify(result, null, 2)}`);
        // logger.info(`Error details: ${JSON.stringify(error_detail, null, 2)}`);

        // Map the status from the callback to our JobStatus enum
        let newStatus: JobStatus;
        if (status === "completed") {
            newStatus = JobStatus.COMPLETED;
        } else if (status === "failed") {
            newStatus = JobStatus.FAILED;
        } else {
            // Default case for unknown status
            newStatus = JobStatus.FAILED;
            logger.warn(`${serviceLocation}: Unknown job status "${status}" received for ${uuid}`);
        }
        
        // Update the job status in the database
        const updateResult = await updateJob(uuid, { status: newStatus, message: req.body.message });
        logger.info(`${serviceLocation}: Updating job ${uuid} status to ${newStatus} completed with database ${updateResult.success ? "success" : "failure"}`);

        // ALERT: this section should update the segmentation mask related to the job in the database

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        LogError(
            error instanceof Error ? error : new Error(errorMessage),
            serviceLocation,
            `Error processing webhook for job ${uuid}`
        );
        logger.error(`${serviceLocation}: Error processing webhook:`, error);

        res.status(500).json({
            error: "Internal server error while processing webhook",
            message: errorMessage
        });
    } finally {
        // Make sure we always respond to the GPU server
        if (!res.headersSent) {
            res.status(200).json({ message: "Webhook received" });
        }
    }
});

export default router; // Export the router for use in the main app