"use client";

import { useEffect, useRef } from "react";
import { LABEL_COLORS } from "@/types/segmentation";
import { hexToRgb, paintLabels, Rgb } from "@/components/extend-training/logic";

/** The editor's colours by label number: 1 RV, 2 myocardium, 3 LV cavity, 4 manual. */
export const LABEL_PALETTE: Record<number, Rgb> = {
  1: hexToRgb(LABEL_COLORS.rv), 2: hexToRgb(LABEL_COLORS.myo), 3: hexToRgb(LABEL_COLORS.lvc), 4: [148, 163, 184],
};
export const CHANGE_COLOR: Rgb = [250, 204, 21]; // changed or disagreeing pixels
export const OUTLINE_COLOR: Rgb = [255, 255, 255]; // the expert outline

export interface Overlay {
  labels: Uint8Array;
  palette: Record<number, Rgb>;
  alpha: number;
}

/** A scan slice with label overlays, drawn at the scan's own size and scaled to fit by CSS (plan WS13 R1). */
export function SliceCanvas({ imageUrl, width, height, overlays, label }: {
  imageUrl: string | null;
  width: number;
  height: number;
  overlays: Overlay[];
  label: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element || width <= 0 || height <= 0) return;
    let cancelled = false;
    const draw = (image: HTMLImageElement | null) => {
      const context = element.getContext("2d");
      if (cancelled || !context) return;
      element.width = width;
      element.height = height;
      context.fillStyle = "#000";
      context.fillRect(0, 0, width, height);
      if (image) context.drawImage(image, 0, 0, width, height);
      const layer = new ImageData(width, height);
      for (const overlay of overlays) paintLabels(layer.data, overlay.labels, overlay.palette, overlay.alpha);
      const scratch = document.createElement("canvas");
      scratch.width = width;
      scratch.height = height;
      scratch.getContext("2d")?.putImageData(layer, 0, 0);
      context.drawImage(scratch, 0, 0);
    };
    if (imageUrl) {
      const image = new Image();
      image.onload = () => draw(image);
      image.onerror = () => draw(null);
      image.src = imageUrl;
    } else {
      draw(null);
    }
    return () => {
      cancelled = true;
    };
  }, [imageUrl, width, height, overlays]);

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      className="block h-auto w-full rounded-md bg-black"
      style={{ aspectRatio: `${width} / ${height}` }}
    />
  );
}

export function MaskLegend({ extras = [] }: { extras?: { label: string; color: string; outline?: boolean }[] }) {
  const items = [
    { label: "Right ventricle", color: LABEL_COLORS.rv, outline: false },
    { label: "Myocardium", color: LABEL_COLORS.myo, outline: false },
    { label: "Left ventricle cavity", color: LABEL_COLORS.lvc, outline: false },
    ...extras,
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map(item => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-sm border-2"
            style={item.outline ? { borderColor: item.color, backgroundColor: "#000" } : { borderColor: item.color, backgroundColor: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
