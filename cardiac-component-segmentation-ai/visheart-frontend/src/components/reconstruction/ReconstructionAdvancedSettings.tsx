"use client";

import { useState } from "react";
import { ChevronDown, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export interface AdvancedValues {
  exportFormat: "obj" | "glb";
  edFrame: number;
  numIterations: number;
  resolution: number;
}

interface ReconstructionAdvancedSettingsProps {
  values: AdvancedValues;
  onChange: (values: AdvancedValues) => void;
  totalFrames: number;
  gpuAvailable: boolean;
  defaultIterations: number;
  disabled?: boolean;
}

export function ReconstructionAdvancedSettings({
  values,
  onChange,
  totalFrames,
  gpuAvailable,
  defaultIterations,
  disabled = false,
}: ReconstructionAdvancedSettingsProps) {
  const [open, setOpen] = useState(false);
  const { exportFormat, edFrame, numIterations, resolution } = values;
  const set = (patch: Partial<AdvancedValues>) => onChange({ ...values, ...patch });
  const summary = `ED frame ${edFrame} · ${exportFormat.toUpperCase()} · ${numIterations} iterations · resolution ${resolution}`;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" className="h-auto w-full justify-between gap-3 px-3 py-2.5 text-left">
          <span className="flex min-w-0 flex-col items-start gap-0.5">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Settings className="h-4 w-4" aria-hidden="true" />
              Advanced settings
            </span>
            <span className="text-muted-foreground truncate text-xs font-normal">{summary}</span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t px-3 py-4">
        {/* ED Frame Selection */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="edFrame">End-Diastole (ED) Frame</Label>
            <span className="text-sm font-mono text-muted-foreground">Frame {edFrame}</span>
          </div>
          <Input
            id="edFrame"
            type="number"
            min={1}
            max={totalFrames}
            step={1}
            value={edFrame}
            disabled={disabled}
            onChange={(e) => set({ edFrame: Math.max(1, Math.min(totalFrames, parseInt(e.target.value) || 1)) })}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Select the cardiac end-diastole frame for 4D reconstruction (1-{totalFrames}). This frame represents the
            relaxed state of the cardiac cycle.
          </p>
        </div>

        {/* Export Format Selection */}
        <div className="space-y-2">
          <Label htmlFor="format">Export Format</Label>
          <Select value={exportFormat} disabled={disabled} onValueChange={(value: string) => set({ exportFormat: value as "obj" | "glb" })}>
            <SelectTrigger id="format">
              <SelectValue placeholder="Select format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="glb">
                <div className="flex flex-col items-start">
                  <span className="font-medium">GLB (Recommended)</span>
                  <span className="text-xs text-muted-foreground">Binary glTF 2.0 - Optimized for web, smaller file size</span>
                </div>
              </SelectItem>
              <SelectItem value="obj">
                <div className="flex flex-col items-start">
                  <span className="font-medium">OBJ (Wavefront)</span>
                  <span className="text-xs text-muted-foreground">Plain text format - Widely supported, human-readable</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">GLB format provides better performance and smaller file sizes for web viewing</p>
        </div>

        {/* SDF Optimizer Iterations */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="iterations">SDF Optimizer Iterations</Label>
            <span className="text-sm font-mono text-muted-foreground">{numIterations}</span>
          </div>
          <Input
            id="iterations"
            type="number"
            min={10}
            max={200}
            step={10}
            value={numIterations}
            disabled={disabled}
            onChange={(e) => set({ numIterations: parseInt(e.target.value) || defaultIterations })}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Number of optimization iterations for latent code fitting (10-200). Below ~120 the fit is measurably
            under-converged and chamber volumes are off by around 30%. Measured cost per iteration per frame: ~0.014s on
            GPU, ~0.081s on CPU. Default on this system: {defaultIterations} ({gpuAvailable ? "GPU" : "CPU"}).
            {!gpuAvailable && (
              <>
                {" "}
                Raising this on CPU can push a 30-frame job past 10 minutes, after which the viewer stops watching for it
                -- the job still finishes, but you will need to reload to see it.
              </>
            )}
          </p>
        </div>

        {/* Marching Cubes Resolution */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="resolution">Marching Cubes Resolution</Label>
            <span className="text-sm font-mono text-muted-foreground">{resolution}</span>
          </div>
          <Input
            id="resolution"
            type="number"
            min={32}
            max={256}
            step={32}
            value={resolution}
            disabled={disabled}
            onChange={(e) => set({ resolution: parseInt(e.target.value) || 32 })}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Mesh generation resolution (32-256). Higher values create more detailed meshes but increase processing time
            and file size. Default: 128
          </p>
        </div>

        {/* Warning for high values */}
        {resolution > 128 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <Settings className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <div className="text-xs text-amber-900 dark:text-amber-100">
              <p className="font-medium">High performance settings detected</p>
              <p className="mt-1">
                These settings will significantly increase processing time and may require more GPU memory. Use with
                caution.
              </p>
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
