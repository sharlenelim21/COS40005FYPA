import * as React from "react"

import { cn } from "@/lib/utils"

export type KineticState = "running" | "queued"

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
  return (
    <span aria-hidden={label ? undefined : true} className="pointer-events-none absolute inset-0">
      <KineticProgress state={state} size="h-full" className="opacity-25" style={{ position: "absolute", inset: 0, borderRadius: 0 }} />
      <KineticProgress
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
    <div className={cn("w-full space-y-1", className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs font-bold">
        {title && <span className="min-w-0 truncate">{title}</span>}
        <span className="ml-auto tabular-nums">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={title ? `${title} progress` : "Progress"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.25 w-full overflow-hidden rounded-full bg-foreground/10"
      >
        <div
          className="h-full rounded-full bg-blue-700 transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
