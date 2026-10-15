import type { ContentBlock, GuideSection } from "@/content/medicalGuide";
import { Callout } from "@/components/doc/medical/Callout";
import { ClaimParagraphs } from "@/components/doc/medical/Citation";
import { ConditionGrid } from "@/components/doc/medical/ConditionCard";
import { ContentText } from "@/components/doc/medical/ContentText";
import { FigureSlot } from "@/components/doc/medical/FigureSlot";
import { ReferenceRangeTable } from "@/components/doc/medical/ReferenceRangeTable";
import { TwoLayerSection } from "@/components/doc/medical/TwoLayerSection";

export function ContentBlockView({ block }: { block: ContentBlock }) {
  switch (block.kind) {
    case "callout":
      return (
        <Callout variant={block.variant} title={<ContentText text={block.title} />}>
          <ClaimParagraphs claims={block.body} />
        </Callout>
      );
    case "rangeTable":
      return <ReferenceRangeTable caption={block.caption} groups={block.groups} footnotes={block.footnotes} />;
    case "figure":
      return <FigureSlot {...block} />;
    case "conditions":
      return <ConditionGrid conditions={block.conditions} note={block.note} />;
  }
}

export function GuideSectionView({ section, level = 2 }: { section: GuideSection; level?: 2 | 3 }) {
  const detail = section.detail?.filter((claim) => claim.text.trim() !== "") ?? [];

  return (
    <TwoLayerSection
      id={section.id}
      title={section.title}
      level={level}
      summary={section.summary.length ? <ClaimParagraphs claims={section.summary} /> : undefined}
      detail={detail.length > 0 ? <ClaimParagraphs claims={detail} /> : undefined}
    >
      {section.blocks?.map((block, index) => <ContentBlockView key={index} block={block} />)}
      {section.subsections && section.subsections.length > 0 && (
        <div className="space-y-10 pt-4">
          {section.subsections.map((subsection) => (
            <GuideSectionView key={subsection.id} section={subsection} level={3} />
          ))}
        </div>
      )}
    </TwoLayerSection>
  );
}
