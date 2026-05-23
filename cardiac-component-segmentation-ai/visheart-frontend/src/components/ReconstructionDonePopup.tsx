"use client";

import { useState, useEffect, useRef } from "react";
import { X, Layers, Crosshair } from "lucide-react";

interface ReconstructionDonePopupProps {
  storageKey: string;
  projectId: string;
  model?: string | null;
  onViewSegmentation: () => void;
  onRunLandmark: () => void;
}

export function ReconstructionDonePopup({
  storageKey,
  onViewSegmentation,
  onRunLandmark,
}: ReconstructionDonePopupProps) {
  const [shown, setShown] = useState(false);
  const [hovered, setHovered] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (sessionStorage.getItem(storageKey)) return;
    const t = setTimeout(() => { fired.current = true; setShown(true); }, 400);
    return () => clearTimeout(t);
  }, [storageKey]);

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
      className={`fixed z-[9999] overflow-hidden rounded-xl shadow-lg transition-all duration-200 ${
        hovered
          ? "w-[280px] border border-border bg-background"
          : "w-12 h-12 bg-foreground cursor-pointer animate-pulse shadow-lg shadow-foreground/40"
      }`}
      style={{ bottom: "80px", right: "16px" }}
    >
      {/* Collapsed: solid square */}
      {!hovered && (
        <div className="w-12 h-12 flex items-center justify-center text-[22px]">
          🎉
        </div>
      )}

      {/* Expanded */}
      {hovered && (
        <div className="p-3">
          <div className="flex items-start justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-base">🎉</span>
              <div>
                <p className="m-0 text-xs font-semibold text-foreground">4D Reconstruction ready!</p>
                <p className="m-0 text-[10px] text-muted-foreground">What would you like to do next?</p>
              </div>
            </div>
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground bg-transparent border-none cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => { dismiss(); onViewSegmentation(); }}
              className="flex items-center gap-2 w-full px-2.5 py-2 rounded-lg border border-border bg-background hover:bg-muted transition-colors cursor-pointer text-left"
            >
              <Layers size={14} className="text-foreground shrink-0" />
              <span className="text-xs font-medium text-foreground">View Segmentation Mask</span>
            </button>
            <button
              onClick={() => { dismiss(); onRunLandmark(); }}
              className="flex items-center gap-2 w-full px-2.5 py-2 rounded-lg bg-foreground hover:opacity-90 transition-opacity cursor-pointer text-left border-none"
            >
              <Crosshair size={14} className="text-background shrink-0" />
              <span className="text-xs font-medium text-background">Run Landmark Detection</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
