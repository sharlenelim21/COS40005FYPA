"""
compute_disease_similarity.py
=============================
LV Phenotype Similarity Assessment (Cine-CMR).

IMPORTANT — this is NOT a diagnostic tool.
It does not diagnose, predict, or make any medical decision. It answers a single
descriptive question: "Which known cardiac reference phenotype (NOR-like / HCM-like /
DCM-like) does this patient's set of Cine-CMR LV measurements most resemble?" — and
shows the reasoning behind that similarity so a clinician can judge it for themselves.
A NOR-like result does NOT exclude cardiac disease, regional abnormalities, tissue
abnormalities, or non-LV conditions — it only means the available LV measurements
did not stand out against the other two reference phenotypes.

Methodology (explainable, defensible, no training data required)
----------------------------------------------------------------
For each candidate reference profile p and each feature f we hold a (mean, sd).
Given a patient value x_f:

    z_{p,f}  = (x_f - mu_{p,f}) / sd_{p,f}          # how many SDs from the profile
    d_p      = sqrt( sum_f w_f * z_{p,f}^2 )        # weighted Euclidean distance in z-space

The weighted distances are turned into similarity percentages with a softmax over
the *negative* distances (closer profile -> higher %):

    s_p = exp(-d_p / T) / sum_q exp(-d_q / T)

Percentages sum to 100. Only features the patient actually provides (non-null) are
used, and the weights are renormalised over the available features so a missing
metric never biases one profile over another.

Two modes (BSA-indexed preferred, non-indexed fallback)
--------------------------------------------------------
Mode is decided by whether the caller supplied BSA-indexed volumes (EDVI/ESVI/LVMI),
NOT by a flag — if EDVI is present we assume the caller computed it deliberately
(height AND weight were both available; see report/page.tsx's Mosteller BSA card,
which only produces a BSA when BOTH fields are filled).

    indexed mode     -> EF, EDVI, ESVI, MaxWallThicknessMm, LVMI, PeakGCS, PeakGRS
    non_indexed mode -> EF, EDV, ESV, MaxWallThicknessMm, LVMassG, PeakGCS, PeakGRS

StrokeVolume/StrokeVolumeIndex are deliberately EXCLUDED from both weighted feature
sets (neither published weighting table includes them) — SV is arithmetically
EDV-ESV, so weighting it alongside EDV/ESV would partially double-count the same
underlying evidence. If supplied, it is echoed back informationally only.

Why z-score weighted distance (and not Mahalanobis / cosine)
------------------------------------------------------------
* Mahalanobis needs a per-disease covariance matrix - that requires a labelled
  per-patient dataset we do not have. z-scoring with a literature SD is the
  diagonal-covariance special case and is the honest choice given the data.
* Cosine ignores magnitude, so a mildly and a severely dilated ventricle look
  identical - clinically wrong for volume data.
* z-score distance is fully explainable: every profile's score decomposes into
  per-metric contributions we can print as plain-language reasoning.

Gates and confidence (NEW - separate from the z-score engine)
---------------------------------------------------------------
The z-score engine ranks all three profiles even when the winning profile's
*essential* published criterion isn't actually met (e.g. HCM-like ranking first
with no elevated wall thickness on record). A small rule-based gate check runs
AFTER the ranking, only on the top-ranked profile, and:
  - never changes `most_similar` or the raw percentages (full transparency), and
  - feeds into `phenotype_headline`, which is decided by a priority-ordered set
    of checks (most fundamental limitation first - see compute_similarity()):
      1. a high-weight feature is missing -> "Reduced-feature phenotype similarity"
      2. even the closest profile is a poor fit -> "Indeterminate LV phenotype pattern"
      3. the top profile's own essential gate explicitly failed -> "Indeterminate..."
      4. the top profile's own essential gate couldn't be checked (HCM/DCM) ->
         "<label> similarity cannot be assessed reliably"
      5. otherwise -> the confident "<code>-like LV phenotype similarity/measurement
         profile" headline, and
  - feeds into `confidence` (0-1), which also drops for: non-indexed mode, missing
    high-weight features, an unspecified biological sex, and a close 1st/2nd race
    between profiles.
`notes` (separate from `confidence_notes`) carries informational, NON-confidence-
affecting messages - e.g. confirming BSA-indexing was used, or flagging that
GRS/GCS are this project's own mask-difference strain surrogate rather than
feature-tracking strain.
Confidence and gates are ADVISORY, mirroring how `regionalHealthStatus` never
changes `healthStatus` elsewhere in this codebase.

I/O contract (mirrors compute_heart_metrics_from_rle.py)
--------------------------------------------------------
Read one JSON object from stdin, write one JSON object to stdout. Non-recoverable
errors print `{"error": "..."}` and sys.exit(1).

Input (stdin JSON):
    measurements — {                       # any subset; nulls are ignored
        "EF": float|null,                  # LV ejection fraction, %
        "EDV": float|null,                 # LV end-diastolic volume, mL
        "ESV": float|null,                 # LV end-systolic volume, mL
        "EDVI": float|null,                # LV EDV / BSA, mL/m^2 - only when caller has BSA
        "ESVI": float|null,                # LV ESV / BSA, mL/m^2 - only when caller has BSA
        "LVMassG": float|null,             # LV myocardial mass, g (non-indexed mode)
        "LVMI": float|null,                # LV mass / BSA, g/m^2 (indexed mode)
        "MaxWallThicknessMm": float|null,  # max per-AHA-segment ED wall thickness, mm
        "StrokeVolume": float|null,        # mL - informational only, not weighted
        "StrokeVolumeIndex": float|null,   # mL/m^2 - informational only, not weighted
        "PeakGRS": float|null,             # peak global radial strain, %
        "PeakGCS": float|null              # peak global circumferential strain, %
    }
    sex? — "male" | "female" | "unspecified" (default "unspecified")
    temperature? — float (optional, default 1.0)   # softmax sharpness

Output (stdout JSON):
    most_similar          — "NOR" | "HCM" | "DCM"   (raw top code, always transparent)
    phenotype_headline    — display string; "Indeterminate LV phenotype pattern" when
                             the top profile's gate failed/unassessable
    mode                  — "indexed" | "non_indexed"
    confidence            — 0.0-1.0, advisory (see module docstring)
    confidence_notes      — list[str], why confidence was reduced
    notes                 — list[str], informational only - does NOT affect confidence
    gate                  — {"code","met":true|false|null,"reason"} for the top profile
    phenotype_facts       — {dcm_gate_met, hcm_gate_met, nor_gate_met (all three,
                             true|false|null), lv_dilatation_present,
                             severe_lv_systolic_dysfunction, hcm_wall_thickness_signal}
                             - AUTHORITATIVE facts for any downstream consumer (e.g.
                             the research-assistant RAG service) to build its prompt/
                             validator from, so it never has to re-derive thresholds
    similarities          — [{code,label,percent,distance,reasons[]}] sorted desc
    features_used         — list[str]          # metrics that were non-null AND weighted
    features_missing      — list[str]
    informational         — {StrokeVolume, StrokeVolumeIndex, PeakGRS, PeakGCS} echoed,
                             not scored (see "excluded from the weighted z-score" below)
    disclaimer            — fixed non-diagnostic disclaimer string
    method                — short method identifier for audit
    warnings              — list[str]
    reference_source            — "published_research_cohort" (always, this sprint)
    reference_status             — "provisional_external" (always, this sprint)
    validated_on_deployed_pipeline — False (always, this sprint)
    strain_reference_used        — False (GRS/GCS never scored, see above)
    reference_provenance_notes   — str, which paper backs which profile

Reference values - provenance (updated to published, cited cohorts)
---------------------------------------------------------------------
Status: PROVISIONAL EXTERNAL REFERENCES, not yet validated on this project's own
deployed pipeline. reference_status="provisional_external" is stamped on every
output (see compute_similarity's return dict). A future sprint should recompute
NOR/HCM/DCM profiles from patient-level ACDC data using this project's own
segmentation + geometric calculations, then compare against (and potentially
replace/recalibrate) the external profiles below - see
scripts/derive_acdc_reference_ranges.py for the one existing (partial, EF-only)
attempt at that.

NOR (indexed EF/EDVI/ESVI/LVMI, sex-specific): Zhan Y, Friedrich MG, Dendukuri N,
et al. "Meta-Analysis of Normal Reference Values for Right and Left Ventricular
Quantification by Cardiovascular Magnetic Resonance." Circulation: Cardiovascular
Imaging 2024;17(2):e016090 (doi: 10.1161/CIRCIMAGING.123.016090). Uses the
papillary-muscle-in-cavity convention, matching ACDC.

HCM/DCM (indexed EF/EDVI/ESVI/LVMI): Kubler J, Burgstahler C, Brendel JM, et al.
"Cardiac MRI findings to differentiate athlete's heart from hypertrophic (HCM),
arrhythmogenic right ventricular (ARVC) and dilated (DCM) cardiomyopathy."
International Journal of Cardiovascular Imaging 2021;37:2501-2515
(doi: 10.1007/s10554-021-02280-6). Values are that paper's mean +/- SD directly,
not sex-specific (the paper doesn't break these down by sex).

Non-indexed (absolute EDV/ESV/LVMassG, all three profiles): derived from the
indexed values above by multiplying by a declared generic reference BSA
(REFERENCE_BSA_GENERIC = 1.91 m^2, from an assumed 175cm/75kg adult - the
client's own proposed generic-fallback figure), i.e.
absolute = indexed * REFERENCE_BSA_GENERIC. NOR uses the pooled (sex-unspecified)
Zhan range for this conversion, since the non-indexed fallback doesn't branch by
sex. EF is never BSA-scaled (unchanged between indexed/non-indexed). This
fallback is explicitly less reliable than patient-specific BSA indexing -
confidence is reduced accordingly (see _compute_confidence's mode=="non_indexed"
penalty).

Wall thickness and GRS/GCS are deliberately EXCLUDED from the weighted z-score
distance this sprint, for two different reasons:
  - MaxWallThicknessMm: Kubler et al. reports interventricular SEPTAL thickness
    (HCM 12.4+/-2.4mm, DCM 8.8+/-1.8mm), which is not necessarily the same
    measurement as this pipeline's own max-per-AHA-segment ED wall thickness.
    Rather than mixing two different measurement methods in one z-score term,
    wall thickness is used ONLY as the existing ACDC-threshold GATE (>=15mm
    HCM / <12mm DCM - see _apply_gate), which was already independent of any
    disease-cohort mean/SD.
  - PeakGRS/PeakGCS: this pipeline's strain is a GEOMETRIC mask-deformation
    surrogate (independently segmented ED/ES masks, not tracked material
    points), not conventional CMR feature-tracking strain. External papers'
    GRS/GCS values come from feature-tracking, tagging, or different slice
    coverage - using their means/SDs directly in this z-score risks comparing
    two different measurement methods as if they were one. They remain
    available as INFORMATIONAL fields (see `informational` in the output) but
    are not scored until this project derives its own geometric-strain
    reference ranges.

Pure Python + numpy. No cv2 / nibabel / scipy.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Optional

import numpy as np


# ── Feature sets (mode-dependent) ───────────────────────────────────────────────
# StrokeVolume/StrokeVolumeIndex are intentionally absent from both — see module
# docstring "Two modes" section for why (arithmetic double-count of EDV/ESV).
# MaxWallThicknessMm and PeakGRS/PeakGCS are ALSO absent from scoring (see the
# module docstring's "excluded from the weighted z-score" section) — wall
# thickness is gate-only, strain is informational-only, both for measurement-
# method-mismatch reasons, not because they're unavailable.
FEATURES_INDEXED: list[str] = ["EF", "EDVI", "ESVI", "LVMI"]
FEATURES_NON_INDEXED: list[str] = ["EF", "EDV", "ESV", "LVMassG"]
# Parsed into `patient` (for _apply_gate) but never scored/weighted.
GATE_ONLY_FEATURES: list[str] = ["MaxWallThicknessMm"]
# Union — used only for input parsing / FEATURE_LABELS lookups, never for scoring.
FEATURES: list[str] = list(dict.fromkeys(FEATURES_INDEXED + FEATURES_NON_INDEXED + GATE_ONLY_FEATURES))
INFORMATIONAL_FEATURES: list[str] = ["StrokeVolume", "StrokeVolumeIndex", "PeakGRS", "PeakGCS"]

# Generic reference BSA used to convert the indexed research profiles to
# absolute (non-indexed) values when the patient's own BSA is unavailable — the
# client's own proposed 175cm/75kg adult fallback. See module docstring.
REFERENCE_BSA_GENERIC = 1.91

FEATURE_LABELS: dict[str, str] = {
    "EF":                 "Ejection Fraction",
    "EDV":                "End-Diastolic Volume",
    "ESV":                "End-Systolic Volume",
    "EDVI":               "End-Diastolic Volume Index (BSA)",
    "ESVI":               "End-Systolic Volume Index (BSA)",
    "LVMassG":            "LV Myocardial Mass",
    "LVMI":               "LV Mass Index (BSA)",
    "MaxWallThicknessMm": "Maximum ED Wall Thickness",
    "StrokeVolume":       "Stroke Volume",
    "StrokeVolumeIndex":  "Stroke Volume Index (BSA)",
    "PeakGRS":            "Peak Global Radial Strain",
    "PeakGCS":            "Peak Global Circumferential Strain",
}

# Per-feature weights, mode-dependent — only the 4 scored features per mode.
# Renormalised at run time anyway over whichever of the mode's features the
# patient actually has. Relative proportions kept from the original 7-feature
# weighting (EF most discriminative, then EDVI/ESVI, LVMI last); wall
# thickness/strain's old weight share simply no longer exists since they're
# gate-only/informational now, not renormalised into the remaining features.
FEATURE_WEIGHTS_INDEXED: dict[str, float] = {
    "EF": 0.22, "EDVI": 0.18, "ESVI": 0.18, "LVMI": 0.12,
}
FEATURE_WEIGHTS_NON_INDEXED: dict[str, float] = {
    "EF": 0.30, "EDV": 0.15, "ESV": 0.15, "LVMassG": 0.10,
}

# ── Published adult NORMAL reference ranges (NOT disease-group stats) ──────────
# Zhan et al. 2024 (see module docstring for full citation). Used to build NOR's
# EDVI/ESVI/LVMI/EF mean/sd, sex-specific when sex is known, pooled (union of
# both sexes' ranges) when it isn't.
ADULT_NORMAL_RANGES: dict[str, dict[str, tuple[float, float]]] = {
    "male":   {"EF": (52.0, 73.0), "EDVI": (60.0, 109.0), "ESVI": (18.0, 45.0), "LVMI": (41.0, 76.0)},
    "female": {"EF": (54.0, 75.0), "EDVI": (56.0, 96.0),  "ESVI": (16.0, 38.0), "LVMI": (33.0, 57.0)},
}


def _range_to_mean_sd(lo: float, hi: float) -> tuple[float, float]:
    """Published range -> (mean, sd), treating the range as an approximate 95% CI
    (~ +/-2 SD). Standard, defensible approximation when only a range (not a raw
    mean/SD) is published - see module docstring."""
    return (lo + hi) / 2.0, (hi - lo) / 4.0


def _pooled_range(feature: str) -> tuple[float, float]:
    m_lo, m_hi = ADULT_NORMAL_RANGES["male"][feature]
    f_lo, f_hi = ADULT_NORMAL_RANGES["female"][feature]
    return min(m_lo, f_lo), max(m_hi, f_hi)


def _nor_indexed_stats(sex: str) -> dict[str, tuple[float, float]]:
    """NOR profile's EF/EDVI/ESVI/LVMI mean/sd - sex-specific range when sex is
    known, pooled (wider, honest) range otherwise. EDV/ESV/LVMassG (non-indexed
    mode) keep their fixed pooled-derived stats regardless of sex, since the
    non-indexed fallback doesn't branch by sex (see REFERENCE_PROFILES)."""
    table = ADULT_NORMAL_RANGES.get(sex)
    out: dict[str, tuple[float, float]] = {}
    for feature in ("EF", "EDVI", "ESVI", "LVMI"):
        lo, hi = table[feature] if table else _pooled_range(feature)
        out[feature] = _range_to_mean_sd(lo, hi)
    return out


