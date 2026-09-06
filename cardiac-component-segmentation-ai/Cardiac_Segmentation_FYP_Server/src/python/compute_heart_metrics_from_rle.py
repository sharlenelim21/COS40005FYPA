"""
compute_heart_metrics_from_rle.py
=================================
Compute cardiac clinical metrics (chamber volumes, ejection fraction, LV mass)
from a segmentation mask document stored in MongoDB (RLE / segmentationmask-
contents format), using the project's stored 4x4 NIfTI affine to convert voxel
counts to millilitres.

I/O contract mirrors compute_bullseye_from_rle.py: read one JSON object from
stdin, write one JSON object to stdout. Non-recoverable errors print
`{"error": "..."}` and `sys.exit(1)`.

Input (stdin JSON):
    frames     — list[frame]           # same schema as IProjectSegmentationMask.frames
    width      — int                   # image width in pixels
    height     — int                   # image height in pixels
    affine     — number[4][4]          # 4x4 affine from the NIfTI header
    ed_frame?  — int (optional)        # explicit end-diastole override
    es_frame?  — int (optional)        # explicit end-systole override
    bsa_m2?    — float (optional)      # body surface area; enables *_I fields below

Output (stdout JSON):
    ed_frame, es_frame                 # frames actually used (auto or override)
    lv_volumes_ml, rv_volumes_ml       # per-frame volume curves (index = frameindex)
    LVEDV, LVESV, LV_SV, LVEF          # LV metrics (SV/EF may be null — see below)
    RVEDV, RVESV, RV_SV, RVEF          # RV metrics
    LV_mass_g                          # LV myocardial mass at ED (may be null)
    bsa_m2, LVEDVI, LVESVI,            # BSA passthrough + indexed volumes (mL/m^2).
    RVEDVI, RVESVI                       null unless bsa_m2 was supplied and positive.
    voxel_mm3, spacing_mm              # derived from affine, kept for audit
    units                              # {volumes, ef, mass, spacing, bsa, indexed_volumes}
    warnings                           # list[str], empty on the happy path

Class mapping (same as the bullseye script + create_nifti_with_stored_affine):
    0 = background, 1 = RV, 2 = MYO, 3 = LVC

RLE format: COCO-style space-separated pairs "offset length offset length ..."
applied to a flat (H*W) row-major array. Value of 1 means the pixel belongs
to this class.

Formulas — see references section in docs/HEART_METRICS_IMPLEMENTATION.md
(ACDC challenge metrics_acdc.py and Bernard et al. 2018 IEEE TMI):
    spacing   = sqrt(sum(affine[:3, :3] ** 2, axis=0))           # (dx,dy,dz) mm
    voxel_mm3 = dx * dy * dz
    volume_mL = voxel_count * voxel_mm3 / 1000.0                 # 1 mL = 1000 mm^3
    ED        = frame with the largest LV-cavity volume
    ES        = frame with the smallest LV-cavity volume (among positive frames)
    LVEF      = (LVEDV - LVESV) / LVEDV * 100
    LV_mass_g = MYO_voxels_at_ED * voxel_mm3 / 1000 * 1.05       # 1.05 g/mL

EF is a ratio: it cancels voxel volume, so it is independent of image spacing
and patient body size (no BSA needed). Volumes and mass are absolute and DO
depend on spacing — hence the requirement for a valid 4x4 affine.

Pure Python + numpy. No cv2, nibabel, or scipy required.
"""

from __future__ import annotations

import json
import math
import sys
from collections import defaultdict
from typing import Optional

import warnings as _pywarnings

import numpy as np

# Silence the numpy "invalid value encountered" chatter on all-zero frames.
_pywarnings.filterwarnings("ignore", category=RuntimeWarning)


