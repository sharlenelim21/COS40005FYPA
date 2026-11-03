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
 * Static reference material — the ACDC Challenge's own classification
 * criteria (what Disease Pattern Gates checks each gate against), published
 * risk ranges used for the RV gate's severity sub-notes, and the normal
 * reference ranges used for the NOR gate. None of it is computed from this
 * patient's data (unlike every other report page), so it carries no
 * "preview"/"real value" distinction; it exists purely to give the values on
 * earlier pages something to be read against.
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
        caption="Disease Pattern Gates — ACDC classification criteria"
        columns={["Gate", "Criterion"]}
        rows={[
          ["NOR (LV)", "EF > 50%, wall thickness < 12 mm, EDVI < 90 mL/m² (men) / < 80 mL/m² (women)."],
          ["NOR (RV)", "RVEDVI < 100 mL/m², RVEF > 40%."],
          ["MINF", "EF < 40% and ≥1 LV segment with moderate/severe regional contraction abnormality."],
          ["DCM", "EF < 40%, EDVI > 100 mL/m², wall thickness < 12.28 mm."],
          ["HCM", "EF > 55%, wall thickness > 15 mm. LVMI is informational only, not a defining criterion."],
          ["RV (ARV)", "RVEDVI > 110 mL/m² (men) / > 100 mL/m² (women), or RVEF < 40%. The ARVC/PAH notes below are a separate secondary check."],
        ]}
        cite={
          <>
            Bernard O, Lalande A, Zotti C, et al. <em>IEEE Trans Med Imaging</em>. 2018;37(11):2514–2525,
            Section II.A.1 — the paper that defines the ACDC dataset&apos;s diagnostic groups. DCM&apos;s wall
            thickness bound is widened from 12 mm to 12.28 mm, the union with this project&apos;s own
            ground-truth- and system-derived ranges (see tables below). &ldquo;Abnormal myocardial
            contractions&rdquo; (MINF) has no numeric definition in the source literature — see Methodology for
            how this project operationalises it.
          </>
        }
      />

      <RefTable
        caption="HCM's cardiac-mass index (LVMI) — informational only, not a gating criterion"
        columns={["Feature", "Value", "Role"]}
        rows={[
          ["LVMI", "> 110 g/m²", "Shown for information only when available — never decides whether the HCM gate is met"],
        ]}
        cite={<>Bernard et al. 2018 (above): LVMI above 110 g/m² is noted as an incidental finding in some HCM patients, not a defining criterion — not used in any gate&apos;s met/not-met decision.</>}
      />

      <RefTable
        caption="RV gate severity sub-note — ARVC, 2010 Revised Task Force Criteria (CMR)"
        columns={["Criterion", "Major", "Minor"]}
        rows={[
          ["RVEDVI, male", "≥ 110 mL/m²", "100 – <110 mL/m²"],
          ["RVEDVI, female", "≥ 100 mL/m²", "90 – <100 mL/m²"],
          ["RVEF", "≤ 40%", "40 – 45%"],
        ]}
        cite={<>te Riele, Tandri &amp; Bluemke, <em>J Cardiovasc Magn Reson</em> 2014;16:50, Table 1. Also requires a regional RV wall-motion abnormality, which this pipeline does not assess.</>}
      />

      <RefTable
        caption="RV gate severity sub-note — PAH-associated RV dysfunction, 2022 ESC/ERS Guidelines (cMRI)"
        columns={["Measure", "Lower risk", "Intermediate", "Higher risk"]}
        rows={[
          ["RVEF", "> 54%", "37 – 54%", "< 37%"],
          ["SVI", "> 40 mL/m²", "26 – 40 mL/m²", "< 26 mL/m²"],
          ["RVESVI", "< 42 mL/m²", "42 – 54 mL/m²", "> 54 mL/m²"],
        ]}
        cite={<>Humbert et al., <em>Eur Respir J</em> 2023;61:2200879, Table 16 (cMRI row).</>}
      />

      <RefTable
        caption="LV normal reference ranges — meta-analysis (LVMI only)"
        columns={["Measure", "Male", "Female"]}
        rows={[
          ["LVMI", "41 – 76 g/m²", "33 – 57 g/m²"],
        ]}
        cite={<>Zhan et al., <em>Circ Cardiovasc Imaging</em> 2024;17(2):e016090. ACDC&apos;s own paper states no LVMI number for NOR, so this general-population range covers LVMI only — EF and EDVI use Bernard et al. 2018&apos;s own ACDC numbers instead.</>}
      />

      <RefTable
        caption="NOR gate — the actual live reference range (union of all sources, both chambers)"
        columns={["Measure", "Male", "Female", "BSA: none (absolute equivalent)"]}
        rows={[
          ["EF", "50.0 – 72.93%", "50.0 – 72.93%", "N/A — ratio, not indexed"],
          ["EDVI", "47.54 – 95.35 mL/m²", "47.54 – 95.35 mL/m²", "86.4 – 173.4 mL (male ref) / 77.6 – 155.7 mL (female ref)"],
          ["LVMI", "36.94 – 76.0 g/m²", "33.0 – 75.0 g/m²", "67.2 – 138.2 g (male ref) / 53.9 – 122.5 g (female ref)"],
          ["Max wall thickness", "6.22 – 12.0 mm", "6.22 – 12.0 mm", "N/A — already absolute (mm)"],
          ["RVEDVI", "51.65 – 111.38 mL/m²", "51.65 – 111.38 mL/m²", "93.9 – 202.5 mL (male ref) / 84.3 – 181.9 mL (female ref)"],
          ["RVEF", "40.0 – 67.6%", "40.0 – 67.6%", "N/A — ratio, not indexed"],
        ]}
        cite={<>The actual numbers the live NOR gate uses: the union of Bernard et al. 2018 (first table, this page), this project&apos;s own ACDC ground-truth-derived range (n=20/group), and its deployed-model-derived range (n=10/group, post-QC). Absolute-equivalent figures use a reference-adult BSA (Mosteller: male 170cm/70kg ≈ 1.82 m²; female 160cm/60kg ≈ 1.63 m²), shown for reference only.</>}
      />

      <RefTable
        caption="This project's own pipeline validation — ACDC pilot cohort"
        columns={["Gate", "Feature", "Ground truth (n=20/group)", "This app's own pipeline, QC'd (n=10/group)", "Criterion used above"]}
        rows={[
          ["NOR", "EF / EDVI / LVMI / wall / RVEDVI / RVEF", "51.5–72.9 / 48.1–95.4 / 36.9–75.0 / 6.2–11.9 / 51.7–111.4 / 41.6–67.6", "51.8–65.1 / 47.5–84.9 / 37.4–75.0 / 6.6–11.4 / 52.0–108.3 / 43.1–66.8", "— (see live union range table above)"],
          ["MINF", "EF", "31.0%", "28.9%", "< 40%"],
          ["DCM", "EDVI / EF / wall", "153.3 mL/m² / 18.4% / 10.0 mm", "155.7 mL/m² / 16.2% / 11.0 mm", "> 100 mL/m² / < 40% / < 12.28 mm"],
          ["HCM", "wall / EF", "17.8 mm / 67.4%", "17.1 mm / 62.6%", "> 15 mm / > 55%"],
          ["HCM (informational)", "LVMI", "92.2 g/m²", "99.7 g/m²", "not gating — see note above"],
          ["RV (ARV)", "RVEDVI / RVEF", "111.9 mL/m² / 31.4%", "110.7 mL/m² / 27.0%", "> 110 (men) / > 100 (women) mL/m² or < 40%"],
        ]}
        cite={<>&ldquo;Ground truth&rdquo;: this pipeline run against ACDC&apos;s official masks, 100 patients. &ldquo;This app&apos;s own pipeline&rdquo;: its deployed UNet output after manual QC, a 50-patient subset. Shown as evidence the two agree — not a new threshold; MINF/DCM/HCM/RV&apos;s cutoffs stay Bernard et al. 2018&apos;s own fixed criteria.</>}
      />

      <RefTable
        caption="RV normal reference ranges — SCMR 2025"
        columns={["Measure", "Male", "Female"]}
        rows={[
          ["RVEF (lower limit of normal)", "≥ 44%", "≥ 47%"],
          ["RVEDVI", "47 – 116 mL/m²", "44 – 99 mL/m²"],
          ["RVESVI", "16 – 52 mL/m²", "13 – 43 mL/m²"],
        ]}
        cite={<>Kawel-Boehm et al., <em>J Cardiovasc Magn Reson</em> 2025;27:101853 — pooled healthy adults, 2.5th–97.5th percentiles.</>}
      />

      <RefTable
        caption="Gate severity sub-notes — cohort mean ± SD, shown only after a gate is met"
        columns={["Feature", "HCM cohort", "DCM cohort", "ARVC cohort (RV gate)"]}
        rows={[
          ["EF (%)", "59.0 ± 9.0", "29.0 ± 13.0", "—"],
          ["EDVI (mL/m²)", "94.0 ± 13.0", "132.0 ± 41.0", "—"],
          ["LVMI (g/m²)", "77.0 ± 12.0", "70.0 ± 21.0", "—"],
          ["RVEDVI (mL/m²)", "—", "—", "103 ± 26"],
          ["RVESVI (mL/m²)", "—", "—", "56 ± 23"],
          ["RVEF (%)", "—", "—", "46 ± 10"],
        ]}
        cite={<>Kübler et al., <em>Int J Cardiovasc Imaging</em> 2021;37:2501–2515. Shown only as context once a gate is already met — not used to decide whether it's met.</>}
      />

      <p className="mb-3 text-[8.5px] leading-snug text-gray-600">
        <strong>Informational only, not gating:</strong> Peak GRS/GCS (geometric mask deformation, not
        conventional strain). &ldquo;Several myocardial segments&rdquo; (MINF/HCM) has no published numeric
        definition — see Methodology.
      </p>

      <p className="mt-2 text-[8.5px] leading-snug text-gray-600">
        Published diagnostic criteria and risk ranges, for context alongside the values on earlier pages — not a
        standalone verdict.
      </p>
    </ReportPageFrame>
  );
}