# ── Reference profiles (mean, sd) per feature ─────────────────────────────────
#   NOR - healthy adult LV.
#   HCM - hypertrophic cardiomyopathy: preserved/high EF, hypertrophied wall,
#         elevated mass, small-to-normal cavity.
#   DCM - dilated cardiomyopathy: large cavity, thin wall, low EF.
#
# Units: EF %, volumes mL, EDVI/ESVI/LVMI mL/m^2 or g/m^2, mass g.
# Only EF/EDV(I)/ESV(I)/LVMI/LVMassG are here — MaxWallThicknessMm (gate-only)
# and PeakGRS/PeakGCS (informational-only) are deliberately not part of this
# dict any more; see the module docstring's exclusion rationale.
#
# NOR indexed (EDVI/ESVI/LVMI/EF): Zhan et al. 2024, sex-specific — see
# _nor_indexed_stats(), which overrides these pooled defaults per-request.
# HCM/DCM indexed: Kubler et al. 2021, mean +/- SD as published (not sex-split).
# All three profiles' non-indexed (EDV/ESV/LVMassG) are the indexed mean/sd
# multiplied by REFERENCE_BSA_GENERIC (1.91) — see module docstring.
REFERENCE_PROFILES: dict[str, dict[str, tuple[float, float]]] = {
    "NOR": {
        "EF":      _range_to_mean_sd(*_pooled_range("EF")),     # Zhan 2024, pooled
        "EDV":     (157.6, 25.3),                                # pooled EDVI (82.5, 13.25) x 1.91
        "ESV":     (58.3,  13.8),                                 # pooled ESVI (30.5, 7.25) x 1.91
        "EDVI":    _range_to_mean_sd(*_pooled_range("EDVI")),    # Zhan 2024, pooled; per-request sex override below
        "ESVI":    _range_to_mean_sd(*_pooled_range("ESVI")),    # Zhan 2024, pooled
        "LVMI":    _range_to_mean_sd(*_pooled_range("LVMI")),    # Zhan 2024, pooled
        "LVMassG": (104.1, 20.5),                                 # pooled LVMI (54.5, 10.75) x 1.91
    },
    "HCM": {
        "EF":      (59.0,  9.0),     # Kubler et al. 2021
        "EDV":     (179.5, 24.8),    # EDVI (94, 13) x 1.91
        "ESV":     (74.5,  17.2),    # ESVI (39, 9) x 1.91
        "EDVI":    (94.0,  13.0),    # Kubler et al. 2021
        "ESVI":    (39.0,  9.0),     # Kubler et al. 2021
        "LVMI":    (77.0,  12.0),    # Kubler et al. 2021
        "LVMassG": (147.1, 22.9),    # LVMI (77, 12) x 1.91
    },
    "DCM": {
        "EF":      (29.0,  13.0),    # Kubler et al. 2021
        "EDV":     (252.1, 78.3),    # EDVI (132, 41) x 1.91
        "ESV":     (183.4, 76.4),    # ESVI (96, 40) x 1.91
        "EDVI":    (132.0, 41.0),    # Kubler et al. 2021
        "ESVI":    (96.0,  40.0),    # Kubler et al. 2021
        "LVMI":    (70.0,  21.0),    # Kubler et al. 2021
        "LVMassG": (133.7, 40.1),    # LVMI (70, 21) x 1.91
    },
}

