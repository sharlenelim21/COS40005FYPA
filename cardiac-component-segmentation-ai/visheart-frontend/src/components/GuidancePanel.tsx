"use client";

import { useState, useEffect } from "react";
import { X, ChevronRight, ChevronLeft } from "lucide-react";

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

  return (
    <div
      className="fixed z-[9999] flex items-center"
      style={{ bottom: "24px", right: "0px" }}
    >
      {/* Collapsed tab */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="flex items-center gap-1 px-2 py-3 rounded-l-lg bg-foreground text-background text-xs font-medium shadow-lg hover:opacity-90 transition-opacity cursor-pointer border-none"
          aria-label="Expand guidance panel"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Expanded panel */}
      {!collapsed && (
        <div className="w-[280px] rounded-l-xl border border-border bg-background shadow-xl mr-0">
          {/* Header */}
          <div className="flex items-start justify-between p-3 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-lg">{icon}</span>
              <div>
                <p className="text-xs font-semibold text-foreground leading-snug">{title}</p>
                {subtitle && <p className="text-[10px] text-muted-foreground leading-snug">{subtitle}</p>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-1">
              <button
                onClick={() => setCollapsed(true)}
                aria-label="Collapse panel"
                className="p-0.5 text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleDismiss}
                aria-label="Dismiss"
                className="p-0.5 text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-1.5 px-3 pb-3">
            {actions.map((action, i) => (
              <button
                key={i}
                onClick={() => handleAction(action)}
                className={`flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-xs font-medium cursor-pointer border-none transition-colors text-left ${
                  action.primary
                    ? "bg-foreground text-background hover:opacity-90"
                    : "bg-background text-foreground border border-border hover:bg-muted"
                }`}
              >
                {action.icon && <span className="shrink-0">{action.icon}</span>}
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
