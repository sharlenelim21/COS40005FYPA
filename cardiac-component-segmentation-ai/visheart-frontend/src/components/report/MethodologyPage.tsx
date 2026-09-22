"use client";

import React from "react";
import { ReportPageFrame } from "./ReportPageFrame";

const PIPELINE = ["MRI", "Segmentation", "LV / RV masks", "Heart metrics", "Wall thickness / FAC", "Strain", "Disease similarity"];

const METHOD_LIST: [string, string][] = [
  ["EDV / ESV", "Summed voxel volume of the LV/RV blood-pool mask at the auto-detected end-diastolic and end-systolic frames."],
  ["EF", "(EDV − ESV) / EDV × 100."],
  ["BSA indexing", "Mosteller formula, √(height × weight / 3600); every “…I” suffixed metric divides the raw value by BSA."],
  ["Max wall thickness", "Maximum of the 17 AHA-segment ED wall-thickness values from the bullseye analysis."],
  ["GRS / GCS", "Mask-difference deformation between ED and ES contours per AHA segment — a geometric surrogate, not CMR feature-tracking strain."],
  ["Disease similarity", "Weighted z-score distance to reference profiles, converted to percentages via softmax; rule-based gates flag when the top match's essential criterion isn't met."],
];

const LIMITATIONS = [
  "Results depend entirely on segmentation quality.",
  "GRS/GCS/GAS are method-dependent geometric surrogates, not validated feature-tracking strain.",
  "Disease-pattern scores are computational similarity scores, not diagnostic probabilities.",
  "Published clinical thresholds are shown for context and are not standalone diagnostic criteria.",
  "Results have not been clinically validated.",
];

export function MethodologyPage({
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
}: {
  patientLabel: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
}) {
  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Reference"
      title="Methodology & Limitations"
      subtitle="How each figure in this report was derived, and what it can't tell you"
      generatedAt={generatedAt}
    >
      <h3 className="mb-1.5 text-[12px] font-bold text-gray-900">Analysis Method</h3>
      <div className="mb-3 flex flex-wrap items-center gap-1.5 font-mono text-[9.5px] font-semibold text-gray-900">
        {PIPELINE.map((node, i) => (
          <React.Fragment key={node}>
            <span className="rounded-md border border-gray-300 bg-gray-100 px-2 py-1">{node}</span>
            {i < PIPELINE.length - 1 && <span className="text-gray-600">→</span>}
          </React.Fragment>
        ))}
      </div>

      <dl className="mb-3 text-[10.5px] text-gray-600">
        {METHOD_LIST.map(([dt, dd]) => (
          <div key={dt} className="mt-2 first:mt-0">
            <dt className="font-bold text-gray-900">{dt}</dt>
            <dd className="mt-0.5">{dd}</dd>
          </div>
        ))}
      </dl>

      <h3 className="mb-1.5 text-[12px] font-bold text-gray-900">Limitations</h3>
      <div className="mb-3 rounded-lg border border-gray-300 p-3">
        <ul className="list-disc space-y-1 pl-4 text-[10.5px] text-gray-900">
          {LIMITATIONS.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </div>

      <div className="rounded-lg border border-amber-500 bg-amber-500/10 p-3 text-[10.5px] text-gray-900">
        <span className="font-bold">Disclaimer — </span>
        VisHeart is a research/decision-support tool and does not provide a medical diagnosis. Results should be
        interpreted by qualified healthcare professionals in conjunction with clinical information.
      </div>
    </ReportPageFrame>
  );
}
