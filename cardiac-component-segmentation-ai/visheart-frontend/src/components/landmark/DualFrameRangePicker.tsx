"use client";

import React, { useCallback, useEffect, useRef } from "react";

/** Dual-handle ED/ES frame range slider — shared by the main strain panel and
 *  the sidebar's "Compute strain" card so both drive the same picker UI. */
export function DualFrameRangePicker({
  min,
  max,
  edValue,
  esValue,
  onEdChange,
  onEsChange,
}: {
  min: number;
  max: number;
  edValue: number;
  esValue: number;
  onEdChange: (value: number) => void;
  onEsChange: (value: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingHandle = useRef<"ed" | "es" | null>(null);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const pctFor = (value: number) => (max > min ? ((value - min) / (max - min)) * 100 : 0);

  const valueFromClientX = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track) return min;
    const rect = track.getBoundingClientRect();
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    const raw = min + ratio * (max - min);
    return clamp(Math.round(raw));
  }, [min, max]);

  const applyDrag = useCallback((clientX: number) => {
    const handle = draggingHandle.current;
    if (!handle) return;
    const value = valueFromClientX(clientX);
    if (handle === "ed") {
      // ED cannot cross or equal ES.
      onEdChange(Math.min(value, esValue - 1));
    } else {
      // ES cannot cross or equal ED.
      onEsChange(Math.max(value, edValue + 1));
    }
  }, [valueFromClientX, edValue, esValue, onEdChange, onEsChange]);

  // Fast drags can momentarily move the pointer off the small handle circle
  // (onto the track or page), so cursor-grabbing set only via Tailwind classes
  // on the handle flickers back to the default arrow. Set it explicitly on
  // document.body for the duration of the drag instead — same technique this
  // codebase already uses on a container ref for canvas panning
  // (image-canvas.tsx), scoped to body here since this drag isn't bounded to
  // one container. user-select is also suppressed so a fast drag doesn't
  // trigger accidental text selection on nearby labels.
  const endDrag = useCallback(() => {
    draggingHandle.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    if (!draggingHandle.current) return undefined;
    const onMove = (e: PointerEvent) => applyDrag(e.clientX);
    const onUp = () => endDrag();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    // Safety net: if the pointer is released outside the window entirely
    // (no pointerup fires), still restore cursor/selection on blur.
    window.addEventListener("blur", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("blur", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edValue, esValue]);

  const startDrag = (handle: "ed" | "es") => (e: React.PointerEvent) => {
    e.preventDefault();
    draggingHandle.current = handle;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    // Kick off listeners immediately (effect above re-attaches on next render,
    // but we also want the very first move to register without waiting).
    const onMove = (ev: PointerEvent) => applyDrag(ev.clientX);
    const onUp = () => {
      endDrag();
      window.removeEventListener("pointermove", onMove);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("blur", onUp, { once: true });
  };

  const onKeyDown = (handle: "ed" | "es") => (e: React.KeyboardEvent) => {
    let delta = 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") delta = -1;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") delta = 1;
    else return;
    e.preventDefault();
    if (handle === "ed") {
      onEdChange(clamp(Math.min(edValue + delta, esValue - 1)));
    } else {
      onEsChange(clamp(Math.max(esValue + delta, edValue + 1)));
    }
  };

  const edPct = pctFor(edValue);
  const esPct = pctFor(esValue);
  const rangeStartPct = Math.min(edPct, esPct);
  const rangeWidthPct = Math.abs(esPct - edPct);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={trackRef}
        className="relative h-1.5 w-full rounded-full bg-muted"
      >
        {/* Filled segment between the two handles */}
        <div
          className="absolute h-full rounded-full bg-primary/70"
          style={{ left: `${rangeStartPct}%`, width: `${rangeWidthPct}%` }}
        />
        {/* ED handle — hollow/outlined */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={`End-diastole frame, ${edValue + 1} of ${max - min + 1}`}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={edValue}
          onPointerDown={startDrag("ed")}
          onKeyDown={onKeyDown("ed")}
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-primary bg-background shadow-sm transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring active:cursor-grabbing"
          style={{ left: `${edPct}%` }}
        />
        {/* ES handle — filled */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={`End-systole frame, ${esValue + 1} of ${max - min + 1}`}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={esValue}
          onPointerDown={startDrag("es")}
          onKeyDown={onKeyDown("es")}
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-primary bg-primary shadow-sm transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring active:cursor-grabbing"
          style={{ left: `${esPct}%` }}
        />
      </div>
      <div className="relative h-7 text-[10px] font-mono">
        <span
          className="absolute -translate-x-1/2 text-muted-foreground"
          style={{ left: `${edPct}%` }}
        >
          ED · {edValue + 1}
        </span>
        <span
          className="absolute -translate-x-1/2 font-semibold text-primary"
          style={{ left: `${esPct}%` }}
        >
          ES · {esValue + 1}
        </span>
      </div>
    </div>
  );
}
