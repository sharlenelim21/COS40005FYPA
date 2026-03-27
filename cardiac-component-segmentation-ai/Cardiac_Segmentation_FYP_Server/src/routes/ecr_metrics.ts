// File: src/routes/ecr_metrics.ts
// Description: Routes for fetching ECR metrics from CloudWatch

import express, { Request, Response } from 'express';
import { 
    getEcrRepositorySizeMetrics, 
    getEcrImageCountMetrics,
    getEcrBackendRepositoryPullCountMetrics,
    getEcrFrontendRepositoryPullCountMetrics,
    getEcrBackendRepositorySizeMetrics,
    getEcrBackendImageCountMetrics,
    getEcrFrontendRepositorySizeMetrics,
} from '../services/cloudwatch';
import logger from '../services/logger';

const router = express.Router();
const serviceLocation = 'API(ECRMetrics)';

// Helper function to handle ECR metric requests
async function handleEcrMetricRequest(
    req: Request,
    res: Response,
    metricName: string,
    fetchFunction: () => Promise<{ timestamps: string[]; values: number[] }>
): Promise<void> {
    try {
        logger.info(`${serviceLocation}: Received request for ${metricName} metrics`);
        
        // Fetch metric data from CloudWatch
        const metricData = await fetchFunction();
        
        // Return the metrics in the requested format
        res.status(200).json({
            timestamps: metricData.timestamps,
            values: metricData.values,
        });
        
        logger.info(`${serviceLocation}: Successfully returned ${metricData.values.length} ${metricName} datapoints`);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Failed to fetch ${metricName} metrics: ${errorMessage}`);
        
        res.status(500).json({
            error: `Failed to fetch ${metricName} metrics`,
            message: errorMessage,
        });
    }
}

// GET /repository-size - Fetch ECR Repository Pull Count metrics (legacy - backend repository)
router.get('/repository-size', async (req: Request, res: Response): Promise<void> => {
    await handleEcrMetricRequest(req, res, 'ECR Repository Pull Count', getEcrRepositorySizeMetrics);
});

// GET /image-count - Fetch ECR Repository Pull Count metrics (legacy - backend repository)
router.get('/image-count', async (req: Request, res: Response): Promise<void> => {
    await handleEcrMetricRequest(req, res, 'ECR Repository Pull Count', getEcrImageCountMetrics);
});

// Backend Repository Routes
// GET /backend/repository-size - Fetch ECR Repository Pull Count metrics for backend
router.get('/backend/repository-size', async (req: Request, res: Response): Promise<void> => {
    await handleEcrMetricRequest(req, res, 'ECR Backend Repository Pull Count', getEcrBackendRepositoryPullCountMetrics);
});

// GET /backend/image-count - Fetch ECR Repository Pull Count metrics for backend
router.get('/backend/image-count', async (req: Request, res: Response): Promise<void> => {
    await handleEcrMetricRequest(req, res, 'ECR Backend Repository Pull Count', getEcrBackendRepositoryPullCountMetrics);
});

// Frontend Repository Routes
// GET /frontend/repository-size - Fetch ECR Repository Pull Count metrics for frontend
router.get('/frontend/repository-size', async (req: Request, res: Response): Promise<void> => {
    await handleEcrMetricRequest(req, res, 'ECR Frontend Repository Pull Count', getEcrFrontendRepositoryPullCountMetrics);
});

// GET /frontend/image-count - Fetch ECR Repository Pull Count metrics for frontend
router.get('/frontend/image-count', async (req: Request, res: Response): Promise<void> => {
    await handleEcrMetricRequest(req, res, 'ECR Frontend Repository Pull Count', getEcrFrontendRepositoryPullCountMetrics);
});

export default router;