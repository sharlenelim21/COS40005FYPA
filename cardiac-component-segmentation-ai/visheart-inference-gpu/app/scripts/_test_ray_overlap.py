"""
_test_ray_overlap.py
=====================
Read-only test: do angularly-adjacent rays in ray_cast_thickness() /
ray_cast_boundary_points() sample duplicate (rounded/truncated) pixel
coordinates, particularly near the centroid?

This reuses the EXACT angle-generation and pixel-stepping logic read from
app.bullseye_analysis (not a reimplementation with different math):

    angles     = start_angle_rad - np.linspace(0, 2*pi, n_rays, endpoint=False)
    directions = (cos(angle), sin(angle))
    per step r in [1, max_r):
        x = int(cx + r * dx)   # Python int() = truncation toward zero
        y = int(cy + r * dy)

ray_cast_thickness() and ray_cast_boundary_points() are NOT imported or
modified here — this test only needs the pixel path each ray traces, which
is independent of any mask content, so the path-generation logic is copied
verbatim (same formula, same truncation) rather than driving the real
functions with a synthetic mask. compute_alignment_angle() and
group_sectors() are out of scope and untouched.

Usage:
    python -m app.scripts._test_ray_overlap
(run from visheart-inference-gpu/, so `app` is importable — not required by
this script's own imports, but kept consistent with the other _test_ scripts)
"""

from __future__ import annotations
import datetime
import secrets
import numpy as np

RUN_TIMESTAMP = datetime.datetime.now().isoformat()
RUN_NONCE = secrets.token_hex(8)


def ray_pixel_path(cx: float, cy: float, angle_rad: float, max_r: int) -> list[tuple[int, int]]:
    """
    Reproduces the exact per-step pixel coordinates ray_cast_thickness()
    visits for one ray: x = int(cx + r*cos), y = int(cy + r*sin), r = 1..max_r-1.
    """
    dx, dy = np.cos(angle_rad), np.sin(angle_rad)
    path = []
    for r in range(1, max_r):
        x = int(cx + r * dx)
        y = int(cy + r * dy)
        path.append((x, y))
    return path


def analyze_overlap(n_rays: int, cx: float, cy: float, landmark_radius: int, start_angle_rad: float = 0.0):
    """
    For n_rays evenly spaced rays (production formula), compute each ray's
    pixel path out to landmark_radius pixels, and for every pair of
    angularly-adjacent rays (i, i+1 mod n_rays) find the first radius r at
    which their pixel coordinates stop coinciding.
    """
    angles = start_angle_rad - np.linspace(0.0, 2.0 * np.pi, n_rays, endpoint=False)

    paths = [ray_pixel_path(cx, cy, a, landmark_radius) for a in angles]

    per_ray_rows = []
    n_rays_with_overlap = 0

    for i in range(n_rays):
        j = (i + 1) % n_rays
        path_i = paths[i]
        path_j = paths[j]

        overlap_radii = []  # r (1-indexed step) where path_i[r] == path_j[r]... but rays can
        # also coincide at DIFFERENT r along each other's path (e.g. ray i's
        # step at r=3 equals ray j's step at r=2), so compare as sets with
        # radius attached to each point.
        set_i = {pt: r for r, pt in enumerate(path_i, start=1)}
        set_j = {pt: r for r, pt in enumerate(path_j, start=1)}
        shared_pts = set(set_i.keys()) & set(set_j.keys())

        has_overlap = len(shared_pts) > 0
        if has_overlap:
            n_rays_with_overlap += 1
            # "first occurs" = smallest centroid-distance among shared points
            first_shared_pt = min(shared_pts, key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)
            first_overlap_radius_px = float(np.hypot(first_shared_pt[0] - cx, first_shared_pt[1] - cy))
            # Radius of the LAST shared point encountered along the path (NOT a
            # "rays become distinct beyond this" guarantee — overlap is not
            # necessarily contiguous, so this is purely descriptive of where the
            # last collision happens to fall, and is reported alongside
            # is_contiguous_from_centroid below so it can't be misread as that).
            last_shared_pt = max(shared_pts, key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)
            last_shared_radius_px = float(np.hypot(last_shared_pt[0] - cx, last_shared_pt[1] - cy))
        else:
            first_overlap_radius_px = None
            last_shared_radius_px = None

        # Whether the shared-pixel steps form one unbroken run starting at r=1
        # (true near-centroid-only collision) vs. collisions recurring
        # intermittently out to the edge of the tested radius.
        shared_steps = sorted(set_i[p] for p in shared_pts) if shared_pts else []
        is_contiguous_from_start = bool(shared_steps) and shared_steps == list(range(1, shared_steps[-1] + 1))
        fraction_of_path_shared = len(shared_pts) / len(path_i) if path_i else 0.0

        per_ray_rows.append({
            "ray_i": i,
            "ray_j": j,
            "angle_i_deg": float(np.degrees(angles[i])),
            "angle_j_deg": float(np.degrees(angles[j])),
            "has_overlap": has_overlap,
            "n_shared_pixels": len(shared_pts),
            "fraction_of_path_shared": fraction_of_path_shared,
            "first_overlap_radius_px": first_overlap_radius_px,
            "last_shared_radius_px": last_shared_radius_px,
            "is_contiguous_from_start": is_contiguous_from_start,
        })

    return per_ray_rows, n_rays_with_overlap


