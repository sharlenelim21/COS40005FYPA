"use client";

import React from "react";
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

export type SeriesFrame = { frameIndex: number; values: (number | null)[] };

/**
 * Shared "every computed frame" pagination for a per-segment/per-region
 * series: an all-frame bullseye grid followed by a full values table — used
 * by LV Regional GRS/GCS and RV Regional GCS/GAS. The bullseye itself is
 * rendered by the caller (`renderBullseye`) since LV uses the 17-segment AHA
 * chart and RV uses the 6- or 9-region free-wall ring — different geometry,
 * same pagination shape.
 */
export function frameSeriesPageCount(frameCount: number): number {
  if (frameCount === 0) return 1;
  return Math.ceil(frameCount / FRAMES_PER_BULLSEYE_PAGE) + Math.ceil(frameCount / FRAMES_PER_TABLE_PAGE);
}

export function FrameSeriesPages({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  metricLabel,
  columnLabels,
  frames,
  edFrameIndex,
  esFrameIndex,
  renderBullseye,
  emptyMessage,
  tablePrototypeNote,
  bullseyeIntroNote,
  theme = "teal",
}: {
  patientLabel: string;
  /** First physical page number this component occupies. */
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  metricLabel: string;
  /** Column header per value index (AHA segment names, or RV region names). */
  columnLabels: string[];
  frames: SeriesFrame[];
  edFrameIndex?: number | null;
  esFrameIndex?: number | null;
  renderBullseye: (values: (number | null)[]) => React.ReactNode;
  emptyMessage: string;
  /** When set, the values table leads with a "prototype — not yet validated"
   *  banner using this text, instead of presenting the numbers at face value. */
  tablePrototypeNote?: string;
  /** When set, shown as a compact note above the grid on the FIRST bullseye
   *  page only — lets a caller fold a short intro into this section instead
   *  of spending a whole separate page on a paragraph of text. */
  bullseyeIntroNote?: string;
  /** "amber" marks this whole section (accent color, ED/ES outline, table
   *  header) as prototype/dummy content rather than real computed values. */
  theme?: "teal" | "amber";
}) {
  const bullseyeChunks = chunk(frames, FRAMES_PER_BULLSEYE_PAGE);
  const tableChunks = chunk(frames, FRAMES_PER_TABLE_PAGE);
  let page = pageNumber;
  const accentBorder = theme === "amber" ? "border-amber-500" : "border-teal-500";
  const accentHeadBg = theme === "amber" ? "bg-amber-100" : "bg-teal-50";
  const accentHeadText = theme === "amber" ? "text-amber-800" : "text-teal-800";
  const accentRowBg = theme === "amber" ? "bg-amber-50" : "bg-teal-50/50";

  const frameLabelFor = (idx: number) => {
    if (idx === edFrameIndex) return `${idx} (ED)`;
    if (idx === esFrameIndex) return `${idx} (ES)`;
    return String(idx);
  };

  if (!frames.length) {
    return (
      <ReportPageFrame
        pageNumber={page}
        totalPages={totalPages}
        patientLabel={patientLabel}
        statusLabel="Complete"
        title={metricLabel}
        subtitle="Every computed frame"
        generatedAt={generatedAt}
      >
        <p className="py-10 text-center text-[10px] text-gray-600">{emptyMessage}</p>
      </ReportPageFrame>
    );
  }

  return (
    <>
      {bullseyeChunks.map((frameChunk, ci) => (
        <ReportPageFrame
          key={`b${ci}`}
          pageNumber={page++}
          totalPages={totalPages}
          patientLabel={patientLabel}
          statusLabel="Complete"
          title={`${metricLabel}${bullseyeChunks.length > 1 ? ` (${ci + 1} of ${bullseyeChunks.length})` : ""}`}
          subtitle="Every computed frame — end-diastole (ED) and end-systole (ES) marked"
          generatedAt={generatedAt}
        >
          {ci === 0 && bullseyeIntroNote && (
            <p className="mb-2 text-[9.5px] leading-snug text-gray-600">{bullseyeIntroNote}</p>
          )}
          <div className="grid grid-cols-3 gap-3">
            {frameChunk.map((f) => (
              <div key={f.frameIndex} className={`rounded-md border-2 p-1 ${f.frameIndex === edFrameIndex || f.frameIndex === esFrameIndex ? accentBorder : "border-gray-300"}`}>
                <div className="mx-auto h-[180px] w-[180px]">{renderBullseye(f.values)}</div>
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
          title={`${metricLabel} — By Region & Frame${tableChunks.length > 1 ? ` (${ci + 1} of ${tableChunks.length})` : ""}`}
          subtitle="Every value, every computed frame"
          generatedAt={generatedAt}
        >
          {ci === 0 && tablePrototypeNote && (
            <div className="mb-2 rounded-md border border-dashed border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[9px] text-amber-800">
              <span className="font-bold uppercase tracking-wide">Prototype — </span>{tablePrototypeNote}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[7.5px]">
              <thead>
                <tr className={accentHeadBg}>
                  <th className={`border-b border-gray-300 px-1 py-1 text-left font-bold ${accentHeadText}`}>Frame</th>
                  {columnLabels.map((label, i) => (
                    <th key={i} className={`border-b border-gray-300 px-0.5 py-1 text-right font-bold ${accentHeadText}`}>{i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {frameChunk.map((f) => {
                  const isMarked = f.frameIndex === edFrameIndex || f.frameIndex === esFrameIndex;
                  return (
                    <tr key={f.frameIndex} className={isMarked ? accentRowBg : undefined}>
                      <td className="border-b border-gray-300/60 px-1 py-0.5 font-semibold text-gray-900">{frameLabelFor(f.frameIndex)}</td>
                      {columnLabels.map((_, i) => (
                        <td key={i} className={`border-b border-gray-300/60 px-0.5 py-0.5 text-right font-mono ${theme === "amber" ? "italic text-amber-800" : "text-gray-900"}`}>{fmt(f.values[i], 1)}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {ci === tableChunks.length - 1 && (
            <p className="mt-2 text-[8.5px] text-gray-600">
              {columnLabels.map((l, i) => `${i + 1}. ${l}`).join(" · ")}
            </p>
          )}
        </ReportPageFrame>
      ))}
    </>
  );
}
