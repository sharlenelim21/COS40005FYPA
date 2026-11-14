"use client";

import { Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ReconstructionChamber, ReconstructionSegmentationModel } from "@/components/reconstruction/ReconstructionConfigDialog";

export const TARGET_MODELS: ReconstructionSegmentationModel[] = ["medsam", "unet"];
export const TARGET_CHAMBERS: ReconstructionChamber[] = ["lv", "rv"];

export const MODEL_LABELS: Record<ReconstructionSegmentationModel, string> = { medsam: "MedSAM", unet: "UNet" };
export const CHAMBER_LABELS: Record<ReconstructionChamber, string> = { lv: "LV myocardium", rv: "RV cavity (research)" };

export type TargetKey = `${ReconstructionSegmentationModel}:${ReconstructionChamber}`;
export const targetKey = (model: ReconstructionSegmentationModel, chamber: ReconstructionChamber): TargetKey => `${model}:${chamber}`;

export type CellState =
  | { kind: "available" }
  | { kind: "no-masks" }
  | { kind: "gpu-required" }
  | { kind: "built" }
  | { kind: "building" };

interface ReconstructionTargetGridProps {
  cellState: (model: ReconstructionSegmentationModel, chamber: ReconstructionChamber) => CellState;
  selected: ReadonlySet<TargetKey>;
  onToggle: (key: TargetKey, checked: boolean) => void;
  onView?: (model: ReconstructionSegmentationModel, chamber: ReconstructionChamber) => void;
  disabled?: boolean;
}

function UnavailableReason({
  state,
  onView,
}: {
  state: CellState;
  onView?: () => void;
}) {
  switch (state.kind) {
    case "no-masks":
      return <span className="text-muted-foreground text-xs">No masks — run segmentation</span>;
    case "gpu-required":
      return <span className="text-muted-foreground text-xs">GPU required</span>;
    case "building":
      return (
        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Building…
        </span>
      );
    case "built":
      return (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-muted-foreground">Built</span>
          {onView && (
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={onView}>
              <Eye className="h-3 w-3" aria-hidden="true" />
              View 4D
            </Button>
          )}
        </span>
      );
    default:
      return null;
  }
}

export function ReconstructionTargetGrid({ cellState, selected, onToggle, onView, disabled = false }: ReconstructionTargetGridProps) {
  return (
    <div role="group" aria-label="Reconstructions to build" className="overflow-hidden rounded-lg border">
      <div className="bg-muted/40 grid grid-cols-[5.5rem_repeat(2,minmax(0,1fr))] border-b text-xs font-medium">
        <span className="px-3 py-2" />
        {TARGET_CHAMBERS.map((chamber) => (
          <span key={chamber} className="border-l px-3 py-2">
            {CHAMBER_LABELS[chamber]}
          </span>
        ))}
      </div>
      {TARGET_MODELS.map((model) => (
        <div key={model} className="grid grid-cols-[5.5rem_repeat(2,minmax(0,1fr))] border-b last:border-b-0">
          <span className="flex items-center px-3 py-3 text-sm font-medium">{MODEL_LABELS[model]}</span>
          {TARGET_CHAMBERS.map((chamber) => {
            const key = targetKey(model, chamber);
            const state = cellState(model, chamber);
            const id = `recon-target-${model}-${chamber}`;
            const isSelected = selected.has(key);
            return (
              <div
                key={chamber}
                className={cn(
                  "flex min-w-0 items-center border-l px-3 py-3",
                  isSelected && (chamber === "rv" ? "bg-amber-500/10" : "bg-primary/5"),
                )}
              >
                {state.kind === "available" ? (
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={isSelected}
                      disabled={disabled}
                      onCheckedChange={(value) => onToggle(key, value === true)}
                    />
                    <Label htmlFor={id} className="cursor-pointer text-sm font-normal">
                      Build
                      <span className="sr-only">
                        {" "}
                        {MODEL_LABELS[model]} {CHAMBER_LABELS[chamber]}
                      </span>
                    </Label>
                  </div>
                ) : (
                  <UnavailableReason state={state} onView={onView ? () => onView(model, chamber) : undefined} />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
