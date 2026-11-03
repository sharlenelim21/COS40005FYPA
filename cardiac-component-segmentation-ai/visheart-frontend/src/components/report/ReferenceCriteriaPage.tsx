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
        caption="Disease Pattern Gates — ACDC Challenge classification criteria"
        columns={["Gate", "Criterion"]}
        rows={[
          ["NOR", "No criterion stated by ACDC — this project uses the LV normal reference ranges below instead."],
          ["MINF", "LV ejection fraction < 40% and several myocardial segments with abnormal contraction (operationalised here as ≥1 LV segment at moderate/severe on regional strain — see Methodology)."],
          ["DCM", "LV end-diastolic volume index > 100 mL/m² and LV ejection fraction < 40%."],
          ["HCM", "LV mass index > 110 g/m², maximum wall thickness > 15 mm in diastole, and preserved ejection fraction (≥ 50%)."],
          ["RV", "RV end-diastolic volume index > 110 mL/m² or RV ejection fraction < 40%. ACDC does not attribute a specific disease to this group — the RV severity sub-notes below (ARVC/PAH) are a separate, secondary check."],
        ]}
        cite={
          <>
            ACDC Challenge database documentation, creatis.insa-lyon.fr/Challenge/acdc/databases.html, quoted
            directly. "Several segments" is ACDC's own wording and is not numerically defined there or in the
            companion paper (Bernard et al., <em>IEEE Trans Med Imaging</em> 2018); this project does not invent a
            segment count for it — see Methodology for why.
          </>
        }
      />

      <RefTable
        caption="RV gate severity sub-note — ARVC, 2010 Revised Task Force Criteria (CMR)"
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
        caption="RV gate severity sub-note — PAH-associated RV dysfunction, 2022 ESC/ERS Guidelines (cMRI)"
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
            Zhan et al., <em>Circ Cardiovasc Imaging</em> 2024;17(2):e016090. The NOR gate on earlier pages does not
            use these numbers alone — it widens each bound to the union of this table and this project&apos;s own
            ACDC-derived ranges below, so a genuinely-normal patient is never excluded purely from a difference in
            measurement convention between this meta-analysis and this project&apos;s own pipeline.
          </>
        }
      />

      <RefTable
        caption="This project's own pipeline validation — ACDC pilot cohort"
        columns={["Gate", "Feature", "Ground truth (n=20/group)", "This app's own pipeline, QC'd (n=10/group)", "ACDC cutoff used above"]}
        rows={[
          ["NOR", "EF / EDVI / LVMI", "51.5–72.9% / 48.1–95.4 / 36.9–75.0", "51.8–65.1% / 47.5–84.9 / 37.4–75.0", "— (NOR has none; see note above)"],
          ["MINF", "EF", "31.0%", "28.9%", "< 40%"],
          ["DCM", "EDVI / EF", "153.3 mL/m² / 18.4%", "155.7 mL/m² / 16.2%", "> 100 mL/m² / < 40%"],
          ["HCM", "LVMI / wall thickness", "92.2 g/m² / 17.8 mm", "99.7 g/m² / 17.1 mm", "> 110 g/m² / > 15 mm"],
          ["RV", "RVEDVI / RVEF", "111.9 mL/m² / 31.4%", "110.7 mL/m² / 27.0%", "> 110 mL/m² or < 40%"],
        ]}
        cite={
          <>
            This project&apos;s own ACDC Challenge training-set pilot: &ldquo;Ground truth&rdquo; is this pipeline
            run against ACDC&apos;s official ground-truth segmentation masks, all 100 patients
            (scripts/derive_acdc_reference_ranges.py). &ldquo;This app&apos;s own pipeline&rdquo; is this app&apos;s
            deployed UNet segmentation model&apos;s output after manual QC/correction in the app, a 50-patient pilot
            subset (scripts/derive_system_reference_ranges.js). Shown as evidence that this app&apos;s own
            measurement pipeline agrees with the official ground truth for each gate&apos;s defining feature(s) —
            not a new threshold; MINF/DCM/HCM/RV&apos;s cutoffs are ACDC&apos;s own fixed criteria (above) and are
            not replaced by sample data. HCM&apos;s LVMI group average sits below the &gt;110 g/m² cutoff in both
            measurements — expected, since ACDC&apos;s HCM label is a clinical diagnosis and not every labelled
            patient individually clears every numeric ACDC criterion; the HCM gate still evaluates each
            patient&apos;s own measurements, never the group average.
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
        cite={
          <>
            Kübler et al., <em>Int J Cardiovasc Imaging</em> 2021;37:2501–2515 — HCM (n=14) and DCM (n=48) LV
            columns are Table 2; ARVC (n=18) RV column is Table 3. Not used to decide whether a gate is met (that
            uses the ACDC thresholds above directly) — shown here only to support the RV gate's "may be worth
            looking into ARVC" sub-note and, on the on-screen report, an optional severity read once the HCM/DCM/RV
            gate is already met.
          </>
        }
      />

      <p className="mb-3 text-[8.5px] leading-snug text-gray-600">
        <strong>Not part of any gate's met/not-met decision:</strong> Peak GRS/GCS are geometric mask-deformation
        measurements, not conventional CMR feature-tracking strain, and are displayed as informational values only.
        "Several myocardial segments" (MINF/HCM) is ACDC's own wording with no published numeric definition — see
        the Methodology page for how this project operationalises it without inventing an uncited number.
      </p>

      <p className="mt-2 text-[8.5px] leading-snug text-gray-600">
        These are published diagnostic criteria, published risk ranges, and the ACDC Challenge's own classification
        rules — not universal &ldquo;normal ranges&rdquo; — presented for context alongside the values on earlier
        pages, never as a standalone verdict.
      </p>
    </ReportPageFrame>
  );
}
