"""Keep only some frames of a 4D NIfTI, in the order given (a 4D reconstruction of chosen frames,
services/reconstruction_frames.ts). The voxels, affine and header are copied; only the 4th dimension shrinks.

  python3 select_nifti_frames.py INPUT.nii.gz OUTPUT.nii.gz 0,6,12   (0-based frame indices)
"""
import sys

import nibabel as nib
import numpy as np


def main(argv):
    source, target, frames = argv[1], argv[2], [int(f) for f in argv[3].split(",") if f.strip()]
    image = nib.load(source)
    data = np.asanyarray(image.dataobj)
    if data.ndim != 4:
        raise SystemExit(f"expected a 4D NIfTI, got shape {data.shape}")
    if not frames or min(frames) < 0 or max(frames) >= data.shape[3]:
        raise SystemExit(f"frames {frames} do not fit {data.shape[3]} frames")
    header = image.header.copy()
    nib.save(nib.Nifti1Image(np.ascontiguousarray(data[..., frames]), image.affine, header), target)
    print(f"kept frames {frames} of {data.shape[3]}")


if __name__ == "__main__":
    main(sys.argv)
