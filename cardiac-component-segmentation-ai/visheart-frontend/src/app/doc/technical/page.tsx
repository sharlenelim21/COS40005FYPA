import type { Metadata } from "next";
import { GuideLayout } from "@/components/doc/GuideLayout";
import { DocSection } from "@/components/doc/DocSection";
import type { TocItem } from "@/components/doc/guides";
import { IntroductionSection } from "@/components/doc/technical/IntroductionSection";
import { GettingStartedSection } from "@/components/doc/technical/GettingStartedSection";
import { AccountsSection } from "@/components/doc/technical/AccountsSection";
import { SegmentationSection } from "@/components/doc/technical/SegmentationSection";
import { LandmarkDetectionSection } from "@/components/doc/technical/LandmarkDetectionSection";
import { ReconstructionSection } from "@/components/doc/technical/ReconstructionSection";

export const metadata: Metadata = {
  title: "Technical Guide | VisHeart",
};

const TOC: TocItem[] = [
  { id: "introduction", label: "Introduction" },
  { id: "getting-started", label: "Getting Started" },
  { id: "accounts", label: "Accounts" },
  { id: "how-it-works", label: "How Segmentation Works" },
  { id: "landmark-detection", label: "How Landmark Detection Works" },
  { id: "reconstruction", label: "How Reconstruction Works" },
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
      <DocSection id="landmark-detection">
        <LandmarkDetectionSection />
      </DocSection>
      <DocSection id="reconstruction">
        <ReconstructionSection />
      </DocSection>
    </GuideLayout>
  );
}
