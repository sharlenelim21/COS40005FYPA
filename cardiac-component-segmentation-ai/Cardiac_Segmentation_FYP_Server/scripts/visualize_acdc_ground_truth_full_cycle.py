"""
visualize_acdc_ground_truth_full_cycle.py
===========================================
Renders ACDC ground-truth segmentation overlaid on the raw MRI for EVERY
frame of the cardiac cycle, as one animated GIF per (patient, slice) pair —
the full-coverage complement to visualize_acdc_ground_truth.py's static
ED/ES-only grids.

Uses each patient's *_4d_gt.nii.gz (confirmed live, 2026-10: unlike ACDC's
usual ED/ES-only release, this dataset copy has nonzero labels at every
frame, with voxel counts varying smoothly across the cycle in a
physiologically plausible pattern — peak near ED, trough near ES. Caveat
worth keeping in mind: this doesn't confirm every in-between frame was
individually hand-verified rather than propagated/interpolated from ED/ES;
treat it as a QC reference either way.)

Same color convention as visualize_acdc_ground_truth.py: RV=blue,
myocardium=green, LV cavity=red.

Usage:
    python3 visualize_acdc_ground_truth_full_cycle.py --acdc-dir ../data/acdc --out-dir ../data/acdc/gt_overlays_full_cycle
"""

from __future__ import annotations

import argparse
from pathlib import Path

import nibabel as nib
import numpy as np
from PIL import Image, ImageDraw

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

CLASS_COLORS = {1: (59, 130, 246), 2: (34, 197, 94), 3: (239, 68, 68)}  # RV blue, MYO green, LVC red
ALPHA = 0.45
SCALE = 1  # no upscale -- GIF size is dominated by the grayscale MRI's poor
           # compressibility under a 256-color palette, not resolution; a
           # 2x upscale roughly quadrupled file size (25 patients would have
           # been 750MB-1GB+) for a review-only GIF where native resolution
           # is already legible (confirmed live, 2026-10).
FRAME_DURATION_MS = 150
GIF_COLORS = 48  # quantize the palette tightly -- grayscale MRI + 3 flat
                  # overlay colors don't need GIF's full 256-color budget,
                  # and a smaller palette compresses noticeably better.


def composite_frame(mri_slice: np.ndarray, gt_slice: np.ndarray, label: str) -> Image.Image:
    lo, hi = np.percentile(mri_slice, [1, 99])
    hi = max(hi, lo + 1e-6)
    norm = np.clip((mri_slice.astype(np.float32) - lo) / (hi - lo), 0, 1)
    rgb = np.stack([norm, norm, norm], axis=-1)

    for cls_val, color in CLASS_COLORS.items():
        mask = gt_slice == cls_val
        if not mask.any():
            continue
        color_arr = np.array(color, dtype=np.float32) / 255.0
        rgb[mask] = rgb[mask] * (1 - ALPHA) + color_arr * ALPHA

    img = Image.fromarray((rgb * 255).astype(np.uint8), mode="RGB")
    img = img.transpose(Image.ROTATE_90).transpose(Image.FLIP_TOP_BOTTOM)  # match (x,y)->(row,col) display orientation
    img = img.resize((img.width * SCALE, img.height * SCALE), Image.NEAREST)

    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, 90, 16], fill=(0, 0, 0))
    draw.text((3, 2), label, fill=(255, 255, 255))
    return img


def render_patient(pid: str, group: str, training_dir: Path, out_dir: Path) -> int:
    img_path = training_dir / pid / f"{pid}_4d.nii.gz"
    gt_path = training_dir / pid / f"{pid}_4d_gt.nii.gz"
    if not img_path.exists() or not gt_path.exists():
        print(f"  {pid}: skipped — missing {img_path.name} or {gt_path.name}")
        return 0

    mri = np.asarray(nib.load(str(img_path)).dataobj)
    gt = np.rint(np.asarray(nib.load(str(gt_path)).dataobj)).astype(int)
    if mri.shape != gt.shape:
        print(f"  {pid}: skipped — shape mismatch {mri.shape} vs {gt.shape}")
        return 0

    n_slices, n_frames = mri.shape[2], mri.shape[3]
    patient_out = out_dir / pid
    patient_out.mkdir(parents=True, exist_ok=True)

    written = 0
    for s in range(n_slices):
        frames = [
            composite_frame(mri[:, :, s, t], gt[:, :, s, t], f"F{t} S{s}")
            for t in range(n_frames)
        ]
        out_path = patient_out / f"{pid}_slice{s:02d}_gt.gif"
        # Quantize every frame against ONE shared palette (built from the
        # first frame) rather than each frame picking its own -- otherwise
        # the palette flickers slightly between frames and compresses worse.
        base_palette = frames[0].quantize(colors=GIF_COLORS)
        quantized = [base_palette] + [f.quantize(colors=GIF_COLORS, palette=base_palette) for f in frames[1:]]
        quantized[0].save(
            out_path, save_all=True, append_images=quantized[1:],
            duration=FRAME_DURATION_MS, loop=0, optimize=True,
        )
        written += 1
    print(f"  {pid} ({group}): wrote {written} slice GIFs ({n_frames} frames each)")
    return written


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--acdc-dir", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--only", help="Comma-separated patient IDs to restrict to (for testing)")
    ap.add_argument("--batch", type=int, choices=[1, 2], default=1)
    args = ap.parse_args()

    acdc_dir = Path(args.acdc_dir)
    training_dir = acdc_dir / "training"
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    import csv
    info = {r["PatientID"]: r for r in csv.DictReader(open(acdc_dir / "training_info.csv", newline=""))}

    ids = BATCH_2_PATIENT_IDS if args.batch == 2 else BATCH_1_PATIENT_IDS
    if args.only:
        wanted = set(args.only.split(","))
        ids = [p for p in ids if p in wanted]

    total = 0
    for pid in ids:
        row = info.get(pid)
        if not row:
            print(f"  {pid}: skipped — not in CSV")
            continue
        total += render_patient(pid, row["Group"], training_dir, out_dir)

    print(f"\nDone. {total} GIFs in {out_dir}")


if __name__ == "__main__":
    main()