# ── Class map (identical to compute_bullseye_from_rle.py) ─────────────────────
# The mask schema stores class names lowercase (enum ComponentBoundingBoxesClass)
# but historic data may include uppercase — accept both, as bullseye does.
CLASS_MAP = {
    "myo": 2, "MYO": 2,
    "lvc": 3, "LVC": 3,
    "rv":  1, "RV":  1,
}
_LVC_CLASS = 3
_MYO_CLASS = 2
_RV_CLASS  = 1

# Reverse of CLASS_MAP for human-readable warnings / duplicate_slices output.
_CLASS_NAME = {_RV_CLASS: "rv", _MYO_CLASS: "myo", _LVC_CLASS: "lvc"}

# Myocardial density in g/mL (Bernard et al. 2018; standard cardiology value).
_MYO_DENSITY_G_PER_ML = 1.05

# ── Duplicate-slice detection thresholds (Part A) ─────────────────────────────
# A copied slice keeps its pixels but gets a NEW sliceindex, so the union dedup
# in count_voxels_per_frame (keyed on (frame, slice, class)) cannot catch it —
# the copy lands under a different key and its voxels are added again, inflating
# the volume. Detection is two-stage: a cheap voxel-COUNT screen, then a voxel-
# POSITION (IoU) confirm on the few equal-count candidates.
DUP_IOU_EXACT = 1.0   # perfect voxel overlap → exact copy
DUP_IOU_NEAR  = 0.98  # near-copy (e.g. a 1–2 px edit after a copy); below → keep


# ── RLE decode (verbatim from compute_bullseye_from_rle.py) ───────────────────

def decode_rle(rle_str: str, H: int, W: int) -> np.ndarray:
    """Decode COCO-style RLE string to a boolean (H, W) mask.

    Format: space-separated pairs "offset length …" applied to a flat H*W
    row-major array. A tolerated pair whose end exceeds H*W is clipped rather
    than raising — matches bullseye's behaviour so this script is a drop-in
    replacement for the same input data.
    """
    flat = np.zeros(H * W, dtype=np.uint8)
    tokens = rle_str.strip().split()
    i = 0
    while i + 1 < len(tokens):
        offset = int(tokens[i])
        length = int(tokens[i + 1])
        end = min(offset + length, H * W)
        flat[offset:end] = 1
        i += 2
    return flat.reshape(H, W)


# ── Safe-JSON float (verbatim from bullseye script) ───────────────────────────

def _safe_float(v) -> Optional[float]:
    """Return v as a finite float, or None if NaN/Inf/unparseable.

    JSON has no NaN literal, so any NaN/Inf must become null before dumps() is
    called or the output will not be valid JSON on strict parsers.
    """
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


# ── Per-frame voxel-count accumulator (with per-slice union dedup) ────────────

