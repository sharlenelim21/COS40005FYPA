// File: src/services/cloudwatch.ts
// Description: CloudWatch service for fetching EC2 metrics

import { CloudWatchClient, GetMetricStatisticsCommand, GetMetricStatisticsCommandInput } from '@aws-sdk/client-cloudwatch';
import { CostExplorerClient, GetCostAndUsageCommand, GetCostAndUsageCommandInput } from '@aws-sdk/client-cost-explorer';
import logger from './logger';

const serviceLocation = 'CloudWatchService';

// Create CloudWatch client instance
let cloudWatchClientInstance: CloudWatchClient | null = null;

// Get singleton CloudWatch client
function getCloudWatchClient(): CloudWatchClient {
    if (!cloudWatchClientInstance) {
        cloudWatchClientInstance = new CloudWatchClient({
            region: process.env.AWS_REGION || 'us-east-1',
        });
        logger.info(`${serviceLocation}: CloudWatch client initialized for region ${process.env.AWS_REGION || 'us-east-1'}`);
    }
    return cloudWatchClientInstance;
}

// Create Cost Explorer client instance
let costExplorerClientInstance: CostExplorerClient | null = null;

// Get singleton Cost Explorer client
function getCostExplorerClient(): CostExplorerClient {
    if (!costExplorerClientInstance) {
        costExplorerClientInstance = new CostExplorerClient({
            region: process.env.AWS_REGION || 'us-east-1',
        });
        logger.info(`${serviceLocation}: Cost Explorer client initialized for region ${process.env.AWS_REGION || 'us-east-1'}`);
    }
    return costExplorerClientInstance;
}

