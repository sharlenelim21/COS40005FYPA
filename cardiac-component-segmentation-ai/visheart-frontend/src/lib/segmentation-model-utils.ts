import type { BaseSegmentationMask } from "@/types/project";

export type SegmentationModelId = "medsam" | "unet";

export const SEGMENTATION_MODEL_OPTIONS: { value: SegmentationModelId; label: string }[] = [
  { value: "medsam", label: "MedSam" },
  { value: "unet", label: "Unet" },
];

export function inferDocModel(m: unknown): SegmentationModelId | null {
  const raw = m as {
    segmentationModel?: string;
    model_used?: string;
    name?: string;
  };
  const tag = (raw.segmentationModel || raw.model_used || "").toString().toLowerCase();
  if (tag === "medsam" || tag === "unet") return tag;
  const name = (raw.name || "").toString().toLowerCase();
  if (name.includes("unet")) return "unet";
  if (name.includes("medsam")) return "medsam";
  if (name.startsWith("ai output")) return "medsam";
  if (name.startsWith("manual edit -") || name === "manual edit") return "medsam";
  return null;
}

export function getModelMaskAvailability(
  masks: BaseSegmentationMask[] | null | undefined
): Record<SegmentationModelId, boolean> {
  const availability: Record<SegmentationModelId, boolean> = { medsam: false, unet: false };
  if (!masks || masks.length === 0) return availability;

  const anyDocResolves = masks.some((m) => inferDocModel(m) !== null);

  for (const opt of SEGMENTATION_MODEL_OPTIONS) {
    if (masks.some((m) => inferDocModel(m) === opt.value)) {
      availability[opt.value] = true;
    }
  }

  if (!anyDocResolves) {
    availability.medsam = true;
  }

  return availability;
}
