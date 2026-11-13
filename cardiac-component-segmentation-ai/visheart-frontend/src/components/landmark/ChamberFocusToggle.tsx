"use client";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type ChamberFocus = "combined" | "LV" | "RV";

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
   *  built) -- that option renders blurred/unclickable with this text on hover, instead of the
   *  whole group being disabled. "combined" is disabled automatically whenever either LV or RV
   *  is, since it needs both. */
  disabledOptions,
  className,
}: {
  value: ChamberFocus;
  onChange: (focus: ChamberFocus) => void;
  disabled?: boolean;
  disabledOptions?: Partial<Record<ChamberFocus, string>>;
  className?: string;
}) {
  const combinedReason = disabledOptions?.combined ?? disabledOptions?.LV ?? disabledOptions?.RV;
  const reasonFor = (option: ChamberFocus): string | undefined =>
    option === "combined" ? combinedReason : disabledOptions?.[option];

  return (
    <div
      role="group"
      aria-label="3D heart chamber focus"
      className={cn(
        "grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/20 p-0.5",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const reason = reasonFor(option.value);
        const button = (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            disabled={!!reason}
            onClick={() => onChange(option.value)}
            className={cn(
              "w-full rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
              reason
                ? "cursor-not-allowed text-muted-foreground opacity-50"
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
            <TooltipTrigger asChild>
              {/* A disabled <button> doesn't fire hover events in most browsers, so the
                  tooltip trigger wraps it in a span instead -- same pattern already used
                  elsewhere in this app for a disabled-button-with-reason tooltip. */}
              <span className="inline-block">{button}</span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{reason}</p>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
