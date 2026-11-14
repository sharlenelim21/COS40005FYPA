"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Eye, Loader2, Sparkles } from "lucide-react";
import {
  CHAMBER_LABELS,
  MODEL_LABELS,
  ReconstructionTargetGrid,
  TARGET_CHAMBERS,
  TARGET_MODELS,
  targetKey,
  type CellState,
  type TargetKey,
} from "@/components/reconstruction/ReconstructionTargetGrid";
import { ReconstructionAdvancedSettings, type AdvancedValues } from "@/components/reconstruction/ReconstructionAdvancedSettings";

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
const SECONDS_PER_ITERATION_FRAME = { gpu: 0.014, cpu: 0.081 };

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

export interface ReconstructionBatchConfig extends AdvancedValues {
  targets: { segmentationModel: ReconstructionSegmentationModel; chamber: ReconstructionChamber }[];
}

interface ReconstructionConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (config: ReconstructionBatchConfig) => void;
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
  onViewReconstruction?: (model: ReconstructionSegmentationModel, reconstructionId?: string, chamber?: ReconstructionChamber) => void;
  /**
   * Models that already have an RV reconstruction. Tracked separately from `blockedModels`
   * (which is LV) because the two chambers occupy independent slots.
   */
  blockedRvModels?: ReconstructionSegmentationModel[];
  /**
   * Models whose reconstruction for this chamber is being built RIGHT NOW. Distinct from
   * `blockedModels`/`blockedRvModels`, which mean "a result already exists": that state is
   * resolved by deleting the old result, this one is resolved by waiting. Saying "already exists"
   * to someone whose job is 30 seconds old sends them to delete something that is not there.
   */
  buildingModels?: ReconstructionSegmentationModel[];
  buildingRvModels?: ReconstructionSegmentationModel[];
  /**
   * Chamber to open on. Omitted means LV — RV should stay a deliberate choice. Set only when the
   * caller already knows the user asked for that chamber (e.g. the viewer's "Build RV" button).
   */
  defaultChamber?: ReconstructionChamber;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

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
  buildingModels,
  buildingRvModels,
  defaultChamber,
}: ReconstructionConfigDialogProps) {
  const defaultIterations = gpuAvailable ? ITERATIONS_GPU : ITERATIONS_CPU;
  // 32 was the original default and is too coarse: at N=32 the marching-cubes facets are ~17x
  // larger by area than at N=128, which flat-shades into what looks like holes in a closed
  // surface. 64 (the default from 2026-09 onward) still under-renders a small RV segment as a
  // thin, easily-occluded sliver on a crescent-shaped cross-section -- confirmed directly
  // (2026-10-01): a segment with a healthy, correctly-computed vertex share (7.4% of the mesh)
  // was barely visible at N=64 but clearly visible at the notebook's own N=128 equivalent on the
  // same patient. 128 is now the default; this stays opt-in/advanced (not forced), so a user who
  // wants the old fast-but-coarse behavior can still dial it back down.
  const [advanced, setAdvanced] = useState<AdvancedValues>({
    exportFormat: "glb",
    edFrame: 1,
    numIterations: defaultIterations,
    resolution: 128,
  });
  const [selected, setSelected] = useState<Set<TargetKey>>(() => new Set());

  const availableSet = useMemo(() => new Set(availableModels ?? []), [availableModels]);
  const blocked = useMemo(
    () => ({ lv: new Set(blockedModels ?? []), rv: new Set(blockedRvModels ?? []) }),
    [blockedModels, blockedRvModels],
  );
  const building = useMemo(
    () => ({ lv: new Set(buildingModels ?? []), rv: new Set(buildingRvModels ?? []) }),
    [buildingModels, buildingRvModels],
  );

  const cellState = useCallback(
    (model: ReconstructionSegmentationModel, chamber: ReconstructionChamber): CellState => {
      if (blocked[chamber].has(model)) return { kind: "built" };
      if (building[chamber].has(model)) return { kind: "building" };
      if (!availableSet.has(model)) return !gpuAvailable && model === "medsam" ? { kind: "gpu-required" } : { kind: "no-masks" };
      return { kind: "available" };
    },
    [availableSet, blocked, building, gpuAvailable],
  );

  const buildableKeys = useMemo(
    () =>
      TARGET_MODELS.flatMap((model) =>
        TARGET_CHAMBERS.filter((chamber) => cellState(model, chamber).kind === "available").map((chamber) => targetKey(model, chamber)),
      ),
    [cellState],
  );

  // Re-applies the iteration default for whichever processing unit is currently reported, on open
  // and whenever that report changes. The status poll starts at gpuAvailable=false and flips to
  // true once it answers, so this has to react to the change or a GPU system would keep the CPU
  // default. The cost is that a status change while the dialog is open resets a hand-typed value;
  // that window is small, and being wrong about the device is the worse failure.
  useEffect(() => {
    if (!open) return;
    setAdvanced((prev) => ({ ...prev, numIterations: defaultIterations }));
  }, [open, defaultIterations]);

  // Reopening resets to the caller's chamber, defaulting to LV, so an RV run is never repeated
  // by accident just because the dialog was left on RV last time.
  const wasOpen = useRef(false);
  useEffect(() => {
    const justOpened = open && !wasOpen.current;
    wasOpen.current = open;
    if (!justOpened) return;
    const chamber = defaultChamber ?? "lv";
    const preferredModels = [defaultSelectedModel, ...TARGET_MODELS].filter(Boolean) as ReconstructionSegmentationModel[];
    const first = preferredModels.map((model) => targetKey(model, chamber)).find((key) => buildableKeys.includes(key));
    setSelected(new Set(first ? [first] : []));
  }, [open, defaultChamber, defaultSelectedModel, buildableKeys]);

  const toggle = (key: TargetKey, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const selectedTargets = [...selected]
    .filter((key) => buildableKeys.includes(key))
    .map((key) => {
      const [segmentationModel, chamber] = key.split(":") as [ReconstructionSegmentationModel, ReconstructionChamber];
      return { segmentationModel, chamber };
    });
  const lvCount = selectedTargets.filter((target) => target.chamber === "lv").length;
  const rvCount = selectedTargets.length - lvCount;
  const anyRvSelected = rvCount > 0;
  const minutes = Math.max(
    1,
    Math.round(
      (selectedTargets.length * totalFrames * advanced.numIterations * SECONDS_PER_ITERATION_FRAME[gpuAvailable ? "gpu" : "cpu"]) / 60,
    ),
  );

  const noModelsAvailable = availableSet.size === 0;
  const nothingToBuild = !noModelsAvailable && buildableKeys.length === 0;
  const startDisabledReason = isLoading
    ? null
    : noModelsAvailable
      ? "Run MedSAM or UNet segmentation first."
      : selectedTargets.length === 0
        ? "Select at least one reconstruction."
        : null;

  const handleStart = () => {
    if (isLoading || selectedTargets.length === 0) return;
    onStart({ ...advanced, targets: selectedTargets });
  };

  const viewTarget = (model: ReconstructionSegmentationModel, chamber: ReconstructionChamber) =>
    onViewReconstruction?.(model, chamber === "lv" ? existingReconstructionsByModel?.[model] : undefined, chamber);

  const builtOrBuilding = TARGET_MODELS.flatMap((model) =>
    TARGET_CHAMBERS.map((chamber) => ({ model, chamber, state: cellState(model, chamber) })).filter(
      (item) => item.state.kind === "built" || item.state.kind === "building",
    ),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {nothingToBuild ? "All reconstructions are built" : "Configure 4D Reconstruction"}
          </DialogTitle>
          <DialogDescription>
            {nothingToBuild
              ? "Every reconstruction that can be built for this project already exists or is being built."
              : "Choose which reconstructions to build."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {nothingToBuild ? (
            <>
              <ul className="space-y-2">
                {builtOrBuilding.map(({ model, chamber, state }) => (
                  <li key={targetKey(model, chamber)} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      {state.kind === "built" ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                      ) : (
                        <Loader2 className="text-muted-foreground h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                      )}
                      <span className="truncate">
                        {MODEL_LABELS[model]} · {CHAMBER_LABELS[chamber]}
                      </span>
                    </span>
                    {state.kind === "built" && onViewReconstruction ? (
                      <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => viewTarget(model, chamber)}>
                        <Eye className="h-3 w-3" aria-hidden="true" />
                        View 4D
                      </Button>
                    ) : (
                      <span className="text-muted-foreground text-xs">Building…</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground text-xs">To rebuild, delete that model&apos;s reconstruction from the project page: &quot;Delete RV only&quot; frees the RV, &quot;Delete All&quot; removes both LV and RV.</p>
            </>
          ) : (
            <>
              {noModelsAvailable && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                  <div className="text-xs text-amber-900 dark:text-amber-100">
                    <p className="font-medium">No segmentation result available</p>
                    <p className="mt-1">Run MedSAM or UNet segmentation on this project first, then return here to start a reconstruction.</p>
                  </div>
                </div>
              )}

              <ReconstructionTargetGrid
                cellState={cellState}
                selected={selected}
                onToggle={toggle}
                onView={onViewReconstruction ? viewTarget : undefined}
                disabled={isLoading}
              />

              {anyRvSelected && (
                <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                  <p className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    RV reconstruction is not validated for clinical use
                  </p>
                  <p className="text-muted-foreground">
                    Research and reference only — not for clinical diagnosis or measurement. Created as a separate
                    reconstruction; it does not replace the LV result.
                  </p>
                </div>
              )}

              {selectedTargets.length > 0 && (
                <div className="bg-muted/40 space-y-1 rounded-lg p-3 text-sm" aria-live="polite">
                  <p className="font-medium">
                    You&apos;ll run {plural(selectedTargets.length, "reconstruction")} (
                    {[lvCount ? `${lvCount} LV` : null, rvCount ? `${rvCount} RV` : null].filter(Boolean).join(", ")})
                  </p>
                  <p className="text-muted-foreground text-xs">GPU jobs run one after another.</p>
                  <p className="text-muted-foreground text-xs">≈ {minutes} min, excluding mesh export</p>
                </div>
              )}

              <ReconstructionAdvancedSettings
                values={advanced}
                onChange={setAdvanced}
                totalFrames={totalFrames}
                gpuAvailable={gpuAvailable}
                defaultIterations={defaultIterations}
                disabled={isLoading}
              />
            </>
          )}
        </div>

        <DialogFooter className="flex-col-reverse gap-2 border-t px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          {nothingToBuild ? (
            <Button className="sm:ml-auto" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : (
            <>
              <p className="text-muted-foreground text-xs" aria-live="polite">
                {startDisabledReason}
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                  Cancel
                </Button>
                <Button onClick={handleStart} disabled={isLoading || selectedTargets.length === 0}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isLoading
                    ? "Starting…"
                    : `Start ${selectedTargets.length > 1 ? `${selectedTargets.length} reconstructions` : "reconstruction"}`}
                </Button>
              </div>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
