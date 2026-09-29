/**
 * Whether the inference service can use a GPU, from its /status/gpu reply. Kept free of imports, so it can be
 * tested without the route, which opens Redis and the database when it is loaded.
 *
 * A container that says it is CPU (backend "cpu") stays CPU even when it reports a card: the CPU image can see the
 * host's GPU. Telemetry alone (a card name, no backend) counts only for images that do not report a backend.
 */
export function resolveGpuAvailability(data: any): { gpuAvailable: boolean; mode: string } {
  const backend = typeof data?.backend === "string" ? data.backend.toLowerCase() : "";
  const nestedBackend =
    typeof data?.gpu?.backend === "string" ? data.gpu.backend.toLowerCase() : "";
  const status = typeof data?.status === "string" ? data.status.toLowerCase() : "";
  const gpuStatus =
    typeof data?.gpu?.status === "string" ? data.gpu.status.toLowerCase() : "";
  const hasGpuTelemetry =
    typeof data?.gpu?.gpu_name === "string" && data.gpu.gpu_name.trim().length > 0;
  const saysCpu = backend === "cpu" || nestedBackend === "cpu";
  const mode = data?.mode || backend || nestedBackend || "unknown";
  const gpuAvailable =
    Boolean(data?.gpuAvailable) ||
    (status === "ok" && (backend === "cuda" || nestedBackend === "cuda")) ||
    (status === "ok" && hasGpuTelemetry && !saysCpu) ||
    ((backend === "cuda" || nestedBackend === "cuda") &&
      (gpuStatus === "ok" || gpuStatus === "busy"));

  return {
    gpuAvailable,
    mode: gpuAvailable ? "gpu" : mode === "unknown" ? "cpu" : mode,
  };
}
