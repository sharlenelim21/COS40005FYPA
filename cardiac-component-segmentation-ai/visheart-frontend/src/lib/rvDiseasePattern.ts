/**
 * rvDiseasePattern.ts
 * ====================
 * Prototype RV "disease pattern similarity" scoring — the RV analogue of
 * compute_disease_similarity.py's NOR/HCM/DCM comparison, but rule-based
 * against published diagnostic-criteria/risk-stratification cutoffs rather
 * than a z-score distance to a cohort mean. Runs entirely client-side for
 * now (see caveats in each pattern's `notes`) — nothing here is persisted or
 * computed server-side.
 *
 * IMPORTANT — this is explicitly NOT a diagnostic probability. Every score is
 * this app's own 0-100 similarity metric, not a validated likelihood of
 * disease. Never render a score without ALSO rendering `disclaimer`.
 *
 * Sources (verified against the actual PDFs, not recalled from memory):
 * - ARVC major/minor CMR criteria: te Riele, Tandri, Bluemke. "Arrhythmogenic
 *   right ventricular cardiomyopathy (ARVC): cardiovascular magnetic
 *   resonance update." J Cardiovasc Magn Reson 2014;16:50, Table 1
 *   (adapted from the 2010 Revised Task Force Criteria, Marcus et al. 2010).
 * - PAH cMRI risk-stratification band: Humbert et al. "2022 ESC/ERS
 *   Guidelines for the diagnosis and treatment of pulmonary hypertension."
 *   Eur Respir J 2023;61:2200879, Table 16 (three-strata risk model).
 *   NOTE: Table 16 lists TWO different SVI cut-off sets — a cMRI-specific one
 *   (>40 / 26-40 / <26 mL/m^2) and a separate right-heart-catheterisation one
 *   (>38 / 31-38 / <31 mL/m^2). This module uses the cMRI band, matching our
 *   pipeline's data source.
 */

export type Sex = "male" | "female" | "unspecified";

/** Tri-state: true/false = actually assessed; null = not computed by this build yet. */
export type TriState = boolean | null;

export interface RvDiseasePatternInputs {
  /** RVEDV / BSA, mL/m^2 — null if BSA hasn't been entered. */
  rvedvi: number | null;
  /** RVESV / BSA, mL/m^2 — null if BSA hasn't been entered. */
  rvesvi: number | null;
  /** % */
  rvef: number | null;
  /** RV stroke volume / BSA, mL/m^2 — null if BSA hasn't been entered. */
  svi: number | null;
  sex: Sex;
  /**
   * TFC's required "regional RV akinesia, dyskinesia, or dyssynchronous
   * contraction" gate. This pipeline does not yet compute a per-segment RV
   * contraction classifier (needs the RV cavity-area bullseye + a regional
   * classifier module, mirroring compute_regional_health_status.py) — pass
   * `null` until that exists. `null` is NOT treated as "absent"; it's
   * surfaced as "not yet assessed" and excluded from the score rather than
   * silently counted either way.
   */
  regionalContractionAbnormal: TriState;
  /**
   * Supplementary geometric signal (RV boundary-area / boundary-length
   * change across the cycle) — NOT a TFC criterion, no validated cutoff
   * exists for it (per te Riele et al., no paper validates a GAS-specific
   * threshold), so it only ever contributes a small bonus, never a
   * major/minor determination. `null` until the GAS module exists.
   */
  gasAbnormal: TriState;
}

export interface ScoreFactor {
  label: string;
  /** Whether this factor is currently counted in the score. */
  status: "met" | "not-met" | "pending";
  detail: string;
}

export interface RvDiseasePatternResult {
  code: "ARVC" | "PAH" | "GENERAL";
  label: string;
  /** 0-100 — this app's own computational similarity score, NOT a probability. */
  score: number;
  factors: ScoreFactor[];
  /** Present on every result — render this next to every score, no exceptions. */
  disclaimer: string;
  /** Citation shown under the pattern. */
  reference: string;
}

const NON_DIAGNOSTIC_DISCLAIMER =
  "This is a computational similarity score produced by this app's own rule-based scoring, " +
  "not a validated diagnostic probability. It must be interpreted by a qualified clinician " +
  "alongside the full clinical picture.";

function edviBand(rvedvi: number | null, sex: Sex): "major" | "minor" | "none" | "unknown" {
  if (rvedvi == null) return "unknown";
  if (sex === "male") {
    if (rvedvi >= 110) return "major";
    if (rvedvi >= 100) return "minor";
    return "none";
  }
  if (sex === "female") {
    if (rvedvi >= 100) return "major";
    if (rvedvi >= 90) return "minor";
    return "none";
  }
  // Sex not specified — TFC's cutoffs are sex-specific and we don't collect
  // sex today, so we can only say "unknown" rather than silently picking one.
  return "unknown";
}

