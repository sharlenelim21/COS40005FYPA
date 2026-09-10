     "use client";

import { useEffect, useMemo, useState } from "react";
import { Source_Sans_3 } from "next/font/google";
import { useParams, useRouter } from "next/navigation";
import { useProject } from "@/context/ProjectContext";
import { Button } from "@/components/ui/button";
import { LoadingProject } from "@/components/project/LoadingProject";
import { ErrorProject } from "@/components/project/ErrorProject";
import { ExecutiveSummaryPage } from "@/components/report/ExecutiveSummaryPage";
import { HeartMetricsPage } from "@/components/report/HeartMetricsPage";
import { WallThicknessCavityAreaPage } from "@/components/report/WallThicknessCavityAreaPage";
import { WallThicknessCyclePage, wallThicknessCyclePageCount } from "@/components/report/WallThicknessCyclePage";
import { StrainAnalysisPage, strainAnalysisPageCount, type StrainAnalysisRow } from "@/components/report/StrainAnalysisPage";
import { LvRegionalStrainPage, lvRegionalStrainPageCount } from "@/components/report/LvRegionalStrainPage";
import { RvRegionalStrainPage, rvRegionalStrainPageCount } from "@/components/report/RvRegionalStrainPage";
import { RvCavityGeometryPage, rvCavityGeometryPageCount } from "@/components/report/RvCavityGeometryPage";
import { DiseasePatternSimilarityPage } from "@/components/report/DiseasePatternSimilarityPage";
import { ReferenceCriteriaPage } from "@/components/report/ReferenceCriteriaPage";
import { MethodologyPage } from "@/components/report/MethodologyPage";
import { MriOverlayPage, mriOverlayPageCount } from "@/components/report/MriOverlayPage";
import type { RvDiseasePatternInputs, Sex } from "@/lib/rvDiseasePattern";
import { useProjectResults } from "@/hooks/useProjectResults";
import { InteractiveReport } from "@/components/report/InteractiveReport";
import { downloadResultsCsv } from "@/lib/exportResultsCsv";
import { ArrowLeft, ArrowUp, Printer, Download, AlertTriangle } from "lucide-react";

// The printed report follows the approved mockup's 9-section structure, but
// several sections (wall thickness cycle, full-cycle strain values, regional
// strain, RV cavity volume, MRI overlay) now render as many physical A4
// sheets as their per-frame data needs — see each page's own `*PageCount`
// helper — so the running page numbering below is computed, not hardcoded.