// Get EC2 instance ID from environment variable or metadata service
async function getCurrentInstanceId(): Promise<string> {
    try {
        // First, check if instance ID is provided via environment variable
        if (process.env.EC2_INSTANCE_ID) {
            logger.info(`${serviceLocation}: Using instance ID from environment variable: ${process.env.EC2_INSTANCE_ID}`);
            return process.env.EC2_INSTANCE_ID;
        }
        
        // Fallback to EC2 metadata service
        logger.info(`${serviceLocation}: EC2_INSTANCE_ID not found in environment, fetching from metadata service`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout
        
        const response = await fetch('http://169.254.169.254/latest/meta-data/instance-id', {
            signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch instance ID from metadata service: ${response.status}`);
        }
        
        const instanceId = await response.text();
        logger.info(`${serviceLocation}: Retrieved instance ID from metadata service: ${instanceId}`);
        return instanceId;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Failed to get instance ID: ${errorMessage}`);
        throw new Error(`Unable to retrieve EC2 instance ID. Please set EC2_INSTANCE_ID environment variable or ensure EC2 metadata service is accessible: ${errorMessage}`);
    }
}

// Interface for metric data (generic for all metrics)
export interface MetricData {
    timestamps: string[];
    values: number[];
}

// Generic function to fetch EC2 metrics from CloudWatch
async function getEC2Metric(metricName: string, statistic: 'Average' | 'Sum' = 'Average'): Promise<MetricData> {
    try {
        // Get current instance ID
        const instanceId = await getCurrentInstanceId();
        
        // Calculate time range (last 1 hour)
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 60 * 60 * 1000); // 1 hour ago
        
        // Prepare CloudWatch request
        const params: GetMetricStatisticsCommandInput = {
            Namespace: 'AWS/EC2',
            MetricName: metricName,
            Dimensions: [
                {
                    Name: 'InstanceId',
                    Value: instanceId,
                },
            ],
            StartTime: startTime,
            EndTime: endTime,
            Period: 300, // 5 minutes in seconds
            Statistics: [statistic],
        };
        
        logger.info(`${serviceLocation}: Fetching ${metricName} metrics for instance ${instanceId} from ${startTime.toISOString()} to ${endTime.toISOString()}`);
        
        // Execute CloudWatch query
        const client = getCloudWatchClient();
        const command = new GetMetricStatisticsCommand(params);
        const response = await client.send(command);
        
        // Process response data
        const datapoints = response.Datapoints || [];
        
        // Sort datapoints by timestamp (ascending order)
        datapoints.sort((a, b) => {
            const timeA = a.Timestamp?.getTime() || 0;
            const timeB = b.Timestamp?.getTime() || 0;
            return timeA - timeB;
        });
        
        // Extract timestamps and values based on statistic type
        const timestamps = datapoints.map(point => point.Timestamp?.toISOString() || '');
        const values = datapoints.map(point => {
            const value = statistic === 'Average' ? point.Average : point.Sum;
            return Number((value || 0).toFixed(1));
        });
        
        logger.info(`${serviceLocation}: Retrieved ${datapoints.length} ${metricName} datapoints for instance ${instanceId}`);
        
        return {
            timestamps,
            values,
        };
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Failed to fetch ${metricName} metrics: ${errorMessage}`);
        throw new Error(`Failed to retrieve ${metricName} metrics: ${errorMessage}`);
    }
}

// Fetch CPU utilization metrics for the current EC2 instance
export async function getCpuUtilizationMetrics(): Promise<MetricData> {
    return getEC2Metric('CPUUtilization', 'Average');
}

// Fetch Network In metrics for the current EC2 instance
export async function getNetworkInMetrics(): Promise<MetricData> {
    return getEC2Metric('NetworkIn', 'Sum');
}

// Fetch Network Out metrics for the current EC2 instance
export async function getNetworkOutMetrics(): Promise<MetricData> {
    return getEC2Metric('NetworkOut', 'Sum');
}

// Fetch Disk Read Bytes metrics for the current EC2 instance
export async function getDiskReadMetrics(): Promise<MetricData> {
    return getEC2Metric('DiskReadBytes', 'Sum');
}

// Fetch Disk Write Bytes metrics for the current EC2 instance
export async function getDiskWriteMetrics(): Promise<MetricData> {
    return getEC2Metric('DiskWriteBytes', 'Sum');
}

// Generic function to fetch ECR metrics from CloudWatch
async function getECRMetric(metricName: string, repositoryName: string, statistic: 'Average' | 'Sum' | 'Maximum' = 'Maximum'): Promise<MetricData> {
    try {
        // Validate repository name parameter
        if (!repositoryName) {
            throw new Error('Repository name is required for ECR metrics');
        }
        
        // Calculate time range (last 7 days for ECR metrics as they update daily)
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
        
        // Prepare CloudWatch request
        const params: GetMetricStatisticsCommandInput = {
            Namespace: 'AWS/ECR',
            MetricName: metricName,
            Dimensions: [
                {
                    Name: 'RepositoryName',
                    Value: repositoryName,
                },
            ],
            StartTime: startTime,
            EndTime: endTime,
            Period: 86400, // 1 day in seconds
            Statistics: [statistic],
        };
        
        logger.info(`${serviceLocation}: Fetching ${metricName} metrics for ECR repository ${repositoryName} from ${startTime.toISOString()} to ${endTime.toISOString()}`);
        
        // Execute CloudWatch query
        const client = getCloudWatchClient();
        const command = new GetMetricStatisticsCommand(params);
        const response = await client.send(command);
        
        // Process response data
        const datapoints = response.Datapoints || [];
        
        // Sort datapoints by timestamp (ascending order)
        datapoints.sort((a, b) => {
            const timeA = a.Timestamp?.getTime() || 0;
            const timeB = b.Timestamp?.getTime() || 0;
            return timeA - timeB;
        });
        
        // Extract timestamps and values based on statistic type
        const timestamps = datapoints.map(point => point.Timestamp?.toISOString() || '');
        const values = datapoints.map(point => {
            let value: number;
            switch (statistic) {
                case 'Average':
                    value = point.Average || 0;
                    break;
                case 'Sum':
                    value = point.Sum || 0;
                    break;
                case 'Maximum':
                default:
                    value = point.Maximum || 0;
                    break;
            }
            return Number(value.toFixed(0)); // ECR metrics are typically whole numbers
        });
        
        logger.info(`${serviceLocation}: Retrieved ${datapoints.length} ${metricName} datapoints for ECR repository ${repositoryName}`);
        
        return {
            timestamps,
            values,
        };
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Failed to fetch ECR ${metricName} metrics for ${repositoryName}: ${errorMessage}`);
        throw new Error(`Failed to retrieve ECR ${metricName} metrics for ${repositoryName}: ${errorMessage}`);
    }
}

