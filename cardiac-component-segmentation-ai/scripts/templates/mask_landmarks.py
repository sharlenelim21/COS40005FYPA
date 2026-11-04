"""RV insertion points from a segmentation.

The two RV insertion points of a short-axis slice are where the RV free wall
attaches to the septum. Seen from the LV centre, the RV pixels that touch the
LV myocardium form one arc along the septum; its two ends are the insertion
points. Used by template_tool.py to pre-fill landmarks before they are checked
by hand.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage


def insertion_points(rv: np.ndarray, myo: np.ndarray, lv: np.ndarray,
                     contact_px: int = 2, min_contact: int = 6):
    """Return ((x1, y1), (x2, y2)) in pixel coordinates (x = column, y = row),
    or None when the slice has no usable RV–myocardium contact.

    rv / myo / lv : boolean (H, W) masks of one slice.
    contact_px    : how far (pixels) from the myocardium an RV pixel may be to count as touching it.
    min_contact   : fewer touching pixels than this → no points.
    """
    if not rv.any() or not myo.any():
        return None
    ref = lv if lv.any() else myo
    cy, cx = ndimage.center_of_mass(ref)
    contact = rv & ndimage.binary_dilation(myo, iterations=contact_px)
    ys, xs = np.nonzero(contact)
    if xs.size < min_contact:
        return None
    ang = np.arctan2(ys - cy, xs - cx)
    order = np.argsort(ang)
    a = ang[order]
    gaps = np.diff(np.concatenate([a, [a[0] + 2 * np.pi]]))
    k = int(np.argmax(gaps))                     # the largest angular gap lies outside the contact arc
    i_start, i_end = order[(k + 1) % len(a)], order[k]
    return (float(xs[i_start]), float(ys[i_start])), (float(xs[i_end]), float(ys[i_end]))
