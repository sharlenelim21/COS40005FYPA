"use client";

import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const HINT_LINES = ["Left Click+Drag: Rotate", "Right Click+Drag: Pan", "Scroll: Zoom"];

export function ViewerControlsHint({ compact, hidden }: { compact: boolean; hidden: boolean }) {
  const fadeClass = cn(
    "absolute right-3 bottom-3 z-10 motion-safe:transition-opacity motion-safe:duration-200",
    hidden && "pointer-events-none opacity-0",
  );

  if (compact) {
    return (
      <div className={fadeClass} aria-hidden={hidden}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              tabIndex={hidden ? -1 : 0}
              aria-label="Viewer controls"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none"
            >
              <HelpCircle className="h-4 w-4" aria-hidden="true" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="end">
            <p className="font-semibold">Controls</p>
            {HINT_LINES.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className={cn(fadeClass, "rounded-md bg-black/70 px-3 py-2 text-xs text-white")} aria-hidden={hidden}>
      <p className="font-semibold">Controls:</p>
      {HINT_LINES.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
