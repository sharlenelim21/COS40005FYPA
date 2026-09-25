import json
import sys
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import make_control_set as mcs  # noqa: E402


class ControlSet(unittest.TestCase):
    SLICES = {"P1": 2, "P2": 3, "P3": 4, "P4": 5}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.images, self.masks = self.dir / "images", self.dir / "masks"
        self.images.mkdir()
        self.masks.mkdir()
        for patient, count in self.SLICES.items():
            for frame in (0, 1):
                volume = np.zeros((8, 8, count), dtype=np.float32)
                nib.save(nib.Nifti1Image(volume, np.eye(4)), str(self.images / f"{patient}_{frame}.nii.gz"))
                nib.save(nib.Nifti1Image(volume.astype(np.uint8), np.eye(4)), str(self.masks / f"{patient}_{frame}_gt.nii.gz"))

    def tearDown(self):
        self.tmp.cleanup()

    def test_patient_names(self):
        self.assertEqual(mcs.patient_of("A1K2P5_11.nii.gz"), "A1K2P5")
        self.assertEqual(mcs.patient_of("patient101_frame01.nii.gz"), "patient101")

    def test_whole_patients_are_added_until_the_target_is_met(self):
        manifest = mcs.build(self.images, self.masks, 7, self.dir / "out")
        self.assertGreaterEqual(manifest["slices"], 7)
        self.assertEqual(manifest["slices"], sum(2 * self.SLICES[p] for p in manifest["patients"]))
        copied = sorted(p.name for p in (self.dir / "out" / "images").iterdir())
        self.assertEqual(copied, sorted(f"{p}_{f}.nii.gz" for p in manifest["patients"] for f in (0, 1)))
        self.assertEqual(json.loads((self.dir / "out" / "control_manifest.json").read_text(encoding="utf-8"))["slices"],
                         manifest["slices"])

    def test_the_draw_is_deterministic(self):
        first = mcs.build(self.images, self.masks, 7, self.dir / "a")
        second = mcs.build(self.images, self.masks, 7, self.dir / "b")
        self.assertEqual(first["patients"], second["patients"])

    def test_refuses_a_non_empty_output_folder(self):
        (self.dir / "out").mkdir()
        (self.dir / "out" / "stray.txt").write_text("x", encoding="utf-8")
        with self.assertRaises(SystemExit):
            mcs.build(self.images, self.masks, 7, self.dir / "out")

    def test_refuses_when_there_are_not_enough_slices(self):
        with self.assertRaises(SystemExit):
            mcs.build(self.images, self.masks, 1000, self.dir / "out")


if __name__ == "__main__":
    unittest.main()
