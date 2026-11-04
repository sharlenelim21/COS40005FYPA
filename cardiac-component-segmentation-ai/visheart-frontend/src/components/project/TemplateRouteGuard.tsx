"use client";

// Template hearts are shown on the landmark page only. Any other project page
// (overview, segmentation editor, report, 4D viewer) is sent there instead —
// those pages are built for editing and running jobs, which the server
// refuses for templates anyway.

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useProject } from "@/context/ProjectContext";

export function TemplateRouteGuard() {
  const { projectData } = useProject();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!projectData?.isTemplate || !projectData.projectId) return;
    if (pathname?.endsWith("/landmark-detection")) return;
    router.replace(`/project/${projectData.projectId}/landmark-detection`);
  }, [projectData?.isTemplate, projectData?.projectId, pathname, router]);

  return null;
}
