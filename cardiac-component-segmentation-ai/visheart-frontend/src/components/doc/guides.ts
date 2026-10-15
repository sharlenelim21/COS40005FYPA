export type GuideId = "technical" | "medical";

export interface GuideLink {
  id: GuideId;
  href: string;
  label: string;
  shortLabel: string;
}

export const GUIDES: readonly GuideLink[] = [
  { id: "technical", href: "/doc/technical", label: "Technical Guide", shortLabel: "Technical" },
  { id: "medical", href: "/doc/medical", label: "Medical Guide", shortLabel: "Medical" },
];

export const TECHNICAL_GUIDE_HREF = "/doc/technical";

export interface TocItem {
  id: string;
  label: string;
  children?: TocItem[];
}

export function flattenToc(items: TocItem[]): TocItem[] {
  return items.flatMap((item) => [item, ...flattenToc(item.children ?? [])]);
}
