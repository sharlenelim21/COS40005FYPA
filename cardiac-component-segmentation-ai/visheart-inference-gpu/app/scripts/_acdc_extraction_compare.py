import argparse
import asyncio
import json
import os
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from itertools import combinations
from pathlib import Path
from typing import Dict, List, Tuple

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

# Ensure imports work regardless of launch cwd.
SCRIPT_DIR = Path(__file__).resolve().parent
APP_DIR = SCRIPT_DIR.parent
REPO_DIR = APP_DIR.parent
if str(REPO_DIR) not in sys.path:
    sys.path.insert(0, str(REPO_DIR))

from app.classes.fourdreconstruction_handler import FourDReconstructionHandler


@dataclass
class SampleResult:
    sample_name: str
    mesh_file: str
    pointcloud_file: str
    sdf_file: str
    sign_file: str
    point_count: int
    point_bbox_min: List[float]
    point_bbox_max: List[float]
    point_centroid: List[float]
    sdf_shape: List[int]
    sdf_min: float
    sdf_max: float
    sdf_mean: float
    sdf_std: float
    sdf_near_surface_frac_005: float
    sign_check: Dict
    elapsed_sec: float


def _sample_points(points: np.ndarray, max_points: int, rng: np.random.Generator) -> np.ndarray:
    if points.shape[0] <= max_points:
        return points
    idx = rng.choice(points.shape[0], size=max_points, replace=False)
    return points[idx]


def _pairwise_chamfer_l2(a: np.ndarray, b: np.ndarray, max_points: int = 2000, seed: int = 42) -> float:
    rng = np.random.default_rng(seed)
    a_s = _sample_points(a, max_points, rng)
    b_s = _sample_points(b, max_points, rng)

    # Brute-force pairwise distance on subsampled clouds for dependency-free robustness.
    d_ab = np.sqrt(((a_s[:, None, :] - b_s[None, :, :]) ** 2).sum(axis=2))
    min_ab = d_ab.min(axis=1)
    min_ba = d_ab.min(axis=0)
    return float(min_ab.mean() + min_ba.mean())


def _render_pointcloud_views(points: np.ndarray, output_png: Path, title: str) -> None:
    rng = np.random.default_rng(42)
    pts = _sample_points(points, max_points=12000, rng=rng)

    fig, axes = plt.subplots(1, 3, figsize=(15, 4), dpi=150)
    fig.suptitle(title)

    views = [
        (0, 1, "XY"),
        (0, 2, "XZ"),
        (1, 2, "YZ"),
    ]
    for ax, (i, j, label) in zip(axes, views):
        ax.scatter(pts[:, i], pts[:, j], s=1, alpha=0.5)
        ax.set_title(f"{label} projection")
        ax.set_xlabel(["X", "Y", "Z"][i])
        ax.set_ylabel(["X", "Y", "Z"][j])
        ax.set_aspect("equal", adjustable="box")

    fig.tight_layout()
    fig.savefig(output_png)
    plt.close(fig)


def _render_sdf_slices(sdf: np.ndarray, output_png: Path, title: str) -> None:
    cx, cy, cz = (np.array(sdf.shape) // 2).astype(int)
    slices = [
        (sdf[cx, :, :], f"X={cx}"),
        (sdf[:, cy, :], f"Y={cy}"),
        (sdf[:, :, cz], f"Z={cz}"),
    ]

    vmax = float(np.percentile(np.abs(sdf), 99))
    vmax = max(vmax, 1e-6)

    fig, axes = plt.subplots(1, 3, figsize=(15, 4), dpi=150)
    fig.suptitle(title)

    for ax, (arr, label) in zip(axes, slices):
        im = ax.imshow(arr.T, cmap="seismic", vmin=-vmax, vmax=vmax, origin="lower")
        ax.set_title(f"Central slice {label}")
        ax.set_xticks([])
        ax.set_yticks([])
        fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)

    fig.tight_layout()
    fig.savefig(output_png)
    plt.close(fig)


