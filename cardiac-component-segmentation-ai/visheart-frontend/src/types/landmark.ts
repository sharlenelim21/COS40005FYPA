// Core landmark coordinate type
/** [x, y] pixel coordinate in image space (256×256 normalised) */
export type LandmarkCoord = [number, number];

// Per-frame prediction shape from backend 
/**
 * Stub endpoint returns this shape per frame.
 * Real model (EPIC 3/5) will return identical JSON so the frontend needs no changes.
*/
export interface FramePrediction {
  frame_id: number;          // 0-indexed frame number
  rv_insertion_1: LandmarkCoord;  // RV insertion point A  [x, y]
  rv_insertion_2: LandmarkCoord;  // RV insertion point B  [x, y]
  // Extended fields — populated by real model, optional from stub
  apex?: LandmarkCoord;
  basal_anterior?: LandmarkCoord;
  basal_inferior?: LandmarkCoord;
  basal_lateral?: LandmarkCoord;
  mid_anterior?: LandmarkCoord;
}

// Full inference response 
export interface LandmarkInferenceResponse {
  predictions: FramePrediction[];  
  total_frames: number;
  model_used: string;          
  image_dimensions: { width: number; height: number };
}

// Landmark definition (for rendering) 
export interface LandmarkDefinition {
  id: string;
  label: string;
  color: string;
  shape: "circle" | "square" | "diamond";
  /** Priority order — lower = rendered on top */
  priority: number;
}

export const LANDMARK_DEFINITIONS: LandmarkDefinition[] = [
  { id: "rv_insertion_1", label: "RV Insertion 1", color: "#ef4444", shape: "circle",  priority: 1 },
  { id: "rv_insertion_2", label: "RV Insertion 2", color: "#3b82f6", shape: "circle",  priority: 2 },
  { id: "apex",           label: "Apex",           color: "#22c55e", shape: "circle",  priority: 3 },
  { id: "basal_anterior", label: "Basal Anterior", color: "#60a5fa", shape: "circle",  priority: 4 },
  { id: "basal_inferior", label: "Basal Inferior", color: "#fb923c", shape: "circle",  priority: 5 },
  { id: "basal_lateral",  label: "Basal Lateral",  color: "#e879f9", shape: "circle",  priority: 6 },
  { id: "mid_anterior",   label: "Mid Anterior",   color: "#a78bfa", shape: "circle",  priority: 7 },
];

/** Extract a named coord from a FramePrediction, returning undefined if missing. */
export function getLandmarkCoord(
  pred: FramePrediction | null | undefined,
  id: string,
): LandmarkCoord | undefined {
  if (!pred) return undefined;
  return (pred as Record<string, unknown>)[id] as LandmarkCoord | undefined;
}

// Page state 
export type LandmarkPageStatus =
  | "idle"           // no file yet
  | "uploading"      // file being sent
  | "running"        // inference in progress
  | "done"           // predictions ready
  | "error";         // something went wrong

export interface LandmarkPageState {
  status: LandmarkPageStatus;
  uploadedFile: File | null;
  predictions: FramePrediction[];          // cached per-frame results
  totalFrames: number;
  imageDimensions: { width: number; height: number };
  currentFrame: number;                    // 0-indexed
  isPlaying: boolean;
  error: string | null;
  modelUsed: string;
}

// AHA-17 segment colours (for right-panel preview) 
export const AHA_SEGMENT_COLORS: string[] = [
  // Basal 1-6
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6",
  // Mid 7-12
  "#f43f5e", "#fb923c", "#facc15", "#4ade80", "#2dd4bf", "#60a5fa",
  // Apical 13-16
  "#e11d48", "#ea580c", "#ca8a04", "#16a34a",
  // Apex 17
  "#0d9488",
];
