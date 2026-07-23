"""
compute_disease_similarity.py
=============================
Disease Pattern Similarity Assessment.

IMPORTANT — this is NOT a diagnostic tool.
It does not diagnose, predict, or make any medical decision. It answers a single
descriptive question: "Which known cardiac reference pattern (NOR / HCM / DCM)
is this patient's set of measurements most SIMILAR to?" — and shows the reasoning
behind that similarity so a clinician can judge it for themselves.

Methodology (explainable, defensible, no training data required)
----------------------------------------------------------------
For each candidate reference profile p and each feature f we hold a literature-
derived mean (mu) and standard deviation (sd). Given a patient value x_f:

    z_{p,f}  = (x_f - mu_{p,f}) / sd_{p,f}          # how many SDs from the profile
    d_p      = sqrt( sum_f w_f * z_{p,f}^2 )        # weighted Euclidean distance in z-space

The weighted distances are turned into similarity percentages with a softmax over
the *negative* distances (closer profile → higher %):

    s_p = exp(-d_p / T) / sum_q exp(-d_q / T)

`T` (temperature) controls how decisively the winner dominates. Percentages sum
to 100. Only features the patient actually provides (non-null) are used, and the
weights are renormalised over the available features so a missing metric never
biases one profile over another.

Why z-score weighted distance (and not Mahalanobis / cosine)
------------------------------------------------------------
* Mahalanobis needs a per-disease covariance matrix — that requires a labelled
  per-patient dataset we do not have. z-scoring with a literature SD is the
  diagonal-covariance special case and is the honest choice given the data.
* Cosine ignores magnitude, so a mildly and a severely dilated ventricle look
  identical — clinically wrong for volume data.
* z-score distance is fully explainable: every profile's score decomposes into
  per-metric contributions we can print as plain-language reasoning.

I/O contract (mirrors compute_heart_metrics_from_rle.py)
--------------------------------------------------------
Read one JSON object from stdin, write one JSON object to stdout. Non-recoverable
errors print `{"error": "..."}` and sys.exit(1).

Input (stdin JSON):
    measurements — {                       # any subset; nulls are ignored
        "EF": float|null,                  # LV ejection fraction, %
        "EDV": float|null,                 # LV end-diastolic volume, mL
        "ESV": float|null,                 # LV end-systolic volume, mL
        "StrokeVolume": float|null,        # mL
        "PeakGRS": float|null,             # peak global radial strain, %
        "PeakGCS": float|null              # peak global circumferential strain, %
    }
    temperature? — float (optional, default 1.0)   # softmax sharpness

Output (stdout JSON):
    most_similar        — "NOR" | "HCM" | "DCM"
    similarities        — [{code,label,percent,distance,reasons[]}] sorted desc
    features_used       — list[str]          # metrics that were non-null
    features_missing    — list[str]
    disclaimer          — fixed non-diagnostic disclaimer string
    method              — short method identifier for audit
    warnings            — list[str]

Reference values
----------------
Profiles are LITERATURE-DERIVED (population means/SDs), not fitted to this app's
data. See docs/DISEASE_SIMILARITY_REFERENCES.md for the citation of each number.
NOR = normal, HCM = hypertrophic cardiomyopathy, DCM = dilated cardiomyopathy.

Pure Python + numpy. No cv2 / nibabel / scipy.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Optional

import numpy as np


# ── Feature set ───────────────────────────────────────────────────────────────
# The measurement keys this module reasons over, in a stable display order.
FEATURES: list[str] = ["EF", "EDV", "ESV", "StrokeVolume", "PeakGRS", "PeakGCS"]

# Human-readable feature names for the explanation strings.
FEATURE_LABELS: dict[str, str] = {
    "EF":           "Ejection Fraction",
    "EDV":          "End-Diastolic Volume",
    "ESV":          "End-Systolic Volume",
    "StrokeVolume": "Stroke Volume",
    "PeakGRS":      "Peak Global Radial Strain",
    "PeakGCS":      "Peak Global Circumferential Strain",
}

# Per-feature weights. EF and the volumes carry the most discriminative signal
# for NOR/HCM/DCM; strain is supporting evidence (and is more sensitive to the
# app's own measurement noise), so it is down-weighted. Weights are renormalised
# at run time over whichever features the patient actually has.
FEATURE_WEIGHTS: dict[str, float] = {
    "EF":           1.0,
    "EDV":          1.0,
    "ESV":          0.8,
    "StrokeVolume": 0.5,
    "PeakGRS":      0.6,
    "PeakGCS":      0.6,
}

# ── Reference profiles (mean, sd) per feature ─────────────────────────────────
# Values are population-level references, NOT fitted to this application's data.
# Every number is cited in docs/DISEASE_SIMILARITY_REFERENCES.md.
#
# EF, EDV and ESV are ACDC cohort group statistics (mean ± SD measured over the
# 30 patients in each group) — the same dataset this project's segmentation is
# built on. StrokeVolume mean = EDV - ESV of the group means; its SD is not
# reported, so it is combined in quadrature from the EDV/ESV SDs (approximate).
# See docs/DISEASE_SIMILARITY_REFERENCES.md for provenance and caveats.
#
# NOTE (validation caveat): recomputing EF from this project's own ACDC
# ground-truth masks gave DCM EF ≈ 14.1 ± 5.4 % (n=6 usable patients), which is
# lower than the 25.2 % below. Most patients could not be used because the masks
# have differing slice counts at ED vs ES, so that check is weak evidence — but
# it is the reason the DCM EF here should be treated as provisional.
#
# PeakGRS / PeakGCS are ACDC cohort strain statistics (mean ± SD per group).
# Sign convention: GCS is negative (circumferential shortening), GRS is positive
# (radial thickening). These were not derivable from this project's own 2-frame
# ground-truth masks (strain needs the full tracked cine), so they are taken from
# the reported cohort statistics rather than measured locally.
#
#   NOR — healthy adult LV.
#   HCM — hypertrophic cardiomyopathy: preserved/high EF, small cavity, impaired
#         circumferential strain.
#   DCM — dilated cardiomyopathy: large cavity, low EF, low strain magnitudes.
#
# Units: EF %, volumes mL, PeakGRS %, PeakGCS % (negative by convention).
REFERENCE_PROFILES: dict[str, dict[str, tuple[float, float]]] = {
    "NOR": {
        "EF":           (62.7,  5.6),   # ACDC group mean (n=30)
        "EDV":          (139.1, 33.2),  # ACDC group mean (n=30)
        "ESV":          (53.8,  18.0),  # ACDC group mean (n=30)
        "StrokeVolume": (85.3,  37.8),  # EDV - ESV; SD quadrature (approx)
        "PeakGRS":      (40.3,  10.2),  # ACDC cohort strain stats
        "PeakGCS":      (-16.8, 2.3),   # ACDC cohort strain stats
    },
    "HCM": {
        "EF":           (61.9,  12.6),  # ACDC group mean (n=30)
        "EDV":          (138.4, 56.8),  # ACDC group mean (n=30)
        "ESV":          (53.6,  34.3),  # ACDC group mean (n=30)
        "StrokeVolume": (84.8,  66.3),  # EDV - ESV; SD quadrature (approx)
        "PeakGRS":      (37.8,  13.2),  # ACDC cohort strain stats
        "PeakGCS":      (-14.5, 3.3),   # ACDC cohort strain stats
    },
    "DCM": {
        "EF":           (25.2,  9.0),   # ACDC group mean (n=30) — see validation caveat
        "EDV":          (248.3, 73.1),  # ACDC group mean (n=30)
        "ESV":          (170.8, 58.7),  # ACDC group mean (n=30)
        "StrokeVolume": (77.5,  93.7),  # EDV - ESV; SD quadrature (approx)
        "PeakGRS":      (11.2,  6.5),   # ACDC cohort strain stats
        "PeakGCS":      (-5.6,  2.2),   # ACDC cohort strain stats
    },
}

PROFILE_LABELS: dict[str, str] = {
    "NOR": "Healthy (Normal)",
    "HCM": "Hypertrophic Cardiomyopathy",
    "DCM": "Dilated Cardiomyopathy",
}

DISCLAIMER = (
    "This is a similarity assessment, not a diagnosis. It reports which known "
    "cardiac reference pattern the measurements most resemble and must be "
    "interpreted by a qualified clinician alongside the full clinical picture."
)

# How many SDs away a feature must be for the reasoning text to call it out.
_NOTABLE_Z = 1.0


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
    if feature in ("EDV", "ESV"):
        return "enlarged relative to" if higher else "smaller than"
    if feature in ("EF", "StrokeVolume", "PeakGRS"):
        return "higher than" if higher else "reduced compared with"
    if feature == "PeakGCS":
        # More negative GCS = stronger contraction. "Higher magnitude" reads clearer.
        return ("stronger (more negative) than" if patient < mu
                else "weaker (less negative) than")
    return "higher than" if higher else "lower than"


def compute_similarity(
    measurements: dict, temperature: float = 1.0
) -> dict:
    """Core similarity computation. Pure function — no I/O.

    Returns the full output dict (see module docstring). Raises ValueError only
    when no usable features are present.
    """
    # 1. Collect the features the patient actually provides.
    patient: dict[str, float] = {}
    for f in FEATURES:
        v = _safe_float(measurements.get(f))
        if v is not None:
            patient[f] = v

    features_used = [f for f in FEATURES if f in patient]
    features_missing = [f for f in FEATURES if f not in patient]

    if not features_used:
        raise ValueError(
            "No usable measurements provided — need at least one of "
            f"{FEATURES} to compute a similarity."
        )

    # 2. Renormalise weights over available features so a missing metric does
    #    not shift the balance between profiles.
    w_total = sum(FEATURE_WEIGHTS[f] for f in features_used)
    weights = {f: FEATURE_WEIGHTS[f] / w_total for f in features_used}

    warnings_out: list[str] = []
    if len(features_used) < 3:
        warnings_out.append(
            f"Only {len(features_used)} measurement(s) available "
            f"({', '.join(features_used)}) — similarity is less reliable with "
            "fewer features."
        )

    # 3. Weighted z-distance to each profile + per-feature z for reasoning.
    distances: dict[str, float] = {}
    z_by_profile: dict[str, dict[str, float]] = {}
    for code, profile in REFERENCE_PROFILES.items():
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

    # 4. Softmax over negative distances → similarity percentages.
    T = temperature if temperature and temperature > 1e-6 else 1.0
    neg = np.array([-distances[c] / T for c in REFERENCE_PROFILES], dtype=np.float64)
    neg -= neg.max()  # numerical stability
    exp = np.exp(neg)
    probs = exp / exp.sum()
    percents = {c: float(round(p * 100.0, 1))
                for c, p in zip(REFERENCE_PROFILES, probs)}

    # 5. Build per-profile reasoning from the most notable feature deviations.
    def _reasons_for(code: str) -> list[str]:
        zs = z_by_profile[code]
        profile = REFERENCE_PROFILES[code]
        # Rank features by how well they MATCH this profile (small |z| = good match).
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
        for code in REFERENCE_PROFILES
    ]
    similarities.sort(key=lambda s: s["percent"], reverse=True)

    return {
        "most_similar":     similarities[0]["code"],
        "similarities":     similarities,
        "features_used":    features_used,
        "features_missing": features_missing,
        "temperature":      T,
        "disclaimer":       DISCLAIMER,
        "method":           "zscore-weighted-distance+softmax",
        "warnings":         warnings_out,
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

    temperature = _safe_float(data.get("temperature")) or 1.0

    try:
        result = compute_similarity(measurements, temperature=temperature)
    except ValueError as e:
        print(json.dumps({"error": str(e)}), file=sys.stdout)
        sys.exit(1)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
