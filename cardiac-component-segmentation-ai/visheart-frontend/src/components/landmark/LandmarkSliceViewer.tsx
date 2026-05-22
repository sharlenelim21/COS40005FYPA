"use client";

import React, { useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { FramePrediction, LandmarkDefinition } from "@/types/landmark";
import { LANDMARK_DEFINITIONS, getLandmarkCoord } from "@/types/landmark";
import { LABEL_COLORS, type AnatomicalLabel } from "@/types/segmentation";

export interface LandmarkMaskOverlay {
  label: AnatomicalLabel;
  mask: Uint8Array;
}

interface LandmarkSliceViewerProps {
  prediction: FramePrediction | null;
  currentFrame: number;
  totalFrames: number;
  imageDimensions: { width: number; height: number };
  maskDimensions?: { width: number; height: number };
  frameImageUrl?: string | null;
  maskOverlays?: LandmarkMaskOverlay[];
  visibleLandmarks: Set<string>;
  showLabels?: boolean;
  editableLandmarks?: boolean;
  highlightedLandmarkId?: string | null;
  onLandmarkMove?: (id: string, coord: [number, number]) => void;
  className?: string;
}

const DOT_R       = 6;  
const GLOW_R      = 12;   
const CROSS_EXT   = 5;   
const LABEL_FONT  = "11px/1 system-ui, sans-serif";
const LABEL_PAD_X = 6;
const LABEL_PAD_Y = 4;

export const LandmarkSliceViewer = React.memo(function LandmarkSliceViewer({
  prediction,
  currentFrame,
  totalFrames,
  imageDimensions,
  maskDimensions,
  frameImageUrl,
  maskOverlays = [],
  visibleLandmarks,
  showLabels = true,
  editableLandmarks = false,
  highlightedLandmarkId,
  onLandmarkMove,
  className,
}: LandmarkSliceViewerProps) {
  const effectiveMaskDimensions = maskDimensions ?? imageDimensions;
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameImgRef  = useRef<HTMLImageElement | null>(null);
  const draggingLandmarkRef = useRef<string | null>(null);

  // Keep frame label values in refs so changing frame doesn't recreate `draw`
  const currentFrameRef = useRef(currentFrame);
  const totalFramesRef  = useRef(totalFrames);
  useEffect(() => { currentFrameRef.current = currentFrame; }, [currentFrame]);
  useEffect(() => { totalFramesRef.current  = totalFrames;  }, [totalFrames]);

  const toCanvas = useCallback(
    (coord: [number, number], cw: number, ch: number): [number, number] => {
      // GPU coords are in NIfTI space: x ∈ [0, W_nifti], y ∈ [0, H_nifti].
      // Canvas is always sized to the actual image aspect so cw/imageDimensions.width
      // gives the correct pixel-per-unit scale.
      const sx = cw / imageDimensions.width;
      const sy = ch / imageDimensions.height;
      return [Math.round(coord[0] * sx), Math.round(coord[1] * sy)];
    },
    [imageDimensions],
  );

  const draw = useCallback(
    (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { width: cw, height: ch } = canvas;

      ctx.clearRect(0, 0, cw, ch);

      if (frameImgRef.current) {
        ctx.drawImage(frameImgRef.current, 0, 0, cw, ch);
      } else {
        drawMockMri(ctx, cw, ch);
      }

      for (const overlay of maskOverlays) {
        drawMaskOverlay(ctx, overlay, effectiveMaskDimensions.width, effectiveMaskDimensions.height, cw, ch);
      }

      if (!prediction) return;

      const isCollapsed     = prediction.flag === "collapsed_to_mean";
      const isLowConfidence = prediction.flag === "normal" && prediction.confidence === "low";

      const sorted = [...LANDMARK_DEFINITIONS].sort((a, b) => a.priority - b.priority);
      for (const def of sorted) {
        if (!visibleLandmarks.has(def.id)) continue;
        const coord = getLandmarkCoord(prediction, def.id);
        if (!coord) continue;
        const [cx, cy] = toCanvas(coord, cw, ch);
        drawDot(ctx, cx, cy, def, showLabels, highlightedLandmarkId === def.id);
      }

      if (totalFramesRef.current > 0) {
        drawFrameLabel(ctx, currentFrameRef.current, totalFramesRef.current);
      }
    },
    [prediction, visibleLandmarks, showLabels, highlightedLandmarkId, toCanvas, maskOverlays, imageDimensions],
  );

  const canvasToImageCoord = useCallback((event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * imageDimensions.width;
    const y = ((event.clientY - rect.top) / rect.height) * imageDimensions.height;
    return [
      Math.max(0, Math.min(imageDimensions.width, Math.round(x))),
      Math.max(0, Math.min(imageDimensions.height, Math.round(y))),
    ];
  }, [imageDimensions]);

  const hitTestLandmark = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!prediction || !editableLandmarks) return null;
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const pointerX = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const pointerY = ((event.clientY - rect.top) / rect.height) * canvas.height;

    for (const def of [...LANDMARK_DEFINITIONS].sort((a, b) => b.priority - a.priority)) {
      if (!visibleLandmarks.has(def.id)) continue;
      const coord = getLandmarkCoord(prediction, def.id);
      if (!coord) continue;
      const [cx, cy] = toCanvas(coord, canvas.width, canvas.height);
      if (Math.hypot(pointerX - cx, pointerY - cy) <= GLOW_R + 6) return def.id;
    }
    return null;
  }, [editableLandmarks, prediction, toCanvas, visibleLandmarks]);

  // Redraw whenever draw function changes (prediction/masks/settings) or frame advances
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) draw(canvas);
  }, [draw, currentFrame, totalFrames]);

  useEffect(() => {
    if (!frameImageUrl) {
      frameImgRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) draw(canvas);
      return;
    }
    // Don't clear frameImgRef here — keep the previous frame visible while
    // the next one loads so the mock MRI placeholder never flashes through.
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (cancelled) return;
      frameImgRef.current = img;
      imgPixelDimsRef.current = { w: img.naturalWidth, h: img.naturalHeight };
      const canvas = canvasRef.current;
      if (canvas) draw(canvas);
    };
    img.onerror = () => {
      if (cancelled) return;
      frameImgRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) draw(canvas);
    };
    img.src = frameImageUrl;
    return () => { cancelled = true; };
  }, [frameImageUrl, draw]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver(() => {
      const { clientWidth: cw, clientHeight: ch } = container;
      if (cw === 0 || ch === 0) return;

      const aspect = imageDimensions.width / imageDimensions.height;
      let w = cw, h = cw / aspect;
      if (h > ch) { h = ch; w = h * aspect; }

      canvas.width  = Math.round(w);
      canvas.height = Math.round(h);
      draw(canvas);
    });

    ro.observe(container);
    return () => ro.disconnect();
  }, [imageDimensions, draw]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex items-center justify-center w-full h-full bg-black rounded-lg overflow-hidden",
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        className={cn("block max-w-full max-h-full", editableLandmarks && "cursor-crosshair")}
        style={{ imageRendering: "pixelated" }}
        aria-label={`MRI frame ${currentFrame + 1} of ${totalFrames}`}
        onPointerDown={(event) => {
          const landmarkId = hitTestLandmark(event);
          if (!landmarkId) return;
          draggingLandmarkRef.current = landmarkId;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!draggingLandmarkRef.current) return;
          onLandmarkMove?.(draggingLandmarkRef.current, canvasToImageCoord(event));
        }}
        onPointerUp={(event) => {
          draggingLandmarkRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          draggingLandmarkRef.current = null;
        }}
      />
    </div>
  );
});

