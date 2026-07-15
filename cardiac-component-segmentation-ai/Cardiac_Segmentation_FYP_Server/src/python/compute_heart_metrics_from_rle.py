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

Output (stdout JSON):
    ed_frame, es_frame                 # frames actually used (auto or override)
    lv_volumes_ml, rv_volumes_ml       # per-frame volume curves (index = frameindex)
    LVEDV, LVESV, LV_SV, LVEF          # LV metrics (SV/EF may be null — see below)
    RVEDV, RVESV, RV_SV, RVEF          # RV metrics
    LV_mass_g                          # LV myocardial mass at ED (may be null)
    voxel_mm3, spacing_mm              # derived from affine, kept for audit
    units                              # {volumes, ef, mass, spacing}
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

# Myocardial density in g/mL (Bernard et al. 2018; standard cardiology value).
_MYO_DENSITY_G_PER_ML = 1.05


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


# ── Per-frame voxel-count accumulator ─────────────────────────────────────────

def count_voxels_per_frame(
    frames: list, H: int, W: int
) -> tuple[dict[int, int], dict[int, int], dict[int, int]]:
    """Sum LVC / MYO / RV pixel counts per frame across all its slices.

    Returns three dicts keyed by frameindex → integer voxel count. Frames that
    exist in the input but have no relevant pixels appear with a value of 0
    (so the caller can still emit their zero on the per-frame curve).

    We count voxels — not pixels — because the "volume" of a class in a frame
    is the sum over all its slices; each pixel is one voxel of thickness dz.
    """
    lv_counts: dict[int, int] = {}
    myo_counts: dict[int, int] = {}
    rv_counts: dict[int, int] = {}

    for frame in frames:
        f_idx = int(frame.get("frameindex", 0))
        # Initialise so every observed frame appears in the curve, even if empty.
        lv_counts.setdefault(f_idx, 0)
        myo_counts.setdefault(f_idx, 0)
        rv_counts.setdefault(f_idx, 0)

        for slc in frame.get("slices", []):
            for seg in slc.get("segmentationmasks", []):
                cls_name = seg.get("class", "")
                cls_val = CLASS_MAP.get(cls_name, 0)
                if cls_val == 0:
                    continue
                rle_str = seg.get("segmentationmaskcontents", "")
                if not rle_str:
                    continue
                mask = decode_rle(rle_str, H, W)
                n = int(mask.sum())
                if cls_val == _LVC_CLASS:
                    lv_counts[f_idx] += n
                elif cls_val == _MYO_CLASS:
                    myo_counts[f_idx] += n
                elif cls_val == _RV_CLASS:
                    rv_counts[f_idx] += n

    return lv_counts, myo_counts, rv_counts


# ── MYO voxel count restricted to a specific frame ────────────────────────────

def myo_voxels_at_frame(frames: list, target_idx: int, H: int, W: int) -> int:
    """Sum myocardial pixels across all slices of a single frame."""
    total = 0
    for frame in frames:
        if int(frame.get("frameindex", 0)) != target_idx:
            continue
        for slc in frame.get("slices", []):
            for seg in slc.get("segmentationmasks", []):
                if CLASS_MAP.get(seg.get("class", ""), 0) != _MYO_CLASS:
                    continue
                rle_str = seg.get("segmentationmaskcontents", "")
                if not rle_str:
                    continue
                total += int(decode_rle(rle_str, H, W).sum())
    return total


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

    dx, dy, dz = spacing_from_affine(affine)
    voxel_mm3 = dx * dy * dz
    if not math.isfinite(voxel_mm3) or voxel_mm3 <= 0.0:
        print(json.dumps({"error": f"Non-positive voxel volume derived from affine: {voxel_mm3}"}),
              file=sys.stdout)
        sys.exit(1)

    # 3. Per-frame voxel counts.
    lv_counts, myo_counts, rv_counts = count_voxels_per_frame(frames, H, W)

    # Hard-error only when there is no LV cavity in any frame — the rest of the
    # payload has no meaning without an LV curve to detect ED/ES from.
    total_lv_voxels = sum(lv_counts.values())
    if total_lv_voxels <= 0:
        print(json.dumps({"error": "No LV cavity (class 3) voxels found in mask data."}),
              file=sys.stdout)
        sys.exit(1)

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

    # 8. LV myocardial mass at ED. Graceful degradation: no MYO → null + warn.
    myo_at_ed = myo_voxels_at_frame(frames, ed_frame, H, W)
    if myo_at_ed > 0:
        LV_mass_g = _safe_float(myo_at_ed * voxel_mm3 / 1000.0 * _MYO_DENSITY_G_PER_ML)
    else:
        LV_mass_g = None
        warnings_out.append(
            f"No myocardium (class 2) voxels at ED frame ({ed_frame}) — "
            "LV_mass_g set to null."
        )

    # 9. Emit result JSON. All numeric fields go through _safe_float so no
    #    NaN/Inf ever hits the wire.
    #
    # `measurements` is the flat, report-page integration contract — the report
    # assembler reads THIS block, not the LV-prefixed longform keys. Keys are
    # generic (EF, EDV, ESV) so the report doesn't have to know they are
    # LV-derived. PeakGRS / PeakGCS come from the strain pipeline and are
    # filled in at assembly time; they exist here as `null` placeholders so
    # the object shape is stable regardless of whether strain has run yet.
    measurements = {
        "EF":           LVEF,
        "EDV":          LVEDV,
        "ESV":          LVESV,
        "StrokeVolume": LV_SV,
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
        "voxel_mm3": _safe_float(voxel_mm3),
        "spacing_mm": [_safe_float(dx), _safe_float(dy), _safe_float(dz)],
        "units": {
            "volumes": "mL",
            "ef":      "%",
            "mass":    "g",
            "spacing": "mm",
        },
        "warnings": warnings_out,
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()
