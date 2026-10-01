"""
compute_rv_regional_health_status.py
=====================================
RV analog of compute_regional_health_status.py — advisory, per-region RV
free-wall health assessment. Never changes any LV grade and never produces an
RV "diagnosis": it exists purely to flag which of the 9 RV regions looks
locally weak relative to this patient's own RV, same caveat-laden spirit as
the LV sibling.

RV has no validated per-segment (or even global) strain reference range at
all — unlike LV, where at least the GLOBAL peak-GCS cutoff (-17 %) is an
established EACVI/ASE figure. There is no RV-specific equivalent. We borrow
the SAME LV global cutoff here anyway, purely as a conservative, consistently
applied anchor — not because it is validated for RV. This is spelled out in
the disclaimer and must stay visible wherever this output is rendered.

I/O contract mirrors the LV sibling: read one JSON object from stdin, write
one JSON object to stdout. Non-recoverable errors print `{"error": "..."}`
and `sys.exit(1)`.

Input (stdin JSON):
    regions              — list[{region:int, label:str, gcs:float|null, gas:float|null}]
                           The 9 RV free-wall region values (1-9, basal-first:
                           1-3 basal, 4-6 mid, 7-9 apical — same convention as
                           CRESCENT_REGION_NAMES in CombinedVentricularChart.tsx
                           / heartColor.ts). May be short, may contain nulls.
    source?              — "rvStrain" | "rvStrainSeries"  (provenance, echoed out)
    unavailable_reason?  — str. When set, short-circuits to status="unavailable".
                           The caller uses this when RV strain is missing, or
                           when the RV strain frames are not aligned to the
                           heart-metrics ED/ES pair — this layer is READ-ONLY
                           w.r.t. RV strain, it never recomputes it.

Output (stdout JSON): same shape as compute_regional_health_status.py's
output, with `segments[]` renamed in spirit to `region`-keyed entries (field
name kept as `segments` for the frontend/backend to share one rendering
pattern), and `gas` carried through per-region as supporting context (never
drives the level, same role GRS plays for LV).

Sign convention — same as LV GCS (visheart-inference-gpu bullseye_route.py):
    gcs = (chord_ES - chord_ED) / chord_ED * 100  -> percent, MORE NEGATIVE =
                                                      better free-wall shortening
RV's `gas` (cavity-area change) is carried through unmodified, context only.

Pure Python. No numpy, no scipy.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Optional


# ── RV 9-region ring mapping ─────────────────────────────────────────────────
# Matches CRESCENT_REGION_NAMES in
# visheart-frontend/src/components/landmark/CombinedVentricularChart.tsx and
# the comment in heartColor.ts: 1-9, Basal-first — Basal_Seg1-3, Mid_Seg1-3,
# Apical_Seg1-3. Duplicated rather than imported because that module lives in
# the frontend, a separate deployable.
_REGION_OF: dict[int, str] = {}
for _i in range(1, 4):  _REGION_OF[_i] = "basal"    # 1-3
for _i in range(4, 7):  _REGION_OF[_i] = "mid"      # 4-6
for _i in range(7, 10): _REGION_OF[_i] = "apical"   # 7-9

_REGION_ORDER = ["basal", "mid", "apical"]
_N_REGIONS = 9


# ── Thresholds ───────────────────────────────────────────────────────────────
# ABSOLUTE anchor — BORROWED from the LV global peak-GCS cutoff, the same
# figure compute_regional_health_status.py uses for LV per-segment GCS
# (itself already a borrowed-global-for-per-segment approximation there).
# For RV there is no validated reference at ANY level — global or segmental —
# so this is one borrow further removed from evidence than the LV version.
# Source of the anchor value itself:
#     Voigt J-U et al. 2015. "Definitions for a common standard for 2D speckle
#     tracking echocardiography: consensus document of the EACVI/ASE/Industry
#     Task Force." Eur Heart J Cardiovasc Imaging 16(1):1-11.
SEG_GCS_NORMAL_MAX = -17.0    # gcs <= this  -> absolute band "normal"
SEG_GCS_MILD_MAX = -12.0      # -17 < gcs <= -12 -> "mild"
SEG_GCS_MODERATE_MAX = -7.0   # -12 < gcs <= -7  -> "moderate"; gcs > -7 -> "severe"

# RELATIVE rule (project heuristic — NOT a clinical guideline), identical in
# spirit to the LV sibling: a region must also be at least this much worse
# than the patient's OWN mean regional GCS before it counts as a focal
# defect, so a uniformly weak RV free wall isn't reported as 9 separate
# "defects".
REL_GAP_PCT = 25.0

# A patient mean this close to zero makes the relative gap meaningless.
_MIN_ABS_MEAN_GCS = 2.0

DISCLAIMER = (
    "Advisory regional assessment, not a diagnosis. Unlike the LV, the RV has "
    "no validated strain reference range at ANY level — global or per-region. "
    "Thresholds here are borrowed from the LV's global strain reference purely "
    "as a conservative, consistently applied anchor, and must be interpreted "
    "by a qualified clinician alongside the full clinical picture. This layer "
    "never changes any LV grade and produces no RV grade of its own."
)
METHOD = (
    "Hybrid per-region classification: absolute GCS band (anchored on the "
    "LV's EACVI/ASE global peak-GCS reference, borrowed — not RV-validated) "
    "AND a relative gap versus the patient's own mean regional RV GCS."
)

_LEVEL_RANK = {"normal": 0, "mild": 1, "moderate": 2, "severe": 3}


def _num(v) -> Optional[float]:
    """Return v as a finite float, or None if null/NaN/Inf/unparseable."""
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def _absolute_level(gcs: float) -> str:
    """Absolute band for one region's GCS. More negative = better."""
    if gcs <= SEG_GCS_NORMAL_MAX:
        return "normal"
    if gcs <= SEG_GCS_MILD_MAX:
        return "mild"
    if gcs <= SEG_GCS_MODERATE_MAX:
        return "moderate"
    return "severe"


