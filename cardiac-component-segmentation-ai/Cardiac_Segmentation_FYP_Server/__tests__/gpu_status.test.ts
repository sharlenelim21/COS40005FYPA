// The rule lives in a module with no side effects: importing the route would open Redis.
import { resolveGpuAvailability } from "../src/services/gpu_availability";

describe("resolveGpuAvailability", () => {
  it("keeps CPU containers on cpu mode and unavailable", () => {
    expect(
      resolveGpuAvailability({
        backend: "cpu",
        status: "ok",
        gpu: {
          backend: "cpu",
          status: "ok",
          gpu_name: "NVIDIA GeForce RTX 4090",
        },
      })
    ).toEqual({
      gpuAvailable: false,
      mode: "cpu",
    });
  });

  it("marks CUDA containers as GPU mode", () => {
    expect(
      resolveGpuAvailability({
        backend: "cuda",
        status: "ok",
        gpu: {
          backend: "cuda",
          status: "ok",
          gpu_name: "NVIDIA GeForce RTX 4090",
        },
      })
    ).toEqual({
      gpuAvailable: true,
      mode: "gpu",
    });
  });

  it("trusts GPU telemetry only when the container does not say it is CPU", () => {
    // An older GPU image reports its card but no backend field.
    expect(resolveGpuAvailability({ status: "ok", gpu: { gpu_name: "NVIDIA GeForce RTX 2060 SUPER" } }))
      .toEqual({ gpuAvailable: true, mode: "gpu" });
    // A busy CUDA card is still available.
    expect(resolveGpuAvailability({ status: "ok", backend: "cuda", gpu: { backend: "cuda", status: "busy" } }))
      .toEqual({ gpuAvailable: true, mode: "gpu" });
    // Nothing at all: CPU.
    expect(resolveGpuAvailability({})).toEqual({ gpuAvailable: false, mode: "cpu" });
  });
});
