// File: src/routes/cpu_metrics.ts
// Description: Routes for fetching EC2 metrics from CloudWatch

import express, { Request, Response } from 'express';
import { 
    getCpuUtilizationMetrics, 
    getNetworkInMetrics, 
    getNetworkOutMetrics, 
    getDiskReadMetrics, 
    getDiskWriteMetrics 
} from '../services/cloudwatch';
import logger from '../services/logger';

const router = express.Router();
const serviceLocation = 'API(EC2Metrics)';

// Helper function to handle metric requests
async function handleMetricRequest(
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

// GET /cpu-utilization - Fetch CPU utilization metrics for the current EC2 instance
router.get('/cpu-utilization', async (req: Request, res: Response): Promise<void> => {
    await handleMetricRequest(req, res, 'CPU utilization', getCpuUtilizationMetrics);
});

// GET /network-in - Fetch Network In metrics for the current EC2 instance
router.get('/network-in', async (req: Request, res: Response): Promise<void> => {
    await handleMetricRequest(req, res, 'Network In', getNetworkInMetrics);
});

// GET /network-out - Fetch Network Out metrics for the current EC2 instance
router.get('/network-out', async (req: Request, res: Response): Promise<void> => {
    await handleMetricRequest(req, res, 'Network Out', getNetworkOutMetrics);
});

// GET /disk-read - Fetch Disk Read Bytes metrics for the current EC2 instance
router.get('/disk-read', async (req: Request, res: Response): Promise<void> => {
    await handleMetricRequest(req, res, 'Disk Read', getDiskReadMetrics);
});

// GET /disk-write - Fetch Disk Write Bytes metrics for the current EC2 instance
router.get('/disk-write', async (req: Request, res: Response): Promise<void> => {
    await handleMetricRequest(req, res, 'Disk Write', getDiskWriteMetrics);
});

export default router;