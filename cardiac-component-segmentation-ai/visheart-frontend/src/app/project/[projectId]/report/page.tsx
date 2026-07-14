"use client";

import { useEffect, useMemo, useState } from "react";
import { Source_Sans_3 } from "next/font/google";
import { useParams, useRouter } from "next/navigation";
import { useProject } from "@/context/ProjectContext";
import { Button } from "@/components/ui/button";
import { LoadingProject } from "@/components/project/LoadingProject";
import { ErrorProject } from "@/components/project/ErrorProject";
import { PatientSummaryPage } from "@/components/report/PatientSummaryPage";
import { RegionalStrainBullseyePage } from "@/components/report/RegionalStrainBullseyePage";
import { StrainDetailPage } from "@/components/report/StrainDetailPage";
import { ArrowLeft, ArrowUp, Printer } from "lucide-react";

const TOTAL_PAGES = 5;

// Source Sans 3 — designed for documents/UI at small sizes, noticeably more
// legible than the app's unstyled system-font fallback once printed. Scoped
// to just the report so the rest of the app's typography is untouched.
const reportFont = Source_Sans_3({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export default function ReportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { loading, error, projectData } = useProject();
  const [showScrollTop, setShowScrollTop] = useState(false);
  // The toolbar's sticky *top* offset (not padding — see below), kept in sync
  // with the real bottom edge of whatever's fixed above it (site header +
  // ProjectDashboardBar's floating pill, whichever is currently taller).
  const [clearance, setClearance] = useState(64);

  const generatedAt = useMemo(
    () => new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
    [],
  );

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 480);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // `top` on a sticky element is a no-op until the element would otherwise
  // scroll past it — unlike padding, it can't double-count against normal
  // document flow while ProjectDashboardBar (expanded or collapsed) still
  // reserves its own space above. So this only needs the real, current
  // geometry of what's fixed on screen, not a guess about *why*.
  useEffect(() => {
    let rafId: number;
    const measure = () => {
      const globalHeader = document.querySelector("header");
      const reopenPill = document.querySelector('[aria-label="Show dashboard"]');
      const headerBottom = globalHeader?.getBoundingClientRect().bottom ?? 0;
      const pillBottom = reopenPill?.getBoundingClientRect().bottom ?? 0;
      setClearance(Math.max(headerBottom, pillBottom, 0));
      rafId = requestAnimationFrame(measure);
    };
    rafId = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(rafId);
  }, []);

  if (error) return <ErrorProject error={error} />;
  if (loading !== "idle" && loading !== "done") return <LoadingProject loadingStage={loading} />;

  const patientLabel = projectData?.name || projectId || "Unknown";
  const totalFrames = projectData?.dimensions?.frames || 9;

  return (
    <div className="min-h-screen bg-muted/20 pb-16">
      {/* top is measured live (see `clearance` above), not a fixed class —
          it only takes effect once this element would otherwise need to
          stick, so it can't double-count against normal document flow, and
          it can't sit under the header/pill either since it's synced to
          their real bottom edge every frame. */}
      <div className="vh-no-print sticky z-20 border-b border-border bg-background/95 backdrop-blur" style={{ top: clearance }}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => router.push(`/project/${projectId}/landmark-detection`)}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Landmarks
          </Button>
          <div className="text-center">
            <p className="text-xs font-semibold">Cardiac Functional Analysis Report</p>
            <p className="text-[10px] text-muted-foreground">5 pages · sized to A4 (210×297mm)</p>
          </div>
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
            Print / Save as PDF
          </Button>
        </div>
      </div>

      <div id="vh-report-root" className={`${reportFont.className} px-4 pt-6`}>
        <PatientSummaryPage patientLabel={patientLabel} pageNumber={1} totalPages={TOTAL_PAGES} generatedAt={generatedAt} />
        <RegionalStrainBullseyePage
          strainType="GRS"
          patientLabel={patientLabel}
          totalFrames={totalFrames}
          pageNumber={2}
          totalPages={TOTAL_PAGES}
          generatedAt={generatedAt}
        />
        <RegionalStrainBullseyePage
          strainType="GCS"
          patientLabel={patientLabel}
          totalFrames={totalFrames}
          pageNumber={3}
          totalPages={TOTAL_PAGES}
          generatedAt={generatedAt}
        />
        <StrainDetailPage
          strainType="GRS"
          patientLabel={patientLabel}
          totalFrames={totalFrames}
          pageNumber={4}
          totalPages={TOTAL_PAGES}
          generatedAt={generatedAt}
        />
        <StrainDetailPage
          strainType="GCS"
          patientLabel={patientLabel}
          totalFrames={totalFrames}
          pageNumber={5}
          totalPages={TOTAL_PAGES}
          generatedAt={generatedAt}
        />
      </div>

      {showScrollTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="vh-no-print fixed bottom-6 right-6 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md transition-colors hover:bg-accent"
          aria-label="Scroll to top"
          title="Scroll to top"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
