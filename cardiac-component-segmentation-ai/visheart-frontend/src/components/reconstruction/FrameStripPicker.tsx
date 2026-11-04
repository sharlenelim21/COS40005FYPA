"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A 4D reconstruction's frames on one track, in the style of the landmark page's ED/ES slider (DualFrameRangePicker):
 * a dot per frame, filled when it is built; the end-diastole frame (frame 1) is always built. With `onPaint`, pressing
 * a dot builds or skips it, and dragging on across the track does the same to every dot passed. The built frames are
 * numbered under the track, as many as fit. Frames are 1-based, as the dialog shows them.
 */
const LABEL_GAP_PX = 18; // a two-digit number at 10px, with room to breathe

/** The built frames to number: the first and last always, the rest from the left wherever there is room. */
export function labelledFrames(built: number[], totalFrames: number, widthPx: number): number[] {
  const sorted = [...built].sort((a, b) => a - b);
  if (sorted.length <= 2 || totalFrames <= 1) return sorted;
  const pxPerFrame = widthPx / (totalFrames - 1);
  const last = sorted[sorted.length - 1];
  const shown = [sorted[0]];
  for (const frame of sorted.slice(1, -1)) {
    const roomBefore = (frame - shown[shown.length - 1]) * pxPerFrame >= LABEL_GAP_PX;
    const roomAfter = (last - frame) * pxPerFrame >= LABEL_GAP_PX;
    if (roomBefore && roomAfter) shown.push(frame);
  }
  return [...shown, last];
}

export function FrameStripPicker({
  totalFrames,
  edFrame,
  built,
  onPaint,
}: {
  totalFrames: number;
  edFrame: number;
  built: number[];
  onPaint?: (frames: number[], on: boolean) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const stroke = useRef<{ on: boolean; last: number } | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(track);
    return () => observer.disconnect();
  }, []);
  const builtSet = new Set(built);
  const pct = (frame: number) => (totalFrames > 1 ? ((frame - 1) / (totalFrames - 1)) * 100 : 0);

  const frameAt = useCallback((clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 1;
    const frame = Math.round(1 + ((clientX - rect.left) / rect.width) * (totalFrames - 1));
    return Math.min(totalFrames, Math.max(1, frame));
  }, [totalFrames]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!onPaint) return;
    e.preventDefault();
    const frame = frameAt(e.clientX);
    if (frame === edFrame) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // The first dot decides: a built one starts skipping, a skipped one starts building.
    stroke.current = { on: !builtSet.has(frame), last: frame };
    onPaint([frame], stroke.current.on);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const current = stroke.current;
    if (!onPaint || !current) return;
    const frame = frameAt(e.clientX);
    if (frame === current.last) return;
    // Every frame between the last one and this one, so a fast drag skips none.
    const step = frame > current.last ? 1 : -1;
    const passed: number[] = [];
    for (let f = current.last + step; f !== frame + step; f += step) passed.push(f);
    current.last = frame;
    onPaint(passed, current.on);
  };
  const endStroke = () => { stroke.current = null; };

  return (
    <div className="flex flex-col gap-1 px-2">
      <div
        ref={trackRef}
        role="group"
        aria-label="Frames to build"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        className={cn("relative my-2 h-1.5 w-full touch-none rounded-full bg-muted", onPaint && "cursor-pointer select-none")}
      >
        {Array.from({ length: totalFrames }, (_, i) => i + 1).map(frame => {
          const on = builtSet.has(frame);
          const isEd = frame === edFrame;
          const dot = (
            <span
              className={cn(
                "block h-2.5 w-2.5 rounded-full border",
                on || isEd ? "border-primary bg-primary" : "border-muted-foreground/40 bg-background",
              )}
            />
          );
          const place = { left: `${pct(frame)}%` };
          return onPaint && !isEd ? (
            // Keyboard: Tab to a dot, Enter or Space builds or skips it (a pointer press is handled by the track).
            <button
              key={frame}
              type="button"
              onClick={e => { if (e.detail === 0) onPaint([frame], !on); }}
              aria-pressed={on}
              aria-label={`Frame ${frame}${on ? ", built" : ""}`}
              title={`Frame ${frame}`}
              className="absolute top-1/2 flex h-5 w-3 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded hover:bg-muted"
              style={place}
            >
              {dot}
            </button>
          ) : (
            <span
              key={frame}
              className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={place}
              title={isEd ? `Frame ${frame}: always built` : `Frame ${frame}`}
            >
              {dot}
            </span>
          );
        })}
      </div>
      <div className="relative h-4 font-mono text-[10px] text-muted-foreground" aria-hidden="true">
        {labelledFrames(built, totalFrames, width).map(frame => (
          <span key={frame} className="absolute -translate-x-1/2" style={{ left: `${pct(frame)}%` }}>{frame}</span>
        ))}
      </div>
    </div>
  );
}
