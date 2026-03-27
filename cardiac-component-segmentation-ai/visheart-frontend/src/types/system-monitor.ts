export interface GpuStatus {
  status: "online" | "offline" | "degraded" | "timeout";
  message: string;
  details: {
    status: string;
    gpu: {
      gpu_name: string;
      architecture: string;
      cuda_version: string;
      memory_total_mb: number;
      memory_used_mb: number;
      gpu_utilization_percent: number;
      status: string;
    };
  } | {
    code?: string;
  };
}

export interface GpuSystemStatus {
  status: "online" | "offline" | "degraded" | "timeout";
  message: string;
  details: {
    status: string;
    cpu: {
      usage_percent: number;
      core_count: number;
      status: string;
    };
    memory: {
      total_gb: number;
      used_gb: number;
      usage_percent: number;
      status: string;
    };
    disk: {
      total_gb: number;
      used_gb: number;
      usage_percent: number;
      status: string;
    };
    system: {
      platform: string;
      release: string;
      boot_time: string;
      uptime_days: number;
    };
    timestamp: string;
  };
}

export interface SystemMonitorData {
  gpuStatus: GpuStatus | null;
  gpuSystemStatus: GpuSystemStatus | null;
  isLoading: boolean;
  lastUpdated: Date | null;
}

export interface GpuConfig {
  host: string;
  port: number;
  isHTTPS: boolean;
  description?: string;
  serverIdForGpuServer: string;
  gpuServerIdentity: string;
  jwtRefreshInterval: number;
  jwtLifetimeSeconds: number;
  createdAt: string;
  updatedAt: string;
  setBy: string;
  hasJwtSecret: boolean;
}

export interface GpuConfigUpdateData {
  host?: string;
  port?: number;
  isHTTPS?: boolean;
  description?: string;
  serverIdForGpuServer?: string;
  gpuServerIdentity?: string;
  gpuServerAuthJwtSecret?: string;
  jwtRefreshInterval?: number;
  jwtLifetimeSeconds?: number;
}

export interface GpuConfigResponse {
  success: boolean;
  gpuHost?: GpuConfig;
  message?: string;
}

export interface GpuConnectionTestResponse {
  success: boolean;
  message: string;
  serverAddress?: string;
  testUrl?: string;
  status?: number;
  statusText?: string;
  reachable?: boolean;
  error?: string;
}

export interface MetricData {
  timestamps: string[];
  values: number[];
}

// Cost Explorer Types
export interface CostData {
  service: string;
  amount: number;
  unit: string;
}

// S3 CloudWatch Metrics Types
export interface S3Metrics {
  bucketName: string;
  bucketSizeBytes: MetricData;
  numberOfObjects: MetricData;
  allRequests: MetricData;
  getRequests: MetricData;
  putRequests: MetricData;
}

export interface S3BucketInfo {
  name: string;
  region: string;
  description: string;
}

export interface RequestMetricsSummary {
  total: number;
  get: number;
  put: number;
  other: number;
}

export interface ChartDataPoint {
  timestamp: string;
  value?: number;
  total?: number;
  get?: number;
  put?: number;
  label?: string;
}

// Backward compatibility
export type CpuMetrics = MetricData;
