/**
 * DebugMRIViewer Component
 *
 * A comprehensive debug component for viewing MRI images from tar files with instant navigation.
 * This component handles the complete workflow from tar file fetching to image display with
 * preloading optimization for seamless user experience.
 *
 * Key Features:
 * - Fetches and extracts MRI images from presigned tar URLs
 * - Stores images in IndexedDB for persistent caching
 * - Preloads all images into memory for instant switching
 * - Provides frame/slice navigation with keyboard shortcuts
 * - Interactive zoom and pan functionality for detailed viewing
 * - Handles filename pattern: projectid_filehash_frame_slice.jpg
 * - Memory management with proper URL cleanup
 * - Debug information and progress tracking
 *
 * Navigation Controls:
 * - Arrow keys: ← → for frames, ↑ ↓ for slices
 * - Zoom controls: + - keys for zoom in/out, 0 to reset
 * - Mouse interactions: wheel to zoom, drag to pan
 * - Input fields: Direct frame/slice number entry
 * - Navigation buttons: Click-based prev/next controls
 *
 * Viewing Features:
 * - Large 600px image display area for detailed examination
 * - Smooth zoom (0.1x to 5x) with mouse wheel or keyboard
 * - Click and drag panning for exploring zoomed images
 * - Optional zoom/pan preservation when switching images
 * - Scrollbar interference prevention during zoom operations
 * - Visual zoom indicator overlay
 *
 * User Preferences:
 * - Checkbox to reset frame when slice changes
 * - Checkbox to preserve zoom/pan across image navigation
 * - Configurable navigation behavior for optimal workflow
 *
 * Performance Optimizations:
 * - URL caching prevents duplicate object URLs for same blob
 * - Memory preloading eliminates loading delays
 * - Batch processing with progress tracking
 * - Conditional console logging based on environment
 *
 * @param projectId - The unique identifier for the project containing MRI images
 */

"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Image from "next/image";
import { useProject } from "@/context/ProjectContext";
import { tarImageCache } from "@/lib/tar-image-cache";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Image as ImageIcon, AlertCircle, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";

interface DebugMRIViewerProps {
  projectId: string;
}

