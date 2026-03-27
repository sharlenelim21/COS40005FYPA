/**
 * RLE (Run-Length Encoding) utilities for segmentation masks
 * Compatible with the format used by the VisHeart GPU inference server
 * Based on the Python script: app/scripts/_decode_rle.py
 */
import * as ProjectTypes from "@/types/project";

/**
 * Decodes a Run-Length Encoded string into a binary mask array
 * 
 * @param rleString - Space-separated RLE string (e.g., "100 5 200 3")
 * @param height - Height of the output mask
 * @param width - Width of the output mask
 * @returns Uint8Array representing the binary mask (0s and 1s)
 */
export function rleDecodeToArray(
  rleString: string,
  height: number,
  width: number,
): Uint8Array {
  if (!rleString || typeof rleString !== "string") {
    return new Uint8Array(height * width);
  }

  const runs = rleString
    .split(" ")
    .map((x) => parseInt(x, 10))
    .filter((x) => !isNaN(x));
  const size = height * width;
  const mask = new Uint8Array(size);

  // The encoding alternates between run-starts and run-lengths
  // runs[0] = start position, runs[1] = length, runs[2] = next start, runs[3] = next length, etc.
  // for (let i = 0; i < runs.length; i += 2) {
  //   const startIdx = runs[i];
  //   const runLength = runs[i + 1];
  //   if (
  //     startIdx !== undefined &&
  //     runLength !== undefined &&
  //     startIdx < size
  //   ) {
  //     const endIdx = Math.min(startIdx + runLength, size);
  //     for (let j = startIdx; j < endIdx; j++) {
  //       mask[j] = 1;
  //     }
  //   }
  // }
  for (let i = 0; i < runs.length; i += 2) {
    const startIdx = runs[i];
    const runLength = runs[i + 1];
    if (startIdx !== undefined && runLength !== undefined && startIdx < size) {
      const endIdx = Math.min(startIdx + runLength, size);
      mask.fill(1, startIdx, endIdx);
    }
  }

  return mask;
}

/**
 * Encodes a binary mask array into RLE (Run-Length Encoding) string format
 * Compatible with the backend's expected RLE format
 * 
 * @param mask - Uint8Array representing the binary mask (0s and 1s)
 * @returns RLE-encoded string (space-separated start positions and lengths)
 */
export function rleEncodeFromArray(mask: Uint8Array): string {
  if (!mask || mask.length === 0) {
    return "";
  }

  const runs: number[] = [];
  let isInRun = false;
  let runStart = 0;

  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1 && !isInRun) {
      // Start of a new run of 1s
      runStart = i;
      isInRun = true;
    } else if (mask[i] === 0 && isInRun) {
      // End of current run, record start position and length
      runs.push(runStart, i - runStart);
      isInRun = false;
    }
  }

  // Handle case where mask ends with a run of 1s
  if (isInRun) {
    runs.push(runStart, mask.length - runStart);
  }

  return runs.join(' ');
}

/**
 * Interface for decoded masks result
 */
export interface DecodedMasks {
  masks: Record<string, Uint8Array>;
}

/**
 * Function to decode all RLE masks from segmentation data
 * 
 * @param masks - Array of all segmentation masks to decode
 * @param projectDimensions - Project dimensions (width and height)
 * @returns DecodedMasks object containing all decoded masks
 */
export function decodeSegmentationMasks(
  masks: ProjectTypes.BaseSegmentationMask[],
  width: number,
  height: number,
): DecodedMasks {
  const decodedMasks: Record<string, Uint8Array> = {};

  // Decode masks
  masks.forEach((maskData) => {
    if (maskData.frames) {
      maskData.frames.forEach((frame: ProjectTypes.FrameData) => {
        if (frame.slices) {
          frame.slices.forEach((slice: ProjectTypes.SliceData) => {
            if (slice.segmentationmasks) {
              slice.segmentationmasks.forEach((mask: ProjectTypes.SegmentationMaskContent) => {
                // Use actual frame.frameindex and slice.sliceindex instead of forEach indices
                const maskType = maskData.isMedSAMOutput ? "medSamOutput" : "editable";
                const maskKey = `${maskType}_frame_${frame.frameindex}_slice_${slice.sliceindex}_${mask.class}`;
                const decodedMask = rleDecodeToArray(
                  mask.segmentationmaskcontents,
                  height,
                  width,
                );
                decodedMasks[maskKey] = decodedMask;
              });
            }
          });
        }
      });
    }
  });

  console.log(`Decoded ${Object.keys(decodedMasks).length} total masks`);

  return {
    masks: decodedMasks,
  };
}

/**
 * Utility function to get mask statistics
 * 
 * @param mask - Uint8Array mask
 * @returns Object with mask statistics
 */
