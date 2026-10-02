"use client";

import React from "react";
import { StrainBullseyeChart, SEGMENT_LABELS, type StrainSegmentData } from "@/components/landmark/StrainVisualization";
import { RvRegionRing } from "./RvRegionRing";
import { ReportPageFrame } from "./ReportPageFrame";
import { chunk, fmt } from "./print-utils";

// 3 columns keeps each bullseye large enough to actually read. Fixed cell
// sizes, not a stretch-to-fill grid — a `1fr`/`h-full` grid inside the print
// page's forced-height container made Chrome's print pagination split the
// grid itself mid-page, producing blank cells and duplicated frames across
// the page break. Fixed sizing is what the report used before that
// experiment and is print-safe.
const FRAMES_PER_BULLSEYE_PAGE = 12;
const FRAMES_PER_TABLE_PAGE = 45;

/** Broadcast each ring's single FAC value across its 3 sections — FAC is
 *  only tracked per-RING (not per-section like GCS/GAS), so this is the same
 *  value drawn 3x within a ring rather than 3 independent measurements. */
function rvFacToNineWide(rings: (number | null)[]): (number | null)[] {
  return [0, 1, 2].flatMap((ring) => [rings[ring] ?? null, rings[ring] ?? null, rings[ring] ?? null]);
}

export type WtFrame = { frameIndex: number; segments: { segment: number; wt_mm?: number | null }[] };
/** Per-frame RV FAC vs ED, per ring [basal, mid, apical] — see rvAreaMetrics.rvFacSeries. */
export type RvFacFrame = { frameIndex: number; rings: (number | null)[] };

function toSeries(frame: WtFrame | undefined): StrainSegmentData[] {
  const bySeg = new Map((frame?.segments ?? []).map((s) => [s.segment, s.wt_mm ?? null]));
  return Array.from({ length: 17 }, (_, i) => ({ segment: i + 1, label: SEGMENT_LABELS[i], strain: bySeg.get(i + 1) ?? 0 }));
}

function frameStats(frames: WtFrame[]) {
  const all = frames.flatMap((f) => f.segments.map((s) => s.wt_mm)).filter((v): v is number => typeof v === "number");
  return { min: all.length ? Math.min(...all) : 0, max: all.length ? Math.max(...all) : 1 };
}

/** How many physical pages this component renders — used by report/page.tsx to reserve page numbers.
 *  LV: bullseye grid pages + values-table pages (or 1 "not computed" page).
 *  RV: FAC table pages over the RV series (or 1 "not computed" page). */
export function wallThicknessCyclePageCount(lvFrameCount: number, rvFrameCount: number): number {
  const lvPages = lvFrameCount
    ? Math.ceil(lvFrameCount / FRAMES_PER_BULLSEYE_PAGE) + Math.ceil(lvFrameCount / FRAMES_PER_TABLE_PAGE)
    : 1;
  const rvPages = rvFrameCount
    ? Math.ceil(rvFrameCount / FRAMES_PER_BULLSEYE_PAGE) + Math.ceil(rvFrameCount / FRAMES_PER_TABLE_PAGE)
    : 1;
  return lvPages + rvPages;
}

