"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Settings, Sparkles, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export type ReconstructionSegmentationModel = "medsam" | "unet";

export interface ReconstructionConfig {
  exportFormat: "obj" | "glb";
  edFrame: number; // 1-based frame index for user selection
  numIterations: number;
  resolution: number;
  // Which segmentation result this reconstruction should consume.
  segmentationModel: ReconstructionSegmentationModel;
}

interface ReconstructionConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (config: ReconstructionConfig) => void;
  isLoading?: boolean;
  totalFrames?: number; // Total number of frames in the project
  /**
   * Models that have a usable cached editable/manual segmentation
   * for this project. Anything not in the set is rendered disabled
   * with an explanatory tooltip. If the set is empty, Start is
   * disabled and a banner tells the user to run segmentation first.
   */
  availableModels?: ReconstructionSegmentationModel[];
  /**
   * Models whose 4D reconstruction slot is already occupied by an
   * existing result. These remain visible but cannot be selected again
   * until the existing result is deleted.
   */
  blockedModels?: ReconstructionSegmentationModel[];
  /**
   * Initial selection. Caller should pass the segmentation toggle's
   * current model (so the dialog defaults to whatever the user is
   * currently viewing). Falls back to the first available model if
   * the requested default is unavailable.
   */
  defaultSelectedModel?: ReconstructionSegmentationModel;
  /**
   * Whether a GPU is available in the current environment.
   * When false, MedSAM cards show "GPU required" instead of
   * "Run MedSAM segmentation first", so CPU users are not misled.
   */
  gpuAvailable?: boolean;
}

const MODEL_META: Record<ReconstructionSegmentationModel, { label: string; description: string }> = {
  medsam: {
    label: "MedSAM",
    description: "GPU-accelerated bounding-box segmentation",
  },
  unet: {
    label: "UNet",
    description: "End-to-end neural segmentation, runs on CPU or GPU",
  },
};

=======
  /**
   * Models that have a usable cached editable/manual segmentation
   * for this project. Anything not in the set is rendered disabled
   * with an explanatory tooltip. If the set is empty, Start is
   * disabled and a banner tells the user to run segmentation first.
   */
  availableModels?: ReconstructionSegmentationModel[];
  /**
   * Models whose 4D reconstruction slot is already occupied by an
   * existing result. These remain visible but cannot be selected again
   * until the existing result is deleted.
   */
  blockedModels?: ReconstructionSegmentationModel[];
  /**
   * Initial selection. Caller should pass the segmentation toggle's
   * current model (so the dialog defaults to whatever the user is
   * currently viewing). Falls back to the first available model if
   * the requested default is unavailable.
   */
  defaultSelectedModel?: ReconstructionSegmentationModel;
}

const MODEL_META: Record<ReconstructionSegmentationModel, { label: string; description: string }> = {
  medsam: {
    label: "MedSAM",
    description: "GPU-accelerated bounding-box segmentation",
  },
  unet: {
    label: "UNet",
    description: "End-to-end neural segmentation, runs on CPU or GPU",
  },
};

