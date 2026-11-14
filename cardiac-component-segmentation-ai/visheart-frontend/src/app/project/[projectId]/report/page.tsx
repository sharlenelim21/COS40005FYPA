     "use client";

import { useEffect, useMemo, useState } from "react";
import { Source_Sans_3 } from "next/font/google";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useProject } from "@/context/ProjectContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { LoadingProject } from "@/components/project/LoadingProject";
import { ErrorProject } from "@/components/project/ErrorProject";
import { ExecutiveSummaryPage } from "@/components/report/ExecutiveSummaryPage";
import { WallThicknessCavityAreaPage } from "@/components/report/WallThicknessCavityAreaPage";
import { WallThicknessCyclePage, wallThicknessCyclePageCount } from "@/components/report/WallThicknessCyclePage";
import { StrainAnalysisPage, strainAnalysisPageCount, type StrainAnalysisRow } from "@/components/report/StrainAnalysisPage";
import { LvRegionalStrainPage, lvRegionalStrainPageCount } from "@/components/report/LvRegionalStrainPage";
import { RvRegionalStrainPage, rvRegionalStrainPageCount } from "@/components/report/RvRegionalStrainPage";
import { MriOverlayPage, mriOverlayPageCount } from "@/components/report/MriOverlayPage";
import { LvWallThicknessEdEsPage } from "@/components/report/LvWallThicknessEdEsPage";
import { RvCavityAreaEdEsPage } from "@/components/report/RvCavityAreaEdEsPage";
import { LvStrainEdEsPage } from "@/components/report/LvStrainEdEsPage";
import { RvStrainEdEsPage } from "@/components/report/RvStrainEdEsPage";
import { MriOverlayEdEsPage } from "@/components/report/MriOverlayEdEsPage";
import { useProjectResults, type Sex } from "@/hooks/useProjectResults";
import { InteractiveReport } from "@/components/report/InteractiveReport";
import { downloadResultsCsv } from "@/lib/exportResultsCsv";
import { rvEdEsFac, rvFacSeries, rvGasMeasuredNote, rvPeakFac, rvPeakGas, rvPeakSeptalGcs } from "@/lib/rvAreaMetrics";
import { ArrowLeft, ArrowUp, Printer, Download, AlertTriangle, RefreshCw } from "lucide-react";

// The printed report follows the approved mockup's 9-section structure, but
// several sections (wall thickness cycle, full-cycle strain values, regional
// strain, RV cavity volume, MRI overlay) now render as many physical A4
// sheets as their per-frame data needs — see each page's own `*PageCount`
// helper — so the running page numbering below is computed, not hardcoded.

