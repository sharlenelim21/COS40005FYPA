"use client";

import { useEffect, useState } from "react";
import { Crosshair, Layers, Box, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  RECON_COMBOS,
  SEG_MODEL_ORDER,
  type Chamber,
  type Model,
  type PipelineSelection,
} from "@/hooks/useAutoPipelineChain";

const MODEL_LABEL: Record<Model, string> = { medsam: "MedSAM", unet: "UNet" };
const comboKey = (m: Model, c: Chamber) => `${m}:${c}`;

interface StartPipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (selection: PipelineSelection) => Promise<void> | void;
  gpuAvailable: boolean;
  isGuest: boolean;
  isRerun: boolean;
  existing: Record<Chamber, Set<Model>>;
  building: Record<Chamber, Set<Model>>;
}

export function StartPipelineDialog({
  open,
  onOpenChange,
  onSubmit,
  gpuAvailable,
  isGuest,
  isRerun,
  existing,
  building,
}: StartPipelineDialogProps) {
  const defaultModel: Model = gpuAvailable ? "medsam" : "unet";
  const [segModels, setSegModels] = useState<Set<Model>>(new Set([defaultModel]));
  const [combos, setCombos] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSegModels(new Set([defaultModel]));
    setCombos(new Set());
    setSubmitting(false);
  }, [open, defaultModel]);

  const modelDisabled = (m: Model) => m === "medsam" && !gpuAvailable;

  const toggleModel = (m: Model, checked: boolean) => {
    setSegModels((prev) => {
      const next = new Set(prev);
      if (checked) next.add(m);
      else next.delete(m);
      return next;
    });
    if (!checked) {
      setCombos((prev) => new Set([...prev].filter((k) => !k.startsWith(`${m}:`))));
    }
  };

  const toggleCombo = (key: string, checked: boolean) => {
    setCombos((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const comboNote = (m: Model, c: Chamber): string | null => {
    if (existing[c].has(m)) return "Already exists — will be skipped";
    if (building[c].has(m)) return "Already building — will be followed";
    return null;
  };

  const hasRunnableModel = [...segModels].some((m) => !modelDisabled(m));
  const canSubmit = hasRunnableModel && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({
        segModels: SEG_MODEL_ORDER.filter((m) => segModels.has(m) && !modelDisabled(m)),
        combos: RECON_COMBOS.filter(({ model, chamber }) => segModels.has(model) && combos.has(comboKey(model, chamber))),
        runLandmark: !isGuest,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isRerun ? "Re-run Segmentation" : "Start Segmentation"}</DialogTitle>
          <DialogDescription>
            Choose what to run. Jobs queue on the GPU one after another.
            {isRerun && " Re-running a model replaces its current masks, including any saved edits."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Layers className="h-4 w-4 text-primary" /> Segmentation
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {SEG_MODEL_ORDER.map((m) => {
                const disabled = modelDisabled(m);
                const id = `pipeline-seg-${m}`;
                return (
                  <Label
                    key={m}
                    htmlFor={id}
                    className={cn(
                      "rounded-md border p-3 font-normal",
                      disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                    )}
                  >
                    <Checkbox
                      id={id}
                      checked={segModels.has(m) && !disabled}
                      disabled={disabled}
                      onCheckedChange={(v) => toggleModel(m, v === true)}
                    />
                    <span className="flex-1">
                      <span className="block font-medium">{MODEL_LABEL[m]}</span>
                      {disabled && <span className="block text-xs text-muted-foreground">Needs GPU</span>}
                    </span>
                  </Label>
                );
              })}
            </div>
            {!hasRunnableModel && (
              <p className="text-xs text-destructive">Select at least one segmentation model.</p>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Box className="h-4 w-4 text-primary" /> 4D Reconstruction
              <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            </h3>
            {isGuest ? (
              <p className="text-xs text-muted-foreground">Sign in to build 4D reconstructions.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {RECON_COMBOS.map(({ model, chamber }) => {
                  const key = comboKey(model, chamber);
                  const id = `pipeline-recon-${model}-${chamber}`;
                  const enabled = segModels.has(model) && !modelDisabled(model);
                  const note = enabled ? comboNote(model, chamber) : `Select ${MODEL_LABEL[model]} segmentation`;
                  return (
                    <Label
                      key={key}
                      htmlFor={id}
                      className={cn(
                        "rounded-md border p-3 font-normal",
                        enabled ? "cursor-pointer" : "cursor-not-allowed opacity-50",
                      )}
                    >
                      <Checkbox
                        id={id}
                        checked={enabled && combos.has(key)}
                        disabled={!enabled}
                        onCheckedChange={(v) => toggleCombo(key, v === true)}
                      />
                      <span className="flex-1">
                        <span className="block font-medium">
                          {MODEL_LABEL[model]} · {chamber.toUpperCase()}
                        </span>
                        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
                      </span>
                    </Label>
                  );
                })}
              </div>
            )}
          </section>

          {!isGuest && (
            <section className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              <Crosshair className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p>
                Landmark detection runs automatically once segmentation finishes
                {segModels.has("unet") ? ", using the UNet mask" : segModels.has("medsam") ? ", using the MedSAM mask" : ""}.
              </p>
            </section>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Starting…" : isRerun ? "Re-run" : "Start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
