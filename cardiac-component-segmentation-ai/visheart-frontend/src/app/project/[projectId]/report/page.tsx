     "use client";

import { useEffect, useMemo, useState } from "react";
import { Source_Sans_3 } from "next/font/google";
import { useParams, useRouter } from "next/navigation";
import { useProject } from "@/context/ProjectContext";
import { Button } from "@/components/ui/button";
import { LoadingProject } from "@/components/project/LoadingProject";
import { ErrorProject } from "@/components/project/ErrorProject";
import { PatientSummaryPage, PLACEHOLDER_PATIENT_SUMMARY, type PatientSummaryData } from "@/components/report/PatientSummaryPage";
import { RegionalStrainBullseyePage } from "@/components/report/RegionalStrainBullseyePage";
import { StrainDetailPage } from "@/components/report/StrainDetailPage";
import { RvStrainPage } from "@/components/report/RvStrainPage";
import { useProjectResults } from "@/hooks/useProjectResults";
import { InteractiveReport } from "@/components/report/InteractiveReport";
import { ArrowLeft, ArrowUp, Printer, AlertTriangle } from "lucide-react";

/** Bar colours for the disease-similarity rows, keyed by pattern code. */
const PATTERN_COLORS: Record<string, string> = {
  NOR: "#15803d",
  DCM: "#fab219",
  HCM: "#d03b3b",
};

// Page 6 (RV Regional Findings) is only added to the printed count when the
// mask actually has RV strain data — see `totalPages` below. Kept as a
// separate constant so LV-only projects don't print "page 1 of 6" with a
// missing page 6.
const BASE_TOTAL_PAGES = 5;

