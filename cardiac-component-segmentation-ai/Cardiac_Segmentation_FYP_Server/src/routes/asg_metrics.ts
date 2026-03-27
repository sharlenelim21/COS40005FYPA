import express from 'express';
import {
    getASGGroupMinSizeMetrics,
    getASGGroupMaxSizeMetrics,
    getASGGroupDesiredCapacityMetrics,
    getASGGroupInServiceInstancesMetrics,
    getASGGroupPendingInstancesMetrics,
    getASGGroupTotalInstancesMetrics,
} from '../services/cloudwatch';
import logger from '../services/logger';

const router = express.Router();
const serviceLocation = 'ASG Metrics Routes';

// GET /metrics/asg/min-size - Get ASG Group Min Size metrics
router.get('/min-size', async (req, res) => {
    try {
        logger.info(`${serviceLocation}: Fetching ASG Group Min Size metrics`);
        const metrics = await getASGGroupMinSizeMetrics();
        res.json(metrics);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Error fetching ASG Group Min Size metrics: ${errorMessage}`);

        // Check for specific error types
        if (errorMessage.includes('ASG_NAME environment variable is not set')) {
            return res.status(400).json({
                error: 'Configuration Error',
                message: 'ASG_NAME environment variable is not configured'
            });
        }

        if (errorMessage.includes('InvalidAccessKeyId') || errorMessage.includes('SignatureDoesNotMatch')) {
            return res.status(403).json({
                error: 'Authentication Error',
                message: 'Invalid AWS credentials'
            });
        }

        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve ASG Group Min Size metrics'
        });
    }
});

// GET /metrics/asg/max-size - Get ASG Group Max Size metrics
router.get('/max-size', async (req, res) => {
    try {
        logger.info(`${serviceLocation}: Fetching ASG Group Max Size metrics`);
        const metrics = await getASGGroupMaxSizeMetrics();
        res.json(metrics);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Error fetching ASG Group Max Size metrics: ${errorMessage}`);

        // Check for specific error types
        if (errorMessage.includes('ASG_NAME environment variable is not set')) {
            return res.status(400).json({
                error: 'Configuration Error',
                message: 'ASG_NAME environment variable is not configured'
            });
        }

        if (errorMessage.includes('InvalidAccessKeyId') || errorMessage.includes('SignatureDoesNotMatch')) {
            return res.status(403).json({
                error: 'Authentication Error',
                message: 'Invalid AWS credentials'
            });
        }

        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve ASG Group Max Size metrics'
        });
    }
});

// GET /metrics/asg/desired-capacity - Get ASG Group Desired Capacity metrics
router.get('/desired-capacity', async (req, res) => {
    try {
        logger.info(`${serviceLocation}: Fetching ASG Group Desired Capacity metrics`);
        const metrics = await getASGGroupDesiredCapacityMetrics();
        res.json(metrics);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Error fetching ASG Group Desired Capacity metrics: ${errorMessage}`);

        // Check for specific error types
        if (errorMessage.includes('ASG_NAME environment variable is not set')) {
            return res.status(400).json({
                error: 'Configuration Error',
                message: 'ASG_NAME environment variable is not configured'
            });
        }

        if (errorMessage.includes('InvalidAccessKeyId') || errorMessage.includes('SignatureDoesNotMatch')) {
            return res.status(403).json({
                error: 'Authentication Error',
                message: 'Invalid AWS credentials'
            });
        }

        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve ASG Group Desired Capacity metrics'
        });
    }
});

// GET /metrics/asg/in-service - Get ASG Group In Service Instances metrics
router.get('/in-service', async (req, res) => {
    try {
        logger.info(`${serviceLocation}: Fetching ASG Group In Service Instances metrics`);
        const metrics = await getASGGroupInServiceInstancesMetrics();
        res.json(metrics);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Error fetching ASG Group In Service Instances metrics: ${errorMessage}`);

        // Check for specific error types
        if (errorMessage.includes('ASG_NAME environment variable is not set')) {
            return res.status(400).json({
                error: 'Configuration Error',
                message: 'ASG_NAME environment variable is not configured'
            });
        }

        if (errorMessage.includes('InvalidAccessKeyId') || errorMessage.includes('SignatureDoesNotMatch')) {
            return res.status(403).json({
                error: 'Authentication Error',
                message: 'Invalid AWS credentials'
            });
        }

        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve ASG Group In Service Instances metrics'
        });
    }
});

// GET /metrics/asg/pending - Get ASG Group Pending Instances metrics
router.get('/pending', async (req, res) => {
    try {
        logger.info(`${serviceLocation}: Fetching ASG Group Pending Instances metrics`);
        const metrics = await getASGGroupPendingInstancesMetrics();
        res.json(metrics);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Error fetching ASG Group Pending Instances metrics: ${errorMessage}`);

        // Check for specific error types
        if (errorMessage.includes('ASG_NAME environment variable is not set')) {
            return res.status(400).json({
                error: 'Configuration Error',
                message: 'ASG_NAME environment variable is not configured'
            });
        }

        if (errorMessage.includes('InvalidAccessKeyId') || errorMessage.includes('SignatureDoesNotMatch')) {
            return res.status(403).json({
                error: 'Authentication Error',
                message: 'Invalid AWS credentials'
            });
        }

        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve ASG Group Pending Instances metrics'
        });
    }
});

// GET /metrics/asg/total - Get ASG Group Total Instances metrics
router.get('/total', async (req, res) => {
    try {
        logger.info(`${serviceLocation}: Fetching ASG Group Total Instances metrics`);
        const metrics = await getASGGroupTotalInstancesMetrics();
        res.json(metrics);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Error fetching ASG Group Total Instances metrics: ${errorMessage}`);

        // Check for specific error types
        if (errorMessage.includes('ASG_NAME environment variable is not set')) {
            return res.status(400).json({
                error: 'Configuration Error',
                message: 'ASG_NAME environment variable is not configured'
            });
        }

        if (errorMessage.includes('InvalidAccessKeyId') || errorMessage.includes('SignatureDoesNotMatch')) {
            return res.status(403).json({
                error: 'Authentication Error',
                message: 'Invalid AWS credentials'
            });
        }

        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to retrieve ASG Group Total Instances metrics'
        });
    }
});

export default router;