export function DebugMRIViewer({ projectId }: DebugMRIViewerProps) {
  // Use ProjectContext instead of managing tar cache directly
  const { tarCacheReady, tarCacheError, getMRIImage, getAvailableFramesAndSlices } = useProject();

  // Image data and navigation - core image viewing functionality
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null); // URL for displaying current image
  const [currentFrame, setCurrentFrame] = useState<number>(0); // Currently selected frame index (0-based)
  const [currentSlice, setCurrentSlice] = useState<number>(0); // Currently selected slice index (0-based)
  const [availableFrames, setAvailableFrames] = useState<number[]>([]); // Array of available frame numbers
  const [availableSlices, setAvailableSlices] = useState<number[]>([]); // Array of available slice numbers

  // Cache stats - monitor performance and storage usage
  const [cacheSize, setCacheSize] = useState<number>(0); // Total number of cached images
  const [totalImages, setTotalImages] = useState<number>(0); // Total images available in tar file

  // Preloaded images for instant switching - memory optimization for smooth UX
  const [preloadedImages, setPreloadedImages] = useState<Record<string, string>>({}); // Map of image keys to blob URLs
  const [isPreloading, setIsPreloading] = useState<boolean>(false); // Preloading operation status
  const [preloadProgress, setPreloadProgress] = useState<{ loaded: number; total: number }>({ loaded: 0, total: 0 }); // Progress tracking

  // Thumbnail functionality - visual navigation aid
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({}); // Map of image keys to thumbnail data URLs
  const [showThumbnails, setShowThumbnails] = useState<boolean>(true); // Toggle thumbnail visibility
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState<boolean>(false); // Thumbnail generation status

  // Navigation behavior control
  const [resetFrameOnSliceChange, setResetFrameOnSliceChange] = useState<boolean>(false); // Reset frame to 0 when slice changes
  const [preserveZoomPan, setPreserveZoomPan] = useState<boolean>(true); // Preserve zoom and pan when switching images

  // Ref for image container to attach native event listeners
  const imageContainerRef = useRef<HTMLDivElement>(null);

  // Image zoom and pan controls
  const [zoom, setZoom] = useState<number>(1); // Current zoom level (1 = 100%)
  const [panX, setPanX] = useState<number>(0); // Pan offset X in pixels
  const [panY, setPanY] = useState<number>(0); // Pan offset Y in pixels
  const [isPanning, setIsPanning] = useState<boolean>(false); // Track if user is currently panning
  const [lastPanPoint, setLastPanPoint] = useState<{ x: number; y: number } | null>(null); // Last mouse position for panning

  // Initialize component and load available frames/slices when cache is ready
  useEffect(() => {
    const initializeNavigation = async () => {
      if (!tarCacheReady) return; // Wait for tar cache to be ready from ProjectContext

      try {
        if (process.env.NEXT_PUBLIC_ENV === "development") {
          console.log("[DebugMRIViewer] Tar cache ready, loading navigation options...");
        }

        // Get available frames and slices from ProjectContext
        const { frames, slices } = await getAvailableFramesAndSlices();
        if (frames.length > 0 && slices.length > 0) {
          setAvailableFrames(frames);
          setAvailableSlices(slices);
          setCurrentFrame(frames[0]);
          setCurrentSlice(slices[0]);
          setTotalImages(frames.length * slices.length);
          if (process.env.NEXT_PUBLIC_ENV === "development") {
            console.log(`[DebugMRIViewer] Found ${frames.length} frames, ${slices.length} slices`);
          }
        }

        // Update cache size for debug information
        const size = await tarImageCache.getCacheSize();
        setCacheSize(size);
      } catch (err) {
        console.error("[DebugMRIViewer] Failed to initialize navigation:", err);
      }
    };

    initializeNavigation();
  }, [tarCacheReady, getAvailableFramesAndSlices]); // Re-run when tar cache is ready

  // Load current image when frame/slice changes - core image display logic
  const loadCurrentImage = useCallback(async () => {
    if (!tarCacheReady) return; // Wait for tar cache to be ready from ProjectContext

    try {
      const imageKey = `${projectId}_f${currentFrame}_s${currentSlice}`;

      // Check if image is already preloaded in memory for instant display
      if (preloadedImages[imageKey]) {
        setCurrentImageUrl(preloadedImages[imageKey]);
        return;
      }

      // Use ProjectContext getMRIImage method instead of direct tarImageCache
      const imageUrl = await getMRIImage(currentFrame, currentSlice);
      setCurrentImageUrl(imageUrl);

      if (!imageUrl) {
        console.warn(`[DebugMRIViewer] No image found for frame ${currentFrame + 1}, slice ${currentSlice + 1} (internal: ${currentFrame}, ${currentSlice})`);
      }
    } catch (err) {
      console.error("[DebugMRIViewer] Failed to load image:", err);
    }
  }, [tarCacheReady, projectId, currentFrame, currentSlice, preloadedImages, getMRIImage]);

  // Preload all images for instant switching - performance optimization
  const preloadAllImages = useCallback(async () => {
    if (!tarCacheReady || availableFrames.length === 0 || availableSlices.length === 0) {
      return; // Skip preloading if data not ready
    }

    setIsPreloading(true);
    const totalToPreload = availableFrames.length * availableSlices.length;
    setPreloadProgress({ loaded: 0, total: totalToPreload });

    if (process.env.NEXT_PUBLIC_ENV === "development") {
      console.log(`[DebugMRIViewer] Starting preload of ${totalToPreload} images...`);
    }

    const imageUrls: Record<string, string> = {};
    let loadedCount = 0;

    try {
      // Preload all combinations of frames and slices for instant switching
      for (const frame of availableFrames) {
        for (const slice of availableSlices) {
          const imageKey = `${projectId}_f${frame}_s${slice}`;

          try {
            // Use ProjectContext getMRIImage instead of direct tarImageCache call
            const imageUrl = await getMRIImage(frame, slice);
            if (imageUrl) {
              imageUrls[imageKey] = imageUrl;
            }
          } catch (err) {
            console.warn(`[DebugMRIViewer] Failed to preload image ${imageKey}:`, err);
          }

          loadedCount++;
          setPreloadProgress({ loaded: loadedCount, total: totalToPreload }); // Update progress for UI feedback
        }
      }

      // Store all preloaded images in state for instant access
      setPreloadedImages(imageUrls);
      if (process.env.NEXT_PUBLIC_ENV === "development") {
        console.log(`[DebugMRIViewer] Preloaded ${Object.keys(imageUrls).length}/${totalToPreload} images`);
      }
    } catch (err) {
      console.error("[DebugMRIViewer] Preloading failed:", err);
    } finally {
      setIsPreloading(false); // Complete preloading operation
    }
  }, [tarCacheReady, availableFrames, availableSlices, projectId, getMRIImage]);

  // Generate thumbnails from preloaded images - visual navigation aid
  const generateThumbnails = useCallback(async () => {
    if (Object.keys(preloadedImages).length === 0 || Object.keys(thumbnails).length > 0) {
      return; // Skip if no images preloaded or thumbnails already generated
    }

    setIsGeneratingThumbnails(true);

    if (process.env.NEXT_PUBLIC_ENV === "development") {
      console.log(`[DebugMRIViewer] Generating thumbnails for ${Object.keys(preloadedImages).length} images...`);
    }

    const thumbnailUrls: Record<string, string> = {};

    try {
      for (const [imageKey, imageUrl] of Object.entries(preloadedImages)) {
        try {
          const thumbnail = await createThumbnail(imageUrl);
          thumbnailUrls[imageKey] = thumbnail;
        } catch (err) {
          console.warn(`[DebugMRIViewer] Failed to generate thumbnail for ${imageKey}:`, err);
        }
      }

      setThumbnails(thumbnailUrls);

      if (process.env.NEXT_PUBLIC_ENV === "development") {
        console.log(`[DebugMRIViewer] Generated ${Object.keys(thumbnailUrls).length} thumbnails`);
      }
    } catch (err) {
      console.error("[DebugMRIViewer] Thumbnail generation failed:", err);
    } finally {
      setIsGeneratingThumbnails(false);
    }
  }, [preloadedImages, thumbnails]);

  // Create thumbnail from image URL - utility function
  const createThumbnail = (imageUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const img = document.createElement("img");

      if (!ctx) {
        reject(new Error("Could not get canvas context"));
        return;
      }

      img.onload = () => {
        // Set thumbnail size (64x64 for good performance)
        const size = 64;
        canvas.width = size;
        canvas.height = size;

        // Calculate scaling to maintain aspect ratio
        const scale = Math.min(size / img.width, size / img.height);
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;
        const offsetX = (size - scaledWidth) / 2;
        const offsetY = (size - scaledHeight) / 2;

        // Fill with background color
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, size, size);

        // Draw scaled image
        ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);

        // Convert to data URL with good compression
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };

      img.onerror = () => {
        reject(new Error("Failed to load image for thumbnail generation"));
      };

      img.src = imageUrl;
    });
  };

  // Trigger preloading when frames and slices are available - automatic optimization
  useEffect(() => {
    if (availableFrames.length > 0 && availableSlices.length > 0 && Object.keys(preloadedImages).length === 0) {
      if (process.env.NEXT_PUBLIC_ENV === "development") {
        console.log("[DebugMRIViewer] Triggering preload...");
      }
      // Small delay to allow UI to stabilize before heavy preloading operation
      setTimeout(() => {
        preloadAllImages();
      }, 100);
    }
  }, [availableFrames, availableSlices, preloadedImages, preloadAllImages]);

  // Generate thumbnails after preloading is complete
  useEffect(() => {
    if (!isPreloading && Object.keys(preloadedImages).length > 0 && Object.keys(thumbnails).length === 0) {
      if (process.env.NEXT_PUBLIC_ENV === "development") {
        console.log("[DebugMRIViewer] Triggering thumbnail generation...");
      }
      // Small delay to ensure preloading is fully complete
      setTimeout(() => {
        generateThumbnails();
      }, 200);
    }
  }, [isPreloading, preloadedImages, thumbnails, generateThumbnails]);

  // Load image whenever navigation changes
  useEffect(() => {
    loadCurrentImage();
  }, [loadCurrentImage]); // Dependency ensures image updates when frame/slice changes

  // Input handlers for direct frame/slice selection (convert from 1-based UI to 0-based internal)
  const handleFrameChange = (value: string) => {
    const frameInput = parseInt(value, 10); // User enters 1-based
    const frame = frameInput - 1; // Convert to 0-based for internal use
    if (!isNaN(frame) && availableFrames.includes(frame)) {
      setCurrentFrame(frame);
    }
  };

  const handleSliceChange = (value: string) => {
    const sliceInput = parseInt(value, 10); // User enters 1-based
    const slice = sliceInput - 1; // Convert to 0-based for internal use
    if (!isNaN(slice) && availableSlices.includes(slice)) {
      setCurrentSlice(slice);

      // Reset frame to first available frame if checkbox is enabled
      if (resetFrameOnSliceChange && availableFrames.length > 0) {
        setCurrentFrame(availableFrames[0]);
      }
    }
  };

  // Navigation functions for button controls
  const navigateFrame = (direction: "prev" | "next") => {
    const currentIndex = availableFrames.indexOf(currentFrame);
    if (direction === "prev" && currentIndex > 0) {
      setCurrentFrame(availableFrames[currentIndex - 1]);
    } else if (direction === "next" && currentIndex < availableFrames.length - 1) {
      setCurrentFrame(availableFrames[currentIndex + 1]);
    }
  };

  const navigateSlice = (direction: "prev" | "next") => {
    const currentIndex = availableSlices.indexOf(currentSlice);
    let newSlice: number | null = null;

    if (direction === "prev" && currentIndex > 0) {
      newSlice = availableSlices[currentIndex - 1];
    } else if (direction === "next" && currentIndex < availableSlices.length - 1) {
      newSlice = availableSlices[currentIndex + 1];
    }

    if (newSlice !== null) {
      setCurrentSlice(newSlice);

      // Reset frame to first available frame if checkbox is enabled
      if (resetFrameOnSliceChange && availableFrames.length > 0) {
        setCurrentFrame(availableFrames[0]);
      }
    }
  };

  // Image zoom and pan control functions for enhanced viewing
  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev * 1.2, 5)); // Max zoom 5x with 20% increments
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev / 1.2, 0.1)); // Min zoom 0.1x with 20% decrements
  };

  const handleZoomReset = () => {
    setZoom(1); // Reset to 100% zoom
    setPanX(0); // Reset horizontal pan
    setPanY(0); // Reset vertical pan
  };

  // Mouse event handlers for pan functionality
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      // Left mouse button only
      setIsPanning(true);
      setLastPanPoint({ x: e.clientX, y: e.clientY });
      e.preventDefault(); // Prevent text selection
      e.stopPropagation(); // Prevent event bubbling
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning && lastPanPoint) {
      // Calculate mouse movement delta
      const deltaX = e.clientX - lastPanPoint.x;
      const deltaY = e.clientY - lastPanPoint.y;

      // Update pan position based on movement
      setPanX((prev) => prev + deltaX);
      setPanY((prev) => prev + deltaY);
      setLastPanPoint({ x: e.clientX, y: e.clientY });
      e.preventDefault(); // Prevent any default behavior during panning
      e.stopPropagation(); // Prevent event bubbling
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false); // Stop panning
    setLastPanPoint(null); // Clear last pan point
  };

  // Mouse wheel zoom handler with enhanced scroll prevention
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? 0.9 : 1.1; // 10% zoom steps
    setZoom((prev) => Math.max(0.1, Math.min(5, prev * delta))); // Apply zoom limits
  }, []);

  const handleMouseEnter = useCallback(() => {
    window.addEventListener("wheel", handleWheel, { passive: false });
  }, [handleWheel]);

  const handleMouseLeave = useCallback(() => {
    window.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // Reset zoom and pan when image changes - now conditional based on user preference
  useEffect(() => {
    if (!preserveZoomPan) {
      setZoom(1);
      setPanX(0);
      setPanY(0);
    }
  }, [currentFrame, currentSlice, preserveZoomPan]);

  // Keyboard navigation - enhance user experience with arrow key controls
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (totalImages === 0) return; // Only handle keys when images are available

      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault(); // Prevent default browser behavior
          navigateFrame("prev");
          break;
        case "ArrowRight":
          event.preventDefault();
          navigateFrame("next");
          break;
        case "ArrowUp":
          event.preventDefault();
          navigateSlice("prev");
          break;
        case "ArrowDown":
          event.preventDefault();
          navigateSlice("next");
          break;
        case "=":
        case "+":
          event.preventDefault();
          handleZoomIn();
          break;
        case "-":
          event.preventDefault();
          handleZoomOut();
          break;
        case "0":
          event.preventDefault();
          handleZoomReset();
          break;
      }
    };

    // Attach global keyboard event listener
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [totalImages, availableFrames, availableSlices, currentFrame, currentSlice]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-background p-4 lg:p-8">
      <div className="container mx-auto space-y-8">
        <TooltipProvider>
          <Card className="w-full">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle className="text-lg">MRI Viewer</CardTitle>
                    <CardDescription className="text-sm">Project {projectId}</CardDescription>
                  </div>
                </div>

                {/* Compact status badges */}
                <div className="flex items-center gap-2">
                  <Badge variant={tarCacheReady ? "default" : "destructive"} className="text-xs">
                    {tarCacheReady ? "Ready" : "Not Ready"}
                  </Badge>
                  {totalImages > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {totalImages} images
                    </Badge>
                  )}
                  {isPreloading && (
                    <Badge variant="outline" className="text-xs">
                      Loading {preloadProgress.loaded}/{preloadProgress.total}
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-4">
              {/* Error Display */}
              {tarCacheError && (
                <Alert variant="destructive" className="py-2 mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="flex items-center justify-between">
                    <span className="text-sm">{tarCacheError}</span>
                  </AlertDescription>
                </Alert>
              )}

              {/* Main Content - Row Layout */}
              {totalImages > 0 ? (
                <div className="flex gap-6">
                  {/* Left Sidebar - Controls */}
                  <div className="flex-shrink-0 w-64 space-y-4">
                    {/* Frame and Slice Controls */}
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium">Frame</Label>
                          <span className="text-xs text-muted-foreground">{availableFrames.length} total</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="sm" onClick={() => navigateFrame("prev")} disabled={availableFrames.indexOf(currentFrame) <= 0} className="h-8 w-8 p-0">
                            <ArrowLeft className="h-3 w-3" />
                          </Button>
                          <Input
                            type="number"
                            value={currentFrame + 1} // Display 1-based to user
                            onChange={(e) => handleFrameChange(e.target.value)}
                            min={Math.min(...availableFrames) + 1} // Display 1-based min
                            max={Math.max(...availableFrames) + 1} // Display 1-based max
                            className="flex-1 h-8 text-center"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigateFrame("next")}
                            disabled={availableFrames.indexOf(currentFrame) >= availableFrames.length - 1}
                            className="h-8 w-8 p-0"
                          >
                            <ArrowRight className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium">Slice</Label>
                          <span className="text-xs text-muted-foreground">{availableSlices.length} total</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="sm" onClick={() => navigateSlice("prev")} disabled={availableSlices.indexOf(currentSlice) <= 0} className="h-8 w-8 p-0">
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Input
                            type="number"
                            value={currentSlice + 1} // Display 1-based to user
                            onChange={(e) => handleSliceChange(e.target.value)}
                            min={Math.min(...availableSlices) + 1} // Display 1-based min
                            max={Math.max(...availableSlices) + 1} // Display 1-based max
                            className="flex-1 h-8 text-center"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => navigateSlice("next")}
                            disabled={availableSlices.indexOf(currentSlice) >= availableSlices.length - 1}
                            className="h-8 w-8 p-0"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Zoom Controls */}
                    <div className="space-y-3 p-3 bg-muted/20 rounded-lg">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Zoom</Label>
                        <span className="text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={handleZoomOut} disabled={zoom <= 0.1} className="h-8 w-8 p-0">
                          <ZoomOut className="h-3 w-3" />
                        </Button>
                        <div className="flex-1 text-center">
                          <span className="text-sm font-medium">{Math.round(zoom * 100)}%</span>
                        </div>
                        <Button variant="outline" size="sm" onClick={handleZoomIn} disabled={zoom >= 5} className="h-8 w-8 p-0">
                          <ZoomIn className="h-3 w-3" />
                        </Button>
                      </div>
                      <Button variant="outline" size="sm" onClick={handleZoomReset} className="w-full h-8">
                        <RotateCcw className="h-3 w-3 mr-2" />
                        Reset
                      </Button>
                    </div>

                    {/* Settings */}
                    <div className="space-y-3 p-3 bg-muted/20 rounded-lg">
                      <Label className="text-sm font-medium">Options</Label>
                      <div className="space-y-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2">
                              <Checkbox id="reset-frame" checked={resetFrameOnSliceChange} onCheckedChange={(checked) => setResetFrameOnSliceChange(!!checked)} className="h-4 w-4" />
                              <Label htmlFor="reset-frame" className="cursor-pointer text-sm">
                                Reset frame on slice change
                              </Label>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>
                              When enabled, automatically jumps to the first frame whenever you change slices.
                              <br />
                              Useful for systematic viewing of each slice from the beginning.
                            </p>
                          </TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2">
                              <Checkbox id="preserve-zoom" checked={preserveZoomPan} onCheckedChange={(checked) => setPreserveZoomPan(!!checked)} className="h-4 w-4" />
                              <Label htmlFor="preserve-zoom" className="cursor-pointer text-sm">
                                Preserve zoom & pan
                              </Label>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>
                              When enabled, maintains your current zoom level and pan position
                              <br />
                              when navigating between different frames and slices.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>

                    {/* Keyboard shortcuts hint */}
                    <div className="text-xs text-muted-foreground text-center py-2 px-3 bg-muted/20 rounded-lg">
                      <div className="font-medium mb-1">Keyboard Shortcuts</div>
                      <div className="space-y-0.5">
                        <div>← → frames</div>
                        <div>↑ ↓ slices</div>
                        <div>+ - 0 zoom</div>
                        <div>drag to pan</div>
                      </div>
                    </div>

                    {/* Debug Info - Collapsible */}
                    {process.env.NEXT_PUBLIC_ENV === "development" && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground mb-2">🔧 Debug Info</summary>
                        <div className="p-3 bg-muted/20 rounded-lg text-xs space-y-1">
                          <div>Project ID: {projectId}</div>
                          <div>Status: {tarCacheReady ? "✅ Ready" : "❌ Not Ready"}</div>
                          <div>
                            Images: {totalImages} | Frames: {availableFrames.length} | Slices: {availableSlices.length}
                          </div>
                          <div>
                            Current: F{currentFrame + 1} S{currentSlice + 1}
                          </div>
                          <div>Cache: {(cacheSize / (1024 * 1024)).toFixed(2)}MB</div>
                          <div>Preloaded: {Object.keys(preloadedImages).length}</div>
                        </div>
                      </details>
                    )}
                  </div>

                  {/* Right Side - Image Display */}
                  {/* Right Side - Image Display */}
                  <div className="flex-1 min-w-0">
                    <div className="border rounded-lg bg-background">
                      {currentImageUrl ? (
                        <div className="space-y-0">
                          {/* Image header */}
                          <div className="flex justify-between items-center p-2 text-xs text-muted-foreground border-b bg-muted/30">
                            <div className="flex items-center gap-3">
                              <span>
                                Frame {currentFrame + 1} • Slice {currentSlice + 1}
                              </span>
                              {preloadedImages[`${projectId}_f${currentFrame}_s${currentSlice}`] && (
                                <Badge variant="outline" className="text-xs px-1 py-0 h-4">
                                  ⚡
                                </Badge>
                              )}
                            </div>
                            <span>{Math.round(zoom * 100)}% zoom</span>
                          </div>

                          {/* Image Container */}
                          <div
                            ref={imageContainerRef}
                            className="relative w-full h-[500px] overflow-hidden cursor-grab active:cursor-grabbing"
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseEnter={handleMouseEnter}
                            onMouseLeave={() => {
                              handleMouseUp();
                              handleMouseLeave();
                            }}
                            style={{
                              userSelect: "none",
                              WebkitUserSelect: "none",
                              touchAction: "none",
                              overscrollBehavior: "none",
                              scrollBehavior: "auto",
                              overflowX: "hidden",
                              overflowY: "hidden",
                            }}
                          >
                            <div
                              className="absolute inset-0 flex items-center justify-center"
                              style={{
                                transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                                transformOrigin: "center",
                                transition: isPanning ? "none" : "transform 0.1s ease-out",
                              }}
                            >
                              <Image
                                src={currentImageUrl}
                                alt={`MRI Frame ${currentFrame + 1}, Slice ${currentSlice + 1}`}
                                width={0}
                                height={0}
                                sizes="100vw"
                                className="max-w-full max-h-full object-contain w-auto h-auto"
                                style={{
                                  imageRendering: "crisp-edges",
                                  pointerEvents: "none",
                                }}
                                unoptimized
                                draggable={false}
                              />
                            </div>

                            {/* Zoom indicator */}
                            {zoom !== 1 && <div className="absolute top-2 right-2 bg-black/70 text-white px-2 py-1 rounded text-xs">{Math.round(zoom * 100)}%</div>}
                          </div>
                        </div>
                      ) : totalImages > 0 ? (
                        <div className="h-[500px] flex items-center justify-center text-muted-foreground">
                          <div className="text-center">
                            <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">No image found</p>
                            <p className="text-xs">
                              Frame {currentFrame + 1}, Slice {currentSlice + 1}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="h-[500px] flex items-center justify-center text-muted-foreground">
                          <div className="text-center">
                            <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">Click &quot;Load Images&quot; to start</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Thumbnail Strip */}
                    {showThumbnails && availableFrames.length > 1 && (
                      <div className="mt-4">
                        <div className="flex items-center justify-between mb-2">
                          <Label className="text-sm font-medium">Frame Thumbnails (Slice {currentSlice + 1})</Label>
                          <div className="flex items-center gap-2">
                            {isGeneratingThumbnails && (
                              <Badge variant="outline" className="text-xs">
                                Generating...
                              </Badge>
                            )}
                            <Button variant="outline" size="sm" onClick={() => setShowThumbnails(false)} className="h-6 px-2 text-xs">
                              Hide
                            </Button>
                          </div>
                        </div>
                        <div className="border rounded-lg p-2 bg-muted/10">
                          <ScrollArea className="w-full pb-3">
                            <div className="flex gap-1 pb-1">
                              {availableFrames.map((frame) => {
                                const thumbnailKey = `${projectId}_f${frame}_s${currentSlice}`;
                                const thumbnailUrl = thumbnails[thumbnailKey];
                                const isActive = frame === currentFrame;

                                return (
                                  <div
                                    key={frame}
                                    className={`flex-shrink-0 cursor-pointer rounded border-2 transition-all duration-200 ${
                                      isActive ? "border-primary ring-2 ring-primary/20" : "border-muted-foreground/20 hover:border-primary/50"
                                    }`}
                                    onClick={() => setCurrentFrame(frame)}
                                    title={`Frame ${frame + 1}`}
                                  >
                                    {thumbnailUrl ? (
                                      <Image
                                        src={thumbnailUrl}
                                        alt={`Frame ${frame + 1} thumbnail`}
                                        width={64}
                                        height={64}
                                        className="w-16 h-16 object-cover rounded"
                                        style={{ imageRendering: "crisp-edges" }}
                                        unoptimized
                                      />
                                    ) : (
                                      <div className="w-16 h-16 bg-muted/30 rounded flex items-center justify-center">
                                        <ImageIcon className="h-4 w-4 text-muted-foreground" />
                                      </div>
                                    )}
                                    <div className="text-xs text-center py-1 px-1 bg-muted/20">{frame + 1}</div>
                                  </div>
                                );
                              })}
                            </div>
                            <ScrollBar orientation="horizontal" />
                          </ScrollArea>
                        </div>
                      </div>
                    )}

                    {/* Toggle thumbnails button when hidden */}
                    {!showThumbnails && availableFrames.length > 1 && (
                      <div className="mt-4">
                        <Button variant="outline" size="sm" onClick={() => setShowThumbnails(true)} className="w-full h-8">
                          <ImageIcon className="h-3 w-3 mr-2" />
                          Show Thumbnails
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-[500px] flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Click &quot;Load Images&quot; to start</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TooltipProvider>
      </div>
    </div>
  );
}
