"""
Standalone validation for cpd_aha_segmentation.classify_vertices_to_aha17_cpd().

Not part of the pipeline - run manually, not imported anywhere. There is no real
reconstructed patient OBJ available on this machine (no GPU reconstruction has been
run here), so this uses a DIFFERENT real patient's atlas LV pieces (one file per zone,
distinct from the atlas's own anchor file) as a stand-in "patient" mesh - genuine real
anatomy, independent of the atlas's own reference patient, but not an actual pipeline
output. Re-run this same check against a real GPU-reconstructed mesh before merging.
"""
import os
import sys
import tracemalloc

import numpy as np
import psutil
import trimesh

APP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app")
DEPS_DIR = os.path.join(APP_DIR, "dependencies")
sys.path.insert(0, APP_DIR)
sys.path.insert(0, DEPS_DIR)

from aha_segmentation_3d import classify_vertices_to_aha17  # noqa: E402
import cpd_aha_segmentation as cpd_mod  # noqa: E402
from cpd_aha_segmentation import classify_vertices_to_aha17_cpd, _load_canonical_atlas  # noqa: E402

ATLAS_DIR = os.path.join(APP_DIR, "models", "atlas")

# A different real patient's pieces per zone (none are the atlas's own anchor,
# MM628_..._Anterior.obj) - stands in for an independent patient's LV geometry.
STAND_IN_PATIENT_FILES = {
    "AnteriorLV": "MM614_BP52011_FMA9560_Anterior.obj",
    "SeptalLV": "MM618_BP52013_FMA9345_Septal.obj",
    "LateralLV": "MM621_BP52010_FMA9563_Lateral.obj",
    "InferiorPosteriorLV": "MM622_BP52012_FMA9561_Inferior.obj",
}

_process = psutil.Process()


def rss_mb() -> float:
    return _process.memory_info().rss / (1024 ** 2)


def build_stand_in_patient_points() -> np.ndarray:
    pieces = []
    for zone, fname in STAND_IN_PATIENT_FILES.items():
        mesh = trimesh.load(os.path.join(ATLAS_DIR, zone, fname), force="mesh", process=False)
        pieces.append(np.asarray(mesh.vertices))
    points = np.concatenate(pieces, axis=0)
    # Same canonical prep as the atlas: center, then normalize scale. (No apex-anchor
    # rotation available for this stand-in - CPD only needs plausible overall pose,
    # not the fixed rule's exact axis convention, but note this in the report.)
    points = points - points.mean(axis=0)
    points = points / np.max(np.abs(points))
    return points


def summarize(name: str, labels: np.ndarray):
    unique, counts = np.unique(labels, return_counts=True)
    populated = len(unique)
    print(f"\n[{name}] {labels.shape[0]} vertices, {populated}/17 segments populated")
    if populated < 17:
        missing = sorted(set(range(1, 18)) - set(unique.tolist()))
        print(f"  MISSING segments: {missing}")
    for seg, count in zip(unique, counts):
        print(f"  seg {seg:>2}: {count:>6} verts ({100 * count / labels.shape[0]:5.1f}%)")


def main():
    print(f"Baseline RSS: {rss_mb():.1f} MB")

    print("\nLoading canonical atlas (one-time build: dense + registration-sample clouds)...")
    atlas = _load_canonical_atlas()
    dense_points, dense_labels, reg_points = atlas["dense_points"], atlas["dense_labels"], atlas["reg_points"]
    print(f"  dense atlas points: {dense_points.shape[0]}  |  registration sample: {reg_points.shape[0]}")
    summarize("ATLAS (dense, self-labeled via fixed rule, once)", dense_labels)
    print(f"RSS after atlas build: {rss_mb():.1f} MB")

    print("\nBuilding stand-in patient point cloud (different real patient's LV pieces)...")
    patient_points = build_stand_in_patient_points()
    print(f"  {patient_points.shape[0]} vertices")

    print("\nRunning fixed-rule classification on the stand-in patient mesh...")
    fixed_labels = classify_vertices_to_aha17(patient_points)
    summarize("FIXED-RULE", fixed_labels)

    print("\nRunning CPD-based classification on the stand-in patient mesh"
          " (measuring memory around registration + dense field extension)...")
    rss_before = rss_mb()
    tracemalloc.start()
    cpd_labels = classify_vertices_to_aha17_cpd(patient_points)
    _, peak_traced = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    rss_after = rss_mb()
    print(f"  RSS before: {rss_before:.1f} MB -> after: {rss_after:.1f} MB "
          f"(delta {rss_after - rss_before:+.1f} MB)")
    print(f"  Peak Python-tracked allocation during the call: {peak_traced / (1024 ** 2):.1f} MB")
    summarize("CPD-BASED (with dense field extension)", cpd_labels)

    # Sanity-check the field-extension memory math directly too: (dense_count x
    # registration_count) is the shape of the largest matrix _apply_cpd_field builds
    # per chunk, chunked over dense_count - confirm the chunking actually caps it.
    chunk = cpd_mod._DENSE_FIELD_CHUNK
    reg_n = reg_points.shape[0]
    per_chunk_mb = chunk * reg_n * 8 / (1024 ** 2)
    print(f"\n_apply_cpd_field chunk shape: ({chunk}, {reg_n}) float64 = {per_chunk_mb:.1f} MB per chunk"
          f" ({-(-dense_points.shape[0] // chunk)} chunks total)")

    agreement = float(np.mean(fixed_labels == cpd_labels))
    print(f"\nPer-vertex agreement between fixed-rule and CPD labeling: {agreement * 100:.1f}%")
    print("(Lower = more boundary movement / more patient-adaptive; ~100% would mean CPD")
    print(" changed nothing, which would defeat the point of this change.)")


if __name__ == "__main__":
    main()