function efBandArvc(rvef: number | null): "major" | "minor" | "none" | "unknown" {
  if (rvef == null) return "unknown";
  if (rvef <= 40) return "major";
  if (rvef <= 45) return "minor";
  return "none";
}

/** ARVC-like RV pattern — Task Force Criteria structural/functional axis. */
function scoreArvc(inputs: RvDiseasePatternInputs): RvDiseasePatternResult {
  const factors: ScoreFactor[] = [];
  let points = 0;

  const edvi = edviBand(inputs.rvedvi, inputs.sex);
  const ef = efBandArvc(inputs.rvef);
  // TFC combines RVEDVI and RVEF with OR — take whichever band is worse.
  const rank = { major: 2, minor: 1, none: 0, unknown: -1 } as const;
  const best = rank[edvi] >= rank[ef] ? edvi : ef;

  if (inputs.rvedvi == null && inputs.rvef == null) {
    factors.push({ label: "Structural/functional criterion", status: "pending", detail: "Need RVEDVI (enter BSA above) or RVEF." });
  } else if (inputs.sex === "unspecified" && inputs.rvedvi != null && inputs.rvef == null) {
    factors.push({ label: "RVEDVI", status: "pending", detail: `RVEDVI is sex-specific — select male/female above to evaluate ${inputs.rvedvi.toFixed(1)} mL/m².` });
  } else {
    if (best === "major") { points += 60; factors.push({ label: "Structural/functional criterion", status: "met", detail: rank[edvi] > rank[ef] ? `RVEDVI ${inputs.rvedvi?.toFixed(1)} mL/m² meets the major threshold.` : `RVEF ${inputs.rvef?.toFixed(1)}% meets the major threshold (≤40%).` }); }
    else if (best === "minor") { points += 30; factors.push({ label: "Structural/functional criterion", status: "met", detail: rank[edvi] > rank[ef] ? `RVEDVI ${inputs.rvedvi?.toFixed(1)} mL/m² is in the minor range.` : `RVEF ${inputs.rvef?.toFixed(1)}% is in the minor range (40-45%).` }); }
    else if (best === "none") { factors.push({ label: "Structural/functional criterion", status: "not-met", detail: "RVEDVI and RVEF both within the published reference range." }); }
    else { factors.push({ label: "Structural/functional criterion", status: "pending", detail: "Sex not specified — RVEDVI cutoffs are sex-specific." }); }
  }

  if (inputs.regionalContractionAbnormal === true) {
    points += 25;
    factors.push({ label: "Regional RV contraction abnormality", status: "met", detail: "Required by the TFC criterion alongside the structural axis above." });
  } else if (inputs.regionalContractionAbnormal === false) {
    factors.push({ label: "Regional RV contraction abnormality", status: "not-met", detail: "Assessed as not present." });
  } else {
    factors.push({ label: "Regional RV contraction abnormality", status: "pending", detail: "Not yet computed by this build — needs the RV regional-FAC bullseye + classifier. The TFC criterion cannot be formally confirmed without this, regardless of the score below." });
  }

  if (inputs.gasAbnormal === true) {
    points += 15;
    factors.push({ label: "RV GAS (supplementary, not a TFC criterion)", status: "met", detail: "Geometric change pattern flagged as abnormal." });
  } else if (inputs.gasAbnormal === false) {
    factors.push({ label: "RV GAS (supplementary, not a TFC criterion)", status: "not-met", detail: "Geometric change pattern within the observed range." });
  } else {
    factors.push({ label: "RV GAS (supplementary, not a TFC criterion)", status: "pending", detail: "Not yet computed by this build." });
  }

  return {
    code: "ARVC",
    label: "ARVC-like RV pattern",
    score: Math.max(0, Math.min(100, points)),
    factors,
    disclaimer: NON_DIAGNOSTIC_DISCLAIMER,
    reference: "te Riele, Tandri & Bluemke, J Cardiovasc Magn Reson 2014;16:50 (Table 1, adapted from the 2010 Revised Task Force Criteria)",
  };
}

function threeBand(v: number | null, lowRiskAbove: number, highRiskBelow: number, higherIsWorse: boolean) {
  if (v == null) return "unknown" as const;
  if (higherIsWorse) {
    if (v >= lowRiskAbove) return "high" as const;
    if (v < highRiskBelow) return "low" as const;
    return "mid" as const;
  }
  if (v > lowRiskAbove) return "low" as const;
  if (v < highRiskBelow) return "high" as const;
  return "mid" as const;
}