// Source Sans 3 — designed for documents/UI at small sizes, noticeably more
// legible than the app's unstyled system-font fallback once printed. Scoped
// to just the report so the rest of the app's typography is untouched.
const reportFont = Source_Sans_3({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export default function ReportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const { loading, error, projectData } = useProject();
  // One report, defaulting to the most-recently-computed model (no toggle) —
  // the reader gets a single authoritative view rather than choosing a model.
  // `computing` / `computeError` surface the self-healing analysis compute the
  // hook runs when a mask has no stored metrics yet, so the summary cards can
  // show progress instead of a permanent "not computed" dead end.
  const {
    model, measurements, healthStatus, similarity, strain, strainSeries,
    computing, computeError, newerMaskAvailable, regionalHealthStatus, rv, lvVolumes, rvStrain,
    rvStrainSeries, recomputeSimilarityWithBsa, recomputingSimilarity, recomputeSimilarityError,
  } = useProjectResults(projectId, "recent");
  const [showScrollTop, setShowScrollTop] = useState(false);
  // BSA input — optional. Entered here (not persisted server-side) since it's
  // a report-time convenience, not a clinical record; height/weight are kept
  // as separate fields (rather than a single BSA field) because that's what a
  // user actually has on hand, with BSA itself derived via the Mosteller
  // formula. Blank either field and every BSA-indexed row above simply
  // doesn't print — see PatientSummaryPage's hasBsa gating.
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const heightNum = parseFloat(heightCm);
  const weightNum = parseFloat(weightKg);
  const bsaM2 =
    Number.isFinite(heightNum) && Number.isFinite(weightNum) && heightNum > 0 && weightNum > 0
      ? Math.sqrt((heightNum * weightNum) / 3600)
      : null;
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

  // Map the stored pipeline output onto the report's summary shape. Falls back
  // to the placeholder only when nothing has been computed for this project yet.
  const hasRealData = !!(measurements || healthStatus || similarity);
  const summaryData: PatientSummaryData = hasRealData
    ? {
        patientLabel,
        scanSummary: [
          "Cine MRI",
          projectData?.dimensions?.slices ? `${projectData.dimensions.slices} slices` : null,
          totalFrames ? `${totalFrames} frames` : null,
          `Model: ${model === "unet" ? "UNetResNet34" : "MedSAM"}`,
        ].filter(Boolean).join(" · "),
        ef: measurements?.EF ?? null,
        edv: measurements?.EDV ?? null,
        esv: measurements?.ESV ?? null,
        strokeVolume: measurements?.StrokeVolume ?? null,
        peakGrs: measurements?.PeakGRS ?? null,
        peakGcs: measurements?.PeakGCS ?? null,
        // RV — printed only when present. Ratio/difference are derived here so
        // the print page stays a pure presentation component.
        rvEf: rv?.RVEF ?? null,
        rvEdv: rv?.RVEDV ?? null,
        rvEsv: rv?.RVESV ?? null,
        rvSv: rv?.RV_SV ?? null,
        rvLvRatio:
          rv?.RVEDV != null && (lvVolumes?.LVEDV ?? measurements?.EDV)
            ? rv.RVEDV / (lvVolumes?.LVEDV ?? measurements!.EDV!)
            : null,
        svDifference:
          rv?.RV_SV != null && (lvVolumes?.LV_SV ?? measurements?.StrokeVolume) != null
            ? rv.RV_SV - (lvVolumes?.LV_SV ?? measurements!.StrokeVolume!)
            : null,
        // BSA is user-entered on this page (see heightCm/weightKg state above),
        // not part of the computed pipeline — null whenever either field is
        // blank, which is what gates the indexed rows off in PatientSummaryPage.
        bsaM2,
        heightCm: bsaM2 != null ? heightNum : null,
        weightKg: bsaM2 != null ? weightNum : null,
        rvEdvi: bsaM2 != null && rv?.RVEDV != null ? rv.RVEDV / bsaM2 : null,
        rvEsvi: bsaM2 != null && rv?.RVESV != null ? rv.RVESV / bsaM2 : null,
        voxelSize: PLACEHOLDER_PATIENT_SUMMARY.voxelSize,
        healthStatus: healthStatus?.status ?? "Indeterminate",
        healthEvidence:
          healthStatus?.evidence?.map((e) => ({
            text: `${e.label}: ${e.detail}`,
            ok: e.level === "ok",
          })) ?? [],
        diseasePattern:
          similarity?.similarities?.map((s) => ({
            label: s.label,
            pct: Math.round(s.percent),
            color: PATTERN_COLORS[s.code] ?? "#64748b",
          })) ?? [],
        // Headline/confidence/gate — see compute_disease_similarity.py. Headline
        // reads "Indeterminate"/"...cannot be assessed reliably" instead of a
        // confident profile label whenever the top profile's essential gate
        // failed or couldn't be checked; the bars above are unaffected.
        phenotypeHeadline: similarity?.phenotype_headline ?? null,
        diseaseSimilarityConfidence: similarity?.confidence ?? null,
        diseaseSimilarityMode: similarity?.mode ?? null,
        diseaseSimilarityGateReason: similarity?.gate?.reason ?? null,
        isRealData: true,
      }
    : { ...PLACEHOLDER_PATIENT_SUMMARY, patientLabel, isRealData: false };

  // Map the stored per-frame series into the chart shape the strain pages use
  // (one array of 17 segments per frame). Undefined when the series hasn't been
  // computed, which makes those pages fall back to a clearly-labelled preview.
  const seriesFor = (type: "GRS" | "GCS") => {
    if (!strainSeries?.frames?.length) return undefined;
    const k = type === "GRS" ? "grs" : "gcs";
    return strainSeries.frames.map((f) =>
      (f.segments ?? []).map((s) => ({
        segment: s.segment,
        label: s.label,
        // Indexing by the narrowed "grs" | "gcs" key needs no cast — the
        // segment type declares both fields.
        strain: (s[k] ?? 0) as number,
      })),
    );
  };
  const grsSeries = seriesFor("GRS");
  const gcsSeries = seriesFor("GCS");

  // RV Regional Findings only gets a 6th printed page when there's something
  // to show — an LV-only project (or one where RV strain hasn't been run)
  // prints exactly the original 5 pages rather than a page 6 that just says
  // "not computed".
  const hasRvStrain = !!(rvStrain || rvStrainSeries?.frames?.length);
  const totalPages = hasRvStrain ? BASE_TOTAL_PAGES + 1 : BASE_TOTAL_PAGES;

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
            <p className="text-[10px] text-muted-foreground">
              {model === "unet" ? "UNet" : "MedSAM"} (most recent run)
            </p>
          </div>
          <Button size="sm" className="gap-1.5 text-xs" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" />
            Print / Save as PDF
          </Button>
        </div>
      </div>

      {/* A later segmentation run exists but hasn't been analysed, so the
          figures below come from an earlier run. Surfaced rather than silently
          switching docs — results live on the mask they were computed for, and
          jumping to the newer (empty) mask would blank the strain panels. */}
      {newerMaskAvailable && (
        <div className="vh-no-print mx-auto mt-3 max-w-5xl px-6">
          <p className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              A newer segmentation run exists for this model but has not been analysed yet —
              the results below are from the previous run. Re-run strain on the newest
              segmentation to bring this report up to date.
            </span>
          </p>
        </div>
      )}

      {/* Screen presentation — interactive, hidden when printing. */}
      <div className="vh-screen-only">
        <InteractiveReport
          patientLabel={patientLabel}
          scanSummary={summaryData.scanSummary}
          generatedAt={generatedAt}
          measurements={measurements}
          healthStatus={healthStatus}
          similarity={similarity}
          strain={strain}
          strainSeries={strainSeries}
          regionalHealthStatus={regionalHealthStatus}
          rv={rv}
          lvVolumes={lvVolumes}
          rvStrain={rvStrain}
          rvStrainSeries={rvStrainSeries}
          computing={computing}
          computeError={computeError}
          bsaM2={bsaM2}
          heightCm={heightCm}
          weightKg={weightKg}
          onHeightCmChange={setHeightCm}
          onWeightKgChange={setWeightKg}
          onRecomputeSimilarityWithBsa={recomputeSimilarityWithBsa}
          recomputingSimilarity={recomputingSimilarity}
          recomputeSimilarityError={recomputeSimilarityError}
        />
      </div>

      {/* Print presentation — the paginated A4 sheets. Kept in the DOM so
          window.print() needs no re-render, but hidden on screen. */}
      <div id="vh-report-root" className={`${reportFont.className} vh-print-only px-4 pt-6`}>
        {!hasRealData ? (
          // Match the screen's empty state instead of printing placeholder
          // numbers, so a report can never be exported with fabricated values.
          <div className="mx-auto flex min-h-[297mm] w-[210mm] flex-col items-center justify-center p-6 text-center">
            <p className="text-base font-semibold text-foreground">No results to report</p>
            <p className="mt-2 max-w-[420px] text-sm text-muted-foreground">
              Nothing has been computed for this project yet. Run segmentation, heart metrics and
              strain, then reopen this report to print it.
            </p>
          </div>
        ) : (
          <>
        <PatientSummaryPage data={summaryData} patientLabel={patientLabel} pageNumber={1} totalPages={totalPages} generatedAt={generatedAt} />
        <RegionalStrainBullseyePage
          strainType="GRS"
          patientLabel={patientLabel}
          totalFrames={totalFrames}
          pageNumber={2}
          totalPages={totalPages}
          generatedAt={generatedAt}
          realSeries={grsSeries}
        />
        <RegionalStrainBullseyePage
          strainType="GCS"
          patientLabel={patientLabel}
          totalFrames={totalFrames}
          pageNumber={3}
          totalPages={totalPages}
          generatedAt={generatedAt}
          realSeries={gcsSeries}
        />
        <StrainDetailPage
          strainType="GRS"
          patientLabel={patientLabel}
          totalFrames={totalFrames}
          pageNumber={4}
          totalPages={totalPages}
          generatedAt={generatedAt}
          realSeries={grsSeries}
        />
        <StrainDetailPage
          strainType="GCS"
          patientLabel={patientLabel}
          totalFrames={totalFrames}
          pageNumber={5}
          totalPages={totalPages}
          generatedAt={generatedAt}
          realSeries={gcsSeries}
        />
        {hasRvStrain && (
          <RvStrainPage
            patientLabel={patientLabel}
            pageNumber={6}
            totalPages={totalPages}
            generatedAt={generatedAt}
            rvStrain={rvStrain}
            rvStrainSeries={rvStrainSeries}
          />
        )}
          </>
        )}
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
