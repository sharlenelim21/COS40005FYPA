import json
import sys
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import frozen_guard  # noqa: E402
import holdout  # noqa: E402
from frozen_guard import FrozenIndex  # noqa: E402


def volume(seed, shape=(24, 20, 3)):
    return np.random.default_rng(seed).random(shape).astype(np.float32) * 500


class Matching(unittest.TestCase):
    def setUp(self):
        self.frozen = volume(1)
        self.index = FrozenIndex.from_arrays({"acdc/patient101_frame01.nii.gz": self.frozen})

    def test_an_identical_slice_matches_exactly_and_names_its_source(self):
        self.assertEqual(self.index.match(self.frozen[:, :, 2].copy()), "acdc/patient101_frame01.nii.gz#z2")

    def test_a_rescaled_integer_copy_still_matches(self):
        copy = np.round(self.frozen[:, :, 1] * 3 + 7).astype(np.int16)  # re-encoded: new scale, integer rounding
        self.assertEqual(self.index.match(copy), "acdc/patient101_frame01.nii.gz#z1")

    def test_an_unrelated_slice_does_not_match(self):
        self.assertIsNone(self.index.match(volume(2)[:, :, 0]))

    def test_a_blank_slice_never_matches(self):
        index = FrozenIndex.from_arrays({"x.nii.gz": np.zeros((8, 8, 2), dtype=np.float32)})
        self.assertIsNone(index.match(np.zeros((8, 8), dtype=np.float32)))
        self.assertEqual(len(index), 0)

    def test_first_match_reports_frame_and_slice_of_a_4d_volume(self):
        cine = np.stack([volume(3), volume(4)], axis=3)
        cine[:, :, 1, 1] = self.frozen[:, :, 0]
        self.assertEqual(self.index.first_match(cine),
                         {"frame": 1, "slice": 1, "frozen": "acdc/patient101_frame01.nii.gz#z0"})
        self.assertIsNone(self.index.first_match(volume(5)))

    def test_save_and_load_keep_every_slice(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "frozen_slices.npz"
            self.index.save(path)
            loaded = FrozenIndex.load(path)
            self.assertEqual(len(loaded), 3)
            self.assertEqual(loaded.match(self.frozen[:, :, 2]), "acdc/patient101_frame01.nii.gz#z2")


class FromManifest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        for split in ("images", "masks"):
            (self.dir / "test" / split).mkdir(parents=True)
        self.frozen = volume(6)
        nib.save(nib.Nifti1Image(self.frozen, np.eye(4)), str(self.dir / "test" / "images" / "c1.nii.gz"))
        nib.save(nib.Nifti1Image(np.zeros((24, 20, 3), dtype=np.uint8), np.eye(4)),
                 str(self.dir / "test" / "masks" / "c1_gt.nii.gz"))
        self.manifest = self.dir / "frozen_holdout.json"
        holdout.create(self.manifest, {"toy": (self.dir / "test" / "images", self.dir / "test" / "masks")})
        self.index_path = self.dir / "frozen_slices.npz"

    def tearDown(self):
        self.tmp.cleanup()

    def test_build_indexes_the_image_files_of_the_manifest(self):
        index = frozen_guard.build(self.manifest, self.index_path)
        self.assertEqual(len(index), 3)
        loaded = FrozenIndex.load(self.index_path)
        self.assertEqual(loaded.match(self.frozen[:, :, 0]), "toy/c1.nii.gz#z0")
        self.assertIsNone(loaded.manifest_problem())

    def test_a_changed_public_arm_is_reported_but_a_clinical_draw_is_not(self):
        frozen_guard.build(self.manifest, self.index_path)
        data = json.loads(self.manifest.read_text(encoding="utf-8"))
        data["clinical"] = {"project_ids": ["p1"]}          # drawing the clinical arm leaves the public arm alone
        self.manifest.write_text(json.dumps(data), encoding="utf-8")
        self.assertIsNone(FrozenIndex.load(self.index_path).manifest_problem())
        data["public"]["toy"]["image_files"]["c1.nii.gz"] = "0" * 64
        self.manifest.write_text(json.dumps(data), encoding="utf-8")
        self.assertIn("changed", FrozenIndex.load(self.index_path).manifest_problem())

    def test_build_refuses_a_manifest_that_does_not_verify(self):
        nib.save(nib.Nifti1Image(volume(7), np.eye(4)), str(self.dir / "test" / "images" / "c1.nii.gz"))
        with self.assertRaises(SystemExit):
            frozen_guard.build(self.manifest, self.index_path)
        self.assertFalse(self.index_path.exists())

    def test_check_command_fails_on_overlap_and_passes_without(self):
        frozen_guard.build(self.manifest, self.index_path)
        clean, leaky = self.dir / "clean", self.dir / "leaky"
        clean.mkdir()
        leaky.mkdir()
        nib.save(nib.Nifti1Image(volume(8), np.eye(4)), str(clean / "a.nii.gz"))
        nib.save(nib.Nifti1Image(self.frozen[:, :, 1:2], np.eye(4)), str(leaky / "b.nii.gz"))
        self.assertEqual(frozen_guard.main(["check", "--index", str(self.index_path), str(clean)]), 0)
        self.assertEqual(frozen_guard.main(["check", "--index", str(self.index_path), str(clean), str(leaky)]), 1)


if __name__ == "__main__":
    unittest.main()
