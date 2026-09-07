"use client";

import React from "react";
import { HeartPulse } from "lucide-react";
import type { DiseaseSimilarity } from "@/hooks/useProjectResults";
import { computeRvDiseasePatterns, type RvDiseasePatternInputs } from "@/lib/rvDiseasePattern";
import { ReportPageFrame } from "./ReportPageFrame";

// Same colors the on-screen report (InteractiveReport.tsx) uses for these
// bars, so the printed and interactive views never disagree visually.
const LV_PATTERN_COLORS: Record<string, string> = { NOR: "#15803d", DCM: "#b45309", HCM: "#dc2626" };
const RV_PATTERN_COLORS: Record<string, string> = { ARVC: "#dc2626", PAH: "#7c3aed", GENERAL: "#64748b" };

export function DiseasePatternSimilarityPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  similarity,
  rvInputs,
}: {
  patientLabel: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  similarity?: DiseaseSimilarity;
  rvInputs: RvDiseasePatternInputs;
}) {
  const rvPatterns = computeRvDiseasePatterns(rvInputs);
  const topLv = similarity?.similarities?.find((s) => s.code === similarity.most_similar);
  const topRv = rvPatterns.reduce((a, b) => (b.score > a.score ? b : a), rvPatterns[0]);
  const confidenceTier = similarity?.confidence != null
    ? (similarity.confidence >= 0.85 ? "High" : similarity.confidence >= 0.6 ? "Reduced" : "Low")
    : null;

  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Complete"
      title="Disease Pattern Similarity"
      subtitle="Computational similarity to published disease-associated patterns — not a diagnosis"
      generatedAt={generatedAt}
    >
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[14px] font-extrabold text-blue-700">
        <HeartPulse className="h-4 w-4" strokeWidth={2.5} />LV Phenotype Similarity
      </h3>
      {similarity?.similarities?.length ? (
        <div className="rounded-lg border border-gray-300 p-3">
          <div className="flex flex-col gap-2">
            {similarity.similarities.map((s) => (
              <div key={s.code} className="flex items-center gap-2.5">
                <span className="w-28 shrink-0 text-[10.5px] font-semibold text-gray-900">{s.label}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <span className="block h-full rounded-full" style={{ width: `${s.percent}%`, background: LV_PATTERN_COLORS[s.code] ?? "#64748b" }} />
                </span>
                <span className="w-12 shrink-0 text-right font-mono text-[11px] font-bold text-gray-900">{s.percent.toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <div className="mt-2 border-t border-dashed border-gray-300 pt-2 text-[10px] text-gray-600">
            <span className="font-semibold text-gray-900">Headline:</span> {similarity.phenotype_headline ?? "—"}
            {similarity.mode && <> · {similarity.mode === "indexed" ? "BSA-indexed" : "non-indexed"}</>}
            {confidenceTier && <> · {confidenceTier} confidence</>}
            {(topLv?.reasons?.length || similarity.gate?.reason) && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {topLv?.reasons?.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}
                {similarity.gate?.reason && <li>{similarity.gate.reason}</li>}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <p className="py-6 text-center text-[10px] text-gray-600">Not computed for this project yet.</p>
      )}

      <h3 className="mb-1.5 mt-4 flex items-center gap-1.5 text-[14px] font-extrabold text-rose-700">
        <HeartPulse className="h-4 w-4" strokeWidth={2.5} />RV Disease Pattern Analysis
        <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-700">prototype</span>
      </h3>
      <div className="rounded-lg border border-gray-300 p-3">
        <div className="flex flex-col gap-2">
          {rvPatterns.map((p) => (
            <div key={p.code} className="flex items-center gap-2.5">
              <span className="w-32 shrink-0 text-[10.5px] font-semibold text-gray-900">{p.label.replace(" RV pattern", "").replace(" pattern", "")}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                <span className="block h-full rounded-full" style={{ width: `${p.score}%`, background: RV_PATTERN_COLORS[p.code] }} />
              </span>
              <span className="w-14 shrink-0 text-right font-mono text-[11px] font-bold text-gray-900">{p.score}/100</span>
            </div>
          ))}
        </div>
        {!!topRv && (
          <div className="mt-2 border-t border-dashed border-gray-300 pt-2 text-[10px] text-gray-600">
            <span className="font-semibold text-gray-900">Contributing features — {topRv.label}</span>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {topRv.factors.slice(0, 4).map((f, i) => (
                <li key={i}>
                  {f.detail}
                  {f.status === "pending" && <span className="ml-1 text-[8.5px] font-bold uppercase text-amber-600">placeholder — not assessed</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-2 text-[9px] italic text-amber-600">
          Similarity scores represent computational similarity to published disease-associated patterns. They are
          not diagnostic probabilities.
        </p>
      </div>
    </ReportPageFrame>
  );
}
