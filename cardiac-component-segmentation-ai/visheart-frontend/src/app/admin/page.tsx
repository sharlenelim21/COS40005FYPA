"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/auth-context";
import { adminApi, authApi } from "@/lib/api";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Users,
  FileCheck,
  Brain,
  Activity,
  ArrowRight,
} from "lucide-react";

interface Stats {
  totalUsers: number | null;
  admins: number | null;
  doctors: number | null;
  educationalUsers: number | null;
  pendingVerifications: number | null;
  flaggedMasks: number | null;
}

// Fixed categorical slot order (never cycled/reassigned by data) — colors come from
// VisHeart's validated default palette (dataviz skill, references/palette.md), slots 1-3,
// which pass the adjacent-pair CVD/contrast checks in both themes for a 3-slice donut.
const ROLE_BREAKDOWN = [
  { key: "doctors" as const, label: "Doctors", light: "#2a78d6", dark: "#3987e5" },
  { key: "educationalUsers" as const, label: "Educational Users", light: "#1baf7a", dark: "#199e70" },
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
    <Card className="role-breakdown-donut">
      <style>{`
        .role-breakdown-donut {
          --role-doctors: ${ROLE_BREAKDOWN[0].light};
          --role-educationalUsers: ${ROLE_BREAKDOWN[1].light};
          --role-admins: ${ROLE_BREAKDOWN[2].light};
        }
        .dark .role-breakdown-donut {
          --role-doctors: ${ROLE_BREAKDOWN[0].dark};
          --role-educationalUsers: ${ROLE_BREAKDOWN[1].dark};
          --role-admins: ${ROLE_BREAKDOWN[2].dark};
        }
      `}</style>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">User Roles</CardTitle>
        <CardDescription>Every account, by role</CardDescription>
      </CardHeader>
      <CardContent className="flex h-full flex-col items-center gap-8 pb-8 sm:flex-row sm:items-center sm:gap-10">
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
    title: "Staff Verifications",
    description: "Review pending Doctor access requests",
    href: "/admin/staff-verifications",
    icon: FileCheck,
    color: "text-amber-600 bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400",
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
      <CardContent className="flex h-full items-center gap-4 p-5">
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
    doctors: null,
    educationalUsers: null,
    pendingVerifications: null,
    flaggedMasks: null,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [usersRes, pendingRes, flaggedRes] = await Promise.allSettled([
        adminApi.getAllUsers(),
        authApi.getPendingElevations(),
        adminApi.getFlaggedMasks(),
      ]);

      if (cancelled) return;

      setStats((prev) => {
        const next = { ...prev };
        if (usersRes.status === "fulfilled") {
          const users: { role: string }[] = usersRes.value?.users ?? [];
          next.totalUsers = users.length;
          next.admins = users.filter((u) => u.role === "admin").length;
          next.doctors = users.filter((u) => u.role === "doctor").length;
          next.educationalUsers = users.filter((u) => u.role === "educational_user").length;
        }
        if (pendingRes.status === "fulfilled") {
          next.pendingVerifications = (pendingRes.value?.users ?? []).length;
        }
        if (flaggedRes.status === "fulfilled") {
          next.flaggedMasks = (flaggedRes.value?.flaggedMasks ?? []).length;
        }
        return next;
      });
    })();

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-8">
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 lg:grid-rows-2">
            <StatCard className="h-full" icon={FileCheck} label="Pending Verifications" value={stats.pendingVerifications} color="text-amber-600 bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400" />
            <StatCard className="h-full" icon={Brain} label="Flagged Masks Pending" value={stats.flaggedMasks} color="text-purple-600 bg-purple-100 dark:bg-purple-950/40 dark:text-purple-400" />
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Quick Access</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {quickLinks.map((link) => {
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href}>
                <Card className="group h-full transition-all hover:shadow-md">
                  <CardContent className="flex items-start gap-4 p-5">
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

      {stats.pendingVerifications !== null && stats.pendingVerifications > 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-amber-900 dark:text-amber-200">
              <FileCheck className="h-4 w-4" />
              {stats.pendingVerifications} staff verification{stats.pendingVerifications === 1 ? "" : "s"} awaiting review
            </CardTitle>
            <CardDescription className="text-amber-700 dark:text-amber-300">
              <Link href="/admin/staff-verifications" className="underline hover:text-amber-900 dark:hover:text-amber-100">
                Review now
              </Link>
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
