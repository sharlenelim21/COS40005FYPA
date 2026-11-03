"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Guards against silently losing unsaved edits when leaving a page. Three separate leak paths,
 * all covered:
 *
 * 1. Browser-level exits (tab close, refresh, typing a new URL) -- the native "Leave site?"
 *    warning via beforeunload.
 * 2. In-app exits via ANY <a>/<Link> click anywhere in the app -- including the persistent
 *    global header/nav (components/ui/header/header.tsx), which the calling page doesn't own
 *    and can't wrap individually. Next's client-side route changes never fire beforeunload, so a
 *    document-level capture-phase click listener is the only way to catch every exit, not just
 *    the ones this page happens to render itself.
 * 3. The browser's native Back/Forward buttons -- these fire `popstate`, not `beforeunload`, so
 *    they need their own interception: a sentinel history entry is pushed while there are unsaved
 *    changes, and the first popstate that entry absorbs is "undone" by re-pushing it, giving the
 *    app a chance to show the same confirm dialog as (2) before letting the real navigation
 *    through on confirm.
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
      // Legacy fallback -- some browsers only honor returnValue, not preventDefault() alone.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Browser Back/Forward: popstate fires only after the browser has already moved the history
  // position, so a plain guard can't "cancel" it -- instead, while there are unsaved changes, keep
  // a sentinel entry on top of the stack. The first popstate it absorbs is re-cancelled by pushing
  // the sentinel back (no visible navigation happens), and the same confirm dialog as the in-app
  // link guard is shown; confirming calls history.go(-2) to actually leave (one step to drop the
  // re-pushed sentinel, one more to drop the original entry this page itself occupied).
  const confirmedPopRef = useRef(false);
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    window.history.pushState({ __unsavedGuard: true }, "", window.location.href);
    const handlePopState = () => {
      if (confirmedPopRef.current) {
        confirmedPopRef.current = false;
        return;
      }
      if (!hasUnsavedRef.current) return;
      window.history.pushState({ __unsavedGuard: true }, "", window.location.href);
      setPendingNavigation(() => () => {
        confirmedPopRef.current = true;
        window.history.go(-2);
      });
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
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
