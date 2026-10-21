"""
compute_disease_pattern_gates.py
=================================
Unified LV+RV Disease Pattern Similarity Assessment, replacing the earlier
separate LV-only z-score module (compute_disease_similarity.py) and the
frontend-only RV ARVC/PAH scoring (rvDiseasePattern.ts). NOT a diagnostic tool
— see DISCLAIMER below, present on every output.

Why this replaces the old design
----------------------------------
The previous LV module ranked NOR/HCM/DCM with a single weighted z-score
distance + softmax, all three profiles scored in the SAME feature space
(EF/EDVI/ESVI/LVMI). The RV module lived entirely separately (frontend TS),
scoring ARVC/PAH/GENERAL in RV's own feature space (RVEDVI/RVEF/SVI/RVESVI)
with its own 0-100 heuristic scores. Merging RV into the LV softmax as a 5th
profile is NOT statistically sound: a profile scored on 2 features (RV) isn't
comparable to one scored on 4 (LV) in the same softmax, and whichever profile
has fewer/narrower features looks artificially closer, corrupting what the
percentages are supposed to mean.

Fix: drop the single-winner % ranking entirely. Each of ACDC's 5 diagnostic
groups becomes its own independent GATE (met / not-met / pending), matching
what ACDC's own criteria actually are: independent threshold rules, not 5
mutually-exclusive regions of one shared space. A patient can meet zero, one,
or more than one gate (e.g. a dilated LV AND an abnormal RV at once) — ACDC's
training labels are mutually exclusive by curation choice (each patient
assigned to exactly one of the 5 groups), but the underlying criteria
themselves are not mathematically exclusive, so forcing a single "most
similar" pick would misrepresent a patient who genuinely has two independent
findings.

Source of the 5 gate criteria — Bernard et al. 2018, IEEE Trans Med Imaging
37(11):2514-2525 (doi:10.1109/TMI.2018.2837502), Section II.A.1 "Patient
selection" — the actual peer-reviewed paper that created and labelled the
ACDC dataset's 150 patients, quoted/paraphrased directly. This REPLACES an
earlier version of this module that read criteria from the ACDC Challenge
website's own abbreviated summary page instead — checked against the paper
directly, 2026-10, and found to differ in two places that matter (see NOR and
HCM below):
    NOR  : "ejection fraction ... greater than 50%", "wall thickness in
           diastole ... lower than 12 mm", "LV diastolic volume ... below
           90 mL/m2 for men and 80 mL/m2 for women", RV normal for every
           patient ("RV volume less than 100 mL/m2 and RV ejection fraction
           above 40%"). The website's own summary states no NOR criterion at
           all ("30 normal subjects") — the paper itself does define one, in
           full, for BOTH chambers. See NOR gate below for how this module
           uses it.
    MINF : "ejection fraction of the left ventricle lower than 40% and
           abnormal myocardial contractions."
    DCM  : "ejection fraction below 40%, a LV volume greater than 100 mL/m2
           and a wall thickness in diastole smaller than 12 mm." The website
           summary omits the wall-thickness bound; the paper states it as a
           defining criterion, not an aside.
    HCM  : "a normal cardiac function (ejection fraction greater than 55%)
           but with myocardial segments thicker than 15 mm in diastole."
           Cardiac mass (LVMI) is explicitly NOT one of the defining
           criteria here — the paper's own wording is that patients "CAN
           PRESENT abnormal cardiac mass indices... above 110 g/m2," an
           incidental finding in some patients, phrased the same way as
           DCM's/MINF's own incidental co-occurring findings below. The
           website summary reads this the opposite way (cardiac mass as a
           defining AND condition) — this module now follows the paper.
    ARV  : "RV volume greater than 110 mL/m2 for men, and greater than
           100 mL/m2 for women, or/and a RV ejection fraction below 40%."
           The paper attributes no specific named disease to this group;
           it is defined only by this sex-specific volume/function
           threshold. See the RV gate's own notes for how this module still
           gives the user something actionable beyond a bare "abnormal"
           flag.

Three "incidental, not defining" findings the paper explicitly separates from
each group's actual criteria (worded as "some patients..."/"can present..."
in the paper itself, never folded into this module's met/not-met logic):
MINF patients sometimes also have a high diastolic LV volume from
compensatory remodelling (why MINF+DCM can legitimately co-fire — see
"Co-firing LV gates" below); DCM patients sometimes also have a dilated RV
and/or high LV mass; HCM patients sometimes also have LVMI above 110 g/m^2
(shown in this module as an informational note only, see _gate_hcm).

"Abnormal myocardial contractions" (MINF) and "several myocardial segments"
(an earlier, now-superseded reading of HCM's criterion) — neither the paper
nor the Challenge website defines a number. Checked against the actual
clinical literature before picking a design here (not guessed): a CMR study
diagnosing HCM (Int J Cardiovasc Imaging 2021/HFpEF-HCM comparison
literature) uses a SINGLE maximal wall-thickness value (LVMWT >= 15mm, or
>=13mm with family history), never a segment count; a wall-motion-abnormality
detection study explicitly scores a region positive from ANY ONE abnormal
segment, "irrespective of the number of AHA segments involved." Real clinical
practice does not appear to use a segment-count threshold — so this module
doesn't invent one either: HCM reads off the single existing
MaxWallThicknessMm value (already computed elsewhere in this pipeline), and
MINF reads off whether AT LEAST ONE LV segment reaches "moderate" or "severe"
on compute_regional_health_status.py's existing classification. No
fabricated N.

NOR gate — covers BOTH chambers (an earlier version of this gate checked LV
features only, which could misleadingly read as "the whole heart is normal"
when the RV was never actually assessed — reported live, 2026-10). Every
bound is the union of THREE independent sources: Bernard et al. 2018's own
NOR numbers above (replacing an earlier version of this module that used
Zhan et al. 2024, a general adult population meta-analysis with no
ACDC-specific grounding, as its literature source — the dataset's own
defining paper is strictly better-grounded for "what does ACDC consider
NOR"), this project's own ACDC-ground-truth-derived ranges, and this
project's own deployed-model (UNet + manual QC) derived ranges — see
_ADULT_NORMAL_RANGES/_NOR_RV_RANGES below for the full source list and why
all three, checked as a genuine range comparison (all of EF/EDVI/LVMI/wall/
RVEDVI/RVEF within range), not a single cutoff. LVMI has no number in the
paper, so its literature component is still Zhan et al. 2024.

HCM's "normal cardiac function" — the paper's own number is EF > 55%
(_HCM_EF_MIN), replacing an earlier version of this module that borrowed a
">=50%" preserved-EF convention from unrelated CMR-HCM literature instead of
using ACDC's own defining paper.

DCM/HCM reference-BSA fallback — EDVI (DCM) and LVMI (HCM, informational
only — see above) normally need the patient's own BSA, which needs
height+weight the user may not have entered. Rather than leaving DCM
permanently "pending" (or LVMI's informational note permanently blank)
whenever BSA is missing, both now fall back to estimating EDVI/LVMI from the
(BSA-independent) absolute EDV/LVMassG divided by a REFERENCE adult BSA — the
same height/weight "reference man"/"reference woman" behind the ~1.73 m^2
constant still used to normalise clinical indices today (e.g. eGFR,
mL/min/1.73m^2; DuBois & DuBois 1916, Arch Intern Med 17:863-871) — run
through this app's own Mosteller formula rather than DuBois's, for internal
consistency with every other BSA figure in this app. Used ONLY as a last
resort when the real bsa_m2 wasn't supplied; the gate's `reasons` text always
says explicitly when a value was estimated this way, so a report reader is
never left thinking it came from the patient's own measurements.
"unspecified" sex falls back to the male reference (170cm/70kg) for this
fallback, and to the male RVEDVI threshold for the RV/ARV gate (see
_RV_EDVI_MIN_BY_SEX); the other 2 gates (NOR, MINF) do NOT use the BSA
fallback — NOR already degrades gracefully per-feature, MINF doesn't need
EDVI/LVMI at all.

Co-firing LV gates (e.g. MINF+DCM) — a patient can legitimately meet more
than one LV gate at once. This is not a bug: the ACDC paper's own MINF
description says "some subjects have a high diastolic LV volume due to a
remodeling of the LV to compensate for the myocardial infarction" — i.e. a
real MINF patient can also clear DCM's EDVI>100 threshold. The four LV gates'
underlying numbers (EF/EDVI/LVMI/wall thickness) alone cannot fully separate
"low EF from an old infarct" from "low EF from idiopathic dilation" — that
distinction normally needs LGE imaging or clinical history, neither of which
this pipeline has. Rather than silently leave two co-fired gates looking
equally weighted, each gate (except RV — see below) carries an internal
"margin" built ONLY from that gate's DISTINGUISHING criterion — the part its
co-firing counterpart does NOT also require — never from a criterion they
share. MINF and DCM both require EF<40%, so EF is deliberately EXCLUDED from
both margins: MINF's margin is the fraction of assessed segments that are
abnormal (its own distinguishing criterion), DCM's is its EDVI excess past
100 (its own distinguishing criterion). An earlier version folded EF into
both (DCM's as min(EDVI margin, EF margin)), which made DCM's margin
structurally incapable of ever exceeding MINF's — DCM's EF term was a hard
upper bound on its own score, so a textbook severely-dilated DCM patient
still lost the ranking to MINF purely because of that shared term (reported
live, 2026-10: ground-truth DCM patient ranked MINF as Primary match).
Dropping the shared term fixes this by construction. When 2+ non-RV gates
are met, the one with the largest margin is tagged rank_label="Primary
match", the rest "Also meets". The margin itself is NEVER exposed in the
output — only the plain rank label — specifically to avoid relapsing into
the old single-score design's problem of implying a diagnostic confidence/
probability. RV is excluded from this ranking entirely: comparing an RV gate
(RVEDVI/RVEF) against an LV gate (EF/EDVI/LVMI/wall) on one normalised scale
is exactly the apples-to-oranges comparison the whole gate-based redesign was
built to avoid (see "Why this replaces the old design" above) — RV simply
has no rank_label, ever.

RV gate severity layering (NOT part of the met/not-met call, advisory only,
added only when the gate IS met) — three independent pieces, deliberately
kept separate rather than blended into one number, so none of them can bias
the others:
  1. PRIMARY, disease-agnostic: RV/LV volume ratio (RVEDV/LVEDV, absolute
     volumes — BSA cancels out of a ratio, so this works even without a
     patient BSA) against ACDC's OWN RV-group statistics, computed directly
     from the ACDC dataset's real group labels by Chen et al. 2025 ("PULSE":
     arXiv:2512.03848, Table 1, "ACDC dataset cohort characteristics derived
     from ground truth segmentation masks"): RV group ratio 2.00 +/- 0.69,
     NOR group ratio 1.17 +/- 0.11 (same population the RV gate's own
     criterion is drawn from, not any single named disease's cohort).
  2. SECONDARY, named-pattern note: Kubler et al. 2021's ARVC cohort (n=18)
     RV measurements (Int J Cardiovasc Imaging 2021;37:2501-2515, Table 3) —
     RVEDVI 103+/-26 mL/m2, RVESVI 56+/-23 mL/m2, RVEF 46+/-10%. The SAME
     paper already used for this module's HCM/DCM gates, now also covering
     the RV side, so the methodology section only needs to defend one
     reference instead of hunting for a second, unrelated RV-specific paper.
  3. SECONDARY, named-pattern note: PAH risk-stratification bands (Humbert
     et al. 2023, 2022 ESC/ERS PH Guidelines, Eur Respir J 2023;61:2200879,
     Table 16, cMRI row) — ported directly from the old rvDiseasePattern.ts,
     unchanged thresholds.
  Deliberately NOT blended into the gate's met/not-met decision or into each
  other — a patient's RV gate can be met with NEITHER secondary note firing
  (plain "abnormal RV, unspecified pattern" — ACDC itself attributes no
  disease to this group), and the primary ratio read is always shown
  regardless of whether either secondary note fires, so a user is never
  pushed toward reading "abnormal RV" as "probably ARVC" just because that
  happens to be the only secondary reference available.

Volume-reliability guard — every other grader in this directory
(compute_health_status.py, compute_rv_health_status.py) already withholds
absolute-volume evidence when volume_reliability.py flags the affine/voxel
geometry as suspicious (bad voxel_mm3, implausible LVEDV, a duplicated
cavity slice) — this module did NOT, until a live report surfaced it
(2026-10): a mask with LVEDV=6.9 mL and LV mass=5.4 g (both ~20-30x below a
plausible adult heart, the same mask's own Health Status panel already
showing "Low confidence... Absolute volume measurements may be unreliable")
still had its NOR/DCM/HCM gates confidently report EDVI/LVMI as "outside the
normal range," presenting a known-corrupted number as if it were real
evidence. Fixed by reusing the exact same volume_reliability helpers the
other graders use: when lv_volume_issues(...) finds a problem, EDV/EDVI and
LVMassG/LVMI are excluded from NOR/DCM/HCM (falls back to whatever of
EF/wall-thickness/regional-segments is still available, same graceful
degradation as a missing BSA) rather than compared as if trustworthy; when
voxel_size_issue/duplicate_slice_issue (RV cavity) find a problem, RVEDV/
RVEDVI/RVESVI/SVI are excluded from the RV gate and severity notes the same
way, leaving RVEF (a ratio, not scale-dependent like EF is for LV). Each
affected gate gets a plain-text reason explaining the exclusion, and a
top-level warning lists the underlying issue(s), so this is visible, never a
silent gap.

I/O contract (mirrors every sibling module in this directory)
---------------------------------------------------------------
Read one JSON object from stdin, write one JSON object to stdout. Non-
recoverable errors print {"error": "..."} and sys.exit(1).

Input (stdin JSON):
    lv  — {
        EF: float|null,                 # LV ejection fraction, %
        EDV: float|null,                # LV end-diastolic volume, mL (absolute)
        EDVI: float|null,                # EDV / BSA, mL/m^2 — null if no BSA
        LVMassG: float|null,             # LV myocardial mass, g
        LVMI: float|null,                # LVMassG / BSA, g/m^2 — null if no BSA
        MaxWallThicknessMm: float|null,  # max per-AHA-segment ED wall thickness
    }
    rv  — {
        RVEDV: float|null,               # RV end-diastolic volume, mL (absolute)
        RVEDVI: float|null,              # RVEDV / BSA, mL/m^2 — null if no BSA
        RVESVI: float|null,
        RVEF: float|null,
        SVI: float|null,                 # RV stroke volume / BSA, mL/m^2
    }
    regional_lv_segments — list[{segment:int, level:str}]|null
        From compute_regional_health_status.py's own output (level is one of
        "normal"/"mild"/"moderate"/"severe"). Used only for the MINF gate's
        "at least one abnormal segment" check. null/absent -> MINF's regional
        check is "pending", not "not-met".
    sex? — "male" | "female" | "unspecified" (default "unspecified")
    volume_signals? — { voxel_mm3: float|null, duplicate_slices: list|null }
        Same structured fields compute_health_status.py/compute_rv_health_
        status.py already take — see "Volume-reliability guard" above. A
        caller that omits this keeps the previous (less safe) behaviour of
        trusting EDVI/LVMI/RVEDVI/RVESVI/SVI at face value.

Output (stdout JSON):
    gates — [{code, label, met: true|false|null, reasons: list[str],
               criterion_text: str, validation_note: str|None, rank_label:
               "Primary match"|"Also meets"|null}], one entry per ACDC group,
               IN ORDER NOR, MINF, DCM, HCM, RV. met is None/null when there
               isn't enough data to decide (pending) — a caller MUST NOT
               treat null as False. validation_note is present on MINF/DCM/
               HCM/RV (null/absent on NOR, whose own criterion_text already
               names its 3 sources) — a static, dataset-level pipeline-
               accuracy note (ground-truth-derived vs. this app's own
               deployed-model-derived stats for that gate's feature(s), see
               _PILOT_VALIDATION_NOTES), NOT derived from this one patient
               and NOT a new threshold — these 4 gates' cutoffs are ACDC's
               own fixed criteria and are never replaced by sample data.
               rank_label is set only when 2+ non-RV gates are met at once
               (e.g. MINF+DCM — see "Co-firing LV gates" below); otherwise
               null. It is a plain label, never a number — there is no
               underlying percentage to surface.
    met_codes — list[str], the codes with met == true (order preserved)
    rv_severity — null when the RV gate isn't met; otherwise
        {ratio_note: str, arvc_note: str|null, pah_note: str|null,
         generic_note: str|null} — see "RV gate severity layering" above.
    disclaimer — fixed non-diagnostic disclaimer string
    method — short method identifier for audit
    reference_source — "ACDC Challenge classification criteria (creatis.insa-
                        lyon.fr/Challenge/acdc/databases.html) + published
                        literature for gates ACDC itself leaves undefined"
    warnings — list[str]

Pure Python. No numpy/scipy — every check here is a direct comparison or a
simple (x-mean)/sd, no matrix work needed.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Optional

from volume_reliability import duplicate_slice_issue, lv_volume_issues, voxel_size_issue

# RV cavity class for duplicate_slice_issue — same value compute_rv_health_status.py uses.
_RV_CAVITY_CLASS = "rv"


# ── ACDC's own thresholds — now read from Bernard et al. 2018 (IEEE TMI), the
# actual peer-reviewed paper that defines the ACDC Challenge dataset and
# labelled its own 150 patients, rather than paraphrased from the Challenge's
# own abbreviated website page (which omits several things this paper states
# explicitly — see below). Full citation: Bernard O, Lalande A, Zotti C, et
# al. "Deep Learning Techniques for Automatic MRI Cardiac Multi-Structures
# Segmentation and Diagnosis: Is the Problem Solved?" IEEE Trans Med Imaging.
# 2018;37(11):2514-2525. doi:10.1109/TMI.2018.2837502, Section II.A.1
# "Patient selection" — quoted/paraphrased directly from the paper's own
# per-group definitions. Two corrections this made to the previous (website-
# only) version of this module, found by checking the paper directly
# (reported live, 2026-10):
#   - DCM's definition explicitly includes a wall-thickness upper bound ("a
#     wall thickness in diastole smaller than 12 mm") that the website
#     summary omits — added below as _DCM_WALL_MM_MAX.
#   - HCM's cardiac-mass criterion ("LVMI > 110 g/m^2") is NOT one of HCM's
#     defining criteria in the paper — the paper's own wording is "patients
#     CAN PRESENT abnormal cardiac mass indices," an incidental finding in
#     some patients, not a requirement. The paper's actual HCM definition is
#     only "normal cardiac function (EF > 55%) but with myocardial segments
#     thicker than 15mm" — LVMI is demoted to an informational note (see
#     _gate_hcm) rather than a gating AND condition, and HCM's EF threshold
#     moves from this module's earlier ">=50%" (a borrowed preserved-EF
#     clinical convention, not from ACDC at all) to the paper's own ">55%".
_MINF_EF_MAX = 40.0
_DCM_EDVI_MIN = 100.0
_DCM_EF_MAX = 40.0
_DCM_WALL_MM_MAX = 12.0  # Bernard et al. 2018 — distinguishes DCM's thin-ish wall from HCM's thickened one
_HCM_WALL_MM_MIN = 15.0
_HCM_EF_MIN = 55.0  # Bernard et al. 2018's own HCM threshold (was a borrowed ">=50%" preserved-EF convention)
_HCM_LVMI_INFORMATIONAL = 110.0  # NOT gating — see comment above; "can present" values above this, per the paper
# ARV (abnormal RV) — Bernard et al. 2018's own sex-specific RV volume split,
# which the previous (website-paraphrased) version of this module did not
# have at all (one unsplit 110 mL/m^2 for both sexes). "unspecified" sex
# falls back to the male (more lenient/higher) threshold — same convention
# the DCM/HCM reference-BSA fallback already uses elsewhere in this module.
_RV_EDVI_MIN_BY_SEX: dict[str, float] = {"male": 110.0, "female": 100.0}
_RV_EF_MAX = 40.0

# NOR gate: unlike MINF/DCM/HCM/RV above, this module's NOR profile is NOT a
# single threshold — Bernard et al. 2018 DOES define explicit NOR numbers
# (unlike what this module previously assumed from the Challenge website
# alone, which states no NOR criterion at all), but every bound in this
# module is still widened to the UNION of THREE independent sources, so a
# patient only fails NOR if ALL THREE would call them abnormal:
#   1. Bernard et al. 2018 (see full citation above), Section II.A.1 — the
#      ACDC dataset's own defining NOR numbers: EF > 50%, wall thickness in
#      diastole < 12mm, EDVI < 90 mL/m^2 (men) / < 80 mL/m^2 (women), RVEDVI
#      < 100 mL/m^2, RVEF > 40%. Replaces Zhan et al. 2024 (a general adult
#      population meta-analysis with no ACDC-specific grounding) as this
#      module's literature source for EF/EDVI/wall/RV — the dataset's own
#      defining paper is a strictly better-grounded source than an unrelated
#      general-population study for "what does ACDC consider NOR." LVMI is
#      the one NOR feature this paper does not define a number for, so its
#      literature component still comes from Zhan et al. 2024 there.
#   2. Ground-truth-derived: this project's OWN measurement pipeline
#      (compute_heart_metrics_from_rle.py + compute_bullseye_from_rle.py,
#      called unmodified) run against the ACDC Challenge training set's own
#      20 ground-truth-LABELLED NOR patients — scripts/derive_acdc_reference_
#      ranges.py, n=20/group, all 100 patients. Isolates this project's own
#      measurement CONVENTION (LV mass formula, voxel counting, etc.) from
#      segmentation-model accuracy, since it's fed hand-annotated masks.
#   3. System-derived: this project's OWN deployed segmentation model (UNet)
#      output, after manual QC/correction in the app — scripts/derive_system_
#      reference_ranges.js, n=10/group (50 of 100 patients) as of 2026-10.
#      What source #2 can't capture: the model + correction workflow's own
#      measured output, as a real user would actually get it.
# A real limitation worth being upfront about: sources #2 and #3 are POOLED
# (ACDC's own metadata carries no patient-sex field at all — checked live,
# 2026-10 — so this project's own measurement pipeline can never be split by
# sex). Wherever the pooled empirical max/min from #2 or #3 is wider than
# Bernard's sex-specific bound, the union is dominated by the pooled number
# and the male/female split effectively collapses for that bound (most
# visibly: NOR's EDVI upper bound comes out identical for both sexes, 95.35,
# because source #2's own pooled max already exceeds Bernard's narrower
# female cap of 80). This is an honest consequence of the union design
# (favour the widest bound, same rule as everywhere else in this module), not
# a bug — Table in the project's own reference documentation shows exactly
# which bounds this affects.
# All three sources are still treated as approximate 95% CIs (+/-2 SD) when
# the mean/SD form is needed elsewhere — same convention the old module used,
# see _range_to_mean_sd (kept here for RV's ARVC-note z-scores).
_ADULT_NORMAL_RANGES: dict[str, dict[str, tuple[float, float]]] = {
    "male":   {"EF": (50.0, 72.93), "EDVI": (47.54, 95.35), "LVMI": (36.94, 76.0), "MaxWallThicknessMm": (6.22, 12.0)},
    "female": {"EF": (50.0, 72.93), "EDVI": (47.54, 95.35), "LVMI": (33.0, 75.0),  "MaxWallThicknessMm": (6.22, 12.0)},
}
# NOR's RV criteria (NEW — the previous version of this gate checked LV
# features only, which could misleadingly look like "the whole heart is
# normal" when only the LV half was actually assessed). No sex split in
# Bernard's own NOR definition (unlike ARV below, which the paper does split
# by sex) — union of source #1 (Bernard) + #2 (GT) + #3 (system):
_NOR_RV_RANGES: dict[str, tuple[float, float]] = {
    "RVEDVI": (51.65, 111.38),  # Bernard's own <100 cap is absorbed here: source #2's pooled NOR-group max (111.38) already exceeds it
    "RVEF": (40.0, 67.6),
}

# Pilot pipeline-validation notes for MINF/DCM/HCM/RV (these 4 gates use
# ACDC's own fixed cutoffs verbatim and are NOT derived from any sample — see
# _ADULT_NORMAL_RANGES above for why NOR is the one gate that DOES derive a
# range). Instead of a range, these 4 get a VALIDATION note: a static,
# dataset-level comparison of this project's ACDC ground-truth-derived stats
# (source #2 above, n=20/group, scripts/derive_acdc_reference_ranges.py)
# against this project's own deployed-model (UNet + manual QC) derived stats
# (source #3 above, n=10/group as of 2026-10, scripts/derive_system_
# reference_ranges.js) for each gate's defining feature(s) — evidence that
# this app's own measurement pipeline agrees with the official ground truth,
# not a new threshold source. Re-derive and update this dict's text whenever
# either pilot script is re-run with more patients or the measurement
# pipeline itself changes; it is NOT computed live from any one patient.
_PILOT_VALIDATION_NOTES: dict[str, str] = {
    "MINF": (
        "Pipeline validation: ACDC's own 20 ground-truth-labelled MINF patients averaged EF 31.0% "
        "(ground-truth masks) vs 28.9% measured by this app's own segmentation model after manual "
        "QC/correction (n=10 of those 20) — both clearly below the 40% cutoff above, confirming this "
        "app's own measurement pipeline agrees with the official ground truth for this criterion."
    ),
    "DCM": (
        "Pipeline validation: ACDC's own 20 ground-truth-labelled DCM patients averaged EDVI 153.3 mL/m^2 "
        "and EF 18.4% (ground-truth masks) vs 155.7 mL/m^2 and 16.2% measured by this app's own "
        "segmentation model after manual QC/correction (n=10 of those 20) — both clearly past the "
        ">100 mL/m^2 / <40% cutoffs above, confirming agreement with the official ground truth."
    ),
    "HCM": (
        "Pipeline validation: ACDC's own 20 ground-truth-labelled HCM patients averaged LVMI 92.2 g/m^2 "
        "and wall thickness 17.8 mm (ground-truth masks) vs 99.7 g/m^2 and 17.1 mm measured by this "
        "app's own segmentation model after manual QC/correction (n=10 of those 20) — confirming "
        "agreement with the official ground truth for this criterion. (The group AVERAGE LVMI sits "
        "below the >110 g/m^2 cutoff in both measurements — expected, since ACDC's HCM label is a "
        "clinical diagnosis and not every labelled patient individually clears every numeric ACDC "
        "criterion; this gate still evaluates each patient's own measurements, not the group average.)"
    ),
    "RV": (
        "Pipeline validation: ACDC's own 20 ground-truth-labelled RV patients averaged RVEDVI 111.9 mL/m^2 "
        "and RVEF 31.4% (ground-truth masks) vs 110.7 mL/m^2 and 27.0% measured by this app's own "
        "segmentation model after manual QC/correction (n=10 of those 20) — both clearly past the "
        ">110 mL/m^2 / <40% cutoffs above, confirming agreement with the official ground truth."
    ),
}

# Reference-adult BSA fallback for the DCM and HCM gates ONLY, used solely
# when the patient's own bsa_m2 (hence EDVI/LVMI) wasn't supplied but the
# absolute EDV/LVMassG were still computed (BSA-independent). Height/weight
# pairs approximate the "reference man"/"reference woman" behind the ~1.73
# m^2 BSA constant still used to normalise clinical indices today (e.g. eGFR,
# mL/min/1.73m^2) — DuBois & DuBois 1916, Arch Intern Med 17:863-871. Run
# through the SAME Mosteller formula this app already uses for real patient
# BSA (see report/page.tsx), not DuBois's own formula, for internal
# consistency. "unspecified" sex falls back to the male reference.
_REFERENCE_ADULT_HW_CM_KG: dict[str, tuple[float, float]] = {
    "male": (170.0, 70.0),
    "female": (160.0, 60.0),
}


def _mosteller_bsa(height_cm: float, weight_kg: float) -> float:
    return math.sqrt(height_cm * weight_kg / 3600.0)


def _reference_bsa(sex: str) -> float:
    height_cm, weight_kg = _REFERENCE_ADULT_HW_CM_KG.get(sex, _REFERENCE_ADULT_HW_CM_KG["male"])
    return _mosteller_bsa(height_cm, weight_kg)


# RV gate severity references — see module docstring "RV gate severity
# layering" for full provenance.
_ACDC_RV_LV_RATIO = (2.00, 0.69)   # PULSE (arXiv:2512.03848) Table 1, RV group, n=30
_ACDC_NOR_RV_LV_RATIO = (1.17, 0.11)  # same table, NOR group, n=30
_ARVC_RVEDVI = (103.0, 26.0)       # Kubler et al. 2021, Table 3, ARVC n=18
_ARVC_RVESVI = (56.0, 23.0)
_ARVC_RVEF = (46.0, 10.0)
# How close (in |z|, averaged across whichever of RVEDVI/RVESVI/RVEF are
# available) a patient needs to be to the ARVC cohort mean before the ARVC
# note fires. PROJECT HEURISTIC (not literature-derived) — 1.5 SD mirrors the
# "within range" latitude the old LV module used elsewhere for similar calls.
_ARVC_NOTE_MAX_MEAN_ABS_Z = 1.5

_DISCLAIMER = (
    "This is a research-based pattern-similarity screen, not a validated disease "
    "likelihood or a diagnosis. Each gate below reports only whether the available "
    "measurements meet a published classification criterion (primarily the ACDC "
    "Challenge dataset's own grouping rules) — meeting a gate does not confirm that "
    "condition, and not meeting any gate does not exclude disease. Interpretation by "
    "a qualified clinician, using the full clinical picture, is required."
)

_REFERENCE_SOURCE = (
    "Bernard O, Lalande A, Zotti C, et al. 'Deep Learning Techniques for Automatic MRI "
    "Cardiac Multi-Structures Segmentation and Diagnosis: Is the Problem Solved?' IEEE Trans "
    "Med Imaging. 2018;37(11):2514-2525 (doi:10.1109/TMI.2018.2837502), Section II.A.1 — the "
    "ACDC dataset's own defining paper, read directly, for MINF/DCM/HCM/ARV's criteria and "
    "NOR's own published numbers. NOR gate: union of this paper's NOR numbers; this project's "
    "own measurement of the ACDC Challenge training set's 20 ground-truth NOR patients "
    "(scripts/derive_acdc_reference_ranges.py); and this project's own deployed segmentation "
    "model's output after manual QC/correction, 10 NOR patients (scripts/derive_system_"
    "reference_ranges.js). LVMI has no number in the paper, so its NOR/HCM literature "
    "component is still Zhan et al. 2024, Circulation: Cardiovascular Imaging "
    "2024;17(2):e016090 (HCM: informational only, not gating — see module docstring). RV "
    "severity secondary note: Kubler et al. 2021, Int J Cardiovasc Imaging 2021;37:2501-2515 "
    "(doi:10.1007/s10554-021-02280-6). RV primary severity note: Chen et al. 2025 "
    "'PULSE' (arXiv:2512.03848), Table 1, ACDC ground-truth per-group statistics. "
    "RV PAH secondary note: Humbert et al. 2023, Eur Respir J 2023;61:2200879 "
    "(2022 ESC/ERS PH Guidelines, Table 16, cMRI row). DCM/HCM reference-BSA "
    "fallback (used only when the patient's own BSA is missing): DuBois & "
    "DuBois 1916, Arch Intern Med 17:863-871."
)


def _safe_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def _range_to_mean_sd(lo: float, hi: float) -> tuple[float, float]:
    return (lo + hi) / 2.0, (hi - lo) / 4.0


def _pooled_range(feature: str) -> tuple[float, float]:
    m_lo, m_hi = _ADULT_NORMAL_RANGES["male"][feature]
    f_lo, f_hi = _ADULT_NORMAL_RANGES["female"][feature]
    return min(m_lo, f_lo), max(m_hi, f_hi)


def _within_range(v: float, lo: float, hi: float) -> bool:
    return lo <= v <= hi


# ── NOR gate ─────────────────────────────────────────────────────────────────
# Checks BOTH chambers now (previously LV features only) — Bernard et al.
# 2018's own NOR definition requires a normal RV too ("The RV is normal for
# each patient"), and reporting NOR from LV alone could misleadingly read as
# "the whole heart is normal" when the RV was never actually assessed
# (reported live, 2026-10).
_NOR_CRITERION_TEXT = (
    "Bernard et al. 2018 (ACDC's own defining paper): EF > 50%, wall thickness in diastole < 12mm, "
    "EDVI < 90 mL/m^2 (men) / < 80 mL/m^2 (women), RVEDVI < 100 mL/m^2, RVEF > 40% — this module widens "
    "every bound to the union of that paper, this project's own ACDC-ground-truth-derived ranges, and "
    "this project's own deployed-model (UNet, manually QC'd) derived ranges (LVMI has no number in the "
    "paper, so its literature component is still Zhan et al. 2024's meta-analysis)."
)


def _gate_nor(lv: dict, rv: dict, sex: str) -> dict:
    lv_features = (("EF", "EF"), ("EDVI", "EDVI"), ("LVMI", "LVMI"), ("MaxWallThicknessMm", "Wall thickness"))
    rv_features = (("RVEDVI", "RVEDVI"), ("RVEF", "RVEF"))
    have = [f for f, _ in lv_features if lv.get(f) is not None] + [f for f, _ in rv_features if rv.get(f) is not None]
    if not have:
        return {"code": "NOR", "label": "NOR (Normal)", "met": None,
                "reasons": ["No EF, EDVI, LVMI, wall thickness, RVEDVI, or RVEF available to assess."],
                "criterion_text": _NOR_CRITERION_TEXT}

    table = _ADULT_NORMAL_RANGES.get(sex)
    reasons: list[str] = []
    all_in_range = True
    checked_any = False
    for feature, label in lv_features:
        v = lv.get(feature)
        if v is None:
            continue
        lo, hi = table[feature] if table else _pooled_range(feature)
        checked_any = True
        in_range = _within_range(v, lo, hi)
        all_in_range = all_in_range and in_range
        reasons.append(
            f"{label} {v:.1f} is {'within' if in_range else 'outside'} the normal range "
            f"({lo:.2f}-{hi:.2f}{', pooled' if not table else ''})."
        )
    for feature, label in rv_features:
        v = rv.get(feature)
        if v is None:
            continue
        lo, hi = _NOR_RV_RANGES[feature]
        checked_any = True
        in_range = _within_range(v, lo, hi)
        all_in_range = all_in_range and in_range
        reasons.append(f"{label} {v:.1f} is {'within' if in_range else 'outside'} the normal range ({lo:.2f}-{hi:.2f}).")
    met = all_in_range if checked_any else None
    return {"code": "NOR", "label": "NOR (Normal)", "met": met, "reasons": reasons, "criterion_text": _NOR_CRITERION_TEXT}


# ── MINF gate ────────────────────────────────────────────────────────────────
def _gate_minf(lv: dict, regional_segments: Optional[list]) -> dict:
    ef = lv.get("EF")
    reasons: list[str] = []

    if ef is None:
        ef_met: Optional[bool] = None
        reasons.append("EF not available.")
    else:
        ef_met = ef < _MINF_EF_MAX
        reasons.append(f"EF {ef:.1f}% {'meets' if ef_met else 'does not meet'} the < {_MINF_EF_MAX:.0f}% criterion.")

    if regional_segments is None:
        regional_met: Optional[bool] = None
        reasons.append("No regional (per-segment) contraction assessment available — run the regional health status check to assess this part of the criterion.")
    else:
        abnormal = [s for s in regional_segments if s.get("level") in ("moderate", "severe")]
        regional_met = len(abnormal) >= 1
        reasons.append(
            f"{len(abnormal)} of {len(regional_segments)} LV segment(s) show moderate/severe contraction abnormality "
            f"({'meets' if regional_met else 'does not meet'} the 'abnormal regional contraction' part of the criterion)."
        )

    # Three-valued AND: a criterion that's definitely False already decides the
    # whole AND, regardless of whatever the still-missing one turns out to be —
    # don't sit on "Pending" when the answer is already known (reported live,
    # 2026-10: a mask with EF already failing MINF's <40% criterion still showed
    # "Pending" whenever the regional-segment assessment hadn't been run, even
    # though no regional result could ever flip an already-failed AND to true).
    resolved_from_partial_data = False
    if ef_met is False or regional_met is False:
        met = False
        if ef_met is None or regional_met is None:
            resolved_from_partial_data = True
            reasons.append("Resolved as not met from the available criterion alone — the still-missing one can't change an AND that already fails.")
    elif ef_met is None or regional_met is None:
        met = None
    else:
        met = True
    # Ranking margin uses MINF's DISTINGUISHING criterion only (fraction of
    # assessed segments that are abnormal) — NOT EF, which DCM shares. EF
    # being in both gates' margins made DCM's min() structurally incapable of
    # ever beating MINF's margin (DCM's EF term is a hard upper bound on its
    # own score) — see "Co-firing LV gates" above.
    margin = (len(abnormal) / len(regional_segments)) if regional_segments else None
    result = {"code": "MINF", "label": "MINF (Systolic Heart Failure with Infarction)", "met": met, "reasons": reasons,
              "criterion_text": f"ACDC: EF < {_MINF_EF_MAX:.0f}% and several myocardial segments with abnormal contraction (operationalised here as >=1 segment at moderate/severe — see module docstring for why no fixed count is used).",
              "validation_note": _PILOT_VALIDATION_NOTES["MINF"],
              "_margin": margin}
    if resolved_from_partial_data:
        result["resolved_from_partial_data"] = True
    return result


# ── DCM gate ─────────────────────────────────────────────────────────────────
def _gate_dcm(lv: dict, sex: str) -> dict:
    ef, wall = lv.get("EF"), lv.get("MaxWallThicknessMm")
    edvi, edvi_estimated = lv.get("EDVI"), False
    if edvi is None and lv.get("EDV") is not None:
        edvi = lv["EDV"] / _reference_bsa(sex)
        edvi_estimated = True

    criterion_text = (
        f"Bernard et al. 2018: EDVI > {_DCM_EDVI_MIN:.0f} mL/m^2, EF < {_DCM_EF_MAX:.0f}%, "
        f"and wall thickness in diastole < {_DCM_WALL_MM_MAX:.0f} mm."
    )
    edvi_met = (edvi > _DCM_EDVI_MIN) if edvi is not None else None
    ef_met = (ef < _DCM_EF_MAX) if ef is not None else None
    wall_met = (wall < _DCM_WALL_MM_MAX) if wall is not None else None

    reasons: list[str] = []
    if edvi is not None:
        edvi_reason = f"EDVI {edvi:.1f} mL/m^2 {'meets' if edvi_met else 'does not meet'} the > {_DCM_EDVI_MIN:.0f} mL/m^2 criterion."
        if edvi_estimated:
            edvi_reason += (
                f" Estimated from EDV using a reference adult BSA ({_reference_bsa(sex):.2f} m^2) — "
                "this patient's own height/weight/BSA was not supplied, so treat this part with extra "
                "caution and supply BSA for an accurate value."
            )
        reasons.append(edvi_reason)
    else:
        reasons.append("EDVI (and EDV, to estimate it) not available.")
    if ef is not None:
        reasons.append(f"EF {ef:.1f}% {'meets' if ef_met else 'does not meet'} the < {_DCM_EF_MAX:.0f}% criterion.")
    else:
        reasons.append("EF not available.")
    if wall is not None:
        reasons.append(f"Max wall thickness {wall:.1f} mm {'meets' if wall_met else 'does not meet'} the < {_DCM_WALL_MM_MAX:.0f} mm criterion.")
    else:
        reasons.append("MaxWallThicknessMm not available.")

    # Three-valued AND across all three criteria — see MINF's identical
    # comment above: any one criterion already False decides the whole AND
    # regardless of whichever other is still missing. Reported live,
    # 2026-10: a mask with EF 56.3% (already failing DCM's <40% half) still
    # showed DCM as "Pending" because EDVI had been withheld by the volume-
    # reliability guard, even though no EDVI value could ever have made this
    # AND true once EF alone had already failed it.
    parts = (edvi_met, ef_met, wall_met)
    resolved_from_partial_data = False
    if any(p is False for p in parts):
        met = False
        if any(p is None for p in parts):
            resolved_from_partial_data = True
            reasons.append("Resolved as not met from the available criteria alone — the still-missing one(s) can't change an AND that already fails.")
    elif any(p is None for p in parts):
        met = None
    else:
        met = True

    # Ranking margin uses DCM's DISTINGUISHING criterion only (EDVI excess) —
    # NOT EF (shared with MINF) and NOT wall thickness (not a distinguishing
    # strength signal — a thinner wall doesn't make DCM "more" DCM the way a
    # bigger EDVI excess does); see MINF's margin comment above for why
    # blending in a shared/non-distinguishing term structurally favoured
    # MINF every time.
    result = {"code": "DCM", "label": "DCM (Dilated Cardiomyopathy)", "met": met, "reasons": reasons,
              "criterion_text": criterion_text,
              "validation_note": _PILOT_VALIDATION_NOTES["DCM"]}
    if edvi is not None:
        result["_margin"] = (edvi - _DCM_EDVI_MIN) / _DCM_EDVI_MIN
    if resolved_from_partial_data:
        result["resolved_from_partial_data"] = True
    return result


# ── HCM gate ─────────────────────────────────────────────────────────────────
def _gate_hcm(lv: dict, sex: str) -> dict:
    wall, ef = lv.get("MaxWallThicknessMm"), lv.get("EF")
    lvmi, lvmi_estimated = lv.get("LVMI"), False
    if lvmi is None and lv.get("LVMassG") is not None:
        lvmi = lv["LVMassG"] / _reference_bsa(sex)
        lvmi_estimated = True

    criterion_text = (
        f"Bernard et al. 2018: normal cardiac function (EF > {_HCM_EF_MIN:.0f}%) with myocardial segments "
        f"thicker than {_HCM_WALL_MM_MIN:.0f} mm in diastole. LVMI is NOT one of the paper's defining "
        f"criteria — it says patients 'can present' LVMI above {_HCM_LVMI_INFORMATIONAL:.0f} g/m^2, an "
        "incidental finding in some patients, not a requirement — so it's shown below for information only "
        "and never decides whether this gate is met."
    )
    wall_met = (wall > _HCM_WALL_MM_MIN) if wall is not None else None
    ef_met = (ef > _HCM_EF_MIN) if ef is not None else None
    lvmi_high = (lvmi > _HCM_LVMI_INFORMATIONAL) if lvmi is not None else None

    reasons: list[str] = []
    if wall is not None:
        reasons.append(f"Max wall thickness {wall:.1f} mm {'meets' if wall_met else 'does not meet'} the > {_HCM_WALL_MM_MIN:.0f} mm criterion.")
    else:
        reasons.append("MaxWallThicknessMm not available.")
    if ef is not None:
        reasons.append(f"EF {ef:.1f}% {'meets' if ef_met else 'does not meet'} the > {_HCM_EF_MIN:.0f}% criterion.")
    else:
        reasons.append("EF not available.")
    if lvmi is not None:
        lvmi_reason = (
            f"LVMI {lvmi:.1f} g/m^2 is {'above' if lvmi_high else 'at or below'} {_HCM_LVMI_INFORMATIONAL:.0f} g/m^2 "
            "(informational only — not part of this gate's criteria, see above)."
        )
        if lvmi_estimated:
            lvmi_reason += (
                f" Estimated from LV mass using a reference adult BSA ({_reference_bsa(sex):.2f} m^2) — "
                "this patient's own height/weight/BSA was not supplied, so treat this part with extra caution."
            )
        reasons.append(lvmi_reason)
    else:
        reasons.append("LVMI (and LVMassG, to estimate it) not available — informational only, does not affect this gate.")

    # Three-valued AND across the two REQUIRED criteria only (wall, EF) — see
    # MINF's identical comment above for the general rule: any one of them
    # already being False settles the whole AND, no matter which is missing.
    # LVMI is deliberately excluded from this decision (see criterion_text).
    parts = (wall_met, ef_met)
    resolved_from_partial_data = False
    if any(p is False for p in parts):
        met = False
        if any(p is None for p in parts):
            resolved_from_partial_data = True
            reasons.append("Resolved as not met from the available criterion alone — the still-missing one can't change an AND that already fails.")
    elif any(p is None for p in parts):
        met = None
    else:
        met = True

    result = {"code": "HCM", "label": "HCM (Hypertrophic Cardiomyopathy)", "met": met, "reasons": reasons,
              "criterion_text": criterion_text, "validation_note": _PILOT_VALIDATION_NOTES["HCM"]}
    if wall is not None and ef is not None:
        # Margin uses only the two criteria that actually gate "met" (wall, EF)
        # — LVMI no longer gates met-ness, so it no longer gates the margin
        # either; keeping it in would rank patients by a criterion the paper
        # itself says is incidental, not defining.
        result["_margin"] = min(
            (wall - _HCM_WALL_MM_MIN) / _HCM_WALL_MM_MIN,
            (ef - _HCM_EF_MIN) / _HCM_EF_MIN,
        )
    if resolved_from_partial_data:
        result["resolved_from_partial_data"] = True
    return result


# ── RV gate ──────────────────────────────────────────────────────────────────
def _gate_rv(rv: dict, sex: str) -> dict:
    rvedvi, rvef = rv.get("RVEDVI"), rv.get("RVEF")
    rv_edvi_min = _RV_EDVI_MIN_BY_SEX.get(sex, _RV_EDVI_MIN_BY_SEX["male"])
    criterion_text = (
        f"Bernard et al. 2018 (ARV): RVEDVI > {_RV_EDVI_MIN_BY_SEX['male']:.0f} mL/m^2 (men) / "
        f"> {_RV_EDVI_MIN_BY_SEX['female']:.0f} mL/m^2 (women) or RVEF < {_RV_EF_MAX:.0f}%. "
        "The paper attributes no specific named disease to this group."
    )
    if rvedvi is None and rvef is None:
        return {"code": "RV", "label": "RV (Abnormal Right Ventricle)", "met": None,
                "reasons": ["RVEDVI and RVEF not available."], "criterion_text": criterion_text,
                "validation_note": _PILOT_VALIDATION_NOTES["RV"]}

    edvi_met = (rvedvi > rv_edvi_min) if rvedvi is not None else None
    ef_met = (rvef < _RV_EF_MAX) if rvef is not None else None
    reasons: list[str] = []
    if rvedvi is not None:
        sex_note = "male/unspecified threshold" if sex != "female" else "female threshold"
        reasons.append(f"RVEDVI {rvedvi:.1f} mL/m^2 {'meets' if edvi_met else 'does not meet'} the > {rv_edvi_min:.0f} mL/m^2 criterion ({sex_note}).")
    else:
        reasons.append("RVEDVI not available (need BSA).")
    if rvef is not None:
        reasons.append(f"RVEF {rvef:.1f}% {'meets' if ef_met else 'does not meet'} the < {_RV_EF_MAX:.0f}% criterion.")
    else:
        reasons.append("RVEF not available.")

    # Three-valued OR: `bool(None) or bool(False)` used to collapse to False,
    # which wrongly resolved "not met" whenever the AVAILABLE criterion failed
    # but the MISSING one was never actually checked — the missing side could
    # still have been true, which this module has no way to rule out. An OR
    # only resolves to False once BOTH sides are confirmed False; with exactly
    # one side still unknown and the known side False, the honest answer is
    # Pending, not Not met.
    resolved_from_partial_data = False
    if edvi_met is True or ef_met is True:
        met = True
        if edvi_met is None or ef_met is None:
            resolved_from_partial_data = True
            reasons.append("Resolved as met from the available criterion alone — an OR only needs one side true.")
    elif edvi_met is None or ef_met is None:
        met = None
        reasons.append("Cannot resolve to 'not met' yet — the still-missing value could still meet its own criterion (this is an OR).")
    else:
        met = False

    result = {"code": "RV", "label": "RV (Abnormal Right Ventricle)", "met": met, "reasons": reasons, "criterion_text": criterion_text,
              "validation_note": _PILOT_VALIDATION_NOTES["RV"]}
    if resolved_from_partial_data:
        result["resolved_from_partial_data"] = True
    return result


def _rv_severity(rv: dict, lv: dict) -> Optional[dict]:
    """Advisory-only layering for the RV gate, built ONLY when that gate is
    met — see module docstring 'RV gate severity layering' for why these three
    notes are kept independent rather than combined into one score."""
    rv_edv, lv_edv = rv.get("RVEDV"), lv.get("EDV")
    ratio_note: str
    if rv_edv is not None and lv_edv not in (None, 0):
        ratio = rv_edv / lv_edv
        acdc_mu, acdc_sd = _ACDC_RV_LV_RATIO
        nor_mu, _ = _ACDC_NOR_RV_LV_RATIO
        z = (ratio - acdc_mu) / acdc_sd if acdc_sd > 1e-6 else 0.0
        ratio_note = (
            f"RV/LV volume ratio {ratio:.2f} — "
            f"{'above' if ratio > nor_mu else 'at or below'} ACDC's own normal-group average ({nor_mu:.2f}), "
            f"and {'within' if abs(z) <= 1.0 else 'outside'} one SD of ACDC's own abnormal-RV-group average "
            f"({acdc_mu:.2f} +/- {acdc_sd:.2f}) — this is a disease-agnostic volumetric comparison, not tied to any named condition."
        )
    else:
        ratio_note = "RV/LV volume ratio not available (need both RV and LV end-diastolic volumes)."

    arvc_note: Optional[str] = None
    rvedvi, rvesvi, rvef = rv.get("RVEDVI"), rv.get("RVESVI"), rv.get("RVEF")
    zs = []
    for v, (mu, sd) in ((rvedvi, _ARVC_RVEDVI), (rvesvi, _ARVC_RVESVI), (rvef, _ARVC_RVEF)):
        if v is not None:
            zs.append((v - mu) / sd)
    if zs:
        mean_abs_z = sum(abs(z) for z in zs) / len(zs)
        if mean_abs_z <= _ARVC_NOTE_MAX_MEAN_ABS_Z:
            arvc_note = (
                "RV measurements sit close to a published ARVC cohort's own range "
                f"(Kubler et al. 2021: RVEDVI {_ARVC_RVEDVI[0]:.0f}+/-{_ARVC_RVEDVI[1]:.0f}, "
                f"RVESVI {_ARVC_RVESVI[0]:.0f}+/-{_ARVC_RVESVI[1]:.0f} mL/m^2, "
                f"RVEF {_ARVC_RVEF[0]:.0f}+/-{_ARVC_RVEF[1]:.0f}%) — may be worth looking into ARVC specifically."
            )

    pah_note: Optional[str] = None
    svi = rv.get("SVI")
    high_risk_hits = []
    if rvef is not None and rvef < 37.0:
        high_risk_hits.append(f"RVEF {rvef:.1f}% (<37%)")
    if svi is not None and svi < 26.0:
        high_risk_hits.append(f"SVI {svi:.1f} mL/m^2 (<26)")
    if rvesvi is not None and rvesvi > 54.0:
        high_risk_hits.append(f"RVESVI {rvesvi:.1f} mL/m^2 (>54)")
    if high_risk_hits:
        pah_note = (
            "One or more values fall in the higher-risk band of the ESC/ERS 2022 PAH cMRI risk-stratification model "
            f"(Humbert et al. 2023): {', '.join(high_risk_hits)} — may be worth looking into PAH-associated RV dysfunction. "
            "Note: this is a prognostic risk band for already-diagnosed PAH, not a way to diagnose PAH from imaging alone."
        )

    generic_note: Optional[str] = None
    if arvc_note is None and pah_note is None:
        generic_note = "Does not specifically match the ARVC or PAH reference patterns above — ACDC does not attribute a specific disease to this group."

    return {"ratio_note": ratio_note, "arvc_note": arvc_note, "pah_note": pah_note, "generic_note": generic_note}


def compute_gates(
    lv: dict,
    rv: dict,
    regional_lv_segments: Optional[list],
    sex: str = "unspecified",
    volume_signals: Optional[dict] = None,
) -> dict:
    sex = sex if sex in ("male", "female") else "unspecified"
    warnings: list[str] = []

    # Volume-reliability guard — see module docstring. A bad affine/voxel
    # geometry corrupts every ABSOLUTE volume/mass (EDV, LVMassG, RVEDV) and
    # therefore every value indexed from them (EDVI, LVMI, RVEDVI, RVESVI,
    # SVI) — but NOT a true ratio like EF/RVEF, where the same scaling error
    # cancels out of numerator and denominator. Exclude the former, keep the
    # latter, exactly like compute_health_status.py / compute_rv_health_
    # status.py already do for their own evidence.
    vs = volume_signals or {}
    voxel_mm3 = vs.get("voxel_mm3")
    dup_slices = vs.get("duplicate_slices")
    lv_issues = lv_volume_issues(voxel_mm3, lv.get("EDV"), dup_slices)
    rv_issues = [r for r in (
        voxel_size_issue(voxel_mm3),
        duplicate_slice_issue(dup_slices, _RV_CAVITY_CLASS, "RV cavity"),
    ) if r]

    lv_for_gates = dict(lv)
    if lv_issues:
        lv_for_gates["EDV"] = None
        lv_for_gates["EDVI"] = None
        lv_for_gates["LVMassG"] = None
        lv_for_gates["LVMI"] = None
        warnings.append(
            "Absolute LV volumes flagged unreliable (" + "; ".join(lv_issues) + ") — "
            "EDVI/LVMI excluded from the NOR/DCM/HCM gates below."
        )

    rv_for_gates = dict(rv)
    if rv_issues:
        rv_for_gates["RVEDV"] = None
        rv_for_gates["RVEDVI"] = None
        rv_for_gates["RVESVI"] = None
        rv_for_gates["SVI"] = None
        warnings.append(
            "Absolute RV volumes flagged unreliable (" + "; ".join(rv_issues) + ") — "
            "RVEDVI/RVESVI/SVI excluded from the RV gate and severity notes below."
        )

    gates = [
        _gate_nor(lv_for_gates, rv_for_gates, sex),
        _gate_minf(lv_for_gates, regional_lv_segments),
        _gate_dcm(lv_for_gates, sex),
        _gate_hcm(lv_for_gates, sex),
        _gate_rv(rv_for_gates, sex),
    ]
    if lv_issues:
        note = "Absolute LV volumes for this mask are flagged unreliable (" + "; ".join(lv_issues) + ") — EDVI/LVMI were excluded from this gate rather than compared as if trustworthy."
        for code in ("NOR", "DCM", "HCM"):
            next(g for g in gates if g["code"] == code)["reasons"].append(note)
    if rv_issues:
        rv_note = (
            "Absolute RV volumes for this mask are flagged unreliable (" + "; ".join(rv_issues) + ") — "
            "RVEDVI was excluded from this gate rather than compared as if trustworthy (RVEF, a ratio, is unaffected)."
        )
        for code in ("RV", "NOR"):  # NOR also reads RVEDVI now (Bernard et al. 2018's own NOR definition requires a normal RV)
            next(g for g in gates if g["code"] == code)["reasons"].append(rv_note)
    met_codes = [g["code"] for g in gates if g["met"] is True]

    rv_gate = next(g for g in gates if g["code"] == "RV")
    rv_severity = _rv_severity(rv_for_gates, lv_for_gates) if rv_gate["met"] is True else None

    if all(g["met"] is None for g in gates):
        warnings.append("No usable measurements provided — every gate is pending.")

    # Rank co-firing LV gates (NOR/MINF/DCM/HCM) by how strongly each one's
    # own numeric criteria are cleared, when 2+ are met simultaneously (the
    # ACDC paper's own MINF description allows exactly this: MINF patients
    # can have a dilated LV too, so MINF+DCM can both legitimately fire — see
    # module docstring). RV is deliberately excluded from this ranking:
    # comparing it against LV gates would reintroduce the exact RV-vs-LV
    # feature-space problem this module's independent-gate design was built
    # to avoid. The underlying margin is internal-only and never exposed as a
    # raw number — only a plain rank label — so this can't be misread as a
    # diagnostic confidence/probability, which was the whole reason the old
    # single-score design was dropped.
    lv_met = [g for g in gates if g["code"] != "RV" and g["met"] is True]
    if len(lv_met) >= 2:
        ranked = sorted(lv_met, key=lambda g: g.get("_margin") if g.get("_margin") is not None else -1.0, reverse=True)
        for i, g in enumerate(ranked):
            g["rank_label"] = "Primary match" if i == 0 else "Also meets"
    for g in gates:
        g.pop("_margin", None)
        g.setdefault("rank_label", None)

    return {
        "gates": gates,
        "met_codes": met_codes,
        "rv_severity": rv_severity,
        "sex": sex,
        "disclaimer": _DISCLAIMER,
        "method": "acdc-criteria-gates",
        "reference_source": _REFERENCE_SOURCE,
        "warnings": warnings,
    }


def main() -> None:
    try:
        data = json.load(sys.stdin)
        lv_in = data.get("lv") or {}
        rv_in = data.get("rv") or {}
        if not isinstance(lv_in, dict) or not isinstance(rv_in, dict):
            raise ValueError("`lv` and `rv` must be JSON objects.")
    except Exception as e:
        print(json.dumps({"error": f"Invalid input JSON: {e}"}), file=sys.stdout)
        sys.exit(1)

    lv = {k: _safe_float(v) for k, v in lv_in.items()}
    rv = {k: _safe_float(v) for k, v in rv_in.items()}
    regional_lv_segments = data.get("regional_lv_segments")
    if regional_lv_segments is not None and not isinstance(regional_lv_segments, list):
        regional_lv_segments = None
    sex = data.get("sex") or "unspecified"
    volume_signals = data.get("volume_signals") if isinstance(data.get("volume_signals"), dict) else None

    result = compute_gates(lv, rv, regional_lv_segments, sex=sex, volume_signals=volume_signals)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
