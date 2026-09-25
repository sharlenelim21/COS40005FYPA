"""Changed pixels between a mask's preserved AI output and its edited copy, per slice and class.

stdin : {"ai_frames": [...], "edited_frames": [...], "plane": {"height": H, "width": W}}
stdout: {"method", "slices", "editedSliceCount", "pixelsChanged", "manualPixels",
         "slicesCompared", "warnings"}  or  {"error": "..."}

RLE follows decode_rle in create_nifti_with_stored_affine.py: "start length" pairs over the
row-major H*W plane; a run that leaves the plane is skipped whole; an unparseable string is empty;
two entries of one class in a slice are OR-ed. Counting uses interval arithmetic, so nothing is
decoded and no numpy is needed.
"""
import json
import sys

CLASSES = ("rv", "myo", "lvc", "manual")
METHOD = "rle-interval-xor"


def _merge(intervals):
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def runs_from_rle(rle, plane_size):
    try:
        parts = [int(p) for p in (rle or "").split()]
    except ValueError:
        return []
    intervals = []
    for i in range(0, len(parts) - 1, 2):
        start, length = parts[i], parts[i + 1]
        if length <= 0 or start < 0 or start + length > plane_size:
            continue
        intervals.append((start, start + length))
    return _merge(intervals)


def _covered(runs):
    return sum(end - start for start, end in runs)


def _overlap(a, b):
    i = j = total = 0
    while i < len(a) and j < len(b):
        lo, hi = max(a[i][0], b[j][0]), min(a[i][1], b[j][1])
        if lo < hi:
            total += hi - lo
        if a[i][1] < b[j][1]:
            i += 1
        else:
            j += 1
    return total


def changed_pixels(a, b):
    return _covered(a) + _covered(b) - 2 * _overlap(a, b)


def _index(frames, plane_size, side, warnings):
    index = {}
    for frame in frames or []:
        for sl in frame.get("slices") or []:
            key = (int(frame.get("frameindex", 0)), int(sl.get("sliceindex", 0)))
            by_class = index.setdefault(key, {})
            for entry in sl.get("segmentationmasks") or []:
                cls = str(entry.get("class", "")).lower()
                if cls not in CLASSES:
                    warnings.append(f"{side} frame {key[0]} slice {key[1]}: unknown class '{cls}' ignored")
                    continue
                runs = runs_from_rle(entry.get("segmentationmaskcontents"), plane_size)
                by_class[cls] = _merge(by_class.get(cls, []) + runs)
    return index


def compute(payload):
    plane = payload.get("plane") or {}
    height, width = plane.get("height"), plane.get("width")
    if not all(isinstance(v, int) and not isinstance(v, bool) and v > 0 for v in (height, width)):
        return {"error": "plane.height and plane.width must be positive integers"}
    plane_size = height * width
    warnings = []
    ai = _index(payload.get("ai_frames"), plane_size, "ai", warnings)
    edited = _index(payload.get("edited_frames"), plane_size, "edited", warnings)

    slices, total, manual = [], 0, 0
    keys = sorted(set(ai) | set(edited))
    for key in keys:
        for side, present in (("AI output", ai), ("edited mask", edited)):
            if key not in present:
                warnings.append(f"frame {key[0]} slice {key[1]} missing from the {side}; "
                                "all its pixels on the other side count as changed")
        by_class = {}
        for cls in CLASSES:
            n = changed_pixels(ai.get(key, {}).get(cls, []), edited.get(key, {}).get(cls, []))
            if n:
                by_class[cls] = n
        if by_class:
            count = sum(by_class.values())
            slices.append({"frameindex": key[0], "sliceindex": key[1], "editedClasses": sorted(by_class),
                           "pixelsChanged": count, "byClass": by_class})
            total += count
            manual += by_class.get("manual", 0)

    return {"method": METHOD, "slices": slices, "editedSliceCount": len(slices), "pixelsChanged": total,
            "manualPixels": manual, "slicesCompared": len(keys), "warnings": warnings}


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        result = compute(payload) if isinstance(payload, dict) else {"error": "stdin must be a JSON object"}
    except (ValueError, TypeError, AttributeError) as exc:
        result = {"error": f"invalid input: {exc}"}
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
