"""
visualize_acdc_ground_truth.py
===============================
Renders ACDC ground-truth segmentation masks overlaid on the raw MRI, one
grid image per patient (all slices of one frame in a single PNG), so the
pilot batch's model-predicted segmentations can be visually compared
against ground truth while manually correcting them in the app.

Class colors (RV=blue, myocardium=green, LV cavity=red) match the labels
compute_heart_metrics_from_rle.py and compute_bullseye_from_rle.py already
use internally — not necessarily the app's own editor color scheme (no
single central color constant for that was found in the frontend), but
clear and standard for this kind of cardiac-MRI segmentation figure.

Usage:
    python3 visualize_acdc_ground_truth.py --acdc-dir ../data/acdc --out-dir ../data/acdc/gt_overlays --frame ED
    python3 visualize_acdc_ground_truth.py --acdc-dir ../data/acdc --out-dir ../data/acdc/gt_overlays --frame ES
    python3 visualize_acdc_ground_truth.py --acdc-dir ../data/acdc --out-dir ../data/acdc/gt_overlays --frame both
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import nibabel as nib
import numpy as np

BATCH_1_PATIENT_IDS = [
    "patient001", "patient002", "patient003", "patient004", "patient005",
    "patient021", "patient022", "patient023", "patient024", "patient025",
    "patient041", "patient042", "patient043", "patient044", "patient045",
    "patient061", "patient062", "patient063", "patient064", "patient065",
    "patient081", "patient082", "patient083", "patient084", "patient085",
]

BATCH_2_PATIENT_IDS = [
    "patient006", "patient007", "patient008", "patient009", "patient010",
    "patient026", "patient027", "patient028", "patient029", "patient030",
    "patient046", "patient047", "patient048", "patient049", "patient050",
    "patient066", "patient067", "patient068", "patient069", "patient070",
    "patient086", "patient087", "patient088", "patient089", "patient090",
]

# RV, myocardium, LV cavity — matches the label values (1,2,3) this app's
# own pipeline already uses (see compute_heart_metrics_from_rle.py).
CLASS_COLORS = {1: (0.23, 0.51, 0.96), 2: (0.13, 0.77, 0.37), 3: (0.94, 0.27, 0.27)}  # RV blue, MYO green, LVC red
CLASS_LABELS = {1: "RV", 2: "Myocardium", 3: "LV cavity"}


def parse_csv(path: Path) -> dict:
    with open(path, newline="") as fh:
        return {r["PatientID"]: r for r in csv.DictReader(fh)}


def render_patient(pid: str, group: str, frame_num: int, frame_label: str, training_dir: Path, out_dir: Path) -> None:
    img_path = training_dir / pid / f"{pid}_frame{frame_num:02d}.nii.gz"
    gt_path = training_dir / pid / f"{pid}_frame{frame_num:02d}_gt.nii.gz"
    if not img_path.exists() or not gt_path.exists():
        print(f"  {pid}: skipped ({frame_label}) — missing {img_path.name} or {gt_path.name}")
        return

    mri = np.asarray(nib.load(str(img_path)).dataobj)
    gt = np.rint(np.asarray(nib.load(str(gt_path)).dataobj)).astype(int)
    n_slices = mri.shape[2]

    cols = min(5, n_slices)
    rows = (n_slices + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(3.2 * cols, 3.2 * rows))
    axes = np.atleast_1d(axes).reshape(-1)

    for s in range(n_slices):
        ax = axes[s]
        slice_img = mri[:, :, s]
        lo, hi = np.percentile(slice_img, [1, 99])
        ax.imshow(slice_img.T, cmap="gray", vmin=lo, vmax=hi, origin="lower")

        overlay = np.zeros((*gt.shape[:2], 4))
        for cls_val, color in CLASS_COLORS.items():
            mask = gt[:, :, s] == cls_val
            overlay[mask] = (*color, 0.45)
        ax.imshow(overlay.transpose(1, 0, 2), origin="lower")
        ax.set_title(f"slice {s}", fontsize=9)
        ax.axis("off")

    for s in range(n_slices, len(axes)):
        axes[s].axis("off")

    handles = [plt.Rectangle((0, 0), 1, 1, color=(*c, 0.6)) for c in CLASS_COLORS.values()]
    fig.legend(handles, [CLASS_LABELS[k] for k in CLASS_COLORS], loc="upper right", fontsize=11)
    fig.suptitle(f"{pid} ({group}) — {frame_label} frame {frame_num} — ground truth", fontsize=14)
    fig.tight_layout(rect=[0, 0, 1, 0.96])

    out_path = out_dir / f"{pid}_{frame_label}_gt.png"
    fig.savefig(out_path, dpi=110)
    plt.close(fig)
    print(f"  {pid}: wrote {out_path.name} ({n_slices} slices)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--acdc-dir", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--frame", choices=["ED", "ES", "both"], default="ED")
    ap.add_argument("--batch", type=int, choices=[1, 2], default=1)
    args = ap.parse_args()

    acdc_dir = Path(args.acdc_dir)
    training_dir = acdc_dir / "training"
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    info = parse_csv(acdc_dir / "training_info.csv")

    patient_ids = BATCH_2_PATIENT_IDS if args.batch == 2 else BATCH_1_PATIENT_IDS
    frames_wanted = ["ED", "ES"] if args.frame == "both" else [args.frame]
    for pid in patient_ids:
        row = info.get(pid)
        if not row:
            print(f"  {pid}: skipped — not in CSV")
            continue
        for frame_label in frames_wanted:
            frame_num = int(float(row[frame_label]))
            render_patient(pid, row["Group"], frame_num, frame_label, training_dir, out_dir)

    print(f"\nDone. Images in {out_dir}")


if __name__ == "__main__":
    main()
