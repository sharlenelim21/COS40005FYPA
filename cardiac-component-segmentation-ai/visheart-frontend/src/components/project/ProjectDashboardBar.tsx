"use client";

import { useState, useEffect, useRef } from "react";
import { useProject } from "@/context/ProjectContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { 
  Heart, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Database, 
  Activity, 
  Download, 
  ChevronUp, 
  ChevronDown,
  Layers,
  Box,
  Image as ImageIcon
} from "lucide-react";
import { segmentationApi, reconstructionApi } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ProjectDashboardBar() {
  const { 
    projectData, 
    loading, 
    hasMasks, 
    undecodedMasks, 
    jobs, 
    error,
    hasReconstructions,
    reconstructionMetadata,
    reconstructionCacheReady,
    reconstructionCacheError
  } = useProject();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const lastScrollY = useRef(0);

  // Auto-hide on scroll
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      // Hide if scrolling down and not already collapsed
      if (currentScrollY > lastScrollY.current && currentScrollY > 50 && !isCollapsed) {
        setIsCollapsed(true);
      }
      
      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [isCollapsed]);

  if (!projectData) return null;

  // Export segmentation masks
  const handleExportProject = async () => {
    if (!projectData?.projectId) return;
    
    try {
      console.log(`[Export] Starting segmentation export for project: ${projectData.projectId}`);
      const exportResult = await segmentationApi.exportProjectData(projectData.projectId);
      console.log(`[Export] Received export result:`, { 
        blobSize: exportResult.blob.size, 
        blobType: exportResult.blob.type,
        expectedSize: exportResult.fileSizeBytes,
        filename: exportResult.suggestedFilename
      });
      
      const url = window.URL.createObjectURL(exportResult.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportResult.suggestedFilename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      console.log(`[Export] Successfully downloaded segmentation export for project: ${projectData.projectId} as ${exportResult.suggestedFilename}`);
    } catch (error) {
      console.error("Error exporting segmentation:", error);
    }
  };

  // Export reconstruction meshes (tar file)
  const handleExportReconstruction = async () => {
    if (!projectData?.projectId) return;
    
    try {
      console.log(`[Export] Starting reconstruction export for project: ${projectData.projectId}`);
      
      // Fetch reconstruction results which includes downloadUrl
      const result = await reconstructionApi.getReconstructionResults(projectData.projectId);
      
      if (!result.success || !result.reconstructions || result.reconstructions.length === 0) {
        console.warn(`[Export] No reconstructions found for project: ${projectData.projectId}`);
        alert("No reconstructions available to export.");
        return;
      }

      // Get the first reconstruction's download URL
      const reconstruction = result.reconstructions[0];
      if (!reconstruction.downloadUrl) {
        console.warn(`[Export] No download URL available for reconstruction`);
        alert("Reconstruction export is not available.");
        return;
      }

      console.log(`[Export] Downloading reconstruction from presigned URL`);
      
      // Download the file directly from the presigned URL
      const a = document.createElement("a");
      a.href = reconstruction.downloadUrl;
      a.download = reconstruction.metadata?.filename || `reconstruction_${projectData.projectId}.tar`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      console.log(`[Export] Successfully initiated reconstruction download for project: ${projectData.projectId}`);
    } catch (error) {
      console.error("Error exporting reconstruction:", error);
      alert("Failed to export reconstruction. Please try again.");
    }
  };

  // Get overall project status
  const getProjectStatus = () => {
    if (error) return { status: "error", icon: XCircle, color: "destructive" as const, text: "Error" };
    if (loading !== "done") return { status: "loading", icon: Clock, color: "secondary" as const, text: "Loading" };

    // Check job status
    const runningJobs = jobs?.filter((job) => job.status === "in_progress") || [];
    if (runningJobs.length > 0) return { status: "processing", icon: Activity, color: "secondary" as const, text: "Processing" };

    if (!hasMasks) return { status: "pending", icon: AlertCircle, color: "outline" as const, text: "Pending" };
    
    // Return multiple statuses when both segmentation and reconstruction exist
    return { status: "ready", icon: CheckCircle2, color: "default" as const, text: "Ready" };
  };

  const statusInfo = getProjectStatus();
  const StatusIcon = statusInfo.icon;

  // Get mask count
  const maskCount = hasMasks ? undecodedMasks?.length || 0 : 0;

  // Get reconstruction info
  const reconstructionFrameCount = reconstructionMetadata?.frameCount || projectData.dimensions?.frames || 0;

  return (
    <>
      {/* Collapsible Dashboard Bar */}
      <div 
        className={cn(
          "sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 transition-all duration-300 ease-in-out overflow-hidden",
          isCollapsed ? "max-h-0 opacity-0 border-b-0" : "max-h-40 opacity-100"
        )}
      >
        <div className="container mx-auto px-6 py-4">
          <div className="flex flex-col gap-3">
            {/* Top Row - Project Info & Actions */}
            <div className="flex items-center justify-between">
              {/* Left - Project Name & Status */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Heart className="h-5 w-5 text-red-500" />
                  <div className="flex flex-col">
                    <h1 className="font-semibold text-sm leading-none">{projectData.name}</h1>
                    {projectData.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{projectData.description}</p>
                    )}
                  </div>
                </div>

                <Separator orientation="vertical" className="h-10" />

                {/* Overall Status - Show multiple badges for segmented and reconstructed */}
                <div className="flex items-center gap-2">
                  <StatusIcon className="h-4 w-4" />
                  <Badge variant={statusInfo.color} className="text-xs">
                    {statusInfo.text}
                  </Badge>
                  
                  {/* Additional status badges */}
                  {hasMasks && (
                    <Badge variant="default" className="text-xs bg-green-600 hover:bg-green-700">
                      <Layers className="h-3 w-3 mr-1" />
                      Segmented
                    </Badge>
                  )}
                  
                  {hasReconstructions && (
                    <Badge variant="default" className="text-xs bg-blue-600 hover:bg-blue-700">
                      <Box className="h-3 w-3 mr-1" />
                      Reconstructed
                    </Badge>
                  )}
                </div>
              </div>

              {/* Right - Action Buttons */}
              <div className="flex items-center gap-2">
                {/* Export Segmentation Masks */}
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-8 text-xs" 
                  disabled={!hasMasks}
                  onClick={handleExportProject}
                  title={hasMasks ? "Export segmentation masks as NIfTI" : "No segmentation masks available"}
                >
                  <Download className="h-3 w-3 mr-1.5" />
                  Export Masks
                </Button>

                {/* Export Reconstruction Meshes */}
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-8 text-xs" 
                  disabled={!hasReconstructions}
                  onClick={handleExportReconstruction}
                  title={hasReconstructions ? "Export 4D reconstruction meshes as tar archive" : "No reconstructions available"}
                >
                  <Box className="h-3 w-3 mr-1.5" />
                  Export 3D
                </Button>

                {/* Collapse button */}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setIsCollapsed(true)}
                  aria-label="Hide dashboard"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Bottom Row - Statistics Grid */}
            <div className="grid grid-cols-5 gap-4">
              {/* Dataset Info */}
              <div className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-muted/50 border">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Database className="h-3 w-3" />
                  <span className="text-xs font-medium">Dataset</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-sm font-semibold">
                    {projectData.dimensions?.width}×{projectData.dimensions?.height}
                  </span>
                  <span className="text-xs text-muted-foreground">px</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {projectData.dimensions?.frames || 0} frames · {projectData.dimensions?.slices || 0} slices
                </div>
              </div>

              {/* Segmentation Status */}
              <div className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-muted/50 border">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Layers className="h-3 w-3" />
                  <span className="text-xs font-medium">Segmentation</span>
                </div>
                {hasMasks ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      <span className="text-sm font-semibold">{maskCount} masks</span>
                    </div>
                    <div className="text-xs text-muted-foreground">Ready for editing</div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                      <span className="text-sm font-semibold">Not started</span>
                    </div>
                    <div className="text-xs text-muted-foreground">Start segmentation</div>
                  </>
                )}
              </div>

              {/* 4D Reconstruction Status */}
              <div className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-muted/50 border">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Box className="h-3 w-3" />
                  <span className="text-xs font-medium">3D Models</span>
                </div>
                {hasReconstructions ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      {reconstructionCacheReady ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                      ) : reconstructionCacheError ? (
                        <XCircle className="h-3.5 w-3.5 text-red-600" />
                      ) : (
                        <Clock className="h-3.5 w-3.5 text-blue-600 animate-pulse" />
                      )}
                      <span className="text-sm font-semibold">{reconstructionFrameCount} frames</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {reconstructionMetadata?.metadata?.edFrameIndex !== undefined 
                        ? `ED Frame: ${reconstructionMetadata.metadata.edFrameIndex} • ${reconstructionCacheReady ? "Cached" : reconstructionCacheError ? "Cache error" : "Loading..."}`
                        : reconstructionCacheReady ? "Cached" : reconstructionCacheError ? "Cache error" : "Loading..."
                      }
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                      <span className="text-sm font-semibold">Not created</span>
                    </div>
                    <div className="text-xs text-muted-foreground">Create reconstruction</div>
                  </>
                )}
              </div>

              {/* Processing Jobs */}
              <div className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-muted/50 border">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Activity className="h-3 w-3" />
                  <span className="text-xs font-medium">Active Jobs</span>
                </div>
                {jobs && jobs.length > 0 ? (
                  <>
                    <div className="flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5 text-blue-600 animate-pulse" />
                      <span className="text-sm font-semibold">{jobs.length} running</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {jobs.filter(j => j.status === "in_progress").length} in progress
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-semibold">None</span>
                    </div>
                    <div className="text-xs text-muted-foreground">No active jobs</div>
                  </>
                )}
              </div>

              {/* File Size Info */}
              <div className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-muted/50 border">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <ImageIcon className="h-3 w-3" />
                  <span className="text-xs font-medium">Storage</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-sm font-semibold">
                    {reconstructionMetadata?.meshFileSize 
                      ? `${(reconstructionMetadata.meshFileSize / 1024 / 1024).toFixed(1)} MB`
                      : "—"
                    }
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {reconstructionMetadata?.meshFormat || "GLB"} format
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Toggle Button (shown when collapsed) */}
      <div 
        className={cn(
          "fixed top-2 left-1/2 -translate-x-1/2 z-[100] transition-all duration-300 ease-in-out",
          isCollapsed ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0 pointer-events-none"
        )}
      >
        <Button
          variant="secondary"
          size="sm"
          className="h-10 px-4 rounded-lg shadow-lg border bg-background/95 backdrop-blur hover:bg-accent"
          onClick={() => setIsCollapsed(false)}
          aria-label="Show dashboard"
        >
          <Heart className="h-3.5 w-3.5 text-red-500 mr-2" />
          <span className="text-xs font-medium">{projectData.name}</span>
          <Separator orientation="vertical" className="h-4 mx-3" />
          
          {/* Mini status indicators */}
          <div className="flex items-center gap-2">
            <Badge variant={statusInfo.color} className="text-xs h-5 px-2">
              {statusInfo.text}
            </Badge>
            
            {hasMasks && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Layers className="h-3 w-3" />
                <span>{maskCount}</span>
              </div>
            )}
            
            {hasReconstructions && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Box className="h-3 w-3" />
                <span>{reconstructionFrameCount}</span>
              </div>
            )}
          </div>
          
          <ChevronDown className="h-3.5 w-3.5 ml-2" />
        </Button>
      </div>
    </>
  );
}
