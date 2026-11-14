"use client";

import React, { useState } from "react";
import {
  Shield,
  Users,
  Activity,
  Brain,
  Menu,
  X,
  LayoutDashboard,
  Heart,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";
import { AdminOnly } from "@/components/ProtectedRoute";
import { useAuth } from "@/context/auth-context";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

interface NavigationItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

// Shared across every admin-only screen, including ones that live outside /admin (e.g.
// /extend-training) — so the sidebar/breadcrumb nav must not assume pathname starts with "/admin".
const adminNavigation: NavigationItem[] = [
  {
    title: "Dashboard",
    href: "/admin",
    icon: LayoutDashboard,
    description: "Overview and quick stats",
  },
  {
    title: "User Management",
    href: "/admin/user-management",
    icon: Users,
    description: "Manage users, roles, and permissions",
  },
  {
    title: "UNet Extend Training",
    href: "/extend-training",
    icon: Brain,
    description: "Teach the segmentation model from saved corrections",
  },
  {
    title: "System Monitor",
    href: "/admin/system-monitor",
    icon: Activity,
    description: "System health, performance, and configuration",
  },
];

function generateBreadcrumbs(pathname: string) {
  const breadcrumbs = [{ label: "Admin", href: "/admin", isActive: pathname === "/admin" }];
  const navItem = adminNavigation.find((item) => item.href !== "/admin" && pathname.startsWith(item.href));
  if (navItem) {
    breadcrumbs.push({ label: navItem.title, href: navItem.href, isActive: pathname === navItem.href });
  }
  return breadcrumbs;
}

function SidebarContent({
  pathname,
  onNavigate,
  onClose,
}: {
  pathname: string;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const { user } = useAuth();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-blue-600 p-1.5">
            <Shield className="h-4 w-4 text-white" />
          </div>
          <span className="text-base font-semibold">Admin Panel</span>
        </div>
        {onClose && (
          <button type="button" className="rounded-md p-1 hover:bg-muted md:hidden" onClick={onClose} aria-label="Close menu">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="px-3 pt-4">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          title="Go to the clinical VisHeart Dashboard"
        >
          <Heart className="h-4 w-4 flex-shrink-0 text-red-500" />
          <span className="truncate">VisHeart App</span>
        </Link>
      </div>

      <nav aria-label="Admin" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {adminNavigation.map((item) => {
          const isActive = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                "focus-visible:ring-brand focus-visible:ring-2 focus-visible:outline-none",
                isActive
                  ? "bg-brand/10 dark:bg-brand/15 text-[color-mix(in_oklab,var(--brand)_80%,black)] dark:text-brand before:bg-brand font-semibold before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-r-full"
                  : "text-muted-foreground hover:bg-brand/5 hover:text-[color-mix(in_oklab,var(--brand)_80%,black)] dark:hover:bg-brand/10 dark:hover:text-brand",
              )}
              title={item.description}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="truncate">{item.title}</span>
            </Link>
          );
        })}
      </nav>

      {user && (
        <div className="border-t p-4">
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
              {user.username.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium">{user.username}</p>
              <p className="text-xs text-muted-foreground">Admin</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The admin sidebar/topbar/breadcrumb shell, shared by every admin-only screen — both the
 * pages nested under /admin (via admin/layout.tsx) and ones that live outside it, like
 * /extend-training (via extend-training/layout.tsx), which previously rendered with no sidebar
 * at all because Next's layout nesting only wraps routes actually under /admin/*.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const breadcrumbs = generateBreadcrumbs(pathname);

  return (
    <AdminOnly>
      <div className="flex min-h-[calc(100dvh-var(--header-h))] bg-gray-50/30 dark:bg-gray-950/30">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 flex-shrink-0 border-r bg-background md:block">
          <div className="sticky top-[var(--header-h)] h-[calc(100dvh-var(--header-h))]">
            <SidebarContent pathname={pathname} />
          </div>
        </aside>

        {/* Mobile sidebar overlay */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-64 gap-0 p-0 md:hidden">
            <SheetTitle className="sr-only">Admin menu</SheetTitle>
            <SidebarContent pathname={pathname} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <div className="sticky top-[var(--header-h)] z-10 border-b bg-background/95 backdrop-blur">
            <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
              <button
                type="button"
                className="focus-visible:ring-ring rounded-md p-1.5 hover:bg-muted focus-visible:ring-2 focus-visible:outline-none md:hidden"
                aria-expanded={mobileOpen}
                onClick={() => setMobileOpen(true)}
                aria-label="Open admin menu"
              >
                <Menu className="h-5 w-5" />
              </button>

              <Breadcrumb>
                <BreadcrumbList className="flex-nowrap gap-1">
                  {breadcrumbs.map((crumb, index) => (
                    <React.Fragment key={crumb.href}>
                      <BreadcrumbItem className="whitespace-nowrap">
                        {crumb.isActive ? (
                          <BreadcrumbPage className="text-sm font-medium">{crumb.label}</BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink asChild>
                            <Link href={crumb.href} className="text-sm text-muted-foreground hover:text-foreground">
                              {crumb.label}
                            </Link>
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                      {index < breadcrumbs.length - 1 && <BreadcrumbSeparator />}
                    </React.Fragment>
                  ))}
                </BreadcrumbList>
              </Breadcrumb>
            </div>
          </div>

          {/* Content */}
          <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
            <div className="mx-auto max-w-[1600px]">{children}</div>
          </main>
        </div>
      </div>
    </AdminOnly>
  );
}
