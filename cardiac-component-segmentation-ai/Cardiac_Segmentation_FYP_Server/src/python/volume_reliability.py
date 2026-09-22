"""
volume_reliability.py
=====================
Decides whether ABSOLUTE LV volumes from compute_heart_metrics_from_rle.py can
be trusted, using the structured fields that module stores on heartMetrics —
`voxel_mm3`, `LVEDV` (= measurements.EDV) and `duplicate_slices` — and never
the free-text `heartMetrics.warnings` list.

Why not the warnings list: it mixes volume-reliability warnings (suspicious
voxel_mm3, duplicated slices, implausible LVEDV) with warnings that say nothing
about LV volume ("No RV voxels at ED", "No myocardium (class 2) voxels at ED
frame", single phase / ED == ES, an ignored bsa_m2). compute_health_status.py
used to treat any warning as "volumes unreliable", so a mask with no RV voxels
had its LV EDV evidence suppressed, its confidence lowered, the affine blamed,
and - by dropping an EDV warn from the downgrade count - its LV status changed.

Standard library only, no I/O. Graders run as `python3 path/to/script.py`,
which puts this directory on sys.path, so any sibling script can
`import volume_reliability` (an RV grader can reuse voxel_size_issue and
duplicate_slice_issue with the "rv" class).
"""

from __future__ import annotations

import math
from typing import Any, Optional

# Plausibility bounds. These MIRROR the warning guards in
# compute_heart_metrics_from_rle.py - change both together:
#   voxel_mm3 < 0.1 or > 200.0 -> "Suspicious voxel_mm3=..." warning
#   LVEDV < 30.0 or > 400.0    -> "LVEDV=... is below/above the typical adult range" warning
VOXEL_MM3_PLAUSIBLE = (0.1, 200.0)
LVEDV_PLAUSIBLE_ML = (30.0, 400.0)

# heartMetrics.duplicate_slices[].class value for the LV cavity, from
# _CLASS_NAME in compute_heart_metrics_from_rle.py ("lvc" | "myo" | "rv").
LV_CAVITY_CLASS = "lvc"


def _finite(v: Any) -> Optional[float]:
    """v as a finite float, else None (bools are rejected, not read as 0/1)."""
    if v is None or isinstance(v, bool):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def voxel_size_issue(voxel_mm3: Any) -> Optional[str]:
    """A reason when the voxel volume is implausible, else None. A bad voxel
    volume scales every absolute volume, for every chamber."""
    v = _finite(voxel_mm3)
    lo, hi = VOXEL_MM3_PLAUSIBLE
    if v is None or lo <= v <= hi:
        return None
    return (
        f"voxel volume {v:.4g} mm³ is outside the plausible {lo:g}–{hi:g} mm³ "
        "range, which points to a bad project affine"
    )


def lvedv_issue(lvedv_ml: Any) -> Optional[str]:
    """A reason when LVEDV is outside the range heart metrics warns on, else None."""
    v = _finite(lvedv_ml)
    lo, hi = LVEDV_PLAUSIBLE_ML
    if v is None or lo <= v <= hi:
        return None
    return (
        f"LVEDV {v:.1f} mL is outside the plausible {lo:.0f}–{hi:.0f} mL range, "
        "which usually means a bad affine or missing or duplicated slices"
    )


def duplicate_slice_issue(duplicate_slices: Any, cavity_class: str, label: str) -> Optional[str]:
    """A reason when `duplicate_slices` holds entries for `cavity_class`, else None.

    Only that cavity's entries count: each chamber volume is computed from its
    own class's voxels, so a copied slice of another class cannot inflate it. A
    slice copied wholesale is still caught, because the detector emits one entry
    per class present on the slice. Any frame counts, not only ED/ES - for the LV
    an inflated frame can itself be chosen as ED (the frame with the most
    LV-cavity voxels).
    """
    if not isinstance(duplicate_slices, list):
        return None
    hits = [d for d in duplicate_slices if isinstance(d, dict) and d.get("class") == cavity_class]
    if not hits:
        return None
    first = hits[0]
    plural = "" if len(hits) == 1 else "s"
    return (
        f"{len(hits)} duplicated {label} slice{plural} detected "
        f"(e.g. frame {first.get('frame')}, slices {first.get('slice_keep')} & "
        f"{first.get('slice_remove')}), which inflates the volume"
    )


def lv_volume_issues(voxel_mm3: Any, lvedv_ml: Any, duplicate_slices: Any) -> list[str]:
    """Every reason absolute LV volumes are unreliable; [] means trustworthy."""
    reasons = (
        voxel_size_issue(voxel_mm3),
        lvedv_issue(lvedv_ml),
        duplicate_slice_issue(duplicate_slices, LV_CAVITY_CLASS, "LV cavity"),
    )
    return [r for r in reasons if r]
