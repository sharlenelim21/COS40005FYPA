const AUTH_PAGES = ["/login", "/register"];

export function getSafeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  if ([...value].some((char) => char.charCodeAt(0) < 32)) return null;
  try {
    const parsed = new URL(value, "http://visheart.local");
    if (parsed.origin !== "http://visheart.local") return null;
    if (AUTH_PAGES.some((page) => parsed.pathname === page || parsed.pathname.startsWith(`${page}/`))) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function readNextParam(): string | null {
  if (typeof window === "undefined") return null;
  return getSafeNext(new URLSearchParams(window.location.search).get("next"));
}

export function loginUrlFor(path: string): string {
  const next = getSafeNext(path);
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}
