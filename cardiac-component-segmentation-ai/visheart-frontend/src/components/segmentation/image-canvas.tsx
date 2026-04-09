"use client";

import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { Stage, Layer, Line, Image as KonvaImage, Rect } from "react-konva";
import { Play, Loader2, RotateCcw } from "lucide-react";
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from "lucide-react";
import type { KonvaEventObject } from "konva/lib/Node";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { decodeSegmentationMasks } from "@/lib/decode-RLE";
import { cn } from "@/lib/utils";
import { useMaskRendering } from "@/hooks/useMaskRendering";

// Import shared types and constants
import type { ImageCanvasProps, AnatomicalLabel } from "@/types/segmentation";
import { 
  LABEL_COLORS, 
  LABEL_NAMES,
  PERFORMANCE_CONSTANTS 
} from "@/types/segmentation";

// Import tar cache for background images
import { tarImageCache } from "@/lib/tar-image-cache";
import { useProject } from "@/context/ProjectContext";
import { segmentationApi } from "@/lib/api";

// Memoized Navigation Controls Component
const NavigationControls = memo(({ 
  currentFrame, 
  currentSlice, 
  totalFrames, 
  totalSlices, 
  onFrameChange, 
  onSliceChange 
}: {
  currentFrame: number;
  currentSlice: number;
  totalFrames: number;
  totalSlices: number;
  onFrameChange: (frame: number) => void;
  onSliceChange: (slice: number) => void;
}) => (
  <div className="w-full mb-4 p-4 bg-muted rounded-lg shadow-md">
    <div className="grid grid-cols-2 gap-8">
      {/* Frame Controls */}
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
              onChange={e => {
                let val = Number(e.target.value);
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
      {/* Slice Controls */}
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
              onChange={e => {
                let val = Number(e.target.value);
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
));

NavigationControls.displayName = 'NavigationControls';

export function ImageCanvas({
  projectData,
  decodedMasks,
  onMaskUpdate,
  currentFrame,
  currentSlice,
  onFrameChange,
  onSliceChange,
  width,
  height,
  canvasWidth,
  canvasHeight,
  activeLabel,
  visibleMasks,
  tool,
  brushSize,
  opacity,
  zoomLevel = 1,
  setZoomLevel,
  resetTrigger,
}: ImageCanvasProps) {
  // Get image loading method from ProjectContext
  const { getMRIImage, getMRIImageFilename, tarCacheReady, tarCacheError } = useProject();

  // Browser state management for manual segmentation
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageStatus, setImageStatus] = useState<"loading" | "loaded" | "error">("loading");
  const [drawingPoints, setDrawingPoints] = useState<number[] | null>(null);
  const [imageLoadMethod, setImageLoadMethod] = useState<"tar" | "api" | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState<boolean>(true); // Track if this is the first image load
  
  // Bounding box state for manual segmentation
  const [isDrawingRect, setIsDrawingRect] = useState(false);
  const [rectStart, setRectStart] = useState<{ x: number; y: number } | null>(null);
  const [currentRect, setCurrentRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [finalBoundingBox, setFinalBoundingBox] = useState<number[] | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<AnatomicalLabel>(activeLabel);
  const [visibleLabelSet, setVisibleLabelSet] = useState<Set<AnatomicalLabel>>(new Set([activeLabel]));
  const [isSegmentationLoading, setIsSegmentationLoading] = useState(false);

  // Refs for performance
  const stageRef = useRef<any>(null);
  const isDrawing = useRef(false);
  const [stageScale, setStageScale] = useState<number>(Math.min(Math.max(zoomLevel || 1, 0.1), 10));
  const [stagePosition, setStagePosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Container pan (move whole stage by dragging the wrapper) — preferred for
  // Debug-like behavior: panning moves the viewer instead of moving image coordinates inside the canvas.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasAreaRef = useRef<HTMLDivElement | null>(null);
  const infoBarRef = useRef<HTMLDivElement | null>(null);
  const isContainerPanning = useRef(false);
  const lastContainerPoint = useRef<{ x: number; y: number } | null>(null);
  const [isCtrlPressed, setIsCtrlPressed] = useState(false);
  const [isPanningState, setIsPanningState] = useState(false);
  const [isZoomKeyPressed, setIsZoomKeyPressed] = useState(false);
  const [isResetKeyPressed, setIsResetKeyPressed] = useState(false);

  const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
    // Allow left-click (0) with pan tool/Ctrl OR right-click (2) for panning
    const isLeftClick = e.button === 0;
    const isRightClick = e.button === 2;
    
    if (isRightClick) {
      // Right-click always enables panning
      isContainerPanning.current = true;
      setIsPanningState(true);
      if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
      lastContainerPoint.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    
    if (!isLeftClick) return;
    
    // Left-click: Allow panning when tool is 'pan' OR when user holds Ctrl
    if (tool !== 'pan' && !isCtrlPressed) return;
    isContainerPanning.current = true;
    setIsPanningState(true);
    // Set cursor on the container element immediately for instant feedback
    if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
    lastContainerPoint.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
    e.stopPropagation();
  }, [tool, isCtrlPressed]);

  const handleContainerMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isContainerPanning.current || !lastContainerPoint.current) return;
    const dx = e.clientX - lastContainerPoint.current.x;
    const dy = e.clientY - lastContainerPoint.current.y;
    setStagePosition(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    lastContainerPoint.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleContainerMouseUp = useCallback(() => {
    isContainerPanning.current = false;
    setIsPanningState(false);
    lastContainerPoint.current = null;
    // Restore cursor depending on whether ctrl is pressed or tool is pan
    if (containerRef.current) {
      containerRef.current.style.cursor = (isCtrlPressed || tool === 'pan') ? 'grab' : 'default';
    }
  }, [isCtrlPressed, tool]);

  // Track key states for visual feedback (Ctrl for pan, +/- for zoom, R for reset)
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      // Track Ctrl key for pan feedback
      if (ev.key === 'Control' || ev.ctrlKey) {
        if (!isCtrlPressed) setIsCtrlPressed(true);
      }
      // Track zoom keys for zoom feedback
      if (ev.key === '+' || ev.key === '=' || ev.key === '-' || ev.key === '_') {
        if (!isZoomKeyPressed) setIsZoomKeyPressed(true);
      }
      // Track reset key for reset feedback
      if (ev.key === 'r' || ev.key === 'R') {
        if (!isResetKeyPressed) setIsResetKeyPressed(true);
      }
    };

    const onKeyUp = (ev: KeyboardEvent) => {
      // Release Ctrl key
      if (ev.key === 'Control' || !ev.ctrlKey) {
        if (isCtrlPressed) setIsCtrlPressed(false);
      }
      // Release zoom keys
      if (ev.key === '+' || ev.key === '=' || ev.key === '-' || ev.key === '_') {
        if (isZoomKeyPressed) setIsZoomKeyPressed(false);
      }
      // Release reset key
      if (ev.key === 'r' || ev.key === 'R') {
        if (isResetKeyPressed) setIsResetKeyPressed(false);
      }
    };

    const onWindowBlur = () => {
      // Reset all key states on window blur
      if (isCtrlPressed) setIsCtrlPressed(false);
      if (isZoomKeyPressed) setIsZoomKeyPressed(false);
      if (isResetKeyPressed) setIsResetKeyPressed(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [isCtrlPressed, isZoomKeyPressed, isResetKeyPressed]);

  // Keep the container cursor in sync whenever ctrl/tool/panning state changes
  useEffect(() => {
    if (!containerRef.current) return;
    if (isPanningState) {
      containerRef.current.style.cursor = 'grabbing';
    } else if (isCtrlPressed || tool === 'pan') {
      containerRef.current.style.cursor = 'grab';
    } else {
      containerRef.current.style.cursor = 'default';
    }
  }, [isCtrlPressed, tool, isPanningState]);

  // Visual display size (responsive container sizing)
  // Uses canvasWidth/canvasHeight props if provided, otherwise responsive
  const displayWidth = canvasWidth ?? 1000;
  const displayHeight = canvasHeight ?? 550;

  // Get actual container dimensions for responsive Stage sizing
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: displayWidth,
    height: displayHeight
  });

  // Update container size when container ref is available
  useEffect(() => {
    if (canvasAreaRef.current && infoBarRef.current) {
      const updateSize = () => {
        if (canvasAreaRef.current && infoBarRef.current) {
          const canvasRect = canvasAreaRef.current.getBoundingClientRect();
          setContainerSize({
            width: canvasRect.width,
            height: canvasRect.height
          });
        }
      };

      // Initial size
      updateSize();

      // Set up ResizeObserver for responsive updates
      const resizeObserver = new ResizeObserver(updateSize);
      resizeObserver.observe(canvasAreaRef.current);

      return () => {
        resizeObserver.disconnect();
      };
    }
  }, [displayWidth, displayHeight]);

  // Compute a fit scale (kept for possible future use). By default we will
  // render the image at its original logical size and only change stageScale
  // according to `zoomLevel` so annotations remain 1:1 with image pixels.
  const baseFitScale = useMemo(() => {
    if (!width || !height || !containerSize.width || !containerSize.height) return 1;
    return Math.min(containerSize.width / width, containerSize.height / height);
  }, [width, height, containerSize.width, containerSize.height]);

  // Memoized values from project data
  const { totalFrames, totalSlices } = useMemo(() => ({
    totalFrames: projectData.dimensions?.frames || 1,
    totalSlices: projectData.dimensions?.slices || 1,
  }), [projectData.dimensions]);

  // Keyboard shortcut handling for frame/slice navigation and zoom
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only trigger if not focused on input/textarea/select
      const tag = (event.target as HTMLElement)?.tagName?.toLowerCase();
      if (["input", "textarea", "select"].includes(tag)) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (currentFrame > 0) onFrameChange(currentFrame - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (currentFrame < totalFrames - 1) onFrameChange(currentFrame + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (currentSlice > 0) onSliceChange(currentSlice - 1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        if (currentSlice < totalSlices - 1) onSliceChange(currentSlice + 1);
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        // Zoom in
        const currentScale = stageScale || 1;
        const newScale = Math.min(10, currentScale * 1.2);
        setStageScale(newScale);
        const stage = stageRef.current?.getStage?.();
        if (stage) {
          stage.scale({ x: newScale, y: newScale });
          stage.batchDraw();
          if (setZoomLevel) {
            setZoomLevel(newScale);
          }
        }
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        // Zoom out
        const currentScale = stageScale || 1;
        const newScale = Math.max(0.1, currentScale * 0.8);
        setStageScale(newScale);
        const stage = stageRef.current?.getStage?.();
        if (stage) {
          stage.scale({ x: newScale, y: newScale });
          stage.batchDraw();
          if (setZoomLevel) {
            setZoomLevel(newScale);
          }
        }
      } else if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        // Reset zoom and position
        const stage = stageRef.current?.getStage?.();
        if (!stage) return;

        // Reset zoom to 1
        const newScale = 1;
        stage.scale({ x: newScale, y: newScale });
        setStageScale(newScale);

        // Center the canvas using actual image dimensions for proper positioning
        const logicalW = width || 1000;
        const logicalH = height || 550;
        const offsetX = Math.max(0, ((containerSize.width || 1000) - logicalW * newScale) / 2);
        const offsetY = Math.max(0, ((containerSize.height || 550) - logicalH * newScale) / 2);
        stage.position({ x: offsetX, y: offsetY });
        setStagePosition({ x: offsetX, y: offsetY });
        stage.batchDraw();

        // Update zoom level prop
        if (setZoomLevel) {
          setZoomLevel(1);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentFrame, currentSlice, totalFrames, totalSlices, onFrameChange, onSliceChange, stageScale, setZoomLevel, width, height, containerSize.width, containerSize.height]);

  // Sync selected label and visibleLabelSet when tool changes or active label changes
  useEffect(() => {
    if (tool === "rectangle") {
      setSelectedLabel(activeLabel);
      setVisibleLabelSet(new Set([activeLabel]));
    }
    
    if (typeof zoomLevel === 'number') {
      const clamped = Math.min(Math.max(zoomLevel, 0.1), 10);
      const applied = clamped; // do not multiply by baseFitScale
      setStageScale(applied);
      const stage = stageRef.current;
      if (stage && stage.getStage) {
        const konvaStage = stage.getStage();

        konvaStage.scale({ x: applied, y: applied });
        konvaStage.batchDraw();
      }
    }
  }, [activeLabel, tool, zoomLevel]);

  // Initialize stage scale and center content inside the visual display area
  // Only run on mount or when canvas dimensions change, not during zoom interactions
  useEffect(() => {
    const stage = stageRef.current?.getStage?.();
    if (!stage) return;

    const zoom = typeof zoomLevel === 'number' ? Math.min(Math.max(zoomLevel, 0.1), 10) : 1;
    const newScale = zoom; // keep image at original size when zoom === 1
    stage.scale({ x: newScale, y: newScale });
    setStageScale(newScale);

    const logicalW = width || 1000;
    const logicalH = height || 550;

    // Center the logical image inside the larger display canvas
    const offsetX = Math.max(0, ((containerSize.width || 1000) - logicalW * newScale) / 2);
    const offsetY = Math.max(0, ((containerSize.height || 550) - logicalH * newScale) / 2);
    stage.position({ x: offsetX, y: offsetY });
    setStagePosition({ x: offsetX, y: offsetY });
    stage.batchDraw();
  }, [baseFitScale, containerSize.width, containerSize.height, width, height]); 
  
  // Handle reset trigger - reset both zoom and position
  useEffect(() => {
    if (resetTrigger !== undefined && resetTrigger > 0) {
      const stage = stageRef.current?.getStage?.();
      if (!stage) return;

      // Reset zoom to 1
      const newScale = 1;
      stage.scale({ x: newScale, y: newScale });
      setStageScale(newScale);

      // Center the canvas using actual image dimensions for proper positioning
      const logicalW = width || 1000;
      const logicalH = height || 550;
      const offsetX = Math.max(0, ((containerSize.width || 1000) - logicalW * newScale) / 2);
      const offsetY = Math.max(0, ((containerSize.height || 550) - logicalH * newScale) / 2);
      stage.position({ x: offsetX, y: offsetY });
      setStagePosition({ x: offsetX, y: offsetY });
      stage.batchDraw();

      // Update zoom level prop
      if (setZoomLevel) {
        setZoomLevel(1);
      }
    }
  }, [resetTrigger, width, height, containerSize.width, containerSize.height, setZoomLevel]); 
  
  // Clear bounding box when frame/slice changes to prevent confusion
  useEffect(() => {
    setFinalBoundingBox(null);
    setCurrentRect(null);
    setIsDrawingRect(false);
  }, [currentFrame, currentSlice]);
  
  // Image loading with tar cache and API fallback
  useEffect(() => {
    if (!projectData.projectId) return;

    const loadImageWithFallback = async () => {
      // Only show loading spinner on initial load or when there's no current image
      if (isInitialLoad || !image) {
        setImageStatus("loading");
      }
      
      let imageLoaded = false;

      // Method 1: Try loading from tar cache (if ready and available)
      if (tarCacheReady && !tarCacheError) {
        try {
          console.log(`[ImageCanvas] Attempting to load from tar cache: frame ${currentFrame}, slice ${currentSlice}`);
          const imageUrl = await getMRIImage(currentFrame, currentSlice);
          
          if (imageUrl) {
            const img = new window.Image();
            img.crossOrigin = "anonymous"; // For tar cache images
            img.src = imageUrl;
            
            try {
              await new Promise<void>((resolve, reject) => {
                const timeoutId = setTimeout(() => reject("Tar cache timeout"), 5000);
                
                img.onload = () => {
                  clearTimeout(timeoutId);
                  setImage(img);
                  setImageStatus("loaded");
                  setImageLoadMethod("tar");
                  setIsInitialLoad(false); // Mark initial load as complete
                  imageLoaded = true;
                  console.log(`[ImageCanvas] Successfully loaded from tar cache: frame ${currentFrame}, slice ${currentSlice}`);
                  resolve();
                };
                
                img.onerror = () => {
                  clearTimeout(timeoutId);
                  reject("Failed to load tar image");
                };
              });
            } catch (loadError) {
              console.log(`[ImageCanvas] Tar cache image loading failed:`, loadError);
            }
          } else {
            console.log(`[ImageCanvas] No image URL found in tar cache for frame ${currentFrame}, slice ${currentSlice}`);
          }
        } catch (error) {
          console.log(`[ImageCanvas] Tar cache loading failed, falling back to API:`, error);
        }
      } else if (tarCacheError) {
        console.log(`[ImageCanvas] Skipping tar cache due to error: ${tarCacheError}`);
      } else {
        console.log(`[ImageCanvas] Tar cache not ready yet (${tarCacheReady}), falling back to API`);
      }

      // Method 2: Fallback to API loading (if tar cache failed or not available)
      if (!imageLoaded) {
        try {
          console.log(`[ImageCanvas] Loading from API: frame ${currentFrame}, slice ${currentSlice}`);
          const img = new window.Image();
          img.crossOrigin = "use-credentials"; // For API images
          img.src = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000'}/api/projects/${projectData.projectId}/images/frame_${currentFrame}_slice_${currentSlice}.jpeg`;
          
          await new Promise<void>((resolve, reject) => {
            const timeoutId = setTimeout(() => reject("API timeout"), PERFORMANCE_CONSTANTS?.IMAGE_LOAD_TIMEOUT_MS || 10000);
            
            img.onload = () => {
              clearTimeout(timeoutId);
              setImage(img);
              setImageStatus("loaded");
              setImageLoadMethod("api");
              setIsInitialLoad(false); // Mark initial load as complete
              console.log(`[ImageCanvas] Successfully loaded from API: frame ${currentFrame}, slice ${currentSlice}`);
              resolve();
            };
            
            img.onerror = () => {
              clearTimeout(timeoutId);
              reject("API load failed");
            };
          });
        } catch (error) {
          console.error(`[ImageCanvas] Both tar cache and API loading failed:`, error);
          setImageStatus("error");
          setImageLoadMethod(null);
        }
      }
    };

    loadImageWithFallback().catch((error) => {
      console.error(`[ImageCanvas] Image loading error:`, error);
      setImageStatus("error");
      setImageLoadMethod(null);
    });
  }, [projectData.projectId, currentFrame, currentSlice, tarCacheReady, tarCacheError, isInitialLoad, getMRIImage]);

  // Additional effect to reload image when tar cache becomes ready (for initial load)
  useEffect(() => {
    if (tarCacheReady && imageStatus === "loading" && !image) {
      console.log(`[ImageCanvas] Tar cache became ready, triggering image reload`);
    }
  }, [tarCacheReady, imageStatus, image]);

  // Optimized drawing handlers with useCallback
  const getRelativePointerPosition = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !stage.getStage) return null;
    const konvaStage = stage.getStage();
    const pos = konvaStage.getPointerPosition();
    if (!pos) return null;
    // Use absolute transform to convert screen coords to stage (untransformed) coords
    const transform = konvaStage.getAbsoluteTransform().copy();
    transform.invert();
    const transformed = transform.point({ x: pos.x, y: pos.y });
    return transformed;
  }, []);

  // Debounced zoom level synchronization to prevent lag during smooth zooming
  const syncZoomLevel = useCallback(
    (() => {
      let timeoutId: NodeJS.Timeout;
      return (scale: number) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          if (typeof setZoomLevel === 'function') {
            try {
              setZoomLevel(scale);
            } catch (err) {}
          }
        }, 150); // Small delay to ensure smooth animation completes
      };
    })(),
    [setZoomLevel]
  );

  // Wheel zoom handler (cursor-centered) and pan (draggable stage) helpers
  const handleWheel = useCallback((e: any) => {
    // e is a Konva event wrapper
    const stage = stageRef.current?.getStage?.();
    if (!stage) return;
    e.evt.preventDefault();

    const oldScale = stage.scaleX() || 1;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const scaleBy = e.evt.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(10, oldScale * scaleBy));

    // Smooth zoom animation using requestAnimationFrame
    let animationFrame: number;
    const animateZoom = (from: number, to: number, steps = 8, step = 1) => {
      const nextScale = from + (to - from) * (step / steps);
      stage.scale({ x: nextScale, y: nextScale });
      setStageScale(nextScale);
      // adjust position so the point under the mouse stays in the same place
      const newPos = {
        x: pointer.x - mousePointTo.x * nextScale,
        y: pointer.y - mousePointTo.y * nextScale,
      };
      stage.position(newPos);
      setStagePosition(newPos);
      stage.batchDraw();

      if (step < steps) {
        animationFrame = window.requestAnimationFrame(() => animateZoom(from, to, steps, step + 1));
      } else {
        // Use debounced zoom level synchronization to prevent lag
        syncZoomLevel(to);
      }
    };
    animateZoom(oldScale, newScale);
  }, [syncZoomLevel]);

  const handleMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;

    // If the container is handling panning (either via pan tool or Ctrl),
    // prevent starting any drawing gesture on the Konva stage.
    if (isContainerPanning.current || tool === 'pan' || isCtrlPressed) {
      isDrawing.current = false;
      setDrawingPoints(null);
      return;
    }

    const pos = getRelativePointerPosition();
    if (!pos) return;

    if (tool === "rectangle") {
      // Start drawing rectangle
      setIsDrawingRect(true);
      setRectStart({ x: pos.x, y: pos.y });
      setCurrentRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
      setFinalBoundingBox(null);
    } else if (tool !== "select") {
      // Existing brush/eraser logic
      isDrawing.current = true;
      setDrawingPoints([pos.x, pos.y]);
    }
  }, [tool, getRelativePointerPosition]);

  const handleMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
  const point = getRelativePointerPosition();
  if (!point) return;

  // Skip drawing updates when container panning is active or when Ctrl-to-pan
  if (isContainerPanning.current || isCtrlPressed || tool === 'pan') return;

  if (tool === "rectangle" && isDrawingRect && rectStart) {
      // Update rectangle dimensions
      const width = point.x - rectStart.x;
      const height = point.y - rectStart.y;
      setCurrentRect({
        x: width >= 0 ? rectStart.x : point.x,
        y: height >= 0 ? rectStart.y : point.y,
        width: Math.abs(width),
        height: Math.abs(height)
      });
  } else if (!isDrawing.current || tool === "select" || tool === "rectangle") {
      return;
    } else {
      // Existing brush/eraser logic
      setDrawingPoints(prev => prev ? [...prev, point.x, point.y] : [point.x, point.y]);
    }
  }, [tool, getRelativePointerPosition, isDrawingRect, rectStart]);

  // Optimized Bresenham drawing algorithm
  const drawBrushStroke = useCallback((
    mask: Uint8Array, 
    maskWidth: number, 
    maskHeight: number, 
    points: number[], 
    size: number, 
    labelValue: number
  ) => {
    const radius = size / 2;
    const radiusSquared = radius * radius;

    for (let i = 2; i < points.length; i += 2) {
      const x0 = Math.round(points[i - 2]);
      const y0 = Math.round(points[i - 1]);
      const x1 = Math.round(points[i]);
      const y1 = Math.round(points[i + 1]);
      
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      let x = x0;
      let y = y0;
      
      while (true) {
        const minX = Math.max(0, x - Math.floor(radius));
        const maxX = Math.min(maskWidth - 1, x + Math.floor(radius));
        const minY = Math.max(0, y - Math.floor(radius));
        const maxY = Math.min(maskHeight - 1, y + Math.floor(radius));
        
        for (let py = minY; py <= maxY; py++) {
          for (let px = minX; px <= maxX; px++) {
            const dx = px - x;
            const dy = py - y;
            
            if (dx * dx + dy * dy <= radiusSquared) {
              mask[py * maskWidth + px] = labelValue;
            }
          }
        }
        
        if (x === x1 && y === y1) break;
        
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
    }
  }, []);

  // Manual segmentation with editable masks - apply edits directly to decodedMasks
  const handleMouseUp = useCallback(() => {
    // If panning was active, don't finalize any drawing stroke
    if (isContainerPanning.current || isCtrlPressed || tool === 'pan') {
      isDrawing.current = false;
      setDrawingPoints(null);
      return;
    }

    if (tool === "rectangle" && isDrawingRect && currentRect) {
      // Finalize rectangle - convert to bounding box format [x_min, y_min, x_max, y_max]
      const bbox = [
        Math.round(currentRect.x),
        Math.round(currentRect.y),
        Math.round(currentRect.x + currentRect.width),
        Math.round(currentRect.y + currentRect.height)
      ];
      setFinalBoundingBox(bbox);
      setIsDrawingRect(false);
      console.log('Bounding box created:', bbox);
      
      // Automatically start segmentation with explicit frame/slice to avoid stale closure
      startManualSegmentation(selectedLabel, bbox, currentFrame, currentSlice);
      return;
    }
    
    // Existing brush/eraser logic
    if (!isDrawing.current || !drawingPoints) return;

    isDrawing.current = false;

    try {
      const editableMaskKey = `editable_frame_${currentFrame}_slice_${currentSlice}_${activeLabel}`;
      
      // Get existing mask or create new empty one
      const existingMask = decodedMasks[editableMaskKey];
      const newMask = existingMask ? new Uint8Array(existingMask) : new Uint8Array(height * width);
      const labelValue = tool === "eraser" ? 0 : 1;
      
      // Apply brush stroke to mask
      drawBrushStroke(newMask, width, height, drawingPoints, brushSize, labelValue);
      
      // Update decodedMasks directly - no local state needed
      const updatedMasks = { ...decodedMasks, [editableMaskKey]: newMask };
      onMaskUpdate(updatedMasks, tool as 'brush' | 'eraser');
      
    } catch (error) {
      console.error('[ImageCanvas] Error during brush stroke:', error);
    } finally {
      setDrawingPoints(null);
    }
  }, [
    tool, isDrawingRect, currentRect,
    drawingPoints, currentFrame, currentSlice, activeLabel, 
    width, height, brushSize, drawBrushStroke, 
    onMaskUpdate, decodedMasks
  ]);

  // Manual segmentation function
  const startManualSegmentation = useCallback(async (
    selectedLabel: AnatomicalLabel, 
    bbox?: number[], 
    frameOverride?: number, 
    sliceOverride?: number
  ) => {
    const boundingBox = bbox || finalBoundingBox;
    const useFrame = frameOverride ?? currentFrame;
    const useSlice = sliceOverride ?? currentSlice;
   
    if (!boundingBox || !projectData.projectId) {
      console.error('No bounding box or project ID available');
      alert('No bounding box or project ID available');
      return;
    }

    // Validate bounding box coordinates
    if (boundingBox.length !== 4) {
      console.error('Invalid bounding box format:', boundingBox);
      alert('Invalid bounding box format');
      return;
    }

    const [rawXMin, rawYMin, rawXMax, rawYMax] = boundingBox;
    const x_min = Math.max(0, Math.min(rawXMin, width - 1));
    const y_min = Math.max(0, Math.min(rawYMin, height - 1));
    const x_max = Math.max(0, Math.min(rawXMax, width - 1));
    const y_max = Math.max(0, Math.min(rawYMax, height - 1));
    const clampedBoundingBox: [number, number, number, number] = [
      Math.min(x_min, x_max),
      Math.min(y_min, y_max),
      Math.max(x_min, x_max),
      Math.max(y_min, y_max),
    ];

    // Final validation after clamping
    if (
      clampedBoundingBox[2] <= clampedBoundingBox[0] ||
      clampedBoundingBox[3] <= clampedBoundingBox[1]
    ) {
      console.error("[Segmentation] Invalid bounding box after clamping:", {
        original: boundingBox,
        clamped: clampedBoundingBox,
        width,
        height,
      });
      alert("Invalid bounding box coordinates");
      return;
    }

    console.log("[Segmentation] Bounding box accepted:", {
      original: boundingBox,
      clamped: clampedBoundingBox,
    });

    try {
      setIsSegmentationLoading(true);
      console.log('Starting manual segmentation with:');
      console.log('- Project ID:', projectData.projectId);
      console.log('- Bounding box:', boundingBox);
      console.log('- Current frame (override):', useFrame);
      console.log('- Current slice (override):', useSlice);
      console.log('- Selected label:', selectedLabel);
      
      // Get the actual filename from the tar cache using explicit frame/slice
      let imageName: string;
      
      if (tarCacheReady) {
        const actualFilename = await getMRIImageFilename(useFrame, useSlice);
        if (actualFilename) {
          imageName = actualFilename;
          console.log('- Using actual filename from tar cache:', imageName);
        } else {
          // Fallback to constructed filename using format that backend can parse
          // Backend expects: something_frameNumber_sliceNumber.jpg
          imageName = `image_${useFrame}_${useSlice}.jpg`;
          console.log('- Tar cache filename not found, using fallback:', imageName);
        }
      } else {
        // Fallback to constructed filename when tar cache isn't ready  
        // Backend expects: something_frameNumber_sliceNumber.jpg
        imageName = `image_${useFrame}_${useSlice}.jpg`;
        console.log('- Tar cache not ready, using fallback filename:', imageName);
      }
            
      const requestData = {
        image_name: imageName,
        bbox: clampedBoundingBox,
        segmentationName: `Manual ${LABEL_NAMES[selectedLabel]} - Frame ${useFrame + 1}, Slice ${useSlice + 1}`,
        segmentationDescription: `User-drawn bounding box segmentation for ${LABEL_NAMES[selectedLabel]}`
      };
      
      console.log("[Segmentation] Request payload:", requestData);
      console.log('Making API call to startManualSegmentation...');
      console.log(`Filename format check: "${imageName}" should parse to frame=${useFrame}, slice=${useSlice}`);
      
      const response = await segmentationApi.startManualSegmentation(
        projectData.projectId,
        requestData
      );
      
      console.log('Manual segmentation response:', response);
      console.log('Response type:', typeof response);
      console.log('Response segmentations:', response?.segmentations);

      // Defensive check for response and segmentations
      if (!response || !Array.isArray(response.segmentations) || response.segmentations.length === 0) {
        console.error("Manual segmentation API returned undefined or missing segmentations:", response);
        alert('No segmentation results returned from server');
        return;
      } 

      // Decode the new mask(s)
      const newMasks = response.segmentations;

      if (projectData?.dimensions) {
        const decodedResult = decodeSegmentationMasks(
          newMasks,
          projectData.dimensions.width,
          projectData.dimensions.height
        );

        console.log('Decoded new masks:', Object.keys(decodedResult.masks));

          // Remap manual mask key to selected anatomical label if needed
          // Use explicit frame/slice to ensure consistency
          const manualKey = `editable_frame_${useFrame}_slice_${useSlice}_manual`;
          const labelKey = `editable_frame_${useFrame}_slice_${useSlice}_${selectedLabel}`;
          const masksToUpdate = { ...decodedResult.masks };
          if (manualKey in masksToUpdate) {
            masksToUpdate[labelKey] = masksToUpdate[manualKey];
            delete masksToUpdate[manualKey];
          }
          
          console.log(`Manual segmentation: Remapping ${manualKey} to ${labelKey}`);
          console.log('Masks being updated:', Object.keys(masksToUpdate));
          
          // Merge with existing masks
          onMaskUpdate({ ...decodedMasks, ...masksToUpdate }, undefined);

        // Clear the bounding box after successful submission
        setFinalBoundingBox(null);
        setCurrentRect(null);

      } else {
        console.error('Project dimensions not available for decoding');
        alert('Project dimensions not available for decoding masks');
      }
    } catch (error: any) {
      console.error('Error starting manual segmentation:', error);
      console.error('Error response:', error.response?.data);
      console.error('Error status:', error.response?.status);
      console.error('Error headers:', error.response?.headers);
      
      const errorMessage = error.response?.data?.message || error.response?.data?.detail?.detail || error.message || 'Unknown error occurred';
      alert(`Error starting manual segmentation: ${errorMessage}\n\nCheck console for more details.`);
    } finally {
      setIsSegmentationLoading(false);
    }
  }, [projectData.projectId, finalBoundingBox, tarCacheReady, getMRIImageFilename, decodedMasks, onMaskUpdate, projectData.dimensions, currentFrame, currentSlice]);

  // Use optimized mask rendering hook
  const { processedMasks } = useMaskRendering({
    decodedMasks,
    currentFrame,
    currentSlice,
    visibleMasks,
    activeLabel,
    tool,
    visibleLabelSet,
    width,
    height,
    opacity
  });

  // Debug logging for optimization verification (development only)
  if (process.env.NODE_ENV === 'development') {
    console.log(`[ImageCanvas] Using optimized mask rendering hook - found ${processedMasks.length} processed masks`);
  }

  return (
    <div className="flex flex-col items-center w-full h-full">
      {/* Navigation Controls */}
      <NavigationControls
        currentFrame={currentFrame}
        currentSlice={currentSlice}
        totalFrames={totalFrames}
        totalSlices={totalSlices}
        onFrameChange={onFrameChange}
        onSliceChange={onSliceChange}
      />

  {/* Canvas */}
  <div
    ref={containerRef}
    onMouseDown={handleContainerMouseDown}
    onMouseMove={handleContainerMouseMove}
    onMouseUp={handleContainerMouseUp}
    onContextMenu={(e) => e.preventDefault()}
    className="w-full flex-1 bg-background rounded-lg overflow-hidden relative mx-auto border flex flex-col"
  >
        {/* Top info bar (frame/slice + zoom) */}
        <div 
          ref={infoBarRef}
          className="flex justify-between items-center p-2 text-xs text-muted-foreground border-b bg-muted/30 z-10 flex-shrink-0"
        >
          <div className="text-sm text-muted-foreground">Frame {currentFrame + 1} • Slice {currentSlice + 1}</div>
          <div className="text-sm text-muted-foreground">{Math.round((stageScale || 1) * 100)}% zoom</div>
        </div>

        {/* Ctrl / Pan hint badge */}
        <div className="absolute left-4 bottom-4 z-40">
          <Badge
            variant={isPanningState ? "default" : "secondary"}
            className={cn( "px-2 py-1 text-xs font-medium shadow", )}
          >
            {isPanningState ? "Panning — release mouse" : tool === "pan" ? "Pan mode" : isCtrlPressed ? "Hold Ctrl to pan (click+drag)" : "Ctrl+Click or Right-Click to pan"}
          </Badge>
        </div>

        {/* Keyboard shortcuts hint badges */}
        <div className="absolute right-4 bottom-4 z-40 flex flex-row gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant={isZoomKeyPressed ? "default" : "secondary"}
                className="px-2 py-1 text-xs font-medium shadow cursor-help"
              >
                + - to zoom
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>Press + to zoom in or - to zoom out</p>
            </TooltipContent>
          </Tooltip>
          
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant={isResetKeyPressed ? "default" : "secondary"}
                className="px-2 py-1 text-xs font-medium shadow cursor-help"
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                R to reset
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>Press R to reset zoom and position</p>
            </TooltipContent>
          </Tooltip>
        </div>
        {/* Only show loading spinner on initial load or when there's no current image */}
        {imageStatus === "loading" && isInitialLoad && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-10">
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
              Loading image...
            </div>
          </div>
        )}

        {/* Segmentation loading overlay */}
        {isSegmentationLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-20">
            <div className="bg-background/80 backdrop-blur-md rounded-xl px-10 py-8 shadow-2xl border flex flex-col items-center gap-6">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <div className="text-base font-semibold text-primary">Processing segmentation...</div>
            </div>
          </div>
        )}

        <div 
          ref={canvasAreaRef}
          className="flex-1 relative w-full"
        >
          <Stage
            ref={stageRef}
            width={containerSize.width}
            height={containerSize.height}
            scaleX={stageScale}
            scaleY={stageScale}
            x={stagePosition.x}
            y={stagePosition.y}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
          <Layer>
            {/* Background Image */}  
            {imageStatus === "loaded" && image && (
              <KonvaImage image={image} width={width} height={height} />
            )}
            
            {/* Display all anatomical labels */}
            {processedMasks.map((maskElement) => (
              <KonvaImage
                key={`mask-${maskElement.label}`}
                image={maskElement.image}
                width={width}
                height={height}
                opacity={opacity}
              />
            ))}
            
            {/* Current Drawing Preview - highlight active label */}
            {isDrawing.current && drawingPoints && tool !== "rectangle" && (
              <Line
                points={drawingPoints}
                stroke={tool === "eraser" ? "#000" : LABEL_COLORS[activeLabel]}
                strokeWidth={brushSize}
                opacity={0.8}
                tension={0.5}
                lineCap="round"
                lineJoin="round"
              />
            )}

            {/* Rectangle Drawing Preview */}
            {tool === "rectangle" && currentRect && (
              <Rect
                x={currentRect.x}
                y={currentRect.y}
                width={currentRect.width}
                height={currentRect.height}
                stroke="#ff0000"
                strokeWidth={2}
                fill="rgba(255, 0, 0, 0.1)"
                dash={[5, 5]}
              />
            )}
            
            {/* Final Bounding Box */}
            {finalBoundingBox && (
              <Rect
                x={finalBoundingBox[0]}
                y={finalBoundingBox[1]}
                width={finalBoundingBox[2] - finalBoundingBox[0]}
                height={finalBoundingBox[3] - finalBoundingBox[1]}
                stroke="#00ff00"
                strokeWidth={3}
                fill="rgba(0, 255, 0, 0.1)"
              />
            )}
          </Layer>
        </Stage>
        </div>
      </div>
    </div>
  );
}