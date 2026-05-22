"use client";

import { useState } from "react";
import { useAuth } from "@/context/auth-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Users,
  Shield,
  Activity,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Info,
} from "lucide-react";

// Mock data - replace with real API calls
const systemStats = {
  totalUsers: 156,
  activeUsers: 89,
  adminUsers: 4,
  systemHealth: "Excellent",
  uptime: "99.9%",
  lastUpdate: "2 hours ago",
};

const recentActivities = [
  {
    id: 1,
    action: "User registration",
    user: "john.doe@example.com",
    timestamp: "5 minutes ago",
    type: "info" as const,
  },
  {
    id: 2,
    action: "Admin login",
    user: "admin@visheart.com",
    timestamp: "15 minutes ago",
    type: "success" as const,
  },
  {
    id: 3,
    action: "System backup completed",
    user: "System",
    timestamp: "1 hour ago",
    type: "success" as const,
  },
  {
    id: 4,
    action: "High CPU usage detected",
    user: "System Monitor",
    timestamp: "2 hours ago",
    type: "warning" as const,
  },
];

const quickActions = [
  {
    title: "User Management",
    description: "Manage users, roles, and permissions",
    href: "/admin/user-management",
    icon: Users,
    variant: "default" as const,
    section: "core" as const,
  },
  {
    title: "System Monitor & Configuration",
    description: "Monitor system health, performance, and configure settings",
    href: "/admin/system-monitor",
    icon: Activity,
    variant: "default" as const,
    section: "core" as const,
  },
  {
    title: "AWS Analytics",
    description: "View AWS metrics and reports",
    href: "/admin/analytics",
    icon: TrendingUp,
    variant: "secondary" as const,
    disabled: true,
    section: "advanced" as const,
  },
  {
    title: "Database Management",
    description: "Manage database operations and backups",
    href: "/admin/database",
    icon: Shield,
    variant: "secondary" as const,
    disabled: true,
    section: "advanced" as const,
  },
];

/**
 * Admin Dashboard Home Page
 *
 * Provides an overview of system status, quick actions, and recent activities.
 * This is the landing page when users navigate to /admin.
 */
export default function AdminPageHome() {
  const { user } = useAuth();
  const [showAdvancedTools, setShowAdvancedTools] = useState(false);

  const visibleQuickActions = quickActions.filter((action) => {
    if (action.section === "core") return true;
    return showAdvancedTools;
  });

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome back, {user?.username}
        </h1>
        <p className="text-muted-foreground">
          Here&apos;s an overview of your VisHeart system.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{systemStats.totalUsers}</div>
            <p className="text-muted-foreground text-xs">
              +12% from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <Activity className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{systemStats.activeUsers}</div>
            <p className="text-muted-foreground text-xs">Currently online</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">System Health</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {systemStats.systemHealth}
            </div>
            <p className="text-muted-foreground text-xs">
              All systems operational
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Uptime</CardTitle>
            <TrendingUp className="text-muted-foreground h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{systemStats.uptime}</div>
            <p className="text-muted-foreground text-xs">Last 30 days</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Recent Activities
            </CardTitle>
            <CardDescription>
              Latest system events and user activities
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivities.map((activity) => (
                <div key={activity.id} className="flex items-start space-x-3">
                  <div className="mt-1 flex-shrink-0">
                    {activity.type === "success" && (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    )}
                    {activity.type === "warning" && (
                      <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    )}
                    {activity.type === "info" && (
                      <Info className="h-4 w-4 text-blue-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-sm font-medium">
                      {activity.action}
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {activity.user}
                    </p>
                  </div>
                  <div className="flex-shrink-0">
                    <span className="text-muted-foreground text-xs">
                      {activity.timestamp}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-3">
            <div>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common administrative tasks</CardDescription>
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowAdvancedTools((prev) => !prev)}
              >
                {showAdvancedTools ? "Hide" : "Show"} Analytics & Database
              </Button>
            </div>
          </CardHeader>

          <CardContent>
            <div className="space-y-3">
              {visibleQuickActions.map((action) => {
                const Icon = action.icon;

                return (
                  <div
                    key={action.title}
                    className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
                      action.disabled
                        ? "bg-muted/50 cursor-not-allowed opacity-50"
                        : "hover:bg-muted/50 cursor-pointer"
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className="flex-shrink-0">
                        <Icon className="text-muted-foreground h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{action.title}</p>
                        <p className="text-muted-foreground text-xs">
                          {action.description}
                        </p>
                      </div>
                    </div>

                    {action.disabled && (
                      <Badge variant="secondary" className="text-xs">
                        Coming Soon
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>

            {!showAdvancedTools && (
              <p className="text-muted-foreground mt-4 text-xs">
                Analytics and Database Management are currently hidden based on
                the latest client scope.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="text-muted-foreground flex items-center justify-between text-sm">
            <span>VisHeart Admin Panel v1.0.0</span>
            <span>Last updated: {systemStats.lastUpdate}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}