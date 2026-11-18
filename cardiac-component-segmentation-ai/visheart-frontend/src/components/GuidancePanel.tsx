"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { X, ChevronRight, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { isFaqHiddenRoute } from "@/lib/floating-widgets";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

interface GuidancePanelAction {
  label: string;
  icon?: React.ReactNode;
  primary?: boolean;
  onClick: () => void;
}

interface GuidancePanelProps {
  storageKey: string;
  icon: string;
  title: string;
  subtitle?: string;
  actions: GuidancePanelAction[];
  onDismissWithoutAction?: () => void;
}

export function GuidancePanel({
  storageKey,
  icon,
  title,
  subtitle,
  actions,
  onDismissWithoutAction,
}: GuidancePanelProps) {
  const dismissedKey = `${storageKey}-dismissed`;
  const actedKey = `${storageKey}-acted`;

  const [dismissed, setDismissed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const faqVisible = !isFaqHiddenRoute(pathname);
  const expandRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (collapsed ? expandRef : collapseRef).current?.focus();
  }, [collapsed]);

  const toggleCollapsed = (next: boolean) => {
    moveFocus.current = true;
    setCollapsed(next);
  };

  useEffect(() => {
    try {
      if (sessionStorage.getItem(dismissedKey)) setDismissed(true);
    } catch {}
  }, [dismissedKey]);

  const handleDismiss = () => {
    try { sessionStorage.setItem(dismissedKey, "1"); } catch {}
    if (!sessionStorage.getItem(actedKey)) {
      onDismissWithoutAction?.();
    }
    setDismissed(true);
  };

  const handleAction = (action: GuidancePanelAction) => {
    try { sessionStorage.setItem(actedKey, "1"); } catch {}
    try { sessionStorage.setItem(dismissedKey, "1"); } catch {}
    action.onClick();
  };

  if (dismissed) return null;

  const primaryIndex = actions.findIndex((action) => action.primary);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("fixed right-0 z-40 flex items-end", faqVisible ? "bottom-[4.5rem]" : "bottom-4")}
    >
      {/* Collapsed tab */}
      {collapsed && (
        <button
          ref={expandRef}
          type="button"
          onClick={() => toggleCollapsed(false)}
          className={cn(
            "flex cursor-pointer items-center gap-1 rounded-l-lg border border-r-0 border-primary/40 bg-primary px-2 py-3 text-xs font-medium text-primary-foreground shadow-lg transition-opacity hover:opacity-90",
            focusRing,
          )}
          aria-label={`Expand guidance: ${title}`}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      )}

      {/* Expanded panel */}
      {!collapsed && (
        <div
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            toggleCollapsed(true);
          }}
          className="relative w-80 max-w-[calc(100vw-1rem)] overflow-hidden rounded-l-xl border border-r-0 border-primary/40 bg-background shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right motion-safe:duration-300"
        >
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-primary" />
          {/* Header */}
          <div className="flex items-start justify-between gap-2 py-3 pr-2 pl-4">
            <div className="flex min-w-0 items-start gap-2">
              <span className="text-lg leading-none" aria-hidden="true">{icon}</span>
              <div className="min-w-0">
                <p className="text-sm leading-snug font-semibold text-foreground">{title}</p>
                {subtitle && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{subtitle}</p>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                ref={collapseRef}
                type="button"
                onClick={() => toggleCollapsed(true)}
                aria-label="Collapse guidance panel"
                title="Collapse (Esc)"
                className={cn("cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", focusRing)}
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleDismiss}
                aria-label="Dismiss guidance panel"
                title="Dismiss"
                className={cn("cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", focusRing)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 pr-3 pb-3 pl-4">
            {actions.map((action, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleAction(action)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                  focusRing,
                  i === primaryIndex
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border border-border bg-background text-foreground hover:bg-muted",
                )}
              >
                {action.icon && <span className="shrink-0" aria-hidden="true">{action.icon}</span>}
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