PROFILE_LABELS: dict[str, str] = {
    "NOR": "NOR-like (Normal)",
    "HCM": "HCM-like (Hypertrophic Cardiomyopathy)",
    "DCM": "DCM-like (Dilated Cardiomyopathy)",
}

# Short headline wording (client-provided UI spec) — deliberately separate from
# PROFILE_LABELS above: the bars/reasoning text want the full clinical name in
# parentheses, but the single-line headline reads better as "<code>-like LV
# phenotype similarity" / "...LV measurement profile" for NOR.
_HEADLINE_LABELS: dict[str, str] = {
    "NOR": "NOR-like LV measurement profile",
    "HCM": "HCM-like LV phenotype similarity",
    "DCM": "DCM-like LV phenotype similarity",
}

DISCLAIMER = (
    "This is a research-based relative phenotype similarity comparison, not a validated "
    "disease likelihood or a diagnosis. It reports which reference imaging phenotype "
    "(NOR-like, HCM-like, or DCM-like) the available Cine-CMR LV measurements most resemble, "
    "using published cohort statistics as provisional external references — not yet derived "
    "from this project's own deployed segmentation pipeline. A NOR-like result does not "
    "exclude cardiac disease, regional abnormalities, tissue abnormalities, or non-LV "
    "conditions. Interpretation by a qualified clinician is required."
)

