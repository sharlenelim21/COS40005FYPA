// src/routes/s3_metrics.ts
import express, { Request, Response } from "express";
import {
  getS3BucketSizeMetrics,
  getS3NumberOfObjectsMetrics,
  getS3AllRequestsMetrics,
  getS3GetRequestsMetrics,
  getS3PutRequestsMetrics,
  getAllS3Metrics
} from "../services/cloudwatch";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import logger from "../services/logger";

const router = express.Router();

const REGION = process.env.AWS_REGION || "ap-southeast-1";
const s3Client = new S3Client({ region: REGION });

const toSingleString = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

// Helper function to handle metric requests
async function handleMetricRequest(
  req: Request,
  res: Response,
  metricName: string,
  fetchFunction: (bucketName: string) => Promise<{ timestamps: string[]; values: number[] }>
): Promise<void> {
  try {
    const bucketName = toSingleString(req.params.bucketName);

    if (!bucketName) {
      res.status(400).json({ error: 'Bucket name is required' });
      return;
    }

    logger.info(`API(S3Metrics): Received request for ${metricName} metrics for bucket ${bucketName}`);

    // Fetch metric data from CloudWatch
    const metricData = await fetchFunction(bucketName);

    // Return the metrics in the requested format
    res.status(200).json({
      timestamps: metricData.timestamps,
      values: metricData.values,
    });

    logger.info(`API(S3Metrics): Successfully returned ${metricData.values.length} ${metricName} datapoints for bucket ${bucketName}`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`API(S3Metrics): Failed to fetch ${metricName} metrics: ${errorMessage}`);

    res.status(500).json({
      error: `Failed to fetch ${metricName} metrics`,
      message: errorMessage,
    });
  }
}

// Route: GET /metrics/s3/buckets - List all S3 buckets
router.get("/buckets", async (_req: Request, res: Response) => {
  try {
    const buckets = await s3Client.send(new ListBucketsCommand({}));
    res.json({ buckets: buckets.Buckets });
  } catch (error) {
    logger.error("Error listing S3 buckets:", error);
    res.status(500).json({ message: "Failed to list S3 buckets", error });
  }
});

// Route: GET /metrics/s3/:bucketName/bucket-size - Fetch bucket size metrics
router.get("/:bucketName/bucket-size", async (req: Request, res: Response): Promise<void> => {
  await handleMetricRequest(req, res, 'Bucket Size', getS3BucketSizeMetrics);
});

// Route: GET /metrics/s3/:bucketName/object-count - Fetch number of objects metrics
router.get("/:bucketName/object-count", async (req: Request, res: Response): Promise<void> => {
  await handleMetricRequest(req, res, 'Object Count', getS3NumberOfObjectsMetrics);
});

// Route: GET /metrics/s3/:bucketName/all-requests - Fetch all requests metrics
router.get("/:bucketName/all-requests", async (req: Request, res: Response): Promise<void> => {
  await handleMetricRequest(req, res, 'All Requests', getS3AllRequestsMetrics);
});

// Route: GET /metrics/s3/:bucketName/get-requests - Fetch GET requests metrics
router.get("/:bucketName/get-requests", async (req: Request, res: Response): Promise<void> => {
  await handleMetricRequest(req, res, 'GET Requests', getS3GetRequestsMetrics);
});

// Route: GET /metrics/s3/:bucketName/put-requests - Fetch PUT requests metrics
router.get("/:bucketName/put-requests", async (req: Request, res: Response): Promise<void> => {
  await handleMetricRequest(req, res, 'PUT Requests', getS3PutRequestsMetrics);
});

// Route: GET /metrics/s3/:bucketName/all - Fetch all S3 metrics for a bucket
router.get("/:bucketName/all", async (req: Request, res: Response) => {
  try {
    const bucketName = toSingleString(req.params.bucketName);

    if (!bucketName) {
      res.status(400).json({ error: 'Bucket name is required' });
      return;
    }

    logger.info(`API(S3Metrics): Received request for all S3 metrics for bucket ${bucketName}`);

    // Fetch all metrics for the bucket
    const allMetrics = await getAllS3Metrics(bucketName);

    res.status(200).json(allMetrics);

    logger.info(`API(S3Metrics): Successfully returned all S3 metrics for bucket ${bucketName}`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`API(S3Metrics): Failed to fetch all S3 metrics: ${errorMessage}`);

    res.status(500).json({
      error: 'Failed to fetch all S3 metrics',
      message: errorMessage,
    });
  }
});

export default router;