def _unavailable(reason: str, source=None) -> dict:
    """Uniform 'we cannot assess this' payload. Deliberately NOT "healthy"."""
    return {
        "status": "unavailable",
        "overall_grade_unchanged": True,
        "source": source,
        "segments": [],
        "reduced_count": 0,
        "affected_idx": [],
        "skipped_idx": [],
        "summary": "Regional assessment unavailable — " + reason,
        "patient_mean_gcs": None,
        "thresholds": {
            "seg_gcs_normal_max": SEG_GCS_NORMAL_MAX,
            "seg_gcs_mild_max": SEG_GCS_MILD_MAX,
            "seg_gcs_moderate_max": SEG_GCS_MODERATE_MAX,
            "rel_gap_pct": REL_GAP_PCT,
        },
        "disclaimer": DISCLAIMER,
        "method": METHOD,
        "warnings": [reason],
    }


def compute(payload: dict) -> dict:
    """Classify per-region RV strain. Pure — no I/O, unit-testable via JSON."""
    source = payload.get("source")

    reason = payload.get("unavailable_reason")
    if reason:
        return _unavailable(str(reason), source)

    raw_regions = payload.get("regions")
    if not isinstance(raw_regions, list) or not raw_regions:
        return _unavailable("no per-region RV strain data was supplied.", source)

    warnings_out: list[str] = []

    # ── Pass 1: collect usable regions (GCS required; GAS is context) ────────
    usable: list[dict] = []
    skipped_idx: list[int] = []
    for reg in raw_regions:
        if not isinstance(reg, dict):
            continue
        idx = reg.get("region")
        try:
            idx = int(idx)
        except (TypeError, ValueError):
            continue
        if idx not in _REGION_OF:
            continue
        gcs = _num(reg.get("gcs"))
        if gcs is None:
            gcs = _num(reg.get("strain"))  # rvStrain.regions[].strain currently equals gcs
        gas = _num(reg.get("gas"))
        if gcs is None:
            skipped_idx.append(idx)
            continue
        usable.append({
            "idx": idx,
            "region": _REGION_OF[idx],
            "label": reg.get("label"),
            "gcs": gcs,
            "gas": gas,
        })

    skipped_idx.sort()
    if not usable:
        out = _unavailable("no RV region had a usable GCS value.", source)
        out["skipped_idx"] = skipped_idx
        return out

    if len(usable) < _N_REGIONS:
        warnings_out.append(
            f"Only {len(usable)} of 9 RV regions had usable GCS "
            f"({len(skipped_idx)} skipped) — regional coverage is partial."
        )

    # ── Patient's own mean, the reference for the relative rule ──────────────
    mean_gcs = sum(s["gcs"] for s in usable) / len(usable)

    relative_enabled = abs(mean_gcs) >= _MIN_ABS_MEAN_GCS
    if not relative_enabled:
        warnings_out.append(
            f"Mean regional RV GCS ({mean_gcs:.2f} %) is too close to zero for "
            "the relative rule to be meaningful — regions classified on the "
            "absolute band alone, which may over-report."
        )

    rel_gap_threshold = abs(mean_gcs) * (REL_GAP_PCT / 100.0)

    # ── Pass 2: hybrid classification ────────────────────────────────────────
    segments_out: list[dict] = []
    for s in usable:
        abs_level = _absolute_level(s["gcs"])
        gap = s["gcs"] - mean_gcs
        rel_flag = (gap >= rel_gap_threshold) if relative_enabled else True

        level = abs_level if (abs_level != "normal" and rel_flag) else "normal"

        segments_out.append({
            "idx": s["idx"],
            "region": s["region"],
            "label": s["label"],
            "gcs": round(s["gcs"], 2),
            "gas": round(s["gas"], 2) if s["gas"] is not None else None,
            "level": level,
            "abs_level": abs_level,
            "rel_gap": round(gap, 2),
            "rel_flag": rel_flag,
        })

    segments_out.sort(key=lambda s: s["idx"])

    affected = [s for s in segments_out if s["level"] != "normal"]
    affected_idx = [s["idx"] for s in affected]

    if not affected:
        globally_low = _absolute_level(mean_gcs) != "normal"
        if globally_low:
            summary = (
                "No focal regional defect — RV free-wall strain is uniformly "
                f"reduced (mean GCS {mean_gcs:.1f} %)."
            )
        else:
            summary = "All RV regions within the borrowed normal range"
    else:
        worst = max(affected, key=lambda s: _LEVEL_RANK[s["level"]])["level"]
        counts: dict[str, int] = {}
        for s in affected:
            counts[s["region"]] = counts.get(s["region"], 0) + 1
        parts = [f"{counts[r]} {r}" for r in _REGION_ORDER if r in counts]
        if len(parts) == 1:
            where = parts[0]
        else:
            where = ", ".join(parts[:-1]) + " and " + parts[-1]
        n = len(affected)
        summary = (
            f"{worst.capitalize()} reduction in {where} "
            f"RV region{'s' if n != 1 else ''}"
        )

    return {
        "status": "ok",
        "overall_grade_unchanged": True,
        "source": source,
        "segments": segments_out,
        "reduced_count": len(affected),
        "affected_idx": affected_idx,
        "skipped_idx": skipped_idx,
        "summary": summary,
        "patient_mean_gcs": round(mean_gcs, 2),
        "relative_rule_applied": relative_enabled,
        "thresholds": {
            "seg_gcs_normal_max": SEG_GCS_NORMAL_MAX,
            "seg_gcs_mild_max": SEG_GCS_MILD_MAX,
            "seg_gcs_moderate_max": SEG_GCS_MODERATE_MAX,
            "rel_gap_pct": REL_GAP_PCT,
            "rel_gap_threshold_abs": round(rel_gap_threshold, 3),
        },
        "disclaimer": DISCLAIMER,
        "method": METHOD,
        "warnings": warnings_out,
    }


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"error": f"Invalid input JSON: {e}"}), file=sys.stdout)
        sys.exit(1)

    if not isinstance(data, dict):
        print(json.dumps({"error": "Input JSON must be an object."}), file=sys.stdout)
        sys.exit(1)

    print(json.dumps(compute(data)))


if __name__ == "__main__":
    main()
