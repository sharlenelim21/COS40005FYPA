"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { retrainingApi, RetrainingStatus } from "@/lib/retraining-api";
import { trainableCases } from "@/components/extend-training/logic";
import { adminAlertStore, retrainingAlertStore, playAdminAlertChime, type AdminAlertCategory } from "@/lib/adminAlerts";
import { toast } from "sonner";

const POLL_MS = 15000;
const RETRAINING_TERMINAL_STATES = new Set(["succeeded", "failed"]);

/**
 * Mounted globally (root layout) so an admin gets chimed + toasted about new corrections
 * ready for training, or a finished retraining run, no matter which page they're on — not
 * just while sitting on /extend-training. No-op for non-admins.
 */
export function AdminAlertNotifier() {
  const { user } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === "admin";

  const checkCategory = useCallback(
    (category: AdminAlertCategory, currentIds: string[], message: (count: number) => string, href: string) => {
      const seen = adminAlertStore.getSeen(category);
      const alerted = adminAlertStore.getAlerted(category);
      const unseen = currentIds.filter((id) => !seen.has(id));
      const unalerted = unseen.filter((id) => !alerted.has(id));
      if (unalerted.length === 0) return;

      playAdminAlertChime();
      toast.info(message(unalerted.length), {
        action: { label: "Review", onClick: () => router.push(href) },
      });
      adminAlertStore.markAlerted(category, new Set([...alerted, ...unseen]));
    },
    [router],
  );

  // Retraining is a single job, not a growing list — "new" means "this job id just reached a
  // terminal state (succeeded/failed) I haven't already toasted for" — tracked separately via
  // retrainingAlertStore rather than checkCategory's id-set approach (see its own docstring).
  const checkRetraining = useCallback((data: RetrainingStatus | null) => {
    const job = data?.job;
    if (!job || !RETRAINING_TERMINAL_STATES.has(job.state)) return;
    if (retrainingAlertStore.getAlertedJobId() === job.id) return;

    playAdminAlertChime();
    if (job.state === "succeeded") {
      toast.success("Retraining finished — a new version is ready for review.", {
        action: { label: "Review", onClick: () => router.push("/extend-training") },
      });
    } else {
      toast.error("Retraining failed.", {
        description: job.error ?? undefined,
        action: { label: "View", onClick: () => router.push("/extend-training") },
      });
    }
    retrainingAlertStore.markAlertedJobId(job.id);
  }, [router]);

  const check = useCallback(async () => {
    const { data } = await retrainingApi.status().catch(() => ({ data: null }));
    checkRetraining(data);

    const cases = data?.eligible?.cases;
    if (cases) {
      const ids = trainableCases(cases).map((c) => c.maskId);
      checkCategory(
        "new-corrections",
        ids,
        (n) => `${n} new correction${n === 1 ? "" : "s"} ready for training.`,
        "/extend-training?tab=prepare",
      );
    }
  }, [checkCategory, checkRetraining]);

  useEffect(() => {
    if (!isAdmin) return;
    void check();
    const interval = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(interval);
  }, [isAdmin, check]);

  return null;
}
