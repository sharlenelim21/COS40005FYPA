"use client";

import { useParams } from "next/navigation";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ProjectProvider } from "@/context/ProjectContext";
import { TemplateRouteGuard } from "@/components/project/TemplateRouteGuard";
import { ReconstructionWarmupHost } from "@/components/reconstruction/ReconstructionWarmupHost";

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();

  return (
    <ProtectedRoute allowedRoles={["guest", "user", "admin"]}>
      {projectId && (
        <ProjectProvider projectId={projectId}>
          <div className="min-h-screen w-full bg-background">
            <TemplateRouteGuard />
            <div className="w-full">{children}</div>
          </div>
          {/* Lives at this layout, not inside any one page, so it stays mounted (and whatever
              it's already warmed stays warm) across navigation within this project -- including
              from the project page, where reconstruction preload normally runs, to the standalone
              4D viewer, which should already be warm by the time it's opened. */}
          <ReconstructionWarmupHost />
        </ProjectProvider>
      )}
    </ProtectedRoute>
  );
}
