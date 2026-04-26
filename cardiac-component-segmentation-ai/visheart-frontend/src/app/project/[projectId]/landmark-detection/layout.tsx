/**
 * src/app/project/[projectId]/landmark-detection/layout.tsx
 * VisHeart — Landmark Detection route layout (passthrough)
 *
 * Next.js inherits the parent ProjectProvider from
 * src/app/project/[projectId]/layout.tsx automatically.
 * This file is a no-op unless you need landmark-specific providers.
 */

import type { ReactNode } from "react";

export default function LandmarkDetectionLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/**
 * ════════════════════════════════════════════════════════════════
 *  NAVIGATION INTEGRATION GUIDE
 * ════════════════════════════════════════════════════════════════
 *
 * The page is automatically routed by Next.js App Router at:
 *   /project/[projectId]/landmark-detection
 *
 * ── Step 1: Add to project navigation ────────────────────────────
 *
 * Find your project nav component (likely in one of these files):
 *   • src/components/project/ProjectNav.tsx
 *   • src/app/project/[projectId]/layout.tsx
 *   • src/ui/header/header.tsx
 *
 * Add a link in the same style as the Segmentation link:
 *
 *   import { Crosshair } from "lucide-react";
 *
 *   // In your nav items array:
 *   {
 *     href:  `/project/${projectId}/landmark-detection`,
 *     label: "Landmarks",
 *     icon:  Crosshair,
 *   }
 *
 * ── Step 2: "Continue to Landmarks" button on Segmentation page ──
 *
 * Add this at the bottom of SegmentationSidebar's action area,
 * below the Save / Reset buttons (in segmentation-sidebar.tsx):
 *
 *   import { Crosshair } from "lucide-react";
 *   import { useRouter, useParams } from "next/navigation";
 *
 *   const router = useRouter();
 *   const { projectId } = useParams<{ projectId: string }>();
 *
 *   <Button
 *     variant="outline"
 *     size="sm"
 *     className="w-full text-xs gap-2 mt-1"
 *     onClick={() => router.push(`/project/${projectId}/landmark-detection`)}
 *   >
 *     <Crosshair className="h-3.5 w-3.5" />
 *     Landmark Detection ↗
 *   </Button>
 *
 * ── Step 3: .env.local variables ─────────────────────────────────
 *
 *   # ⚠️  Set to "false" when Sharlene's model endpoint is ready
 *   NEXT_PUBLIC_LANDMARK_USE_STUB=true
 *
 *   # FastAPI route (relative to NEXT_PUBLIC_API_URL)
 *   # Expected POST body:  { project_id: string, model: string }
 *   # Expected response:   LandmarkInferenceResponse (see src/types/landmark.ts)
 *   NEXT_PUBLIC_LANDMARK_ENDPOINT=/landmark-detection/infer
 *
 * ════════════════════════════════════════════════════════════════
 */