// Fetch ECR Repository Pull Count metrics for backend repository
export async function getEcrBackendRepositoryPullCountMetrics(): Promise<MetricData> {
    const repositoryName = process.env.ECR_BACKEND_REPOSITORY_NAME || 'cardiac_segmentation_fyp_server_backend';
    return getECRMetric('RepositoryPullCount', repositoryName, 'Sum');
}

// Fetch ECR Repository Pull Count metrics for frontend repository
export async function getEcrFrontendRepositoryPullCountMetrics(): Promise<MetricData> {
    const repositoryName = process.env.ECR_FRONTEND_REPOSITORY_NAME || 'cardiac_segmentation_fyp_server_frontend';
    return getECRMetric('RepositoryPullCount', repositoryName, 'Sum');
}

// Legacy functions for backward compatibility (use backend repository pull count)
export async function getEcrRepositorySizeMetrics(): Promise<MetricData> {
    return getEcrBackendRepositoryPullCountMetrics();
}

export async function getEcrImageCountMetrics(): Promise<MetricData> {
    return getEcrBackendRepositoryPullCountMetrics();
}

// Fetch ECR Repository Size metrics for backend repository (Note: Size metrics not available in CloudWatch)
export async function getEcrBackendRepositorySizeMetrics(): Promise<MetricData> {
    // ECR doesn't provide size metrics in CloudWatch, return empty data
    logger.warn(`${serviceLocation}: ECR RepositorySizeBytes metric not available in CloudWatch. Consider using ECR API for size information.`);
    return { timestamps: [], values: [] };
}

// Fetch ECR Image Count metrics for backend repository (Note: Count metrics not available in CloudWatch)
export async function getEcrBackendImageCountMetrics(): Promise<MetricData> {
    // ECR doesn't provide image count metrics in CloudWatch, return empty data
    logger.warn(`${serviceLocation}: ECR ImageCount metric not available in CloudWatch. Consider using ECR API for image count information.`);
    return { timestamps: [], values: [] };
}

// Fetch ECR Repository Size metrics for frontend repository (Note: Size metrics not available in CloudWatch)
export async function getEcrFrontendRepositorySizeMetrics(): Promise<MetricData> {
    // ECR doesn't provide size metrics in CloudWatch, return empty data
    logger.warn(`${serviceLocation}: ECR RepositorySizeBytes metric not available in CloudWatch. Consider using ECR API for size information.`);
    return { timestamps: [], values: [] };
}

// Fetch ECR Image Count metrics for frontend repository (Note: Count metrics not available in CloudWatch)
export async function getEcrFrontendImageCountMetrics(): Promise<MetricData> {
    // ECR doesn't provide image count metrics in CloudWatch, return empty data
    logger.warn(`${serviceLocation}: ECR ImageCount metric not available in CloudWatch. Consider using ECR API for image count information.`);
    return { timestamps: [], values: [] };
}

// ===== S3 CloudWatch Metrics =====

// S3 Metrics interface for comprehensive bucket metrics
export interface S3Metrics {
    bucketName: string;
    bucketSizeBytes: MetricData;
    numberOfObjects: MetricData;
    allRequests: MetricData;
    getRequests: MetricData;
    putRequests: MetricData;
}