function drawDot(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  def: LandmarkDefinition,
  showLabel: boolean,
  highlighted = false,
) {
  // Low-confidence: keep original colour but reduce opacity so dots remain distinguishable
  const dotColor  = def.color;
  const glowAlpha = "2a";
  const alpha     = 1.0;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Outer glow
  ctx.beginPath();
  ctx.arc(cx, cy, GLOW_R, 0, Math.PI * 2);
  ctx.fillStyle = highlighted ? def.color + "55" : def.color + "2a";
  ctx.fill();

  // Crosshair lines — clipped tightly around the dot
  const arm = DOT_R + CROSS_EXT;
  ctx.beginPath();
  ctx.moveTo(cx - DOT_R - CROSS_EXT, cy);
  ctx.lineTo(cx + DOT_R + CROSS_EXT, cy);
  ctx.moveTo(cx, cy - DOT_R - CROSS_EXT);
  ctx.lineTo(cx, cy + DOT_R + CROSS_EXT);
  ctx.strokeStyle = def.color + "88";  // 53% opacity
  ctx.lineWidth = highlighted ? 1.8 : 0.8;
  ctx.stroke();

  // Dot fill
  ctx.beginPath();
  ctx.arc(cx, cy, DOT_R, 0, Math.PI * 2);
  ctx.fillStyle = dotColor;
  ctx.fill();

  // White border
  ctx.beginPath();
  ctx.arc(cx, cy, DOT_R, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = highlighted ? 2.6 : 1.5;
  ctx.stroke();

  if (highlighted) {
    ctx.beginPath();
    ctx.arc(cx, cy, GLOW_R + 5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // Label pill
  if (!showLabel) return;

  ctx.font = LABEL_FONT;
  const text  = def.label;
  const tw    = ctx.measureText(text).width;
  const bw    = tw + LABEL_PAD_X * 2;
  const bh    = 16;
  const lx    = cx + DOT_R + 4;
  const ly    = cy - bh / 2;

  // Pill background
  ctx.beginPath();
  ctx.roundRect(lx, ly, bw, bh, 3);
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fill();

  // Pill text
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, lx + LABEL_PAD_X, cy);
  ctx.restore();
}

function drawMeanDot(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  showLabel: boolean,
) {
  const MEAN_R = 4; // smaller than regular DOT_R (6)
  const color  = "#e2e8f0"; // slate-200 — bright enough to see on dark MRI

  // Small solid dot
  ctx.beginPath();
  ctx.arc(cx, cy, MEAN_R, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Thin dashed ring just outside
  ctx.save();
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.arc(cx, cy, MEAN_R + 3, 0, Math.PI * 2);
  ctx.strokeStyle = color + "99";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  if (!showLabel) return;

  // Small inline label to the right, no pill background — just text with a shadow
  ctx.font = "10px/1 system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.shadowColor   = "rgba(0,0,0,0.8)";
  ctx.shadowBlur    = 3;
  ctx.fillStyle = color;
  ctx.fillText("Mean", cx + MEAN_R + 5, cy);
  ctx.shadowBlur = 0;
}

function drawMaskOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: LandmarkMaskOverlay,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  if (!overlay.mask.length || sourceWidth <= 0 || sourceHeight <= 0) return;

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = sourceWidth;
  maskCanvas.height = sourceHeight;

  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) return;

  const imageData = maskCtx.createImageData(sourceWidth, sourceHeight);
  const color = LABEL_COLORS[overlay.label] ?? "#ffffff";
  const [r, g, b] = hexToRgb(color);
  const maxPixels = Math.min(overlay.mask.length, sourceWidth * sourceHeight);

  for (let i = 0; i < maxPixels; i += 1) {
    if (overlay.mask[i] <= 0) continue;
    const offset = i * 4;
    imageData.data[offset] = r;
    imageData.data[offset + 1] = g;
    imageData.data[offset + 2] = b;
    imageData.data[offset + 3] = 92;
  }

  maskCtx.putImageData(imageData, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.drawImage(maskCanvas, 0, 0, canvasWidth, canvasHeight);
  ctx.restore();
}

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!match) return [255, 255, 255];
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

function drawFrameLabel(
  ctx: CanvasRenderingContext2D,
  current: number,
  total: number,
) {
  const text = `Frame ${current + 1} / ${total}`;
  ctx.font = "10px/1 monospace";
  const tw = ctx.measureText(text).width;

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.beginPath();
  ctx.roundRect(6, ctx.canvas.height - 20, tw + 12, 14, 3);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 12, ctx.canvas.height - 13);
}

