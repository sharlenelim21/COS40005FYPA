import { useEffect, useState } from "react";
import { currentHashId } from "@/components/doc/scrollToSection";

export function useScrollSpy(ids: string[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null);
  const key = ids.join("|");

  useEffect(() => {
    const sectionIds = key ? key.split("|") : [];
    if (sectionIds.length === 0) return;

    let frame = 0;

    const update = () => {
      frame = 0;
      const elements = sectionIds
        .map((id) => document.getElementById(id))
        .filter((el): el is HTMLElement => el !== null);
      if (elements.length === 0) return;

      let current = elements[0].id;
      for (const el of elements) {
        const offset = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
        if (el.getBoundingClientRect().top - offset > 1) break;
        current = el.id;
      }

      const last = elements[elements.length - 1];
      const lastEndInView = window.scrollY > 0 && last.getBoundingClientRect().bottom <= window.innerHeight;
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (lastEndInView || atBottom) current = last.id;

      setActiveId(current);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    const hashId = currentHashId();
    if (hashId && sectionIds.includes(hashId)) {
      setActiveId(hashId);
    } else {
      update();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key]);

  return activeId;
}
