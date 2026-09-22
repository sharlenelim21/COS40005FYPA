"use client";

import React from "react";
import { StrainBullseyeChart, SEGMENT_LABELS, type StrainSegmentData } from "@/components/landmark/StrainVisualization";
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

export type WtFrame = { frameIndex: number; segments: { segment: number; wt_mm?: number | null }[] };

function toSeries(frame: WtFrame | undefined): StrainSegmentData[] {
  const bySeg = new Map((frame?.segments ?? []).map((s) => [s.segment, s.wt_mm ?? null]));
  return Array.from({ length: 17 }, (_, i) => ({ segment: i + 1, label: SEGMENT_LABELS[i], strain: bySeg.get(i + 1) ?? 0 }));
}

function frameStats(frames: WtFrame[]) {
  const all = frames.flatMap((f) => f.segments.map((s) => s.wt_mm)).filter((v): v is number => typeof v === "number");
  return { min: all.length ? Math.min(...all) : 0, max: all.length ? Math.max(...all) : 1 };
}

/** How many physical pages this component renders for `frames.length` — used by report/page.tsx to reserve page numbers. */
export function wallThicknessCyclePageCount(frameCount: number): number {
  if (frameCount === 0) return 1; // just the "not computed" + RV placeholder page
  // Bullseye grid pages + LV values-table pages + RV FAC prototype-table
  // pages — the last two chunk the same `frames` array at the same size, so
  // they always produce the same page count.
  return Math.ceil(frameCount / FRAMES_PER_BULLSEYE_PAGE) + 2 * Math.ceil(frameCount / FRAMES_PER_TABLE_PAGE);
}

export function WallThicknessCyclePage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  frames,
  edFrameIndex,
  esFrameIndex,
}: {
  patientLabel: string;
  /** First physical page number this component occupies. */
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  frames: WtFrame[];
  edFrameIndex?: number | null;
  esFrameIndex?: number | null;
}) {
  const bullseyeChunks = chunk(frames, FRAMES_PER_BULLSEYE_PAGE);
  const tableChunks = chunk(frames, FRAMES_PER_TABLE_PAGE);
  const { min, max } = frameStats(frames);
  let page = pageNumber;

  if (!frames.length) {
    return (
      <ReportPageFrame
        pageNumber={page}
        totalPages={totalPages}
        patientLabel={patientLabel}
        statusLabel="Complete"
        title="Wall Thickness & Cavity Area — Across the Cycle"
        subtitle="LV wall thickness and RV cavity area, every computed frame"
        generatedAt={generatedAt}
      >
        <p className="py-10 text-center text-[10px] text-gray-600">
          Not computed — run the per-frame strain series to populate the LV wall-thickness cycle.
        </p>
        <RvCycleStub />
      </ReportPageFrame>
    );
  }

  const frameLabelFor = (idx: number) => {
    if (idx === edFrameIndex) return `${idx} (ED)`;
    if (idx === esFrameIndex) return `${idx} (ES)`;
    return String(idx);
  };

  return (
    <>
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

      {chunk(frames, FRAMES_PER_TABLE_PAGE).map((frameChunk, ci, all) => (
        <ReportPageFrame
          key={`rv${ci}`}
          pageNumber={page++}
          totalPages={totalPages}
          patientLabel={patientLabel}
          statusLabel="Complete"
          title={`RV Cavity Area (FAC) — Across the Cycle${all.length > 1 ? ` (${ci + 1} of ${all.length})` : ""}`}
          subtitle="Prototype — no per-frame RV cavity-area computation exists yet"
          generatedAt={generatedAt}
        >
          {ci === 0 && (
            <div className="mb-2 rounded-md border border-dashed border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[9px] text-amber-800">
              <span className="font-bold uppercase tracking-wide">Prototype — </span>
              No per-frame RV cavity-area (and therefore FAC) computation exists in this pipeline yet. Every value
              below is a placeholder, not a measurement — shown as a table (Basal/Mid/Apical, matching the
              regions used elsewhere for RV) so the report&apos;s structure stays identical for both chambers.
            </div>
          )}
          <table className="w-full border-collapse text-[9px]">
            <thead>
              <tr className="bg-amber-100">
                <th className="border-b border-gray-300 px-2 py-1 text-left font-bold text-amber-800">Frame</th>
                <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-amber-800">Basal FAC</th>
                <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-amber-800">Mid FAC</th>
                <th className="border-b border-gray-300 px-2 py-1 text-right font-bold text-amber-800">Apical FAC</th>
              </tr>
            </thead>
            <tbody>
              {frameChunk.map((f) => {
                const isMarked = f.frameIndex === edFrameIndex || f.frameIndex === esFrameIndex;
                return (
                  <tr key={f.frameIndex} className={isMarked ? "bg-amber-50" : undefined}>
                    <td className="border-b border-gray-300/60 px-2 py-0.5 font-semibold text-gray-900">{frameLabelFor(f.frameIndex)}</td>
                    <td className="border-b border-gray-300/60 px-2 py-0.5 text-right font-mono italic text-amber-800">—</td>
                    <td className="border-b border-gray-300/60 px-2 py-0.5 text-right font-mono italic text-amber-800">—</td>
                    <td className="border-b border-gray-300/60 px-2 py-0.5 text-right font-mono italic text-amber-800">—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ReportPageFrame>
      ))}
    </>
  );
}

function RvCycleStub() {
  return (
    <div className="relative mt-4 rounded-lg border border-dashed border-gray-300 bg-amber-50 p-3">
      <span className="absolute right-2 top-2 rounded-full bg-amber-100 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-700">
        prototype — not yet computed
      </span>
      <p className="mb-1 text-[13px] font-extrabold text-gray-900">RV Cavity Area (FAC) — Across the Cycle</p>
      <p className="text-[9.5px] text-gray-600">
        No per-frame RV cavity-area computation exists in this pipeline yet — once built, this section will show the
        same bullseye-per-frame grid and full segment/frame table as LV Wall Thickness above.
      </p>
    </div>
  );
}
