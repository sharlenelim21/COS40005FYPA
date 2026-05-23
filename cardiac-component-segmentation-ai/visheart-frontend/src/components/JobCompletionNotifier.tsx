"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";
import { segmentationApi, projectApi, reconstructionApi } from "@/lib/api";

const POLL_INTERVAL = 8_000;
// localStorage key for jobs we've already toasted — persists across sessions
const SEEN_KEY = "visheart-notified-jobs";

function getSeenIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function markSeen(id: string) {
  try {
    const seen = getSeenIds();
    seen.add(id);
    // Cap at 200 entries so it doesn't grow forever
    const arr = Array.from(seen).slice(-200);
    localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
  } catch {}
}

export function JobCompletionNotifier() {
  const { user } = useAuth();
  const router = useRouter();
  const initialised = useRef(false);

  useEffect(() => {
    if (!user) {
      initialised.current = false;
      return;
    }

    const getProjectName = async (projectId: string): Promise<string> => {
      try {
        const res = await projectApi.getProjects();
        const project = (res.projects ?? []).find(
          (p: { projectId: string; name?: string }) => p.projectId === projectId
        );
        return project?.name ?? "Your project";
      } catch {
        return "Your project";
      }
    };

    const check = async () => {
      try {
        const segRes = await segmentationApi.getUserJobs();
        const segJobs: any[] = segRes.jobs ?? [];

        let reconJobs: any[] = [];
        try {
          const reconRes = await reconstructionApi.getUserReconstructionJobs();
          reconJobs = reconRes.jobs ?? [];
        } catch {}

        const allJobs = [
          ...segJobs.map((j: any) => ({ ...j, _type: "segmentation" })),
          ...reconJobs.map((j: any) => ({ ...j, _type: "reconstruction" })),
        ];

        if (!initialised.current) {
          // Wipe stale seen-IDs from old code that showed success toasts.
          // Re-seed: mark ALL jobs seen except reconstruction jobs that are
          // still actively running (so their failure can still notify).
          try { localStorage.removeItem(SEEN_KEY); } catch {}
          allJobs.forEach((j) => {
            const id = `${j._type}-${j.jobId ?? j._id}`;
            const isActiveRecon = j._type === "reconstruction" &&
              (j.status === "pending" || j.status === "in_progress");
            if (!isActiveRecon) markSeen(id);
          });
          initialised.current = true;
          return;
        }

        const seen = getSeenIds();

        for (const job of allJobs) {
          const id = `${job._type}-${job.jobId ?? job._id}`;
          if (seen.has(id)) continue;
          if (job.status !== "completed" && job.status !== "failed") continue;

          markSeen(id);

          // Completed jobs: no toast — UI reacts in-page (glow on project page, guidance panel on 4D viewer)
          if (job.status === "failed") {
            const name = await getProjectName(job.projectId);
            const label = job._type === "segmentation" ? "Segmentation mask" : "4D Reconstruction";
            const getDirectUrl = () => {
              if (job._type === "segmentation") {
                const model = job.segmentationModel;
                const params = model ? `?model=${encodeURIComponent(model)}` : "";
                return `/project/${job.projectId}/segmentation${params}`;
              }
              const model = job.segmentationModel;
              const reconId = job.reconstructionId ?? job.jobId ?? job._id;
              const params = new URLSearchParams();
              if (model) params.set("model", model);
              if (reconId) params.set("reconstructionId", reconId);
              const qs = params.toString();
              return `/project/${job.projectId}/standalone-4d-viewer${qs ? `?${qs}` : ""}`;
            };
            toast.error(`${label} failed`, {
              description: `"${name}" could not be processed. Please try again.`,
              duration: Infinity,
              action: {
                label: "Open",
                onClick: () => router.push(getDirectUrl()),
              },
            });
          }
        }
      } catch {}
    };

    check();
    const timer = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [user, router]);

  return null;
}
