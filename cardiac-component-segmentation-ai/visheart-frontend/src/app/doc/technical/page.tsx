import type { Metadata } from "next";
import { GuideLayout } from "@/components/doc/GuideLayout";
import { DocSection } from "@/components/doc/DocSection";
import {
  LV_RV_REFERENCES_ID,
  LV_RV_SECTION_ID,
  LV_RV_SHARED_STEPS_ID,
  LV_STRAIN_METHOD_ID,
  RV_STRAIN_METHOD_SECTION_ID,
  type TocItem,
} from "@/components/doc/guides";
import { IntroductionSection } from "@/components/doc/technical/IntroductionSection";
import { GettingStartedSection } from "@/components/doc/technical/GettingStartedSection";
import { AccountsSection } from "@/components/doc/technical/AccountsSection";
import { SegmentationSection } from "@/components/doc/technical/SegmentationSection";
import { LandmarkDetectionSection } from "@/components/doc/technical/LandmarkDetectionSection";
import { ReconstructionSection } from "@/components/doc/technical/ReconstructionSection";
import { LvRvSection } from "@/components/doc/technical/LvRvSection";

export const metadata: Metadata = {
  title: "Technical Guide | VisHeart",
};

const TOC: TocItem[] = [
  { id: "introduction", label: "Introduction" },
  { id: "getting-started", label: "Getting Started" },
  { id: "accounts", label: "Accounts" },
  { id: "how-it-works", label: "How Segmentation Works" },
  { id: "reconstruction", label: "How Reconstruction Works" },
  { id: "landmark-detection", label: "How Landmark Detection Works" },
  {
    id: LV_RV_SECTION_ID,
    label: "How LV and RV Works",
    children: [
      { id: LV_RV_SHARED_STEPS_ID, label: "Shared steps" },
      { id: LV_STRAIN_METHOD_ID, label: "LV: 17 segments" },
      { id: RV_STRAIN_METHOD_SECTION_ID, label: "RV: 9 segments (research)" },
      { id: LV_RV_REFERENCES_ID, label: "References" },
    ],
  },
];

export default function TechnicalGuidePage() {
  return (
    <GuideLayout title="Technical Guide" description="VisHeart Platform Guide" toc={TOC}>
      <DocSection id="introduction">
        <IntroductionSection />
      </DocSection>
      <DocSection id="getting-started">
        <GettingStartedSection />
      </DocSection>
      <DocSection id="accounts">
        <AccountsSection />
      </DocSection>
      <DocSection id="how-it-works">
        <SegmentationSection />
      </DocSection>
      <DocSection id="reconstruction">
        <ReconstructionSection />
      </DocSection>
      <DocSection id="landmark-detection">
        <LandmarkDetectionSection />
      </DocSection>
      <DocSection id={LV_RV_SECTION_ID}>
        <LvRvSection />
      </DocSection>
    </GuideLayout>
  );
}
