"use client";

import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";

interface SliceRef {
  frameindex: number;
  sliceindex: number;
}

export function CorrectedSliceGrid({
  slices,
  selectedIndex,
  onSelect,
}: {
  slices: readonly SliceRef[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  const groups = useMemo(() => {
    const byFrame = new Map<number, { slice: SliceRef; position: number }[]>();
    slices.forEach((slice, position) => {
      const list = byFrame.get(slice.frameindex) ?? [];
      list.push({ slice, position });
      byFrame.set(slice.frameindex, list);
    });
    return [...byFrame.entries()].sort(([a], [b]) => a - b);
  }, [slices]);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return (
    <div className="max-h-56 overflow-x-hidden overflow-y-auto rounded-md border p-2" role="group" aria-label="Corrected slices">
      <div className="space-y-2">
        {groups.map(([frame, entries]) => (
          <div key={frame} className="grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-2">
            <span className="text-muted-foreground pt-1 text-xs font-medium tabular-nums">F{frame + 1}</span>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1">
              {entries.map(({ slice, position }) => {
                const isSelected = position === selectedIndex;
                return (
                  <button
                    key={`${slice.frameindex}:${slice.sliceindex}`}
                    ref={isSelected ? selectedRef : undefined}
                    type="button"
                    onClick={() => onSelect(position)}
                    aria-pressed={isSelected}
                    aria-label={`Frame ${slice.frameindex + 1}, slice ${slice.sliceindex + 1}`}
                    className={cn(
                      "focus-visible:ring-ring h-7 rounded-md border text-xs tabular-nums transition-colors focus-visible:ring-2 focus-visible:outline-none",
                      isSelected ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
                    )}
                  >
                    S{slice.sliceindex + 1}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
