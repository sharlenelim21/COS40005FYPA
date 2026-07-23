"""
compute_health_status.py
========================
Rule-based cardiac health-status assessment from a mask document's stored
`heartMetrics.measurements`. Mirrors compute_disease_similarity.py's I/O
contract: read one JSON object from stdin, write one JSON object to stdout.

**This module is NOT a diagnostic tool.** It reports a rule-based grading of
LV systolic function using the LVEF band the referenced guideline uses as
the primary axis, supplemented by simple bands on EDV and strain peaks.
Interpretation by a qualified clinician is required.

Primary grading axis — LVEF thresholds
--------------------------------------
    LVEF >= 55 %      -> "Healthy"
    LVEF 45–54 %      -> "Mild"      (mildly abnormal)
    LVEF 30–44 %      -> "Moderate"  (moderately abnormal)
    LVEF <  30 %      -> "Severe"    (severely abnormal)

Source: Lang RM et al. 2015. "Recommendations for Cardiac Chamber
Quantification by Echocardiography in Adults: An Update from the ASE and
EACVI." *J Am Soc Echocardiogr* 28(1):1–39.e14. LV systolic function grading.
The paper's normal LVEF cutoff is sex-specific (approximately >= 52 % for
men, >= 54 % for women). We deliberately use the traditional simplified
>= 55 % threshold for this initial rule-based grading — see
HEALTH_STATUS_IMPLEMENTATION.md §2 for why and how to revisit once patient
sex is collected.

Supporting evidence — non-primary axes
--------------------------------------
Each is EMITTED only when the underlying value is present and trustworthy.
Thresholds are approximate references; strain thresholds in particular vary
by vendor / software (see docs §2 for citations and caveats).

    EDV      : "ok" if 60 <= EDV <= 250 mL, else "warn"
               (raw adult reference band — NOT BSA-indexed; body-size caveat
               noted in `detail`). SUPPRESSED entirely when
               `heart_metrics_warnings[]` is non-empty (bad affine / duplicated
               slice / plausibility flag) — replaced by a single "warn" line
               explaining why absolute volumes are considered unreliable.
    Peak GCS : "ok" if PeakGCS <= -17 %  (more negative = better contraction)
    Peak GRS : "ok" if PeakGRS >= 25 %   (approximate soft threshold)
    (Strain peaks are only emitted when the strain module ran at the
     auto-detected ED/ES frames — otherwise they arrive null from
     heartMetrics.measurements and are listed in features_missing.)

Downgrade rule (project heuristic — NOT a clinical guideline)
------------------------------------------------------------
    1. grade_from_ef = the LVEF-band grade above (or "Indeterminate" when
       EF is null).
    2. Count supporting evidence lines with level == "warn" (EF line NOT
       counted — it drives the primary grade).
    3. If that count >= 2 AND grade_from_ef in {Healthy, Mild, Moderate},
       downgrade one step (Healthy -> Mild, Mild -> Moderate,
       Moderate -> Severe). Severe stays Severe (it is the floor).
    4. Final `status` = the (possibly downgraded) grade.

Defensive behaviour
-------------------
    (a) EF null                  -> status "Indeterminate", confidence "low";
                                    single evidence line explains EF wasn't
                                    computable. No downgrade logic runs.
    (b) heart_metrics_warnings   -> confidence "low"; EDV evidence replaced
        non-empty                   by a "warn" "volume evidence suppressed"
                                    line; status is driven by EF only (EF is
                                    a ratio, unaffected by a bad affine).
    (c) PeakGRS/PeakGCS null     -> skip those evidence lines; add them to
                                    features_missing; do NOT treat as warn.

Input (stdin JSON)
------------------
    measurements               — flat block from heartMetrics.measurements:
        { EF, EDV, ESV, StrokeVolume, PeakGRS, PeakGCS }
        (any subset accepted; any field may be null)
    heart_metrics_warnings     — list[str] from heartMetrics.warnings
                                 (empty list if the compute was clean)

Output (stdout JSON) — see HEALTH_STATUS_IMPLEMENTATION.md §3 for the shape.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Any, Optional


# ── Constants — the exact thresholds this module compares against ────────────

# LVEF grading bands (%) — Lang RM et al. 2015 (simplified single-threshold
# variant; see module docstring for the sex-specific alternative).
LVEF_HEALTHY_MIN  = 55.0
LVEF_MILD_MIN     = 45.0
LVEF_MODERATE_MIN = 30.0
# below LVEF_MODERATE_MIN -> "Severe"

# EDV raw-adult reference band (mL). NOT BSA-indexed — body-size caveat is
# repeated in the emitted `detail` string so downstream readers see it.
EDV_MIN_MAX = (60.0, 250.0)

# Strain-peak reference thresholds — APPROXIMATE, see docs §2 (Voigt et al.
# 2015 EACVI/ASE strain standardization; vendor/software variation).
PEAK_GCS_HEALTHY_MAX = -17.0   # more negative = better; "ok" if PeakGCS <= this
PEAK_GRS_HEALTHY_MIN =  25.0   # "ok" if PeakGRS >= this

GRADES = ("Healthy", "Mild", "Moderate", "Severe")

DISCLAIMER = (
    "Rule-based assessment using ASE/EACVI 2015 LV systolic-function grading "
    "thresholds. NOT a diagnosis — interpretation by a qualified clinician is "
    "required."
)

METHOD = "rule-based-ase-lvef-grading"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _num(v: Any) -> Optional[float]:
    """Return v as a finite float, else None. Same idea as
    compute_heart_metrics_from_rle.py::_safe_float — kept local so this
    script has no cross-module import surface."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def _grade_from_lvef(ef: Optional[float]) -> str:
    """Map an LVEF value to a grade string, or 'Indeterminate' when null."""
    if ef is None:
        return "Indeterminate"
    if ef >= LVEF_HEALTHY_MIN:
        return "Healthy"
    if ef >= LVEF_MILD_MIN:
        return "Mild"
    if ef >= LVEF_MODERATE_MIN:
        return "Moderate"
    return "Severe"


