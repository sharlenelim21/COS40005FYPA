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
        caption="LV Phenotype Similarity — reference profiles used for scoring (mean ± SD)"
        columns={["Feature", "NOR-like", "HCM-like", "DCM-like"]}
        rows={[
          ["EF (%)", "62.7 ± 5.6", "61.9 ± 12.6", "25.2 ± 9.0"],
          ["EDV (mL) / EDVI (mL/m²)", "139.1 ± 33.2 / 82.5 ± 13.3", "138.4 ± 56.8 / 80.0 ± 32.8", "248.3 ± 73.1 / 143.5 ± 42.3"],
          ["ESV (mL) / ESVI (mL/m²)", "53.8 ± 18.0 / 30.5 ± 7.3", "53.6 ± 34.3 / 31.0 ± 19.8", "170.8 ± 58.7 / 98.7 ± 33.9"],
          ["Max wall thickness (mm)", "9.0 ± 1.5", "19.0 ± 4.5", "8.5 ± 1.5"],
          ["LV mass (g) / LVMI (g/m²)", "94.3 ± 18.6 / 54.5 ± 10.8", "224.9 ± 60.6 / 130.0 ± 35.0", "117.6 ± 34.6 / 68.0 ± 20.0"],
          ["Peak GRS (%)", "40.3 ± 10.2", "37.8 ± 13.2", "11.2 ± 6.5"],
          ["Peak GCS (%)", "−16.8 ± 2.3", "−14.5 ± 3.3", "−5.6 ± 2.2"],
        ]}
        cite={
          <>
            Both indexed (…I / BSA-adjusted) and non-indexed forms shown — whichever the patient&apos;s own BSA
            availability selected on earlier pages is the one actually scored. EF, EDV, ESV, Peak GRS/GCS are ACDC
            cohort statistics (n=30/group, this project&apos;s own training data). NOR&apos;s EDVI/ESVI/LVMI come
            from Zhan et al. 2024 (pooled shown; sex-specific used when sex is known). Every other indexed/mass/
            wall-thickness value — HCM/DCM&apos;s EDVI/ESVI/LVMI/LV mass, and all three profiles&apos; own LV mass
            and max wall thickness — is a project heuristic, not literature-cited.
          </>
        }
      />

      <p className="mt-2 text-[8.5px] leading-snug text-gray-600">
        These are disease-specific criteria, published risk ranges, and this project&apos;s own scoring reference
        profiles — not universal &ldquo;normal ranges&rdquo; — presented for context alongside the values on
        earlier pages, never as a standalone verdict.
      </p>
    </ReportPageFrame>
  );
}
