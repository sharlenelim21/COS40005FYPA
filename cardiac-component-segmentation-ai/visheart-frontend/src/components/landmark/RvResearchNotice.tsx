import Link from "next/link";
import { ArrowUpRight, FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";
import { RV_STRAIN_METHOD_HREF } from "@/components/doc/guides";

interface RvResearchNoticeProps {
  /** One-line version for tight spots (the main bullseye panel). */
  compact?: boolean;
  /** Optional extra sentence, e.g. what the selected RV metric measures. */
  detail?: string;
  className?: string;
}

/**
 * Red "Research output only" warning shown wherever RV strain appears on the
 * Strain tab. The whole notice is a link to the Technical Guide's RV method
 * part of "How LV and RV Works" (9 segments, ray casting, formulas, references).
 * Opens in a new tab so the user keeps their place in the project.
 */
export function RvResearchNotice({ compact = false, detail, className }: RvResearchNoticeProps) {
  return (
    <Link
      href={RV_STRAIN_METHOD_HREF}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the Technical Guide's explanation of the RV strain method (new tab)"
      className={cn(
        "block rounded-md border border-red-500/50 bg-red-500/10 text-red-700 transition-colors",
        "hover:border-red-500 hover:bg-red-500/15 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none",
        "dark:text-red-400",
        compact ? "px-3 py-2" : "px-2.5 py-1.5",
        className,
      )}
    >
      {compact ? (
        <p className="flex items-start gap-1.5 text-[13px] leading-snug">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-bold uppercase tracking-wide">Research output only</span> — RV strain is
            our own method adapted from the LV; still under research and not validated.{" "}
            <span className="inline-flex items-center font-semibold underline underline-offset-2">
              How it works
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </span>
        </p>
      ) : (
        <>
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide">
            <FlaskConical className="h-3 w-3 shrink-0" aria-hidden="true" />
            Research output only
          </p>
          <p className="mt-0.5 text-[9.5px] leading-snug">
            RV strain is still under research. The 9-segment RV bullseye and its GCS, GAS and FAC values come from
            our own method, adapted from how VisHeart measures the LV and from published RV research. They are not
            validated against any clinical reference range.
          </p>
          {detail && <p className="mt-1 text-[9.5px] leading-snug">{detail}</p>}
          <p className="mt-1 inline-flex items-center gap-0.5 text-[9.5px] font-semibold underline underline-offset-2">
            How we calculate RV strain
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </p>
        </>
      )}
      <span className="sr-only"> (opens in a new tab)</span>
    </Link>
  );
}
