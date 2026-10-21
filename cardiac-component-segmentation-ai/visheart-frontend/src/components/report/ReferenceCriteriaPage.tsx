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
          ["NOR", "EF > 50%, wall thickness in diastole < 12 mm, EDVI < 90 mL/m² (men) / < 80 mL/m² (women), RVEDVI < 100 mL/m², RVEF > 40% — this project widens every bound to the union of these numbers with its own ACDC ground-truth-derived and deployed-model-derived ranges (see tables below)."],
          ["MINF", "LV ejection fraction < 40% and abnormal myocardial contractions (operationalised here as ≥1 LV segment at moderate/severe on regional strain — see Methodology)."],
          ["DCM", "LV ejection fraction < 40%, LV end-diastolic volume index > 100 mL/m², and wall thickness in diastole < 12 mm."],
          ["HCM", "Normal cardiac function (ejection fraction > 55%) with myocardial segments thicker than 15 mm in diastole. LVMI is NOT one of the defining criteria — see the note below."],
          ["RV (ARV)", "RV end-diastolic volume index > 110 mL/m² (men) / > 100 mL/m² (women), or RV ejection fraction < 40%. No specific disease is named for this group — the RV severity sub-notes below (ARVC/PAH) are a separate, secondary check."],
        ]}
        cite={
          <>
            Bernard O, Lalande A, Zotti C, et al. &ldquo;Deep Learning Techniques for Automatic MRI Cardiac
            Multi-Structures Segmentation and Diagnosis: Is the Problem Solved?&rdquo; <em>IEEE Trans Med
            Imaging</em>. 2018;37(11):2514–2525, Section II.A.1 &mdash; the paper that created and labelled the ACDC
            dataset, quoted directly. This project previously read these criteria from the ACDC Challenge website&apos;s
            own abbreviated summary instead (creatis.insa-lyon.fr/Challenge/acdc/databases.html); checked against the
            paper directly, two differences mattered enough to fix: the website omits DCM&apos;s wall-thickness bound,
            and reads HCM&apos;s cardiac-mass figure as a defining criterion when the paper&apos;s own wording (&ldquo;can
            present&rdquo;) makes it incidental, not required. &ldquo;Abnormal myocardial contractions&rdquo; (MINF) has
            no numeric definition in either source; this project does not invent one — see Methodology.
          </>
        }
      />

      <RefTable
        caption="HCM's cardiac-mass index (LVMI) — informational only, not a gating criterion"
        columns={["Feature", "Value", "Role"]}
        rows={[
          ["LVMI", "> 110 g/m²", "Shown for information only when available — never decides whether the HCM gate is met"],
        ]}
        cite={
          <>
            Bernard et al. 2018 (full citation above): &ldquo;patients can present abnormal cardiac mass indices
            with values above 110 g/m².&rdquo; &ldquo;Can present&rdquo; is the paper&apos;s own wording for an
            incidental finding in some patients — the same way it describes DCM patients sometimes also having a
            dilated RV, or MINF patients sometimes also having a high diastolic LV volume. None of these
            incidental findings are folded into any gate&apos;s met/not-met decision.
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
        caption="LV normal reference ranges — meta-analysis (LVMI only — EF/EDVI now use Bernard et al. 2018's own ACDC-specific numbers above)"
        columns={["Measure", "Male", "Female"]}
        rows={[
          ["LVMI", "41 – 76 g/m²", "33 – 57 g/m²"],
        ]}
        cite={
          <>
            Zhan et al., <em>Circ Cardiovasc Imaging</em> 2024;17(2):e016090. The ACDC dataset&apos;s own defining
            paper (Bernard et al. 2018, cited above) states no LVMI number for its NOR group, so this general
            adult-population meta-analysis remains the literature component for LVMI specifically. EF and EDVI no
            longer draw from this table at all — those two now use Bernard et al. 2018&apos;s own ACDC-specific NOR
            numbers (first table on this page) instead, which is a strictly better-grounded source for &ldquo;what
            does ACDC consider normal.&rdquo; Every bound is still widened to the union with this project&apos;s own
            ACDC-derived ranges below, so a genuinely-normal patient is never excluded purely from a difference in
            measurement convention between a literature source and this project&apos;s own pipeline.
          </>
        }
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
        cite={
          <>
            These are the actual numbers the live NOR gate compares a patient against, after unioning Bernard et al.
            2018&apos;s own ACDC NOR numbers (first table, this page), this project&apos;s own ACDC ground-truth-derived
            range (n=20/group), and this project&apos;s own deployed-model-derived range (n=10/group, post-manual-QC)
            — see compute_disease_pattern_gates.py&apos;s own module docstring for the full source list. EF, wall
            thickness, RVEDVI and RVEF come out identical for both sexes here: Bernard&apos;s sex split survives the
            union only where this project&apos;s own (necessarily pooled — ACDC&apos;s metadata carries no patient-sex
            field) empirical data doesn&apos;t already exceed it, which only holds for EDVI. Absolute-equivalent
            figures use the same reference-adult BSA this project&apos;s own DCM/HCM fallback already computes
            (Mosteller formula: male 170cm/70kg → BSA ≈ 1.82 m²; female 160cm/60kg → BSA ≈ 1.63 m²) — shown for
            reference only, since NOR has no coded absolute-value fallback in the live gate.
          </>
        }
      />

      <RefTable
        caption="This project's own pipeline validation — ACDC pilot cohort"
        columns={["Gate", "Feature", "Ground truth (n=20/group)", "This app's own pipeline, QC'd (n=10/group)", "Criterion used above"]}
        rows={[
          ["NOR", "EF / EDVI / LVMI / wall / RVEDVI / RVEF", "51.5–72.9 / 48.1–95.4 / 36.9–75.0 / 6.2–11.9 / 51.7–111.4 / 41.6–67.6", "51.8–65.1 / 47.5–84.9 / 37.4–75.0 / 6.6–11.4 / 52.0–108.3 / 43.1–66.8", "— (see live union range table above)"],
          ["MINF", "EF", "31.0%", "28.9%", "< 40%"],
          ["DCM", "EDVI / EF / wall", "153.3 mL/m² / 18.4% / 10.2 mm", "155.7 mL/m² / 16.2% / 11.2 mm", "> 100 mL/m² / < 40% / < 12 mm"],
          ["HCM", "wall / EF", "17.8 mm / 67.4%", "17.1 mm / 62.6%", "> 15 mm / > 55%"],
          ["HCM (informational)", "LVMI", "92.2 g/m²", "99.7 g/m²", "not gating — see note above"],
          ["RV (ARV)", "RVEDVI / RVEF", "111.9 mL/m² / 31.4%", "110.7 mL/m² / 27.0%", "> 110 (men) / > 100 (women) mL/m² or < 40%"],
        ]}
        cite={
          <>
            This project&apos;s own ACDC Challenge training-set pilot: &ldquo;Ground truth&rdquo; is this pipeline
            run against ACDC&apos;s official ground-truth segmentation masks, all 100 patients
            (scripts/derive_acdc_reference_ranges.py). &ldquo;This app&apos;s own pipeline&rdquo; is this app&apos;s
            deployed UNet segmentation model&apos;s output after manual QC/correction in the app, a 50-patient pilot
            subset (scripts/derive_system_reference_ranges.js). Shown as evidence that this app&apos;s own
            measurement pipeline agrees with the official ground truth for each gate&apos;s defining feature(s) —
            not a new threshold; MINF/DCM/HCM/RV&apos;s cutoffs are Bernard et al. 2018&apos;s own fixed criteria
            (first table, this page) and are not replaced by sample data. HCM&apos;s wall/EF averages both clear
            their own cutoffs in both measurements; its LVMI average sits below 110 g/m² in both too, which no
            longer matters for whether the gate is met (LVMI is informational only — see note above), unlike the
            earlier (now-corrected) version of this module that required it.
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