# How many SDs away a feature must be for the reasoning text to call it out.
_NOTABLE_Z = 1.0

# ── Gate thresholds (rule-based, separate from the z-score engine) ────────────
_HCM_WALL_THICKNESS_GATE_MM = 15.0
_DCM_EF_GATE_PCT = 40.0
_DCM_EDVI_GATE_ML_M2 = 100.0
_NOR_EF_GATE_PCT = 55.0  # same "Healthy" threshold compute_health_status.py already uses

# Weighted-RMS z-distance above which even the CLOSEST profile is too far away
# to call a similarity - i.e. the patient doesn't clearly resemble NOR, HCM, OR
# DCM. PROJECT HEURISTIC (not literature-derived): ~2.5 SDs away in the
# weighted-combined sense is the point past which naming a single "most
# similar" profile stops being informative. See _apply_gate for the
# per-profile essential-criterion gates, which are a separate check.
_ALL_DISTANCES_POOR_MIN = 2.5


def _safe_float(v) -> Optional[float]:
    """Return v as a finite float, or None if NaN/Inf/unparseable."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def _direction_word(feature: str, patient: float, mu: float) -> str:
    """Plain-language 'higher/lower/enlarged/reduced' for a feature vs a profile mean."""
    higher = patient > mu
    if feature in ("EDV", "ESV", "EDVI", "ESVI", "LVMassG", "LVMI", "MaxWallThicknessMm"):
        return "enlarged relative to" if higher else "smaller than"
    if feature in ("EF", "PeakGRS"):
        return "higher than" if higher else "reduced compared with"
    if feature == "PeakGCS":
        # More negative GCS = stronger contraction. "Higher magnitude" reads clearer.
        return ("stronger (more negative) than" if patient < mu
                else "weaker (less negative) than")
    return "higher than" if higher else "lower than"


def _apply_gate(code: str, patient: dict) -> dict:
    """Rule-based essential-criterion check for ONE profile code. Advisory only -
    never changes the z-score ranking; only gates the human-readable headline and
    feeds `confidence`. Returns {"code","met": bool|None, "reason": str}."""
    if code == "HCM":
        wt = patient.get("MaxWallThicknessMm")
        if wt is None:
            return {"code": code, "met": None,
                     "reason": "Maximum ED wall thickness not available - HCM-like assessment cannot be reliably confirmed."}
        met = wt >= _HCM_WALL_THICKNESS_GATE_MM
        return {"code": code, "met": met,
                 "reason": f"Maximum ED wall thickness {wt:.1f} mm "
                           f"{'meets' if met else 'does not meet'} the >= {_HCM_WALL_THICKNESS_GATE_MM:.0f} mm HCM morphology gate."}
    if code == "DCM":
        ef = patient.get("EF")
        edvi = patient.get("EDVI")
        if ef is None or (edvi is None and patient.get("EDV") is None):
            return {"code": code, "met": None,
                     "reason": "EF and/or an LV dilation measure not available - DCM-like assessment cannot be reliably confirmed."}
        if edvi is not None:
            met = ef < _DCM_EF_GATE_PCT and edvi > _DCM_EDVI_GATE_ML_M2
            return {"code": code, "met": met,
                     "reason": f"EF {ef:.1f}% and EDVI {edvi:.1f} mL/m² "
                               f"{'meet' if met else 'do not both meet'} the DCM gate "
                               f"(EF < {_DCM_EF_GATE_PCT:.0f}%, EDVI > {_DCM_EDVI_GATE_ML_M2:.0f} mL/m²)."}
        met = ef < _DCM_EF_GATE_PCT
        return {"code": code, "met": met,
                 "reason": f"EF {ef:.1f}% {'meets' if met else 'does not meet'} the reduced-EF component of the "
                           "DCM gate; dilation could not be BSA-indexed, so only partially assessed."}
    if code == "NOR":
        ef = patient.get("EF")
        if ef is None:
            return {"code": code, "met": None, "reason": "EF not available."}
        met = ef >= _NOR_EF_GATE_PCT
        return {"code": code, "met": met,
                 "reason": f"EF {ef:.1f}% {'is' if met else 'is not'} within the preserved-function range "
                           f"(>= {_NOR_EF_GATE_PCT:.0f}%)."}
    return {"code": code, "met": None, "reason": ""}


def _all_gate_facts(patient: dict) -> dict:
    """Gate status for ALL THREE profiles (not just the top-ranked one), plus two
    standalone structural/functional facts. Exported as `phenotype_facts` so an
    external consumer (e.g. the research-assistant RAG service) has ONE
    authoritative source for "is this patient's LV dilated / severely
    dysfunctional" instead of re-deriving its own thresholds, which is exactly
    how a downstream LLM previously ended up contradicting this module (calling
    a BSA-indexed-dilated, low-EF LV "non-dilated" (NDLVC) because nothing
    forced it to check the actual gate values first).

    `met` fields are tri-state (True/False/None) like `_apply_gate` above -
    None means "not enough data to assess", which a caller MUST NOT treat as
    False. `lv_dilatation_present`/`severe_lv_systolic_dysfunction` are None for
    the same reason when EDVI/EF aren't available."""
    ef = patient.get("EF")
    edvi = patient.get("EDVI")
    wall = patient.get("MaxWallThicknessMm")
    return {
        "dcm_gate_met":                    _apply_gate("DCM", patient)["met"],
        "hcm_gate_met":                    _apply_gate("HCM", patient)["met"],
        "nor_gate_met":                    _apply_gate("NOR", patient)["met"],
        "lv_dilatation_present":           (edvi > _DCM_EDVI_GATE_ML_M2) if edvi is not None else None,
        "severe_lv_systolic_dysfunction":  (ef < _DCM_EF_GATE_PCT) if ef is not None else None,
        "hcm_wall_thickness_signal":       (wall >= _HCM_WALL_THICKNESS_GATE_MM) if wall is not None else None,
    }


