"""
derive_acdc_reference_ranges.py
===============================
Derive NOR / HCM / DCM reference profiles for the Disease Pattern Similarity
module directly from the ACDC ground-truth segmentation masks the project ships.

Why this script exists
----------------------
`compute_disease_similarity.py` needs a (mean, sd) per feature per group. Those
were literature-consensus placeholders. This script replaces the EF numbers with
values MEASURED from the ACDC ground-truth masks using the SAME voxel-count math
as `compute_heart_metrics_from_rle.py`, so the reference ranges are consistent
with what the app itself computes — a defensible "dataset-derived" range.

Important — voxel spacing
-------------------------
The bundled ACDC NIfTI files have a stripped affine (1x1x1 mm). EF is a RATIO
(LVEDV - LVESV) / LVEDV, so voxel volume cancels and EF is CORRECT regardless of
spacing. Absolute volumes (EDV/ESV/SV) are NOT trustworthy from these files, so
this script does not emit measured volumes; it pairs the measured EF with the
published ACDC group volume statistics (Bernard et al., IEEE TMI 2018) instead.

Class map (identical to the app):  0=bg, 1=RV, 2=MYO, 3=LVC.
ED = frame01 (per ACDC convention + the CSV's ED column), ES = the second frame
present for each patient (the CSV's ES column names the ES frame number).

Usage
-----
    python3 derive_acdc_reference_ranges.py \
        --csv   ../../../acdc/patient_info.csv \
        --masks ../../../acdc/rv-points-acdc-nifti-seg-masks

Prints per-group EF mean/sd and a ready-to-paste REFERENCE_PROFILES block.
Pure Python + numpy + nibabel.
"""

from __future__ import annotations

import argparse
import csv
import glob
import os
import re
import sys
from collections import defaultdict

import numpy as np
import nibabel as nib

_LVC_CLASS = 3

# Published ACDC group volume statistics (Bernard et al., IEEE TMI 2018 /
# ACDC cohort ground truth). Used for EDV/ESV/SV because the bundled files lost
# their spacing. EF below is MEASURED from the masks and overwrites any literature
# EF. StrokeVolume derived as EDV - ESV of the published means.
PUBLISHED_VOL = {
    # group: EDV(mu,sd), ESV(mu,sd)   [mL]
    "NOR": {"EDV": (130.1, 26.4), "ESV": (51.8, 17.0)},
    "HCM": {"EDV": (129.1, 35.2), "ESV": (42.2, 18.0)},
    "DCM": {"EDV": (284.6, 47.8), "ESV": (233.7, 51.0)},
}

# Strain reference values kept from literature (cannot be derived from 2-frame
# ground-truth masks — strain needs the full tracked cine sequence).
LITERATURE_STRAIN = {
    "NOR": {"PeakGRS": (40.0, 10.0), "PeakGCS": (-20.0, 4.0)},
    "HCM": {"PeakGRS": (32.0, 12.0), "PeakGCS": (-14.0, 4.0)},
    "DCM": {"PeakGRS": (16.0, 8.0), "PeakGCS": (-9.0, 4.0)},
}

GROUPS = ["NOR", "HCM", "DCM"]


def lvc_voxels(mask_path: str) -> int:
    """Count LV-cavity (class 3) voxels in a ground-truth mask volume."""
    d = np.asarray(nib.load(mask_path).dataobj)
    return int((np.rint(d) == _LVC_CLASS).sum())


