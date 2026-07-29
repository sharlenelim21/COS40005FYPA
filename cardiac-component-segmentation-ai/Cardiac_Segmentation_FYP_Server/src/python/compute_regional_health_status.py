"""
compute_regional_health_status.py
=================================
Layer 2 — REGIONAL (per-AHA-segment) health assessment. **Advisory only.**

This module sits BESIDE the overall (Layer-1) health status produced by
`compute_health_status.py`. It never changes, downgrades, or re-grades the
overall status: Layer 1 answers "how is the pump doing overall?" from LVEF,
Layer 2 answers "is there a LOCAL weak spot?" from per-segment strain. The two
are stored in separate fields (`healthStatus` vs `regionalHealthStatus`) and are
computed from separate inputs, so Layer 1's output is byte-identical whether or
not this module ever runs — asserted by scripts/check_regional_health_status.js.

I/O contract mirrors the sibling modules: read one JSON object from stdin, write
one JSON object to stdout. Non-recoverable errors print `{"error": "..."}` and
`sys.exit(1)`.

Input (stdin JSON):
    segments            — list[{segment:int, label:str, gcs:float|null, grs:float|null}]
                          The 17 AHA per-segment strain values. May be short,
                          may contain nulls — both are handled, never fatal.
    source?             — "strain" | "strainSeries"   (provenance, echoed out)
    unavailable_reason? — str. When set, the module short-circuits to
                          status="unavailable" without classifying anything.
                          The caller uses this when strain is missing, or when
                          the strain frames do not align to the heart-metrics
                          ED/ES pair (this layer is READ-ONLY w.r.t. strain — it
                          never recomputes it).

Output (stdout JSON): see docs/REGIONAL_HEALTH_STATUS_IMPLEMENTATION.md §4.

Sign conventions — verified against the GPU source that produces these numbers
(visheart-inference-gpu/app/routes/bullseye_route.py:321,328), NOT assumed:
    gcs = (circ_ES - circ_ED) / circ_ED * 100   -> percent, MORE NEGATIVE = better
                                                   circumferential shortening
    grs = (wt_ES   - wt_ED)   / wt_ED   * 100   -> percent, MORE POSITIVE = better
                                                   radial thickening
GCS is the primary axis here because it is the better-standardised of the two;
GRS is carried through as supporting context only and never drives the level.

Pure Python. No numpy, no scipy.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Optional


# ── AHA 17-segment ring mapping ──────────────────────────────────────────────
# Mirrors AHA_SEGMENTS in visheart-inference-gpu/app/bullseye_analysis.py
# (ring 0 basal, 1 mid, 2 apical, 3 apex). Duplicated rather than imported
# because that module lives in the GPU service, a separate deployable.
_REGION_OF: dict[int, str] = {}
for _i in range(1, 7):    _REGION_OF[_i] = "basal"     # 1-6
for _i in range(7, 13):   _REGION_OF[_i] = "mid"       # 7-12
for _i in range(13, 17):  _REGION_OF[_i] = "apical"    # 13-16
_REGION_OF[17] = "apex"                                # 17

_REGION_ORDER = ["basal", "mid", "apical", "apex"]


# ── Thresholds ───────────────────────────────────────────────────────────────
# ABSOLUTE anchor. -17 % is the peak-GCS "normal or better" cutoff this project
# already uses for the GLOBAL value in compute_health_status.py
# (PEAK_GCS_HEALTHY_MAX), sourced there from:
#     Voigt J-U et al. 2015. "Definitions for a common standard for 2D speckle
#     tracking echocardiography: consensus document of the EACVI/ASE/Industry
#     Task Force." Eur Heart J Cardiovasc Imaging 16(1):1-11.
#
# IMPORTANT CAVEAT, stated plainly because it affects how this output should be
# read: that -17 % figure is a GLOBAL strain reference. A well-standardised
# PER-SEGMENT normal range does not exist — segmental values vary substantially
# by vendor, software, wall and slice level. We deliberately BORROW the global
# cutoff as a conservative anchor rather than invent a segmental number, and we
# require the RELATIVE rule below to also fire before calling anything abnormal.
# This is why the output is labelled advisory and not diagnostic.
SEG_GCS_NORMAL_MAX = -17.0    # gcs <= this  -> absolute band "normal"
SEG_GCS_MILD_MAX = -12.0      # -17 < gcs <= -12 -> "mild"
SEG_GCS_MODERATE_MAX = -7.0   # -12 < gcs <= -7  -> "moderate"; gcs > -7 -> "severe"

# RELATIVE rule (project heuristic — NOT a clinical guideline). A segment must
# also be at least this much worse than the patient's OWN mean segmental GCS
# before it counts as a focal defect. Expressed as a percentage of |mean|.
#
# This gate is what stops a uniformly-weak heart from being reported as 17
# separate local defects: if every segment is equally low, no segment stands out
# from the mean, so reduced_count is 0 and the global problem is left to Layer 1
# (which grades it from EF). See docs §5 and check test [4].
REL_GAP_PCT = 25.0

# A patient mean this close to zero makes the relative gap meaningless
# (dividing by ~0 explodes), so we fall back to absolute-only and say so.
_MIN_ABS_MEAN_GCS = 2.0

DISCLAIMER = (
    "Advisory regional assessment, not a diagnosis. Per-segment strain normals "
    "are not standardised; thresholds are borrowed from global strain references "
    "and must be interpreted by a qualified clinician alongside the full clinical "
    "picture. This layer never changes the overall health-status grade."
)
METHOD = (
    "Hybrid per-segment classification: absolute GCS band (anchored on the "
    "EACVI/ASE global peak-GCS reference) AND a relative gap versus the "
    "patient's own mean segmental GCS."
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
    """Absolute band for one segment's GCS. More negative = better."""
    if gcs <= SEG_GCS_NORMAL_MAX:
        return "normal"
    if gcs <= SEG_GCS_MILD_MAX:
        return "mild"
    if gcs <= SEG_GCS_MODERATE_MAX:
        return "moderate"
    return "severe"


