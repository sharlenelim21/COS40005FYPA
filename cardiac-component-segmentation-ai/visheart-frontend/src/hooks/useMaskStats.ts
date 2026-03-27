import { useMemo } from 'react';
import type { AnatomicalLabel } from '@/types/segmentation';
import { LABEL_COLORS, LABEL_NAMES, isValidAnatomicalLabel, generateFrameSlicePrefix } from '@/types/segmentation';

interface UseMaskStatsProps {
  decodedMasks: Record<string, Uint8Array>;
  currentFrame: number;
  currentSlice: number;
  projectData: any;
}

interface MaskStats {
  label: AnatomicalLabel;
  maskKey: string;
  maskData: Uint8Array;
  totalPixels: number;
  filledPixels: number;
  percentage: number;
  color: string;
  labelName: string;
}

export function useMaskStats({
  decodedMasks,
  currentFrame,
  currentSlice,
  projectData
}: UseMaskStatsProps) {
  
  // Memoize frame slice prefix to avoid recalculation
  const frameSlicePrefix = useMemo(() => 
    generateFrameSlicePrefix(currentFrame, currentSlice), 
    [currentFrame, currentSlice]
  );

  // Memoize current masks with statistics - optimized for performance
  const currentMaskStats = useMemo((): MaskStats[] => {
    if (!decodedMasks) return [];

    const stats: MaskStats[] = [];
    
    for (const key in decodedMasks) {
      if (!key.startsWith(frameSlicePrefix)) continue;
      
      const maskData = decodedMasks[key];
      if (!maskData || maskData.length === 0) continue;
      
      const label = key.substring(frameSlicePrefix.length) as AnatomicalLabel;
      
      // Use validation function instead of property checks
      if (!isValidAnatomicalLabel(label)) continue;

      // Optimized pixel counting using typed array methods
      const totalPixels = maskData.length;
      let filledPixels = 0;
      for (let i = 0; i < totalPixels; i++) {
        if (maskData[i] > 0) filledPixels++;
      }
      
      const percentage = totalPixels > 0 ? (filledPixels / totalPixels) * 100 : 0;

      stats.push({
        label,
        maskKey: key,
        maskData,
        totalPixels,
        filledPixels,
        percentage,
        color: LABEL_COLORS[label],
        labelName: LABEL_NAMES[label]
      });
    }

    // Sort by label for consistent ordering
    return stats.sort((a, b) => a.label.localeCompare(b.label));
  }, [decodedMasks, frameSlicePrefix]);

  // Memoize project statistics with null safety
  const projectStats = useMemo(() => {
    const dimensions = projectData?.dimensions;
    
    // Cache editable mask count calculation
    let editableMaskCount = 0;
    if (decodedMasks) {
      for (const key in decodedMasks) {
        if (key.startsWith("editable_")) {
          editableMaskCount++;
        }
      }
    }

    return {
      totalMasks: editableMaskCount,
      width: dimensions?.width || 0,
      height: dimensions?.height || 0,
      frames: dimensions?.frames || 0,
      slices: dimensions?.slices || 0,
    };
  }, [decodedMasks, projectData?.dimensions]);

  // Memoize hasMasks boolean to prevent unnecessary rerenders
  const hasMasks = useMemo(() => currentMaskStats.length > 0, [currentMaskStats.length]);

  return {
    currentMaskStats,
    projectStats,
    hasMasks
  };
}
