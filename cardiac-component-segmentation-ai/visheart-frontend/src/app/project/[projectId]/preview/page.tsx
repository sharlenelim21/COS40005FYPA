"use client";

import { useParams } from "next/navigation";
import { useProject } from "@/context/ProjectContext";
import { useEffect } from "react";

// Custom components
import { NoProjectFound } from "@/components/project/NoProjectFound";
import { ErrorProject } from "@/components/project/ErrorProject";
import { LoadingProject } from "@/components/project/LoadingProject";
import { DebugMRIViewer } from "@/components/project/DebugMRIViewer";

export default function PreviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { loading, projectData, error } = useProject();

  // Update page title dynamically
  useEffect(() => {
    if (projectData?.name) {
      document.title = `VisHeart | ${projectData.name} - Image Preview`;
    } else {
      document.title = "VisHeart | Image Preview";
    }
    
    return () => {
      document.title = "VisHeart";
    };
  }, [projectData?.name]);

  // Missing projectId handling
  if (!projectId) return <NoProjectFound message="Project ID is missing." />;

  // Loading state
  if (loading !== "done") return <LoadingProject loadingStage={loading} />;

  // Error states
  if (error) return <ErrorProject error={error} />;

  return projectData ? (
    <div>
      {/* Debug MRI Image Viewer */}
      <DebugMRIViewer projectId={projectId} />
    </div>
  ) : null;
}
