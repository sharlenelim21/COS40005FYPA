"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Undo2, Redo2, Trash2, Brush, Eraser, MousePointer2, Square, Search, Move, RotateCcw } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

// Import shared types and constants
import type { 
  DrawingPanelProps, 
  DrawingTool
} from "@/types/segmentation";
import {
  DRAWING_TOOLS,
  TOOL_SHORTCUT_KEYS,
  BRUSH_SIZE_DECREASE_KEY,
  BRUSH_SIZE_INCREASE_KEY,
  BRUSH_SIZE_MIN,
  BRUSH_SIZE_MAX,
} from "@/types/segmentation";

// Simplified tool configuration. The internal id stays 'brush' (saved history entries use it);
// only the visible name is "Draw", to match its D shortcut.
const TOOL_CONFIG: Record<DrawingTool, { icon: React.ComponentType<{className?: string}>; label: string }> = {
  select: { icon: MousePointer2, label: 'Select' },
  brush: { icon: Brush, label: 'Draw' },
  eraser: { icon: Eraser, label: 'Eraser' },
  rectangle: { icon: Square, label: 'Bounding Box' },
  zoom: { icon: Search, label: 'Zoom' },
  pan: { icon: Move, label: 'Pan' },
} as const;

export function DrawingPanel({
  tool,
  setTool,
  brushSize,
  setBrushSize,
  opacity,
  setOpacity,
  activeLabel,
  setActiveLabel,
  handleUndo,
  handleRedo,
  handleClear,
  canUndo,
  canRedo,
  canClear,
  zoomLevel = 1,
  setZoomLevel = () => {},
  onReset,
  boundingBoxDisabled = false,
}: DrawingPanelProps) {
  // Memoized tool selection handler
  const handleToolChange = React.useCallback((value: string) => {
    if (value === 'rectangle' && boundingBoxDisabled) return;
    if (value && DRAWING_TOOLS.includes(value as DrawingTool)) {
      setTool(value as DrawingTool);
    }
  }, [setTool, boundingBoxDisabled]);

  // Keyboard shortcuts (Ctrl+Z/Y, Delete, D/E, Q/W, 1/2/3) are handled once by the segmentation
  // page, not here: this panel is mounted twice and unmounts while the History tab is open.

  return (
    <div className="space-y-4">
      {/* Tool Selection */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">Tool Selection</h3>
        <div className="grid grid-cols-3 @sm:grid-cols-6 gap-2">
          {DRAWING_TOOLS.map((toolKey) => {
            const config = TOOL_CONFIG[toolKey];
            const IconComponent = config.icon;
            const isDisabled = toolKey === 'rectangle' && boundingBoxDisabled;
            const shortcut = TOOL_SHORTCUT_KEYS[toolKey];

            return (
              <button
                key={toolKey}
                onClick={() => handleToolChange(toolKey)}
                disabled={isDisabled}
                aria-label={config.label}
                aria-keyshortcuts={shortcut}
                title={
                  isDisabled
                    ? "Bounding Box uses MedSAM, which is only available with NVIDIA GPU."
                    : shortcut
                    ? `${config.label} (${shortcut})`
                    : undefined
                }
                className={cn(
                  "relative h-16 flex flex-col items-center justify-center rounded-lg",
                  "border border-border transition-all",
                  "hover:bg-primary/20",
                  "focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent",
                  tool === toolKey
                    ? "bg-primary/10 border-primary/60 text-primary"
                    : "text-foreground"
                )}
              >
                {shortcut && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1 right-1.5 font-mono text-[10px] leading-none text-muted-foreground"
                  >
                    {shortcut}
                  </span>
                )}
                <IconComponent className="w-4 h-4 mb-1" />
                <span className="hidden @xs:block text-xs font-medium">{config.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Draw & Erase Settings - Only show for relevant tools */}
      {(tool === 'brush' || tool === 'eraser') && (
        <div>
          <h3 className="text-sm font-medium text-foreground mb-3">Draw &amp; Erase Settings</h3>
          <div className="bg-muted rounded-lg border p-4 space-y-4">
            {/* Size and Opacity in one row */}
            <div className="grid grid-cols-2 gap-4">
              {/* Size */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-foreground">
                    Size
                    <span
                      className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground"
                      title={`${BRUSH_SIZE_DECREASE_KEY} smaller, ${BRUSH_SIZE_INCREASE_KEY} bigger`}
                    >
                      {BRUSH_SIZE_DECREASE_KEY} / {BRUSH_SIZE_INCREASE_KEY}
                    </span>
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {brushSize}px
                  </span>
                </div>
                <Slider
                  value={[brushSize]}
                  onValueChange={(v: number[]) => setBrushSize(v[0])}
                  min={BRUSH_SIZE_MIN}
                  max={BRUSH_SIZE_MAX}
                  step={1}
                  className="[&>span:first-child]:border [&>span:first-child]:border-border"
                />
              </div>

              {/* Opacity */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-foreground">
                    Opacity
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {Math.round(opacity * 100)}%
                  </span>
                </div>
                <Slider
                  value={[opacity * 100]}
                  onValueChange={(v: number[]) => setOpacity(v[0] / 100)}
                  min={10}
                  max={100}
                  step={1}
                  className="[&>span:first-child]:border [&>span:first-child]:border-border"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Zoom Settings - Only show for zoom tool */}
      {tool === 'zoom' && (
        <div>
          <h3 className="text-sm font-medium text-foreground mb-3">Zoom Settings</h3>
          <div className="bg-muted rounded-lg border p-4 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-foreground">Zoom</label>
                <span className="text-xs text-muted-foreground">{Math.round((zoomLevel || 1) * 100)}%</span>
              </div>
              <Slider
                value={[(zoomLevel || 1) * 100]}
                onValueChange={(v: number[]) => setZoomLevel(v[0] / 100)}
                min={10}
                max={500}
                step={1}
                className="[&>span:first-child]:border [&>span:first-child]:border-border"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full mt-4 flex items-center justify-center text-sm font-medium"
              onClick={onReset}
              aria-label="Reset zoom"
            >
              <RotateCcw className="w-5 h-5 mr-2" />
              Reset
            </Button>
          </div>
        </div>
      )}

      {/* Rectangle/Bounding Box Guide - Only show for rectangle tool */}
      {tool === 'rectangle' && (
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="bounding-box-guide" className="border-none">
            <AccordionTrigger className="py-2 hover:no-underline [&[data-state=open]>svg]:rotate-180">
              <h3 className="text-sm font-medium text-foreground">Bounding Box Guide</h3>
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <div className="bg-muted rounded-lg border p-3 space-y-3">
                <div className="text-sm text-muted-foreground">
                  Draw a rectangle to define the region of interest for manual segmentation.
                </div>
                
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    <strong>Instructions:</strong>
                    <ol className="list-decimal list-inside mt-1 space-y-0.5">
                      <li>Select your desired anatomical label above before drawing</li>
                      <li>Click and drag to draw a bounding box around the area you want to segment</li>
                      <li>The box will appear as a red dashed outline while drawing</li>
                      <li>Release the mouse to finalize - the box will turn green</li>
                      <li>Segmentation will start automatically using the selected anatomical label</li>
                      <li>Wait for the AI to process the region and return the segmentation mask</li>
                    </ol>
                  </div>
                  
                  <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950 p-2 rounded border-l-2 border-blue-400">
                    <strong>Note:</strong> The bounding box coordinates will be sent to the AI segmentation model to process only the selected region.
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}

      {/* Collapsible Sections using Accordion */}
      <Accordion type="single" collapsible className="w-full">
        {/* Actions - Open by default. */}
        <AccordionItem value="actions" className="border-none">
          <AccordionTrigger className="py-2 hover:no-underline [&[data-state=open]>svg]:rotate-180">
            <h3 className="text-sm font-medium text-foreground">Actions</h3>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleUndo}
                disabled={!canUndo}
                className="w-full justify-start text-xs"
                aria-label="Undo last action (Ctrl+Z)"
              >
                <Undo2 className="w-4 h-4 mr-2" />
                Undo
                <span className="text-xs text-muted-foreground ml-auto">Ctrl+Z</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleRedo}
                disabled={!canRedo}
                className="w-full justify-start text-xs"
                aria-label="Redo last action (Ctrl+Y)"
              >
                <Redo2 className="w-4 h-4 mr-2" />
                Redo
                <span className="text-xs text-muted-foreground ml-auto">Ctrl+Y</span>
              </Button>

              <Button
                variant="destructive"
                onClick={handleClear}
                disabled={!canClear}
                className="w-full justify-start text-xs"
                aria-label="Clear current mask (Delete)"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear Current Mask
                <span className="text-xs text-muted-foreground ml-auto">Del</span>
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>

        {/* Keyboard Shortcuts - Collapsed by default. Highlighted via a blue BORDER, not colored
            text, so it's noticeable without reading as a status/severity color (2026-11-11). */}
        <AccordionItem value="tooltips" className="rounded-lg border-2 border-info/60 px-2">
          <AccordionTrigger className="py-2 hover:no-underline [&[data-state=open]>svg]:rotate-180">
            <h3 className="text-sm font-medium text-foreground">Keyboard Shortcuts</h3>
          </AccordionTrigger>
          <AccordionContent className="pb-3">
            <div className="p-3 bg-muted rounded-lg text-xs text-muted-foreground space-y-1.5">
              <div>• <strong>Select:</strong> Move and select objects</div>
              <div>• <strong>Draw (D):</strong> Paint segmentation masks</div>
              <div>• <strong>Eraser (E):</strong> Remove mask pixels</div>
              <div>• <strong>Bounding Box:</strong> Draw bounding box for AI-powered manual segmentation (MedSAM, NVIDIA GPU only)</div>
              <div>• <strong>Zoom:</strong> Enlarge the image</div>
              <div>• <strong>Pan:</strong> Navigate the canvas</div>
              <div className="pt-1.5 font-medium text-foreground">Keyboard shortcuts</div>
              <div>• <strong>1 / 2 / 3:</strong> LV Cavity / RV / Myocardium</div>
              <div>• <strong>D / E:</strong> Draw / Eraser</div>
              <div>• <strong>Q / W:</strong> Smaller / bigger brush (Draw and Eraser)</div>
              <div>• <strong>← →:</strong> Frames &nbsp;<strong>↑ ↓:</strong> Slices</div>
              <div>• <strong>+ / −:</strong> Zoom &nbsp;<strong>R:</strong> Reset view</div>
              <div>• <strong>Ctrl+Z / Ctrl+Y:</strong> Undo / Redo</div>
              <div>• <strong>Del:</strong> Clear current mask &nbsp;<strong>Ctrl+S:</strong> Save</div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}