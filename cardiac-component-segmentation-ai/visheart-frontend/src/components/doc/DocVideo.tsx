"use client";

import React, { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { DOC_VIDEO_SIZES } from "@/components/doc/docVideoSizes";

export type DocVideoMode = "loop" | "walkthrough";

interface DocVideoProps {
  src: string;
  ariaLabel: string;
  mode: DocVideoMode;
  poster?: string;
  maxWidth?: number;
  className?: string;
}

export const DocVideo: React.FC<DocVideoProps> = ({ src, ariaLabel, mode, poster, maxWidth, className }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const isLoop = mode === "loop";

  const [width, height] = DOC_VIDEO_SIZES[src] ?? [];
  const caps = [width, maxWidth].filter((value): value is number => value !== undefined);
  const cap = caps.length > 0 ? Math.min(...caps) : undefined;

  useEffect(() => {
    const video = videoRef.current;
    if (!isLoop || !video) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    video.play().catch(() => {});
  }, [isLoop]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  return (
    <div className="relative mx-auto w-full" style={cap ? { maxWidth: cap } : undefined}>
      <video
        ref={videoRef}
        src={poster ? src : `${src}#t=0.001`}
        poster={poster}
        width={width}
        height={height}
        aria-label={ariaLabel}
        preload="metadata"
        muted
        playsInline
        loop={isLoop}
        controls={!isLoop}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className={`block h-auto w-full ${className ?? ""}`}
        style={width && height ? { aspectRatio: `${width} / ${height}` } : undefined}
      />
      {isLoop && (
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={playing ? "Pause animation" : "Play animation"}
          className="bg-background/85 text-foreground hover:bg-background focus-visible:ring-ring absolute right-2 bottom-2 inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-sm backdrop-blur-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
        </button>
      )}
    </div>
  );
};
