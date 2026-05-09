"use client";

import React, { useEffect, useRef, useState } from "react";
import type { Metadata } from "next";
import {
  Shield,
  Users,
  BarChart3,
  Database,
  Activity,
  Eye,
  EyeOff,
  Plus,
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
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AdminOnly } from "@/components/ProtectedRoute";

// Define admin navigation structure for scalability
type NavigationStatus = "active" | "coming-soon";

interface NavigationItem {
  title: string;
  href: string;
  icon: any;
  description: string;
  status: NavigationStatus;
}

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  item: NavigationItem | null;
  action: "hide" | "show";
}

const adminNavigation: NavigationItem[] = [
  {
    title: "User Management",
    href: "/admin/user-management",
    icon: Users,
    description: "Manage users, roles, and permissions",
    status: "active",
  },
  {
    title: "AWS Analytics",
    href: "/admin/analytics",
    icon: BarChart3,
    description: "View AWS metrics and reports",
    status: "active",
  },
  {
    title: "Database Management",
    href: "/admin/database",
    icon: Database,
    description: "Manage database operations and backups",
    status: "coming-soon",
  },
  {
    title: "System Monitor & Configuration",
    href: "/admin/system-monitor",
    icon: Activity,
    description: "Monitor system health, performance, and configure settings",
    status: "active",
  },
];

// Generate breadcrumb items based on current path
function generateBreadcrumbs(pathname: string) {
  const paths = pathname.split("/").filter(Boolean);
  const breadcrumbs = [];

  // Always start with Admin root
  breadcrumbs.push({
    label: "Admin",
    href: "/admin",
    isActive: pathname === "/admin",
  });

  // Add sub-paths
  if (paths.length > 1) {
    const subPath = paths[1];

    const navItem = adminNavigation.find((item) => item.href.includes(subPath));

    if (navItem) {
      breadcrumbs.push({
        label: navItem.title,
        href: navItem.href,
        isActive: pathname === navItem.href,
      });
    }
  }

  return breadcrumbs;
}

