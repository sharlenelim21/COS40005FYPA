"use client";

import { useParams, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type ChamberFocus = "combined" | "LV" | "RV";

/** A chamber that isn't available yet -- the message explains why, and `chamber` says which one
 *  (LV or RV) a click should go build, via the "Reconstruct {chamber} to view this" link. */
export interface ChamberUnavailable {
  message: string;
  chamber: "LV" | "RV";
}

const OPTIONS: { value: ChamberFocus; label: string }[] = [
  { value: "combined", label: "Combined" },
  { value: "LV", label: "LV" },
  { value: "RV", label: "RV" },
];

export function ChamberFocusToggle({
  value,
  onChange,
  disabled = false,
  /** Per-option reason a chamber can't be selected yet (e.g. its reconstruction hasn't been
   *  built) -- that option renders blurred, with this reason on hover, and a click goes straight
   *  to building that reconstruction instead of switching the focus. "combined" falls back to
   *  whichever of LV/RV is actually missing, since it needs both. */
  disabledOptions,
  allowedOptions,
  className,
}: {
  value: ChamberFocus;
  onChange: (focus: ChamberFocus) => void;
  disabled?: boolean;
  disabledOptions?: Partial<Record<ChamberFocus, ChamberUnavailable>>;
  allowedOptions?: readonly ChamberFocus[];
  className?: string;
}) {
  const router = useRouter();
  const { projectId } = useParams<{ projectId: string }>();
  const combinedReason = disabledOptions?.combined ?? disabledOptions?.LV ?? disabledOptions?.RV;
  const reasonFor = (option: ChamberFocus): ChamberUnavailable | undefined =>
    option === "combined" ? combinedReason : disabledOptions?.[option];
  const options = allowedOptions ? OPTIONS.filter((option) => allowedOptions.includes(option.value)) : OPTIONS;

  if (options.length < 2) return null;

  return (
    <div
      role="group"
      aria-label="3D heart chamber focus"
      className={cn(
        "grid gap-1 rounded-lg border border-border bg-muted/20 p-0.5",
        options.length === 2 ? "grid-cols-2" : "grid-cols-3",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {options.map((option) => {
        const reason = reasonFor(option.value);
        const button = (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() =>
              reason ? router.push(`/project/${projectId}?build=${reason.chamber.toLowerCase()}`) : onChange(option.value)
            }
            className={cn(
              "w-full rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
              reason
                ? "text-muted-foreground opacity-50 hover:opacity-80"
                : value === option.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
        if (!reason) return button;
        return (
          <Tooltip key={option.value}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>
              <p className="font-medium">{reason.message}</p>
              <p className="opacity-90">Click to reconstruct {reason.chamber}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
