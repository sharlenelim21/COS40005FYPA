"use client";

import React from "react";
import { ReportPageFrame } from "./ReportPageFrame";

/** One reference table: caption, column headers, rows, and its citation line. */
function RefTable({
  caption,
  columns,
  rows,
  cite,
}: {
  caption: string;
  columns: string[];
  rows: string[][];
  cite: React.ReactNode;
}) {
  return (
    <section className="mb-3">
      <p className="mb-1 text-[10px] font-bold text-gray-900">{caption}</p>
      <table className="w-full border-collapse text-[9px]">
        <thead>
          <tr className="bg-gray-100">
            {columns.map((c) => (
              <th key={c} className="border-b border-gray-300 px-2 py-1 text-left font-semibold text-gray-600">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className="border-b border-gray-300/60 px-2 py-1 text-gray-900">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[8px] leading-snug text-gray-600">{cite}</p>
    </section>
  );
}

/**
 * Static reference material — published diagnostic criteria, published risk
 * ranges, and this project's own disease-similarity scoring profiles. None of
 * it is computed from this patient's data (unlike every other report page),
 * so it carries no "preview"/"real value" distinction; it exists purely to
 * give the values on earlier pages something to be read against.
 */
export function ReferenceCriteriaPage({
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
      title="Reference Criteria & Risk Ranges"
      subtitle="Published diagnostic criteria and risk ranges, plus this project's own scoring reference profiles"
      generatedAt={generatedAt}
    >
      <RefTable
        caption="ARVC — 2010 Revised Task Force Criteria (CMR)"
        columns={["Criterion", "Major", "Minor"]}
        rows={[
          ["RVEDVI, male", "≥ 110 mL/m²", "100 – <110 mL/m²"],
          ["RVEDVI, female", "≥ 100 mL/m²", "90 – <100 mL/m²"],
          ["RVEF", "≤ 40%", "40 – 45%"],
        ]}
        cite={
          <>
            te Riele, Tandri &amp; Bluemke, <em>J Cardiovasc Magn Reson</em> 2014;16:50, Table 1. Regional RV
            contraction abnormality is also required to meet the CMR Task Force criterion — not assessed by this
            pipeline.
          </>
        }
      />

      <RefTable
        caption="PAH-associated RV dysfunction — 2022 ESC/ERS Guidelines (cMRI)"
        columns={["Measure", "Lower risk", "Intermediate", "Higher risk"]}
        rows={[
          ["RVEF", "> 54%", "37 – 54%", "< 37%"],
          ["SVI", "> 40 mL/m²", "26 – 40 mL/m²", "< 26 mL/m²"],
          ["RVESVI", "< 42 mL/m²", "42 – 54 mL/m²", "> 54 mL/m²"],
        ]}
        cite={
          <>
            Humbert et al., <em>Eur Respir J</em> 2023;61:2200879, Table 16 (cMRI row).
          </>
        }
      />

      <RefTable
        caption="LV normal reference ranges — meta-analysis"
        columns={["Measure", "Male", "Female"]}
        rows={[
          ["EF", "52 – 73%", "54 – 75%"],
          ["EDVI", "60 – 109 mL/m²", "56 – 96 mL/m²"],
          ["LVMI", "41 – 76 g/m²", "33 – 57 g/m²"],
        ]}
        cite={
          <>
            Zhan et al., <em>Circ Cardiovasc Imaging</em> 2024;17(2):e016090.
          </>
        }
      />

      <RefTable
        caption="RV normal reference ranges — SCMR 2025"
        columns={["Measure", "Male", "Female"]}
        rows={[
          ["RVEF (lower limit of normal)", "≥ 44%", "≥ 47%"],
          ["RVEDVI", "47 – 116 mL/m²", "44 – 99 mL/m²"],
          ["RVESVI", "16 – 52 mL/m²", "13 – 43 mL/m²"],
        ]}
        cite={
          <>
            Kawel-Boehm et al., <em>J Cardiovasc Magn Reson</em> 2025;27:101853 — pooled healthy adults, 2.5th–97.5th
            percentiles, with papillary muscles and trabeculations counted as blood-pool volume (the convention of
            this project&apos;s ACDC and M&amp;Ms training labels). The ARVC RVEDVI cutoffs above overlap this range in
            men (≥ 110 mL/m² lies inside 47–116), so they apply only alongside a regional RV wall-motion abnormality.
          </>
        }
      />

      <RefTable
        caption="LV Phenotype Similarity — reference profiles used for scoring (mean ± SD)"
        columns={["Feature", "NOR-like", "HCM-like", "DCM-like"]}
        rows={[
          ["EF (%)", "63.5 ± 5.8 (pooled)", "59.0 ± 9.0", "29.0 ± 13.0"],
          ["EDV (mL) / EDVI (mL/m²)", "157.6 ± 25.3 / 82.5 ± 13.3", "179.5 ± 24.8 / 94.0 ± 13.0", "252.1 ± 78.3 / 132.0 ± 41.0"],
          ["ESV (mL) / ESVI (mL/m²)", "58.3 ± 13.8 / 30.5 ± 7.3", "74.5 ± 17.2 / 39.0 ± 9.0", "183.4 ± 76.4 / 96.0 ± 40.0"],
          ["LV mass (g) / LVMI (g/m²)", "104.1 ± 20.5 / 54.5 ± 10.8", "147.1 ± 22.9 / 77.0 ± 12.0", "133.7 ± 40.1 / 70.0 ± 21.0"],
        ]}
        cite={
          <>
            Both indexed (…I / BSA-adjusted) and non-indexed forms shown — whichever the patient&apos;s own BSA
            availability selected on earlier pages is the one actually scored. Indexed NOR: Zhan et al. 2024 (pooled
            shown; sex-specific used when sex is known). Indexed HCM/DCM: Kübler et al., <em>Int J Cardiovasc
            Imaging</em> 2021;37:2501–2515 (not sex-specific in the source). Non-indexed (absolute) values for all
            three profiles are the indexed figures multiplied by a declared generic reference BSA of 1.91 m² — an
            approximation used only when the patient&apos;s own height/weight are unavailable. These are provisional
            external references, not yet derived from this project&apos;s own deployed segmentation pipeline.
          </>
        }
      />

      <p className="mb-3 text-[8.5px] leading-snug text-gray-600">
        <strong>Not scored, shown for context only:</strong> maximum ED wall thickness is used only as a threshold
        gate (≥ 15 mm supports HCM-like, &lt; 12 mm supports DCM-like — the ACDC classification thresholds), not as a
        weighted similarity feature, since the nearest published cohort measures interventricular septal thickness
        specifically (Kübler et al.: HCM 12.4 ± 2.4 mm, DCM 8.8 ± 1.8 mm), which is not necessarily the same
        measurement as this pipeline&apos;s own per-segment maximum. Peak GRS/GCS are geometric mask-deformation
        measurements, not conventional CMR feature-tracking strain, and are displayed as informational values only —
        they are not compared against any reference range or included in the similarity score.
      </p>

      <p className="mt-2 text-[8.5px] leading-snug text-gray-600">
        These are disease-specific criteria, published risk ranges, and this project&apos;s own scoring reference
        profiles — not universal &ldquo;normal ranges&rdquo; — presented for context alongside the values on
        earlier pages, never as a standalone verdict.
      </p>
    </ReportPageFrame>
  );
}
