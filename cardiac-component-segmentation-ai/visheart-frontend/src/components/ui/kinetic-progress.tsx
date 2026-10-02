import * as React from "react"
import { Heart } from "lucide-react"

import { cn } from "@/lib/utils"

export type KineticState = "running" | "queued"

/**
 * The shared "cute heart logo floaty thing" decoration — lives here, not at
 * each call site, so every progress indicator in the app (landmark,
 * segmentation, 4D reconstruction, ...) gets it automatically just by using
 * JobProgress/KineticProgress/ProgressMeter.
 */
function FloatyHeart({ className }: { className?: string }) {
  return (
    <Heart
      aria-hidden
      className={cn("vh-heart-floaty h-3 w-3 shrink-0 fill-current text-pink-500", className)}
    />
  )
}

/**
 * A heart-shaped badge that floats ABOVE the bar, horizontally tracking the
 * current percentage (like a tooltip that rides the fill edge), with the
 * number inside it and a small caret pointing down at the bar — the look
 * asked for directly (reference: a round badge above each bar, pinned to
 * where its fill ends, with a caret connecting it to the track).
 */
function HeartProgressBadge({ pct }: { pct: number }) {
  // Clamp so the badge never hangs off either end of the (narrower) track.
  const left = Math.min(94, Math.max(6, pct))
  return (
    <div
      className="absolute bottom-full flex -translate-x-1/2 flex-col items-center pb-1"
      style={{ left: `${left}%` }}
    >
      <div className="relative flex h-6 w-6 items-center justify-center">
        <Heart aria-hidden className="vh-heart-floaty absolute inset-0 h-full w-full fill-pink-500 text-pink-500 drop-shadow-sm" />
        <span className="relative z-10 mt-[-2px] text-[8px] font-extrabold leading-none text-white">
          {pct}%
        </span>
      </div>
      <div className="h-0 w-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-pink-500" />
    </div>
  )
}

const TONES = {
  blue:    { track: "bg-blue-500/15",  fill: "bg-blue-500" },
  primary: { track: "bg-primary/15",   fill: "bg-primary" },
  green:   { track: "bg-green-500/15", fill: "bg-green-500" },
} as const

export function kineticStateFromJobStatus(status: string | null | undefined): KineticState | null {
  const s = (status ?? "").toLowerCase()
  if (s === "in_progress" || s === "processing" || s === "running") return "running"
  if (s === "pending" || s === "queued") return "queued"
  return null
}

interface KineticProgressProps {
  state?: KineticState
  tone?: keyof typeof TONES
  size?: string
  className?: string
  label?: string
  style?: React.CSSProperties
}

export function KineticProgress({
  state = "running",
  tone = "blue",
  size = "h-1.5",
  className,
  label,
  style,
}: KineticProgressProps) {
  const colors = TONES[tone]
  return (
    <div
      role="progressbar"
      aria-busy="true"
      aria-label={label ?? (state === "running" ? "Running" : "Queued")}
      data-state={state}
      className={cn("vh-kinetic-track w-full", size, colors.track, className)}
      style={style}
    >
      {state === "running" ? (
        <>
          <div className={cn("vh-kinetic-fill", colors.fill)} />
          <div className="vh-kinetic-sweep" />
        </>
      ) : (
        <div className="vh-kinetic-queued absolute inset-0" />
      )}
    </div>
  )
}

export function hasProgressReading(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}
export function KineticButtonFill({
  state = "running",
  label,
  value,
}: {
  state?: KineticState
  label?: string
  value?: number | null
}) {
  if (hasProgressReading(value)) {
    return <span aria-hidden className="pointer-events-none absolute inset-0 bg-blue-500/10" />
  }
  // A SINGLE bottom-aligned indeterminate bar, not two independently
  // animated ones stacked on top of each other — stacking a full-height
  // "breathing" bar under a bottom h-1 "breathing" bar let the two fall out
  // of phase and read as a jagged/sawtooth edge once a job had been running
  // a while (reported live as a "glitch", 2026-10). One bar can't desync
  // with itself.
  return (
    <span aria-hidden={label ? undefined : true} className="pointer-events-none absolute inset-0 overflow-hidden">
      <KineticProgress
        tone="blue"
        state={state}
        size="h-1"
        label={label}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, borderRadius: 0 }}
      />
    </span>
  )
}
export function ProgressMeter({
  value,
  title,
  className,
}: {
  value: number
  title?: string
  className?: string
}) {
  const pct = Math.round(Math.max(0, Math.min(100, value)))
  return (
    <div className={cn("w-full", className)}>
      {title && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs font-bold">
          <span className="min-w-0 truncate">{title}</span>
        </div>
      )}
      {/* Extra top padding reserves room for the floating heart badge, which
          rides above the fill's own edge rather than sitting in a fixed
          corner — it visually tracks progress the way a tooltip would. */}
      <div className="relative pt-7">
        <HeartProgressBadge pct={pct} />
        <div
          role="progressbar"
          aria-label={title ? `${title} progress` : "Progress"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10"
        >
          <div
            className="h-full rounded-full bg-blue-700 transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * A job's progress bar. Shows the real percentage once the GPU has reported one, and falls back to
 * the indeterminate bar while a job is queued or has not reported anything yet.
 */
export function JobProgress({
  progress,
  status,
  className,
  label,
}: {
  progress?: number | null
  status: string | null | undefined
  className?: string
  label?: string
}) {
  const state = kineticStateFromJobStatus(status)
  if (!state) return null
  if (state === "running" && hasProgressReading(progress)) {
    return <ProgressMeter className={className} value={progress} title={label} />
  }
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <KineticProgress size="h-1" className="flex-1" state={state} label={label} />
      {state === "running" && <FloatyHeart />}
    </div>
  )
}
