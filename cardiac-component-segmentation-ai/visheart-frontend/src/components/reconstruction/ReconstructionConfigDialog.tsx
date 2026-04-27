"use client";

import { useState } from "react";
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
import { ChevronDown, Settings, Sparkles } from "lucide-react";

export interface ReconstructionConfig {
  exportFormat: "obj" | "glb";
  edFrame: number; // 1-based frame index for user selection
  numIterations: number;
  resolution: number;
}

interface ReconstructionConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (config: ReconstructionConfig) => void;
  isLoading?: boolean;
  totalFrames?: number; // Total number of frames in the project
}

export function ReconstructionConfigDialog({
  open,
  onOpenChange,
  onStart,
  isLoading = false,
  totalFrames = 1,
}: ReconstructionConfigDialogProps) {
  const [exportFormat, setExportFormat] = useState<"obj" | "glb">("glb");
  const [edFrame, setEdFrame] = useState(1);
  const [numIterations, setNumIterations] = useState(30);
  const [resolution, setResolution] = useState(32);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleStart = () => {
    onStart({
      exportFormat,
      edFrame,
      numIterations,
      resolution,
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
          <Button onClick={handleStart} disabled={isLoading}>
            {isLoading ? "Starting..." : "Start Reconstruction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
