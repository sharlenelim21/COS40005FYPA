"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { TECHNICAL_GUIDE_HREF } from "@/components/doc/guides";
import { scrollToSection } from "@/components/doc/scrollToSection";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000";

interface DocSearchResult {
  tab: string;
  title: string;
  excerpt: string;
  keywords: string[];
}

export function DocSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const [docSearch, setDocSearch] = useState("");
  const [docResults, setDocResults] = useState<DocSearchResult[]>([]);
  const [docSearchLoading, setDocSearchLoading] = useState(false);
  const [docSearchError, setDocSearchError] = useState<string | null>(null);

  useEffect(() => {
    const query = docSearch.trim();
    if (!query) {
      setDocResults([]);
      setDocSearchError(null);
      setDocSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setDocSearchLoading(true);
      setDocSearchError(null);
      try {
        const response = await fetch(
          `${API_BASE_URL}/support/docs/search?q=${encodeURIComponent(query)}`,
          { credentials: "include", signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.message || "User guide search failed.");
        }
        setDocResults(Array.isArray(data.results) ? data.results : []);
      } catch (error) {
        if (!controller.signal.aborted) {
          setDocSearchError(error instanceof Error ? error.message : "User guide search failed.");
          setDocResults([]);
        }
      } finally {
        if (!controller.signal.aborted) setDocSearchLoading(false);
      }
    }, 200);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [docSearch]);

  const goToSection = (sectionId: string) => {
    setDocSearch("");
    if (pathname === TECHNICAL_GUIDE_HREF) {
      scrollToSection(sectionId);
    } else {
      router.push(`${TECHNICAL_GUIDE_HREF}#${sectionId}`);
    }
  };

  return (
    <div
      className="relative w-full"
      onKeyDown={(event) => {
        if (event.key === "Escape") setDocSearch("");
      }}
    >
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        type="search"
        aria-label="Search the user guide"
        placeholder="Search help..."
        value={docSearch}
        onChange={(e) => setDocSearch(e.target.value)}
        className="h-9 pl-8"
      />

      {docSearch.trim() && (
        <div className="bg-popover text-popover-foreground absolute top-full right-0 z-50 mt-2 max-h-[60dvh] w-[min(28rem,calc(100vw-2rem))] space-y-2 overflow-y-auto rounded-md border p-4 shadow-lg">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Search Results</p>
            {docSearchLoading && <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />}
          </div>

          {docSearchError ? (
            <p className="text-destructive text-sm">{docSearchError}</p>
          ) : docResults.length > 0 ? (
            docResults.map((item) => (
              <button
                key={item.tab}
                type="button"
                onClick={() => goToSection(item.tab)}
                className="hover:bg-muted focus-visible:ring-ring block w-full rounded-md border p-3 text-left focus-visible:ring-2 focus-visible:outline-none"
              >
                <p className="font-medium">{item.title}</p>
                <p className="text-muted-foreground text-sm">{item.excerpt}</p>
              </button>
            ))
          ) : !docSearchLoading ? (
            <p className="text-muted-foreground text-sm">No matching documentation found.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