>>>>>>> backup-finalsprint3
export function ReconstructionConfigDialog({
  open,
  onOpenChange,
  onStart,
  isLoading = false,
  totalFrames = 1,
  availableModels,
  blockedModels,
  defaultSelectedModel,
  gpuAvailable = true,
}: ReconstructionConfigDialogProps) {
  const [exportFormat, setExportFormat] = useState<"obj" | "glb">("glb");
  const [edFrame, setEdFrame] = useState(1);
  const [numIterations, setNumIterations] = useState(30);
  const [resolution, setResolution] = useState(32);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Derive a stable Set for membership checks.
  const availableSet = useMemo(
    () => new Set<ReconstructionSegmentationModel>(availableModels ?? []),
    [availableModels]
  );
  const blockedSet = useMemo(
    () => new Set<ReconstructionSegmentationModel>(blockedModels ?? []),
    [blockedModels]
  );

  // Choose an initial model: prefer the caller's default if available,
  // otherwise fall back to whichever model is available, otherwise the
  // canonical MedSAM (the dialog will still show the empty-state banner
  // and Start will be disabled).
  const initialModel: ReconstructionSegmentationModel = useMemo(() => {
    if (defaultSelectedModel && availableSet.has(defaultSelectedModel) && !blockedSet.has(defaultSelectedModel)) {
      return defaultSelectedModel;
    }
    if (availableSet.has("medsam") && !blockedSet.has("medsam")) return "medsam";
    if (availableSet.has("unet") && !blockedSet.has("unet")) return "unet";
    return defaultSelectedModel ?? "medsam";
  }, [availableSet, blockedSet, defaultSelectedModel]);

  const [selectedModel, setSelectedModel] =
    useState<ReconstructionSegmentationModel>(initialModel);

  // Re-sync the model selection whenever the dialog re-opens or the
  // available set changes (e.g. user just finished a UNet run while
  // the dialog was closed).
  useEffect(() => {
    if (!open) return;
    setSelectedModel(initialModel);
  }, [open, initialModel]);

  const noModelsAvailable = availableSet.size === 0;
  const noCreatableModels = (["medsam", "unet"] as ReconstructionSegmentationModel[]).every(
    (model) => !availableSet.has(model) || blockedSet.has(model),
  );
  const startDisabled =
    isLoading || noModelsAvailable || noCreatableModels || !availableSet.has(selectedModel) || blockedSet.has(selectedModel);

  const handleStart = () => {
    if (startDisabled) return;
    onStart({
      exportFormat,
      edFrame,
      numIterations,
      resolution,
      segmentationModel: selectedModel,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Configure 4D Reconstruction
          </DialogTitle>
          <DialogDescription>
            Configure the parameters for generating your 4D cardiac reconstruction
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Segmentation source (model) — choose which cached segmentation
              the reconstruction will consume. Disabled cards represent
              models with no editable mask available for this project. */}
          <div className="space-y-2">
            <Label>Segmentation source</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["medsam", "unet"] as ReconstructionSegmentationModel[]).map((m) => {
                const hasSegmentation = availableSet.has(m);
                const isBlocked = blockedSet.has(m);
                const isAvailable = hasSegmentation && !isBlocked;
                const isSelected = selectedModel === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => isAvailable && setSelectedModel(m)}
                    disabled={!isAvailable || isLoading}
                    aria-pressed={isSelected}
                    title={
                      isBlocked
                        ? `A 4D reconstruction already exists for ${MODEL_META[m].label}. Delete the existing result before creating a new one.`
                        : isAvailable
                        ? `Use cached ${MODEL_META[m].label} segmentation as input`
                        : (!gpuAvailable && m === "medsam")
                        ? "MedSAM requires an NVIDIA GPU. Only UNet is available in CPU mode."
                        : `No cached segmentation found for ${MODEL_META[m].label}. Run ${MODEL_META[m].label} segmentation first.`
                    }
                    className={cn(
                      "rounded-lg border px-3 py-3 text-left transition-colors",
                      isAvailable
                        ? "hover:bg-muted/40"
                        : "opacity-50 cursor-not-allowed",
                      isSelected && isAvailable
                        ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                        : "border-border"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{MODEL_META[m].label}</span>
                      {isBlocked && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          In Use
                        </span>
                      )}
                      {!hasSegmentation && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Unavailable
                        </span>
                      )}
                      {isAvailable && isSelected && (
                        <span className="text-[10px] uppercase tracking-wide text-primary">
                          Selected
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {MODEL_META[m].description}
                    </div>
                    {isBlocked && (
                      <div className="text-[11px] text-muted-foreground mt-1.5">
                        Delete existing 4D result first
                      </div>
                    )}
                    {!hasSegmentation && (
                      <div className="text-[11px] text-muted-foreground mt-1.5">
                        {!gpuAvailable && m === "medsam"
                          ? "GPU required"
                          : "No cached segmentation"}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            {noModelsAvailable ? (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-amber-900 dark:text-amber-100">
                  <p className="font-medium">No segmentation result available</p>
                  <p className="mt-1">
                    Run MedSAM or UNet segmentation on this project first, then
                    return here to start a reconstruction.
                  </p>
                </div>
              </div>
            ) : noCreatableModels ? (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-amber-900 dark:text-amber-100">
                  <p className="font-medium">All 4D reconstruction slots are in use</p>
                  <p className="mt-1">
                    A 4D reconstruction already exists for this model. Delete the existing result before creating a new one.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Reconstruction will only use the editable mask for the selected
                model. The other model&apos;s data is ignored.
              </p>
            )}
          </div>

          {/* Export Format Selection */}
          <div className="space-y-2">
            <Label htmlFor="format">Export Format</Label>
            <Select
              value={exportFormat}
              onValueChange={(value: string) => setExportFormat(value as "obj" | "glb")}
            >
              <SelectTrigger id="format">
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="glb">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">GLB (Recommended)</span>
                    <span className="text-xs text-muted-foreground">
                      Binary glTF 2.0 - Optimized for web, smaller file size
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="obj">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">OBJ (Wavefront)</span>
                    <span className="text-xs text-muted-foreground">
                      Plain text format - Widely supported, human-readable
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              GLB format provides better performance and smaller file sizes for web viewing
            </p>
          </div>

          {/* ED Frame Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="edFrame">End-Diastole (ED) Frame</Label>
              <span className="text-sm font-mono text-muted-foreground">
                Frame {edFrame}
              </span>
            </div>
            <Input
              id="edFrame"
              type="number"
              min={1}
              max={totalFrames}
              step={1}
              value={edFrame}
              onChange={(e) => setEdFrame(Math.max(1, Math.min(totalFrames, parseInt(e.target.value) || 1)))}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Select the cardiac end-diastole frame for 4D reconstruction (1-{totalFrames}).
              This frame represents the relaxed state of the cardiac cycle.
            </p>
          </div>

          {/* Advanced Settings */}
          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between px-0">
                <span className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Advanced Settings
                </span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              {/* SDF Optimizer Iterations */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="iterations">SDF Optimizer Iterations</Label>
                  <span className="text-sm font-mono text-muted-foreground">
                    {numIterations}
                  </span>
                </div>
                <Input
                  id="iterations"
                  type="number"
                  min={10}
                  max={200}
                  step={10}
                  value={numIterations}
                  onChange={(e) => setNumIterations(parseInt(e.target.value) || 30)}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Number of optimization iterations for latent code fitting (10-200).
                  Higher values improve accuracy but increase processing time. Default: 30
                </p>
              </div>

              {/* Marching Cubes Resolution */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="resolution">Marching Cubes Resolution</Label>
                  <span className="text-sm font-mono text-muted-foreground">
                    {resolution}
                  </span>
                </div>
                <Input
                  id="resolution"
                  type="number"
                  min={32}
                  max={256}
                  step={32}
                  value={resolution}
                  onChange={(e) => setResolution(parseInt(e.target.value) || 32)}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Mesh generation resolution (32-256). Higher values create more detailed
                  meshes but increase processing time and file size. Default: 32
                </p>
              </div>

              {/* Warning for high values */}
              {(numIterations > 100 || resolution > 128) && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <Settings className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-amber-900 dark:text-amber-100">
                    <p className="font-medium">High performance settings detected</p>
                    <p className="mt-1">
                      These settings will significantly increase processing time and may
                      require more GPU memory. Use with caution.
                    </p>
                  </div>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleStart}
            disabled={startDisabled}
            title={
              noModelsAvailable
                ? "No segmentation result available — run MedSAM or UNet first"
                : blockedSet.has(selectedModel)
                ? `A 4D reconstruction already exists for ${MODEL_META[selectedModel].label}. Delete it before creating a new one.`
                : noCreatableModels
                ? "All 4D reconstruction slots are already in use"
                : !availableSet.has(selectedModel)
                ? `No cached ${MODEL_META[selectedModel].label} segmentation. Pick an available model.`
                : undefined
            }
          >
            {isLoading
              ? "Starting..."
              : `Start Reconstruction${
                  availableSet.has(selectedModel)
                    ? ` (${MODEL_META[selectedModel].label})`
                    : ""
                }`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