def _compute_confidence(
    mode: str, sex: str, active_weights: dict[str, float],
    features_used: list[str], percents: dict[str, float], top_code: str, gate: dict,
    wall_thickness_available: bool,
) -> tuple[float, list[str]]:
    """0.0-1.0 advisory confidence + the reasons it was reduced. Multiplicative,
    starts at 1.0. See module docstring for the factors considered."""
    conf = 1.0
    notes: list[str] = []

    if mode == "non_indexed":
        conf *= 0.85
        notes.append(
            "LV volumes/mass are not BSA-indexed (height/weight not supplied) - the non-indexed "
            "normal reference range was used. Entering height/weight is recommended for a more precise comparison."
        )

    if sex == "unspecified":
        conf *= 0.9
        notes.append("Biological sex not specified - the pooled (wider) normal reference range was used.")

    # High-weight features (>=0.15 of the active mode's weighting) that are missing.
    missing_high_weight = [f for f, w in active_weights.items() if w >= 0.15 and f not in features_used]
    if missing_high_weight:
        conf *= max(0.5, 1.0 - 0.15 * len(missing_high_weight))
        notes.append(
            f"High-weight feature(s) missing: {', '.join(FEATURE_LABELS.get(f, f) for f in missing_high_weight)}."
        )

    # Standalone HCM caveat (client-provided UI spec) - only added when the generic
    # missing-high-weight note above didn't already cover it via a more specific
    # message (see _apply_gate's own HCM reason, used when HCM IS the top match).
    # Checks whether wall thickness was actually MEASURED (gate-only now, never
    # in features_used) - not whether it's a scored z-score feature.
    if not wall_thickness_available and top_code != "HCM":
        notes.append(
            "HCM-like assessment limited: reliable HCM-like pattern assessment requires maximum LV "
            "wall thickness (and preferably BSA-indexed LV mass); functional metrics alone cannot "
            "reliably distinguish HCM-like from normal-like patterns."
        )

    sorted_pct = sorted(percents.values(), reverse=True)
    if len(sorted_pct) >= 2 and (sorted_pct[0] - sorted_pct[1]) < 10.0:
        conf *= 0.85
        notes.append("The top two phenotype similarities are close - the result is less decisive.")

    if gate["code"] == top_code:
        if gate["met"] is False:
            conf *= 0.3
            notes.append(f"The essential gate for the top-matching profile ({PROFILE_LABELS[top_code]}) was not met.")
        elif gate["met"] is None and top_code in ("HCM", "DCM"):
            conf *= 0.6
            notes.append(f"The essential gate for the top-matching profile ({PROFILE_LABELS[top_code]}) could not be assessed.")

    return max(0.0, min(1.0, round(conf, 3))), notes


