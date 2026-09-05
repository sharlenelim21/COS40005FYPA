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
import { ChevronDown, Settings, Sparkles, AlertTriangle, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

// Latent-fit iterations, per processing unit. The fit is measurably under-converged at the old
// default of 30: LV myocardial volume swings 23.7% between ED and ES against a 6.8% floor set by
// the masks themselves, and myocardium is near-incompressible. Measured on ACDC (6 cases, paired):
//
//        iterations   30      120     200
//        LV myo swing 23.7%   15.6%   9.3%     (floor 6.8%)
//        mean abs err 30.1%   20.7%   18.3%
//
// GPU takes the best value. CPU cannot: at 200 iterations plus an N=64 decode a 30-frame job is
// ~20.8s/frame on CPU (~10.4 min), which runs past the viewer's 10-minute poll budget -- the job
// still finishes, but nothing is watching for it any more. 120 keeps a 30-frame CPU job at
// ~7.2 min, inside the budget, and still recovers most of the accuracy.
const ITERATIONS_GPU = 200;
const ITERATIONS_CPU = 120;

export type ReconstructionSegmentationModel = "medsam" | "unet";

export type ReconstructionChamber = "lv" | "rv";

export interface ReconstructionConfig {
  exportFormat: "obj" | "glb";
  edFrame: number; // 1-based frame index for user selection
  numIterations: number;
  resolution: number;
  // Which segmentation result this reconstruction should consume.
  segmentationModel: ReconstructionSegmentationModel;
  // Which chamber to reconstruct. "lv" is the clinical product; "rv" is research/reference only.
  chamber: ReconstructionChamber;
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
  existingReconstructionsByModel?: Partial<Record<ReconstructionSegmentationModel, string>>;
  onViewReconstruction?: (model: ReconstructionSegmentationModel, reconstructionId?: string) => void;
  /**
   * Models that already have an RV reconstruction. Tracked separately from `blockedModels`
   * (which is LV) because the two chambers occupy independent slots.
   */
  blockedRvModels?: ReconstructionSegmentationModel[];
  /**
   * Chamber to open on. Omitted means LV — RV should stay a deliberate choice. Set only when the
   * caller already knows the user asked for that chamber (e.g. the viewer's "Build RV" button).
   */
  defaultChamber?: ReconstructionChamber;
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
  existingReconstructionsByModel,
  onViewReconstruction,
  blockedRvModels,
  defaultChamber,
}: ReconstructionConfigDialogProps) {
  // LV unless the caller explicitly asked otherwise. RV stays a deliberate choice.
  const [chamber, setChamber] = useState<ReconstructionChamber>(defaultChamber ?? "lv");
  const [exportFormat, setExportFormat] = useState<"obj" | "glb">("glb");
  const [edFrame, setEdFrame] = useState(1);
  const [numIterations, setNumIterations] = useState(gpuAvailable ? ITERATIONS_GPU : ITERATIONS_CPU);
  // 32 was the old default and is too coarse: at N=32 the marching-cubes facets are ~17x larger
  // by area than at N=128, which flat-shades into what looks like holes in a closed surface.
  // 64 costs ~0.3s more per frame to decode and gives ~4x the vertices. Raise it further (96-128)
  // for figures or anything measured off the surface.
  const [resolution, setResolution] = useState(64);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Derive a stable Set for membership checks.
  const availableSet = useMemo(
    () => new Set<ReconstructionSegmentationModel>(availableModels ?? []),
    [availableModels]
  );
  // Occupancy is per chamber: an existing LV reconstruction must not block creating the RV one,
  // and vice versa.
  const blockedSet = useMemo(
    () => new Set<ReconstructionSegmentationModel>(
      (chamber === "rv" ? blockedRvModels : blockedModels) ?? []
    ),
    [blockedModels, blockedRvModels, chamber]
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

  // Reopening resets to the caller's chamber, defaulting to LV, so an RV run is never repeated
  // by accident just because the dialog was left on RV last time.
  useEffect(() => {
    if (!open) return;
    setChamber(defaultChamber ?? "lv");
  }, [open, defaultChamber]);

  // Re-applies the iteration default for whichever processing unit is currently reported, on open
  // and whenever that report changes. The status poll starts at gpuAvailable=false and flips to
  // true once it answers, so this has to react to the change or a GPU system would keep the CPU
  // default. The cost is that a status change while the dialog is open resets a hand-typed value;
  // that window is small, and being wrong about the device is the worse failure.
  useEffect(() => {
    if (!open) return;
    setNumIterations(gpuAvailable ? ITERATIONS_GPU : ITERATIONS_CPU);
  }, [open, gpuAvailable]);

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
      chamber,
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
                  <div
                    key={m}
                    role="button"
                    tabIndex={isAvailable && !isLoading ? 0 : -1}
                    onClick={() => isAvailable && setSelectedModel(m)}
                    onKeyDown={(event) => {
                      if (!isAvailable || isLoading) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedModel(m);
                      }
                    }}
                    aria-pressed={isSelected}
                    aria-disabled={!isAvailable || isLoading}
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
                        : isBlocked
                        ? "bg-primary/5"
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
                      <div className="mt-2 flex items-end justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          Delete existing 4D result first
                        </span>
                        {onViewReconstruction && (
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 gap-1 border border-primary/40 bg-primary px-2 text-[11px] font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
                            onClick={(event) => {
                              event.stopPropagation();
                              onViewReconstruction(m, existingReconstructionsByModel?.[m]);
                            }}
                          >
                            <Eye className="h-3 w-3" />
                            View 4D
                          </Button>
                        )}
                      </div>
                    )}
                    {!hasSegmentation && (
                      <div className="text-[11px] text-muted-foreground mt-1.5">
                        {!gpuAvailable && m === "medsam"
                          ? "GPU required"
                          : "No cached segmentation"}
                      </div>
                    )}
                  </div>
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

          {/* Chamber selection. LV is the clinical product and the default; RV is a separate,
              research-only reconstruction of the same scan. Choosing RV surfaces the accuracy
              warning here, before the job is submitted, as well as later in the viewer. */}
          <div className="space-y-2">
            <Label>Chamber</Label>
            <div className="grid grid-cols-2 gap-2">
              {([
                {
                  value: "lv" as ReconstructionChamber,
                  title: "LV myocardium",
                  blurb: "Standard 4D reconstruction",
                },
                {
                  value: "rv" as ReconstructionChamber,
                  title: "RV cavity",
                  blurb: "Research / reference only",
                },
              ]).map((option) => {
                const isSelected = chamber === option.value;
                return (
                  <div
                    key={option.value}
                    role="button"
                    tabIndex={isLoading ? -1 : 0}
                    onClick={() => !isLoading && setChamber(option.value)}
                    onKeyDown={(event) => {
                      if (isLoading) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setChamber(option.value);
                      }
                    }}
                    className={cn(
                      "rounded-lg border p-3 transition-colors",
                      isLoading ? "cursor-not-allowed opacity-60" : "cursor-pointer",
                      isSelected
                        ? option.value === "rv"
                          ? "border-amber-500 bg-amber-500/10"
                          : "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50",
                    )}
                  >
                    <p className="text-sm font-medium flex items-center gap-1.5">
                      {option.value === "rv" && <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                      {option.title}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{option.blurb}</p>
                  </div>
                );
              })}
            </div>
            {chamber === "rv" && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-1">
                <p className="font-semibold flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  RV reconstruction is not validated for clinical use
                </p>
                <p className="text-muted-foreground">
                  The RV shape model has not passed accuracy validation. Its output is for
                  research and reference only and must not be used for clinical diagnosis or
                  measurement. It is created as a separate reconstruction and does not replace
                  the LV result.
                </p>
                <p className="text-muted-foreground">
                  Requires an RV checkpoint configured on the inference service; without one the
                  request is rejected rather than answered with an LV mesh.
                </p>
              </div>
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
                  onChange={(e) =>
                    setNumIterations(parseInt(e.target.value) || (gpuAvailable ? ITERATIONS_GPU : ITERATIONS_CPU))
                  }
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Number of optimization iterations for latent code fitting (10-200).
                  Below ~120 the fit is measurably under-converged and chamber volumes are off by
                  around 30%. Measured cost per iteration per frame: ~0.014s on GPU, ~0.081s on
                  CPU. Default on this system: {gpuAvailable ? ITERATIONS_GPU : ITERATIONS_CPU}
                  ({gpuAvailable ? "GPU" : "CPU"}).
                  {!gpuAvailable && (
                    <>
                      {" "}
                      Raising this on CPU can push a 30-frame job past 10 minutes, after which the
                      viewer stops watching for it -- the job still finishes, but you will need to
                      reload to see it.
                    </>
                  )}
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
              {resolution > 128 && (
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
