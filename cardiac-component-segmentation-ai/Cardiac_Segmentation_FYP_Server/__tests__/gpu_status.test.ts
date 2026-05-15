import { resolveGpuAvailability } from "../src/routes/gpu_status";

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
});