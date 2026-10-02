import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import build_training_volumes as btv  # noqa: E402
from common import import_v2  # noqa: E402


def frame(frameindex, *slices):
    """slices: (sliceindex, segmentationmasks, extra fields)"""
    return {"frameindex": frameindex,
            "slices": [{"sliceindex": si, "segmentationmasks": masks, **extra} for si, masks, extra in slices]}


def tracked(frameindex, sliceindex, pixels, cls="lvc"):
    return {"frameindex": frameindex, "sliceindex": sliceindex, "pixelsChanged": pixels, "byClass": {cls: pixels}}


class BuildTrainingVolumes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.data = np.arange(6 * 4 * 3 * 2, dtype=np.float32).reshape(6, 4, 3, 2)
        self.affine = np.diag([1.5, 1.5, 8.0, 1.0])
        self.src = self.dir / "src.nii.gz"
        nib.save(nib.Nifti1Image(self.data, self.affine), str(self.src))

    def tearDown(self):
        self.tmp.cleanup()

    def payload(self, tracked_slices, frames, plane=(6, 4), min_pixels=1, source=None):
        return {"source_nifti": str(source or self.src), "case_id": "p1", "out_dir": str(self.dir / "out"),
                "plane": {"height": plane[0], "width": plane[1]}, "min_pixels": min_pixels,
                "tracked_slices": tracked_slices, "frames": frames}

    def test_images_are_the_edited_source_slices_in_order(self):
        frames = [frame(1, (2, [{"class": "lvc", "segmentationmaskcontents": "0 3"}], {}),
                        (0, [{"class": "rv", "segmentationmaskcontents": "4 2"}], {}))]
        out = btv.build(self.payload([tracked(1, 2, 3), tracked(1, 0, 2, "rv")], frames))
        self.assertEqual(out["files"][0]["slices"], [0, 2])
        image = nib.load(out["files"][0]["image"])
        np.testing.assert_array_equal(image.get_fdata(), self.data[:, :, [0, 2], 1])
        np.testing.assert_array_equal(image.affine, self.affine)
        labels = np.asanyarray(nib.load(out["files"][0]["mask"]).dataobj)
        self.assertEqual(labels.shape, (6, 4, 2))
        self.assertEqual(labels[:, :, 1].reshape(-1)[:4].tolist(), [3, 3, 3, 0])
        self.assertEqual(labels[:, :, 0].reshape(-1)[3:7].tolist(), [0, 1, 1, 0])

    def test_first_label_written_wins_on_overlap(self):
        entries = [{"class": "rv", "segmentationmaskcontents": "0 4"},
                   {"class": "lvc", "segmentationmaskcontents": "2 4"}]
        self.assertEqual(btv.label_slice(entries, 6, 4).reshape(-1)[:7].tolist(), [1, 1, 1, 1, 3, 3, 0])

    def test_selection_rules(self):
        frames = [frame(0, (0, [], {}), (1, [], {"excluded": True}),
                        (2, [{"class": "manual", "segmentationmaskcontents": "0 1"}], {}))]
        chosen, skipped = btv.select_slices(
            [tracked(0, 0, 5), tracked(0, 1, 50), tracked(0, 2, 50), tracked(0, 7, 50)], frames, min_pixels=20)
        self.assertEqual(chosen, {})
        self.assertEqual(skipped, {"below_min_pixels": 1, "manual": 1, "excluded": 1, "missing": 1})

    def test_refuses_plane_mismatch(self):
        self.assertIn("error", btv.build(self.payload([], [], plane=(4, 6))))

    def test_refuses_frame_outside_a_3d_source(self):
        src3d = self.dir / "src3d.nii.gz"
        nib.save(nib.Nifti1Image(self.data[..., 0], self.affine), str(src3d))
        frames = [frame(1, (0, [{"class": "lvc", "segmentationmaskcontents": "0 2"}], {}))]
        self.assertIn("error", btv.build(self.payload([tracked(1, 0, 2)], frames, source=src3d)))

    def test_out_of_plane_run_is_skipped(self):
        self.assertEqual(int(btv.decode_rle("0 2 23 5", 6, 4).sum()), 2)

    def test_output_loads_in_the_training_dataset(self):
        frames = [frame(0, (1, [{"class": "myo", "segmentationmaskcontents": "0 6"}], {}))]
        btv.build(self.payload([tracked(0, 1, 6, "myo")], frames))
        _, preprocess = import_v2()
        dataset = preprocess.Nifti2DSliceDataset(str(self.dir / "out" / "images"), str(self.dir / "out" / "masks"))
        self.assertEqual(len(dataset), 1)
        _, mask = dataset[0]
        self.assertTrue(set(np.unique(mask).tolist()) <= {0, 2})

    def test_a_frozen_test_patient_is_refused_whole(self):
        from frozen_guard import FrozenIndex
        index = self.dir / "frozen_slices.npz"
        FrozenIndex.from_arrays({"acdc/patient101_frame01.nii.gz": self.data[:, :, :, 0]}).save(index)
        frames = [frame(1, (2, [{"class": "lvc", "segmentationmaskcontents": "0 3"}], {}))]
        # The edit is on frame 1, but frame 0 is a frozen test slice: the whole patient is refused.
        out = btv.build({**self.payload([tracked(1, 2, 3)], frames), "frozen_slices": str(index)})
        self.assertEqual(out["files"], [])
        self.assertEqual(out["frozen_match"], {"frame": 0, "slice": 0, "frozen": "acdc/patient101_frame01.nii.gz#z0"})
        self.assertEqual(out["skipped"]["frozen_test_patient"], 1)
        self.assertFalse((self.dir / "out").exists())

    def test_the_check_alone_answers_for_the_whole_volume_and_writes_nothing(self):
        from frozen_guard import FrozenIndex
        index = self.dir / "frozen_slices.npz"
        FrozenIndex.from_arrays({"acdc/patient101_frame01.nii.gz": self.data[:, :, :, 0]}).save(index)
        check = {"check_frozen": True, "source_nifti": self.payload([], [])["source_nifti"], "frozen_slices": str(index)}
        self.assertEqual(btv.build(check),
                         {"frozen_match": {"frame": 0, "slice": 0, "frozen": "acdc/patient101_frame01.nii.gz#z0"}})
        rng = np.random.default_rng(9)
        FrozenIndex.from_arrays({"other.nii.gz": rng.random((6, 4, 3)).astype(np.float32)}).save(index)
        self.assertEqual(btv.build(check), {"frozen_match": None})
        self.assertFalse((self.dir / "out").exists())

    def test_an_unrelated_frozen_index_changes_nothing(self):
        from frozen_guard import FrozenIndex
        index = self.dir / "frozen_slices.npz"
        rng = np.random.default_rng(9)
        FrozenIndex.from_arrays({"other.nii.gz": rng.random((6, 4, 3)).astype(np.float32)}).save(index)
        frames = [frame(1, (2, [{"class": "lvc", "segmentationmaskcontents": "0 3"}], {}))]
        out = btv.build({**self.payload([tracked(1, 2, 3)], frames), "frozen_slices": str(index)})
        self.assertEqual(len(out["files"]), 1)
        self.assertNotIn("frozen_match", out)

    def test_main_reports_errors_as_json(self):
        res = subprocess.run([sys.executable, str(TOOLS / "build_training_volumes.py")], input="{}",
                             capture_output=True, text=True, timeout=120)
        self.assertEqual(res.returncode, 0)
        self.assertIn("error", json.loads(res.stdout))


if __name__ == "__main__":
    unittest.main()