def count_voxels_per_frame(
    frames: list, H: int, W: int
) -> tuple[dict[int, int], dict[int, int], dict[int, int], dict[tuple[int, int, int], np.ndarray]]:
    """Sum LVC / MYO / RV voxel counts per frame across all its slices,
    with per-(frameindex, sliceindex, class) union deduplication.

    Returns three count dicts keyed by frameindex → integer voxel count, plus
    the raw `per_slice_mask` dict (keyed by (frameindex, sliceindex, class_val)
    → boolean ndarray) so the caller can run duplicate-slice detection on the
    very same deduped masks the counts were derived from. Frames that exist in
    the input but have no relevant pixels appear with a value of 0 (so the
    caller can still emit their zero on the per-frame curve).

    Why the dedup: `frames[]` may legitimately contain multiple entries for the
    same (frameindex, sliceindex) — e.g. MedSAM output plus a later manual
    edit, or a data-ingestion path that re-appended rather than replaced. If we
    naively `+=` each occurrence we double-count and inflate volumes. Bullseye
    (`compute_bullseye_from_rle.py :: build_mask_3d`) already handles this by
    storing one 2D map per slice and taking a union; we mirror that pattern
    here at the (frame, slice, class) grain so the two computations always
    consume the same effective mask. See docs section 10 for details.

    We count voxels — not pixels — because the "volume" of a class in a frame
    is the sum over all its slices; each pixel is one voxel of thickness dz.
    """
    # Bucket boolean masks by (frameindex, sliceindex, class_val). Duplicate
    # entries at the same key are OR'd together — the union of what any
    # producer thought was inside that class, not the sum.
    per_slice_mask: dict[tuple[int, int, int], np.ndarray] = {}
    observed_frames: set[int] = set()

    for frame in frames:
        f_idx = int(frame.get("frameindex", 0))
        observed_frames.add(f_idx)
        for slc in frame.get("slices", []):
            # Part B — soft-exclude: a slice the user resolved away (via the
            # resolve-duplicate-slice endpoint, $set excluded=true) is skipped
            # entirely, so a normal recompute yields the corrected volume and no
            # longer flags that pair. This is the ONLY place slices are iterated,
            # so one skip covers counts, curves, ED/ES, EF, mass AND detection.
            if slc.get("excluded") is True:
                continue
            s_idx = int(slc.get("sliceindex", 0))
            for seg in slc.get("segmentationmasks", []):
                cls_val = CLASS_MAP.get(seg.get("class", ""), 0)
                if cls_val == 0:
                    continue
                rle_str = seg.get("segmentationmaskcontents", "")
                if not rle_str:
                    continue
                mask = decode_rle(rle_str, H, W).astype(bool)
                key = (f_idx, s_idx, cls_val)
                existing = per_slice_mask.get(key)
                per_slice_mask[key] = mask if existing is None else (existing | mask)

    lv_counts:  dict[int, int] = {f: 0 for f in observed_frames}
    myo_counts: dict[int, int] = {f: 0 for f in observed_frames}
    rv_counts:  dict[int, int] = {f: 0 for f in observed_frames}
    for (f_idx, _s_idx, cls_val), mask in per_slice_mask.items():
        n = int(mask.sum())
        if cls_val == _LVC_CLASS:
            lv_counts[f_idx]  += n
        elif cls_val == _MYO_CLASS:
            myo_counts[f_idx] += n
        elif cls_val == _RV_CLASS:
            rv_counts[f_idx]  += n
    return lv_counts, myo_counts, rv_counts, per_slice_mask


# ── Duplicate-slice detection (Part A) ────────────────────────────────────────

def _iou(a: np.ndarray, b: np.ndarray) -> float:
    """Intersection-over-union of two boolean masks. 1.0 = identical pixels,
    0.0 = disjoint. Two empty masks return 0.0 (no positive voxels to compare —
    they never reach here anyway, detection ignores count==0)."""
    inter = int(np.logical_and(a, b).sum())
    union = int(np.logical_or(a, b).sum())
    if union == 0:
        return 0.0
    return inter / union


