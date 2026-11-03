"use client";

import { useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { ChevronDown, ListTree } from "lucide-react";
import { cn } from "@/lib/utils";
import { useScrollSpy } from "@/hooks/useScrollSpy";
import { useHashNavigation } from "@/hooks/useHashNavigation";
import { flattenToc, type TocItem } from "@/components/doc/guides";
import { scrollToSection } from "@/components/doc/scrollToSection";

interface TocListProps {
  items: TocItem[];
  activeId: string | null;
  onNavigate?: () => void;
  nested?: boolean;
}

function TocList({ items, activeId, onNavigate, nested = false }: TocListProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate?.();
    scrollToSection(id);
  };

  return (
    <ul className={cn("space-y-0.5", nested && "border-border mt-0.5 ml-3 border-l pl-2")}>
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={active ? "location" : undefined}
              onClick={(event) => handleClick(event, item.id)}
              className={cn(
                "block rounded-md px-2 py-1.5 text-sm leading-snug transition-colors",
                "hover:bg-muted hover:text-foreground focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
                active ? "bg-secondary text-foreground font-medium" : "text-muted-foreground",
              )}
            >
              {item.label}
            </a>
            {item.children && item.children.length > 0 && (
              <TocList items={item.children} activeId={activeId} onNavigate={onNavigate} nested />
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface TableOfContentsProps {
  items: TocItem[];
}

export function TableOfContents({ items }: TableOfContentsProps) {
  const flat = useMemo(() => flattenToc(items), [items]);
  const ids = useMemo(() => flat.map((item) => item.id), [flat]);
  const activeId = useScrollSpy(ids);
  useHashNavigation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const activeLabel = flat.find((item) => item.id === activeId)?.label ?? flat[0]?.label;

  return (
    <>
      <nav
        aria-label="Table of contents"
        className="bg-background sticky top-24 z-30 -mx-4 border-b px-4 lg:hidden"
        onKeyDown={(event) => {
          if (event.key === "Escape" && mobileOpen) {
            setMobileOpen(false);
            toggleRef.current?.focus();
          }
        }}
      >
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={mobileOpen}
          aria-controls="doc-toc-mobile"
          onClick={() => setMobileOpen((open) => !open)}
          className="focus-visible:ring-ring flex h-11 w-full items-center gap-2 rounded-md text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <ListTree className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="text-muted-foreground shrink-0">On this page:</span>
          <span className="truncate font-medium">{activeLabel}</span>
          <ChevronDown
            className={cn("ml-auto h-4 w-4 shrink-0 transition-transform", mobileOpen && "rotate-180")}
            aria-hidden="true"
          />
        </button>
        {mobileOpen && (
          <div
            id="doc-toc-mobile"
            className="bg-background absolute inset-x-0 top-full max-h-[60dvh] overflow-y-auto border-y px-4 py-2 shadow-md"
          >
            <TocList items={items} activeId={activeId} onNavigate={() => setMobileOpen(false)} />
          </div>
        )}
      </nav>

      <aside className="hidden lg:block">
        <nav
          aria-label="Table of contents"
          className="sticky top-28 max-h-[calc(100dvh-8rem)] overflow-y-auto py-8 pr-2"
        >
          <p className="text-muted-foreground mb-3 px-2 text-xs font-semibold tracking-wide uppercase">
            On this page
          </p>
          <TocList items={items} activeId={activeId} />
        </nav>
      </aside>
    </>
  );
}
