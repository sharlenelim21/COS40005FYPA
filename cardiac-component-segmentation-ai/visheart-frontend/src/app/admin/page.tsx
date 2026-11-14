"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { adminApi } from "@/lib/api";
import { elapsed, isActiveJob, trainingJobPercent, RetrainingStatus, retrainingApi } from "@/lib/retraining-api";
import { trainableCases } from "@/components/extend-training/logic";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ProgressMeter } from "@/components/ui/kinetic-progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { JobState } from "@/lib/retraining-api";
import {
  Users,
  Brain,
  Activity,
  ArrowRight,
  RefreshCw,
} from "lucide-react";

interface Stats {
  totalUsers: number | null;
  admins: number | null;
  users: number | null;
  newCorrections: number | null;
}

const POLL_ACTIVE_MS = 5000;

const JOB_STATE_BADGE: Record<JobState, { label: string; className: string }> = {
  queued: { label: "Queued", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300" },
  running: { label: "Running", className: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300" },
  succeeded: { label: "Completed", className: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300" },
  cancelled: { label: "Cancelled", className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
  interrupted: { label: "Interrupted", className: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
};
const POLL_IDLE_MS = 30000;

function RetrainingCard() {
  const [status, setStatus] = useState<RetrainingStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const reply = await retrainingApi.status();
      if (!cancelled && reply.success) setStatus(reply.data);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), isActiveJob(status?.job) ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [status?.job?.state]);

  const job = status?.job;
  const running = isActiveJob(job);
  const percent = job ? trainingJobPercent(job) : null;
  // Same label the running step shows on the full Extend Training page (e.g. "Training",
  // "Evaluating"), so the dashboard card's badge reads consistently with it.
  const runningStepTitle = job?.steps.find((s) => s.state === "running")?.title;

  return (
    <Card className="h-full">
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className={`h-4 w-4 ${running ? "animate-spin" : ""}`} />
          UNet Retraining
          {job && (
            <Badge variant="outline" className={`ml-auto border-transparent ${JOB_STATE_BADGE[job.state]?.className ?? ""}`}>
              {JOB_STATE_BADGE[job.state]?.label ?? job.state}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {job
            ? `Started by ${job.requested_by}${job.started_at ? ` · ${elapsed(job.started_at, running ? null : job.finished_at)} ${running ? "so far" : "total"}` : ""}`
            : "No retraining has been run yet."}
        </CardDescription>
      </CardHeader>
      {job && (
        <CardContent className="flex flex-1 flex-col gap-3">
          {percent !== null && <ProgressMeter value={percent} title={runningStepTitle} />}
          <Button asChild variant="outline" size="sm" className="mt-auto w-full justify-between">
            <Link href="/extend-training">
              {running ? "View progress" : "Review in UNet Extend Training"}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

// Fixed categorical slot order (never cycled/reassigned by data) — colors come from
// VisHeart's validated default palette (dataviz skill, references/palette.md), slots 1-3,
// which pass the adjacent-pair CVD/contrast checks in both themes for a 3-slice donut.
const ROLE_BREAKDOWN = [
  { key: "users" as const, label: "Users", light: "#2a78d6", dark: "#3987e5" },
  { key: "admins" as const, label: "Admins", light: "#eda100", dark: "#c98500" },
];

function RoleBreakdownDonut({ stats }: { stats: Stats }) {
  const segments = ROLE_BREAKDOWN.map((role) => ({ ...role, value: stats[role.key] ?? 0 }));
  const total = stats.totalUsers ?? segments.reduce((sum, s) => sum + s.value, 0);

  let cursor = 0;
  const stops = segments.map((segment) => {
    const pct = total > 0 ? (segment.value / total) * 100 : 0;
    const start = cursor;
    cursor += pct;
    return { ...segment, start, end: cursor, pct };
  });
  // A 1.5-degree surface gap between slices (the skill's "surface gap" spacer, in
  // percentage-of-circle terms) so touching slices read as distinct without a border.
  const gapPct = total > 0 ? 0.4 : 0;
  const gradientStops = stops
    .map((s) => `var(--role-${s.key}) ${s.start}% ${Math.max(s.start, s.end - gapPct)}%`)
    .join(", ");

  return (
    <Card className="role-breakdown-donut flex h-full flex-col">
      <style>{`
        .role-breakdown-donut {
          --role-users: ${ROLE_BREAKDOWN[0].light};
          --role-admins: ${ROLE_BREAKDOWN[1].light};
        }
        .dark .role-breakdown-donut {
          --role-users: ${ROLE_BREAKDOWN[0].dark};
          --role-admins: ${ROLE_BREAKDOWN[1].dark};
        }
      `}</style>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">User Roles</CardTitle>
        <CardDescription>Every account, by role</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col items-center justify-center gap-6 pb-4 sm:flex-row sm:items-center sm:gap-8">
        <div
          className="relative h-40 w-40 shrink-0 rounded-full"
          style={total > 0 ? { background: `conic-gradient(${gradientStops})` } : undefined}
        >
          <div className="absolute inset-[16px] flex flex-col items-center justify-center rounded-full bg-card">
            <span className="text-3xl font-bold leading-none tabular-nums">{stats.totalUsers === null ? "—" : stats.totalUsers}</span>
            <span className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total Users</span>
          </div>
          {total === 0 && (
            <div className="absolute inset-0 rounded-full border-2 border-dashed border-muted" />
          )}
        </div>
        <ul className="w-full max-w-xs space-y-3.5 sm:max-w-none">
          {stops.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-4 border-b border-border/50 pb-3.5 text-sm last:border-0 last:pb-0">
              <span className="flex items-center gap-2.5 text-muted-foreground">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: `var(--role-${s.key})` }}
                />
                {s.label}
              </span>
              <span className="font-semibold tabular-nums">
                {s.value}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {total > 0 ? Math.round(s.pct) : 0}%
                </span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const quickLinks = [
  {
    title: "User Management",
    description: "View, edit, and manage every account and role",
    href: "/admin/user-management",
    icon: Users,
    color: "text-blue-600 bg-blue-100 dark:bg-blue-950/40 dark:text-blue-400",
  },
  {
    title: "UNet Extend Training",
    description: "Teach the segmentation model from saved corrections",
    href: "/extend-training",
    icon: Brain,
    color: "text-purple-600 bg-purple-100 dark:bg-purple-950/40 dark:text-purple-400",
  },
  {
    title: "System Monitor",
    description: "Health, performance, and GPU configuration",
    href: "/admin/system-monitor",
    icon: Activity,
    color: "text-green-600 bg-green-100 dark:bg-green-950/40 dark:text-green-400",
  },
];

function StatCard({ icon: Icon, label, value, color, className }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number | null; color: string; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="flex h-full items-center gap-4 px-5 py-0">
        <div className={`rounded-lg p-2.5 ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-2xl font-bold tabular-nums">{value === null ? "—" : value}</div>
          <div className="text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminPageHome() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>({
    totalUsers: null,
    admins: null,
    users: null,
    newCorrections: null,
  });

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const [usersRes, retrainingRes] = await Promise.allSettled([
        adminApi.getAllUsers(),
        retrainingApi.status(),
      ]);

      if (cancelled) return;

      setStats((prev) => {
        const next = { ...prev };
        if (usersRes.status === "fulfilled") {
          const users: { role: string }[] = usersRes.value?.users ?? [];
          next.totalUsers = users.length;
          next.admins = users.filter((u) => u.role === "admin").length;
          next.users = users.filter((u) => u.role === "user").length;
        }
        if (retrainingRes.status === "fulfilled" && retrainingRes.value.success) {
          const cases = retrainingRes.value.data?.eligible?.cases;
          next.newCorrections = cases ? trainableCases(cases).length : 0;
        }
        return next;
      });
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_IDLE_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome back, {user?.username}</h1>
        <p className="text-muted-foreground">Here&apos;s what&apos;s happening across VisHeart.</p>
      </div>

      {/* Stats */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Overview</h2>
        <div className="grid items-stretch gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RoleBreakdownDonut stats={stats} />
          </div>
          <div className="grid gap-4">
            <Link href="/extend-training?tab=prepare">
              <StatCard className="h-full transition-all hover:-translate-y-0.5 hover:shadow-md" icon={Brain} label="New Corrections to Review" value={stats.newCorrections} color="text-purple-600 bg-purple-100 dark:bg-purple-950/40 dark:text-purple-400" />
            </Link>
            <RetrainingCard />
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Quick Access</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href}>
                <Card className="group h-full transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <CardContent className="flex items-start gap-4 px-5 py-0">
                    <div className={`rounded-lg p-2.5 ${link.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold group-hover:text-blue-600">{link.title}</h3>
                        <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{link.description}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

    </div>
  );
}