export function getMaskStats(mask: Uint8Array) {
  const totalPixels = mask.length;
  const nonZeroPixels = mask.filter((v) => v > 0).length;
  const coverage = nonZeroPixels / totalPixels;

  return {
    totalPixels,
    nonZeroPixels,
    coverage,
  };
}

/**
 * Utility function to convert mask to ImageData for canvas rendering
 * 
 * @param mask - Uint8Array mask
 * @param width - Width of the mask
 * @param height - Height of the mask
 * @param color - RGBA color for the mask [r, g, b, a] (default: semi-transparent red)
 * @returns Uint8ClampedArray suitable for ImageData constructor
 */
export function maskToImageData(
  mask: Uint8Array,
  width: number,
  height: number,
  color: [number, number, number, number] = [255, 0, 0, 128],
): Uint8ClampedArray {
  const imageData = new Uint8ClampedArray(width * height * 4);
  const [r, g, b, a] = color;

  for (let i = 0; i < mask.length; i++) {
    const pixelIndex = i * 4;
    if (mask[i] === 1) {
      imageData[pixelIndex] = r;     // Red
      imageData[pixelIndex + 1] = g; // Green
      imageData[pixelIndex + 2] = b; // Blue
      imageData[pixelIndex + 3] = a; // Alpha
    }
    // Transparent pixels are already 0 from Uint8ClampedArray initialization
  }

  return imageData;
}

/**
 * Parse an editable mask key to extract frame, slice, and class information
 * 
 * @param key - Key in format "editable_frame_0_slice_1_class1"
 * @returns Parsed information or null if invalid format
 */
export function parseEditableKey(key: string): { frameIndex: number; sliceIndex: number; className: string } | null {
  if (!key.startsWith('editable_')) {
    return null;
  }

  const parts = key.split('_');
  // Expected format: ["editable", "frame", "0", "slice", "1", "class1"]
  if (parts.length !== 6 || parts[1] !== 'frame' || parts[3] !== 'slice') {
    return null;
  }

  const frameIndex = parseInt(parts[2], 10);
  const sliceIndex = parseInt(parts[4], 10);
  const className = parts[5];

  if (isNaN(frameIndex) || isNaN(sliceIndex) || !className) {
    return null;
  }

  return { frameIndex, sliceIndex, className };
}

/**
 * Convert editable masks to backend-compatible frame structure
 * 
 * @param editableMasks - Object containing editable mask data
 * @returns Array of frames in backend-expected format
 */
export function createFramesStructureFromEditableMasks(
  editableMasks: Record<string, Uint8Array>
): ProjectTypes.FrameData[] {
  const frameMap = new Map<string, Map<string, Array<{ class: ProjectTypes.ComponentBoundingBoxesClass; segmentationmaskcontents: string }>>>();

  // Helper function to convert string class names to enum values
  const mapClassNameToEnum = (className: string): ProjectTypes.ComponentBoundingBoxesClass => {
    switch (className.toLowerCase()) {
      case 'rv':
        return ProjectTypes.ComponentBoundingBoxesClass.RV;
      case 'myo':
        return ProjectTypes.ComponentBoundingBoxesClass.MYO;
      case 'lvc':
        return ProjectTypes.ComponentBoundingBoxesClass.LVC;
      case 'manual':
        return ProjectTypes.ComponentBoundingBoxesClass.MANUAL;
      default:
        console.warn(`Unknown class name: ${className}, defaulting to MANUAL`);
        return ProjectTypes.ComponentBoundingBoxesClass.MANUAL;
    }
  };

  Object.entries(editableMasks).forEach(([key, maskData]) => {
    const parsed = parseEditableKey(key);
    if (!parsed) {
      console.warn(`Invalid editable key format: ${key}`);
      return;
    }

    const { frameIndex, sliceIndex, className } = parsed;
    const frameKey = `frame_${frameIndex}`;
    const sliceKey = `slice_${sliceIndex}`;

    // Initialize frame if not exists
    if (!frameMap.has(frameKey)) {
      frameMap.set(frameKey, new Map());
    }

    // Initialize slice if not exists
    const frameSliceMap = frameMap.get(frameKey)!;
    if (!frameSliceMap.has(sliceKey)) {
      frameSliceMap.set(sliceKey, []);
    }

    // Convert mask to RLE and add to segmentationmasks
    const rleString = rleEncodeFromArray(maskData);
    const enumClass = mapClassNameToEnum(className);

    frameSliceMap.get(sliceKey)!.push({
      class: enumClass,
      segmentationmaskcontents: rleString
    });
  });

  // Convert Maps to the array structure expected by backend
  return Array.from(frameMap.entries()).map(([frameKey, sliceMap]) => ({
    frameindex: parseInt(frameKey.split('_')[1], 10),
    frameinferred: true,
    slices: Array.from(sliceMap.entries()).map(([sliceKey, masks]) => ({
      sliceindex: parseInt(sliceKey.split('_')[1], 10),
      segmentationmasks: masks
    }))
  }));
}
