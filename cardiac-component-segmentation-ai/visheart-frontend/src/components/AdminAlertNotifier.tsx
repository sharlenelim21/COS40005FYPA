"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { authApi, adminApi } from "@/lib/api";
import { adminAlertStore, playAdminAlertChime, type AdminAlertCategory } from "@/lib/adminAlerts";
import { toast } from "sonner";

const POLL_MS = 15000;

/**
 * Mounted globally (root layout) so an admin gets chimed + toasted about new staff
 * verification requests or newly-flagged masks no matter which page they're on — not just
 * while sitting on /admin/staff-verifications or /admin/flagged-masks. No-op for non-admins.
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

  const check = useCallback(async () => {
    const [elevationsData, flaggedData] = await Promise.all([
      authApi.getPendingElevations().catch(() => null),
      adminApi.getFlaggedMasks().catch(() => null),
    ]);

    if (elevationsData) {
      const ids = ((elevationsData.users ?? []) as { _id: string }[]).map((u) => u._id);
      checkCategory(
        "elevations",
        ids,
        (n) => `${n} new staff verification request${n === 1 ? "" : "s"} awaiting review.`,
        "/admin/staff-verifications",
      );
    }
    if (flaggedData) {
      const ids = ((flaggedData.flaggedMasks ?? []) as { maskId: string }[]).map((m) => m.maskId);
      checkCategory(
        "flagged-masks",
        ids,
        (n) => `${n} mask${n === 1 ? "" : "s"} newly flagged for retraining.`,
        "/admin/flagged-masks",
      );
    }
  }, [checkCategory]);

  useEffect(() => {
    if (!isAdmin) return;
    void check();
    const interval = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(interval);
  }, [isAdmin, check]);

  return null;
}