def detect_duplicate_slices(
    per_slice_mask: dict[tuple[int, int, int], np.ndarray],
    voxel_mm3: float,
) -> list[dict]:
    """Find copied slices within each (frame, class) group. Purely additive:
    it reads the deduped masks and NEVER changes any count or volume.

    Stage 1 (cheap voxel-COUNT screen): within a (frame, class), bucket the
        positive-count slices by voxel count. Only equal-count slices can be
        copies of one another. ~O(n); usually zero candidates → no Stage-2 cost.
        Slices with count==0 are ignored.
    Stage 2 (voxel-POSITION confirm): for each equal-count bucket, confirm by
        IoU. iou == DUP_IOU_EXACT → exact copy; DUP_IOU_NEAR <= iou < 1 → near
        copy; iou < DUP_IOU_NEAR → genuinely different slice, left alone.

    Minority rule: if EVERY positive slice in a (frame, class) group is mutually
    identical, the group is a uniform / degenerate stack (e.g. a synthetic
    fixture that repeats one slice, or a padded acquisition), NOT an accidental
    copy — emit nothing for it. A real copy is a MINORITY artifact among
    genuinely-varying slices. Documented trade-off: a copy inside a fully-uniform
    group is not flagged (a false negative — see HEART_METRICS_IMPLEMENTATION.md).

    Returns a deterministically-ordered list of duplicate descriptors. Of each
    confirmed pair, `slice_remove` is the HIGHER sliceindex by convention (the
    two slices are identical, so the choice is arbitrary but must be stable).
    """
    # Group positive-count slice masks by (frame, class).
    groups: dict[tuple[int, int], list[tuple[int, np.ndarray, int]]] = defaultdict(list)
    for (f_idx, s_idx, cls_val), mask in per_slice_mask.items():
        n = int(mask.sum())
        if n == 0:
            continue
        groups[(f_idx, cls_val)].append((s_idx, mask, n))

    duplicates: list[dict] = []
    for (f_idx, cls_val), members in groups.items():
        if len(members) < 2:
            continue  # need two positive slices for a pair

        # Minority rule: skip a group whose positive slices are ALL identical.
        # (All equal count AND every one perfectly overlaps the first.)
        counts = {n for (_s, _m, n) in members}
        if len(counts) == 1:
            ref = members[0][1]
            if all(_iou(ref, m) >= DUP_IOU_EXACT for (_s, m, _n) in members[1:]):
                continue

        # Stage 1: bucket by voxel count (cheap screen).
        by_count: dict[int, list[tuple[int, np.ndarray]]] = defaultdict(list)
        for (s_idx, mask, n) in members:
            by_count[n].append((s_idx, mask))

        # Stage 2: confirm equal-count candidates by IoU.
        for n, bucket in by_count.items():
            if len(bucket) < 2:
                continue
            bucket.sort(key=lambda t: t[0])  # ascending sliceindex → determinism
            removed: set[int] = set()
            for a in range(len(bucket)):
                s_a, mask_a = bucket[a]
                if s_a in removed:
                    continue
                for b in range(a + 1, len(bucket)):
                    s_b, mask_b = bucket[b]
                    if s_b in removed:
                        continue
                    iou = _iou(mask_a, mask_b)
                    if iou >= DUP_IOU_NEAR:
                        duplicates.append({
                            "frame":            f_idx,
                            "class":            _CLASS_NAME.get(cls_val, str(cls_val)),
                            "slice_keep":       s_a,  # lower sliceindex
                            "slice_remove":     s_b,  # higher sliceindex
                            "voxel_count":      n,
                            "iou":              _safe_float(iou),
                            "est_inflation_ml": _safe_float(n * voxel_mm3 / 1000.0),
                        })
                        removed.add(s_b)
    # Stable global ordering independent of dict iteration order.
    duplicates.sort(key=lambda d: (d["frame"], d["class"], d["slice_keep"], d["slice_remove"]))
    return duplicates


# ── Spacing from affine ───────────────────────────────────────────────────────