def _unavailable(reason: str, source=None) -> dict:
    """Uniform 'we cannot assess this' payload.

    Deliberately NOT "healthy" — absence of regional strain is absence of
    evidence, and reporting it as normal would be the most dangerous possible
    default for this feature.
    """
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
    """Classify per-segment strain. Pure — no I/O, unit-tested by feeding JSON."""
    source = payload.get("source")

    # Caller-declared short circuit (strain absent, or ED/ES not aligned).
    reason = payload.get("unavailable_reason")
    if reason:
        return _unavailable(str(reason), source)

    raw_segments = payload.get("segments")
    if not isinstance(raw_segments, list) or not raw_segments:
        return _unavailable("no per-segment strain data was supplied.", source)

    warnings_out: list[str] = []

    # ── Pass 1: collect usable segments (GCS is required; GRS is context) ────
    usable: list[dict] = []
    skipped_idx: list[int] = []
    for seg in raw_segments:
        if not isinstance(seg, dict):
            continue
        idx = seg.get("segment")
        try:
            idx = int(idx)
        except (TypeError, ValueError):
            continue
        if idx not in _REGION_OF:
            # Out-of-range index — ignore rather than guess a region for it.
            continue
        gcs = _num(seg.get("gcs"))
        grs = _num(seg.get("grs"))
        if gcs is None:
            # NaN / null / missing GCS: note it and move on, never invent.
            skipped_idx.append(idx)
            continue
        usable.append({
            "idx": idx,
            "region": _REGION_OF[idx],
            "label": seg.get("label"),
            "gcs": gcs,
            "grs": grs,
        })

    skipped_idx.sort()
    if not usable:
        out = _unavailable("no segment had a usable GCS value.", source)
        out["skipped_idx"] = skipped_idx
        return out

    if len(usable) < len(_REGION_OF):
        warnings_out.append(
            f"Only {len(usable)} of 17 AHA segments had usable GCS "
            f"({len(skipped_idx)} skipped) — regional coverage is partial."
        )

    # ── Patient's own mean, the reference for the relative rule ──────────────
    mean_gcs = sum(s["gcs"] for s in usable) / len(usable)

    relative_enabled = abs(mean_gcs) >= _MIN_ABS_MEAN_GCS
    if not relative_enabled:
        warnings_out.append(
            f"Mean segmental GCS ({mean_gcs:.2f} %) is too close to zero for the "
            "relative rule to be meaningful — segments classified on the absolute "
            "band alone, which may over-report."
        )

    # Gap (in GCS percentage points) a segment must exceed to count as focal.
    rel_gap_threshold = abs(mean_gcs) * (REL_GAP_PCT / 100.0)

    # ── Pass 2: hybrid classification ────────────────────────────────────────
    segments_out: list[dict] = []
    for s in usable:
        abs_level = _absolute_level(s["gcs"])
        # GCS is signed with "more negative = better", so a segment is worse
        # than the mean when its value is GREATER (less negative) than the mean.
        gap = s["gcs"] - mean_gcs
        rel_flag = (gap >= rel_gap_threshold) if relative_enabled else True

        # HYBRID: a segment is only reported as reduced when the absolute band
        # says it is abnormal AND it stands out from this patient's own mean.
        level = abs_level if (abs_level != "normal" and rel_flag) else "normal"

        segments_out.append({
            "idx": s["idx"],
            "region": s["region"],
            "label": s["label"],
            "gcs": round(s["gcs"], 2),
            "grs": round(s["grs"], 2) if s["grs"] is not None else None,
            "level": level,
            # Transparency: the two halves of the hybrid rule, so a reader can
            # see WHY a low segment was or wasn't called a focal defect.
            "abs_level": abs_level,
            "rel_gap": round(gap, 2),
            "rel_flag": rel_flag,
        })

    segments_out.sort(key=lambda s: s["idx"])

    affected = [s for s in segments_out if s["level"] != "normal"]
    affected_idx = [s["idx"] for s in affected]

    # ── Summary line ─────────────────────────────────────────────────────────
    if not affected:
        globally_low = _absolute_level(mean_gcs) != "normal"
        if globally_low:
            # Every segment is weak, but none is focally worse than the others.
            # Say so explicitly — silence here would read as "all fine".
            summary = (
                "No focal regional defect — segmental strain is uniformly reduced "
                f"(mean GCS {mean_gcs:.1f} %). Overall function is graded by the "
                "primary health status."
            )
        else:
            summary = "All segments within normal range"
    else:
        worst = max(affected, key=lambda s: _LEVEL_RANK[s["level"]])["level"]
        counts: dict[str, int] = {}
        for s in affected:
            counts[s["region"]] = counts.get(s["region"], 0) + 1
        # Name regions in anatomical order for a stable, readable sentence.
        parts = [f"{counts[r]} {r}" for r in _REGION_ORDER if r in counts]
        if len(parts) == 1:
            where = parts[0]
        else:
            where = ", ".join(parts[:-1]) + " and " + parts[-1]
        n = len(affected)
        summary = (
            f"{worst.capitalize()} reduction in {where} "
            f"segment{'s' if n != 1 else ''}"
        )

    return {
        "status": "ok",
        # Explicit, machine-readable promise that Layer 1 was not touched.
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
