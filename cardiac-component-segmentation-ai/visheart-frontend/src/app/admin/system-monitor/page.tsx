"use client";

import React, { useState, useEffect, useCallback } from "react";
import { statusApi, gpuConfigApi } from "@/lib/api";
import {
  GpuStatus,
  GpuSystemStatus,
  GpuConfig,
  GpuConnectionTestResponse,
  GpuConfigUpdateData,
} from "@/types/system-monitor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle,
  Cpu,
  HardDrive,
  MemoryStick,
  Monitor,
  Server,
  Clock,
  Settings,
  Edit,
  Save,
  X,
  TestTube,
} from "lucide-react";

// Helper function to get status color and icon
const getStatusDisplay = (status: string) => {
  switch (status.toLowerCase()) {
    case "ok":
    case "online":
      return {
        icon: CheckCircle,
        color: "text-green-600",
        bg: "bg-green-100",
        badge: "default" as const,
      };
    case "degraded":
      return {
        icon: AlertCircle,
        color: "text-yellow-600",
        bg: "bg-yellow-100",
        badge: "secondary" as const,
      };
    case "timeout":
      return {
        icon: Clock,
        color: "text-red-600",
        bg: "bg-red-100",
        badge: "destructive" as const,
      };
    case "offline":
    case "error":
      return {
        icon: XCircle,
        color: "text-red-600",
        bg: "bg-red-100",
        badge: "destructive" as const,
      };
    default:
      return {
        icon: AlertCircle,
        color: "text-gray-600",
        bg: "bg-gray-100",
        badge: "outline" as const,
      };
  }
};

// Helper function to format bytes
const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
};

// Helper function to format uptime
const formatUptime = (days: number) => {
  if (days < 1) {
    const hours = Math.floor(days * 24);
    const minutes = Math.floor((days * 24 * 60) % 60);
    return `${hours}h ${minutes}m`;
  }
  return `${Math.floor(days)} days`;
};

