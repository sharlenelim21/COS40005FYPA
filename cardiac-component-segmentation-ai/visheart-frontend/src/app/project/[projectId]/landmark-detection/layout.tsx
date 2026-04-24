/**
 * src/app/project/[projectId]/landmark-detection/layout.tsx
 * VisHeart — Landmark Detection route layout
 *
 * The project/[projectId] segment already has a layout.tsx that provides
 * the ProjectContext (useProject). This layout wraps the landmark detection
 * page with the same context so we get projectData, hasReconstructions, etc.
 *
 * If your existing project/[projectId]/layout.tsx already wraps all child
 * routes in ProjectProvider, you do NOT need this file — delete it.
 * Keep it only if the landmark route is at a different nesting level.
 */

import type { ReactNode } from "react";

/**
 * Passthrough layout — inherits ProjectProvider from
 * src/app/project/[projectId]/layout.tsx automatically via Next.js nesting.
 *
 * Add any landmark-page-specific providers here if needed in future sprints.
 */
export default function LandmarkDetectionLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/*
 * ──────────────────────────────────────────────────────────────────────────────
 * NAVIGATION INTEGRATION
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Sprint 2 Task 1 — Make /landmark-detection reachable from navigation.
 *
 * The page is automatically routed by Next.js App Router at:
 *   /project/[projectId]/landmark-detection
 *
 * To add a nav link, find where your segmentation link is defined.
 * Based on the project structure, this is likely in one of:
 *   • src/components/project/ProjectNav.tsx
 *   • src/ui/header/header.tsx
 *   • src/app/project/[projectId]/layout.tsx (sidebar nav)
 *
 * ADD this entry alongside the existing "Segmentation" link:
 * ─────────────────────────────────────────────────────────
 *
 *   import { Crosshair } from "lucide-react";
 *
 *   // In your nav items array:
 *   {
 *     href: `/project/${projectId}/landmark-detection`,
 *     label: "Landmarks",
 *     icon: Crosshair,
 *   },
 *
 * ─────────────────────────────────────────────────────────
 *
 * ALSO ADD a "Proceed to Landmark Detection" button at the bottom of the
 * segmentation page's sidebar action area (src/components/segmentation/
 * segmentation-sidebar.tsx), after the existing Save button block:
 *
 *   import { useRouter } from "next/navigation";
 *   import { useParams } from "next/navigation";
 *   import { Crosshair } from "lucide-react";
 *
 *   const router = useRouter();
 *   const { projectId } = useParams();
 *
 *   <Button
 *     variant="outline"
 *     size="sm"
 *     className="w-full text-xs gap-2 mt-2"
 *     onClick={() => router.push(`/project/${projectId}/landmark-detection`)}
 *   >
 *     <Crosshair className="h-3.5 w-3.5" />
 *     Landmark Detection ↗
 *   </Button>
 *
 * ─────────────────────────────────────────────────────────
 *
 * ENVIRONMENT VARIABLES to add to .env.local:
 *
 *   # Set to "false" when real model endpoint is ready (Sprint 2 W2 D3)
 *   NEXT_PUBLIC_LANDMARK_USE_STUB=true
 *
 *   # Real endpoint path (relative to NEXT_PUBLIC_API_URL)
 *   NEXT_PUBLIC_LANDMARK_ENDPOINT=/landmark-detection/infer
 *
 * ──────────────────────────────────────────────────────────────────────────────
 */
