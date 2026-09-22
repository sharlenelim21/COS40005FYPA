"""
_test_ray_count_accuracy.py
=============================
Read-only test: does 360 rays measurably outperform 60 rays for basal-ring
wall thickness, on synthetic masks with a KNOWN ground-truth thickness?

Calls the real, unmodified ray_cast_thickness(), compute_centroid(), and
group_sectors() from app.bullseye_analysis against synthetic myocardium-ring
masks built by this script. Nothing in bullseye_analysis.py is changed.

Usage:
    python -m app.scripts._test_ray_count_accuracy
(run from visheart-inference-gpu/)
"""

from __future__ import annotations
import datetime
import secrets
import numpy as np
import cv2

from app.bullseye_analysis import (
    compute_centroid,
    ray_cast_thickness,
    group_sectors,
    _MYO_CLASS,
    _RV_CLASS,
)

RUN_TIMESTAMP = datetime.datetime.now().isoformat()
RUN_NONCE = secrets.token_hex(8)

_LV_CLASS = 3
_H = _W = 300
_CX, _CY = 150.0, 150.0
_INNER_RADIUS = 60.0  # LV cavity radius; wall sits outside this
_BASAL_START_ANGLE = 4 * np.pi / 3  # 240°, production's fixed basal start angle (no landmarks)

AHA_BASAL_SECTOR_NAMES = [
    "1 Basal Anterior", "2 Basal Anteroseptal", "3 Basal Inferoseptal",
    "4 Basal Inferior", "5 Basal Inferolateral", "6 Basal Anterolateral",
]


def build_uniform_annulus_mask(thickness_px: float) -> np.ndarray:
    """
    Concentric annulus: LV cavity (class 3) disk of radius _INNER_RADIUS,
    surrounded by myocardium (class 2) ring of uniform width thickness_px.
    Background (class 0) elsewhere. No RV (keeps this test isolated to LV
    wall-thickness measurement only).
    """
    mask = np.zeros((_H, _W), dtype=np.uint8)
    yy, xx = np.mgrid[0:_H, 0:_W]
    dist = np.sqrt((xx - _CX) ** 2 + (yy - _CY) ** 2)

    mask[dist <= _INNER_RADIUS] = _LV_CLASS
    mask[(dist > _INNER_RADIUS) & (dist <= _INNER_RADIUS + thickness_px)] = _MYO_CLASS
    return mask


def build_nonuniform_annulus_mask(thickness_by_angle_deg: dict[int, float]) -> np.ndarray:
    """
    Non-uniform annulus: outer wall radius varies by angle, piecewise-constant
    across the 6 keys of thickness_by_angle_deg (angle breakpoints in degrees,
    standard math convention CCW from +x axis, matching AHA sector boundaries
    used by group_sectors: 0,60,120,180,240,300).

    thickness_by_angle_deg: dict mapping sector-start-angle-deg -> thickness_px
    for that 60-degree wedge, e.g. {0: 6.0, 60: 8.0, 120: 10.0, 180: 8.0,
    240: 6.0, 300: 8.0}.
    """
    mask = np.zeros((_H, _W), dtype=np.uint8)
    yy, xx = np.mgrid[0:_H, 0:_W]
    dist = np.sqrt((xx - _CX) ** 2 + (yy - _CY) ** 2)
    angle_deg = (np.degrees(np.arctan2(yy - _CY, xx - _CX))) % 360.0

    mask[dist <= _INNER_RADIUS] = _LV_CLASS

    for start_deg, thickness_px in thickness_by_angle_deg.items():
        end_deg = start_deg + 60
        in_wedge = (angle_deg >= start_deg) & (angle_deg < end_deg)
        in_ring = (dist > _INNER_RADIUS) & (dist <= _INNER_RADIUS + thickness_px)
        mask[in_wedge & in_ring] = _MYO_CLASS

    return mask


def measure(mask: np.ndarray, n_rays: int) -> np.ndarray:
    """Run the real compute_centroid + ray_cast_thickness + group_sectors pipeline."""
    cx, cy = compute_centroid(mask, class_label=_LV_CLASS)
    assert cx is not None, "synthetic mask has no LV cavity — bug in test fixture"
    thicknesses = ray_cast_thickness(mask, cx, cy, n_rays=n_rays, start_angle_rad=_BASAL_START_ANGLE)
    sectors = group_sectors(thicknesses, "basal")
    return sectors


