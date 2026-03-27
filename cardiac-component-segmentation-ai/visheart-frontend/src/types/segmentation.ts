import type { ProjectData } from "@/types/project";

// Centralized anatomical label definitions
export const ANATOMICAL_LABELS = ['lvc', 'rv', 'myo'] as const;
export type AnatomicalLabel = typeof ANATOMICAL_LABELS[number];

// Centralized color mapping using CSS custom properties
export const LABEL_COLORS: Record<AnatomicalLabel, string> = {
  'lvc': '#ef4444', // Red - Left Ventricle Cavity
  'rv': '#22c55e',  // Blue - Right Ventricle  
  'myo': '#3b82f6'  // Green - Myocardium
} as const;

export const LABEL_NAMES: Record<AnatomicalLabel, string> = {
  'lvc': 'Left Ventricle Cavity',
  'rv': 'Right Ventricle',
  'myo': 'Myocardium'
} as const;

// Tool type definitions
export const DRAWING_TOOLS = [
  'select', 'brush', 'eraser', 'rectangle', 
  'zoom', 'pan'
] as const;
export type DrawingTool = typeof DRAWING_TOOLS[number];

// History entry interface with proper typing
export interface HistoryEntry {
  id: string;
  type: 'brush' | 'eraser' | 'clear' | 'import' | 'checkpoint' | 'undo' | 'redo';
  description: string;
  timestamp: number;
  frameSlice: string;
  checkpointNumber?: number;
  maskChanges?: {
    added: number;
    removed: number;
    label: AnatomicalLabel;
  };
  masksSnapshot: Record<string, Uint8Array>;
  componentLabel?: AnatomicalLabel;
}

// Component prop interfaces
export interface DrawingPanelProps {
  tool: DrawingTool;
  setTool: (tool: DrawingTool) => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  opacity: number;
  setOpacity: (opacity: number) => void;
  activeLabel: AnatomicalLabel;
  setActiveLabel: (label: AnatomicalLabel) => void;
  handleUndo: () => void;
  handleRedo: () => void;
  handleClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  zoomLevel?: number;
  setZoomLevel?: (level: number) => void;
  onReset?: () => void;
}

export interface ImageCanvasProps {
  projectData: ProjectData;
  decodedMasks: Record<string, Uint8Array>;
  onMaskUpdate: (
    masks: Record<string, Uint8Array>, 
    actionType?: 'brush' | 'eraser' | 'clear',
    description?: string
  ) => void;
  currentFrame: number;
  currentSlice: number;
  onFrameChange: (frame: number) => void;
  onSliceChange: (slice: number) => void;
  width: number;
  height: number;
  // Optional visual canvas size: when provided the Stage will be displayed at
  // this size while the internal coordinate system remains based on `width`/`height`.
  canvasWidth?: number;
  canvasHeight?: number;
  activeLabel: AnatomicalLabel;
  visibleMasks: Set<AnatomicalLabel>;
  tool: DrawingTool;
  brushSize: number;
  opacity: number;
  // Zoom level (1.0 = 100%)
  zoomLevel?: number;
  setZoomLevel?: (level: number) => void;
  resetTrigger?: number;
}

export interface HistoryPanelProps {
  onClear: () => void;
  onExport: () => void;
  onCheckpoint: () => void;
  onHistoryStepChange?: (step: number) => void;
  currentFrame: number;
  currentSlice: number;
  currentHistoryStep: number;
  historyData: HistoryEntry[];
}

export interface SegmentationSidebarProps {
  projectData: ProjectData;
  decodedMasks: Record<string, Uint8Array>;
  tool: DrawingTool;
  setTool: (tool: DrawingTool) => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  opacity: number;
  setOpacity: (opacity: number) => void;
  activeLabel: AnatomicalLabel;
  setActiveLabel: (label: AnatomicalLabel) => void;
  visibleMasks: Set<AnatomicalLabel>;
  setVisibleMasks: (masks: Set<AnatomicalLabel>) => void;
  handleUndo: () => void;
  handleRedo: () => void;
  handleClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  hasUnsavedChanges: boolean;
  isSaving?: boolean;
  onSave: () => void;
  onRevert?: () => void; // New: Revert to AI mask handler
  currentFrame: number;
  currentSlice: number;
  totalFrames: number;
  totalSlices: number;
  onFrameChange?: (frame: number) => void;
  onSliceChange?: (slice: number) => void;
  historyData: HistoryEntry[];
  currentHistoryStep?: number;
  onHistoryStepChange?: (step: number) => void;
  onHistoryClear?: () => void;
  onHistoryExport?: () => void;
  onHistoryCheckpoint?: () => void;
  // Zoom controls shared with drawing panel / image canvas
  zoomLevel?: number;
  setZoomLevel?: (level: number) => void;
  onReset?: () => void;
}

export const PERFORMANCE_CONSTANTS = {
  MAX_HISTORY_ENTRIES: 50,
  DRAW_THROTTLE_MS: 16, // ~60fps
  SLOW_OPERATION_THRESHOLD_MS: 100,
  IMAGE_LOAD_TIMEOUT_MS: 10000,
} as const;

// Utility functions for better error handling
export const isValidAnatomicalLabel = (label: string): label is AnatomicalLabel => {
  return ANATOMICAL_LABELS.includes(label as AnatomicalLabel);
};

export const isValidDrawingTool = (tool: string): tool is DrawingTool => {
  return DRAWING_TOOLS.includes(tool as DrawingTool);
};

// Centralized key generation to avoid duplication
export const generateMaskKey = (currentFrame: number, currentSlice: number, label: AnatomicalLabel): string => {
  return `editable_frame_${currentFrame}_slice_${currentSlice}_${label}`;
};

export const generateFrameSliceKey = (currentFrame: number, currentSlice: number): string => {
  return `frame_${currentFrame}_slice_${currentSlice}`;
};

export const generateFrameSlicePrefix = (currentFrame: number, currentSlice: number): string => {
  return `editable_frame_${currentFrame}_slice_${currentSlice}_`;
};