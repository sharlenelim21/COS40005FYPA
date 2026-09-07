/** Shared helpers for the printed-report pages — splitting long per-frame data
 *  across multiple physical A4 sheets, since a browser can't fragment a tall
 *  block cleanly on its own (see report/page.tsx's pagination notes). */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function fmt(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(digits);
}