// Generic function to fetch S3 metrics from CloudWatch
async function getS3Metric(
    metricName: string, 
    bucketName: string, 
    statistic: 'Average' | 'Sum' | 'Maximum' = 'Average'
): Promise<MetricData> {
    try {
        // Validate bucket name parameter
        if (!bucketName) {
            throw new Error('Bucket name is required for S3 metrics');
        }
        
        // Calculate time range based on metric type
        const endTime = new Date();
        let startTime: Date;
        let period: number;
        
        // S3 storage metrics (BucketSizeBytes, NumberOfObjects) are daily
        // Request metrics are collected more frequently
        if (metricName === 'BucketSizeBytes' || metricName === 'NumberOfObjects') {
            startTime = new Date(endTime.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
            period = 86400; // 1 day in seconds
        } else {
            startTime = new Date(endTime.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
            period = 3600; // 1 hour in seconds
        }
        
        // Prepare dimensions for S3 metrics
        const dimensions = [
            {
                Name: 'BucketName',
                Value: bucketName,
            },
        ];
        
        // Add appropriate dimension based on metric type
        if (metricName === 'BucketSizeBytes') {
            dimensions.push({
                Name: 'StorageType',
                Value: 'StandardStorage',
            });
        } else if (metricName === 'NumberOfObjects') {
            dimensions.push({
                Name: 'StorageType',
                Value: 'AllStorageTypes',
            });
        } else if (['AllRequests', 'GetRequests', 'PutRequests', 'DeleteRequests', 'HeadRequests', '4xxErrors', '5xxErrors', 'BytesUploaded', 'BytesDownloaded', 'FirstByteLatency', 'TotalRequestLatency'].includes(metricName)) {
            // Request metrics use FilterId instead of StorageType
            dimensions.push({
                Name: 'FilterId',
                Value: 'AllRequestsFilter',
            });
        }
        
        // Prepare CloudWatch request
        const params: GetMetricStatisticsCommandInput = {
            Namespace: 'AWS/S3',
            MetricName: metricName,
            Dimensions: dimensions,
            StartTime: startTime,
            EndTime: endTime,
            Period: period,
            Statistics: [statistic],
        };
        
        logger.info(`${serviceLocation}: Fetching ${metricName} metrics for S3 bucket ${bucketName} from ${startTime.toISOString()} to ${endTime.toISOString()}`);
        
        // Execute CloudWatch query
        const client = getCloudWatchClient();
        const command = new GetMetricStatisticsCommand(params);
        const response = await client.send(command);
        
        // Process response data
        const datapoints = response.Datapoints || [];
        
        // Sort datapoints by timestamp (ascending order)
        datapoints.sort((a, b) => {
            const timeA = a.Timestamp?.getTime() || 0;
            const timeB = b.Timestamp?.getTime() || 0;
            return timeA - timeB;
        });
        
        // Extract timestamps and values based on statistic type
        const timestamps = datapoints.map(point => point.Timestamp?.toISOString() || '');
        const values = datapoints.map(point => {
            let value: number;
            switch (statistic) {
                case 'Average':
                    value = point.Average || 0;
                    break;
                case 'Sum':
                    value = point.Sum || 0;
                    break;
                case 'Maximum':
                default:
                    value = point.Maximum || 0;
                    break;
            }
            return Number(value.toFixed(2));
        });
        
        logger.info(`${serviceLocation}: Retrieved ${datapoints.length} ${metricName} datapoints for S3 bucket ${bucketName}`);
        
        return {
            timestamps,
            values,
        };
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Failed to fetch S3 ${metricName} metrics for bucket ${bucketName}: ${errorMessage}`);
        throw new Error(`Failed to retrieve S3 ${metricName} metrics for bucket ${bucketName}: ${errorMessage}`);
    }
}

// Fetch S3 Bucket Size metrics
export async function getS3BucketSizeMetrics(bucketName: string): Promise<MetricData> {
    return getS3Metric('BucketSizeBytes', bucketName, 'Average');
}

// Fetch S3 Number of Objects metrics
export async function getS3NumberOfObjectsMetrics(bucketName: string): Promise<MetricData> {
    return getS3Metric('NumberOfObjects', bucketName, 'Average');
}

// Fetch S3 All Requests metrics
export async function getS3AllRequestsMetrics(bucketName: string): Promise<MetricData> {
    return getS3Metric('AllRequests', bucketName, 'Sum');
}

// Fetch S3 Get Requests metrics
export async function getS3GetRequestsMetrics(bucketName: string): Promise<MetricData> {
    return getS3Metric('GetRequests', bucketName, 'Sum');
}

// Fetch S3 Put Requests metrics
export async function getS3PutRequestsMetrics(bucketName: string): Promise<MetricData> {
    return getS3Metric('PutRequests', bucketName, 'Sum');
}

// Comprehensive function to fetch all S3 metrics for a bucket
export async function getAllS3Metrics(bucketName: string): Promise<S3Metrics> {
    try {
        logger.info(`${serviceLocation}: Fetching all S3 metrics for bucket ${bucketName}`);
        
        // Fetch all metrics in parallel for better performance
        const [
            bucketSizeBytes,
            numberOfObjects,
            allRequests,
            getRequests,
            putRequests
        ] = await Promise.all([
            getS3BucketSizeMetrics(bucketName),
            getS3NumberOfObjectsMetrics(bucketName),
            getS3AllRequestsMetrics(bucketName),
            getS3GetRequestsMetrics(bucketName),
            getS3PutRequestsMetrics(bucketName)
        ]);
        
        logger.info(`${serviceLocation}: Successfully retrieved all S3 metrics for bucket ${bucketName}`);
        
        return {
            bucketName,
            bucketSizeBytes,
            numberOfObjects,
            allRequests,
            getRequests,
            putRequests
        };
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Failed to fetch all S3 metrics for bucket ${bucketName}: ${errorMessage}`);
        throw new Error(`Failed to retrieve all S3 metrics for bucket ${bucketName}: ${errorMessage}`);
    }
}

// ===== ALB CloudWatch Metrics =====

// Generic function to fetch ALB metrics from CloudWatch
async function getALBMetric(
    metricName: string,
    statistic: 'Average' | 'Sum' | 'Maximum' = 'Average',
    targetGroupArn?: string  // Add optional targetGroupArn parameter
): Promise<MetricData> {
    try {
        // Get ALB name from environment variable
        const albName = process.env.ALB_NAME;
        if (!albName) {
            throw new Error('ALB_NAME environment variable is not set');
        }

        // Calculate time range (last 24 hours for ALB metrics)
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

        // Prepare dimensions
        const dimensions = [
            {
                Name: 'LoadBalancer',
                Value: albName,
            },
        ];

        // Add TargetGroup dimension if provided (required for host count metrics)
        if (targetGroupArn) {
            dimensions.push({
                Name: 'TargetGroup',
                Value: targetGroupArn,
            });
        }

        // Prepare CloudWatch request
        const params: GetMetricStatisticsCommandInput = {
            Namespace: 'AWS/ApplicationELB',
            MetricName: metricName,
            Dimensions: dimensions,
            StartTime: startTime,
            EndTime: endTime,
            Period: 300, // 5 minutes in seconds
            Statistics: [statistic],
        };

        logger.info(`${serviceLocation}: Fetching ${metricName} metrics for ALB ${albName}${targetGroupArn ? ` and TargetGroup ${targetGroupArn}` : ''} from ${startTime.toISOString()} to ${endTime.toISOString()}`);

        // Execute CloudWatch query
        const client = getCloudWatchClient();
        const command = new GetMetricStatisticsCommand(params);
        const response = await client.send(command);

        // Process response data
        const datapoints = response.Datapoints || [];

        // Sort datapoints by timestamp (ascending order)
        datapoints.sort((a, b) => {
            const timeA = a.Timestamp?.getTime() || 0;
            const timeB = b.Timestamp?.getTime() || 0;
            return timeA - timeB;
        });

        // Extract timestamps and values based on statistic type
        const timestamps = datapoints.map(point => point.Timestamp?.toISOString() || '');
        const values = datapoints.map(point => {
            let value: number;
            switch (statistic) {
                case 'Average':
                    value = point.Average || 0;
                    break;
                case 'Sum':
                    value = point.Sum || 0;
                    break;
                case 'Maximum':
                default:
                    value = point.Maximum || 0;
                    break;
            }
            return Number(value.toFixed(2));
        });

        logger.info(`${serviceLocation}: Retrieved ${datapoints.length} ${metricName} datapoints for ALB ${albName}${targetGroupArn ? ` and TargetGroup ${targetGroupArn}` : ''}`);

        return {
            timestamps,
            values,
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Failed to fetch ALB ${metricName} metrics: ${errorMessage}`);
        throw new Error(`Failed to retrieve ALB ${metricName} metrics: ${errorMessage}`);
    }
}

// Fetch ALB Request Count metrics
export async function getALBRequestCountMetrics(): Promise<MetricData> {
    return getALBMetric('RequestCount', 'Sum');
}

// Fetch ALB Target Response Time metrics
export async function getALBTargetResponseTimeMetrics(): Promise<MetricData> {
    return getALBMetric('TargetResponseTime', 'Average');
}

// Fetch ALB HTTP 4XX Error Count (ELB) metrics
export async function getALBHTTP4XXELBMetrics(): Promise<MetricData> {
    return getALBMetric('HTTPCode_ELB_4XX_Count', 'Sum');
}

// Fetch ALB HTTP 4XX Error Count (Target) metrics
export async function getALBHTTP4XXTargetMetrics(): Promise<MetricData> {
    return getALBMetric('HTTPCode_Target_4XX_Count', 'Sum');
}

// Fetch ALB Healthy Host Count metrics (requires TargetGroup)
export async function getALBHealthyHostCountMetrics(): Promise<MetricData> {
    const targetGroupName = process.env.TARGET_GROUP_NAME;
    if (!targetGroupName) {
        throw new Error('TARGET_GROUP_NAME environment variable is not set (required for host count metrics)');
    }
    return getALBMetric('HealthyHostCount', 'Average', targetGroupName);
}

// Fetch ALB Unhealthy Host Count metrics (requires TargetGroup)
export async function getALBUnhealthyHostCountMetrics(): Promise<MetricData> {
    const targetGroupName = process.env.TARGET_GROUP_NAME;
    if (!targetGroupName) {
        throw new Error('TARGET_GROUP_NAME environment variable is not set (required for host count metrics)');
    }
    return getALBMetric('UnHealthyHostCount', 'Average', targetGroupName);
}

// ===== ASG CloudWatch Metrics =====

// Generic function to fetch ASG metrics from CloudWatch
async function getASGMetric(metricName: string, statistic: 'Average' | 'Sum' | 'Maximum' = 'Average'): Promise<MetricData> {
    try {
        // Get ASG name from environment variable
        const asgName = process.env.ASG_NAME;
        if (!asgName) {
            throw new Error('ASG_NAME environment variable is not set');
        }
        
        // Calculate time range (last 1 hour for ASG metrics as they change frequently)
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago
        
        // Prepare CloudWatch request
        const params: GetMetricStatisticsCommandInput = {
            Namespace: 'AWS/AutoScaling',
            MetricName: metricName,
            Dimensions: [
                {
                    Name: 'AutoScalingGroupName',
                    Value: asgName,
                },
            ],
            StartTime: startTime,
            EndTime: endTime,
            Period: 300, // 5 minutes in seconds
            Statistics: [statistic],
        };
        
        logger.info(`${serviceLocation}: Fetching ${metricName} metrics for ASG ${asgName} from ${startTime.toISOString()} to ${endTime.toISOString()}`);
        
        // Execute CloudWatch query
        const client = getCloudWatchClient();
        const command = new GetMetricStatisticsCommand(params);
        const response = await client.send(command);
        
        // Process response data
        const datapoints = response.Datapoints || [];
        
        // Sort datapoints by timestamp (ascending order)
        datapoints.sort((a, b) => {
            const timeA = a.Timestamp?.getTime() || 0;
            const timeB = b.Timestamp?.getTime() || 0;
            return timeA - timeB;
        });
        
        // Extract timestamps and values based on statistic type
        const timestamps = datapoints.map(point => point.Timestamp?.toISOString() || '');
        const values = datapoints.map(point => {
            let value: number;
            switch (statistic) {
                case 'Average':
                    value = point.Average || 0;
                    break;
                case 'Sum':
                    value = point.Sum || 0;
                    break;
                case 'Maximum':
                default:
                    value = point.Maximum || 0;
                    break;
            }
            return Number(value.toFixed(0)); // ASG metrics are typically whole numbers
        });
        
        logger.info(`${serviceLocation}: Retrieved ${datapoints.length} ${metricName} datapoints for ASG ${asgName}`);
        
        return {
            timestamps,
            values,
        };
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Failed to fetch ASG ${metricName} metrics: ${errorMessage}`);
        throw new Error(`Failed to retrieve ASG ${metricName} metrics: ${errorMessage}`);
    }
}

// Fetch ASG Group Min Size metrics
export async function getASGGroupMinSizeMetrics(): Promise<MetricData> {
    return getASGMetric('GroupMinSize', 'Maximum');
}

// Fetch ASG Group Max Size metrics
export async function getASGGroupMaxSizeMetrics(): Promise<MetricData> {
    return getASGMetric('GroupMaxSize', 'Maximum');
}

// Fetch ASG Group Desired Capacity metrics
export async function getASGGroupDesiredCapacityMetrics(): Promise<MetricData> {
    return getASGMetric('GroupDesiredCapacity', 'Average');
}

// Interface for cost data
export interface CostData {
    service: string;
    amount: number;
    unit: string;
}

// Generic function to fetch cost data from Cost Explorer
async function getCostData(
    timePeriod: { Start: string; End: string },
    groupBy?: { Type: 'DIMENSION'; Key: 'SERVICE' }
): Promise<CostData[]> {
    try {
        const client = getCostExplorerClient();
        
        const params: GetCostAndUsageCommandInput = {
            TimePeriod: timePeriod,
            Granularity: 'MONTHLY',
            Metrics: ['BlendedCost'],
            GroupBy: groupBy ? [groupBy] : undefined,
        };
        
        const command = new GetCostAndUsageCommand(params);
        const response = await client.send(command);
        
        logger.info(`${serviceLocation}: Retrieved cost data for period ${timePeriod.Start} to ${timePeriod.End}`);
        
        if (!response.ResultsByTime || response.ResultsByTime.length === 0) {
            logger.warn(`${serviceLocation}: No cost data found for the specified period`);
            return [];
        }
        
        const costData: CostData[] = [];
        
        for (const result of response.ResultsByTime) {
            if (result.Groups && result.Groups.length > 0) {
                // Grouped by service
                for (const group of result.Groups) {
                    const service = group.Keys?.[0] || 'Unknown';
                    const amount = parseFloat(group.Metrics?.BlendedCost?.Amount || '0');
                    const unit = group.Metrics?.BlendedCost?.Unit || 'USD';
                    
                    costData.push({
                        service,
                        amount,
                        unit,
                    });
                }
            } else {
                // Total cost (no grouping)
                const amount = parseFloat(result.Groups?.[0]?.Metrics?.BlendedCost?.Amount || 
                                        result.Total?.BlendedCost?.Amount || '0');
                const unit = result.Groups?.[0]?.Metrics?.BlendedCost?.Unit || 
                           result.Total?.BlendedCost?.Unit || 'USD';
                
                costData.push({
                    service: 'Total',
                    amount,
                    unit,
                });
            }
        }
        
        return costData;
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`${serviceLocation}: Failed to fetch cost data: ${errorMessage}`);
        throw new Error(`Failed to retrieve cost data: ${errorMessage}`);
    }
}

