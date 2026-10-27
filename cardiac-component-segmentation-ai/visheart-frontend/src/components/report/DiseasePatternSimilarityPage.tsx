"use client";

import React from "react";
import { HeartPulse, CheckCircle2, XCircle, HelpCircle, AlertTriangle } from "lucide-react";
import type { DiseasePatternGates } from "@/hooks/useProjectResults";
import { ReportPageFrame } from "./ReportPageFrame";

// "Met" gate color — one hue (green), not per-diagnostic-group: solid for the
// Primary/sole match, a lighter tint for a co-firing "Also meets" gate.
const MET_COLOR = "#16a34a";
const MET_COLOR_SECONDARY_ICON = "#4ade80";

export function DiseasePatternSimilarityPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  patternGates,
}: {
  patientLabel: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  /** Unified LV+RV ACDC-criteria gate assessment (NOR/MINF/DCM/HCM/RV). */
  patternGates?: DiseasePatternGates;
}) {
  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Complete"
      title="Disease Pattern Similarity"
      subtitle="Which ACDC diagnostic-group criteria the measurements meet — not a diagnosis"
      generatedAt={generatedAt}
    >
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[14px] font-extrabold text-emerald-700">
        <HeartPulse className="h-4 w-4" strokeWidth={2.5} />Disease Pattern Gates
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-gray-600">ACDC-based</span>
      </h3>
      {patternGates ? (
        <div className="rounded-lg border border-gray-300 p-3">
          {/* "Met" is always green — solid for the Primary/sole match,
              lighter for a co-firing "Also meets" gate. See MET_COLOR above. */}
          <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[8px] text-gray-600">
            <span className="font-semibold text-gray-700">Met badge:</span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: MET_COLOR }} />
              Primary / sole match
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full border" style={{ borderColor: MET_COLOR }} />
              Also meets
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {/* RV NOR and RV (Abnormal) are the same chamber's two sides of one question —
                once one is conclusively met, hide the other rather than showing a
                contradictory-looking pair; show both when neither is conclusively met yet. */}
            {patternGates.gates
              .filter((g) => {
                if (g.code === "RV" && patternGates.gates.find((x) => x.code === "NOR_RV")?.met === true) return false;
                if (g.code === "NOR_RV" && patternGates.gates.find((x) => x.code === "RV")?.met === true) return false;
                return true;
              })
              .map((g) => {
              const isSecondaryMet = g.met === true && g.rank_label === "Also meets";
              return (
              <div key={g.code} className="rounded border border-gray-200 p-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-[10.5px] font-semibold text-gray-900">
                    {g.met === true ? (
                      <CheckCircle2 className="h-3 w-3 shrink-0" style={{ color: isSecondaryMet ? MET_COLOR_SECONDARY_ICON : MET_COLOR }} />
                    ) : g.met === false ? (
                      <XCircle className="h-3 w-3 shrink-0 text-gray-300" />
                    ) : (
                      <HelpCircle className="h-3 w-3 shrink-0 text-amber-500" />
                    )}
                    {g.label}
                  </span>
                  <span className="flex items-center gap-1">
                    {g.rank_label && (
                      <span className="rounded-full border border-gray-400 px-1 py-0.5 text-[7.5px] font-semibold text-gray-700">
                        {g.rank_label}
                      </span>
                    )}
                    <span className="text-[8.5px] font-bold uppercase tracking-wide text-gray-600">
                      {g.met === true ? "Met" : g.met === false ? "Not met" : "Pending"}
                    </span>
                    {g.resolved_from_partial_data && (
                      <span
                        className="flex items-center gap-0.5 rounded-full border border-red-400 bg-red-50 px-1 py-0.5 text-[7.5px] font-semibold text-red-700"
                        title="This gate's result was decided from only some of its required values — the rest were unavailable, but couldn't have changed the outcome either way."
                      >
                        <AlertTriangle className="h-2 w-2" /> Partial data
                      </span>
                    )}
                  </span>
                </div>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                  {g.reasons.map((r, i) => {
                    const isPartialNote = r.startsWith("Resolved from ") || r.startsWith("Pending — the missing");
                    return (
                      <li key={i} className={isPartialNote ? "text-[9px] font-semibold text-red-700" : "text-[9px] text-gray-600"}>
                        {r}
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-0.5 text-[8.5px] italic leading-snug text-gray-500">{g.criterion_text}</p>
              </div>
              );
            })}
          </div>
          {patternGates.rv_severity && (
            <div className="mt-2 border-t border-dashed border-gray-300 pt-2 text-[9px] text-gray-600">
              <span className="font-semibold text-gray-900">RV gate met — severity context:</span>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>{patternGates.rv_severity.ratio_note}</li>
                {patternGates.rv_severity.arvc_note && <li>{patternGates.rv_severity.arvc_note}</li>}
                {patternGates.rv_severity.pah_note && <li>{patternGates.rv_severity.pah_note}</li>}
                {patternGates.rv_severity.generic_note && <li>{patternGates.rv_severity.generic_note}</li>}
              </ul>
            </div>
          )}
          <p className="mt-2 border-t border-dashed border-gray-300 pt-2 text-[9px] italic text-gray-600">
            {patternGates.disclaimer}
          </p>
        </div>
      ) : (
        <p className="py-6 text-center text-[10px] text-gray-600">Not computed for this project yet.</p>
      )}
    </ReportPageFrame>
  );
}
