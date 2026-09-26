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
    resolution: 64,
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
