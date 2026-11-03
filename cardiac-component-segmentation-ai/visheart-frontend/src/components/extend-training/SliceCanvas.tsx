"use client";

import { useEffect, useRef } from "react";
import { LABEL_COLORS } from "@/types/segmentation";
import { Box, hexToRgb, paintLabels, Rgb } from "@/components/extend-training/logic";

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

const DRAWN_SIZE = 512; // the canvas is drawn about this wide, then scaled to fit by CSS

/**
 * A scan slice with label overlays, scaled to fit by CSS (plan WS13 R1). The scan is drawn smoothly and the labels
 * with sharp pixel edges, so a thin band where two masks differ stays visible. `crop`, in scan pixels, shows only
 * that square, enlarged ("Zoom to the heart").
 */
export function SliceCanvas({ imageUrl, width, height, overlays, label, crop = null }: {
  imageUrl: string | null;
  width: number;
  height: number;
  overlays: Overlay[];
  label: string;
  crop?: Box | null;
}) {
  const box = crop ? { x: crop.x, y: crop.y, w: crop.size, h: crop.size } : { x: 0, y: 0, w: width, h: height };
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element || width <= 0 || height <= 0) return;
    let cancelled = false;
    const draw = (image: HTMLImageElement | null) => {
      const context = element.getContext("2d");
      if (cancelled || !context) return;
      const scale = Math.max(1, Math.round(DRAWN_SIZE / box.w));
      element.width = box.w * scale;
      element.height = box.h * scale;
      context.fillStyle = "#000";
      context.fillRect(0, 0, element.width, element.height);
      if (image) {
        // The scan's own pixels map onto width x height, as the labels do.
        const sx = image.naturalWidth / width, sy = image.naturalHeight / height;
        context.imageSmoothingEnabled = true;
        context.drawImage(image, box.x * sx, box.y * sy, box.w * sx, box.h * sy, 0, 0, element.width, element.height);
      }
      const layer = new ImageData(width, height);
      for (const overlay of overlays) paintLabels(layer.data, overlay.labels, overlay.palette, overlay.alpha);
      const scratch = document.createElement("canvas");
      scratch.width = width;
      scratch.height = height;
      scratch.getContext("2d")?.putImageData(layer, 0, 0);
      context.imageSmoothingEnabled = false;   // every label pixel a sharp square
      context.drawImage(scratch, box.x, box.y, box.w, box.h, 0, 0, element.width, element.height);
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
  }, [imageUrl, width, height, overlays, box.x, box.y, box.w, box.h]);

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      className="block h-auto w-full rounded-md bg-black"
      style={{ aspectRatio: `${box.w} / ${box.h}` }}
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
