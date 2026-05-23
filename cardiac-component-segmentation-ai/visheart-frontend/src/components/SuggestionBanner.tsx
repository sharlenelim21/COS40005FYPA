"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";

interface SuggestionBannerProps {
  storageKey: string;
  icon: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  bottomOffset?: number;
  delay?: number;
  showCondition?: string;
}

export function SuggestionBanner({
  storageKey,
  icon,
  message,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  bottomOffset = 80,
  delay = 400,
  showCondition,
}: SuggestionBannerProps) {
  const [shown, setShown] = useState(false);
  const [hovered, setHovered] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (sessionStorage.getItem(storageKey)) return;
    if (showCondition && !sessionStorage.getItem(showCondition)) return;
    const t = setTimeout(() => { fired.current = true; setShown(true); }, delay);
    return () => clearTimeout(t);
  }, [storageKey, delay, showCondition]);

  const dismiss = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    sessionStorage.setItem(storageKey, "1");
    setShown(false);
  };

  if (!shown) return null;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`fixed z-[9998] overflow-hidden rounded-xl shadow-lg transition-all duration-200 ${
        hovered
          ? "w-[272px] border border-border bg-background"
          : "w-12 h-12 bg-foreground cursor-pointer animate-pulse shadow-lg shadow-foreground/40"
      }`}
      style={{ bottom: `${bottomOffset}px`, right: "16px" }}
    >
      {/* Collapsed: solid square */}
      {!hovered && (
        <div className="w-12 h-12 flex items-center justify-center text-[22px]">
          {icon}
        </div>
      )}

      {/* Expanded */}
      {hovered && (
        <div className="p-3">
          <div className="flex items-start gap-2 mb-2.5">
            <span className="text-base shrink-0 mt-0.5">{icon}</span>
            <p className="flex-1 text-xs font-medium text-foreground leading-snug m-0">
              {message}
            </p>
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer"
            >
              <X size={13} />
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => { dismiss(); onAction(); }}
              className="w-full py-1.5 px-2.5 rounded-lg bg-foreground text-background text-xs font-medium cursor-pointer border-none hover:opacity-90 transition-opacity"
            >
              {actionLabel}
            </button>
            {secondaryActionLabel && onSecondaryAction && (
              <button
                onClick={() => { dismiss(); onSecondaryAction(); }}
                className="w-full py-1.5 px-2.5 rounded-lg bg-background text-foreground text-xs font-medium cursor-pointer border border-border hover:bg-muted transition-colors"
              >
                {secondaryActionLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
