import { useState, useCallback, useMemo, useRef } from 'react';
import type { HistoryEntry, AnatomicalLabel } from '@/types/segmentation';
import { generateFrameSliceKey } from '@/types/segmentation';

interface UseSegmentationHistoryProps {
  currentFrame: number;
  currentSlice: number;
  decodedMasks: Record<string, Uint8Array> | null;
}

const MAX_HISTORY_ENTRIES = 50;

export function useSegmentationHistory({
  currentFrame,
  currentSlice,
  decodedMasks
}: UseSegmentationHistoryProps) {
  const [histories, setHistories] = useState<Record<string, HistoryEntry[]>>({});
  const [steps, setSteps] = useState<Record<string, number>>({});
  const historyIdCounter = useRef(0);

  // Memoize current key to avoid recalculation
  const currentKey = useMemo(() => 
    generateFrameSliceKey(currentFrame, currentSlice), 
    [currentFrame, currentSlice]
  );

  // Memoize current history and step with better null safety
  const currentHistory = useMemo(() => histories[currentKey] || [], [histories, currentKey]);
  const currentStep = useMemo(() => steps[currentKey] || 0, [steps, currentKey]);

  // Memoize computed values to prevent unnecessary recalculations
  const canUndo = useMemo(() => currentStep > 0, [currentStep]);
  const canRedo = useMemo(() => currentStep < currentHistory.length - 1, [currentStep, currentHistory.length]);

  // Optimized create entry function with proper typing
  const createEntry = useCallback((
    type: HistoryEntry["type"],
    description: string,
    masksSnapshot: Record<string, Uint8Array>,
    maskChanges?: HistoryEntry["maskChanges"],
    componentLabel?: AnatomicalLabel
  ): HistoryEntry => {
    return {
      id: `history_${Date.now()}_${++historyIdCounter.current}`,
      type,
      description,
      timestamp: Date.now(),
      frameSlice: `Frame ${currentFrame + 1}, Slice ${currentSlice + 1}`,
      maskChanges,
      // Deep clone masks to prevent references
      masksSnapshot: Object.fromEntries(
        Object.entries(masksSnapshot).map(([key, data]) => [key, new Uint8Array(data)])
      ),
      componentLabel,
    };
  }, [currentFrame, currentSlice]);

  // Optimized add to history with batch updates
  const addToHistory = useCallback((entry: HistoryEntry) => {
    const key = currentKey;
    
    setHistories(prev => {
      const current = prev[key] || [];
      const currentStepValue = steps[key] || 0;
      
      // Truncate future history if we're not at the end
      const newHistory = current.slice(0, currentStepValue + 1);
      newHistory.push(entry);
      
      // Keep only last MAX_HISTORY_ENTRIES entries
      const trimmed = newHistory.slice(-MAX_HISTORY_ENTRIES);
      
      return { ...prev, [key]: trimmed };
    });

    setSteps(prev => {
      const newStep = (prev[key] || 0) + 1;
      return { ...prev, [key]: Math.min(newStep, MAX_HISTORY_ENTRIES - 1) };
    });
  }, [currentKey, steps]);

  // Optimized navigate to step with bounds checking
  const navigateToStep = useCallback((step: number) => {
    if (step < 0 || step >= currentHistory.length) return null;
    
    setSteps(prev => ({ ...prev, [currentKey]: step }));
    return currentHistory[step];
  }, [currentHistory, currentKey]);

  // Optimized initialize function with duplicate check
  const initialize = useCallback((initialMasks: Record<string, Uint8Array>) => {
    const key = currentKey;
    
    // Prevent duplicate initialization
    if (histories[key]) return;
    
    const initialEntry = createEntry("import", "Project loaded", initialMasks);
    
    setHistories(prev => ({ ...prev, [key]: [initialEntry] }));
    setSteps(prev => ({ ...prev, [key]: 0 }));
  }, [currentKey, histories, createEntry]);

  // Optimized clear function
  const clear = useCallback(() => {
    if (!decodedMasks) return;
    
    const key = currentKey;
    const clearEntry = createEntry("clear", "History cleared", decodedMasks);
    
    setHistories(prev => ({ ...prev, [key]: [clearEntry] }));
    setSteps(prev => ({ ...prev, [key]: 0 }));
  }, [currentKey, createEntry, decodedMasks]);

  return {
    currentHistory,
    currentStep,
    canUndo,
    canRedo,
    createEntry,
    addToHistory,
    navigateToStep,
    initialize,
    clear
  };
}
