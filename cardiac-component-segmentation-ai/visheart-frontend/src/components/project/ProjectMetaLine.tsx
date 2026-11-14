"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface ProjectMetaLineProps {
  projectId?: string;
  frames?: number;
  slices?: number;
  filesizeBytes?: number;
}

const isPositive = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function ProjectMetaLine({ projectId, frames, slices, filesizeBytes }: ProjectMetaLineProps) {
  const parts = [
    isPositive(frames) ? plural(frames, "frame") : null,
    isPositive(slices) ? plural(slices, "slice") : null,
    isPositive(filesizeBytes) ? `${(filesizeBytes / 1024 / 1024).toFixed(2)} MB` : null,
  ].filter((part): part is string => part !== null);

  if (parts.length === 0 && !projectId) return null;

  const copyId = async () => {
    if (!projectId) return;
    try {
      await navigator.clipboard.writeText(projectId);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy the project ID");
    }
  };

  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs">
      {parts.length > 0 && <span className="tabular-nums">{parts.join(" · ")}</span>}
      {projectId && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={copyId}
              aria-label="Copy project ID"
              className="hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Copy project ID</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