def frames_for_patient(masks_dir: str, pid: str) -> list[tuple[int, str]]:
    """Return [(frame_number, path), ...] sorted, for a patient's mask files."""
    out = []
    for f in glob.glob(os.path.join(masks_dir, f"{pid}_frame*.nii.gz")):
        m = re.search(r"_frame(\d+)\.nii\.gz$", os.path.basename(f))
        if m:
            out.append((int(m.group(1)), f))
    return sorted(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="ACDC patient_info.csv")
    ap.add_argument("--masks", required=True, help="dir of *_frameNN.nii.gz masks")
    args = ap.parse_args()

    if not os.path.isfile(args.csv):
        sys.exit(f"CSV not found: {args.csv}")
    if not os.path.isdir(args.masks):
        sys.exit(f"masks dir not found: {args.masks}")

    # Read label CSV → per-patient group + ED/ES frame numbers.
    rows = []
    with open(args.csv, newline="") as fh:
        for r in csv.DictReader(fh):
            rows.append(r)

    ef_by_group: dict[str, list[float]] = defaultdict(list)
    skipped: list[str] = []

    for r in rows:
        group = r["Group"].strip().upper()
        if group not in GROUPS:
            continue  # skip MINF / RV — not modelled by the similarity module
        pid = r["PatientID"].strip()
        try:
            ed_num = int(float(r["ED"]))
            es_num = int(float(r["ES"]))
        except (KeyError, ValueError):
            skipped.append(f"{pid}: bad ED/ES"); continue

        frames = frames_for_patient(args.masks, pid)
        if len(frames) < 2:
            skipped.append(f"{pid}: <2 mask frames found"); continue

        # Map ED/ES by frame number when available; else fall back to
        # smallest-frame = ED (frame01), largest-frame = ES.
        fmap = {n: p for n, p in frames}
        ed_path = fmap.get(ed_num, frames[0][1])
        es_path = fmap.get(es_num, frames[-1][1])

        lvedv = lvc_voxels(ed_path)   # voxel counts; spacing cancels in EF
        lvesv = lvc_voxels(es_path)
        if lvedv <= 0:
            skipped.append(f"{pid}: no LV at ED"); continue
        # Guard: ED should be the larger cavity. If the file order is reversed,
        # swap so EF stays physiological.
        if lvesv > lvedv:
            lvedv, lvesv = lvesv, lvedv
        ef = (lvedv - lvesv) / lvedv * 100.0
        ef_by_group[group].append(ef)

    # Report + assemble profiles.
    print("=" * 68)
    print("ACDC ground-truth EF (measured from masks; spacing-independent)")
    print("=" * 68)
    profiles: dict[str, dict] = {}
    for g in GROUPS:
        efs = np.array(ef_by_group[g], dtype=float)
        if efs.size == 0:
            print(f"{g}: NO DATA"); continue
        mu, sd = float(efs.mean()), float(efs.std(ddof=1))
        print(f"{g}: n={efs.size:2d}  EF = {mu:5.1f} +/- {sd:4.1f} %   "
              f"(range {efs.min():.1f}-{efs.max():.1f})")
        edv = PUBLISHED_VOL[g]["EDV"]
        esv = PUBLISHED_VOL[g]["ESV"]
        sv_mu = edv[0] - esv[0]
        sv_sd = round((edv[1] ** 2 + esv[1] ** 2) ** 0.5, 1)
        profiles[g] = {
            "EF": (round(mu, 1), round(sd, 1)),
            "EDV": edv,
            "ESV": esv,
            "StrokeVolume": (round(sv_mu, 1), sv_sd),
            "PeakGRS": LITERATURE_STRAIN[g]["PeakGRS"],
            "PeakGCS": LITERATURE_STRAIN[g]["PeakGCS"],
        }

    if skipped:
        print("\nskipped:", "; ".join(skipped))

    # Emit paste-ready block.
    print("\n" + "=" * 68)
    print("Paste into compute_disease_similarity.py -> REFERENCE_PROFILES")
    print("  EF        = MEASURED from ACDC ground-truth masks (this script)")
    print("  EDV/ESV   = published ACDC stats (Bernard et al., IEEE TMI 2018)")
    print("  StrokeVol = EDV-ESV of the published means")
    print("  PeakGRS/GCS = literature (strain needs full cine — not derivable here)")
    print("=" * 68)
    print("REFERENCE_PROFILES: dict[str, dict[str, tuple[float, float]]] = {")
    for g in GROUPS:
        if g not in profiles:
            continue
        p = profiles[g]
        print(f'    "{g}": {{')
        for feat in ["EF", "EDV", "ESV", "StrokeVolume", "PeakGRS", "PeakGCS"]:
            mu, sd = p[feat]
            print(f'        "{feat}":{" " * (13 - len(feat))}({mu}, {sd}),')
        print("    },")
    print("}")


if __name__ == "__main__":
    main()
