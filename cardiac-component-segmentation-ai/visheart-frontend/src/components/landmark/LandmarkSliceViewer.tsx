"use client";

import React, { useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { FramePrediction, LandmarkDefinition } from "@/types/landmark";
import { LANDMARK_DEFINITIONS, getLandmarkCoord } from "@/types/landmark";

interface LandmarkSliceViewerProps {
  prediction: FramePrediction | null;
  currentFrame: number;
  totalFrames: number;
  imageDimensions: { width: number; height: number };
  frameImageUrl?: string | null;
  visibleLandmarks: Set<string>;
  showLabels?: boolean;
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
  frameImageUrl,
  visibleLandmarks,
  showLabels = true,
  className,
}: LandmarkSliceViewerProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameImgRef  = useRef<HTMLImageElement | null>(null);

  const toCanvas = useCallback(
    (coord: [number, number], cw: number, ch: number): [number, number] => {
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

      if (!prediction) return;

      const sorted = [...LANDMARK_DEFINITIONS].sort((a, b) => a.priority - b.priority);

      for (const def of sorted) {
        if (!visibleLandmarks.has(def.id)) continue;
        const coord = getLandmarkCoord(prediction, def.id);
        if (!coord) continue;

        const [cx, cy] = toCanvas(coord, cw, ch);
        drawDot(ctx, cx, cy, def, showLabels);
      }

      if (totalFrames > 0) {
        drawFrameLabel(ctx, currentFrame, totalFrames);
      }
    },
    [prediction, visibleLandmarks, showLabels, currentFrame, totalFrames, toCanvas],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) draw(canvas);
  }, [draw]);

  useEffect(() => {
    if (!frameImageUrl) {
      frameImgRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) draw(canvas);
      return;
    }
    const img = new Image();
    img.onload = () => {
      frameImgRef.current = img;
      const canvas = canvasRef.current;
      if (canvas) draw(canvas);
    };
    img.onerror = () => {
      frameImgRef.current = null;
    };
    img.src = frameImageUrl;
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
        className="block max-w-full max-h-full"
        style={{ imageRendering: "pixelated" }}
        aria-label={`MRI frame ${currentFrame + 1} of ${totalFrames}`}
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
) {
  // Outer glow
  ctx.beginPath();
  ctx.arc(cx, cy, GLOW_R, 0, Math.PI * 2);
  ctx.fillStyle = def.color + "2a";  // ~16% opacity
  ctx.fill();

  // Crosshair lines
  ctx.beginPath();
  ctx.moveTo(cx - DOT_R - CROSS_EXT, cy);
  ctx.lineTo(cx + DOT_R + CROSS_EXT, cy);
  ctx.moveTo(cx, cy - DOT_R - CROSS_EXT);
  ctx.lineTo(cx, cy + DOT_R + CROSS_EXT);
  ctx.strokeStyle = def.color + "88";  // 53% opacity
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Dot fill
  ctx.beginPath();
  ctx.arc(cx, cy, DOT_R, 0, Math.PI * 2);
  ctx.fillStyle = def.color;
  ctx.fill();

  // White border
  ctx.beginPath();
  ctx.arc(cx, cy, DOT_R, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

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
