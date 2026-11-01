"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Guards against silently losing unsaved edits when leaving a page. Two separate leak paths,
 * both covered:
 *
 * 1. Browser-level exits (tab close, refresh, typing a new URL) -- the native "Leave site?"
 *    warning via beforeunload.
 * 2. In-app exits via ANY <a>/<Link> click anywhere in the app -- including the persistent
 *    global header/nav (components/ui/header/header.tsx), which the calling page doesn't own
 *    and can't wrap individually. Next's client-side route changes never fire beforeunload, so a
 *    document-level capture-phase click listener is the only way to catch every exit, not just
 *    the ones this page happens to render itself.
 *
 * Non-Link exits (a plain `<button onClick={() => router.push(...)}>`, e.g. an action inside
 * GuidancePanel) aren't `<a>` elements, so they're NOT caught by (2) -- wrap those call sites
 * individually with the returned `navigateWithUnsavedGuard`.
 */
export function useUnsavedChangesGuard(hasUnsavedChanges: boolean) {
  const router = useRouter();
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  // The click listener's closure is set up once; read the current flag through a ref so it
  // doesn't need to be re-attached on every toggle.
  const hasUnsavedRef = useRef(hasUnsavedChanges);
  hasUnsavedRef.current = hasUnsavedChanges;

  const navigateWithUnsavedGuard = useCallback((action: () => void) => {
    if (hasUnsavedRef.current) {
      setPendingNavigation(() => action);
    } else {
      action();
    }
  }, []);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!hasUnsavedRef.current) return;
      // Only a plain left-click without modifiers is a normal same-tab navigation -- a
      // ctrl/cmd/shift/middle click opens a new tab, which doesn't lose this one's edits.
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return; // external link
      if (anchor.target && anchor.target !== "_self") return; // opens elsewhere (new tab, iframe)
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // same page / hash-only
      event.preventDefault();
      event.stopPropagation();
      setPendingNavigation(() => () => router.push(`${url.pathname}${url.search}${url.hash}`));
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [router]);

  return { pendingNavigation, setPendingNavigation, navigateWithUnsavedGuard };
}
