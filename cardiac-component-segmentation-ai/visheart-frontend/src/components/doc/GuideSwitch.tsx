"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HeartPulse, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { GUIDES, type GuideId } from "@/components/doc/guides";

const GUIDE_ICONS: Record<GuideId, typeof Wrench> = {
  technical: Wrench,
  medical: HeartPulse,
};

export function GuideSwitch() {
  const pathname = usePathname();

  return (
    <nav aria-label="Guides" className="shrink-0">
      <ul className="bg-muted inline-flex items-center gap-1 rounded-lg p-1">
        {GUIDES.map((guide) => {
          const active = pathname?.startsWith(guide.href);
          const Icon = GUIDE_ICONS[guide.id];
          return (
            <li key={guide.id}>
              <Link
                href={guide.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors sm:px-3",
                  "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span className="sm:hidden">{guide.shortLabel}</span>
                <span className="hidden sm:inline">{guide.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
