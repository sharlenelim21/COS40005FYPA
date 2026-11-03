import type { Metadata } from "next";
import { GuideLayout } from "@/components/doc/GuideLayout";
import { DocSection } from "@/components/doc/DocSection";
import type { TocItem } from "@/components/doc/guides";
import { Callout } from "@/components/doc/medical/Callout";
import { ClaimParagraphs } from "@/components/doc/medical/Citation";
import { ContentText } from "@/components/doc/medical/ContentText";
import { GuideSectionView } from "@/components/doc/medical/GuideSectionView";
import { ReferenceList } from "@/components/doc/medical/ReferenceList";
import { MEDICAL_GUIDE, type GuideSection } from "@/content/medicalGuide";

export const metadata: Metadata = {
  title: "Medical Guide | VisHeart",
};

const toTocItem = (section: GuideSection): TocItem => ({
  id: section.id,
  label: section.title,
  children: section.subsections?.map(toTocItem),
});

const TOC: TocItem[] = [
  ...MEDICAL_GUIDE.sections.map(toTocItem),
  { id: MEDICAL_GUIDE.referencesSectionId, label: "References" },
];

export default function MedicalGuidePage() {
  const { title, description, disclaimer, sections, referencesSectionId } = MEDICAL_GUIDE;

  return (
    <GuideLayout title={title} description={<ContentText text={description} />} toc={TOC}>
      <Callout variant="disclaimer" title={<ContentText text={disclaimer.title} />}>
        <ClaimParagraphs claims={disclaimer.body} />
      </Callout>

      {sections.map((section) => (
        <GuideSectionView key={section.id} section={section} />
      ))}

      <DocSection id={referencesSectionId} title="References">
        <ReferenceList />
      </DocSection>
    </GuideLayout>
  );
}
