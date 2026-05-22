"use client";

import { useParams, useRouter } from "next/navigation";
import { useProject } from "@/context/ProjectContext";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

// Custom components
import { NoProjectFound } from "@/components/project/NoProjectFound";
import { ErrorProject } from "@/components/project/ErrorProject";
import { LoadingProject } from "@/components/project/LoadingProject";
import { DebugMRIViewer } from "@/components/project/DebugMRIViewer";

export default function PreviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
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
      {/* Back to Project Button */}
      <div className="px-4 pt-3 pb-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push(`/project/${projectId}`)}
          className="gap-2 rounded-lg border-border/50 bg-background/50 hover:bg-accent/50 hover:border-border text-foreground/70 hover:text-foreground transition-all duration-200 shadow-sm hover:shadow-md"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Project</span>
        </Button>
      </div>

      {/* Debug MRI Image Viewer */}
      <DebugMRIViewer projectId={projectId} />
    </div>
  ) : null;
}