def _write_markdown_report(
    report_path: Path,
    summary: Dict,
    sample_results: List[SampleResult],
    pairwise_metrics: List[Dict],
) -> None:
    lines: List[str] = []
    lines.append("# ACDC Extraction Comparison (Sprint 2)")
    lines.append("")
    lines.append("This report was regenerated from a clean run and replaces previous cluttered outputs.")
    lines.append("")
    lines.append("## Run Configuration")
    lines.append("")
    lines.append(f"- Generated at: {summary['generated_at_utc']}")
    lines.append(f"- Model: `{summary['model_path']}`")
    lines.append(f"- Num iterations: {summary['num_iterations']}")
    lines.append(f"- Resolution: {summary['resolution']}")
    lines.append(f"- Process all frames: {summary['process_all_frames']}")
    lines.append(f"- ED frame index: {summary['ed_frame_index']}")
    lines.append("")
    lines.append("## Per-Sample Results")
    lines.append("")
    for r in sample_results:
        lines.append(f"### {r.sample_name}")
        lines.append("")
        lines.append(f"- Mesh: `{r.mesh_file}`")
        lines.append(f"- Point cloud: `{r.pointcloud_file}`")
        lines.append(f"- SDF: `{r.sdf_file}`")
        lines.append(f"- Sign report: `{r.sign_file}`")
        lines.append(f"- Point count: {r.point_count}")
        lines.append(f"- Point bbox min: {np.round(np.array(r.point_bbox_min), 6).tolist()}")
        lines.append(f"- Point bbox max: {np.round(np.array(r.point_bbox_max), 6).tolist()}")
        lines.append(f"- Point centroid: {np.round(np.array(r.point_centroid), 6).tolist()}")
        lines.append(f"- SDF shape: {r.sdf_shape}")
        lines.append(f"- SDF min/max: {r.sdf_min:.6f} / {r.sdf_max:.6f}")
        lines.append(f"- SDF mean/std: {r.sdf_mean:.6f} / {r.sdf_std:.6f}")
        lines.append(f"- Near-surface fraction (|sdf|<0.005): {r.sdf_near_surface_frac_005:.6f}")
        lines.append(
            f"- Sign check: sign_convention_ok={r.sign_check.get('sign_convention_ok')}, "
            f"inside_sdf={r.sign_check.get('inside_candidate', {}).get('sdf')}, "
            f"outside_sdf={r.sign_check.get('outside_candidate', {}).get('sdf')}"
        )
        lines.append(f"- Runtime (s): {r.elapsed_sec:.2f}")
        lines.append("")

    lines.append("## Pairwise Point Cloud Distance")
    lines.append("")
    lines.append("Lower Chamfer-L2 means more similar point clouds.")
    lines.append("")
    for m in pairwise_metrics:
        lines.append(f"- {m['a']} vs {m['b']}: chamfer_l2={m['chamfer_l2']:.6f}")
    lines.append("")

    lines.append("## Recommendation")
    lines.append("")
    lines.append(
        "Use this high-quality extraction setting (higher iterations/resolution) for qualitative review and "
        "keep Chamfer-L2 in the summary as a quick quantitative sanity check when visuals appear similar."
    )
    lines.append("")

    report_path.write_text("\n".join(lines), encoding="utf-8")


async def _run_single_sample(
    handler: FourDReconstructionHandler,
    sample_path: Path,
    output_dir: Path,
    num_iterations: int,
    resolution: int,
    process_all_frames: bool,
    ed_frame_index: int,
) -> Tuple[SampleResult, np.ndarray, np.ndarray]:
    output_dir.mkdir(parents=True, exist_ok=True)

    result = await handler.predict(
        nifti_file_path=str(sample_path),
        output_dir=str(output_dir),
        num_iterations=num_iterations,
        resolution=resolution,
        export_format="obj",
        extract_point_cloud=True,
        point_cloud_format="npy",
        extract_sdf=True,
        verify_sdf_sign=True,
        process_all_frames=process_all_frames,
        ed_frame_index=ed_frame_index,
    )

    if not result.get("success"):
        raise RuntimeError(f"Sample {sample_path.name} failed: {result.get('error')}")

    extraction_files = result.get("extraction_files", [])
    pointcloud_file = next((p for p in extraction_files if p.endswith("_pointcloud.npy")), None)
    sdf_file = next((p for p in extraction_files if p.endswith("_sdf.npy")), None)
    sign_file = next((p for p in extraction_files if p.endswith("_sdf_sign_check.json")), None)

    if not (pointcloud_file and sdf_file and sign_file):
        raise RuntimeError(
            f"Missing extraction artifacts for {sample_path.name}: "
            f"pointcloud={pointcloud_file}, sdf={sdf_file}, sign={sign_file}"
        )

    points = np.load(pointcloud_file)
    sdf = np.load(sdf_file)
    sign = json.loads(Path(sign_file).read_text(encoding="utf-8"))

    sample_name = sample_path.stem.replace(".nii", "")

    visuals_dir = output_dir / "visuals"
    visuals_dir.mkdir(parents=True, exist_ok=True)
    _render_pointcloud_views(
        points,
        visuals_dir / f"{sample_name}_pointcloud_views.png",
        f"{sample_name}: point cloud projections",
    )
    _render_sdf_slices(
        sdf,
        visuals_dir / f"{sample_name}_sdf_slices.png",
        f"{sample_name}: SDF central slices",
    )

    near_surface = float((np.abs(sdf) < 0.005).mean())

    sample_result = SampleResult(
        sample_name=sample_name,
        mesh_file=result["mesh_file"],
        pointcloud_file=pointcloud_file,
        sdf_file=sdf_file,
        sign_file=sign_file,
        point_count=int(points.shape[0]),
        point_bbox_min=points.min(axis=0).astype(float).tolist(),
        point_bbox_max=points.max(axis=0).astype(float).tolist(),
        point_centroid=points.mean(axis=0).astype(float).tolist(),
        sdf_shape=list(sdf.shape),
        sdf_min=float(sdf.min()),
        sdf_max=float(sdf.max()),
        sdf_mean=float(sdf.mean()),
        sdf_std=float(sdf.std()),
        sdf_near_surface_frac_005=near_surface,
        sign_check=sign,
        elapsed_sec=float(result.get("reconstruction_time", 0.0)),
    )
    return sample_result, points, sdf