// Source Sans 3 — designed for documents/UI at small sizes, noticeably more
// legible than the app's unstyled system-font fallback once printed. Scoped
// to just the report so the rest of the app's typography is untouched.
const reportFont = Source_Sans_3({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export default function ReportPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set by whoever linked here (?from=project — the project page's own
  // Report Page button, and the dashboard/case-overview's report shortcuts)
  // so the back button returns wherever the user actually came from instead
  // of always assuming the Landmark Detection page. Reported live, 2026-11.
  const cameFromProject = searchParams.get("from") === "project";
  // Two export modes -- "default" (the short ED/ES-only review) is the mode's
  // own name's implication and the initial value; "full" is today's existing
  // full-cycle research report, unchanged. No persistent toolbar toggle: the
  // reader picks a mode in the dialog the Print button opens (below), so this
  // is plain local state rather than a `?mode=` URL push (switching modes must
  // not re-navigate the page). `?mode=full` on the incoming URL still seeds
  // the initial choice, for anyone who bookmarks/shares a direct link.
  const [mode, setMode] = useState<"default" | "full">(searchParams.get("mode") === "full" ? "full" : "default");
  // Print happens from the dialog's own buttons, one tick after `mode` is set
  // (so the print-only DOM has re-rendered the chosen mode's pages before
  // window.print() reads them) -- see the effect near handlePrint below.
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [pendingPrint, setPendingPrint] = useState(false);
  const { loading, error, projectData } = useProject();
  // One report, defaulting to the most-recently-computed model (no toggle) —
  // the reader gets a single authoritative view rather than choosing a model.
  // `computing` / `computeError` surface the self-healing analysis compute the
  // hook runs when a mask has no stored metrics yet, so the summary cards can
  // show progress instead of a permanent "not computed" dead end.
  const {
    model, measurements, healthStatus, patternGates, strain, strainSeries,
    computing, computeError, newerMaskAvailable, regionalHealthStatus, rvRegionalHealthStatus, rv, lvVolumes, rvStrain,
    rvStrainSeries, doc, byModel,
    recomputePatternGatesWithBsa, recomputingPatternGates, recomputePatternGatesError,
    rvHealthStatus, recomputeRvHealthStatus, recomputingRvHealthStatus, recomputeRvHealthStatusError,
    hasFreshData,
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

  useEffect(() => {
    let rafId: number;
    const measure = () => {
      const globalHeader = document.querySelector("header");
      const headerBottom = globalHeader?.getBoundingClientRect().bottom ?? 0;
      setClearance(Math.max(headerBottom, 0));
      rafId = requestAnimationFrame(measure);
    };
    rafId = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(rafId);
  }, []);

  if (error) return <ErrorProject error={error} />;
  if (loading !== "idle" && loading !== "done") return <LoadingProject loadingStage={loading} />;
  if (!hasFreshData) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Loading latest results…
      </div>
    );
  }

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

  // Fires window.print() one render after `mode` changes from the dialog
  // below -- React state updates aren't synchronous, so calling handlePrint()
  // in the same click handler that calls setMode() would read the PREVIOUS
  // mode's print-only DOM. Runs on mount too (harmless: pendingPrint starts
  // false), which is fine since it's a no-op until the dialog sets the flag.
  useEffect(() => {
    if (!pendingPrint) return;
    setPendingPrint(false);
    handlePrint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pendingPrint]);

  const choosePrintMode = (next: "default" | "full") => {
    setMode(next);
    setPendingPrint(true);
    setPrintDialogOpen(false);
  };

  // Reads the exact BSA/height/weight/sex state entered on this page, so the
  // CSV includes the same indexed values (EDVI/ESVI/LVMI, RVEDVI/RVESVI) and
  // RV disease-pattern scores the printed report shows, instead of the
  // landmark-detection page's export (which has no BSA/sex inputs at all and
  // so can only ever emit raw values).
  const handleDownloadCsv = () => {
    downloadResultsCsv(patientLabel, byModel, { bsaM2, heightCm: bsaM2 != null ? heightNum : null, weightKg: bsaM2 != null ? weightNum : null, sex: patientSex });
  };
  const hasRealData = !!(measurements || healthStatus || patternGates);
  // Short summary line for ExecutiveSummaryPage — the gates module has no
  // single "most similar" pick (a patient can meet zero, one, or more than
  // one gate independently), so this joins whichever gate labels are
  // actually met instead of one headline string.
  const patternGatesHeadline = !patternGates
    ? null
    : patternGates.met_codes.length
    ? patternGates.gates.filter((g) => patternGates.met_codes.includes(g.code)).map((g) => g.label).join(", ")
    : "No ACDC pattern criteria met";
  const scanSummary = [
    "Cine MRI",
    projectData?.dimensions?.slices ? `${projectData.dimensions.slices} slices` : null,
    totalFrames ? `${totalFrames} frames` : null,
    `Model: ${model === "unet" ? "UNetResNet34" : "MedSAM"}`,
  ].filter(Boolean).join(" · ");
  const voxelSize = projectData?.voxelsize
    ? `${projectData.voxelsize.x.toFixed(2)} × ${projectData.voxelsize.y.toFixed(2)} × ${(projectData.voxelsize.z ?? 0).toFixed(2)} mm`
    : "—";

  // ── RV strain reads (9-segment RV bullseye; GCS and GAS kept separate) ────
  const rvPeakGcs = rvStrainSeries?.peak_global_rv_strain ?? rvStrain?.global_rv_strain ?? null;
  const rvPeakGasValue = rvPeakGas(rvStrain, rvStrainSeries);
  const rvPeakFacValue = rvPeakFac(rvStrain, rvStrainSeries);
  const rvEdEsFacValues = rvEdEsFac(rvStrain);
  const rvFacFrames = rvFacSeries(rvStrainSeries);

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

  // ── Default ("Summary (ED/ES)") report data — reuses the SAME stored Strain/RvStrain
  // fields the full report already shows elsewhere; nothing computed here is new.
  // `strain.segments[i].grs/gcs` already IS the ED→ES result (strain is 0% at ED
  // by definition); `wt_ed_mm`/`wt_es_mm` are real, independently-stored geometry
  // at both phases.
  const lvEdWallThicknessMm = Array.from({ length: 17 }, (_, i) =>
    strain?.segments?.find((s) => s.segment === i + 1)?.wt_ed_mm ?? null);
  const lvEsWallThicknessMm = Array.from({ length: 17 }, (_, i) =>
    strain?.segments?.find((s) => s.segment === i + 1)?.wt_es_mm ?? null);
  const lvEsGcs = toSegmentValues(strain?.segments, "gcs");
  const lvEsGrs = toSegmentValues(strain?.segments, "grs");
  const rvEsGcs = Array.from({ length: 9 }, (_, i) => rvStrain?.regions?.find((r) => r.region === i + 1)?.gcs ?? null);
  const rvEsGas = Array.from({ length: 9 }, (_, i) => rvStrain?.regions?.find((r) => r.region === i + 1)?.gas ?? null);
  // RV has its OWN ED/ES selection, independent of LV's edFrame/esFrame above —
  // shown separately rather than assumed to match (they can genuinely differ).
  const rvEdFrame = rvStrain?.edFrameIndex ?? null;
  const rvEsFrame = rvStrain?.esFrameIndex ?? null;
  const rvRegionFrames = (pick: (r: { strain: number | null; gas?: number | null }) => number | null | undefined) =>
    sortedRvFrames.map((f) => {
      const byRegion = new Map(f.regions.map((r) => [r.region, pick(r) ?? null]));
      return { frameIndex: f.frameIndex, values: Array.from({ length: 9 }, (_, i) => byRegion.get(i + 1) ?? null) };
    });
  const rvGcsFrames = rvRegionFrames((r) => r.strain);
  const rvGasFrames = rvRegionFrames((r) => r.gas);

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
    rvGas: rvByFrameIndex.get(frameIndex)?.global_rv_gas ?? null,
    rvSeptalGcs: rvByFrameIndex.get(frameIndex)?.global_rv_septal_gcs ?? null,
  }));

  // A stored RV health status result is shown only when it was graded for the
  // sex/BSA now selected on this page and after the latest heart-metrics
  // compute — same matching rule InteractiveReport.tsx applies on screen, so
  // the printed verdict never disagrees with (or shows a stale copy of) what
  // the interactive report currently displays.
  const sameBsa = (a: number | null | undefined, b: number | null | undefined) =>
    a == null || b == null ? a == null && b == null : Math.abs(a - b) < 1e-6;
  const heartMetricsComputedAt = doc?.heartMetrics?.computed_at ?? null;
  const rvHealthCurrent =
    rvHealthStatus &&
    rvHealthStatus.sex === patientSex &&
    sameBsa(rvHealthStatus.bsa_m2, bsaM2) &&
    (!heartMetricsComputedAt || rvHealthStatus.computed_at >= heartMetricsComputedAt)
      ? rvHealthStatus
      : null;

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
  let totalPages: number;
  let executiveSummaryPageNumber: number;
  let wallThicknessPageNumber = 0;
  let wallThicknessCyclePageNumber = 0;
  let strainAnalysisPageNumber = 0;
  let lvRegionalPageNumber = 0;
  let rvRegionalPageNumber = 0;
  let mriOverlayPageNumber = 0;
  // Default mode's own single-page sections (no per-frame chunking needed).
  let lvWallThicknessEdEsPageNumber = 0;
  let rvCavityAreaEdEsPageNumber = 0;
  let lvStrainEdEsPageNumber = 0;
  let rvStrainEdEsPageNumber = 0;
  let mriOverlayEdEsPageNumber = 0;

  if (mode === "full") {
    // Running page count — each section claims as many physical sheets as its
    // own per-frame data needs (see each page's `*PageCount` helper) instead of
    // a fixed literal, since frame counts vary per project (and per how many
    // frames the user chose to compute strain for).
    const wtCyclePages = wallThicknessCyclePageCount(wtFrames.length, rvFacFrames.length);
    const strainPages = strainAnalysisPageCount(strainRows.length);
    const lvRegionalPages = lvRegionalStrainPageCount(Math.max(lvGrsFrames.length, lvGcsFrames.length));
    const rvRegionalPages = rvRegionalStrainPageCount(rvGcsFrames.length);
    const mriPages = hasMriOverlay ? mriOverlayPageCount(totalFrames) : 0;

    let nextPage = 1;
    executiveSummaryPageNumber = nextPage++;
    wallThicknessPageNumber = nextPage++;
    wallThicknessCyclePageNumber = nextPage; nextPage += wtCyclePages;
    strainAnalysisPageNumber = nextPage; nextPage += strainPages;
    lvRegionalPageNumber = nextPage; nextPage += lvRegionalPages;
    rvRegionalPageNumber = nextPage; nextPage += rvRegionalPages;
    mriOverlayPageNumber = nextPage; nextPage += mriPages;
    totalPages = nextPage - 1;
  } else {
    // Default review: every section is exactly one physical page (ED+ES paired
    // on the same sheet, not chunked per frame) — ~5-7 pages total.
    let nextPage = 1;
    executiveSummaryPageNumber = nextPage++;
    lvWallThicknessEdEsPageNumber = nextPage++;
    rvCavityAreaEdEsPageNumber = nextPage++;
    lvStrainEdEsPageNumber = nextPage++;
    rvStrainEdEsPageNumber = nextPage++;
    if (hasMriOverlay) mriOverlayEdEsPageNumber = nextPage++;
    totalPages = nextPage - 1;
  }

  return (
    <div className="min-h-screen bg-muted/20 pb-16">
      {/* top is measured live (see `clearance` above), not a fixed class —
          it only takes effect once this element would otherwise need to
          stick, so it can't double-count against normal document flow, and
          it can't sit under the header/pill either since it's synced to
          their real bottom edge every frame. */}
      <div className="vh-no-print sticky z-20 border-b border-border bg-background/95 backdrop-blur" style={{ top: clearance }}>
        <div className="flex items-center justify-between px-4 py-2.5">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => router.push(cameFromProject ? `/project/${projectId}` : `/project/${projectId}/landmark-detection`)}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {cameFromProject ? "Back to Project" : "Back to Landmarks"}
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
            <Button size="sm" className="gap-1.5 text-xs" onClick={() => setPrintDialogOpen(true)}>
              <Printer className="h-3.5 w-3.5" />
              Print / Save as PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Which report to print — asked here instead of a persistent header
          toggle, per direct request (2026-11-14): the mode choice is a
          one-time decision at export time, not a standing view setting. */}
      <Dialog open={printDialogOpen} onOpenChange={setPrintDialogOpen}>
        <DialogContent className="vh-no-print sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Which report do you want to print?</DialogTitle>
            <DialogDescription>Choose a report, then the print/save-as-PDF dialog opens automatically.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => choosePrintMode("default")}
              className="rounded-lg border border-border p-3 text-left transition-colors hover:border-primary hover:bg-muted"
            >
              <p className="text-sm font-semibold text-foreground">Summary Report (ED/ES)</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Heart metrics and selected end-diastolic/end-systolic maps and tables.
              </p>
            </button>
            <button
              type="button"
              onClick={() => choosePrintMode("full")}
              className="rounded-lg border border-border p-3 text-left transition-colors hover:border-primary hover:bg-muted"
            >
              <p className="text-sm font-semibold text-foreground">Full Research Report (All Frames)</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Complete analysis, including all-frame maps, full-cycle measurements, and detailed regional tables.
              </p>
            </button>
          </div>
        </DialogContent>
      </Dialog>

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
          patternGates={patternGates}
          strain={strain}
          strainSeries={strainSeries}
          regionalHealthStatus={regionalHealthStatus}
          rvRegionalHealthStatus={rvRegionalHealthStatus}
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
          onRecomputePatternGatesWithBsa={recomputePatternGatesWithBsa}
          recomputingPatternGates={recomputingPatternGates}
          recomputePatternGatesError={recomputePatternGatesError}
          patientSex={patientSex}
          onPatientSexChange={setPatientSex}
          rvHealthStatus={rvHealthStatus}
          onRecomputeRvHealthStatus={recomputeRvHealthStatus}
          recomputingRvHealthStatus={recomputingRvHealthStatus}
          recomputeRvHealthStatusError={recomputeRvHealthStatusError}
          heartMetricsComputedAt={doc?.heartMetrics?.computed_at ?? null}
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
              rvPeakGas={rvPeakGasValue}
              rvFac={rvPeakFacValue}
              lvMassG={lvVolumes?.LVMassG ?? null}
              isRealData
              mode={mode}
              lvEdFrame={edFrame}
              lvEsFrame={esFrame}
              rvEdFrame={rvEdFrame}
              rvEsFrame={rvEsFrame}
            />
            {mode === "full" ? (
              <>
                <WallThicknessCavityAreaPage
                  patientLabel={patientLabel}
                  pageNumber={wallThicknessPageNumber}
                  totalPages={totalPages}
                  generatedAt={generatedAt}
                  modeLabel="Full Research (All Frames)"
                  edWallThicknessMm={lvEdWallThicknessMm}
                  edFrameIndex={edFrame}
                  rvFacRings={rvEdEsFacValues.rings}
                  rvFacGlobal={rvEdEsFacValues.global}
                  rvEsFrameIndex={rvStrain?.esFrameIndex ?? null}
                />
                <WallThicknessCyclePage
                  patientLabel={patientLabel}
                  pageNumber={wallThicknessCyclePageNumber}
                  totalPages={totalPages}
                  generatedAt={generatedAt}
                  modeLabel="Full Research (All Frames)"
                  frames={wtFrames}
                  rvFacFrames={rvFacFrames}
                  edFrameIndex={edFrame}
                  esFrameIndex={esFrame}
                />
                <StrainAnalysisPage
                  patientLabel={patientLabel}
                  pageNumber={strainAnalysisPageNumber}
                  totalPages={totalPages}
                  generatedAt={generatedAt}
                  modeLabel="Full Research (All Frames)"
                  lvPeakGrs={measurements?.PeakGRS ?? null}
                  lvPeakGcs={measurements?.PeakGCS ?? null}
                  rvPeakGcs={rvPeakGcs}
                  rvPeakGas={rvPeakGasValue}
                  rvPeakSeptalGcs={rvPeakSeptalGcs(rvStrain, rvStrainSeries)}
                  rows={strainRows}
                />
                <LvRegionalStrainPage
                  patientLabel={patientLabel}
                  pageNumber={lvRegionalPageNumber}
                  totalPages={totalPages}
                  generatedAt={generatedAt}
                  modeLabel="Full Research (All Frames)"
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
                  modeLabel="Full Research (All Frames)"
                  gcsFrames={rvGcsFrames}
                  gasFrames={rvGasFrames}
                  edFrameIndex={edFrame}
                  esFrameIndex={esFrame}
                />
                {hasMriOverlay && (
                  <MriOverlayPage
                    projectId={projectId}
                    patientLabel={patientLabel}
                    pageNumber={mriOverlayPageNumber}
                    totalPages={totalPages}
                    generatedAt={generatedAt}
                    modeLabel="Full Research (All Frames)"
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
            ) : (
              <>
                <LvWallThicknessEdEsPage
                  patientLabel={patientLabel}
                  pageNumber={lvWallThicknessEdEsPageNumber}
                  totalPages={totalPages}
                  generatedAt={generatedAt}
                  modeLabel="Summary (ED/ES)"
                  edWallThicknessMm={lvEdWallThicknessMm}
                  esWallThicknessMm={lvEsWallThicknessMm}
                  edFrameIndex={edFrame}
                  esFrameIndex={esFrame}
                />
                <RvCavityAreaEdEsPage
                  patientLabel={patientLabel}
                  pageNumber={rvCavityAreaEdEsPageNumber}
                  totalPages={totalPages}
                  generatedAt={generatedAt}
                  modeLabel="Summary (ED/ES)"
                  rvRegions={rvStrain?.regions}
                  rvFacRings={rvEdEsFacValues.rings}
                  rvFacGlobal={rvEdEsFacValues.global}
                  edFrameIndex={rvEdFrame}
                  esFrameIndex={rvEsFrame}
                />
                <LvStrainEdEsPage
                  patientLabel={patientLabel}
                  pageNumber={lvStrainEdEsPageNumber}
                  totalPages={totalPages}
                  generatedAt={generatedAt}
                  modeLabel="Summary (ED/ES)"
                  esGcs={lvEsGcs}
                  esGrs={lvEsGrs}
                  edFrameIndex={edFrame}
                  esFrameIndex={esFrame}
                />
                <RvStrainEdEsPage
                  patientLabel={patientLabel}
                  pageNumber={rvStrainEdEsPageNumber}
                  totalPages={totalPages}
                  generatedAt={generatedAt}
                  modeLabel="Summary (ED/ES)"
                  esGcs={rvEsGcs}
                  esGas={rvEsGas}
                  septalGcs={rvStrain?.global_rv_septal_gcs ?? null}
                  edFrameIndex={rvEdFrame}
                  esFrameIndex={rvEsFrame}
                />
                {hasMriOverlay && (
                  <MriOverlayEdEsPage
                    projectId={projectId}
                    patientLabel={patientLabel}
                    pageNumber={mriOverlayEdEsPageNumber}
                    totalPages={totalPages}
                    generatedAt={generatedAt}
                    modeLabel="Summary (ED/ES)"
                    maskDocId={doc?._id}
                    width={projectData?.dimensions?.width}
                    height={projectData?.dimensions?.height}
                    totalSlices={projectData?.dimensions?.slices}
                    edFrame={edFrame}
                    esFrame={esFrame}
                  />
                )}
              </>
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