def _general_notes(mode: str, informational: dict[str, Optional[float]]) -> list[str]:
    """Informational, NON-confidence-affecting notes (client-provided UI spec) -
    kept separate from `_compute_confidence`'s notes because these don't reduce
    confidence; one of them is actively reassuring. Rendered by the frontend
    with a neutral icon rather than the red confidence-reducing warning.

    Checks `informational` (not features_used) for GRS/GCS, since strain is
    never a scored z-score feature any more — but the caveat about it being a
    geometric surrogate, not feature-tracking strain, still applies whenever
    the value is actually present and shown to the user."""
    notes: list[str] = []
    if mode == "indexed":
        notes.append(
            "Height and weight were used to index LV volume and mass to body surface area. "
            "This improves comparison across different body sizes."
        )
    if informational.get("PeakGRS") is not None or informational.get("PeakGCS") is not None:
        notes.append(
            "GRS and GCS are derived from differences between independently segmented cine-MRI "
            "masks. They are supportive, informational-only measurements (not used in the "
            "similarity score this sprint) and are not equivalent to CMR feature-tracking strain."
        )
    return notes


def compute_similarity(
    measurements: dict, sex: str = "unspecified", temperature: float = 1.0,
) -> dict:
    """Core similarity computation. Pure function - no I/O.

    Returns the full output dict (see module docstring). Raises ValueError only
    when no usable features are present.
    """
    sex = sex if sex in ("male", "female") else "unspecified"

    # 1. Collect every field the caller provided (used to decide mode + for gates/
    #    reasoning), separately from informational-only fields.
    provided: dict[str, float] = {}
    for f in FEATURES:
        v = _safe_float(measurements.get(f))
        if v is not None:
            provided[f] = v
    informational: dict[str, Optional[float]] = {
        f: _safe_float(measurements.get(f)) for f in INFORMATIONAL_FEATURES
    }

    # 2. Mode: indexed whenever the caller supplied EDVI (implies BSA was
    #    available - see report/page.tsx, which only computes EDVI when BOTH
    #    height and weight are filled in).
    mode = "indexed" if "EDVI" in provided else "non_indexed"
    mode_features = FEATURES_INDEXED if mode == "indexed" else FEATURES_NON_INDEXED
    active_weights = FEATURE_WEIGHTS_INDEXED if mode == "indexed" else FEATURE_WEIGHTS_NON_INDEXED

    # `patient` also carries GATE_ONLY_FEATURES (MaxWallThicknessMm) so
    # _apply_gate/_all_gate_facts can read it, even though it's excluded from
    # `features_used`/scoring below — a gate check and a z-score feature are
    # different things now (see module docstring's exclusion rationale).
    patient = {f: provided[f] for f in (mode_features + GATE_ONLY_FEATURES) if f in provided}
    features_used = [f for f in mode_features if f in patient]
    features_missing = [f for f in mode_features if f not in patient]

    if not features_used:
        raise ValueError(
            "No usable measurements provided for either mode - need at least one of "
            f"{mode_features} to compute a similarity."
        )

    # 3. Renormalise weights over available features so a missing metric does
    #    not shift the balance between profiles.
    w_total = sum(active_weights[f] for f in features_used)
    weights = {f: active_weights[f] / w_total for f in features_used}

    warnings_out: list[str] = []
    if len(features_used) < 3:
        warnings_out.append(
            f"Only {len(features_used)} measurement(s) available "
            f"({', '.join(features_used)}) - similarity is less reliable with "
            "fewer features."
        )

    # 4. Build the effective reference profiles for this request - NOR's indexed
    #    stats (EF/EDVI/ESVI/LVMI) are sex-aware; everything else is fixed.
    nor_overrides = _nor_indexed_stats(sex)
    effective_profiles: dict[str, dict[str, tuple[float, float]]] = {
        code: {**profile, **(nor_overrides if code == "NOR" else {})}
        for code, profile in REFERENCE_PROFILES.items()
    }

    # 5. Weighted z-distance to each profile + per-feature z for reasoning.
    distances: dict[str, float] = {}
    z_by_profile: dict[str, dict[str, float]] = {}
    for code, profile in effective_profiles.items():
        acc = 0.0
        zs: dict[str, float] = {}
        for f in features_used:
            mu, sd = profile[f]
            sd = sd if sd > 1e-6 else 1e-6  # guard against divide-by-zero
            z = (patient[f] - mu) / sd
            zs[f] = z
            acc += weights[f] * (z ** 2)
        distances[code] = math.sqrt(acc)
        z_by_profile[code] = zs

    # 6. Softmax over negative distances -> similarity percentages.
    T = temperature if temperature and temperature > 1e-6 else 1.0
    codes = list(effective_profiles.keys())
    neg = np.array([-distances[c] / T for c in codes], dtype=np.float64)
    neg -= neg.max()  # numerical stability
    exp = np.exp(neg)
    probs = exp / exp.sum()
    percents = {c: float(round(p * 100.0, 1)) for c, p in zip(codes, probs)}

    # 7. Build per-profile reasoning from the most notable feature deviations.
    def _reasons_for(code: str) -> list[str]:
        zs = z_by_profile[code]
        profile = effective_profiles[code]
        ranked = sorted(features_used, key=lambda f: abs(zs[f]))
        reasons: list[str] = []
        for f in ranked[:3]:
            mu = profile[f][0]
            z = zs[f]
            if abs(z) <= _NOTABLE_Z:
                reasons.append(
                    f"{FEATURE_LABELS[f]} ({patient[f]:.1f}) is close to the "
                    f"{code} reference ({mu:.0f})."
                )
            else:
                word = _direction_word(f, patient[f], mu)
                reasons.append(
                    f"{FEATURE_LABELS[f]} ({patient[f]:.1f}) is {word} the "
                    f"{code} reference ({mu:.0f})."
                )
        return reasons

    similarities = [
        {
            "code":     code,
            "label":    PROFILE_LABELS[code],
            "percent":  percents[code],
            "distance": round(distances[code], 3),
            "reasons":  _reasons_for(code),
        }
        for code in codes
    ]
    similarities.sort(key=lambda s: s["percent"], reverse=True)
    top_code = similarities[0]["code"]

    # 8. Gate + confidence - advisory, never changes the ranking above.
    gate = _apply_gate(top_code, patient)
    confidence, confidence_notes = _compute_confidence(
        mode, sex, active_weights, features_used, percents, top_code, gate,
        wall_thickness_available=patient.get("MaxWallThicknessMm") is not None,
    )
    general_notes = _general_notes(mode, informational)
    phenotype_facts = _all_gate_facts(patient)

    # Headline priority (client-provided decision-gate spec), most fundamental
    # limitation first — each of these is checked in order and the first match
    # wins; only when none apply does a confident profile label show:
    #   1. A high-weight feature is missing -> the result itself is built on an
    #      incomplete measurement set, independent of which profile ranks top.
    #   2. Even the closest profile is a poor fit (_ALL_DISTANCES_POOR_MIN) ->
    #      the patient doesn't clearly resemble NOR, HCM, or DCM.
    #   3. The top profile's own essential gate explicitly failed.
    #   4. The top profile's own essential gate couldn't be checked (HCM/DCM only).
    missing_high_weight = [f for f, w in active_weights.items() if w >= 0.15 and f not in features_used]
    if missing_high_weight:
        phenotype_headline = "Reduced-feature phenotype similarity"
    elif distances[top_code] > _ALL_DISTANCES_POOR_MIN:
        phenotype_headline = "Indeterminate LV phenotype pattern"
    elif gate["met"] is False:
        phenotype_headline = "Indeterminate LV phenotype pattern"
    elif gate["met"] is None and top_code in ("HCM", "DCM"):
        phenotype_headline = f"{PROFILE_LABELS[top_code]} similarity cannot be assessed reliably"
    else:
        phenotype_headline = _HEADLINE_LABELS[top_code]

    return {
        "most_similar":        top_code,
        "phenotype_headline":  phenotype_headline,
        "mode":                mode,
        "sex":                 sex,
        "confidence":          confidence,
        "confidence_notes":    confidence_notes,
        "notes":               general_notes,
        "gate":                gate,
        "phenotype_facts":     phenotype_facts,
        "similarities":        similarities,
        "features_used":       features_used,
        "features_missing":    features_missing,
        "informational":       informational,
        "temperature":         T,
        "disclaimer":          DISCLAIMER,
        "method":              "zscore-weighted-distance+softmax+gate",
        "warnings":            warnings_out,
        # Provenance — explicit per-request, not just in the module docstring, so a
        # downstream consumer (UI, export, RAG service) can label the result
        # correctly without having to know this module's internal history.
        "reference_source":          "published_research_cohort",
        "reference_status":          "provisional_external",
        "validated_on_deployed_pipeline": False,
        "strain_reference_used":     False,
        "reference_provenance_notes": (
            "NOR: Zhan et al. 2024 (doi:10.1161/CIRCIMAGING.123.016090). "
            "HCM/DCM: Kubler et al. 2021 (doi:10.1007/s10554-021-02280-6). "
            "Non-indexed values derived via generic BSA "
            f"{REFERENCE_BSA_GENERIC} m^2. Wall thickness is gate-only "
            "(ACDC threshold); GRS/GCS are informational-only (not scored)."
        ),
    }


def main() -> None:
    try:
        data = json.load(sys.stdin)
        measurements = data["measurements"]
        if not isinstance(measurements, dict):
            raise ValueError("`measurements` must be a JSON object.")
    except Exception as e:
        print(json.dumps({"error": f"Invalid input JSON: {e}"}), file=sys.stdout)
        sys.exit(1)

    sex = data.get("sex") or "unspecified"
    temperature = _safe_float(data.get("temperature")) or 1.0

    try:
        result = compute_similarity(measurements, sex=sex, temperature=temperature)
    except ValueError as e:
        print(json.dumps({"error": str(e)}), file=sys.stdout)
        sys.exit(1)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