export function WallThicknessCyclePage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  frames,
  rvFacFrames,
  edFrameIndex,
  esFrameIndex,
}: {
  patientLabel: string;
  /** First physical page number this component occupies. */
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  frames: WtFrame[];
  rvFacFrames: RvFacFrame[];
  edFrameIndex?: number | null;
  esFrameIndex?: number | null;
}) {
  const bullseyeChunks = chunk(frames, FRAMES_PER_BULLSEYE_PAGE);
  const tableChunks = chunk(frames, FRAMES_PER_TABLE_PAGE);
  const { min, max } = frameStats(frames);
  let page = pageNumber;

  const rvBullseyeChunks = chunk(rvFacFrames, FRAMES_PER_BULLSEYE_PAGE);
  const rvChunks = chunk(rvFacFrames, FRAMES_PER_TABLE_PAGE);
  const hasRvFac = rvFacFrames.some((f) => f.rings.some((v) => v !== null));

  const frameLabelFor = (idx: number) => {
    if (idx === edFrameIndex) return `${idx} (ED)`;
    if (idx === esFrameIndex) return `${idx} (ES)`;
    return String(idx);
  };

  return (
    <>
      {!frames.length && (
        <ReportPageFrame
          pageNumber={page++}
          totalPages={totalPages}
          patientLabel={patientLabel}
          statusLabel="Complete"
          title="LV Wall Thickness Across the Cycle"
          subtitle="Every computed frame — end-diastole (ED) and end-systole (ES) marked"
          generatedAt={generatedAt}
        >
          <p className="py-10 text-center text-[10px] text-gray-600">
            Not computed — run the per-frame strain series to populate the LV wall-thickness cycle.
          </p>
        </ReportPageFrame>
      )}

      {bullseyeChunks.map((frameChunk, ci) => (
        <ReportPageFrame
          key={`b${ci}`}
          pageNumber={page++}
          totalPages={totalPages}
          patientLabel={patientLabel}
          statusLabel="Complete"
          title={`LV Wall Thickness Across the Cycle${bullseyeChunks.length > 1 ? ` (${ci + 1} of ${bullseyeChunks.length})` : ""}`}
          subtitle="Every computed frame — end-diastole (ED) and end-systole (ES) marked"
          generatedAt={generatedAt}
        >
          <div className="grid grid-cols-3 gap-3">
            {frameChunk.map((f) => (
              <div key={f.frameIndex} className={`rounded-md border-2 p-1 ${f.frameIndex === edFrameIndex || f.frameIndex === esFrameIndex ? "border-teal-500" : "border-gray-300"}`}>
                <div className="mx-auto h-[180px] w-[180px]">
                  <StrainBullseyeChart data={toSeries(f)} strainType="GRS" sharedMin={min} sharedMax={max} />
                </div>
                <p className="text-center text-[8px] font-bold text-gray-900">Frame {frameLabelFor(f.frameIndex)}</p>
              </div>
            ))}
          </div>
        </ReportPageFrame>
      ))}

      {tableChunks.map((frameChunk, ci) => (
        <ReportPageFrame
          key={`t${ci}`}
          pageNumber={page++}
          totalPages={totalPages}
          patientLabel={patientLabel}
          statusLabel="Complete"
          title={`LV Wall Thickness — All Segments & Frames${tableChunks.length > 1 ? ` (${ci + 1} of ${tableChunks.length})` : ""}`}
          subtitle="Wall thickness (mm), every AHA segment, every computed frame"
          generatedAt={generatedAt}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[6.8px]">
              <thead>
                <tr className="bg-teal-50">
                  <th className="border-b border-gray-300 px-1 py-1 text-left font-bold text-teal-800">Frame</th>
                  {Array.from({ length: 17 }, (_, i) => (
                    <th key={i} className="border-b border-gray-300 px-0.5 py-1 text-right font-bold text-teal-800">S{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {frameChunk.map((f) => {
                  const bySeg = new Map(f.segments.map((s) => [s.segment, s.wt_mm ?? null]));
                  const isMarked = f.frameIndex === edFrameIndex || f.frameIndex === esFrameIndex;
                  return (
                    <tr key={f.frameIndex} className={isMarked ? "bg-teal-50/50" : undefined}>
                      <td className="border-b border-gray-300/60 px-1 py-0.5 font-semibold text-gray-900">{frameLabelFor(f.frameIndex)}</td>
                      {Array.from({ length: 17 }, (_, i) => (
                        <td key={i} className="border-b border-gray-300/60 px-0.5 py-0.5 text-right font-mono text-gray-900">{fmt(bySeg.get(i + 1), 1)}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {ci === tableChunks.length - 1 && (
            <p className="mt-2 text-[8.5px] text-gray-600">S1–S17 are the 17 AHA segments, same order as the bullseye (basal 1–6, mid 7–12, apical 13–16, apex 17).</p>
          )}
        </ReportPageFrame>
      ))}

      {rvChunks.length === 0 ? (
        <ReportPageFrame
          pageNumber={page++}
          totalPages={totalPages}
          patientLabel={patientLabel}
          statusLabel="Complete"
          title="RV Cavity Area (FAC) — Across the Cycle"
          subtitle="Short-axis RV fractional area change vs end-diastole, every computed frame"
          generatedAt={generatedAt}
        >
          <p className="py-10 text-center text-[10px] text-gray-600">
            Not computed — run the RV strain series (all frames) to populate RV FAC across the cycle.
          </p>
        </ReportPageFrame>
      ) : (
        <>
          {rvBullseyeChunks.map((frameChunk, ci) => (
            <ReportPageFrame
              key={`rvb${ci}`}
              pageNumber={page++}
              totalPages={totalPages}
              patientLabel={patientLabel}
              statusLabel="Complete"
              title={`RV Cavity Area (FAC) — Across the Cycle${rvBullseyeChunks.length > 1 ? ` (${ci + 1} of ${rvBullseyeChunks.length})` : ""}`}
              subtitle="Short-axis RV fractional area change vs end-diastole, every computed frame"
              generatedAt={generatedAt}
            >
              {ci === 0 && (
                <p className="mb-2 text-[9.5px] leading-snug text-gray-600">
                  FAC = (ED area − frame area) / ED area × 100, drawn per ring across its 3 RV-bullseye
                  sections (= −GAS). Short-axis MRI, not the echo 4-chamber FAC — no validated reference range.
                </p>
              )}
              <div className="grid grid-cols-3 gap-3">
                {frameChunk.map((f) => (
                  <div key={f.frameIndex} className={`rounded-md border-2 p-1 ${f.frameIndex === edFrameIndex || f.frameIndex === esFrameIndex ? "border-teal-500" : "border-gray-300"}`}>
                    <div className="mx-auto h-[180px] w-[180px]">
                      <RvRegionRing values={rvFacToNineWide(f.rings)} metric="FAC" />
                    </div>
                    <p className="text-center text-[8px] font-bold text-gray-900">Frame {frameLabelFor(f.frameIndex)}</p>
                  </div>
                ))}
              </div>
            </ReportPageFrame>
          ))}

          {rvChunks.map((frameChunk, ci, all) => (
            <ReportPageFrame
              key={`rv${ci}`}
              pageNumber={page++}
              totalPages={totalPages}
              patientLabel={patientLabel}
              statusLabel="Complete"
              title={`RV Cavity Area (FAC) — All Values${all.length > 1 ? ` (${ci + 1} of ${all.length})` : ""}`}
              subtitle="Short-axis RV fractional area change vs end-diastole, every computed frame"
              generatedAt={generatedAt}
            >
              {ci === 0 && !hasRvFac && (
                <div className="mb-2 rounded-md border border-dashed border-gray-300 bg-gray-50 px-2.5 py-1.5 text-[9px] text-gray-600">
                  This RV strain series was computed before per-frame RV areas were stored — recompute the RV strain series to populate FAC.
                </div>
              )}
              <table className="w-full border-collapse text-[9px]">
                <thead>
                  <tr className="bg-teal-50">
                    <th className="border-b border-gray-300 px-2 py-1 text-left font-bold text-teal-800">Frame</th>
                    <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-teal-800">Basal FAC</th>
                    <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-teal-800">Mid FAC</th>
                    <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-teal-800">Apical FAC</th>
                  </tr>
                </thead>
                <tbody>
                  {frameChunk.map((f) => {
                    const isMarked = f.frameIndex === edFrameIndex || f.frameIndex === esFrameIndex;
                    return (
                      <tr key={f.frameIndex} className={isMarked ? "bg-teal-50/50" : undefined}>
                        <td className="border-b border-gray-300/60 px-2 py-0.5 font-semibold text-gray-900">{frameLabelFor(f.frameIndex)}</td>
                        {[0, 1, 2].map((ring) => (
                          <td key={ring} className="border-b border-gray-300/60 px-2 py-0.5 text-right font-mono text-gray-900">{fmt(f.rings[ring] ?? null)}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ReportPageFrame>
          ))}
        </>
      )}
    </>
  );
}
