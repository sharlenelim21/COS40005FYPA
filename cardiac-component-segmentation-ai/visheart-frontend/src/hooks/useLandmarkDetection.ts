"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { landmarkApi, LandmarkApiError } from "@/lib/landmarkApi";
import type {
  LandmarkPageState,
  FramePrediction,
  LandmarkInferenceResponse,
} from "@/types/landmark";

const DEFAULT_PLAYBACK_FPS = 2;
const DEFAULT_LANDMARK_MODEL = "unetresnet34-landmark";

const INITIAL_STATE: LandmarkPageState = {
  status: "idle",
  predictions: [],
  totalFrames: 0,
  imageDimensions: { width: 256, height: 256 },
  currentFrame: 0,
  isPlaying: false,
  playbackFps: DEFAULT_PLAYBACK_FPS,
  error: null,
  modelUsed: "",
  replacementFile: null,
};

function validateNiftiFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".nii") && !name.endsWith(".nii.gz")) {
    return "Invalid file type. Please select a .nii or .nii.gz NIfTI file.";
  }
  if (file.size > 500 * 1024 * 1024) {
    return "File is too large (maximum 500 MB).";
  }
  return null;
}

export function useLandmarkDetection(
  projectId: string,
  projectDimensions?: { width?: number; height?: number },
) {
  const [state, setState] = useState<LandmarkPageState>(() => ({
    ...INITIAL_STATE,
    imageDimensions: {
      width:  projectDimensions?.width  ?? 256,
      height: projectDimensions?.height ?? 256,
    },
  }));

  const [replacementFileError, setReplacementFileError] = useState<string | null>(null);
  const rafRef          = useRef<number | null>(null);
  const lastTickRef     = useRef<number>(0);
  const isPlayingRef    = useRef<boolean>(false);
  const playbackFpsRef  = useRef<number>(DEFAULT_PLAYBACK_FPS);
  // Indices into state.predictions to cycle during playback.
  // Populated just before playback starts; empty = play all.
  const playIndicesRef  = useRef<number[]>([]);

  const startPlaybackLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      if (!isPlayingRef.current) return;

      const frameDurationMs = 1000 / Math.max(playbackFpsRef.current, 1);
      if (now - lastTickRef.current >= frameDurationMs) {
        lastTickRef.current = now;
        setState((s) => {
          if (!s.isPlaying || s.totalFrames < 2) return s;
          const indices = playIndicesRef.current;
          if (indices.length < 2) {
            // Fall back to all frames
            return { ...s, currentFrame: (s.currentFrame + 1) % s.totalFrames };
          }
          const pos = indices.indexOf(s.currentFrame);
          const next = pos === -1 ? indices[0] : indices[(pos + 1) % indices.length];
          return { ...s, currentFrame: next };
        });
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopPlayback = useCallback(() => {
    isPlayingRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setState((s) => (s.isPlaying ? { ...s, isPlaying: false } : s));
  }, []);

  useEffect(() => {
    return () => {
      isPlayingRef.current = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const applyResult = useCallback(
    (result: LandmarkInferenceResponse) => {
      setState((s) => ({
        ...s,
        status: "done",
        predictions: result.predictions,
        totalFrames: result.total_frames,
        // Only update dimensions when the result carries real values.
        // New GPU format omits image_dimensions (returns {width:0,height:0});
        // keep existing project dimensions so the canvas scales correctly.
        imageDimensions:
          result.image_dimensions?.width > 0
            ? result.image_dimensions
            : s.imageDimensions,
        currentFrame: 0,
        modelUsed: result.model_used,
        error: null,
        isPlaying: false,
        avgLm1: result.avg_lm1,
        avgLm2: result.avg_lm2,
        nTotal: result.n_total,
        nCollapsed: result.n_collapsed,
        n2ch: result.n_2ch,
        n1chFallback: result.n_1ch_fallback,
      }));
    },
    [],
  );

  useEffect(() => {
    if (!projectId) return;
    if (landmarkApi.hasCached(projectId)) {
      // Re-run (sync path via cache — effectively instant)
      landmarkApi.runDetectionByProject(projectId, DEFAULT_LANDMARK_MODEL).then(applyResult).catch(() => {
        // If somehow cache returns an error, silently ignore and stay idle
      });
    }
  }, [projectId]); 
  
  const handleRunDetection = useCallback(
    async (model = DEFAULT_LANDMARK_MODEL, segmentationModel = "medsam") => {
      if (state.status === "running") return;

      stopPlayback();
      setState((s) => ({ ...s, status: "running", error: null }));

      try {
        let result: LandmarkInferenceResponse;

        if (state.replacementFile) {
          result = await landmarkApi.runDetectionWithFile(
            projectId,
            state.replacementFile,
            model,
          );
        } else {
          result = await landmarkApi.runDetectionByProject(projectId, model, segmentationModel);
        }

        if (!result.predictions.length) {
          setState((s) => ({
            ...s,
            status: "error",
            error: "No landmark predictions returned. Please try again or check the MRI data.",
          }));
          return;
        }

        applyResult(result);
      } catch (err) {
        const msg =
          err instanceof LandmarkApiError
            ? err.message
            : "Landmark detection failed. Please try again.";
        setState((s) => ({ ...s, status: "error", error: msg }));
        if (process.env.NODE_ENV === "development") {
          console.error("[useLandmarkDetection]", err);
        }
      }
    },
    [state.status, state.replacementFile, projectId, stopPlayback, applyResult],
  );

  /** Force a fresh run, bypassing cache. */
  const handleRerunDetection = useCallback(
    (model = DEFAULT_LANDMARK_MODEL, segmentationModel = "medsam") => {
      landmarkApi.invalidateCache(projectId);
      setState((s) => ({ ...s, status: "idle", predictions: [], error: null }));
      // Re-run after state flush
      setTimeout(() => handleRunDetection(model, segmentationModel), 0);
    },
    [projectId, handleRunDetection],
  );

  const handleFileSelect = useCallback(
    (file: File | null) => {
      if (!file) {
        setState((s) => ({ ...s, replacementFile: null }));
        setReplacementFileError(null);
        return;
      }
      const err = validateNiftiFile(file);
      setReplacementFileError(err);
      if (!err) {
        stopPlayback();
        landmarkApi.invalidateCache(projectId);
        setState((s) => ({
          ...s,
          replacementFile: file,
          status: "idle",
          predictions: [],
          error: null,
        }));
      }
    },
    [projectId, stopPlayback],
  );

  const handleClearReplacementFile = useCallback(() => {
    setState((s) => ({ ...s, replacementFile: null, status: "idle", error: null }));
    setReplacementFileError(null);
    if (landmarkApi.hasCached(projectId)) {
      landmarkApi.runDetectionByProject(projectId, DEFAULT_LANDMARK_MODEL).then(applyResult).catch(() => {});
    }
  }, [projectId, applyResult]);

  const handlePlay = useCallback(() => {
    if (state.status !== "done" || state.totalFrames < 2) return;
    // Compute confident indices — flag=normal AND confidence=high
    const confident = state.predictions
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.flag === "normal" && p.confidence === "high")
      .map(({ i }) => i);
    playIndicesRef.current = confident.length >= 2 ? confident : [];
    isPlayingRef.current = true;
    lastTickRef.current = 0;
    setState((s) => ({ ...s, isPlaying: true }));
    startPlaybackLoop();
  }, [state.status, state.totalFrames, state.predictions, startPlaybackLoop]);

  const handlePause = useCallback(() => stopPlayback(), [stopPlayback]);

  const handleTogglePlay = useCallback(() => {
    if (state.isPlaying) handlePause();
    else handlePlay();
  }, [state.isPlaying, handlePlay, handlePause]);

  const handleNextFrame = useCallback(() => {
    stopPlayback();
    setState((s) => ({
      ...s,
      currentFrame: s.totalFrames > 0 ? Math.min(s.currentFrame + 1, s.totalFrames - 1) : 0,
    }));
  }, [stopPlayback]);

  const handlePrevFrame = useCallback(() => {
    stopPlayback();
    setState((s) => ({
      ...s,
      currentFrame: Math.max(s.currentFrame - 1, 0),
    }));
  }, [stopPlayback]);

  const handleSliderChange = useCallback(
    (frame: number) => {
      stopPlayback();
      setState((s) => ({
        ...s,
        currentFrame: Math.max(0, Math.min(frame, s.totalFrames - 1)),
      }));
    },
    [stopPlayback],
  );

  const handlePlaybackSpeedChange = useCallback((fps: number) => {
    const nextFps = Math.max(0.5, Math.min(fps, 24));
    playbackFpsRef.current = nextFps;
    lastTickRef.current = 0;
    setState((s) => ({ ...s, playbackFps: nextFps }));
  }, []);

  const handleReset = useCallback(() => {
    stopPlayback();
    landmarkApi.invalidateCache(projectId);
    setState((s) => ({
      ...INITIAL_STATE,
      imageDimensions: s.imageDimensions,
    }));
    setReplacementFileError(null);
  }, [projectId, stopPlayback]);

  const currentPrediction: FramePrediction | null =
    state.predictions[state.currentFrame] ?? null;

  const confidentCount = state.predictions.filter(
    (p) => p.flag === "normal" && p.confidence === "high",
  ).length;

  return {
    state,
    replacementFileError,
    currentPrediction,
    confidentCount,
    handleRunDetection,
    handleRerunDetection,
    handleFileSelect,
    handleClearReplacementFile,
    handleTogglePlay,
    handleNextFrame,
    handlePrevFrame,
    handleSliderChange,
    handlePlaybackSpeedChange,

    handleReset,
  };
}
