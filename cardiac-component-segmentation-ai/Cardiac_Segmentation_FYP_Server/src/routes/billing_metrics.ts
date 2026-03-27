import express from 'express';
import { getTotalCosts, getCostsByService, CostData } from '../services/cloudwatch';
import logger from '../services/logger';

const router = express.Router();
const serviceLocation = 'Billing Metrics Routes';

// GET /metrics/billing/total - Get total AWS costs for current month
router.get('/total', async (req: express.Request, res: express.Response) => {
    try {
        logger.info(`${serviceLocation}: Fetching total AWS costs`);
        
        const costData: CostData[] = await getTotalCosts();
        
        logger.info(`${serviceLocation}: Successfully retrieved ${costData.length} cost entries`);
        
        res.json({
            success: true,
            data: costData,
            timestamp: new Date().toISOString(),
        });
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Failed to fetch total costs: ${errorMessage}`);
        
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve total costs',
            message: errorMessage,
            timestamp: new Date().toISOString(),
        });
    }
});

// GET /metrics/billing/by-service - Get AWS costs grouped by service for current month
router.get('/by-service', async (req: express.Request, res: express.Response) => {
    try {
        logger.info(`${serviceLocation}: Fetching AWS costs by service`);
        
        const costData: CostData[] = await getCostsByService();
        
        logger.info(`${serviceLocation}: Successfully retrieved ${costData.length} service cost entries`);
        
        res.json({
            success: true,
            data: costData,
            timestamp: new Date().toISOString(),
        });
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Failed to fetch costs by service: ${errorMessage}`);
        
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve costs by service',
            message: errorMessage,
            timestamp: new Date().toISOString(),
        });
    }
});

export default router;