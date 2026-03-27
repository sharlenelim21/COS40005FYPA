// Show loading state when loading background tasks
"use client";

import { RefreshCw } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useEffect, useState } from "react";

// Type for loading state
import { LoadingStage } from "@/types/project";
export const LoadingProject = ({ loadingStage }: { loadingStage: LoadingStage }) => {
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Loading...");

  // Progress bar incrementing for each stage
  useEffect(() => {
    switch (loadingStage) {
      case "project":
        setProgress(16);
        setMessage("Loading project data...");
        break;
      case "mask":
        setProgress(33);
        setMessage("Loading segmentation masks...");
        break;
      case "job":
        setProgress(50);
        setMessage("Loading job data...");
        break;
      case "tar-cache":
        setProgress(66);
        setMessage("Initializing MRI image cache...");
        break;
      case "reconstruction-cache":
        setProgress(83);
        setMessage("Loading 4D reconstruction models...");
        break;
      case "idle":
        // Progress does not change
        setMessage("Awaiting next action...");
        break;
      case "done":
        setProgress(100);
        setMessage("All tasks completed.");
        break;
      default:
        break;
    }
  }, [loadingStage]);

  return (
    <div className="flex flex-col h-64 items-center justify-center">
      <div className="flex items-center space-x-2">
        <RefreshCw className="text-foreground h-4 w-4 animate-spin" />
        <span className="text-foreground text-sm">{message}</span>
      </div>
      <Progress className="w-1/4 h-1 mt-4" value={progress} />
    </div>
  );
};
