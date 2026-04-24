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
  /** ⚠️ INTEGRATION POINT: Pass real frame image URL here in Sprint 2 W2 D3 */
  frameImageUrl?: string | null;
  visibleLandmarks: Set<string>;
  className?: string;
}

// Dot radius in canvas pixels
const DOT_RADIUS = 6;
const ACTIVE_RING_RADIUS = 10;

export const LandmarkSliceViewer = React.memo(function LandmarkSliceViewer({
  prediction,
  currentFrame,
  totalFrames,
  imageDimensions,
  frameImageUrl,
  visibleLandmarks,
  className,
}: LandmarkSliceViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const scaleCoord = useCallback(
    (coord: [number, number], canvas: HTMLCanvasElement): [number, number] => {
      const sx = canvas.width / imageDimensions.width;
      const sy = canvas.height / imageDimensions.height;
      return [Math.round(coord[0] * sx), Math.round(coord[1] * sy)];
    },
    [imageDimensions],
  );

  const drawFrame = useCallback(
    (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw background 
      if (imageRef.current) {
        ctx.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);
      } else {
        drawMockMri(ctx, canvas.width, canvas.height);
      }

      // Draw landmarks 
      if (!prediction) return;

      const sorted = [...LANDMARK_DEFINITIONS].sort(
        (a, b) => b.priority - a.priority,
      );

      for (const def of sorted) {
        if (!visibleLandmarks.has(def.id)) continue;
        const coord = getLandmarkCoord(prediction, def.id);
        if (!coord) continue;

        const [cx, cy] = scaleCoord(coord, canvas);
        drawLandmarkDot(ctx, cx, cy, def);
      }
    },
    [prediction, visibleLandmarks, scaleCoord],
  );

  // Load real frame image when URL changes
  useEffect(() => {
    if (!frameImageUrl) {
      imageRef.current = null;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) drawFrame(ctx, canvas);
      return;
    }
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawFrame(ctx, canvas);
    };
    img.onerror = () => {
      console.error("[LandmarkSliceViewer] Failed to load frame image:", frameImageUrl);
      imageRef.current = null;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) drawFrame(ctx, canvas);
    };
    img.src = frameImageUrl;
  }, [frameImageUrl, drawFrame]);

  // Re-draw whenever prediction or visibility changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawFrame(ctx, canvas);
  }, [drawFrame]);

  // Resize canvas to fill container while maintaining aspect ratio
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const observer = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = container;
      const aspectRatio = imageDimensions.width / imageDimensions.height;

      let w = clientWidth;
      let h = w / aspectRatio;
      if (h > clientHeight) {
        h = clientHeight;
        w = h * aspectRatio;
      }

      canvas.width = Math.round(w);
      canvas.height = Math.round(h);

      const ctx = canvas.getContext("2d");
      if (ctx) drawFrame(ctx, canvas);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [imageDimensions, drawFrame]);

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
        className="block"
        style={{ imageRendering: "pixelated" }}
      />

      {/* Frame info overlay */}
      <div className="absolute bottom-2 left-2 flex items-center gap-2 pointer-events-none">
        <span className="text-[10px] text-white/60 font-mono bg-black/40 px-1.5 py-0.5 rounded">
          Frame {currentFrame + 1} / {totalFrames}
        </span>
      </div>
    </div>
  );
});

// Drawing helpers 

function drawLandmarkDot(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  def: LandmarkDefinition,
) {
  // Outer glow ring
  ctx.beginPath();
  ctx.arc(cx, cy, ACTIVE_RING_RADIUS, 0, 2 * Math.PI);
  ctx.fillStyle = def.color + "33"; // 20% opacity
  ctx.fill();

  // Filled dot
  ctx.beginPath();
  ctx.arc(cx, cy, DOT_RADIUS, 0, 2 * Math.PI);
  ctx.fillStyle = def.color;
  ctx.fill();

  // White border
  ctx.beginPath();
  ctx.arc(cx, cy, DOT_RADIUS, 0, 2 * Math.PI);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Cross-hair lines
  ctx.beginPath();
  ctx.moveTo(cx - DOT_RADIUS - 3, cy);
  ctx.lineTo(cx + DOT_RADIUS + 3, cy);
  ctx.moveTo(cx, cy - DOT_RADIUS - 3);
  ctx.lineTo(cx, cy + DOT_RADIUS + 3);
  ctx.strokeStyle = def.color + "99";
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

/**
 * ⚠️ Mock MRI background — replaces real frame until backend is wired.
 */
function drawMockMri(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
) {
  // Background
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, w, h);

  const cx = w * 0.43, cy = h * 0.46;

  // Chest body oval
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, w * 0.44, h * 0.42, 0, 0, 2 * Math.PI);
  ctx.fillStyle = "#1a1a1a";
  ctx.fill();

  // LV myocardium ring
  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.187, h * 0.2, 0, 0, 2 * Math.PI);
  ctx.lineWidth = Math.max(8, w * 0.048);
  ctx.strokeStyle = "#4a4a4a";
  ctx.stroke();

  // LV cavity
  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.125, h * 0.141, 0, 0, 2 * Math.PI);
  ctx.fillStyle = "#2a2a2a";
  ctx.fill();

  // RV
  ctx.beginPath();
  ctx.moveTo(cx + w * 0.187, cy - h * 0.05);
  ctx.quadraticCurveTo(
    cx + w * 0.3, cy - h * 0.1,
    cx + w * 0.32, cy,
  );
  ctx.quadraticCurveTo(
    cx + w * 0.3, cy + h * 0.12,
    cx + w * 0.187, cy + h * 0.06,
  );
  ctx.fillStyle = "#222222";
  ctx.strokeStyle = "#3a3a3a";
  ctx.lineWidth = 0.8;
  ctx.fill();
  ctx.stroke();

  // Spine ellipse
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.79, w * 0.055, h * 0.046, 0, 0, 2 * Math.PI);
  ctx.fillStyle = "#333333";
  ctx.fill();

  // Subtle grid lines
  ctx.strokeStyle = "#ffffff08";
  ctx.lineWidth = 0.5;
  for (let x = 0; x < w; x += w / 8) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += h / 8) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}
