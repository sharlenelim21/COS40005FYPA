import Link from "next/link";
import { ArrowUpRight, FlaskConical, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { RV_STRAIN_METHOD_HREF } from "@/components/doc/guides";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

interface RvResearchNoticeProps {
  /** One-line version for tight spots (the main bullseye panel). */
  compact?: boolean;
  /** Optional extra sentence, e.g. what the selected RV metric measures. */
  detail?: string;
  /** "strain" (default): wherever RV strain appears, links to the Technical Guide's RV strain
   *  method. "model": wherever only the RV 3D mesh/geometry is shown (no strain involved, e.g.
   *  the standalone 4D viewer) -- drops every strain-specific sentence and the "How we
   *  calculate..." link, and renders as a plain (non-clickable) warning instead. */
  subject?: "strain" | "model";
  className?: string;
}

/**
 * Red "Research output only" warning shown wherever RV strain or the RV 3D mesh appears. For
 * `subject="strain"` the whole notice is a link to the Technical Guide's RV method part of
 * "How LV and RV Works" (9 segments, ray casting, formulas, references), opened in a new tab so
 * the user keeps their place in the project. For `subject="model"` it's a plain warning with no
 * link -- there's nothing strain-related to explain on a page showing only the reconstructed mesh.
 */
export function RvResearchNotice({ compact = false, detail, subject = "strain", className }: RvResearchNoticeProps) {
  const isModel = subject === "model";

  const body = (
    <>
      {compact ? (
        <p className="flex items-start gap-1.5 text-[12.5px] leading-snug">
          <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-bold uppercase tracking-wide">RV is research output only</span> — still under
            research
            {isModel ? (
              ", and has not passed accuracy validation."
            ) : (
              <>
                , adapted from the LV method and not yet validated.{" "}
                <span className="inline-flex items-center font-semibold underline underline-offset-2">
                  How it works
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </>
            )}
          </span>
        </p>
      ) : (
        <>
          <p className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wide">
            <FlaskConical className="h-3 w-3 shrink-0" aria-hidden="true" />
            RV is Research output only
          </p>
          {isModel ? (
            <p className="mt-0.5 text-[12px] leading-snug">
              This is our own research output and is still under research. The RV shape model has not passed
              accuracy validation, so RV geometry, volumes and any measurement derived from them must not be used
              clinically or reported as a result.
            </p>
          ) : (
            <p className="mt-0.5 text-[12px] leading-snug">
              This is our own research output and is still under research. The 9-segment RV bullseye and its GCS, GAS
              and FAC values come from our own method, adapted from how VisHeart measures the LV and from published
              RV research. They are not validated against any clinical reference range.
            </p>
          )}
          {detail && <p className="mt-1 text-[12px] leading-snug">{detail}</p>}
          {!isModel && (
            <p className="mt-1 inline-flex items-center gap-0.5 text-[12px] font-semibold underline underline-offset-2">
              How we calculate RV strain
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </p>
          )}
        </>
      )}
    </>
  );

  const sharedClassName = cn(
    "block rounded-md border border-red-500/50 bg-red-500/10 text-red-700",
    "dark:text-red-400",
    compact ? "px-3 py-2" : "px-2.5 py-1.5",
    className,
  );

  if (isModel) {
    return <div className={sharedClassName}>{body}</div>;
  }

  return (
    <Link
      href={RV_STRAIN_METHOD_HREF}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the Technical Guide's explanation of the RV strain method (new tab)"
      className={cn(sharedClassName, "transition-colors hover:border-red-500 hover:bg-red-500/15 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none")}
    >
      {body}
      <span className="sr-only"> (opens in a new tab)</span>
    </Link>
  );
}

/**
 * Small red "i" icon for a single RV-strain value (a metric tile, a table row) that doesn't have
 * room for the full RvResearchNotice box -- hovering it shows a tiny card with the same message,
 * and a "How it works" link to the Technical Guide's RV strain method. Used on the on-screen
 * report's Heart Metrics (RV Peak GCS/GAS/Septal GCS) and Health Status (RV's two strain rows).
 */
export function RvResearchInfoIcon({ className, label }: { className?: string; label?: string }) {
  return (
    <HoverCard openDelay={100} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={label ? `${label} — hover for details` : "RV strain is research output only — hover for details"}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 text-red-600 dark:text-red-400",
            label
              ? "rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
              : "h-3.5 w-3.5 justify-center rounded-full",
            className,
          )}
        >
          {label && <span>{label}</span>}
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        className="w-56 border-red-500/50 bg-red-50 p-2.5 text-red-800 dark:bg-red-950/60 dark:text-red-200"
      >
        <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide">
          <FlaskConical className="h-3 w-3 shrink-0" aria-hidden="true" />
          Research output only
        </p>
        <p className="mt-1 text-[11px] leading-snug">
          Our own method, adapted from the LV, not validated against any clinical reference range.
        </p>
        <Link
          href={RV_STRAIN_METHOD_HREF}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-semibold underline underline-offset-2 hover:no-underline"
        >
          How it works
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </HoverCardContent>
    </HoverCard>
  );
}
