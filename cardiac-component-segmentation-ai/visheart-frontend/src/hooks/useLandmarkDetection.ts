"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { landmarkApi, LandmarkApiError } from "@/lib/landmarkApi";
import type { LandmarkPageState, FramePrediction, LandmarkInferenceResponse } from "@/types/landmark";

const PLAYBACK_FPS = 8; // Sprint 2 spec: 5–10 FPS
const PLAYBACK_INTERVAL_MS = Math.round(1000 / PLAYBACK_FPS);

const INITIAL_STATE: LandmarkPageState = {
  status: "idle",
  uploadedFile: null,
  predictions: [],
  totalFrames: 0,
  imageDimensions: { width: 256, height: 256 },
  currentFrame: 0,
  isPlaying: false,
  error: null,
  modelUsed: "",
};

/** Accepted file extensions (Sprint 2 Task 4) */
function validateNiftiFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".nii") && !name.endsWith(".nii.gz")) {
    return "Invalid file type. Please upload a .nii or .nii.gz NIfTI file.";
  }
  if (file.size > 500 * 1024 * 1024) {
    // 500 MB guard
    return "File is too large (max 500 MB).";
  }
  return null;
}

export function useLandmarkDetection(projectId: string) {
  const [state, setState] = useState<LandmarkPageState>(INITIAL_STATE);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const playbackTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPlayback = useCallback(() => {
    if (playbackTimer.current) {
      clearInterval(playbackTimer.current);
      playbackTimer.current = null;
    }
    setState((s) => ({ ...s, isPlaying: false }));
  }, []);

  const goToFrame = useCallback(
    (frame: number) => {
      setState((s) => {
        const clamped = Math.max(0, Math.min(frame, s.totalFrames - 1));
        return { ...s, currentFrame: clamped };
      });
    },
    [],
  );

  //File validation & upload 

  const handleFileSelect = useCallback(
    (file: File | null) => {
      if (!file) return;
      const err = validateNiftiFile(file);
      setFileError(err);
      if (err) return;

      stopPlayback();
      landmarkApi.clearCache(projectId, file.name);
      setState({
        ...INITIAL_STATE,
        status: "idle",
        uploadedFile: file,
      });
    },
    [projectId, stopPlayback],
  );

  // Run detection (calls API / stub) 

  const handleRunDetection = useCallback(async () => {
    if (!state.uploadedFile) {
      setFileError("Please select a .nii or .nii.gz file first.");
      return;
    }
    stopPlayback();
    setState((s) => ({ ...s, status: "running", error: null }));
    setUploadProgress(0);

    try {
      const result: LandmarkInferenceResponse = await landmarkApi.runDetection(
        projectId,
        state.uploadedFile,
        (pct) => setUploadProgress(pct),
      );

      if (!result.predictions.length) {
        setState((s) => ({
          ...s,
          status: "error",
          error: "The model returned no predictions. Please try another file.",
        }));
        return;
      }

      setState((s) => ({
        ...s,
        status: "done",
        predictions: result.predictions,
        totalFrames: result.total_frames,
        imageDimensions: result.image_dimensions,
        currentFrame: 0,
        modelUsed: result.model_used,
        error: null,
      }));
    } catch (err) {
      const msg =
        err instanceof LandmarkApiError
          ? err.message
          : "Detection failed. Please try again.";
      setState((s) => ({ ...s, status: "error", error: msg }));
      console.error("[useLandmarkDetection] ❌", err);
    } finally {
      setUploadProgress(0);
    }
  }, [state.uploadedFile, projectId, stopPlayback]);

  // Playback controls 

  const handlePlay = useCallback(() => {
    if (state.status !== "done" || state.totalFrames < 2) return;
    stopPlayback();
    setState((s) => ({ ...s, isPlaying: true }));

    playbackTimer.current = setInterval(() => {
      setState((s) => {
        if (!s.isPlaying) return s;
        const next = (s.currentFrame + 1) % s.totalFrames;
        return { ...s, currentFrame: next };
      });
    }, PLAYBACK_INTERVAL_MS);
  }, [state.status, state.totalFrames, stopPlayback]);

  const handlePause = useCallback(() => stopPlayback(), [stopPlayback]);

  const handleTogglePlay = useCallback(() => {
    if (state.isPlaying) handlePause();
    else handlePlay();
  }, [state.isPlaying, handlePlay, handlePause]);

  const handleNextFrame = useCallback(() => {
    stopPlayback();
    setState((s) => ({
      ...s,
      currentFrame: Math.min(s.currentFrame + 1, s.totalFrames - 1),
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
    (value: number) => {
      stopPlayback();
      goToFrame(value);
    },
    [stopPlayback, goToFrame],
  );

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (playbackTimer.current) clearInterval(playbackTimer.current);
    };
  }, []);

  // Derived current-frame data 

  const currentPrediction: FramePrediction | null =
    state.predictions[state.currentFrame] ?? null;

  const handleReset = useCallback(() => {
    stopPlayback();
    setState(INITIAL_STATE);
    setFileError(null);
    setUploadProgress(0);
  }, [stopPlayback]);

  return {
    // State
    state,
    fileError,
    uploadProgress,
    currentPrediction,

    // File handlers
    handleFileSelect,

    // Detection
    handleRunDetection,

    // Playback
    handleTogglePlay,
    handleNextFrame,
    handlePrevFrame,
    handleSliderChange,

    // Misc
    handleReset,
  };
}