async def main() -> None:
    parser = argparse.ArgumentParser(description="Run clean high-quality ACDC extraction comparison.")
    parser.add_argument("--num-iterations", type=int, default=120)
    parser.add_argument("--resolution", type=int, default=160)
    parser.add_argument("--process-all-frames", action="store_true", default=False)
    parser.add_argument("--ed-frame-index", type=int, default=0)
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    app_dir = script_dir.parent
    repo_dir = app_dir.parent
    workspace_dir = repo_dir.parent

    model_path = app_dir / "models" / "fourd_model_epoch_250.pth"
    sample_dir = workspace_dir / "Cardiac_Segmentation_FYP_Server" / "public"

    # Use the same 3-sample set as prior Sprint comparison intent.
    sample_paths = [
        sample_dir / "patient001_4d.nii.gz",
        sample_dir / "patient002_4d.nii.gz",
        sample_dir / "patient003_4d.nii.gz",
    ]

    for p in sample_paths + [model_path]:
        if not p.exists():
            raise FileNotFoundError(f"Required file missing: {p}")

    eval_root = app_dir / "_acdc_eval"
    if eval_root.exists():
        shutil.rmtree(eval_root)
    eval_root.mkdir(parents=True, exist_ok=True)

    visuals_root = eval_root / "visuals"
    visuals_root.mkdir(parents=True, exist_ok=True)

    handler = FourDReconstructionHandler(model_path=str(model_path))

    sample_results: List[SampleResult] = []
    pointclouds: Dict[str, np.ndarray] = {}

    for sample_path in sample_paths:
        sample_name = sample_path.stem.replace(".nii", "")
        sample_output_dir = eval_root / sample_name
        r, points, _ = await _run_single_sample(
            handler,
            sample_path=sample_path,
            output_dir=sample_output_dir,
            num_iterations=args.num_iterations,
            resolution=args.resolution,
            process_all_frames=args.process_all_frames,
            ed_frame_index=args.ed_frame_index,
        )

        # Copy visuals into a single top-level folder for easier browsing.
        src_views = sample_output_dir / "visuals" / f"{sample_name}_pointcloud_views.png"
        src_sdf = sample_output_dir / "visuals" / f"{sample_name}_sdf_slices.png"
        shutil.copy2(src_views, visuals_root / src_views.name)
        shutil.copy2(src_sdf, visuals_root / src_sdf.name)

        sample_results.append(r)
        pointclouds[sample_name] = points

    pairwise_metrics: List[Dict] = []
    for a, b in combinations([r.sample_name for r in sample_results], 2):
        d = _pairwise_chamfer_l2(pointclouds[a], pointclouds[b], max_points=2000, seed=42)
        pairwise_metrics.append({"a": a, "b": b, "chamfer_l2": d})

    summary = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "model_path": str(model_path),
        "num_iterations": args.num_iterations,
        "resolution": args.resolution,
        "process_all_frames": args.process_all_frames,
        "ed_frame_index": args.ed_frame_index,
        "samples": [r.__dict__ for r in sample_results],
        "pairwise_metrics": pairwise_metrics,
    }

    summary_path = eval_root / "summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    report_path = repo_dir / "README_ACDC_EXTRACTION_COMPARISON_SPRINT2.md"
    _write_markdown_report(report_path, summary, sample_results, pairwise_metrics)

    print(f"Saved summary: {summary_path}")
    print(f"Saved report: {report_path}")
    print(f"Saved visuals: {visuals_root}")


if __name__ == "__main__":
    asyncio.run(main())