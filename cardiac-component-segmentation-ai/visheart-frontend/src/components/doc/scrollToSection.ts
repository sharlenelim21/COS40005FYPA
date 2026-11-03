export function currentHashId(): string | null {
  const raw = window.location.hash.slice(1);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

interface ScrollToSectionOptions {
  smooth?: boolean;
  pushHash?: boolean;
  focus?: boolean;
}

export function scrollToSection(
  id: string,
  { smooth = true, pushHash = true, focus = true }: ScrollToSectionOptions = {},
): boolean {
  const el = document.getElementById(id);
  if (!el) return false;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: smooth && !reduceMotion ? "smooth" : "auto", block: "start" });
  if (pushHash && currentHashId() !== id) {
    window.history.pushState(null, "", `#${encodeURIComponent(id)}`);
  }
  if (focus) el.focus({ preventScroll: true });
  return true;
}
