"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useProject, normalizeReconstructionChamber } from "@/context/ProjectContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { LoadingProject } from "@/components/project/LoadingProject";
import { ErrorProject } from "@/components/project/ErrorProject";
import { ReconstructionGLBViewer } from "@/components/reconstruction/ReconstructionGLBViewer";
import { GuidancePanel } from "@/components/GuidancePanel";
import { Layers, Crosshair, AlertTriangle } from "lucide-react";
import { 
  ResizablePanelGroup, 
  ResizablePanel, 
  ResizableHandle 
} from "@/components/ui/resizable";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Loader2,
  AlertCircle,
} from "lucide-react";

export default function Standalone4DViewerPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const modelParam = searchParams.get("model");
  const selectedModel = modelParam === "medsam" || modelParam === "unet" ? modelParam : null;
  const reconstructionIdParam = searchParams.get("reconstructionId");
  // Set when a job was just started for this chamber. Used to keep polling and to show the
  // chamber as building rather than as simply absent.
  const pendingParam = searchParams.get("pending");
  const pendingChamber = pendingParam === "lv" || pendingParam === "rv" ? pendingParam : null;

  // Get data from ProjectContext
  const {
    loading,
    error,
    projectData,
    hasReconstructions,
    reconstructionCacheError,
    getReconstructionGLB,
    reconstructionMetadata,
    getReconstructionForModel,
    getReconstructionById,
    refreshReconstructions,
    reconstructionResults,
  } = useProject();

  const activeReconstruction = reconstructionIdParam
    ? getReconstructionById(reconstructionIdParam) ||
      (reconstructionMetadata?.reconstructionId === reconstructionIdParam ? reconstructionMetadata : null)
    : selectedModel
    ? getReconstructionForModel(selectedModel)
    : reconstructionMetadata;

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

  // LV and RV are separate records of the same scan, so the viewer resolves one of each rather
  // than treating either as "the" reconstruction with the other bolted on. Both are drawn in the
  // same scene at their true relative positions, and either can be hidden independently.
  //
  // RV is RESEARCH/REFERENCE ONLY — the RV shape model has not passed accuracy validation, so
  // wherever RV is drawn it carries a label.

  // Which segmentation model this viewer is scoped to. Both chambers must come from the same
  // masks, otherwise the two meshes are of different segmentations and their relative position
  // means nothing.
  const scopedModel = (
    activeReconstruction?.segmentationModel ??
    selectedModel ??
    ""
  ).toString().toLowerCase();

  const findChamber = useCallback(
    (chamber: "lv" | "rv") => {
      // The record the URL points at wins for its own chamber — opening a specific
      // reconstructionId must show that one, not a same-model sibling.
      if (
        activeReconstruction &&
        normalizeReconstructionChamber(activeReconstruction?.chamber) === chamber
      ) {
        return activeReconstruction;
      }
      const candidates = (reconstructionResults ?? []).filter(
        (recon: any) => normalizeReconstructionChamber(recon?.chamber) === chamber, // eslint-disable-line @typescript-eslint/no-explicit-any
      );
      if (candidates.length === 0) return null;
      const sameModel = candidates.find(
        (recon: any) => (recon?.segmentationModel ?? "").toString().toLowerCase() === scopedModel, // eslint-disable-line @typescript-eslint/no-explicit-any
      );
      if (sameModel) return sameModel;
      // No same-model match: only fall back when the scope is genuinely unknown. Pairing a UNet
      // mesh with a MedSAM one would be a silently wrong comparison.
      return scopedModel && scopedModel !== "unknown" ? null : candidates[0];
    },
    [activeReconstruction, reconstructionResults, scopedModel],
  );

  const lvReconstruction = useMemo(() => findChamber("lv"), [findChamber]);
  const rvReconstruction = useMemo(() => findChamber("rv"), [findChamber]);

  // True while a chamber we were told is being built has not landed yet. Drives both the polling
  // loop and the "Building..." row in the sidebar.
  const pendingChamberMissing =
    pendingChamber === "rv" ? !rvReconstruction
    : pendingChamber === "lv" ? !lvReconstruction
    : false;

  // Poll for reconstruction when it doesn't exist yet (job was just started)
  const [isPolling, setIsPolling] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);

  useEffect(() => {
    // Only poll after initial context load is done and something we expect is still missing.
    if (loading !== "done") return;
    if (pollTimedOut) return;
    // A pending chamber outranks the generic check below: when a second chamber is being built
    // the project already HAS reconstructions, so that check would stop polling immediately and
    // the new mesh would only appear on a manual refresh.
    if (!pendingChamberMissing) {
      if (hasReconstructions && (!selectedModel || activeReconstruction)) return;
    }

    setIsPolling(true);
    let attempts = 0;
    // A 30-frame reconstruction runs for minutes, so the original 2-minute budget expired long
    // before a job could finish. 10 minutes at 2s intervals.
    const maxAttempts = 300;

    const interval = setInterval(async () => {
      attempts++;
      await refreshReconstructions();

      if (attempts >= maxAttempts) {
        clearInterval(interval);
        setIsPolling(false);
        setPollTimedOut(true);
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      setIsPolling(false);
    };
  }, [loading, hasReconstructions, selectedModel, activeReconstruction, pollTimedOut,
      refreshReconstructions, pendingChamberMissing]);

  // Viewer state
  const [currentFrame, setCurrentFrame] = useState(0);
  const [reconstructionModelUrl, setReconstructionModelUrl] = useState<string | null>(null);
  const [showLv, setShowLv] = useState(true);
  const [showRv, setShowRv] = useState(true);
  const [rvModelUrl, setRvModelUrl] = useState<string | null>(null);
  const [rvLoadError, setRvLoadError] = useState<string | null>(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(500); // ms per frame

  // Sending the user to the project page rather than starting the job here on purpose: that page
  // owns mask availability, GPU availability and the duplicate check. Starting a job from the
  // viewer would bypass all three and fail confusingly.
  const buildChamberHref = useCallback(
    (chamber: "lv" | "rv") => {
      const params = new URLSearchParams();
      params.set("build", chamber);
      if (scopedModel === "medsam" || scopedModel === "unet") params.set("model", scopedModel);
      return `/project/${projectId}?${params.toString()}`;
    },
    [projectId, scopedModel],
  );

  // Must match the colours the viewer paints these meshes with, or the legend lies.
  const CHAMBER_ROWS = [
    {
      key: "lv" as const,
      label: "LV myocardium",
      color: "#c41e3a",
      recon: lvReconstruction,
      visible: showLv,
      setVisible: setShowLv,
      building: pendingChamber === "lv" && !lvReconstruction,
    },
    {
      key: "rv" as const,
      label: "RV cavity",
      color: "#2f9ed6",
      recon: rvReconstruction,
      visible: showRv,
      setVisible: setShowRv,
      building: pendingChamber === "rv" && !rvReconstruction,
    },
  ];

  // Get total frames from reconstruction metadata (more reliable than project dimensions for reconstructions)
  const totalFrames = activeReconstruction?.totalFrames || projectData?.dimensions?.frames || 0;

  // Load the LV mesh for the current frame.
  //
  // Addressed by the LV record's own id rather than by `reconstructionIdParam`, because that param
  // may point at the RV record — opening an RV reconstruction directly must not load an RV mesh
  // into the LV slot and label it LV.
  useEffect(() => {
    if (!hasReconstructions || !showLv || !lvReconstruction?.reconstructionId) {
      setReconstructionModelUrl(null);
      return;
    }

    let cancelled = false;
    const loadModel = async () => {
      setIsLoadingModel(true);
      try {
        console.log(`[Standalone4DViewer] Loading LV model for frame ${currentFrame}...`);
        const url = await getReconstructionGLB(currentFrame, undefined, lvReconstruction.reconstructionId);
        if (cancelled) return;
        if (url) {
          console.log(`[Standalone4DViewer] ✅ Loaded LV model for frame ${currentFrame}`);
          setReconstructionModelUrl(url);
        } else {
          console.warn(`[Standalone4DViewer] ❌ No LV model URL for frame ${currentFrame}`);
          setReconstructionModelUrl(null);
        }
      } catch (error) {
        if (cancelled) return;
        console.error(`[Standalone4DViewer] Error loading LV model:`, error);
        setReconstructionModelUrl(null);
      } finally {
        if (!cancelled) setIsLoadingModel(false);
      }
    };

    loadModel();
    return () => {
      cancelled = true;
    };
  }, [lvReconstruction, showLv, currentFrame, getReconstructionGLB, hasReconstructions]);

  // Load the RV mesh for the same frame, only while the overlay is on. Kept as a separate effect
  // so the LV path is completely untouched when the overlay is off — including doing no fetching.
  useEffect(() => {
    if (!showRv || !rvReconstruction?.reconstructionId) {
      setRvModelUrl(null);
      setRvLoadError(null);
      return;
    }

    let cancelled = false;
    const loadRv = async () => {
      try {
        const url = await getReconstructionGLB(currentFrame, undefined, rvReconstruction.reconstructionId);
        if (cancelled) return;
        setRvModelUrl(url);
        // An RV record can hold fewer frames than the LV one (a partial or failed run). Say so
        // rather than silently dropping the overlay, which would read as "the RV is not there".
        setRvLoadError(url ? null : `No RV mesh for frame ${currentFrame + 1}.`);
      } catch (error) {
        if (cancelled) return;
        console.error("[Standalone4DViewer] Error loading RV overlay:", error);
        setRvModelUrl(null);
        setRvLoadError("Failed to load the RV mesh.");
      }
    };

    loadRv();
    return () => {
      cancelled = true;
    };
  }, [showRv, rvReconstruction, currentFrame, getReconstructionGLB]);

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

  // No reconstruction data — show waiting UI while polling, error only on timeout
  if (!hasReconstructions || (selectedModel && !activeReconstruction)) {
    if (isPolling) {
      return (
        <div className="container mx-auto p-6 max-w-4xl">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.back()}
            className="mb-4 gap-2 rounded-lg border-border/50 bg-background/50 hover:bg-accent/50 hover:border-border text-foreground/70 hover:text-foreground transition-all duration-200 shadow-sm hover:shadow-md"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Project
          </Button>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-12">
                <Loader2 className="h-12 w-12 mx-auto text-primary mb-4 animate-spin" />
                <h3 className="text-lg font-semibold mb-2">Generating 4D Reconstruction...</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {selectedModel
                    ? `Building the ${selectedModel.toUpperCase()} 4D model. This may take several minutes.`
                    : "Building the 4D model. This may take several minutes."}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.back()}
          className="mb-4 gap-2 rounded-lg border-border/50 bg-background/50 hover:bg-accent/50 hover:border-border text-foreground/70 hover:text-foreground transition-all duration-200 shadow-sm hover:shadow-md"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Project
        </Button>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-12">
              <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No 4D Reconstruction Available</h3>
              <p className="text-sm text-muted-foreground mb-4">
                {selectedModel
                  ? `This project does not have a ${selectedModel.toUpperCase()} 4D reconstruction yet.`
                  : "This project does not have a 4D reconstruction yet."}
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
          variant="outline"
          size="sm"
          onClick={() => router.back()}
          className="mb-4 gap-2 rounded-lg border-border/50 bg-background/50 hover:bg-accent/50 hover:border-border text-foreground/70 hover:text-foreground transition-all duration-200 shadow-sm hover:shadow-md"
        >
          <ArrowLeft className="h-4 w-4" />
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
            <div className="absolute top-6 left-6 z-20">
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/project/${projectId}`)}
                className="gap-2 rounded-lg border-border/50 bg-background/50 hover:bg-accent/50 hover:border-border text-foreground/70 hover:text-foreground transition-all duration-200 shadow-sm hover:shadow-md backdrop-blur-sm"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back to Project</span>
              </Button>
            </div>
            
            <ReconstructionGLBViewer
              modelUrl={showLv ? reconstructionModelUrl : null}
              frame={currentFrame + 1} // 1-based index for user friendliness
              className="w-full h-full rounded-lg border"
              secondaryModelUrl={showRv ? rvModelUrl : null}
              primaryLabel="LV myocardium"
              secondaryLabel="RV cavity"
              // Marks RV as research-only on the canvas itself, so the warning stays with the
              // image if the sidebar is collapsed or the view is screenshotted.
              secondaryIsResearchOnly
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

                {/* Chambers.
                    Always rendered, both chambers listed, so the panel says what exists and what
                    does not. A chamber that is built gets a visibility switch; one that is not is
                    greyed with a button to go build it. RV carries its research-only warning
                    whenever it exists — not behind a tooltip or a collapsed section. */}
                <div className="pt-4 border-t space-y-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Chambers
                  </p>

                  {CHAMBER_ROWS.map(({ key, label, color, recon, visible, setVisible, building }) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <div className={`flex items-center gap-2 ${recon ? "" : "opacity-50"}`}>
                        <span
                          className="inline-block h-3 w-3 rounded-full border"
                          style={{ backgroundColor: recon ? color : "transparent" }}
                        />
                        <span className="text-sm font-medium">{label}</span>
                        {!recon && (
                          <Badge variant="outline" className="text-[10px]">
                            {building ? "Building" : "Not built"}
                          </Badge>
                        )}
                      </div>

                      {recon ? (
                        <Switch
                          checked={visible}
                          onCheckedChange={setVisible}
                          aria-label={`Show ${label}`}
                        />
                      ) : building ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => router.push(buildChamberHref(key))}
                        >
                          Build {key.toUpperCase()}
                        </Button>
                      )}
                    </div>
                  ))}

                  {/* Says the job is running and that this page will update itself. Without it a
                      reconstruction that takes minutes looks like nothing happened. */}
                  {pendingChamberMissing && (
                    <div className="rounded-md border bg-muted/40 p-3 space-y-1">
                      <p className="text-xs font-medium flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Building {pendingChamber?.toUpperCase()} reconstruction…
                      </p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        This runs on the GPU and takes a few minutes for a full sequence. You can
                        stay here — the chamber appears automatically when it finishes.
                      </p>
                    </div>
                  )}
                  {pendingChamberMissing === false && pollTimedOut && pendingChamber && (
                    <p className="text-[11px] text-muted-foreground">
                      Stopped checking for updates. Reload to check again.
                    </p>
                  )}

                  {rvReconstruction && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
                      <p className="text-xs font-semibold flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5 mt-[1px] shrink-0" />
                        <span>RV reconstruction is for reference/research use only</span>
                      </p>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        It is not reliable for actual clinical diagnosis. The RV shape model has not
                        passed accuracy validation, so RV geometry, volumes and any measurement
                        derived from them must not be used clinically or reported as a result.
                      </p>
                    </div>
                  )}

                  {!showLv && !showRv && (
                    <p className="text-[11px] text-muted-foreground">
                      Both chambers are hidden.
                    </p>
                  )}
                  {showRv && rvLoadError && (
                    <p className="text-[11px] text-destructive">{rvLoadError}</p>
                  )}
                </div>

                {/* Reconstruction Info */}
                {activeReconstruction && (
                  <div className="pt-4 border-t space-y-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Reconstruction Info
                    </p>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-muted-foreground">ED Frame</p>
                        <p className="font-mono font-semibold">
                          Frame {activeReconstruction.metadata?.edFrameIndex || 1}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Format</p>
                        <p className="font-mono font-semibold uppercase">
                          {activeReconstruction.meshFormat || 'GLB'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Resolution</p>
                        <p className="font-mono">
                          {activeReconstruction.metadata?.resolution || 32}³
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Iterations</p>
                        <p className="font-mono">
                          {activeReconstruction.metadata?.numIterations || 30}
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

      <GuidancePanel
        storageKey={`4d-guidance-${projectId}-${selectedModel ?? "unknown"}`}
        icon="🫀"
        title="What would you like to do next?"
        subtitle="4D Reconstruction is ready"
        actions={[
          {
            label: "View Segmentation Mask",
            icon: <Layers size={13} />,
            onClick: () => {
              const params = new URLSearchParams();
              if (selectedModel) params.set("model", selectedModel);
              params.set("from", "4d");
              router.push(`/project/${projectId}/segmentation?${params.toString()}`);
            },
          },
          {
            label: "Run Landmark Detection",
            icon: <Crosshair size={13} />,
            primary: true,
            onClick: () => router.push(`/project/${projectId}?highlight=landmark`),
          },
        ]}
      />
    </div>
  );
}
