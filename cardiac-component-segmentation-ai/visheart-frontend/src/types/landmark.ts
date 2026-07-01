export type LandmarkCoord = [number, number];

export interface FramePrediction {
  frame_id: number;                   // 0-indexed cardiac phase frame
  slice_id?: number;                  // 0-indexed MRI slice, when returned by the backend
  rv_insertion_1: LandmarkCoord;      // RV insertion point A  [x, y]
  rv_insertion_2: LandmarkCoord;      // RV insertion point B  [x, y]
  apex?: LandmarkCoord;
  basal_anterior?: LandmarkCoord;
  basal_inferior?: LandmarkCoord;
  basal_lateral?: LandmarkCoord;
  mid_anterior?: LandmarkCoord;
  // Per-slice quality fields returned by the new GPU inference
  flag?: "normal" | "collapsed_to_mean";
  confidence?: "high" | "low";
  model_used?: "2ch" | "1ch_fallback";
  display_mean?: { x: number; y: number } | null;
  hm1_max?: number;
  hm2_max?: number;
  lm_dist?: number;
}

export interface LandmarkInferenceResponse {
  predictions: FramePrediction[];
  total_frames: number;
  model_used: string;
  image_dimensions: { width: number; height: number };
  // Top-level summary stats from new GPU response
  avg_lm1?: { x: number; y: number };
  avg_lm2?: { x: number; y: number };
  n_total?: number;
  n_collapsed?: number;
  n_2ch?: number;
  n_1ch_fallback?: number;
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
  playbackFps: number;
  error: string | null;
  modelUsed: string;
  replacementFile: File | null;
  // Summary stats from new GPU response (optional — absent on stub / old format)
  avgLm1?: { x: number; y: number };
  avgLm2?: { x: number; y: number };
  nTotal?: number;
  nCollapsed?: number;
  n2ch?: number;
  n1chFallback?: number;
}

// ── Persisted landmark doc (backend IProjectLandmark shape) ─────────────────
// Mirrors the DB schema in Cardiac_Segmentation_FYP_Server/src/types/database_types.ts.
export interface PersistedLandmarkPoint {
  key: string;
  x: number;
  y: number;
  flag?: "normal" | "collapsed_to_mean";
  confidence?: "high" | "low";
}

export interface PersistedLandmarkDoc {
  _id?: string;
  projectid: string;
  name: string;
  description?: string;
  isSaved: boolean;
  isModelOutput: boolean;
  segmentationModel?: "medsam" | "unet";
  landmarkModel?: string;
  frames: {
    frameindex: number;
    frameinferred: boolean;
    slices: {
      sliceindex: number;
      landmarks: PersistedLandmarkPoint[];
    }[];
  }[];
}

const LANDMARK_POINT_KEYS = [
  "rv_insertion_1",
  "rv_insertion_2",
  "apex",
  "basal_anterior",
  "basal_inferior",
  "basal_lateral",
  "mid_anterior",
] as const;

/** Flattens FramePrediction[] merged with local landmarkEdits into the nested
 *  frames[].slices[].landmarks[] shape the backend save-landmarks endpoint expects. */
export function framePredictionsToLandmarkFrames(
  predictions: FramePrediction[],
  edits: Record<string, Partial<FramePrediction>>,
): PersistedLandmarkDoc["frames"] {
  const framesMap = new Map<number, PersistedLandmarkDoc["frames"][0]>();

  for (const pred of predictions) {
    const sliceId = pred.slice_id ?? 0;
    const edit = edits[`${pred.frame_id}:${sliceId}`] ?? {};
    const merged = { ...pred, ...edit } as FramePrediction;

    const landmarks: PersistedLandmarkPoint[] = [];
    for (const key of LANDMARK_POINT_KEYS) {
      const coord = getLandmarkCoord(merged, key);
      if (!coord) continue;
      landmarks.push({
        key,
        x: coord[0],
        y: coord[1],
        flag: merged.flag,
        confidence: merged.confidence,
      });
    }

    let frame = framesMap.get(pred.frame_id);
    if (!frame) {
      frame = { frameindex: pred.frame_id, frameinferred: true, slices: [] };
      framesMap.set(pred.frame_id, frame);
    }
    frame.slices.push({ sliceindex: sliceId, landmarks });
  }

  return Array.from(framesMap.values()).sort((a, b) => a.frameindex - b.frameindex);
}

/** Converts a loaded PersistedLandmarkDoc back into the Record<"frame:slice", Partial<FramePrediction>>
 *  shape landmarkEdits already uses, so it can be dropped straight into setLandmarkEdits.
 *
 *  Saved docs always contain every slice (edited or not — see framePredictionsToLandmarkFrames),
 *  so a slice that was never actually edited by the user is still present with its original
 *  "collapsed_to_mean" flag. If that got copied into landmarkEdits verbatim, the very first drag
 *  on that slice would see "flag" already present in the existing edit entry and skip the
 *  collapsed->normal promotion in handleLandmarkMove — permanently stuck showing the mean-point
 *  indicator even after a real edit moved the points away from it. Only reconstruct an edit entry
 *  for slices that were genuinely promoted to "normal"; leave untouched collapsed slices with no
 *  entry so they keep falling back to the raw AI prediction (and its collapsed_to_mean flag).
 */
export function landmarkFramesToEdits(
  doc: PersistedLandmarkDoc | null | undefined,
): Record<string, Partial<FramePrediction>> {
  const edits: Record<string, Partial<FramePrediction>> = {};
  if (!doc?.frames) return edits;

  for (const frame of doc.frames) {
    for (const slice of frame.slices ?? []) {
      if (slice.landmarks?.some((p) => p.flag === "collapsed_to_mean")) continue;

      const key = `${frame.frameindex}:${slice.sliceindex}`;
      const entry: Partial<FramePrediction> = {};
      for (const point of slice.landmarks ?? []) {
        (entry as Record<string, unknown>)[point.key] = [point.x, point.y] as LandmarkCoord;
        if (point.flag) entry.flag = point.flag;
        if (point.confidence) entry.confidence = point.confidence;
      }
      if (Object.keys(entry).length > 0) {
        edits[key] = entry;
      }
    }
  }
  return edits;
}

export const AHA_SEGMENT_COLORS: string[] = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6",  // basal  1–6
  "#f43f5e", "#fb923c", "#facc15", "#4ade80", "#2dd4bf", "#60a5fa",  // mid    7–12
  "#e11d48", "#ea580c", "#ca8a04", "#16a34a",                         // apical 13–16
  "#0d9488",                                                            // apex   17
];
