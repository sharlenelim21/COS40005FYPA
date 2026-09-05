"use client";

import { cn } from "@/lib/utils";

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
  className,
}: {
  value: ChamberFocus;
  onChange: (focus: ChamberFocus) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="3D heart chamber focus"
      className={cn(
        "grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/20 p-1",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors",
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