def print_uniform_scenario(label: str, ground_truth_px: float):
    print(f"--- Uniform annulus scenario: {label} (ground truth = {ground_truth_px}px) ---")
    mask = build_uniform_annulus_mask(ground_truth_px)

    results = {}
    for n_rays in (360, 60):
        sectors = measure(mask, n_rays)
        errors = sectors - ground_truth_px
        results[n_rays] = (sectors, errors)

    header = f"{'sector':>24} | {'360-ray px':>11} | {'360 err':>9} | {'60-ray px':>10} | {'60 err':>9}"
    print(header)
    print("-" * len(header))
    for i, name in enumerate(AHA_BASAL_SECTOR_NAMES):
        s360, e360 = results[360]
        s60, e60 = results[60]
        print(f"{name:>24} | {s360[i]:>11.4f} | {e360[i]:>9.4f} | {s60[i]:>10.4f} | {e60[i]:>9.4f}")
    print()

    for n_rays in (360, 60):
        sectors, errors = results[n_rays]
        mean_abs_err = float(np.mean(np.abs(errors)))
        std_across_segments = float(np.std(sectors))
        print(f"  {n_rays:>3} rays: mean |error| vs ground truth = {mean_abs_err:.4f}px, "
              f"segment-to-segment std = {std_across_segments:.4f}px, "
              f"segment values = {np.round(sectors, 4).tolist()}")
    print()

    mae_360 = float(np.mean(np.abs(results[360][1])))
    mae_60 = float(np.mean(np.abs(results[60][1])))
    std_360 = float(np.std(results[360][0]))
    std_60 = float(np.std(results[60][0]))
    lower_err = "360" if mae_360 < mae_60 else ("60" if mae_60 < mae_360 else "TIE")
    lower_std = "360" if std_360 < std_60 else ("60" if std_60 < std_360 else "TIE")
    print(f"  => lower mean |error|: {lower_err}-ray ({mae_360:.4f} vs {mae_60:.4f}); "
          f"lower segment-to-segment std: {lower_std}-ray ({std_360:.4f} vs {std_60:.4f})")
    print()
    return {"label": label, "mae_360": mae_360, "mae_60": mae_60, "std_360": std_360, "std_60": std_60}


def print_nonuniform_scenario():
    label = "Non-uniform annulus (piecewise-constant thickness per AHA sector)"
    thickness_by_angle = {0: 6.0, 60: 8.0, 120: 10.0, 180: 8.0, 240: 6.0, 300: 9.0}
    print(f"--- {label} ---")
    print(f"  Per-wedge ground truth (angle-deg -> thickness-px): {thickness_by_angle}")
    mask = build_nonuniform_annulus_mask(thickness_by_angle)

    # Map math-convention angle wedges to AHA sector ground truth using the
    # SAME start-angle/roll convention ray_cast_thickness+group_sectors use,
    # by simply reading the ground truth off the wedge each sector's angular
    # range falls into. group_sectors with start=240° basal produces AHA
    # order [Anterior..Anterolateral] from raw CW sectors starting at 240°;
    # rather than re-deriving that mapping by hand (error-prone), we instead
    # read the expected value per AHA sector directly from a dense analytic
    # sampling of the same wedge function used to build the mask, at the
    # actual ray angles group_sectors would assign to each AHA sector. This
    # keeps ground truth tied to the mask-generation function, not a
    # hand-derived guess about roll direction.
    ground_truth_sectors = analytic_ground_truth_per_aha_sector(thickness_by_angle, n_rays=360)

    results = {}
    for n_rays in (360, 60):
        sectors = measure(mask, n_rays)
        gt = analytic_ground_truth_per_aha_sector(thickness_by_angle, n_rays=n_rays)
        errors = sectors - gt
        results[n_rays] = (sectors, errors, gt)

    header = f"{'sector':>24} | {'gt(360) px':>10} | {'360-ray px':>11} | {'360 err':>9} | {'gt(60) px':>10} | {'60-ray px':>10} | {'60 err':>9}"
    print(header)
    print("-" * len(header))
    for i, name in enumerate(AHA_BASAL_SECTOR_NAMES):
        s360, e360, gt360 = results[360]
        s60, e60, gt60 = results[60]
        print(f"{name:>24} | {gt360[i]:>10.4f} | {s360[i]:>11.4f} | {e360[i]:>9.4f} | "
              f"{gt60[i]:>10.4f} | {s60[i]:>10.4f} | {e60[i]:>9.4f}")
    print()

    for n_rays in (360, 60):
        sectors, errors, gt = results[n_rays]
        mean_abs_err = float(np.mean(np.abs(errors)))
        std_across_segments = float(np.std(sectors))
        print(f"  {n_rays:>3} rays: mean |error| vs analytic ground truth = {mean_abs_err:.4f}px, "
              f"segment-to-segment std = {std_across_segments:.4f}px")
    print()

    mae_360 = float(np.mean(np.abs(results[360][1])))
    mae_60 = float(np.mean(np.abs(results[60][1])))
    std_360 = float(np.std(results[360][0]))
    std_60 = float(np.std(results[60][0]))
    lower_err = "360" if mae_360 < mae_60 else ("60" if mae_60 < mae_360 else "TIE")
    lower_std = "360" if std_360 < std_60 else ("60" if std_60 < std_360 else "TIE")
    print(f"  => lower mean |error|: {lower_err}-ray ({mae_360:.4f} vs {mae_60:.4f}); "
          f"lower segment-to-segment std: {lower_std}-ray ({std_360:.4f} vs {std_60:.4f})")
    print()
    return {"label": label, "mae_360": mae_360, "mae_60": mae_60, "std_360": std_360, "std_60": std_60}


