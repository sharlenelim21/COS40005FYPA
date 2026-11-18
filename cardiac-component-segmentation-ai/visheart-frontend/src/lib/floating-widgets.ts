export function isFaqHiddenRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname.startsWith("/admin") || pathname.startsWith("/extend-training");
}
