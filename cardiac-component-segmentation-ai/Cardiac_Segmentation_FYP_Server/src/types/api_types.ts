// File: src/types/api_types.ts
// Description: TypeScript interfaces for API responses and metrics

// ===== CloudWatch Metrics Types =====

/**
 * Generic metric data structure for CloudWatch metrics
 * @interface MetricData
 * @property {string[]} timestamps - Array of ISO timestamp strings
 * @property {number[]} values - Array of metric values corresponding to timestamps
 */
export interface MetricData {
    timestamps: string[];
    values: number[];
}

// ===== S3 CloudWatch Metrics Types =====

/**
 * Comprehensive S3 metrics data structure
 * @interface S3Metrics
 * @property {string} bucketName - Name of the S3 bucket
 * @property {MetricData} bucketSizeBytes - Bucket size in bytes over time
 * @property {MetricData} numberOfObjects - Number of objects in bucket over time
 * @property {MetricData} allRequests - Total requests to bucket over time
 * @property {MetricData} getRequests - GET requests to bucket over time
 * @property {MetricData} putRequests - PUT requests to bucket over time
 */
export interface S3Metrics {
    bucketName: string;
    bucketSizeBytes: MetricData;
    numberOfObjects: MetricData;
    allRequests: MetricData;
    getRequests: MetricData;
    putRequests: MetricData;
}

/**
 * S3 bucket information for frontend display
 * @interface S3BucketInfo
 * @property {string} name - Bucket name
 * @property {string} region - AWS region where bucket is located
 * @property {string} description - Human-readable description of bucket purpose
 */
export interface S3BucketInfo {
    name: string;
    region: string;
    description: string;
}

// ===== API Response Types =====

/**
 * Standard API error response structure
 * @interface ApiErrorResponse
 * @property {string} error - Error type/category
 * @property {string} message - Human-readable error message
 * @property {string} [bucketName] - Bucket name if applicable to the error
 * @property {number} [statusCode] - HTTP status code
 */
export interface ApiErrorResponse {
    error: string;
    message: string;
    bucketName?: string;
    statusCode?: number;
}

/**
 * Standard API success response structure for S3 metrics
 * @interface S3MetricsResponse
 * @property {S3Metrics} data - The S3 metrics data
 * @property {string} timestamp - When the data was retrieved
 * @property {string} status - Response status ('success')
 */
export interface S3MetricsResponse {
    data: S3Metrics;
    timestamp: string;
    status: 'success';
}

// ===== EC2 and ECR Metrics Types (for consistency) =====

/**
 * EC2 instance metrics data structure
 * @interface EC2Metrics
 * @property {string} instanceId - EC2 instance ID
 * @property {MetricData} cpuUtilization - CPU utilization percentage over time
 * @property {MetricData} networkIn - Network bytes in over time
 * @property {MetricData} networkOut - Network bytes out over time
 * @property {MetricData} diskRead - Disk read bytes over time
 * @property {MetricData} diskWrite - Disk write bytes over time
 */
export interface EC2Metrics {
    instanceId: string;
    cpuUtilization: MetricData;
    networkIn: MetricData;
    networkOut: MetricData;
    diskRead: MetricData;
    diskWrite: MetricData;
}

/**
 * ECR repository metrics data structure
 * @interface ECRMetrics
 * @property {string} repositoryName - ECR repository name
 * @property {MetricData} repositorySize - Repository size in bytes over time
 * @property {MetricData} imageCount - Number of images in repository over time
 */
export interface ECRMetrics {
    repositoryName: string;
    repositorySize: MetricData;
    imageCount: MetricData;
}

// ===== Frontend Form Types =====

/**
 * S3 bucket selector form data
 * @interface S3BucketFormData
 * @property {string} bucketName - Selected bucket name
 * @property {string} region - Selected AWS region
 */
export interface S3BucketFormData {
    bucketName: string;
    region: string;
}

// ===== Utility Types =====

/**
 * Metric state for React components
 * @interface MetricState
 * @property {T | null} data - Metric data or null if not loaded
 * @property {boolean} loading - Whether data is currently being fetched
 * @property {string | null} error - Error message if fetch failed
 */
export interface MetricState<T = MetricData> {
    data: T | null;
    loading: boolean;
    error: string | null;
}

/**
 * Chart data point for Recharts
 * @interface ChartDataPoint
 * @property {string} timestamp - ISO timestamp string
 * @property {number} value - Metric value
 * @property {string} [label] - Human-readable label for timestamp
 */
export interface ChartDataPoint {
    timestamp: string;
    value: number;
    label?: string;
}

/**
 * Request metrics summary for UI display
 * @interface RequestMetricsSummary
 * @property {number} total - Total requests
 * @property {number} get - GET requests
 * @property {number} put - PUT requests
 * @property {number} other - Other request types (calculated as total - get - put)
 */
export interface RequestMetricsSummary {
    total: number;
    get: number;
    put: number;
    other: number;
}