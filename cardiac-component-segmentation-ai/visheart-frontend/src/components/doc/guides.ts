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
export const MEDICAL_GUIDE_HREF = "/doc/medical";

/** Medical Guide's "Disease patterns" subsection (medicalGuide.ts id: "disease-patterns"). */
export const DISEASE_PATTERNS_SECTION_ID = "disease-patterns";
export const DISEASE_PATTERNS_HREF = `${MEDICAL_GUIDE_HREF}#${DISEASE_PATTERNS_SECTION_ID}`;

/** Technical Guide section "How LV and RV Works" (LV + RV strain methods) and its parts. */
export const LV_RV_SECTION_ID = "how-lv-rv-works";
export const LV_RV_SHARED_STEPS_ID = "lv-rv-shared-steps";
export const LV_STRAIN_METHOD_ID = "lv-strain-method";
/** The RV 9-segment research method. The Strain tab's "Research output only" notices link here. */
export const RV_STRAIN_METHOD_SECTION_ID = "rv-strain-method";
export const LV_RV_REFERENCES_ID = "lv-rv-references";
export const RV_STRAIN_METHOD_HREF = `${TECHNICAL_GUIDE_HREF}#${RV_STRAIN_METHOD_SECTION_ID}`;

export interface TocItem {
  id: string;
  label: string;
  children?: TocItem[];
}

export function flattenToc(items: TocItem[]): TocItem[] {
  return items.flatMap((item) => [item, ...flattenToc(item.children ?? [])]);
}