def spacing_from_affine(affine: np.ndarray) -> tuple[float, float, float]:
    """Extract voxel spacing (dx, dy, dz) in millimetres from a 4x4 affine.

    NIfTI affines encode direction cosines * spacing in the first three columns.
    The per-axis spacing is the L2 norm of each column of the top-left 3x3
    block. This handles anisotropic cardiac data correctly (in-plane ~1.5 mm,
    slice ~5-10 mm) — never hardcode.
    """
    A = affine[:3, :3].astype(np.float64)
    dx, dy, dz = np.sqrt((A ** 2).sum(axis=0))
    return float(dx), float(dy), float(dz)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    warnings_out: list[str] = []

    # 1. Parse stdin JSON. Any parse error → single-line error JSON, exit 1.
    try:
        data = json.load(sys.stdin)
        frames = data["frames"]
        W = int(data["width"])
        H = int(data["height"])
        affine_raw = data["affine"]
    except Exception as e:
        print(json.dumps({"error": f"Invalid input JSON: {e}"}), file=sys.stdout)
        sys.exit(1)

    ed_override = data.get("ed_frame")
    es_override = data.get("es_frame")

    # Optional body surface area (m^2), entered by the user on the report page
    # (Mosteller formula from height/weight — see report/page.tsx). Purely a
    # per-patient divisor: absent or invalid, every *_I field below is null and
    # everything else in this script behaves exactly as it did before BSA existed.
    bsa_m2 = _safe_float(data.get("bsa_m2"))
    if bsa_m2 is not None and bsa_m2 <= 0:
        warnings_out.append(f"Ignoring non-positive bsa_m2={bsa_m2} — indexed volumes (EDVI/ESVI) set to null.")
        bsa_m2 = None

    # 2. Validate the affine — heart metrics *require* spacing. Bail hard.
    try:
        affine = np.array(affine_raw, dtype=np.float64)
    except Exception as e:
        print(json.dumps({"error": f"Affine could not be parsed as a numeric array: {e}"}),
              file=sys.stdout)
        sys.exit(1)
    if affine.shape != (4, 4):
        print(json.dumps({"error": f"Affine must be 4x4, got shape {list(affine.shape)}"}),
              file=sys.stdout)
        sys.exit(1)

    # Spacing (column-norms) is kept for the `spacing_mm` display field so the
    # user still sees the per-axis in-plane / through-plane spacing separately.
    dx, dy, dz = spacing_from_affine(affine)
    # Voxel volume uses the ABSOLUTE DETERMINANT of the top-left 3x3 block.
    # For an orthogonal (diagonal) affine — which cardiac short-axis CINE
    # almost always has — det equals the product of the column norms
    # exactly, so all existing tests and stored volumes are unchanged
    # bit-for-bit. For an oblique / sheared affine the column-norm product
    # OVER-estimates the true parallelepiped volume by the sine of the
    # inter-axis angles; det is the correct geometric volume in either case.
    # This is why `voxel_mm3` and (spacing_mm[0]*spacing_mm[1]*spacing_mm[2])
    # may differ slightly for oblique data — see HEART_METRICS_IMPLEMENTATION.md §9.
    voxel_mm3 = float(abs(np.linalg.det(affine[:3, :3].astype(np.float64))))
    if not math.isfinite(voxel_mm3) or voxel_mm3 <= 0.0:
        print(json.dumps({"error": f"Non-positive voxel volume derived from affine: {voxel_mm3}"}),
              file=sys.stdout)
        sys.exit(1)

    # Plausibility guard on voxel volume (does not fail — flags loudly). Adult
    # cardiac MRI voxels are typically 1-30 mm^3 (in-plane 0.5-2 mm, slice
    # 3-10 mm). Values far outside that range strongly suggest a bad affine
    # (identity fallback, cm-in-mm misread, resample without spacing update,
    # etc.). Reporting them silently would poison the downstream disease-
    # similarity comparison (cohort references are in mL — bad spacing means
    # a real patient could match "DCM" purely because their volumes were
    # scaled 30x). See PIPELINE_INTEGRATION.md §6 for the incident this
    # guard was added for.
    if voxel_mm3 < 0.1:
        warnings_out.append(
            f"Suspicious voxel_mm3={voxel_mm3:.4f} mm^3 (< 0.1). Typical cardiac MRI "
            "voxels are 1-30 mm^3. Check project.affineMatrix — absolute volumes "
            "may be scaled down by orders of magnitude. EF (a ratio) is unaffected."
        )
    elif voxel_mm3 > 200.0:
        warnings_out.append(
            f"Suspicious voxel_mm3={voxel_mm3:.2f} mm^3 (> 200). Typical cardiac MRI "
            "voxels are 1-30 mm^3. Check project.affineMatrix — absolute volumes "
            "may be scaled up by orders of magnitude. EF (a ratio) is unaffected."
        )
    # TODO(ingestion): the underlying fix for a bad project.affineMatrix is to
    # re-derive it from the source NIfTI on the ingestion side (whoever writes
    # projectModel.affineMatrix on upload). This module deliberately does not
    # repair the affine in place — a silent overwrite would mask the ingestion
    # bug for future projects. Coordinate with the ingestion pipeline owner.

    # 3. Per-frame voxel counts (+ the deduped per-slice masks for detection).
    lv_counts, myo_counts, rv_counts, per_slice_mask = count_voxels_per_frame(frames, H, W)

    # Hard-error only when there is no LV cavity in any frame — the rest of the
    # payload has no meaning without an LV curve to detect ED/ES from.
    total_lv_voxels = sum(lv_counts.values())
    if total_lv_voxels <= 0:
        print(json.dumps({"error": "No LV cavity (class 3) voxels found in mask data."}),
              file=sys.stdout)
        sys.exit(1)

    # 3b. Duplicate-slice detection (Part A — additive; never alters the counts
    #     or volumes above). Runs on the SAME deduped per-slice masks the counts
    #     came from, so detection and volume always see identical data. Each
    #     confirmed pair appends a human warning AND a machine-readable
    #     duplicate_slices entry the UI can later offer to remove.
    duplicate_slices = detect_duplicate_slices(per_slice_mask, voxel_mm3)
    for d in duplicate_slices:
        warnings_out.append(
            f"Possible duplicate slice: frame {d['frame']}, slices "
            f"{d['slice_keep']} & {d['slice_remove']} (class {d['class']}) — identical voxel "
            f"count ({d['voxel_count']}) and {d['iou']:.0%} overlap. "
            f"Est. inflation +{d['est_inflation_ml']:.1f} mL."
        )

    # 4. Build per-frame volume curves (mL) indexed 0..max_frame with 0-fills
    #    for any missing indices, so the arrays are dense and the frontend can
    #    plot them directly against frame index.
    max_frame_idx = max(lv_counts.keys())
    lv_volumes_ml: list[Optional[float]] = []
    rv_volumes_ml: list[Optional[float]] = []
    for i in range(max_frame_idx + 1):
        lv_volumes_ml.append(_safe_float(lv_counts.get(i, 0) * voxel_mm3 / 1000.0))
        rv_volumes_ml.append(_safe_float(rv_counts.get(i, 0) * voxel_mm3 / 1000.0))

    # 5. Resolve ED / ES frames. Explicit overrides win when provided AND valid.
    def _valid_override(v) -> bool:
        return isinstance(v, int) and 0 <= v <= max_frame_idx and lv_counts.get(v, 0) > 0

    positive_frames = [f for f, n in lv_counts.items() if n > 0]

    # NOTE ON ACCURACY vs. the ACDC ground-truth CSV:
    # This detects ED/ES from the SEGMENTATION MODEL's own output — ED = frame
    # with the most LV-cavity voxels, ES = the fewest. That is the standard
    # method and is correct. It can differ from the ACDC info CSV by a frame or
    # two because the CSV's ED/ES are EXPERT-annotated on the original full-res
    # images, whereas this runs on the model's (imperfect) masks — MedSAM in
    # particular. A small difference is expected and is a measure of segmentation
    # quality on those phases, not a bug in this detection. A large difference
    # points to poor segmentation on the ED/ES frames rather than a logic error.
    if _valid_override(ed_override):
        ed_frame = int(ed_override)
    else:
        # argmax of LV-cavity voxel count → largest chamber → end-diastole.
        ed_frame = max(positive_frames, key=lambda f: lv_counts[f])

    if _valid_override(es_override):
        es_frame = int(es_override)
    else:
        # argmin among frames with positive LV — an all-zero frame is an
        # unsegmented phase, not a real "smallest cavity" candidate.
        es_frame = min(positive_frames, key=lambda f: lv_counts[f])

    # 6. Chamber volumes at ED/ES.
    LVEDV = _safe_float(lv_counts.get(ed_frame, 0) * voxel_mm3 / 1000.0)
    LVESV = _safe_float(lv_counts.get(es_frame, 0) * voxel_mm3 / 1000.0)
    RVEDV = _safe_float(rv_counts.get(ed_frame, 0) * voxel_mm3 / 1000.0)
    RVESV = _safe_float(rv_counts.get(es_frame, 0) * voxel_mm3 / 1000.0)

    # Plausibility guard on LVEDV. Adult LVEDV is typically ~60-250 mL; a
    # value far outside that range is either bad segmentation coverage or
    # (given the affine warning above) bad spacing. We do NOT null the
    # number — a downstream cohort comparison may still choose to consume
    # it — but we make the anomaly visible in warnings[] so the report can
    # surface it and the pipeline log can be grepped for these projects.
    if LVEDV is not None:
        if LVEDV < 30.0:
            warnings_out.append(
                f"LVEDV={LVEDV:.1f} mL is below the typical adult range (60-250 mL). "
                "Verify affine and segmentation coverage — this often indicates "
                "an identity/bad affine (voxel_mm3 too small) or missing basal slices."
            )
        elif LVEDV > 400.0:
            warnings_out.append(
                f"LVEDV={LVEDV:.1f} mL is above the typical adult range (60-250 mL). "
                "Verify affine and segmentation coverage — this often indicates "
                "an inflated affine (voxel_mm3 too large) or duplicated slice data."
            )

    # 7. Ejection fraction — guarded. If we don't have at least two distinct
    #    frames with LV cavity, or ED == ES, EF is not computable. Emit null
    #    with a clear warning rather than a bogus 0%.
    ef_computable = (len(positive_frames) >= 2) and (ed_frame != es_frame)
    if not ef_computable:
        LV_SV = None
        LVEF = None
        RV_SV = None
        RVEF = None
        if len(positive_frames) < 2:
            warnings_out.append(
                "Only one frame contains LV cavity voxels — EF requires at least two "
                "cardiac phases (ED and ES). LVEF, LV_SV, RVEF, RV_SV set to null."
            )
        else:
            warnings_out.append(
                f"Detected ED and ES resolved to the same frame ({ed_frame}) — EF is "
                "not computable. LVEF, LV_SV, RVEF, RV_SV set to null."
            )
    else:
        LV_SV = _safe_float(LVEDV - LVESV) if (LVEDV is not None and LVESV is not None) else None
        LVEF = _safe_float((LVEDV - LVESV) / LVEDV * 100.0) if (LVEDV and LVEDV > 0) else None
        # RV volumes can legitimately be 0 in a valid dataset (partial coverage);
        # in that case leave RVEF null with a warning rather than dividing by zero.
        if RVEDV is not None and RVEDV > 0 and RVESV is not None:
            RV_SV = _safe_float(RVEDV - RVESV)
            RVEF = _safe_float((RVEDV - RVESV) / RVEDV * 100.0)
        else:
            RV_SV = None
            RVEF = None
            warnings_out.append(
                "No RV voxels at ED — RVEF and RV_SV set to null."
            )

    # 8. LV myocardial mass at ED. Uses the same deduped myo_counts as the
    #    per-frame curves — a single walk of the mask data feeds both. Graceful
    #    degradation: no MYO at ED → null + warn (rest of payload survives).
    myo_at_ed = myo_counts.get(ed_frame, 0)
    if myo_at_ed > 0:
        LV_mass_g = _safe_float(myo_at_ed * voxel_mm3 / 1000.0 * _MYO_DENSITY_G_PER_ML)
    else:
        LV_mass_g = None
        warnings_out.append(
            f"No myocardium (class 2) voxels at ED frame ({ed_frame}) — "
            "LV_mass_g set to null."
        )

    # 8b. BSA-indexed volumes (mL/m^2) — null whenever bsa_m2 wasn't supplied
    #     or a given raw volume is itself null. Pure division; no new
    #     plausibility guards needed since LVEDV/RVEDV etc. already have theirs.
    def _indexed(vol: Optional[float]) -> Optional[float]:
        if bsa_m2 is None or vol is None:
            return None
        return _safe_float(vol / bsa_m2)

    LVEDVI = _indexed(LVEDV)
    LVESVI = _indexed(LVESV)
    RVEDVI = _indexed(RVEDV)
    RVESVI = _indexed(RVESV)
    # Stroke volume index — genuinely new information (not derivable from
    # EDVI/ESVI alone without also knowing SV), and the literal input the
    # 2022 ESC/ERS PAH risk table (Humbert et al., Eur Respir J 2023, Table
    # 16) uses: SVI > 40 / 26-40 / < 26 mL/m^2 (cMRI-specific band — the
    # table separately lists a different SVI band for right-heart-cath
    # haemodynamics; do not conflate the two).
    LV_SVI = _indexed(LV_SV)
    RV_SVI = _indexed(RV_SV)
    # LV mass index — the LVMI feature compute_disease_similarity.py's indexed
    # mode uses for HCM-morphology scoring.
    LVMI = _indexed(LV_mass_g)

    # 9. Emit result JSON. All numeric fields go through _safe_float so no
    #    NaN/Inf ever hits the wire.
    #
    # `measurements` is the flat, report-page integration contract — the report
    # assembler reads THIS block, not the LV-prefixed longform keys. Keys are
    # generic (EF, EDV, ESV) so the report doesn't have to know they are
    # LV-derived. PeakGRS / PeakGCS come from the strain pipeline and are
    # filled in at assembly time; they exist here as `null` placeholders so
    # the object shape is stable regardless of whether strain has run yet.
    # EDVI/ESVI follow the same generic (LV, unprefixed) convention as EDV/ESV
    # — null until a caller supplies bsa_m2, same graceful-degradation pattern
    # as PeakGRS/PeakGCS being null until strain runs.
    measurements = {
        "EF":           LVEF,
        "EDV":          LVEDV,
        "ESV":          LVESV,
        "EDVI":         LVEDVI,
        "ESVI":         LVESVI,
        "StrokeVolume": LV_SV,
        "StrokeVolumeIndex": LV_SVI,
        "LVMI":         LVMI,
        "PeakGRS":      None,  # filled by strain, not computed here
        "PeakGCS":      None,  # filled by strain, not computed here
    }

    result = {
        "measurements":   measurements,
        "ed_frame":       int(ed_frame),
        "es_frame":       int(es_frame),
        "ed_override_used": _valid_override(ed_override),
        "es_override_used": _valid_override(es_override),
        "lv_volumes_ml":  lv_volumes_ml,
        "rv_volumes_ml":  rv_volumes_ml,
        "LVEDV": LVEDV,
        "LVESV": LVESV,
        "LV_SV": LV_SV,
        "LVEF":  LVEF,
        "RVEDV": RVEDV,
        "RVESV": RVESV,
        "RV_SV": RV_SV,
        "RVEF":  RVEF,
        "LV_mass_g": LV_mass_g,
        # BSA passthrough + indexed volumes — all null when bsa_m2 wasn't given.
        "bsa_m2": bsa_m2,
        "LVEDVI": LVEDVI,
        "LVESVI": LVESVI,
        "RVEDVI": RVEDVI,
        "RVESVI": RVESVI,
        "LV_SVI": LV_SVI,
        "LVMI": LVMI,
        "RV_SVI": RV_SVI,
        "voxel_mm3": _safe_float(voxel_mm3),
        "spacing_mm": [_safe_float(dx), _safe_float(dy), _safe_float(dz)],
        "units": {
            "volumes": "mL",
            "ef":      "%",
            "mass":    "g",
            "spacing": "mm",
            "bsa":     "m^2",
            "indexed_volumes": "mL/m^2",
        },
        "warnings": warnings_out,
        # Duplicate-slice detection (Part A). Additive/optional: on clean data
        # duplicate_slices is [] and duplicate_slices_detected is False, so
        # existing numbers and the (empty) warnings list are unchanged.
        "duplicate_slices": duplicate_slices,
        "duplicate_slices_detected": len(duplicate_slices) > 0,
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