// Fetch total AWS costs for the current month
export async function getTotalCosts(): Promise<CostData[]> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const timePeriod = {
        Start: startOfMonth.toISOString().split('T')[0], // YYYY-MM-DD format
        End: endOfMonth.toISOString().split('T')[0],
    };
    
    return getCostData(timePeriod);
}

// Fetch AWS costs grouped by service for the current month
export async function getCostsByService(): Promise<CostData[]> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const timePeriod = {
        Start: startOfMonth.toISOString().split('T')[0], // YYYY-MM-DD format
        End: endOfMonth.toISOString().split('T')[0],
    };
    
    return getCostData(timePeriod, { Type: 'DIMENSION', Key: 'SERVICE' });
}

// Fetch ASG Group In Service Instances metrics
export async function getASGGroupInServiceInstancesMetrics(): Promise<MetricData> {
    return getASGMetric('GroupInServiceInstances', 'Average');
}

// Fetch ASG Group Pending Instances metrics
export async function getASGGroupPendingInstancesMetrics(): Promise<MetricData> {
    return getASGMetric('GroupPendingInstances', 'Average');
}

// Fetch ASG Group Total Instances metrics
export async function getASGGroupTotalInstancesMetrics(): Promise<MetricData> {
    return getASGMetric('GroupTotalInstances', 'Average');
}