def analytic_ground_truth_per_aha_sector(thickness_by_angle_deg: dict[int, float], n_rays: int) -> np.ndarray:
    """
    Derive the expected group_sectors() output analytically for the
    piecewise-constant wedge function used to build the mask, at a given
    ray count — by evaluating the wedge function at the exact ray angles
    group_sectors would average over the basal start angle (240°), rather
    than assuming a roll direction by hand. Uses math-convention angles
    (CCW from +x), matching how build_nonuniform_annulus_mask defines wedges.
    """
    start_angle_rad = _BASAL_START_ANGLE
    angles_rad = start_angle_rad - np.linspace(0.0, 2.0 * np.pi, n_rays, endpoint=False)
    angles_deg = np.degrees(angles_rad) % 360.0

    def wedge_thickness(a_deg: float) -> float:
        for start_deg, thickness_px in thickness_by_angle_deg.items():
            if start_deg <= a_deg < start_deg + 60:
                return thickness_px
        return float("nan")  # shouldn't happen, wedges tile 0-360

    per_ray_gt = np.array([wedge_thickness(a) for a in angles_deg])
    return group_sectors(per_ray_gt, "basal")


def main():
    print("=" * 100)
    print("RAY COUNT ACCURACY/CONSISTENCY TEST — 360 vs 60 rays, basal ring (6 AHA sectors)")
    print(f"run_timestamp = {RUN_TIMESTAMP}")
    print(f"run_nonce     = {RUN_NONCE}")
    print("=" * 100)
    print()
    print(f"Synthetic mask: {_H}x{_W}px, LV cavity (class {_LV_CLASS}) disk radius "
          f"{_INNER_RADIUS}px at centroid ({_CX}, {_CY}), myocardium (class {_MYO_CLASS}) "
          f"ring around it. compute_centroid(), ray_cast_thickness(), and group_sectors() "
          f"are the real, unmodified functions from app.bullseye_analysis. "
          f"basal start_angle_rad = 240 deg (production's fixed no-landmark basal default).")
    print()

    summary_rows = []

    print("### Part A: uniform (perfectly concentric) annulus, 3 thickness scenarios ###")
    print()
    summary_rows.append(print_uniform_scenario("thin wall", 4.0))
    summary_rows.append(print_uniform_scenario("typical wall", 8.0))
    summary_rows.append(print_uniform_scenario("thick wall", 14.0))

    print("### Part B: non-uniform annulus (thickness varies by AHA sector) ###")
    print()
    summary_rows.append(print_nonuniform_scenario())

    print("=" * 100)
    print("OVERALL SUMMARY")
    print("=" * 100)
    header = f"{'scenario':>45} | {'MAE 360':>9} | {'MAE 60':>9} | {'lower err':>10} | {'std 360':>9} | {'std 60':>9} | {'lower std':>10}"
    print(header)
    print("-" * len(header))
    n_360_lower_err = n_60_lower_err = n_360_lower_std = n_60_lower_std = 0
    for row in summary_rows:
        lower_err = "360" if row["mae_360"] < row["mae_60"] else ("60" if row["mae_60"] < row["mae_360"] else "TIE")
        lower_std = "360" if row["std_360"] < row["std_60"] else ("60" if row["std_60"] < row["std_360"] else "TIE")
        if lower_err == "360": n_360_lower_err += 1
        elif lower_err == "60": n_60_lower_err += 1
        if lower_std == "360": n_360_lower_std += 1
        elif lower_std == "60": n_60_lower_std += 1
        print(f"{row['label']:>45} | {row['mae_360']:>9.4f} | {row['mae_60']:>9.4f} | {lower_err:>10} | "
              f"{row['std_360']:>9.4f} | {row['std_60']:>9.4f} | {lower_std:>10}")
    print()
    print(f"Across {len(summary_rows)} scenarios: 360-ray had lower mean |error| in "
          f"{n_360_lower_err}/{len(summary_rows)}; 60-ray had lower mean |error| in "
          f"{n_60_lower_err}/{len(summary_rows)}.")
    print(f"Across {len(summary_rows)} scenarios: 360-ray had lower segment-to-segment std in "
          f"{n_360_lower_std}/{len(summary_rows)}; 60-ray had lower segment-to-segment std in "
          f"{n_60_lower_std}/{len(summary_rows)}.")
    print()
    print(f"(run_timestamp={RUN_TIMESTAMP}, run_nonce={RUN_NONCE})")


if __name__ == "__main__":
    main()
