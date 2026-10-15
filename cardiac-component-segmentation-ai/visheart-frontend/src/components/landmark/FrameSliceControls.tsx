"use client";

import { memo } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Cardiac-frame + spatial-slice navigation bar for the Landmarks tab --
 * same layout/component pattern as segmentation's own NavigationControls
 * (components/segmentation/image-canvas.tsx), reused here (not imported
 * directly, since that one is a local unexported component) so landmark
 * editing has the same familiar top-of-viewer frame/slice controls instead
 * of the sidebar's playback bars alone.
 */
export const FrameSliceControls = memo(function FrameSliceControls({
  currentFrame,
  currentSlice,
  totalFrames,
  totalSlices,
  onFrameChange,
  onSliceChange,
}: {
  currentFrame: number;
  currentSlice: number;
  totalFrames: number;
  totalSlices: number;
  onFrameChange: (frame: number) => void;
  onSliceChange: (slice: number) => void;
}) {
  return (
    <div className="w-full p-4 bg-muted rounded-lg shadow-md flex-shrink-0">
      <div className="grid grid-cols-2 gap-8">
        {/* Frame controls (cardiac cycle) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Frame</span>
            <span className="text-xs text-muted-foreground">{totalFrames} total</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => onFrameChange(Math.max(0, currentFrame - 1))}
              disabled={currentFrame <= 0}
              className="h-8 w-8 p-0"
              aria-label="Previous Frame"
            >
              <span className="sr-only">Previous Frame</span>
              <ArrowLeft className="h-3 w-3" />
            </Button>
            <Input
              type="number"
              value={currentFrame + 1}
              min={1}
              max={totalFrames}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (!isNaN(val) && val >= 1 && val <= totalFrames) {
                  onFrameChange(val - 1);
                }
              }}
              className="flex-1 h-8 text-center"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => onFrameChange(Math.min(totalFrames - 1, currentFrame + 1))}
              disabled={currentFrame >= totalFrames - 1}
              className="h-8 w-8 p-0"
              aria-label="Next Frame"
            >
              <span className="sr-only">Next Frame</span>
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
          <Slider
            value={[currentFrame]}
            onValueChange={(v: number[]) => onFrameChange(v[0])}
            min={0}
            max={Math.max(0, totalFrames - 1)}
            step={1}
            disabled={totalFrames <= 1}
            className="mt-2 [&>span:first-child]:border [&>span:first-child]:border-border"
          />
        </div>

        {/* Slice controls (spatial position within the frame) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Slice</span>
            <span className="text-xs text-muted-foreground">{totalSlices} total</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => onSliceChange(Math.max(0, currentSlice - 1))}
              disabled={currentSlice <= 0}
              className="h-8 w-8 p-0"
              aria-label="Previous Slice"
            >
              <span className="sr-only">Previous Slice</span>
              <ArrowUp className="h-3 w-3" />
            </Button>
            <Input
              type="number"
              value={currentSlice + 1}
              min={1}
              max={totalSlices}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (!isNaN(val) && val >= 1 && val <= totalSlices) {
                  onSliceChange(val - 1);
                }
              }}
              className="flex-1 h-8 text-center"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => onSliceChange(Math.min(totalSlices - 1, currentSlice + 1))}
              disabled={currentSlice >= totalSlices - 1}
              className="h-8 w-8 p-0"
              aria-label="Next Slice"
            >
              <span className="sr-only">Next Slice</span>
              <ArrowDown className="h-3 w-3" />
            </Button>
          </div>
          <Slider
            value={[currentSlice]}
            onValueChange={(v: number[]) => onSliceChange(v[0])}
            min={0}
            max={Math.max(0, totalSlices - 1)}
            step={1}
            disabled={totalSlices <= 1}
            className="mt-2 [&>span:first-child]:border [&>span:first-child]:border-border"
          />
        </div>
      </div>
    </div>
  );
});
