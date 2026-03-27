"use client";

import { useState, useEffect, useCallback } from "react";
import { useProject } from "@/context/ProjectContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Box, Download, RefreshCw, AlertCircle, CheckCircle, XCircle, Database } from "lucide-react";
import { ReconstructionGLBViewer } from "@/components/reconstruction/ReconstructionGLBViewer";

export function ReconstructionDebugCard() {
  const {
    hasReconstructions,
    reconstructionMetadata,
    reconstructionCacheReady,
    reconstructionCacheError,
    getReconstructionGLB,
    preloadReconstructionModels,
    clearReconstructionCache,
    refreshReconstructions
  } = useProject();

  const [selectedFrame, setSelectedFrame] = useState(0);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadModel = useCallback(async (frame: number) => {
    console.log(`[DebugCard] 🎬 Starting to load model for frame ${frame}...`);
    console.log(`[DebugCard] 📊 Current state:`, {
      hasReconstructions,
      reconstructionCacheReady,
      reconstructionCacheError,
      reconstructionMetadata: reconstructionMetadata ? {
        id: reconstructionMetadata.reconstructionId,
        name: reconstructionMetadata.name
      } : null
    });
    
    setIsLoading(true);
    setError(null);
    
    try {
      console.log(`[DebugCard] 📞 Calling getReconstructionGLB(${frame})...`);
      const startTime = performance.now();
      
      const url = await getReconstructionGLB(frame);
      
      const elapsedTime = ((performance.now() - startTime) / 1000).toFixed(2);
      console.log(`[DebugCard] ⏱️ getReconstructionGLB completed in ${elapsedTime}s`);
      
      if (url) {
        console.log(`[DebugCard] ✅ Successfully loaded GLB for frame ${frame}:`, {
          url: url.substring(0, 100) + '...',
          urlLength: url.length,
          isValidBlobUrl: url.startsWith('blob:'),
          elapsedTime: `${elapsedTime}s`
        });
        setModelUrl(url);
        setSelectedFrame(frame);
      } else {
        const errorMsg = `Failed to load GLB for frame ${frame} - getReconstructionGLB returned null`;
        console.error(`[DebugCard] ❌ ${errorMsg}`);
        setError(errorMsg);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      console.error(`[DebugCard] 💥 Exception while loading frame ${frame}:`, {
        error: errorMsg,
        stack: err instanceof Error ? err.stack : undefined
      });
      setError(errorMsg);
    } finally {
      setIsLoading(false);
      console.log(`[DebugCard] 🏁 Load model completed for frame ${frame}`);
    }
  }, [getReconstructionGLB, hasReconstructions, reconstructionCacheReady, reconstructionCacheError, reconstructionMetadata]);

  // Auto-load first frame on mount when cache is ready
  useEffect(() => {
    if (hasReconstructions && reconstructionCacheReady && selectedFrame === 0 && !modelUrl) {
      console.log(`[DebugCard] 🚀 Auto-loading frame 0 on cache ready...`);
      loadModel(0);
    }
  }, [hasReconstructions, reconstructionCacheReady, selectedFrame, modelUrl, loadModel]);

  const handlePreload = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await preloadReconstructionModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preload models");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearCache = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await clearReconstructionCache();
      setModelUrl(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear cache");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await refreshReconstructions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setIsLoading(false);
    }
  };

  if (!hasReconstructions) {
    return (
      <Card className="border-dashed border-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Box className="h-5 w-5" />
            Reconstruction Debug (No Models)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 space-y-3">
            <div className="w-16 h-16 mx-auto rounded-lg bg-muted/50 flex items-center justify-center">
              <Box className="h-8 w-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-muted-foreground">No 4D Reconstruction</h3>
              <p className="text-sm text-muted-foreground">Create a reconstruction to see debug info</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Box className="h-5 w-5 text-amber-600" />
            <span className="text-amber-900 dark:text-amber-100">Reconstruction Debug</span>
            <Badge variant="outline" className="ml-2 border-amber-500 text-amber-700">
              TEMPORARY
            </Badge>
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={isLoading}>
              <RefreshCw className={`h-3 w-3 mr-1 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Row */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
          <div className="flex items-center gap-2">
            {reconstructionCacheReady ? (
              <CheckCircle className="h-4 w-4 text-green-600" />
            ) : reconstructionCacheError ? (
              <XCircle className="h-4 w-4 text-red-600" />
            ) : (
              <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
            )}
            <span className="text-sm font-medium">
              Cache Status: {reconstructionCacheReady ? "Ready" : reconstructionCacheError ? "Error" : "Loading..."}
            </span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handlePreload} disabled={isLoading || reconstructionCacheReady}>
              <Download className="h-3 w-3 mr-1" />
              Preload
            </Button>
            <Button size="sm" variant="outline" onClick={handleClearCache} disabled={isLoading}>
              <Database className="h-3 w-3 mr-1" />
              Clear Cache
            </Button>
          </div>
        </div>

        {/* Metadata */}
        {reconstructionMetadata && (
          <div className="p-3 rounded-lg bg-background/50 space-y-2">
            <h4 className="font-semibold text-sm">Metadata:</h4>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div>
                <span className="text-muted-foreground">ID:</span>
                <p className="truncate">{reconstructionMetadata.reconstructionId}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Name:</span>
                <p className="truncate">{reconstructionMetadata.name}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Format:</span>
                <p>{reconstructionMetadata.meshFormat || "GLB"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">File Size:</span>
                <p>{reconstructionMetadata.meshFileSize ? `${(reconstructionMetadata.meshFileSize / 1024 / 1024).toFixed(2)} MB` : "N/A"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Has Download URL:</span>
                <p>{reconstructionMetadata.downloadUrl ? "Yes" : "No"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Created:</span>
                <p>{new Date(reconstructionMetadata.createdAt).toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {(error || reconstructionCacheError) && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p className="font-semibold">Error:</p>
                <p className="text-xs font-mono break-all">{error || reconstructionCacheError}</p>
                <p className="text-xs mt-2">
                  💡 <strong>Troubleshooting:</strong> Check the browser console (F12) for detailed error logs.
                  Look for messages starting with [ReconstructionCache] to see the exact failure point.
                </p>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* 3D Viewer */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm">3D Model Viewer:</h4>
          <ReconstructionGLBViewer
            modelUrl={modelUrl}
            frame={selectedFrame}
            className="w-full h-[400px]"
          />
        </div>

        {/* Frame Selector */}
        <div className="space-y-2">
          <h4 className="font-semibold text-sm">Load Frame:</h4>
          <ScrollArea className="h-24">
            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: 30 }, (_, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant={selectedFrame === i && modelUrl ? "default" : "outline"}
                  onClick={() => loadModel(i)}
                  disabled={isLoading}
                  className="h-8"
                >
                  {i}
                </Button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Status Indicator */}
        {modelUrl && (
          <div className="flex items-center justify-center gap-2 p-2 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800">
            <CheckCircle className="h-4 w-4 text-green-600" />
            <span className="text-sm font-semibold text-green-900 dark:text-green-100">
              Frame {selectedFrame} Loaded Successfully
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
