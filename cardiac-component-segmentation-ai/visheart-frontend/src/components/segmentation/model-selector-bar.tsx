"use client";

import React from "react";
import { Brain, CheckCircle2, Clock3, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type SegmentationModelId = "existing_model" | "model_2";

interface ModelSelectorBarProps {
  selectedModel: SegmentationModelId;
  onModelChange: (value: SegmentationModelId) => void;
}

const MODEL_LABELS: Record<SegmentationModelId, string> = {
  existing_model: "Existing Model",
  model_2: "Model 2",
};

export function ModelSelectorBar({
  selectedModel,
  onModelChange,
}: ModelSelectorBarProps) {
  const isExistingModel = selectedModel === "existing_model";

  return (
    <div className="w-full mb-4 rounded-lg border bg-background shadow-sm overflow-hidden">
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex items-center gap-2 min-w-[220px]">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Brain className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                AI Model
              </div>
              <div className="text-sm font-medium text-foreground">
                Select segmentation model
              </div>
            </div>
          </div>

          <div className="min-w-[220px]">
            <select
              value={selectedModel}
              onChange={(e) => onModelChange(e.target.value as any)}
              className="text-sm border rounded px-2 py-1"
            >
              <option value="existing_model">Existing Model</option>
              <option value="model_2">Model 2</option>
            </select>

            <div className="text-xs text-muted-foreground mt-1">
              Model used: {selectedModel === "model_2" ? "Model 2" : "Existing Model"}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Badge
            variant="outline"
            className={isExistingModel ? "border-green-200 bg-green-50 text-green-700" : "border-amber-200 bg-amber-50 text-amber-700"}
          >
            {isExistingModel ? (
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            ) : (
              <Clock3 className="mr-1 h-3.5 w-3.5" />
            )}
            {isExistingModel ? "Ready to segment" : "Sprint 1 UI only"}
          </Badge>

          <Badge variant="secondary" className="justify-start">
            Session saved: {MODEL_LABELS[selectedModel]}
          </Badge>

          <Badge variant="outline" className="justify-start font-mono text-[11px]">
            <Database className="mr-1 h-3.5 w-3.5" />
            model: {selectedModel}
          </Badge>
        </div>
      </div>

      <div className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        {isExistingModel ? (
          <span>
            Existing Model will be used when you draw a bounding box for manual segmentation.
          </span>
        ) : (
          <span>
            Model 2 will only show acknowledgement in Sprint 1. No segmentation API call will be made yet.
          </span>
        )}
      </div>
    </div>
  );
}
