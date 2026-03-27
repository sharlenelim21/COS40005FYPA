"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useProject } from "@/context/ProjectContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { LoadingProject } from "@/components/project/LoadingProject";
import { ErrorProject } from "@/components/project/ErrorProject";
import { ReconstructionGLBViewer } from "@/components/reconstruction/ReconstructionGLBViewer";
import { 
  ResizablePanelGroup, 
  ResizablePanel, 
  ResizableHandle 
} from "@/components/ui/resizable";
import { 
  ArrowLeft, 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Loader2,
  AlertCircle 
} from "lucide-react";

export default function Standalone4DViewerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();

  // Get data from ProjectContext
  const {
    loading,
    error,
    projectData,
    hasReconstructions,
    reconstructionCacheReady,
    reconstructionCacheError,
    getReconstructionGLB,
    reconstructionMetadata,
  } = useProject();

  // Update page title dynamically
  useEffect(() => {
    if (projectData?.name) {
      document.title = `VisHeart | ${projectData.name} - 4D Viewer`;
    } else {
      document.title = "VisHeart | 4D Reconstruction Viewer";
    }
    
    return () => {
      document.title = "VisHeart";
    };
  }, [projectData?.name]);

  // Viewer state
  const [currentFrame, setCurrentFrame] = useState(0);
  const [reconstructionModelUrl, setReconstructionModelUrl] = useState<string | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(500); // ms per frame

  // Get total frames from reconstruction metadata (more reliable than project dimensions for reconstructions)
  const totalFrames = reconstructionMetadata?.totalFrames || projectData?.dimensions?.frames || 0;

  // Load 3D reconstruction model when frame changes
  useEffect(() => {
    if (!hasReconstructions || !reconstructionCacheReady) {
      setReconstructionModelUrl(null);
      return;
    }

    const loadModel = async () => {
      setIsLoadingModel(true);
      try {
        console.log(`[Standalone4DViewer] Loading model for frame ${currentFrame}...`);
        const url = await getReconstructionGLB(currentFrame);
        if (url) {
          console.log(`[Standalone4DViewer] ✅ Loaded model for frame ${currentFrame}`);
          setReconstructionModelUrl(url);
        } else {
          console.warn(`[Standalone4DViewer] ❌ No model URL for frame ${currentFrame}`);
          setReconstructionModelUrl(null);
        }
      } catch (error) {
        console.error(`[Standalone4DViewer] Error loading model:`, error);
        setReconstructionModelUrl(null);
      } finally {
        setIsLoadingModel(false);
      }
    };

    loadModel();
  }, [currentFrame, hasReconstructions, reconstructionCacheReady, getReconstructionGLB]);

  // Playback animation
  useEffect(() => {
    if (!isPlaying || totalFrames === 0) return;

    const interval = setInterval(() => {
      setCurrentFrame((prev) => (prev + 1) % totalFrames);
    }, playbackSpeed);

    return () => clearInterval(interval);
  }, [isPlaying, totalFrames, playbackSpeed]);

  // Keyboard navigation for frame control
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      // Don't handle keyboard shortcuts if only 1 frame
      if (totalFrames <= 1) return;
      
      // Prevent default browser behavior for arrow keys
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
      }

      switch (event.key) {
        case "ArrowLeft":
          // Go to previous frame
          setCurrentFrame((prev) => Math.max(0, prev - 1));
          setIsPlaying(false); // Pause playback when manually navigating
          break;
        case "ArrowRight":
          // Go to next frame
          setCurrentFrame((prev) => Math.min(totalFrames - 1, prev + 1));
          setIsPlaying(false); // Pause playback when manually navigating
          break;
        case " ":
          // Spacebar toggles play/pause
          event.preventDefault();
          setIsPlaying((prev) => !prev);
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [totalFrames]);

  // Loading state
  if (loading !== "done") {
    return <LoadingProject loadingStage={loading} />;
  }

  // Error state
  if (error) {
    return <ErrorProject error={error} />;
  }

  // Null check for projectData
  if (!projectData) {
    return <ErrorProject error="Failed to load project data" />;
  }

  // No reconstruction data
  if (!hasReconstructions) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <Button 
          variant="ghost" 
          onClick={() => router.back()}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Project
        </Button>
        
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No 4D Reconstruction Available</h3>
              <p className="text-sm text-muted-foreground mb-4">
                This project does not have a 4D reconstruction yet.
              </p>
              <Button onClick={() => router.push(`/project/${projectId}`)}>
                Return to Project
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Cache error state
  if (reconstructionCacheError) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <Button 
          variant="ghost" 
          onClick={() => router.back()}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Project
        </Button>
        
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
              <h3 className="text-lg font-semibold mb-2">Error Loading Reconstruction</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {reconstructionCacheError}
              </p>
              <Button onClick={() => router.push(`/project/${projectId}`)}>
                Return to Project
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-[90vh] flex flex-col">
      {/* Resizable Layout */}
      <ResizablePanelGroup 
        direction="horizontal" 
        className="flex-1 min-h-0"
      >
        {/* Main Viewer Panel */}
        <ResizablePanel defaultSize={70} minSize={20}>
          <div className="h-full w-full p-4 relative">
            {/* Back Button - Positioned in top-left */}
            <Button 
              variant="secondary" 
              size="sm"
              onClick={() => router.push(`/project/${projectId}`)}
              className="absolute top-6 left-6 z-20 bg-black/70 hover:bg-black/90 text-white"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Project
            </Button>
            
            <ReconstructionGLBViewer
              modelUrl={reconstructionModelUrl}
              frame={currentFrame + 1} // 1-based index for user friendliness
              className="w-full h-full rounded-lg border"
            />
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Controls Panel */}
        <ResizablePanel defaultSize={30} minSize={0}>
          <div className="h-full overflow-y-auto p-4">
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Playback Controls</span>
                  {isLoadingModel && (
                    <Badge variant="secondary" className="text-xs">
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Loading...
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Frame Slider */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Frame: {currentFrame + 1} / {totalFrames}</span>
                    <span className="text-muted-foreground">
                      {totalFrames > 1 ? Math.round((currentFrame / (totalFrames - 1)) * 100) : 100}%
                    </span>
                  </div>
                  <Slider
                    value={[currentFrame]}
                    onValueChange={(value) => {
                      setCurrentFrame(value[0]);
                      setIsPlaying(false);
                    }}
                    max={Math.max(0, totalFrames - 1)}
                    step={1}
                    className="w-full"
                    disabled={totalFrames <= 1}
                  />
                </div>

                {/* Playback Buttons */}
                <div className="flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentFrame(0)}
                    disabled={totalFrames <= 1 || currentFrame === 0}
                    title="First Frame"
                  >
                    <SkipBack className="h-4 w-4" />
                  </Button>
                  
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentFrame(Math.max(0, currentFrame - 1))}
                    disabled={totalFrames <= 1 || currentFrame === 0}
                    title="Previous Frame"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  
                  <Button
                    variant="default"
                    size="icon"
                    onClick={() => setIsPlaying(!isPlaying)}
                    className="h-10 w-10"
                    title={isPlaying ? "Pause" : "Play"}
                    disabled={totalFrames <= 1}
                  >
                    {isPlaying ? (
                      <Pause className="h-5 w-5" />
                    ) : (
                      <Play className="h-5 w-5" />
                    )}
                  </Button>
                  
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentFrame(Math.min(totalFrames - 1, currentFrame + 1))}
                    disabled={totalFrames <= 1 || currentFrame === totalFrames - 1}
                    title="Next Frame"
                  >
                    <ArrowLeft className="h-4 w-4 rotate-180" />
                  </Button>
                  
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setCurrentFrame(totalFrames - 1)}
                    disabled={totalFrames <= 1 || currentFrame === totalFrames - 1}
                    title="Last Frame"
                  >
                    <SkipForward className="h-4 w-4" />
                  </Button>
                </div>

                {/* Speed Control */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Playback Speed</span>
                    <span className="text-muted-foreground">
                      {(1000 / playbackSpeed).toFixed(1)} fps
                    </span>
                  </div>
                  <Slider
                    value={[playbackSpeed]}
                    onValueChange={(value) => setPlaybackSpeed(value[0])}
                    min={100}
                    max={2000}
                    step={100}
                    className="w-full"
                    disabled={totalFrames <= 1}
                  />
                </div>

                {/* Reconstruction Info */}
                {reconstructionMetadata && (
                  <div className="pt-4 border-t space-y-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Reconstruction Info
                    </p>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">ED Frame</p>
                        <p className="font-mono font-semibold">
                          Frame {reconstructionMetadata.metadata?.edFrameIndex || 1}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Format</p>
                        <p className="font-mono font-semibold uppercase">
                          {reconstructionMetadata.meshFormat || 'GLB'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Resolution</p>
                        <p className="font-mono">
                          {reconstructionMetadata.metadata?.resolution || 32}³
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Iterations</p>
                        <p className="font-mono">
                          {reconstructionMetadata.metadata?.numIterations || 30}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Keyboard Shortcuts Info */}
                <div className="pt-4 border-t">
                  <p className="text-xs text-muted-foreground font-medium mb-2">Keyboard Shortcuts:</p>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <kbd className="px-1.5 py-0.5 bg-muted rounded border text-[10px] font-mono">←</kbd>
                      <span>Previous Frame</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <kbd className="px-1.5 py-0.5 bg-muted rounded border text-[10px] font-mono">→</kbd>
                      <span>Next Frame</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <kbd className="px-1.5 py-0.5 bg-muted rounded border text-[10px] font-mono">Space</kbd>
                      <span>Play/Pause</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
