import api from "@/lib/api";

/**
 * Smooth heart motion for the landmark page (backend services/reconstruction_motion.ts, GPU motion_mesh.py): the
 * end-diastole mesh of a 4D reconstruction carried through every frame, in that mesh file's own vertex order. The
 * page keeps the ED mesh, its ED AHA labels and its ED orientation, and only moves the vertices from frame to frame.
 */
export interface MotionData {
  frames: number[];            // frame numbers, contiguous, as in the reconstruction's file names (0-based)
  edFrame: number;
  vertexCount: number;
  positions: Float32Array[];   // one per frame: vertexCount x 3, the ED mesh's raw (file) coordinates
}

export type MotionStatus =
  | { status: "missing" }
  | { status: "processing"; startedAt: string }
  | { status: "failed"; error: string }
  | { status: "ready"; url: string };

/** Reads the VHMO file: magic, version, JSON header, then int16 positions (offset + q * scale per axis). */
export function decodeMotion(buffer: ArrayBuffer): MotionData {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== "VHMO") throw new Error("Not a VisHeart motion file.");
  const headerLength = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, headerLength)));
  const frames: number[] = header.frames;
  const vertexCount: number = header.vertexCount;
  const [ox, oy, oz] = header.offset as number[];
  const [sx, sy, sz] = header.scale as number[];
  const values = new Int16Array(buffer, 12 + headerLength, frames.length * vertexCount * 3);
  const positions = frames.map((_, frameIndex) => {
    const out = new Float32Array(vertexCount * 3);
    const start = frameIndex * vertexCount * 3;
    for (let i = 0; i < vertexCount; i++) {
      out[i * 3] = ox + values[start + i * 3] * sx;
      out[i * 3 + 1] = oy + values[start + i * 3 + 1] * sy;
      out[i * 3 + 2] = oz + values[start + i * 3 + 2] * sz;
    }
    return out;
  });
  return { frames, edFrame: header.edFrame, vertexCount, positions };
}

/** The vertex positions at `frame`, or null when the motion does not cover it. */
export function framePositions(motion: MotionData, frame: number): Float32Array | null {
  const index = frame - motion.frames[0];
  return index >= 0 && index < motion.positions.length ? motion.positions[index] : null;
}

export const reconstructionMotionApi = {
  status: async (projectId: string, reconstructionId: string): Promise<MotionStatus> => {
    const response = await api.get(`/reconstruction/motion/${projectId}/${reconstructionId}`);
    return response.data.motion as MotionStatus;
  },
  start: async (projectId: string, reconstructionId: string, retry = false): Promise<MotionStatus> => {
    const response = await api.post(`/reconstruction/motion/${projectId}/${reconstructionId}`, { retry });
    return response.data.motion as MotionStatus;
  },
};
