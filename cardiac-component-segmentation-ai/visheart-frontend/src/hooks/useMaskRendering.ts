import { useMemo, useRef } from 'react';
import type { AnatomicalLabel, DrawingTool } from '@/types/segmentation';
import { LABEL_COLORS, isValidAnatomicalLabel, generateFrameSlicePrefix } from '@/types/segmentation';

interface UseMaskRenderingProps {
  decodedMasks: Record<string, Uint8Array>;
  currentFrame: number;
  currentSlice: number;
  width: number;
  height: number;
  opacity: number;
  visibleMasks: Set<AnatomicalLabel>;
  activeLabel: AnatomicalLabel;
  tool: DrawingTool;
  visibleLabelSet: Set<AnatomicalLabel>;
}

interface MaskRenderData {
  label: string;
  image: HTMLImageElement;
  color: string;
}

// Cache for color RGB values to avoid repeated hex conversions
const colorCache = new Map<string, [number, number, number]>();

// Utility function to convert hex to RGB with caching
function hexToRgb(hex: string): [number, number, number] {
  if (colorCache.has(hex)) {
    return colorCache.get(hex)!;
  }
  
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  const rgb: [number, number, number] = result ? [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16)
  ] : [0, 0, 0];
  
  colorCache.set(hex, rgb);
  return rgb;
}

export function useMaskRendering({
  decodedMasks,
  currentFrame,
  currentSlice,
  width,
  height,
  opacity,
  visibleMasks,
  activeLabel,
  tool,
  visibleLabelSet
}: UseMaskRenderingProps) {
  
  // Ref for canvas reuse to avoid creating new canvases
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Memoize frame slice prefix
  const frameSlicePrefix = useMemo(() => 
    generateFrameSlicePrefix(currentFrame, currentSlice), 
    [currentFrame, currentSlice]
  );

  // Memoize current frame masks to avoid recalculation
  const currentFrameMasks = useMemo(() => {
    if (!decodedMasks) return [];
    
    const masks: Array<[string, Uint8Array, AnatomicalLabel]> = [];
    
    for (const key in decodedMasks) {
      if (!key.startsWith(frameSlicePrefix)) continue;
      
      const maskData = decodedMasks[key];
      if (!maskData || maskData.length === 0) continue;
      
      const label = key.substring(frameSlicePrefix.length) as AnatomicalLabel;
      if (isValidAnatomicalLabel(label)) {
        masks.push([key, maskData, label]);
      }
    }
    
    return masks;
  }, [decodedMasks, frameSlicePrefix]);

  // Memoize visibility set for current tool
  const visibilitySet = useMemo(() => 
    tool === 'rectangle' ? visibleLabelSet : visibleMasks,
    [tool, visibleLabelSet, visibleMasks]
  );

  // Memoize processed mask data for rendering
  const processedMasks = useMemo(() => {
    if (currentFrameMasks.length === 0 || width === 0 || height === 0) {
      return [];
    }
    
    const maskElements: MaskRenderData[] = [];
    
    // Reuse canvas if possible
    let canvas = canvasRef.current;
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvasRef.current = canvas;
    }
    
    const ctx = canvas.getContext('2d')!;
    const imageDataBuffer = new ImageData(width, height);
    
    for (const [maskKey, maskData, label] of currentFrameMasks) {
      const isVisible = visibilitySet.has(label);
      
      if (!isVisible) continue;
      
      // Skip empty masks
      let hasPixels = false;
      for (let i = 0; i < maskData.length; i++) {
        if (maskData[i] > 0) {
          hasPixels = true;
          break;
        }
      }
      if (!hasPixels) continue;
      
      const color = LABEL_COLORS[label];
      const [r, g, b] = hexToRgb(color);
      
      // Clear image data
      imageDataBuffer.data.fill(0);
      
      // Optimized pixel writing
      const maxPixels = Math.min(maskData.length, width * height);
      const alphaValue = Math.round(255 * opacity);
      
      for (let i = 0; i < maxPixels; i++) {
        if (maskData[i] > 0) {
          const pixelIndex = i * 4;
          imageDataBuffer.data[pixelIndex] = r;
          imageDataBuffer.data[pixelIndex + 1] = g;
          imageDataBuffer.data[pixelIndex + 2] = b;
          imageDataBuffer.data[pixelIndex + 3] = alphaValue;
        }
      }
      
      ctx.putImageData(imageDataBuffer, 0, 0);
      
      // Create image with proper loading handling
      const img = new Image();
      img.src = canvas.toDataURL('image/png');
      
      maskElements.push({
        label,
        image: img,
        color
      });
    }

    // Sort masks so active mask appears last (on top)
    return maskElements.sort((a, b) => {
      if (a.label === activeLabel) return 1;
      if (b.label === activeLabel) return -1;
      return 0;
    });
  }, [currentFrameMasks, width, height, opacity, visibilitySet, activeLabel]);

  return { processedMasks };
}
