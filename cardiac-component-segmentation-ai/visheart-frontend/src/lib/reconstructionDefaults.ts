import type {
  ReconstructionChamber,
  ReconstructionConfig,
  ReconstructionSegmentationModel,
} from "@/components/reconstruction/ReconstructionConfigDialog";

export const ITERATIONS_GPU = 200;
export const ITERATIONS_CPU = 120;

export function defaultReconstructionConfig(
  segmentationModel: ReconstructionSegmentationModel,
  chamber: ReconstructionChamber,
  gpuAvailable: boolean,
): ReconstructionConfig {
  return {
    exportFormat: "glb",
    edFrame: 1,
    numIterations: gpuAvailable ? ITERATIONS_GPU : ITERATIONS_CPU,
    // 128 (raised from 64, 2026-10-01): at 64, a segment with a healthy, correctly-computed
    // vertex share can still render as a thin, easily-occluded sliver on a crescent-shaped RV
    // cross-section -- confirmed directly on a real patient. Stays user-adjustable (opt-in,
    // see ReconstructionConfigDialog's advanced panel), this only raises the starting point.
    resolution: 128,
    segmentationModel,
    chamber,
  };
}

export function buildReconstructionRequest(config: ReconstructionConfig, projectName: string) {
  const modelTag = config.segmentationModel.toUpperCase();
  const chamber = config.chamber ?? "lv";
  return {
    reconstructionName: chamber === "rv"
      ? `RV Reconstruction — RESEARCH ONLY (${modelTag}) - ${projectName}`
      : `4D Cardiac Reconstruction (${modelTag}) - ${projectName}`,
    reconstructionDescription: chamber === "rv"
      ? `RV cavity, research/reference only — not for clinical diagnosis. Generated from ${modelTag} segmentation`
      : `Generated via configuration wizard from ${modelTag} segmentation`,
    ed_frame: config.edFrame,
    export_format: config.exportFormat,
    segmentationModel: config.segmentationModel,
    chamber,
    parameters: {
      num_iterations: config.numIterations,
      resolution: config.resolution,
      process_all_frames: true,
    },
  };
}