def _downgrade_one_step(grade: str) -> str:
    """Downgrade one step within GRADES; Severe is the floor. Only called for
    non-Indeterminate grades — the caller is responsible for the null-EF
    short-circuit."""
    if grade == "Indeterminate":
        return grade
    idx = GRADES.index(grade)
    return GRADES[min(idx + 1, len(GRADES) - 1)]


# ── Main rule engine ─────────────────────────────────────────────────────────

def compute(measurements: dict, hm_warnings: list) -> dict:
    """Apply the rule engine and return the output dict. Pure — no I/O; unit-
    tested via scripts/check_health_status.js by feeding the same JSON."""
    ef      = _num(measurements.get("EF"))
    edv     = _num(measurements.get("EDV"))
    peakGCS = _num(measurements.get("PeakGCS"))
    peakGRS = _num(measurements.get("PeakGRS"))

    hm_warnings = list(hm_warnings) if isinstance(hm_warnings, list) else []
    volumes_unreliable = len(hm_warnings) > 0
    warnings_out: list[str] = []
    evidence: list[dict] = []
    features_used: list[str] = []
    features_missing: list[str] = []

    # ── EF is the primary axis. Always emit an EF evidence line — either the
    #    grade line, or an explanation of why EF was null.
    grade_from_ef = _grade_from_lvef(ef)
    if ef is None:
        evidence.append({
            "label":  "Ejection Fraction",
            "level":  "warn",
            "detail": "LVEF not computable from the stored heart metrics — "
                      "typically because only one cardiac phase was segmented "
                      "or the detected ED and ES resolved to the same frame. "
                      "Health status cannot be graded until EF is available.",
        })
        features_missing.append("EF")
    else:
        features_used.append("EF")
        if grade_from_ef == "Healthy":
            detail_ef = (
                f"LVEF {ef:.1f} % — within the normal band "
                f"(>= {LVEF_HEALTHY_MIN:.0f} %)."
            )
            evidence.append({"label": "Ejection Fraction", "level": "ok",   "detail": detail_ef})
        else:
            band = {
                "Mild":     f"mildly reduced ({LVEF_MILD_MIN:.0f}-{LVEF_HEALTHY_MIN-1:.0f} %)",
                "Moderate": f"moderately reduced ({LVEF_MODERATE_MIN:.0f}-{LVEF_MILD_MIN-1:.0f} %)",
                "Severe":   f"severely reduced (< {LVEF_MODERATE_MIN:.0f} %)",
            }[grade_from_ef]
            evidence.append({
                "label":  "Ejection Fraction",
                "level":  "warn",
                "detail": f"LVEF {ef:.1f} % — {band}.",
            })

    # ── EDV supporting evidence: only when heart_metrics_warnings is empty,
    #    otherwise the "absolute volumes may be unreliable" line replaces it.
    edv_warn_counts = False   # tracks whether EDV contributes to the downgrade count
    if volumes_unreliable:
        # Do not emit a numeric EDV verdict; the underlying number may be off
        # by orders of magnitude (see PIPELINE_INTEGRATION.md §6). We surface
        # the fact to the reader and to features_missing so it's visible in
        # the UI, but we do NOT count it as a warn for downgrade purposes —
        # EF is a ratio and remains trustworthy.
        evidence.append({
            "label":  "Absolute volumes",
            "level":  "warn",
            "detail": "Volume-based evidence suppressed — the heart-metrics "
                      "compute flagged the affine / spacing as suspicious "
                      "(see heartMetrics.warnings). Status is graded from EF "
                      "only; EF is a ratio and is unaffected by bad spacing.",
        })
        features_missing.append("EDV")
        warnings_out.append(
            "EDV evidence suppressed due to heartMetrics.warnings — "
            "confidence set to low."
        )
    elif edv is None:
        features_missing.append("EDV")
    else:
        features_used.append("EDV")
        lo, hi = EDV_MIN_MAX
        if lo <= edv <= hi:
            evidence.append({
                "label":  "End-Diastolic Volume",
                "level":  "ok",
                "detail": f"EDV {edv:.1f} mL — within the raw adult reference band "
                          f"({lo:.0f}-{hi:.0f} mL). Not BSA-indexed; body size not "
                          "accounted for.",
            })
        else:
            direction = "below" if edv < lo else "above"
            evidence.append({
                "label":  "End-Diastolic Volume",
                "level":  "warn",
                "detail": f"EDV {edv:.1f} mL — {direction} the raw adult reference "
                          f"band ({lo:.0f}-{hi:.0f} mL). Not BSA-indexed; body size "
                          "not accounted for.",
            })
            edv_warn_counts = True

    # ── Peak GCS supporting evidence (skip silently when null).
    gcs_warn_counts = False
    if peakGCS is None:
        features_missing.append("PeakGCS")
    else:
        features_used.append("PeakGCS")
        if peakGCS <= PEAK_GCS_HEALTHY_MAX:
            evidence.append({
                "label":  "Peak GCS",
                "level":  "ok",
                "detail": f"Peak GCS {peakGCS:.1f} % — within the expected normal "
                          f"range (<= {PEAK_GCS_HEALTHY_MAX:.0f} %, more negative = "
                          "better contraction). Reference is approximate.",
            })
        else:
            evidence.append({
                "label":  "Peak GCS",
                "level":  "warn",
                "detail": f"Peak GCS {peakGCS:.1f} % — less negative than the "
                          f"approximate normal (<= {PEAK_GCS_HEALTHY_MAX:.0f} %). "
                          "Reference varies by vendor/software.",
            })
            gcs_warn_counts = True

    # ── Peak GRS supporting evidence (skip silently when null).
    grs_warn_counts = False
    if peakGRS is None:
        features_missing.append("PeakGRS")
    else:
        features_used.append("PeakGRS")
        if peakGRS >= PEAK_GRS_HEALTHY_MIN:
            evidence.append({
                "label":  "Peak GRS",
                "level":  "ok",
                "detail": f"Peak GRS {peakGRS:.1f} % — within the expected normal "
                          f"range (>= {PEAK_GRS_HEALTHY_MIN:.0f} %). Reference is "
                          "approximate.",
            })
        else:
            evidence.append({
                "label":  "Peak GRS",
                "level":  "warn",
                "detail": f"Peak GRS {peakGRS:.1f} % — below the approximate normal "
                          f"threshold (>= {PEAK_GRS_HEALTHY_MIN:.0f} %). Reference "
                          "varies by vendor/software.",
            })
            grs_warn_counts = True

    # ── Downgrade rule (project heuristic).
    supporting_warn_count = sum([edv_warn_counts, gcs_warn_counts, grs_warn_counts])
    if grade_from_ef == "Indeterminate":
        status = "Indeterminate"
    elif supporting_warn_count >= 2 and grade_from_ef in ("Healthy", "Mild", "Moderate"):
        status = _downgrade_one_step(grade_from_ef)
        warnings_out.append(
            f"{supporting_warn_count} supporting signs abnormal — grade downgraded "
            f"{grade_from_ef} -> {status} (project heuristic; not a clinical rule)."
        )
    else:
        status = grade_from_ef

    # ── Confidence: "low" whenever EF is missing OR volume evidence was
    #    suppressed. "normal" otherwise (even with null strain — missing
    #    strain is not a confidence hit; it's an absent feature).
    if ef is None or volumes_unreliable:
        confidence = "low"
    else:
        confidence = "normal"

    return {
        "status":            status,
        "confidence":        confidence,
        "grade_from_ef":     grade_from_ef,
        "evidence":          evidence,
        "features_used":     features_used,
        "features_missing":  features_missing,
        "disclaimer":        DISCLAIMER,
        "method":            METHOD,
        "warnings":          warnings_out,
    }


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception as e:
        # Genuinely-malformed input (not "missing values" — those are handled
        # by the defensive branches inside compute()). Same convention as the
        # sibling scripts: single-line error JSON, exit 1.
        print(json.dumps({"error": f"Invalid input JSON: {e}"}), file=sys.stdout)
        sys.exit(1)

    measurements = data.get("measurements") if isinstance(data, dict) else None
    if not isinstance(measurements, dict):
        print(json.dumps({"error": "Missing or non-object 'measurements' field."}),
              file=sys.stdout)
        sys.exit(1)

    hm_warnings = data.get("heart_metrics_warnings", []) if isinstance(data, dict) else []

    result = compute(measurements, hm_warnings)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
