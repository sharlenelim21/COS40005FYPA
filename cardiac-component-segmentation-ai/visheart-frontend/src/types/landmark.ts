export type LandmarkCoord = [number, number];

export interface FramePrediction {
  frame_id: number;                   // 0-indexed cardiac phase frame
  slice_id?: number;                  // 0-indexed slice used for this prediction
  rv_insertion_1: LandmarkCoord;      // RV insertion point A  [x, y]
  rv_insertion_2: LandmarkCoord;      // RV insertion point B  [x, y]
  apex?: LandmarkCoord;
  basal_anterior?: LandmarkCoord;
  basal_inferior?: LandmarkCoord;
  basal_lateral?: LandmarkCoord;
  mid_anterior?: LandmarkCoord;
}

export interface LandmarkInferenceResponse {
  predictions: FramePrediction[];
  total_frames: number;
  model_used: string;
  image_dimensions: { width: number; height: number };
}

export interface LandmarkDefinition {
  id: keyof Omit<FramePrediction, "frame_id">;  
  label: string;
  color: string;
  shape: "circle" | "square";
  priority: number;
}

export const LANDMARK_DEFINITIONS: LandmarkDefinition[] = [
  { id: "rv_insertion_1", label: "RV Insertion 1", color: "#ef4444", shape: "circle", priority: 10 },
  { id: "rv_insertion_2", label: "RV Insertion 2", color: "#3b82f6", shape: "circle", priority: 9  },
  { id: "apex",           label: "Apex",           color: "#22c55e", shape: "circle", priority: 8  },
  { id: "basal_anterior", label: "Basal Anterior", color: "#60a5fa", shape: "circle", priority: 7  },
  { id: "basal_inferior", label: "Basal Inferior", color: "#fb923c", shape: "circle", priority: 6  },
  { id: "basal_lateral",  label: "Basal Lateral",  color: "#e879f9", shape: "circle", priority: 5  },
  { id: "mid_anterior",   label: "Mid Anterior",   color: "#a78bfa", shape: "circle", priority: 4  },
];

export function getLandmarkCoord(
  pred: FramePrediction | null | undefined,
  id: string,
): LandmarkCoord | undefined {
  if (!pred) return undefined;
  const val = (pred as unknown as Record<string, unknown>)[id];
  if (!Array.isArray(val) || val.length < 2) return undefined;
  return val as LandmarkCoord;
}

export type LandmarkPageStatus =
  | "idle"      
  | "running"    
  | "done"     
  | "error";     

export interface LandmarkPageState {
  status: LandmarkPageStatus;
  predictions: FramePrediction[];
  totalFrames: number;
  imageDimensions: { width: number; height: number };
  currentFrame: number;   
  isPlaying: boolean;
  playbackSpeed: number;
  error: string | null;
  modelUsed: string;
  replacementFile: File | null;
}

export const AHA_SEGMENT_COLORS: string[] = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6",  // basal  1–6
  "#f43f5e", "#fb923c", "#facc15", "#4ade80", "#2dd4bf", "#60a5fa",  // mid    7–12
  "#e11d48", "#ea580c", "#ca8a04", "#16a34a",                         // apical 13–16
  "#0d9488",                                                            // apex   17
];