def print_report(n_rays: int, rows: list[dict], n_with_overlap: int, landmark_radius: int):
    print(f"--- {n_rays} rays (angular step = {360.0 / n_rays:.4f} deg), "
          f"landmark_radius = {landmark_radius}px ---")
    header = (f"{'ray_i':>6} | {'ray_j':>6} | {'angle_i_deg':>12} | {'overlap':>8} | "
              f"{'n_shared_px':>11} | {'frac_shared':>11} | {'first_r_px':>10} | "
              f"{'last_r_px':>9} | {'contig_from_r=1':>15}")
    print(header)
    print("-" * len(header))
    for row in rows:
        first_r = f"{row['first_overlap_radius_px']:.3f}" if row["first_overlap_radius_px"] is not None else "-"
        last_r = f"{row['last_shared_radius_px']:.3f}" if row["last_shared_radius_px"] is not None else "-"
        print(f"{row['ray_i']:>6} | {row['ray_j']:>6} | {row['angle_i_deg']:>12.3f} | "
              f"{str(row['has_overlap']):>8} | {row['n_shared_pixels']:>11} | "
              f"{row['fraction_of_path_shared']:>11.3f} | {first_r:>10} | {last_r:>9} | "
              f"{str(row['is_contiguous_from_start']):>15}")
    print()
    print(f"SUMMARY ({n_rays} rays): {n_with_overlap}/{n_rays} adjacent ray-pairs have "
          f"at least one shared pixel coordinate.")
    overlapping = [r for r in rows if r["has_overlap"]]
    if overlapping:
        first_radii = [r["first_overlap_radius_px"] for r in overlapping]
        last_radii = [r["last_shared_radius_px"] for r in overlapping]
        fractions = [r["fraction_of_path_shared"] for r in overlapping]
        n_contiguous = sum(1 for r in overlapping if r["is_contiguous_from_start"])
        print(f"  first_overlap_radius_px : min={min(first_radii):.3f}, max={max(first_radii):.3f}")
        print(f"  last_shared_radius_px   : min={min(last_radii):.3f}, max={max(last_radii):.3f} "
              f"(NOT a 'distinct beyond this' guarantee — see contig_from_r=1 column: overlap is "
              f"CONTIGUOUS from the centroid outward for only {n_contiguous}/{len(overlapping)} "
              f"overlapping pairs; the rest have collisions recurring intermittently out to "
              f"last_shared_radius_px)")
        print(f"  fraction_of_path_shared : min={min(fractions):.3f}, max={max(fractions):.3f}, "
              f"mean={np.mean(fractions):.3f} (fraction of each ray's {landmark_radius} sampled "
              f"radial steps that coincide with its neighbor's steps)")
    else:
        print("  No overlapping pairs found — rays are pixel-distinct at every tested radius.")
    print()


def main():
    print("=" * 100)
    print("RAY OVERLAP TEST — adjacent-ray pixel-path collisions in ray_cast_thickness() geometry")
    print(f"run_timestamp = {RUN_TIMESTAMP}")
    print(f"run_nonce     = {RUN_NONCE}")
    print("=" * 100)
    print()
    print("Angle generation formula (copied verbatim from ray_cast_thickness(), "
          "app/bullseye_analysis.py:206):")
    print("  angles = start_angle_rad - np.linspace(0, 2*pi, n_rays, endpoint=False)")
    print("Pixel step formula (copied verbatim from ray_cast_thickness(), lines 220-222):")
    print("  for r in range(1, max_r): x = int(cx + r*cos(angle)); y = int(cy + r*sin(angle))")
    print("  (Python int() truncates toward zero — this is the actual rounding behavior used "
          "in production, not nearest-integer rounding.)")
    print()
    print("Confirmed from Step 1 reading: production calls ray_cast_thickness(sl, cx, cy, "
          "start_angle_rad=start_angle) for the basal ring with NO n_rays override "
          "(bullseye_analysis.py:804) -> uses the function default n_rays=360.")
    print()

    cx, cy = 100.0, 100.0
    landmark_radius = 40  # matches the sweep test's synthetic landmark radius convention

    for n_rays in (360, 60):
        rows, n_with_overlap = analyze_overlap(n_rays, cx, cy, landmark_radius)
        print_report(n_rays, rows, n_with_overlap, landmark_radius)

    print("=" * 100)
    print(f"(run_timestamp={RUN_TIMESTAMP}, run_nonce={RUN_NONCE})")


if __name__ == "__main__":
    main()
