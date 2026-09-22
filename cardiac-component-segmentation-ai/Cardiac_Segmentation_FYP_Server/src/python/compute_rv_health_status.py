"""
compute_rv_health_status.py
===========================
Rule-based RV health status: compares a mask's RV measurements with published
sex-specific reference ranges. Same I/O contract as compute_health_status.py —
one JSON object on stdin, one JSON object on stdout.

**This module is NOT a diagnostic tool, and it does NOT grade severity.**

Why there are no severity bands
-------------------------------
No prognostically validated CMR severity grading exists for RV systolic
function. The one formal CMR banding (EACVI 2019) borrowed its lower bands from
the echocardiographic LVEF partitions rather than deriving them from RV data.
This module therefore reports only whether each value lies inside the published
reference range. (Basis: literature review of 2026-09-10 — verify before citing.)

Reference ranges
----------------
Kawel-Boehm N, et al. Society for Cardiovascular Magnetic Resonance reference
values ("normal values") in cardiovascular magnetic resonance: 2025 update.
J Cardiovasc Magn Reson 2025;27:101853. Pooled healthy adults; limits are the
2.5th and 97.5th percentiles.

The table used counts papillary muscles and trabeculations as blood-pool
VOLUME. That matches our segmentation model's training labels: the ACDC and
M&Ms annotation protocol requires the LV and RV cavities to be completely
covered, including the papillary muscles.

                        Men         Women
    RVEF LLN (%)        44          47
    RVEDVi (mL/m^2)     47 - 116    44 - 99
    RVESVi (mL/m^2)     16 - 52     13 - 43

Verify these against the published tables before citing them anywhere.

Rules
-----
Limits are inclusive. BSA is required only for the indexed volumes.

No sex-blind threshold is ever used. With sex "male" or "female" each value is
compared with that sex's limits. With sex "unspecified" each value is compared
with BOTH sexes' limits and gets a verdict only where they agree:

    inside both      -> "ok"
    outside both     -> "warn"
    inside only one  -> "unavailable" with depends_on_sex: true, naming which
                        sex it is normal for

    RVEF   : against the lower limit of normal; "unavailable" when null.
    RVEDVi : volume / BSA against the range; "unavailable" without the raw
    RVESVi   volume or BSA.

    When volume_reliability reports a suspicious voxel volume or a duplicated
    RV-cavity slice, one "unavailable" "Absolute RV volumes" line replaces both
    indexed lines. RVEF is still assessed.

    status, first rule that applies:
        "Not assessable"          RVEF could not be computed
        "Outside reference range" any value is "warn" (outside its range, or
                                  outside both ranges when no sex was given)
        "Depends on sex"          no sex was given and a value is normal for
                                  one sex but not the other
        "Within reference range"  otherwise
    confidence : "low" when RVEF is null or absolute RV volumes are unreliable.
                 A missing sex or BSA is a missing input, not a data problem,
                 and does not lower confidence.

This module never reads or changes the LV result from compute_health_status.py.

Input (stdin JSON)
------------------
    rv              — { RVEF, RVEDV, RVESV } from heartMetrics; any may be null
    sex             — "male" | "female"; anything else counts as "unspecified"
    bsa_m2          — body surface area in m^2; optional
    volume_signals  — { voxel_mm3, duplicate_slices } from heartMetrics

Output (stdout JSON)
--------------------
    status, confidence, sex and bsa_m2 (normalised and echoed, so a stored
    result can be matched to the inputs shown on the page), evidence[] (each
    {label, level, detail}, plus depends_on_sex: true on a line whose verdict
    depends on sex), features_used, features_missing, reference{source,
    convention, sex, rvef_lower_limit, rvedvi_range, rvesvi_range, by_sex},
    disclaimer, method, warnings. The single-sex limit fields are null when no
    sex was given; by_sex always carries both sexes' limits.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Any, Optional

from volume_reliability import duplicate_slice_issue, voxel_size_issue


# ── Constants ────────────────────────────────────────────────────────────────

REFERENCE_SOURCE = (
    'Kawel-Boehm N, et al. SCMR reference values ("normal values") in '
    "cardiovascular magnetic resonance: 2025 update. J Cardiovasc Magn Reson "
    "2025;27:101853"
)
REFERENCE_CONVENTION = "papillary muscles and trabeculations counted as blood-pool volume"

# Lower limit of normal for RVEF (%) and inclusive indexed-volume ranges (mL/m²).
RV_REFERENCE = {
    "male":   {"rvef_lln": 44.0, "rvedvi": (47.0, 116.0), "rvesvi": (16.0, 52.0)},
    "female": {"rvef_lln": 47.0, "rvedvi": (44.0, 99.0),  "rvesvi": (13.0, 43.0)},
}

# heartMetrics.duplicate_slices[].class value for the RV cavity.
RV_CAVITY_CLASS = "rv"

RVEF_LABEL = "RV Ejection Fraction"
RVEDVI_LABEL = "RV End-Diastolic Volume Index"
RVESVI_LABEL = "RV End-Systolic Volume Index"
ABS_LABEL = "Absolute RV volumes"

DISCLAIMER = (
    "Comparison with published sex-specific reference ranges (SCMR 2025). "
    "NOT a diagnosis and not a severity grade — interpretation by a qualified "
    "clinician is required."
)
METHOD = "sex-specific-reference-range-scmr-2025"


# ── Helpers ──────────────────────────────────────────────────────────────────

def _num(v: Any) -> Optional[float]:
    """v as a finite float, else None (bools are rejected, not read as 0/1)."""
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _positive(v: Any) -> Optional[float]:
    f = _num(v)
    return f if f is not None and f > 0 else None


def _normalise_sex(sex: Any) -> str:
    return sex if sex in ("male", "female") else "unspecified"


def _people(sex: str) -> str:
    return "men" if sex == "male" else "women"


def _position(value: float, lo: float, hi: float) -> str:
    return "below" if value < lo else "above" if value > hi else "within"


def _rvef_line(rvef: float, sex: str) -> tuple[dict, bool]:
    """The RVEF evidence line, and whether its verdict depends on sex."""
    if sex in RV_REFERENCE:
        lln = RV_REFERENCE[sex]["rvef_lln"]
        if rvef >= lln:
            return {"label": RVEF_LABEL, "level": "ok",
                    "detail": f"RVEF {rvef:.1f} % — at or above the lower limit of normal for "
                              f"{_people(sex)} ({lln:.0f} %)."}, False
        return {"label": RVEF_LABEL, "level": "warn",
                "detail": f"RVEF {rvef:.1f} % — below the lower limit of normal for "
                          f"{_people(sex)} ({lln:.0f} %)."}, False

    lln = {"men": RV_REFERENCE["male"]["rvef_lln"], "women": RV_REFERENCE["female"]["rvef_lln"]}
    ok = {who: rvef >= limit for who, limit in lln.items()}
    both = f"both men ({lln['men']:.0f} %) and women ({lln['women']:.0f} %)"
    if ok["men"] and ok["women"]:
        return {"label": RVEF_LABEL, "level": "ok",
                "detail": f"RVEF {rvef:.1f} % — at or above the lower limit of normal for {both}."}, False
    if not ok["men"] and not ok["women"]:
        return {"label": RVEF_LABEL, "level": "warn",
                "detail": f"RVEF {rvef:.1f} % — below the lower limit of normal for {both}."}, False
    within, below = ("men", "women") if ok["men"] else ("women", "men")
    return {"label": RVEF_LABEL, "level": "unavailable", "depends_on_sex": True,
            "detail": f"RVEF {rvef:.1f} % — at or above the lower limit of normal for {within} "
                      f"({lln[within]:.0f} %) but below it for {below} ({lln[below]:.0f} %). "
                      "Select sex to assess."}, True


def _volume_line(label: str, short: str, value: float, key: str, sex: str) -> tuple[dict, bool]:
    """An indexed-volume evidence line, and whether its verdict depends on sex."""
    if sex in RV_REFERENCE:
        lo, hi = RV_REFERENCE[sex][key]
        band = f"the reference range for {_people(sex)} ({lo:.0f}–{hi:.0f} mL/m²)"
        position = _position(value, lo, hi)
        level = "ok" if position == "within" else "warn"
        return {"label": label, "level": level,
                "detail": f"{short} {value:.1f} mL/m² — {position} {band}."}, False

    ranges = {"men": RV_REFERENCE["male"][key], "women": RV_REFERENCE["female"][key]}
    position = {who: _position(value, lo, hi) for who, (lo, hi) in ranges.items()}

    def band(who: str) -> str:
        lo, hi = ranges[who]
        return f"{who} ({lo:.0f}–{hi:.0f})"

    inside = [who for who, p in position.items() if p == "within"]
    if len(inside) == 2:
        return {"label": label, "level": "ok",
                "detail": f"{short} {value:.1f} mL/m² — within the reference range for both "
                          f"{band('men')} and {band('women')} mL/m²."}, False
    if not inside:
        if position["men"] == position["women"]:
            detail = (f"{short} {value:.1f} mL/m² — {position['men']} the reference range for both "
                      f"{band('men')} and {band('women')} mL/m².")
        else:
            detail = (f"{short} {value:.1f} mL/m² — {position['men']} the reference range for "
                      f"{band('men')} and {position['women']} it for {band('women')} mL/m².")
        return {"label": label, "level": "warn", "detail": detail}, False
    within = inside[0]
    other = "women" if within == "men" else "men"
    return {"label": label, "level": "unavailable", "depends_on_sex": True,
            "detail": f"{short} {value:.1f} mL/m² — within the reference range for {band(within)} "
                      f"but {position[other]} it for {band(other)} mL/m². Select sex to assess."}, True


# ── Rule engine ──────────────────────────────────────────────────────────────

def compute(rv: Any, sex_in: Any, bsa_in: Any, volume_signals: Any) -> dict:
    """Apply the rules and return the output dict. Pure — no I/O; tested by
    scripts/check_rv_health_status.js."""
    rv = rv if isinstance(rv, dict) else {}
    signals = volume_signals if isinstance(volume_signals, dict) else {}
    rvef = _num(rv.get("RVEF"))
    rvedv = _num(rv.get("RVEDV"))
    rvesv = _num(rv.get("RVESV"))
    sex = _normalise_sex(sex_in)
    bsa = _positive(bsa_in)
    ref = RV_REFERENCE.get(sex)

    evidence: list[dict] = []
    features_used: list[str] = []
    features_missing: list[str] = []
    warnings_out: list[str] = []
    depends_on_sex = False

    if ref is None:
        features_missing.append("sex")
        warnings_out.append(
            "Sex not selected — each value was checked against both the men's and the women's "
            "reference ranges; a verdict is given only where they agree."
        )

    # ── RVEF: the primary value. Always one line.
    if rvef is None:
        features_missing.append("RVEF")
        evidence.append({
            "label": RVEF_LABEL, "level": "unavailable",
            "detail": "RVEF not computable from the stored heart metrics — typically no RV "
                      "voxels at end-diastole, or only one cardiac phase segmented.",
        })
    else:
        features_used.append("RVEF")
        line, sex_dependent = _rvef_line(rvef, sex)
        evidence.append(line)
        depends_on_sex = depends_on_sex or sex_dependent
    rvef_assessed = evidence[-1]["level"] in ("ok", "warn")

    # ── Indexed volumes, unless their scale or content is unreliable.
    volume_issues = [reason for reason in (
        voxel_size_issue(signals.get("voxel_mm3")),
        duplicate_slice_issue(signals.get("duplicate_slices"), RV_CAVITY_CLASS, "RV cavity"),
    ) if reason]
    volumes_unreliable = bool(volume_issues)

    if volumes_unreliable:
        features_missing.extend(["RVEDVi", "RVESVi"])
        evidence.append({
            "label": ABS_LABEL, "level": "unavailable",
            "detail": "RV volume evidence withheld — " + "; ".join(volume_issues) + ".",
        })
        warnings_out.append(
            "RV volume evidence withheld because absolute volumes are unreliable — "
            "confidence set to low."
        )
    else:
        for label, short, key, raw, raw_name in (
            (RVEDVI_LABEL, "RVEDVi", "rvedvi", rvedv, "RVEDV"),
            (RVESVI_LABEL, "RVESVi", "rvesvi", rvesv, "RVESV"),
        ):
            if raw is None:
                features_missing.append(short)
                evidence.append({"label": label, "level": "unavailable",
                                 "detail": f"{raw_name} not available from the stored heart metrics."})
            elif bsa is None:
                features_missing.append(short)
                evidence.append({"label": label, "level": "unavailable",
                                 "detail": f"{raw_name} {raw:.1f} mL — not indexed: enter height and "
                                           "weight to compute body surface area."})
            else:
                features_used.append(short)
                line, sex_dependent = _volume_line(label, short, raw / bsa, key, sex)
                evidence.append(line)
                depends_on_sex = depends_on_sex or sex_dependent

    # ── Status: reference-range comparison only, never a severity grade.
    if rvef is None:
        status = "Not assessable"
    elif any(e["level"] == "warn" for e in evidence):
        status = "Outside reference range"
    elif depends_on_sex:
        status = "Depends on sex"
    else:
        status = "Within reference range"

    volumes_assessed = any(
        e["label"] in (RVEDVI_LABEL, RVESVI_LABEL) and e["level"] in ("ok", "warn")
        for e in evidence
    )
    if rvef_assessed and not volumes_assessed:
        warnings_out.append("Status rests on RVEF alone — indexed RV volumes could not be assessed.")

    confidence = "low" if (rvef is None or volumes_unreliable) else "normal"

    return {
        "status":           status,
        "confidence":       confidence,
        "sex":              sex,
        "bsa_m2":           bsa,
        "evidence":         evidence,
        "features_used":    features_used,
        "features_missing": features_missing,
        "reference": {
            "source":           REFERENCE_SOURCE,
            "convention":       REFERENCE_CONVENTION,
            "sex":              sex if ref else None,
            "rvef_lower_limit": ref["rvef_lln"] if ref else None,
            "rvedvi_range":     list(ref["rvedvi"]) if ref else None,
            "rvesvi_range":     list(ref["rvesvi"]) if ref else None,
            "by_sex": {
                name: {
                    "rvef_lower_limit": limits["rvef_lln"],
                    "rvedvi_range":     list(limits["rvedvi"]),
                    "rvesvi_range":     list(limits["rvesvi"]),
                }
                for name, limits in RV_REFERENCE.items()
            },
        },
        "disclaimer":       DISCLAIMER,
        "method":           METHOD,
        "warnings":         warnings_out,
    }


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"error": f"Invalid input JSON: {e}"}))
        sys.exit(1)
    if not isinstance(data, dict):
        print(json.dumps({"error": "Input must be a JSON object."}))
        sys.exit(1)

    result = compute(data.get("rv"), data.get("sex"), data.get("bsa_m2"), data.get("volume_signals"))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