// Admin navigation card component for the dashboard
function AdminNavigationCard({
  item,
  isActive,
  isHidden = false,
  onRightClick,
  onShow,
}: {
  item: NavigationItem;
  isActive: boolean;
  isHidden?: boolean;
  onRightClick?: (event: React.MouseEvent, item: NavigationItem) => void;
  onShow?: (item: NavigationItem) => void;
}) {
  const Icon = item.icon;
  const isComingSoon = item.status === "coming-soon";

  const cardContent = (
    <Card
      onContextMenu={(event) => onRightClick?.(event, item)}
      className={cn(
        "group relative overflow-hidden transition-all duration-200",
        isActive && !isHidden && "bg-blue-50/50 ring-2 ring-blue-500 dark:bg-blue-950/20",
        !isComingSoon && !isHidden && "cursor-pointer hover:scale-[1.02] hover:shadow-md",
        isComingSoon && !isHidden && "cursor-not-allowed opacity-60",
        isHidden &&
          "border-dashed bg-muted/30 opacity-55 hover:bg-muted/40 cursor-default",
      )}
      title="Right-click to hide/show this card"
    >
      {/* Coming soon badge */}
      {isComingSoon && !isHidden && (
        <div className="absolute top-2 right-2 z-10">
          <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800">
            Coming Soon
          </span>
        </div>
      )}

      {isHidden && (
        <div className="absolute top-2 right-2 z-10">
          <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
            Hidden
          </span>
        </div>
      )}

      <CardContent className="p-6">
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "rounded-lg p-3 transition-colors",
              isHidden
                ? "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
                : isActive
                  ? "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
              !isComingSoon &&
                !isHidden &&
                "group-hover:bg-blue-100 group-hover:text-blue-600",
            )}
          >
            <Icon className="h-6 w-6" />
          </div>

          <div className="min-w-0 flex-1">
            <h3
              className={cn(
                "mb-1 text-lg font-semibold transition-colors",
                !isHidden && "group-hover:text-blue-600",
                isHidden && "text-muted-foreground",
              )}
            >
              {item.title}
            </h3>
            <p
              className={cn(
                "text-sm leading-relaxed",
                isHidden ? "text-muted-foreground/80" : "text-muted-foreground",
              )}
            >
              {item.description}
            </p>

            {isHidden && (
              <div className="mt-4 flex items-center justify-end">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onShow?.(item);
                  }}
                  className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
                >
                  <Eye className="h-4 w-4" />
                  Show
                </button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  // Hidden cards should not be wrapped with Link
  if (isHidden) {
    return cardContent;
  }

  // Wrap with Link only if not coming soon
  if (isComingSoon) {
    return cardContent;
  }

  return (
    <Link href={item.href} className="block">
      {cardContent}
    </Link>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [hiddenCardHrefs, setHiddenCardHrefs] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    item: null,
    action: "hide",
  });

  const breadcrumbs = generateBreadcrumbs(pathname);
  const isAdminRoot = pathname === "/admin";

  useEffect(() => {
    const savedHiddenCards = localStorage.getItem("visheart-admin-hidden-cards");

    if (savedHiddenCards) {
      try {
        const parsedCards = JSON.parse(savedHiddenCards);

        if (Array.isArray(parsedCards)) {
          setHiddenCardHrefs(parsedCards);
        }
      } catch (error) {
        console.error("Failed to parse hidden admin cards:", error);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "visheart-admin-hidden-cards",
      JSON.stringify(hiddenCardHrefs),
    );
  }, [hiddenCardHrefs]);

  useEffect(() => {
    const handleCloseMenu = () => {
      setContextMenu((prev) => ({ ...prev, open: false }));
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        handleCloseMenu();
      }
    };

    window.addEventListener("click", handleClickOutside);
    window.addEventListener("scroll", handleCloseMenu);
    window.addEventListener("resize", handleCloseMenu);

    return () => {
      window.removeEventListener("click", handleClickOutside);
      window.removeEventListener("scroll", handleCloseMenu);
      window.removeEventListener("resize", handleCloseMenu);
    };
  }, []);

  const handleCardRightClick = (
    event: React.MouseEvent,
    item: NavigationItem,
  ) => {
    event.preventDefault();

    const isCurrentlyHidden = hiddenCardHrefs.includes(item.href);

    setContextMenu({
      open: true,
      x: event.clientX,
      y: event.clientY,
      item,
      action: isCurrentlyHidden ? "show" : "hide",
    });
  };

  const handleHideCard = (item: NavigationItem) => {
    setHiddenCardHrefs((prev) => {
      if (prev.includes(item.href)) return prev;
      return [...prev, item.href];
    });

    setContextMenu((prev) => ({ ...prev, open: false }));
  };

  const handleShowCard = (item: NavigationItem) => {
    setHiddenCardHrefs((prev) => prev.filter((href) => href !== item.href));
    setContextMenu((prev) => ({ ...prev, open: false }));
  };

  const visibleAdminNavigation = adminNavigation.filter(
    (item) => !hiddenCardHrefs.includes(item.href),
  );

  const hiddenAdminNavigation = adminNavigation.filter((item) =>
    hiddenCardHrefs.includes(item.href),
  );

  return (
    // Use ProtectedRoute to ensure only admins can access this layout
    <AdminOnly>
      <div className="min-h-screen bg-gray-50/30 dark:bg-gray-950/30">
        {/* Admin Panel Header - Compact and non-sticky */}
        <div className="bg-background border-border border-b">
          <div className="container mx-auto px-4 py-3 sm:px-6">
            {/* Compact header with title and breadcrumbs */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Link
                href="/admin"
                className="-m-2 flex items-center gap-2 rounded-lg p-2 transition-all duration-200 hover:scale-105 hover:bg-blue-50 dark:hover:bg-blue-950/30"
              >
                <div className="rounded-md bg-blue-100 p-1.5 transition-colors duration-200 group-hover:bg-blue-200 dark:bg-blue-900/20 dark:group-hover:bg-blue-800/40">
                  <Shield className="h-4 w-4 text-blue-600 transition-colors duration-200 dark:text-blue-400" />
                </div>
                <h1 className="text-foreground text-base font-semibold transition-colors duration-200 hover:text-blue-600 dark:hover:text-blue-400 sm:text-lg">
                  Admin Panel
                </h1>
              </Link>

              {/* Breadcrumb navigation inline with header */}
              {/* Enhanced breadcrumb navigation with modern styling */}
              <div className="flex items-center overflow-x-auto">
                <Breadcrumb>
                  <BreadcrumbList className="gap-1 flex-nowrap">
                    {breadcrumbs.map((crumb, index) => (
                      <React.Fragment key={crumb.href}>
                        <BreadcrumbItem className="whitespace-nowrap">
                          {crumb.isActive ? (
                            <BreadcrumbPage className="text-foreground rounded-md bg-blue-50/50 px-2 py-1 text-xs font-medium dark:bg-blue-950/30 sm:text-sm">
                              {crumb.label}
                            </BreadcrumbPage>
                          ) : (
                            <BreadcrumbLink asChild>
                              <Link
                                href={crumb.href}
                                className="text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md px-2 py-1 text-xs transition-all duration-200 sm:text-sm"
                              >
                                {crumb.label}
                              </Link>
                            </BreadcrumbLink>
                          )}
                        </BreadcrumbItem>
                        {index < breadcrumbs.length - 1 && (
                          <BreadcrumbSeparator className="text-muted-foreground/50 text-xs sm:text-sm" />
                        )}
                      </React.Fragment>
                    ))}
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </div>
          </div>
        </div>

        {/* Main content area with proper spacing and responsive design */}
        <main className="container mx-auto px-4 py-6 sm:px-6 sm:py-8">
          {isAdminRoot ? (
            // Admin dashboard with navigation cards
            <div className="space-y-8">
              {/* Welcome section */}
              <div className="space-y-2 text-center">
                <h2 className="text-3xl font-bold tracking-tight">
                  Welcome to the Admin Dashboard
                </h2>
                <p className="text-muted-foreground mx-auto max-w-2xl">
                  Manage your VisHeart system efficiently with our comprehensive
                  admin tools. Select a module below to get started.
                </p>
              </div>

              {/* Navigation grid - responsive layout */}
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {visibleAdminNavigation.map((item) => {
                  return (
                    <AdminNavigationCard
                      key={item.href}
                      item={item}
                      isActive={pathname === item.href}
                      onRightClick={handleCardRightClick}
                      onShow={handleShowCard}
                    />
                  );
                })}
              </div>

              {/* Hidden cards section */}
              {hiddenAdminNavigation.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4 border-t pt-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Plus className="h-4 w-4" />
                      <span>Analytics &amp; Database sections — hidden from view</span>
                    </div>
                  </div>

                  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {hiddenAdminNavigation.map((item) => {
                      return (
                        <AdminNavigationCard
                          key={item.href}
                          item={item}
                          isActive={false}
                          isHidden={true}
                          onRightClick={handleCardRightClick}
                          onShow={handleShowCard}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Quick stats or additional info could go here */}
              <div className="mt-12 rounded-lg border border-blue-200 bg-blue-50 p-6 dark:border-blue-800 dark:bg-blue-950/20">
                <h3 className="mb-2 font-semibold text-blue-900 dark:text-blue-100">
                  🚀 System Status
                </h3>
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  All admin modules are operational. New features are being
                  developed and will be available soon.
                </p>
              </div>
            </div>
          ) : (
            // Render child pages (like user-management)
            <div className="space-y-6">{children}</div>
          )}
        </main>

        {/* Right-click custom context menu */}
        {contextMenu.open && contextMenu.item && (
          <div
            ref={menuRef}
            className="fixed z-50 min-w-[160px] rounded-md border bg-white p-1 shadow-lg dark:bg-gray-900"
            style={{
              top: contextMenu.y,
              left: contextMenu.x,
            }}
          >
            {contextMenu.action === "hide" ? (
              <button
                type="button"
                onClick={() => handleHideCard(contextMenu.item!)}
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <EyeOff className="h-4 w-4" />
                Hide
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleShowCard(contextMenu.item!)}
                className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <Eye className="h-4 w-4" />
                Show
              </button>
            )}
          </div>
        )}
      </div>
    </AdminOnly>
  );
}