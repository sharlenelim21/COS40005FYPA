import { useEffect } from "react";
import { currentHashId, scrollToSection } from "@/components/doc/scrollToSection";

export function useHashNavigation() {
  useEffect(() => {
    let realignTimer: number | undefined;

    const jumpToHash = () => {
      const id = currentHashId();
      if (!id) return false;
      const found = scrollToSection(id, { smooth: false, pushHash: false, focus: false });
      if (found) {
        window.clearTimeout(realignTimer);
        realignTimer = window.setTimeout(() => {
          if (currentHashId() === id) scrollToSection(id, { smooth: false, pushHash: false, focus: false });
        }, 150);
      }
      return found;
    };

    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => jumpToHash());
    });

    const onLoad = () => jumpToHash();
    if (document.readyState !== "complete") window.addEventListener("load", onLoad, { once: true });

    const pathname = window.location.pathname;
    const onPopState = () => {
      if (window.location.pathname !== pathname) return;
      if (!jumpToHash()) window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(realignTimer);
      window.removeEventListener("load", onLoad);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);
}
