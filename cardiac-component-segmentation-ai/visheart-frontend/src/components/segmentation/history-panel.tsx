"use client";

import React, { useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { 
  History, 
  Save, 
  Clock, 
  Brush, 
  Eraser, 
  Trash2, 
  FolderOpen, 
  MapPin, 
  Edit3,
  Undo2,
  Redo2 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

// Import shared types from centralized file
import type { HistoryPanelProps, HistoryEntry } from "@/types/segmentation";
import { LABEL_COLORS, LABEL_NAMES } from "@/types/segmentation";

export function HistoryPanel({
  onClear,
  onCheckpoint,
  onHistoryStepChange,
  currentFrame = 0,
  currentSlice = 0,
  currentHistoryStep = 0,
  historyData = []
}: HistoryPanelProps) {

  // Memoized history processing - show last 15 entries, most recent first
  const processedHistory = useMemo(() => {
    return historyData.slice(-15).reverse();
  }, [historyData]);

  // Memoized time formatting with useCallback for function stability
  const formatTimeAgo = useCallback((timestamp: number) => {
    const diff = Math.floor((Date.now() - timestamp) / 60000);
    if (diff < 1) return "just now";
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return `${Math.floor(diff / 1440)}d ago`;
  }, []);

  // Component badge renderer - much simpler since we have componentLabel
  const renderComponentBadge = useCallback((entry: HistoryEntry) => {
    const label = entry.componentLabel || entry.maskChanges?.label;
    
    if (!label) return null;
    
    const color = LABEL_COLORS[label];
    const displayName = LABEL_NAMES[label];
    
    if (!color || !displayName) return null;

    return (
      <span 
        className={cn(
          "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ml-2",
          "border shadow-sm"
        )}
        style={{ 
          backgroundColor: `${color}20`,
          borderColor: `${color}60`,
          color: color
        }}
      >
        {label.toUpperCase()}
      </span>
    );
  }, []);
  
  // Icon mapping as a stable callback for render
  const getHistoryIcon = useCallback((type: HistoryEntry['type']) => {
  const iconMap: Record<string, React.ReactNode> = {
      brush: <Brush className="w-4 h-4 text-blue-500" />,
      eraser: <Eraser className="w-4 h-4 text-orange-500" />,
      clear: <Trash2 className="w-4 h-4 text-red-500" />,
      import: <FolderOpen className="w-4 h-4 text-green-500" />,
      checkpoint: <MapPin className="w-4 h-4 text-purple-500" />,
      undo: <Undo2 className="w-4 h-4 text-gray-500" />,
      redo: <Redo2 className="w-4 h-4 text-gray-500" />,
    };

    return iconMap[type] ?? <Edit3 className="w-4 h-4 text-muted-foreground" />;
  }, []);

  // Pre-calculated session statistics
  const sessionStats = useMemo(() => ({
    brushStrokes: historyData.filter(h => h.type === 'brush').length,
    eraserUses: historyData.filter(h => h.type === 'eraser').length,
    clearActions: historyData.filter(h => h.type === 'clear').length,
    checkpoints: historyData.filter(h => h.type === 'checkpoint').length,
  }), [historyData]);

  // History item click handler with proper typing
  const handleHistoryItemClick = useCallback((index: number) => {
    if (onHistoryStepChange) {
      // Convert display index back to actual history step
      const actualStep = historyData.length - 1 - index;
      onHistoryStepChange(actualStep);
    }
  }, [onHistoryStepChange, historyData.length]);

  return (
    <div className="space-y-6">
      
      {/* Current Session Info with enhanced layout */}
      <div className="p-3 bg-muted rounded-lg border">
        <div className={cn(
          "text-sm text-muted-foreground mb-2",
          "flex items-center gap-1"
        )}>
          <Clock className="w-4 h-4" />
          Current Session
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">
            Frame {currentFrame + 1}, Slice {currentSlice + 1}
          </div>
          <div className="text-xs text-muted-foreground">
            {historyData.length} action{historyData.length !== 1 ? 's' : ''} recorded
          </div>
        </div>
      </div>

      {/* History Timeline with enhanced scrolling */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">Recent Actions</h3>
        
        {processedHistory.length > 0 ? (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-2">
            {processedHistory.map((entry: HistoryEntry, index: number) => {
              const isCurrentStep = (historyData.length - 1 - index) === currentHistoryStep;
              
              return (
                <div 
                  key={entry.id} 
                  className={cn(
                    "p-3 rounded-md border transition-all duration-200 cursor-pointer",
                    "hover:shadow-sm",
                    isCurrentStep 
                      ? "bg-primary/10 border-primary/30 shadow-sm" 
                      : "bg-background border-border hover:bg-muted/50 hover:border-muted-foreground/20"
                  )}
                  onClick={() => handleHistoryItemClick(index)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {getHistoryIcon(entry.type)}
                    <span className="text-sm font-medium capitalize flex items-center">
                      {entry.type}
                      {renderComponentBadge(entry)}
                    </span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {formatTimeAgo(entry.timestamp)}
                    </span>
                  </div>
                  
                  <div className={cn(
                    "text-xs line-clamp-1",
                    entry.type === 'checkpoint' 
                      ? "text-xs text-purple-600 dark:text-purple-400 mt-1" 
                      : "text-muted-foreground"   
                  )}>
                    {entry.description}
                  </div>
                  
                  {entry.frameSlice && (
                    <div className="text-xs text-muted-foreground opacity-75 mt-1">
                      {entry.frameSlice}
                    </div>
                  )}
                  
                  {isCurrentStep && (
                    <div className="text-xs text-primary font-medium mt-2 flex items-center gap-1">
                      ← Current state
                    </div>
                  )}
                </div>
              );
            })}
            </div>
          </ScrollArea>
        ) : (
          <div className="text-center text-muted-foreground text-sm py-12">
            <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <div className="font-medium mb-1">No actions recorded yet</div>
            <div className="text-xs opacity-75">Start drawing to see your edit history</div>
          </div>
        )}
      </div>

      {/* History Management Actions with enhanced styling */}
      <div className="pt-4 border-t border-border">
        <h3 className="text-sm font-medium text-foreground mb-3">History Management</h3>
        <div className="space-y-2">
          <Button 
            variant="outline" 
            size="sm" 
            className={cn(
              "w-full justify-start text-xs",
              "hover:bg-purple-50 dark:hover:bg-purple-950",
              "hover:border-purple-200 dark:hover:border-purple-800",
              "transition-colors duration-200"
            )}
            onClick={onCheckpoint}
          >
            <Save className="w-4 h-4 mr-2" />
            Create Checkpoint
          </Button>
        </div>
      </div>

      {/* Session Statistics using memoized sessionStats */}
      <div className="pt-4 border-t border-border">
        <h3 className="text-sm font-medium text-foreground mb-3">Session Stats</h3>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex justify-between">
            <span>Brush Strokes:</span>
            <span>{sessionStats.brushStrokes}</span>
          </div>
          <div className="flex justify-between">
            <span>Eraser Uses:</span>
            <span>{sessionStats.eraserUses}</span>
          </div>
          <div className="flex justify-between">
            <span>Clear Actions:</span>
            <span>{sessionStats.clearActions}</span>
          </div>
          <div className="flex justify-between">
            <span>Checkpoints:</span>
            <span>{sessionStats.checkpoints}</span>
          </div>
        </div>
      </div>

      {/* Advanced Options with enhanced styling */}
      <div className="pt-4 border-t border-border">
        <h3 className="text-sm font-medium text-foreground mb-3">Advanced Options</h3>
        <Button 
          variant="outline" 
          size="sm" 
          className={cn(
            "w-full justify-start text-xs",
            "hover:bg-red-50 dark:hover:bg-red-950",
            "hover:border-red-200 dark:hover:border-red-800",
            "hover:text-red-600 dark:hover:text-red-400",
            "transition-colors duration-200"
          )}
          onClick={onClear}
          disabled={historyData.length === 0}
        >
          <History className="w-4 h-4 mr-2" />
          Clear History
          <span className="ml-auto text-xs text-muted-foreground">
            {historyData.length === 0 ? 'Empty' : 'Reset'}
          </span>
        </Button>
      </div>
    </div>
  );
}