// No RV area-strain (GAS) computation exists anywhere in the pipeline yet —
// same fixed preview constant InteractiveReport.tsx uses on screen, so the
// print and screen views never disagree about what the placeholder says.
const RV_PEAK_GAS_PREVIEW = 28.7;

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
    rvStrainSeries, recomputeSimilarityWithBsa, recomputingSimilarity, recomputeSimilarityError, doc, byModel,
  } = useProjectResults(projectId, "recent");
  const [showScrollTop, setShowScrollTop] = useState(false);
  // BSA input — optional. Entered here (not persisted server-side) since it's
  // a report-time convenience, not a clinical record; height/weight are kept
  // as separate fields (rather than a single BSA field) because that's what a
  // user actually has on hand, with BSA itself derived via the Mosteller
  // formula. Blank either field and every BSA-indexed row simply doesn't print.
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  // Sex — needed alongside BSA for the sex-specific ARVC RVEDVI cutoffs (RV
  // disease-pattern scoring). Same "report-time convenience, never persisted"
  // treatment as height/weight above; owned here (not in InteractiveReport)
  // so the CSV export and the print DiseasePatternSimilarityPage can read the
  // exact same value the user selected on screen, instead of assuming
  // "unspecified" independently in three different places.
  const [patientSex, setPatientSex] = useState<Sex>("unspecified");
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

  // Chrome/Edge's "Save as PDF" dialog suggests document.title as the default
  // filename, so the title is swapped to a sanitised "<patient>_<date>_report"
  // just for the print call and restored afterwards — the on-screen tab title
  // (and anything else reading document.title) is otherwise unaffected.
  const handlePrint = () => {
    const safePatientLabel = patientLabel.replace(/[\\/:*?"<>|]/g, "").trim().replace(/\s+/g, "_");
    const dateStr = new Date().toISOString().slice(0, 10);
    const originalTitle = document.title;
    document.title = `${safePatientLabel}_${dateStr}_report`;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      document.title = originalTitle;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
    // Backstop in case `afterprint` never fires (some browser/PDF-export
    // paths skip it) — by this point the dialog has already read the title.
    setTimeout(restore, 5000);
  };

  // Reads the exact BSA/height/weight/sex state entered on this page, so the
  // CSV includes the same indexed values (EDVI/ESVI/LVMI, RVEDVI/RVESVI) and
  // RV disease-pattern scores the printed report shows, instead of the
  // landmark-detection page's export (which has no BSA/sex inputs at all and
  // so can only ever emit raw values).
  const handleDownloadCsv = () => {
    downloadResultsCsv(patientLabel, byModel, { bsaM2, heightCm: bsaM2 != null ? heightNum : null, weightKg: bsaM2 != null ? weightNum : null, sex: patientSex });
  };
  const hasRealData = !!(measurements || healthStatus || similarity);
  const scanSummary = [
    "Cine MRI",
    projectData?.dimensions?.slices ? `${projectData.dimensions.slices} slices` : null,
    totalFrames ? `${totalFrames} frames` : null,
    `Model: ${model === "unet" ? "UNetResNet34" : "MedSAM"}`,
  ].filter(Boolean).join(" · ");
  const voxelSize = projectData?.voxelsize
    ? `${projectData.voxelsize.x.toFixed(2)} × ${projectData.voxelsize.y.toFixed(2)} × ${(projectData.voxelsize.z ?? 0).toFixed(2)} mm`
    : "—";

  // ── RV strain reads (real, radius-based cavity-boundary measure) ───────────
  const rvPeakGcs = rvStrainSeries?.peak_global_rv_strain ?? rvStrain?.global_rv_strain ?? null;

  // ── Wall thickness ED frame / ED→ES/mid frames (page 3) ─────────────────────
  const edFrame = doc?.heartMetrics?.ed_frame ?? null;
  const esFrame = doc?.heartMetrics?.es_frame ?? null;

  // ── Per-frame series, sorted by the ACTUAL computed frame indices — a
  // project may have strain for every frame or only a chosen subset, so
  // nothing here assumes a 0..totalFrames-1 range. Shared by the wall-
  // thickness cycle, strain-analysis, and regional-strain pages below.
  const sortedLvFrames = strainSeries?.frames?.length
    ? [...strainSeries.frames].sort((a, b) => a.frameIndex - b.frameIndex)
    : [];
  const sortedRvFrames = rvStrainSeries?.frames?.length
    ? [...rvStrainSeries.frames].sort((a, b) => a.frameIndex - b.frameIndex)
    : [];

  const wtFrames = sortedLvFrames.map((f) => ({
    frameIndex: f.frameIndex,
    segments: f.segments.map((s) => ({ segment: s.segment, wt_mm: s.wt_mm })),
  }));
  const toSegmentValues = (segments: { segment: number; grs?: number | null; gcs?: number | null }[] | undefined, key: "grs" | "gcs") => {
    const bySeg = new Map((segments ?? []).map((s) => [s.segment, s[key] ?? null]));
    return Array.from({ length: 17 }, (_, i) => bySeg.get(i + 1) ?? null);
  };
  const lvGrsFrames = sortedLvFrames.map((f) => ({ frameIndex: f.frameIndex, values: toSegmentValues(f.segments, "grs") }));
  const lvGcsFrames = sortedLvFrames.map((f) => ({ frameIndex: f.frameIndex, values: toSegmentValues(f.segments, "gcs") }));
  const rvGcsFrames = sortedRvFrames.map((f) => {
    const byRegion = new Map(f.regions.map((r) => [r.region, r.strain]));
    return { frameIndex: f.frameIndex, values: Array.from({ length: 6 }, (_, i) => byRegion.get(i + 1) ?? null) };
  });

  // ── Full-cycle values, joined by ACTUAL frame index (page 4) ────────────────
  // LV and RV strain can be computed over different frame subsets, so this is
  // a proper join on frameIndex rather than assuming the two series line up
  // positionally.
  const lvByFrameIndex = new Map(sortedLvFrames.map((f) => [f.frameIndex, f]));
  const rvByFrameIndex = new Map(sortedRvFrames.map((f) => [f.frameIndex, f]));
  const allStrainFrameIndices = Array.from(new Set([
    ...sortedLvFrames.map((f) => f.frameIndex),
    ...sortedRvFrames.map((f) => f.frameIndex),
  ])).sort((a, b) => a - b);
  const strainRows: StrainAnalysisRow[] = allStrainFrameIndices.map((frameIndex) => ({
    frameIndex,
    lvGrs: lvByFrameIndex.get(frameIndex)?.global_grs ?? null,
    lvGcs: lvByFrameIndex.get(frameIndex)?.global_gcs ?? null,
    rvGcs: rvByFrameIndex.get(frameIndex)?.global_rv_strain ?? null,
  }));

  // ── RV disease-pattern inputs (page 7) ──────────────────────────────────────
  // Sex now comes from the toggle in the Cardiac Measurements header
  // (patientSex state above), shared with the on-screen RV patterns card —
  // the sex-specific ARVC RVEDVI cutoffs only render as "pending" when the
  // user genuinely hasn't picked one, not unconditionally.
  const rvInputs: RvDiseasePatternInputs = {
    rvedvi: bsaM2 && rv?.RVEDV != null ? rv.RVEDV / bsaM2 : null,
    rvesvi: bsaM2 && rv?.RVESV != null ? rv.RVESV / bsaM2 : null,
    rvef: rv?.RVEF ?? null,
    svi: bsaM2 && rv?.RV_SV != null ? rv.RV_SV / bsaM2 : null,
    sex: patientSex,
    regionalContractionAbnormal: null,
    gasAbnormal: null,
  };

  // The MRI-overlay page needs real MRI pixels (dimensions), real decoded RLE
  // masks (a mask document id to fetch raw frames from), and real ED/ES frame
  // indices to pick — any missing piece means there's nothing genuine to
  // render, so the page is skipped rather than showing a placeholder image.
  const hasMriOverlay = !!(
    doc?._id &&
    projectData?.dimensions?.width &&
    projectData?.dimensions?.height &&
    edFrame != null &&
    esFrame != null
  );

  // Running page count — each section claims as many physical sheets as its
  // own per-frame data needs (see each page's `*PageCount` helper) instead of
  // a fixed literal, since frame counts vary per project (and per how many
  // frames the user chose to compute strain for).
  const wtCyclePages = wallThicknessCyclePageCount(wtFrames.length);
  const strainPages = strainAnalysisPageCount(strainRows.length);
  const lvRegionalPages = lvRegionalStrainPageCount(Math.max(lvGrsFrames.length, lvGcsFrames.length));
  const rvRegionalPages = rvRegionalStrainPageCount(rvGcsFrames.length);
  const rvCavityPages = rvCavityGeometryPageCount(rv?.rv_volumes_ml?.length ?? 0);
  const mriPages = hasMriOverlay ? mriOverlayPageCount(totalFrames) : 0;

  let nextPage = 1;
  const executiveSummaryPageNumber = nextPage++;
  const heartMetricsPageNumber = nextPage++;
  const wallThicknessPageNumber = nextPage++;
  const wallThicknessCyclePageNumber = nextPage; nextPage += wtCyclePages;
  const strainAnalysisPageNumber = nextPage; nextPage += strainPages;
  const lvRegionalPageNumber = nextPage; nextPage += lvRegionalPages;
  const rvRegionalPageNumber = nextPage; nextPage += rvRegionalPages;
  const rvCavityPageNumber = nextPage; nextPage += rvCavityPages;
  const diseasePatternPageNumber = nextPage++;
  const referenceCriteriaPageNumber = nextPage++;
  const methodologyPageNumber = nextPage++;
  const mriOverlayPageNumber = nextPage; nextPage += mriPages;
  const totalPages = nextPage - 1;

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
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleDownloadCsv} disabled={!hasRealData}>
              <Download className="h-3.5 w-3.5" />
              Download CSV
            </Button>
            <Button size="sm" className="gap-1.5 text-xs" onClick={handlePrint}>
              <Printer className="h-3.5 w-3.5" />
              Print / Save as PDF
            </Button>
          </div>
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
          scanSummary={scanSummary}
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
          patientSex={patientSex}
          onPatientSexChange={setPatientSex}
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
            <ExecutiveSummaryPage
              patientLabel={patientLabel}
              pageNumber={executiveSummaryPageNumber}
              totalPages={totalPages}
              generatedAt={generatedAt}
              modelLabel={model === "unet" ? "UNetResNet34" : "MedSAM"}
              slices={projectData?.dimensions?.slices ?? null}
              frames={projectData?.dimensions?.frames ?? null}
              voxelSize={voxelSize}
              bsaM2={bsaM2}
              heightCm={bsaM2 != null ? heightNum : null}
              weightKg={bsaM2 != null ? weightNum : null}
              ef={measurements?.EF ?? null}
              edv={measurements?.EDV ?? null}
              esv={measurements?.ESV ?? null}
              strokeVolume={measurements?.StrokeVolume ?? null}
              peakGrs={measurements?.PeakGRS ?? null}
              peakGcs={measurements?.PeakGCS ?? null}
              maxWallThicknessMm={lvVolumes?.MaxWallThicknessMm ?? null}
              rvEf={rv?.RVEF ?? null}
              rvEdv={rv?.RVEDV ?? null}
              rvEsv={rv?.RVESV ?? null}
              rvSv={rv?.RV_SV ?? null}
              rvPeakGcs={rvPeakGcs}
              rvPeakGasPreview={RV_PEAK_GAS_PREVIEW}
              healthStatusText={healthStatus?.status ?? null}
              phenotypeHeadline={similarity?.phenotype_headline ?? null}
              isRealData
            />
            <HeartMetricsPage
              patientLabel={patientLabel}
              pageNumber={heartMetricsPageNumber}
              totalPages={totalPages}
              generatedAt={generatedAt}
              bsaM2={bsaM2}
              heightCm={bsaM2 != null ? heightNum : null}
              weightKg={bsaM2 != null ? weightNum : null}
              edv={measurements?.EDV ?? null}
              esv={measurements?.ESV ?? null}
              ef={measurements?.EF ?? null}
              strokeVolume={measurements?.StrokeVolume ?? null}
              lvMassG={lvVolumes?.LVMassG ?? null}
              maxWallThicknessMm={lvVolumes?.MaxWallThicknessMm ?? null}
              rvEdv={rv?.RVEDV ?? null}
              rvEsv={rv?.RVESV ?? null}
              rvEf={rv?.RVEF ?? null}
              rvSv={rv?.RV_SV ?? null}
            />
            <WallThicknessCavityAreaPage
              patientLabel={patientLabel}
              pageNumber={wallThicknessPageNumber}
              totalPages={totalPages}
              generatedAt={generatedAt}
              edWallThicknessMm={doc?.bullseye?.segment_values}
              edFrameIndex={edFrame}
            />
            <WallThicknessCyclePage
              patientLabel={patientLabel}
              pageNumber={wallThicknessCyclePageNumber}
              totalPages={totalPages}
              generatedAt={generatedAt}
              frames={wtFrames}
              edFrameIndex={edFrame}
              esFrameIndex={esFrame}
            />
            <StrainAnalysisPage
              patientLabel={patientLabel}
              pageNumber={strainAnalysisPageNumber}
              totalPages={totalPages}
              generatedAt={generatedAt}
              lvPeakGrs={measurements?.PeakGRS ?? null}
              lvPeakGcs={measurements?.PeakGCS ?? null}
              rvPeakGcs={rvPeakGcs}
              rvPeakGasPreview={RV_PEAK_GAS_PREVIEW}
              rows={strainRows}
            />
            <LvRegionalStrainPage
              patientLabel={patientLabel}
              pageNumber={lvRegionalPageNumber}
              totalPages={totalPages}
              generatedAt={generatedAt}
              grsFrames={lvGrsFrames}
              gcsFrames={lvGcsFrames}
              edFrameIndex={edFrame}
              esFrameIndex={esFrame}
            />
            <RvRegionalStrainPage
              patientLabel={patientLabel}
              pageNumber={rvRegionalPageNumber}
              totalPages={totalPages}
              generatedAt={generatedAt}
              gcsFrames={rvGcsFrames}
              edFrameIndex={edFrame}
              esFrameIndex={esFrame}
            />
            <RvCavityGeometryPage
              patientLabel={patientLabel}
              pageNumber={rvCavityPageNumber}
              totalPages={totalPages}
              generatedAt={generatedAt}
              rvEdv={rv?.RVEDV ?? null}
              rvEsv={rv?.RVESV ?? null}
              rvVolumesMl={rv?.rv_volumes_ml}
            />
            <DiseasePatternSimilarityPage
              patientLabel={patientLabel}
              pageNumber={diseasePatternPageNumber}
              totalPages={totalPages}
              generatedAt={generatedAt}
              similarity={similarity}
              rvInputs={rvInputs}
            />
            <ReferenceCriteriaPage
              patientLabel={patientLabel}
              pageNumber={referenceCriteriaPageNumber}
              totalPages={totalPages}
              generatedAt={generatedAt}
            />
            <MethodologyPage
              patientLabel={patientLabel}
              pageNumber={methodologyPageNumber}
              totalPages={totalPages}
              generatedAt={generatedAt}
            />
            {hasMriOverlay && (
              <MriOverlayPage
                projectId={projectId}
                patientLabel={patientLabel}
                pageNumber={mriOverlayPageNumber}
                totalPages={totalPages}
                generatedAt={generatedAt}
                maskDocId={doc?._id}
                width={projectData?.dimensions?.width}
                height={projectData?.dimensions?.height}
                totalSlices={projectData?.dimensions?.slices}
                totalFrames={totalFrames}
                edFrame={edFrame}
                esFrame={esFrame}
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
