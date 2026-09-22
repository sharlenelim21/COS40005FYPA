"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { reconstructionApi } from "@/lib/api";
import { normalizeReconstructionChamber } from "@/context/ProjectContext";

type Chamber = "lv" | "rv";
type Model = "medsam" | "unet";

/**
 * Which (model, chamber) 4D reconstructions have a job running right now.
 *
 * Deliberately fetches its own copy rather than reading `reconstructionJobs` from ProjectContext.
 * The context clears its job list as soon as any reconstruction exists:
 *
 *     if (hasReconstructions) { // clear jobs
 *       return; }
 *
 * which is precisely the case every caller of this hook cares about — building a second chamber,
 * or rebuilding, while an earlier reconstruction already exists. Reading it from the context
 * always came back empty there, so the UI showed "not building" during a build. That mistake was
 * made independently in the standalone viewer and on the project page before this hook existed.
 *
 * A job with no chamber recorded predates the field and reads as LV, which is what it was.
 */
export function useActiveReconstructionJobs(projectId?: string) {
  const [jobs, setJobs] = useState<Array<Record<string, unknown>> | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const response = await reconstructionApi.getUserReconstructionJobs();
      setJobs(Array.isArray(response?.jobs) ? response.jobs : []);
    } catch {
      // Keep the previous answer. An unreachable endpoint is not evidence that a build finished,
      // and offering a Start button mid-build is the defect this exists to prevent.
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const building = useMemo(() => {
    const out: Record<Chamber, Set<Model>> = { lv: new Set(), rv: new Set() };
    if (!Array.isArray(jobs) || !projectId) return out;

    for (const job of jobs) {
      if (String(job.projectId ?? "") !== String(projectId)) continue;

      const status = String(job.status ?? "").toLowerCase();
      if (status !== "pending" && status !== "in_progress") continue;

      const chamber = normalizeReconstructionChamber(job.chamber);
      const model = String(job.segmentationModel ?? "").toLowerCase();
      if (model === "medsam" || model === "unet") {
        out[chamber].add(model);
      } else {
        // No model recorded: block both rather than neither. A duplicate the user cannot see is
        // worse than a Start button that is briefly unavailable, and the server rejects the
        // duplicate anyway — this only decides what the UI admits to.
        out[chamber].add("medsam");
        out[chamber].add("unet");
      }
    }
    return out;
  }, [jobs, projectId]);

  const anyBuilding = building.lv.size > 0 || building.rv.size > 0;

  return { building, anyBuilding, refresh, jobs };
}