function drawMockMri(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // Dark background
  ctx.fillStyle = "#0b0b0b";
  ctx.fillRect(0, 0, w, h);

  // Chest body
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.5, w * 0.44, h * 0.43, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#1c1c1c";
  ctx.fill();

  // Rib cage suggestion
  for (let i = 0; i < 4; i++) {
    const ry = h * (0.32 + i * 0.07);
    ctx.beginPath();
    ctx.ellipse(w * 0.5, ry, w * 0.28, h * 0.025, 0, 0, Math.PI * 2);
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // LV myocardium ring
  const lvCx = w * 0.43, lvCy = h * 0.46;
  const myoRx = w * 0.185, myoRy = h * 0.2;
  ctx.beginPath();
  ctx.ellipse(lvCx, lvCy, myoRx, myoRy, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "#4d4d4d";
  ctx.lineWidth = Math.max(6, w * 0.046);
  ctx.stroke();

  // LV cavity
  ctx.beginPath();
  ctx.ellipse(lvCx, lvCy, w * 0.12, h * 0.135, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#2c2c2c";
  ctx.fill();

  // RV (right ventricle)
  ctx.beginPath();
  ctx.moveTo(lvCx + myoRx, lvCy - h * 0.05);
  ctx.quadraticCurveTo(lvCx + w * 0.31, lvCy - h * 0.09, lvCx + w * 0.32, lvCy);
  ctx.quadraticCurveTo(lvCx + w * 0.3,  lvCy + h * 0.1,  lvCx + myoRx,   lvCy + h * 0.06);
  ctx.fillStyle = "#232323";
  ctx.strokeStyle = "#3a3a3a";
  ctx.lineWidth = 0.8;
  ctx.fill();
  ctx.stroke();

  // Spine
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.79, w * 0.055, h * 0.046, 0, 0, Math.PI * 2);
  ctx.fillStyle = "#323232";
  ctx.fill();

  // Subtle vignette
  const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.55);
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}
