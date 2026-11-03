"""
derive_acdc_reference_ranges.py
================================
Derives NOR/MINF/DCM/HCM/RV reference statistics (mean/SD/min/max per
feature, per ACDC group) by running this project's OWN measurement pipeline
— compute_heart_metrics_from_rle.py and compute_bullseye_from_rle.py, called
UNMODIFIED, via the exact same stdin/stdout subprocess contract the Node
backend uses — against the ACDC Challenge training set's own ground-truth
segmentation masks.

Why: compute_disease_pattern_gates.py's NOR gate currently borrows Zhan et
al. 2024's general-population ranges, because ACDC states no NOR criterion
of its own. A patient genuinely labelled NOR by ACDC can still fall outside
a different study's range purely from a measurement-convention mismatch
(different LV mass formula, different voxel counting, etc.) — not because
anything is wrong with the patient or this app's segmentation. Measuring
ACDC's own NOR (and MINF/DCM/HCM/RV) patients through THIS app's own code
removes that mismatch: whatever this script reports is directly comparable
to what the live app would compute for a real patient, because it's the
same code.

Usage
-----
    python3 derive_acdc_reference_ranges.py --acdc-dir ../data/acdc

Expected input layout (the official ACDC training release, unmodified):
    <acdc-dir>/training_info.csv
        columns: PatientID,ED,ES,Group,Height,NbFrame,Weight
    <acdc-dir>/training/patientXXX/
        patientXXX_frame{ED:02d}_gt.nii.gz
        patientXXX_frame{ES:02d}_gt.nii.gz

Per patient
-----------
1. Load the ED and ES ground-truth mask volumes, and the REAL voxel spacing
   from the NIfTI header's pixdim (nibabel's `get_zooms()`) — NOT
   `img.affine`. Verified live against this dataset (2026-10): these files
   carry `sform_code=2` with a plain unit-scale (1,1,1) sform matrix and
   `qform_code=0` (unused) — `img.affine` reports (1,1,1) regardless of the
   patient's real spacing, while `pixdim`/`get_zooms()` carries the correct
   per-patient values (confirmed consistent across multiple patients, each
   with a different real in-plane spacing). Using `img.affine` here would
   silently reproduce the exact "stripped affine" failure mode the
   deleted (and not reused for this version) prior attempt at this script
   had to route around by giving up on absolute volumes entirely — this
   dataset copy doesn't have that problem, affine just isn't the place to
   read it from.
2. RLE-encode each slice, per class. No label remap needed: ACDC's own
   ground-truth convention (0=background, 1=RV, 2=myocardium, 3=LV cavity)
   is IDENTICAL to this app's internal convention (see
   compute_heart_metrics_from_rle.py's own docstring).
3. Feed ED+ES together into compute_heart_metrics_from_rle.py (EF, EDV,
   EDVI, LV_mass_g, LVMI, RVEDV, RVEF, RVEDVI, RVESVI) — needs a synthetic
   affine built from the real `get_zooms()` spacing (diag(dx,dy,dz,1); the
   script only ever reads `sqrt(sum(affine[:3,:3]**2, axis=0))` off it, so
   sign/rotation don't matter, only magnitude per axis).
4. Feed the ED frame ALONE into compute_bullseye_from_rle.py for wall
   thickness (build_mask_3d keys purely by sliceindex and ignores
   frameindex — sending ED+ES together would silently merge their slices
   into one mask, corrupting the result; confirmed by reading that
   function directly before writing this). segment_values comes back in
   PIXELS by that script's own design (no spacing input, documented) — this
   script converts to real mm itself, the same way
   assembleDiseasePatternGateInputs (segmentation_routes.ts) now does,
   post wall-thickness-unit-bug-fix (2026-10): multiply the max by the
   real in-plane spacing (dx).
5. Collect EF, EDVI, LVMI, MaxWallThicknessMm, RVEDVI, RVEF, RVESVI per
   patient; group by the CSV's Group column; report mean/SD/min/max per
   feature per group, plus a ready-to-paste constants block.

Caveat: ACDC's training set has 20 patients per group — small-N. Treat any
derived range with the same "approximate" caveat the literature-sourced
ranges already carry, not as more rigorous just because it's self-measured.

Pure Python + numpy + nibabel. Calls the two existing scripts as
subprocesses via `sys.executable`, unmodified.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import statistics
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

import nibabel as nib
import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
PY_DIR = SCRIPT_DIR.parent / "src" / "python"
HEART_METRICS_SCRIPT = PY_DIR / "compute_heart_metrics_from_rle.py"
BULLSEYE_SCRIPT = PY_DIR / "compute_bullseye_from_rle.py"

# ACDC's own convention == this app's own convention. No remap needed — see
# compute_heart_metrics_from_rle.py's "Class mapping" docstring section.
_CLASS_NAME = {1: "rv", 2: "myo", 3: "lvc"}

GROUPS = ["NOR", "MINF", "DCM", "HCM", "RV"]


def mosteller_bsa(height_cm: float, weight_kg: float) -> float:
    """Same formula this app already uses for real patients (see
    MethodologyPage.tsx: 'Mosteller formula, sqrt(height x weight / 3600)')."""
    return math.sqrt(height_cm * weight_kg / 3600.0)


def encode_rle(mask: np.ndarray) -> str:
    """COCO-style 'offset length offset length ...' over a row-major flat
    array — must match compute_heart_metrics_from_rle.py/
    compute_bullseye_from_rle.py's decode_rle exactly (it does: both are
    C-order flattens of value==1 runs)."""
    flat = mask.astype(np.uint8).reshape(-1, order="C")
    # Positions where the run-value changes, via the standard "diff of
    # padded array" trick — avoids a slow Python loop over every pixel.
    padded = np.concatenate(([0], flat, [0]))
    diffs = np.diff(padded)
    starts = np.where(diffs == 1)[0]
    ends = np.where(diffs == -1)[0]
    return " ".join(f"{s} {e - s}" for s, e in zip(starts, ends))


def load_gt_volume(path: Path) -> tuple[np.ndarray, float, float, float]:
    """Load one ACDC ground-truth frame volume. Returns (labels (H,W,S) int
    array, dx, dy, dz) — spacing from header.get_zooms(), NEVER img.affine
    (see module docstring)."""
    img = nib.load(str(path))
    data = np.rint(np.asarray(img.dataobj)).astype(np.int64)
    zooms = img.header.get_zooms()
    dx, dy = float(zooms[0]), float(zooms[1])
    dz = float(zooms[2]) if len(zooms) > 2 else 1.0
    return data, dx, dy, dz


def frame_entry(frameindex: int, labels_3d: np.ndarray) -> dict:
    """Build one {frameindex, slices:[...]} entry in this app's own RLE
    frame schema (see compute_heart_metrics_from_rle.py's docstring /
    IProjectSegmentationMask.frames)."""
    H, W, n_slices = labels_3d.shape
    slices = []
    for s in range(n_slices):
        sl = labels_3d[:, :, s]
        segs = []
        for cls_val, cls_name in _CLASS_NAME.items():
            m = sl == cls_val
            if m.any():
                segs.append({"class": cls_name, "segmentationmaskcontents": encode_rle(m)})
        slices.append({"sliceindex": s, "segmentationmasks": segs})
    return {"frameindex": frameindex, "slices": slices}


def run_script(script_path: Path, payload: dict) -> Optional[dict]:
    """Call one of this project's existing Python scripts exactly the way
    the Node backend does: stdin JSON in, stdout JSON out. Unmodified
    scripts, same contract — see segmentation_export.ts's runBullseyeRleScript/
    computeHeartMetricsFromMaskDoc for the Node-side twin of this call."""
    try:
        proc = subprocess.run(
            [sys.executable, str(script_path)],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired:
        return None
    if not proc.stdout.strip():
        return None
    try:
        result = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None
    if isinstance(result, dict) and result.get("error"):
        return None
    return result


def process_patient(pid: str, row: dict, training_dir: Path) -> Optional[dict]:
    patient_dir = training_dir / pid
    try:
        ed_num = int(float(row["ED"]))
        es_num = int(float(row["ES"]))
        height = float(row["Height"])
        weight = float(row["Weight"])
    except (KeyError, ValueError):
        print(f"  {pid}: skipped — bad ED/ES/Height/Weight in CSV")
        return None

    ed_path = patient_dir / f"{pid}_frame{ed_num:02d}_gt.nii.gz"
    es_path = patient_dir / f"{pid}_frame{es_num:02d}_gt.nii.gz"
    if not ed_path.exists() or not es_path.exists():
        print(f"  {pid}: skipped — missing {ed_path.name} or {es_path.name}")
        return None

    ed_labels, dx, dy, dz = load_gt_volume(ed_path)
    es_labels, _, _, _ = load_gt_volume(es_path)
    if ed_labels.shape != es_labels.shape:
        print(f"  {pid}: skipped — ED/ES shape mismatch {ed_labels.shape} vs {es_labels.shape}")
        return None

    bsa_m2 = mosteller_bsa(height, weight)

    # Synthetic affine from the REAL spacing (img.affine is unreliable for
    # this file set — see module docstring). Only magnitude-per-axis
    # matters to compute_heart_metrics_from_rle.py's own formula.
    affine = [[dx, 0.0, 0.0, 0.0], [0.0, dy, 0.0, 0.0], [0.0, 0.0, dz, 0.0], [0.0, 0.0, 0.0, 1.0]]
    H, W = ed_labels.shape[0], ed_labels.shape[1]

    ed_entry = frame_entry(ed_num, ed_labels)
    es_entry = frame_entry(es_num, es_labels)

    hm = run_script(HEART_METRICS_SCRIPT, {
        "frames": [ed_entry, es_entry],
        "width": W, "height": H,
        "affine": affine,
        "ed_frame": ed_num, "es_frame": es_num,
        "bsa_m2": bsa_m2,
    })
    if hm is None:
        print(f"  {pid}: skipped — compute_heart_metrics_from_rle.py failed")
        return None

    # ED frame ONLY for wall thickness — build_mask_3d keys purely by
    # sliceindex and ignores frameindex, so ED+ES together would merge.
    bullseye = run_script(BULLSEYE_SCRIPT, {"frames": [ed_entry], "width": W, "height": H})
    max_wall_mm = None
    if bullseye is not None:
        vals = [v for v in bullseye.get("segment_values", []) if isinstance(v, (int, float))]
        if vals:
            max_wall_mm = max(vals) * dx  # pixels -> mm; see module docstring

    meas = hm.get("measurements", {}) or {}
    return {
        "EF": meas.get("EF"),
        "EDVI": hm.get("LVEDVI"),
        "LVMI": None if hm.get("LV_mass_g") is None or bsa_m2 <= 0 else hm["LV_mass_g"] / bsa_m2,
        "MaxWallThicknessMm": max_wall_mm,
        "RVEDVI": hm.get("RVEDVI"),
        "RVEF": hm.get("RVEF"),
        "RVESVI": hm.get("RVESVI"),
    }


def summarize(values: list[float]) -> dict:
    n = len(values)
    mean = statistics.fmean(values)
    sd = statistics.stdev(values) if n > 1 else 0.0
    return {"n": n, "mean": round(mean, 2), "sd": round(sd, 2), "min": round(min(values), 2), "max": round(max(values), 2)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--acdc-dir", required=True, help="Folder containing training_info.csv and training/")
    args = ap.parse_args()

    acdc_dir = Path(args.acdc_dir)
    csv_path = acdc_dir / "training_info.csv"
    training_dir = acdc_dir / "training"
    if not csv_path.is_file():
        sys.exit(f"CSV not found: {csv_path}")
    if not training_dir.is_dir():
        sys.exit(f"training/ not found: {training_dir}")

    with open(csv_path, newline="") as fh:
        rows = list(csv.DictReader(fh))

    by_group: dict[str, list[dict]] = {g: [] for g in GROUPS}
    skipped = 0
    print(f"Processing {len(rows)} patients...")
    for row in rows:
        pid = row.get("PatientID", "").strip()
        group = row.get("Group", "").strip().upper()
        if group not in GROUPS:
            print(f"  {pid}: skipped — unrecognised Group {group!r}")
            skipped += 1
            continue
        features = process_patient(pid, row, training_dir)
        if features is None:
            skipped += 1
            continue
        by_group[group].append(features)
        print(f"  {pid} ({group}): EF={features['EF']} EDVI={features['EDVI']} "
              f"LVMI={features['LVMI']} wall={features['MaxWallThicknessMm']} "
              f"RVEDVI={features['RVEDVI']} RVEF={features['RVEF']}")

    print(f"\n{len(rows) - skipped} processed, {skipped} skipped\n")
    print("=" * 72)
    print("ACDC ground-truth reference statistics — this app's own pipeline")
    print("=" * 72)

    feature_names = ["EF", "EDVI", "LVMI", "MaxWallThicknessMm", "RVEDVI", "RVEF", "RVESVI"]
    stats: dict[str, dict[str, dict]] = {}
    for group in GROUPS:
        rows_g = by_group[group]
        print(f"\n{group} (n={len(rows_g)}):")
        stats[group] = {}
        for feat in feature_names:
            vals = [r[feat] for r in rows_g if isinstance(r.get(feat), (int, float))]
            if not vals:
                print(f"  {feat}: NO DATA")
                continue
            s = summarize(vals)
            stats[group][feat] = s
            print(f"  {feat:20s} n={s['n']:2d}  mean={s['mean']:7.2f}  sd={s['sd']:6.2f}  "
                  f"range=({s['min']:.2f}-{s['max']:.2f})")

    print("\n" + "=" * 72)
    print("Raw JSON (for re-use / pasting into a methodology table)")
    print("=" * 72)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