/** PAH-associated RV dysfunction pattern — ESC/ERS 2022 cMRI risk strata. */
function scorePah(inputs: RvDiseasePatternInputs): RvDiseasePatternResult {
  const factors: ScoreFactor[] = [];
  let points = 0;

  const efBand = threeBand(inputs.rvef, 54, 37, false); // >54 low, 37-54 mid, <37 high
  if (efBand === "unknown") factors.push({ label: "RVEF", status: "pending", detail: "RVEF not available." });
  else {
    const add = efBand === "high" ? 40 : efBand === "mid" ? 20 : 0;
    points += add;
    factors.push({ label: "RVEF", status: efBand === "low" ? "not-met" : "met", detail: `RVEF ${inputs.rvef?.toFixed(1)}% — ${efBand === "high" ? "higher-risk range (<37%)" : efBand === "mid" ? "intermediate range (37-54%)" : "lower-risk range (>54%)"}.` });
  }

  const sviBand = threeBand(inputs.svi, 40, 26, false); // >40 low, 26-40 mid, <26 high
  if (sviBand === "unknown") factors.push({ label: "Stroke Volume Index (SVI)", status: "pending", detail: "Need BSA (enter above) to compute SVI." });
  else {
    const add = sviBand === "high" ? 35 : sviBand === "mid" ? 18 : 0;
    points += add;
    factors.push({ label: "Stroke Volume Index (SVI)", status: sviBand === "low" ? "not-met" : "met", detail: `SVI ${inputs.svi?.toFixed(1)} mL/m² — ${sviBand === "high" ? "higher-risk range (<26)" : sviBand === "mid" ? "intermediate range (26-40)" : "lower-risk range (>40)"}.` });
  }

  const esviBand = threeBand(inputs.rvesvi, 54, 42, true); // >54 high, 42-54 mid, <42 low
  if (esviBand === "unknown") factors.push({ label: "RVESVI", status: "pending", detail: "Need BSA (enter above) to compute RVESVI." });
  else {
    const add = esviBand === "high" ? 25 : esviBand === "mid" ? 12 : 0;
    points += add;
    factors.push({ label: "RVESVI", status: esviBand === "low" ? "not-met" : "met", detail: `RVESVI ${inputs.rvesvi?.toFixed(1)} mL/m² — ${esviBand === "high" ? "higher-risk range (>54)" : esviBand === "mid" ? "intermediate range (42-54)" : "lower-risk range (<42)"}.` });
  }

  return {
    code: "PAH",
    label: "PAH-associated RV dysfunction pattern",
    score: Math.max(0, Math.min(100, points)),
    factors,
    disclaimer: NON_DIAGNOSTIC_DISCLAIMER +
      " These bands are PAH risk-stratification cutoffs (prognosis in already-diagnosed PAH), not a way to diagnose PAH from imaging alone.",
    reference: "Humbert et al., Eur Respir J 2023;61:2200879 (2022 ESC/ERS PH Guidelines, Table 16, cMRI row)",
  };
}

/** Catch-all — abnormal RV that doesn't strongly match either named pattern. */
function scoreGeneral(inputs: RvDiseasePatternInputs, arvc: number, pah: number): RvDiseasePatternResult {
  const factors: ScoreFactor[] = [];
  let points = 0;

  if (inputs.rvef != null) {
    if (inputs.rvef < 45) { points += 40; factors.push({ label: "RVEF", status: "met", detail: `RVEF ${inputs.rvef.toFixed(1)}% is reduced.` }); }
    else factors.push({ label: "RVEF", status: "not-met", detail: "RVEF not reduced." });
  } else factors.push({ label: "RVEF", status: "pending", detail: "Not available." });

  if (inputs.rvesvi != null) {
    if (inputs.rvesvi > 54) { points += 30; factors.push({ label: "RVESVI", status: "met", detail: `RVESVI ${inputs.rvesvi.toFixed(1)} mL/m² is enlarged.` }); }
    else factors.push({ label: "RVESVI", status: "not-met", detail: "RVESVI not enlarged." });
  } else factors.push({ label: "RVESVI", status: "pending", detail: "Need BSA to compute." });

  if (inputs.gasAbnormal === true) { points += 30; factors.push({ label: "RV GAS", status: "met", detail: "Geometric change pattern abnormal." }); }
  else if (inputs.gasAbnormal === false) factors.push({ label: "RV GAS", status: "not-met", detail: "Within the observed range." });
  else factors.push({ label: "RV GAS", status: "pending", detail: "Not yet computed by this build." });

  // Downweight General whenever a named pattern already scores clearly higher —
  // this bucket exists for the case that DOESN'T fit ARVC or PAH well, not to
  // compete with them once one already stands out.
  const dominant = Math.max(arvc, pah);
  const score = dominant >= 50 ? Math.round(points * 0.5) : points;

  return {
    code: "GENERAL",
    label: "General RV dysfunction pattern",
    score: Math.max(0, Math.min(100, score)),
    factors,
    disclaimer: NON_DIAGNOSTIC_DISCLAIMER,
    reference: "Project heuristic — not tied to a single published criterion; catches abnormal RV profiles that don't clearly match ARVC or PAH.",
  };
}

export function computeRvDiseasePatterns(inputs: RvDiseasePatternInputs): RvDiseasePatternResult[] {
  const arvc = scoreArvc(inputs);
  const pah = scorePah(inputs);
  const general = scoreGeneral(inputs, arvc.score, pah.score);
  return [arvc, pah, general];
}