export default function SystemMonitorPage() {
  const [gpuStatus, setGpuStatus] = useState<GpuStatus | null>(null);
  const [gpuSystemStatus, setGpuSystemStatus] =
    useState<GpuSystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // GPU Configuration state
  const [gpuConfig, setGpuConfig] = useState<GpuConfig | null>(null);
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [isConfigLoading, setIsConfigLoading] = useState(false);
  const [editFormData, setEditFormData] = useState<GpuConfigUpdateData>({});
  const [connectionTestResult, setConnectionTestResult] =
    useState<GpuConnectionTestResponse | null>(null);

  const fetchSystemData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [gpuResponse, systemResponse] = await Promise.allSettled([
        statusApi.getGpuStatus(),
        statusApi.getGpuSystemStatus(),
      ]);

      if (gpuResponse.status === "fulfilled") {
        const response = gpuResponse.value;
        // Check for timeout indicators in the response
        const hasTimeoutCode = response.details?.code === "ETIMEDOUT";
        const hasTimeoutMessage =
          response.message?.toLowerCase?.().includes?.("timeout") ||
          response.details?.includes?.("timeout");

        if (hasTimeoutCode || hasTimeoutMessage) {
          console.log("⏰ [SystemMonitor] GPU status timeout detected");
          setGpuStatus({
            ...response,
            status: "timeout",
          });
        } else {
          setGpuStatus(response);
        }
      } else {
        console.error("Failed to fetch GPU status:", gpuResponse.reason);
        // Create a fallback timeout status if the promise was rejected due to network issues
        setGpuStatus({
          status: "timeout",
          message: "Failed to fetch GPU status - connection timeout",
          details: { code: "NETWORK_ERROR" },
        });
      }

      if (systemResponse.status === "fulfilled") {
        const response = systemResponse.value;
        // Check for timeout indicators in the system response too
        const hasTimeoutCode = response.details?.code === "ETIMEDOUT";
        const hasTimeoutMessage = response.message
          ?.toLowerCase?.()
          .includes?.("timeout");

        if (hasTimeoutCode || hasTimeoutMessage) {
          console.log("⏰ [SystemMonitor] GPU system status timeout detected");
          setGpuSystemStatus({
            ...response,
            status: "timeout",
          });
        } else {
          setGpuSystemStatus(response);
        }
      } else {
        console.error(
          "Failed to fetch GPU system status:",
          systemResponse.reason,
        );
        // Create a fallback timeout status if the promise was rejected due to network issues
        setGpuSystemStatus({
          status: "timeout",
          message: "Failed to fetch GPU system status - connection timeout",
          details: {
            status: "timeout",
            cpu: { usage_percent: 0, core_count: 0, status: "unknown" },
            memory: {
              total_gb: 0,
              used_gb: 0,
              usage_percent: 0,
              status: "unknown",
            },
            disk: {
              total_gb: 0,
              used_gb: 0,
              usage_percent: 0,
              status: "unknown",
            },
            system: {
              platform: "",
              release: "",
              boot_time: "",
              uptime_days: 0,
            },
            timestamp: new Date().toISOString(),
          },
        });
      }

      setLastUpdated(new Date());
    } catch (err) {
      setError("Failed to fetch system data");
      console.error("System monitor error:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // GPU Configuration functions
  const fetchGpuConfig = useCallback(async () => {
    try {
      setIsConfigLoading(true);
      setConfigError(null);
      const response = await gpuConfigApi.getGpuConfig();
      if (response.success && response.gpuHost) {
        setGpuConfig(response.gpuHost);
      } else {
        setConfigError(response.message || "Failed to fetch GPU configuration");
      }
    } catch (error) {
      setConfigError("Failed to fetch GPU configuration");
      console.error("GPU config fetch error:", error);
    } finally {
      setIsConfigLoading(false);
    }
  }, []);

  const handleEditConfig = () => {
    if (gpuConfig) {
      setEditFormData({ ...gpuConfig });
      setIsEditingConfig(true);
      setConfigError(null);
    }
  };

  const handleCancelEdit = () => {
    setIsEditingConfig(false);
    setEditFormData({});
    setConfigError(null);
  };

  const handleSaveConfig = async () => {
    try {
      setIsConfigLoading(true);
      setConfigError(null);

      const response = await gpuConfigApi.updateGpuConfig(editFormData);
      if (response.success && response.gpuHost) {
        setGpuConfig(response.gpuHost);
        setIsEditingConfig(false);
        setEditFormData({});
        // Optionally reload system data to reflect changes
        await fetchSystemData();
      } else {
        setConfigError(
          response.message || "Failed to update GPU configuration",
        );
      }
    } catch (error) {
      setConfigError("Failed to update GPU configuration");
      console.error("GPU config update error:", error);
    } finally {
      setIsConfigLoading(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      setIsConfigLoading(true);
      setConnectionTestResult(null);

      const response = await gpuConfigApi.testGpuConnection();
      setConnectionTestResult(response);
    } catch (error) {
      setConnectionTestResult({
        success: false,
        message: "Failed to test GPU server connection",
        reachable: false,
      });
      console.error("GPU connection test error:", error);
    } finally {
      setIsConfigLoading(false);
    }
  };

  const handleReloadConfig = async () => {
    try {
      setIsConfigLoading(true);
      setConfigError(null);

      const response = await gpuConfigApi.reloadGpuConfig();
      if (response.success) {
        await fetchGpuConfig(); // Refresh the displayed config
        await fetchSystemData(); // Refresh system data
      } else {
        setConfigError(
          response.message || "Failed to reload GPU configuration",
        );
      }
    } catch (error) {
      setConfigError("Failed to reload GPU configuration");
      console.error("GPU config reload error:", error);
    } finally {
      setIsConfigLoading(false);
    }
  };

  useEffect(() => {
    fetchSystemData();
    fetchGpuConfig(); // Fetch GPU config on component mount
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchSystemData, 30000);
    return () => clearInterval(interval);
  }, [fetchSystemData, fetchGpuConfig]);

  const gpuStatusDisplay = getStatusDisplay(gpuStatus?.status || "offline");
  const systemStatusDisplay = getStatusDisplay(
    gpuSystemStatus?.status || "offline",
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            System Monitor & Configuration
          </h1>
          <p className="text-muted-foreground">
            Monitor GPU server and Node server status in real-time, and
            configure system settings
          </p>
        </div>
        <div className="flex items-center gap-4">
          {lastUpdated && (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4" />
              Last updated: {lastUpdated.toLocaleTimeString()}
            </div>
          )}
          <Button onClick={fetchSystemData} disabled={isLoading}>
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Main Content with Tabs */}
      <Tabs defaultValue="gpu-server" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="gpu-server" className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            GPU Server
          </TabsTrigger>
          <TabsTrigger value="node-server" className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            Node Server
          </TabsTrigger>
        </TabsList>

        {/* GPU Server Tab */}
        <TabsContent value="gpu-server" className="space-y-6">
          {/* GPU Status Overview */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base font-medium">
                  GPU Server Status
                </CardTitle>
                <Monitor className="text-muted-foreground h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <gpuStatusDisplay.icon
                    className={`h-5 w-5 ${gpuStatusDisplay.color}`}
                  />
                  <Badge variant={gpuStatusDisplay.badge}>
                    {gpuStatus?.status?.toUpperCase() || "UNKNOWN"}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1 text-sm">
                  {gpuStatus?.message || "No data available"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base font-medium">
                  GPU System Status
                </CardTitle>
                <Server className="text-muted-foreground h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <systemStatusDisplay.icon
                    className={`h-5 w-5 ${systemStatusDisplay.color}`}
                  />
                  <Badge variant={systemStatusDisplay.badge}>
                    {gpuSystemStatus?.status?.toUpperCase() || "UNKNOWN"}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1 text-sm">
                  {gpuSystemStatus?.message || "No data available"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* GPU Information Section */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              <h2 className="text-2xl font-bold">GPU Hardware Information</h2>
            </div>

            {gpuStatus?.details && "gpu" in gpuStatus.details ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">GPU Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <span className="text-muted-foreground text-sm">
                        Name:
                      </span>
                      <p className="font-medium">
                        {gpuStatus.details.gpu.gpu_name}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-sm">
                        Architecture:
                      </span>
                      <p className="font-medium">
                        {gpuStatus.details.gpu.architecture}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-sm">
                        CUDA Version:
                      </span>
                      <p className="font-medium">
                        {gpuStatus.details.gpu.cuda_version}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">GPU Memory</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm">
                        <span>Memory Usage</span>
                        <span>
                          {formatBytes(
                            gpuStatus.details.gpu.memory_used_mb * 1024 * 1024,
                          )}{" "}
                          /
                          {formatBytes(
                            gpuStatus.details.gpu.memory_total_mb * 1024 * 1024,
                          )}
                        </span>
                      </div>
                      <Progress
                        value={
                          (gpuStatus.details.gpu.memory_used_mb /
                            gpuStatus.details.gpu.memory_total_mb) *
                          100
                        }
                        className="mt-2"
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">GPU Utilization</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm">
                        <span>Utilization</span>
                        <span>
                          {gpuStatus.details.gpu.gpu_utilization_percent}%
                        </span>
                      </div>
                      <Progress
                        value={gpuStatus.details.gpu.gpu_utilization_percent}
                        className="mt-2"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          getStatusDisplay(gpuStatus.details.gpu.status).badge
                        }
                      >
                        {gpuStatus.details.gpu.status.toUpperCase()}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card>
                <CardContent className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <AlertCircle className="text-muted-foreground mx-auto h-12 w-12" />
                    <h3 className="mt-4 text-lg font-semibold">
                      No GPU Data Available
                    </h3>
                    <p className="text-muted-foreground">
                      Unable to fetch GPU information. The GPU server may be
                      offline or experiencing timeout.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* GPU Configuration Section */}
          <div className="space-y-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                <h2 className="text-xl font-bold sm:text-2xl">
                  GPU Server Configuration
                </h2>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={isConfigLoading}
                    className="flex-1 text-xs sm:flex-none sm:text-sm"
                  >
                    <TestTube className="mr-1 h-3 w-3 sm:mr-2 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">Test Connection</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReloadConfig}
                    disabled={isConfigLoading}
                    className="flex-1 text-xs sm:flex-none sm:text-sm"
                  >
                    <RefreshCw
                      className={`mr-1 h-3 w-3 sm:mr-2 sm:h-4 sm:w-4 ${isConfigLoading ? "animate-spin" : ""}`}
                    />
                    <span className="hidden sm:inline">Reload Config</span>
                  </Button>
                </div>
                {!isEditingConfig ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEditConfig}
                    disabled={isConfigLoading || !gpuConfig}
                    className="w-full text-xs sm:w-auto sm:text-sm"
                  >
                    <Edit className="mr-1 h-3 w-3 sm:mr-2 sm:h-4 sm:w-4" />
                    Edit Configuration
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSaveConfig}
                      disabled={isConfigLoading}
                      className="flex-1 text-xs sm:flex-none sm:text-sm"
                    >
                      <Save className="mr-1 h-3 w-3 sm:mr-2 sm:h-4 sm:w-4" />
                      Save
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCancelEdit}
                      disabled={isConfigLoading}
                      className="flex-1 text-xs sm:flex-none sm:text-sm"
                    >
                      <X className="mr-1 h-3 w-3 sm:mr-2 sm:h-4 sm:w-4" />
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Configuration Error Alert */}
            {configError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{configError}</AlertDescription>
              </Alert>
            )}

            {/* Connection Test Result */}
            {connectionTestResult && (
              <Alert
                variant={
                  connectionTestResult.reachable ? "default" : "destructive"
                }
              >
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Connection Test Result:</strong>{" "}
                  {connectionTestResult.message}
                  {connectionTestResult.serverAddress && (
                    <div className="mt-1 text-sm">
                      Server: {connectionTestResult.serverAddress}
                      {connectionTestResult.status &&
                        ` (HTTP ${connectionTestResult.status})`}
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {gpuConfig ? (
              <Card>
                <CardHeader>
                  <CardTitle>Current GPU Server Configuration</CardTitle>
                </CardHeader>
                <CardContent className="p-4 sm:p-6">
                  {isEditingConfig ? (
                    <div className="grid gap-4 sm:grid-cols-2 sm:gap-6">
                      <div>
                        <Label htmlFor="host" className="mb-2 ml-2 text-sm">
                          Host
                        </Label>
                        <Input
                          id="host"
                          value={editFormData.host || ""}
                          onChange={(e) =>
                            setEditFormData((prev) => ({
                              ...prev,
                              host: e.target.value,
                            }))
                          }
                          placeholder="Enter GPU server host"
                          className="h-10 sm:h-auto"
                        />
                      </div>
                      <div>
                        <Label htmlFor="port" className="mb-2 ml-2 text-sm">
                          Port
                        </Label>
                        <Input
                          id="port"
                          type="number"
                          value={editFormData.port || ""}
                          onChange={(e) =>
                            setEditFormData((prev) => ({
                              ...prev,
                              port: parseInt(e.target.value) || 0,
                            }))
                          }
                          placeholder="Enter port number"
                          className="h-10 sm:h-auto"
                        />
                      </div>
                      <div>
                        <Label
                          htmlFor="serverIdForGpuServer"
                          className="mb-2 ml-2 text-sm"
                        >
                          Server ID
                        </Label>
                        <Input
                          id="serverIdForGpuServer"
                          value={editFormData.serverIdForGpuServer || ""}
                          onChange={(e) =>
                            setEditFormData((prev) => ({
                              ...prev,
                              serverIdForGpuServer: e.target.value,
                            }))
                          }
                          placeholder="Enter server ID"
                          className="h-10 sm:h-auto"
                        />
                      </div>
                      <div>
                        <Label
                          htmlFor="gpuServerIdentity"
                          className="mb-2 ml-2 text-sm"
                        >
                          GPU Server Identity
                        </Label>
                        <Input
                          id="gpuServerIdentity"
                          value={editFormData.gpuServerIdentity || ""}
                          onChange={(e) =>
                            setEditFormData((prev) => ({
                              ...prev,
                              gpuServerIdentity: e.target.value,
                            }))
                          }
                          placeholder="Enter GPU server identity"
                          className="h-10 sm:h-auto"
                        />
                      </div>
                      <div>
                        <Label
                          htmlFor="jwtLifetimeSeconds"
                          className="mb-2 ml-2 text-sm"
                        >
                          JWT Lifetime (seconds)
                        </Label>
                        <Input
                          id="jwtLifetimeSeconds"
                          type="number"
                          value={editFormData.jwtLifetimeSeconds || ""}
                          onChange={(e) =>
                            setEditFormData((prev) => ({
                              ...prev,
                              jwtLifetimeSeconds: parseInt(e.target.value) || 0,
                            }))
                          }
                          placeholder="Enter JWT lifetime"
                          className="h-10 sm:h-auto"
                        />
                      </div>
                      <div>
                        <Label
                          htmlFor="jwtRefreshInterval"
                          className="mb-2 ml-2 text-sm"
                        >
                          JWT Refresh Interval (ms)
                        </Label>
                        <Input
                          id="jwtRefreshInterval"
                          type="number"
                          value={editFormData.jwtRefreshInterval || ""}
                          onChange={(e) =>
                            setEditFormData((prev) => ({
                              ...prev,
                              jwtRefreshInterval: parseInt(e.target.value) || 0,
                            }))
                          }
                          placeholder="Enter refresh interval"
                          className="h-10 sm:h-auto"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label
                          htmlFor="description"
                          className="mb-2 ml-2 text-sm"
                        >
                          Description
                        </Label>
                        <Input
                          id="description"
                          value={editFormData.description || ""}
                          onChange={(e) =>
                            setEditFormData((prev) => ({
                              ...prev,
                              description: e.target.value,
                            }))
                          }
                          placeholder="Enter description"
                          className="h-10 sm:h-auto"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label
                          htmlFor="gpuServerAuthJwtSecret"
                          className="mb-2 ml-2 text-sm"
                        >
                          JWT Secret (leave empty to keep current)
                        </Label>
                        <Input
                          id="gpuServerAuthJwtSecret"
                          type="password"
                          value={editFormData.gpuServerAuthJwtSecret || ""}
                          onChange={(e) =>
                            setEditFormData((prev) => ({
                              ...prev,
                              gpuServerAuthJwtSecret: e.target.value,
                            }))
                          }
                          placeholder="Enter new JWT secret (optional)"
                          className="h-10 sm:h-auto"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <div>
                        <span className="text-muted-foreground text-sm">
                          Host:
                        </span>
                        <p className="font-medium">{gpuConfig.host}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-sm">
                          Port:
                        </span>
                        <p className="font-medium">{gpuConfig.port}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-sm">
                          HTTPS:
                        </span>
                        <Badge
                          variant={gpuConfig.isHTTPS ? "default" : "secondary"}
                          className="ml-2"
                        >
                          {gpuConfig.isHTTPS ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-sm">
                          Server ID:
                        </span>
                        <p className="font-medium">
                          {gpuConfig.serverIdForGpuServer}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-sm">
                          GPU Server Identity:
                        </span>
                        <p className="font-medium">
                          {gpuConfig.gpuServerIdentity}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-sm">
                          JWT Secret:
                        </span>
                        <Badge
                          variant={
                            gpuConfig.hasJwtSecret ? "default" : "destructive"
                          }
                          className="ml-2"
                        >
                          {gpuConfig.hasJwtSecret ? "Configured" : "Not Set"}
                        </Badge>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-sm">
                          JWT Lifetime:
                        </span>
                        <p className="font-medium">
                          {gpuConfig.jwtLifetimeSeconds}s
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-sm">
                          JWT Refresh Interval:
                        </span>
                        <p className="font-medium">
                          {gpuConfig.jwtRefreshInterval}ms
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-sm">
                          Last Updated:
                        </span>
                        <p className="font-medium">
                          {new Date(gpuConfig.updatedAt).toLocaleString()}
                        </p>
                      </div>
                      {gpuConfig.description && (
                        <div className="md:col-span-2 lg:col-span-3">
                          <span className="text-muted-foreground text-sm">
                            Description:
                          </span>
                          <p className="font-medium">{gpuConfig.description}</p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <Settings className="text-muted-foreground mx-auto h-12 w-12" />
                    <h3 className="mt-4 text-lg font-semibold">
                      No GPU Configuration Available
                    </h3>
                    <p className="text-muted-foreground">
                      Unable to fetch GPU server configuration. Check your admin
                      permissions.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* GPU Server System Information */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              <h2 className="text-2xl font-bold">
                GPU Server System Information
              </h2>
            </div>

            {gpuSystemStatus?.details ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-lg">CPU</CardTitle>
                    <Cpu className="text-muted-foreground h-4 w-4" />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm">
                        <span>Usage</span>
                        <span>
                          {gpuSystemStatus.details.cpu.usage_percent}%
                        </span>
                      </div>
                      <Progress
                        value={gpuSystemStatus.details.cpu.usage_percent}
                        className="mt-2"
                      />
                    </div>
                    <div>
                      <span className="text-muted-foreground text-sm">
                        Cores:
                      </span>
                      <p className="font-medium">
                        {gpuSystemStatus.details.cpu.core_count}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          getStatusDisplay(gpuSystemStatus.details.cpu.status)
                            .badge
                        }
                      >
                        {gpuSystemStatus.details.cpu.status.toUpperCase()}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-lg">Memory</CardTitle>
                    <MemoryStick className="text-muted-foreground h-4 w-4" />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm">
                        <span>Usage</span>
                        <span>
                          {gpuSystemStatus.details.memory.used_gb.toFixed(1)} GB
                          /{gpuSystemStatus.details.memory.total_gb.toFixed(1)}{" "}
                          GB
                        </span>
                      </div>
                      <Progress
                        value={gpuSystemStatus.details.memory.usage_percent}
                        className="mt-2"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          getStatusDisplay(
                            gpuSystemStatus.details.memory.status,
                          ).badge
                        }
                      >
                        {gpuSystemStatus.details.memory.status.toUpperCase()}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-lg">Storage</CardTitle>
                    <HardDrive className="text-muted-foreground h-4 w-4" />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm">
                        <span>Usage</span>
                        <span>
                          {gpuSystemStatus.details.disk.used_gb.toFixed(1)} GB /
                          {gpuSystemStatus.details.disk.total_gb.toFixed(1)} GB
                        </span>
                      </div>
                      <Progress
                        value={gpuSystemStatus.details.disk.usage_percent}
                        className="mt-2"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          getStatusDisplay(gpuSystemStatus.details.disk.status)
                            .badge
                        }
                      >
                        {gpuSystemStatus.details.disk.status.toUpperCase()}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                <Card className="md:col-span-2 lg:col-span-3">
                  <CardHeader>
                    <CardTitle className="text-lg">
                      System Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <span className="text-muted-foreground text-sm">
                        Platform:
                      </span>
                      <p className="font-medium">
                        {gpuSystemStatus.details.system.platform}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-sm">
                        Release:
                      </span>
                      <p className="font-medium">
                        {gpuSystemStatus.details.system.release}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-sm">
                        Boot Time:
                      </span>
                      <p className="font-medium">
                        {new Date(
                          gpuSystemStatus.details.system.boot_time,
                        ).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground text-sm">
                        Uptime:
                      </span>
                      <p className="font-medium">
                        {formatUptime(
                          gpuSystemStatus.details.system.uptime_days,
                        )}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Card>
                <CardContent className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <AlertCircle className="text-muted-foreground mx-auto h-12 w-12" />
                    <h3 className="mt-4 text-lg font-semibold">
                      No System Data Available
                    </h3>
                    <p className="text-muted-foreground">
                      Unable to fetch GPU server system information. The server
                      may be offline or experiencing timeout.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Node Server Tab */}
        <TabsContent value="node-server" className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              <h2 className="text-2xl font-bold">Node Server Information</h2>
            </div>

            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <div className="text-center">
                  <Server className="text-muted-foreground mx-auto h-12 w-12" />
                  <h3 className="mt-4 text-lg font-semibold">
                    Node Server Monitoring
                  </h3>
                  <p className="text-muted-foreground">
                    Node server monitoring features are coming soon. This will
                    include local server metrics, Node.js process information,
                    and application health status.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
