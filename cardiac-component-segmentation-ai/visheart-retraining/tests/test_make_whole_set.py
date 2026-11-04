import json
import sys
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import make_whole_set  # noqa: E402
from frozen_guard import FrozenIndex  # noqa: E402

SHAPE = (12, 12, 4)


def write_pair(images, masks, stem, seed):
    image = (np.random.default_rng(seed).random(SHAPE) * 300).astype(np.float32)
    mask = np.zeros(SHAPE, dtype=np.uint8)
    mask[3:8, 3:8, 1:3] = 2
    nib.save(nib.Nifti1Image(image, np.eye(4)), str(images / f"{stem}.nii.gz"))
    nib.save(nib.Nifti1Image(mask, np.eye(4)), str(masks / f"{stem}_gt.nii.gz"))
    return image, mask


class WholeSet(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = self.root = Path(self.tmp.name)
        self.sources, self.volumes = [], {}
        for s, name in enumerate(("acdc", "mms1")):
            images, masks = root / name / "images", root / name / "masks"
            images.mkdir(parents=True)
            masks.mkdir(parents=True)
            for patient in range(3):
                for frame in ("frame01", "frame12"):
                    stem = f"patient00{patient}_{frame}" if name == "acdc" else f"00{patient}_SA_{frame}"
                    self.volumes[(name, stem)] = write_pair(images, masks, stem, 100 * s + 10 * patient + len(frame))
            self.sources.append((name, images, masks))
        # One correction: one slice of acdc patient001, as the export writes it.
        self.export = root / "export"
        (self.export / "images").mkdir(parents=True)
        (self.export / "masks").mkdir(parents=True)
        image, mask = self.volumes[("acdc", "patient001_frame12")]
        nib.save(nib.Nifti1Image(image[:, :, 2:3], np.eye(4)), str(self.export / "images" / "p1_unet_f11.nii.gz"))
        nib.save(nib.Nifti1Image(mask[:, :, 2:3], np.eye(4)), str(self.export / "masks" / "p1_unet_f11_gt.nii.gz"))
        # The frozen set holds a slice of mms1 patient 002.
        frozen_image = self.volumes[("mms1", "002_SA_frame01")][0]
        self.frozen = FrozenIndex.from_arrays({"mms1/002.nii.gz": frozen_image[:, :, 1:2]})
        self.meta = {"path": "frozen_slices.npz", "sha256": "f" * 64}

    def tearDown(self):
        self.tmp.cleanup()

    def build(self, out="whole", cache="cache"):
        return make_whole_set.build(self.sources, self.export, self.root / out, self.frozen, self.meta, self.root / cache)

    def test_the_correction_and_frozen_patients_are_left_out_whole(self):
        manifest = self.build()
        excluded = {(e["source"], e["patient"]): e["reason"] for e in manifest["excluded"]}
        self.assertEqual(excluded, {("acdc", "patient001"): "same image as a correction",
                                    ("mms1", "002_SA"): "frozen test slice"})
        self.assertEqual(sorted(p.name for p in (self.root / "whole" / "acdc" / "images").iterdir()),
                         ["patient000_frame01.nii.gz", "patient000_frame12.nii.gz",
                          "patient002_frame01.nii.gz", "patient002_frame12.nii.gz"])
        self.assertEqual(manifest["sources"]["mms1"]["patients"], 2)

    def test_the_corrections_are_repeated_to_one_eleventh(self):
        manifest = self.build()
        self.assertEqual(manifest["whole_slices"], 4 * 2 * 4)                # 4 patients kept x 2 volumes x 4 slices
        self.assertEqual(manifest["repeats"], 3)                            # round(32 / (10 x 1))
        repeated = sorted(p.name for p in (self.root / "whole" / "corrections" / "masks").iterdir())
        self.assertEqual(repeated, [f"p1_unet_f11_r00{i}_gt.nii.gz" for i in range(3)])
        self.assertAlmostEqual(manifest["correction_share"], 3 / 35, places=4)
        self.assertTrue((self.root / "whole" / "whole_manifest.json").exists())

    def test_the_train_folders_list_every_source_then_the_corrections(self):
        manifest = self.build()
        folders = make_whole_set.train_folders(self.root / "whole", manifest)
        self.assertEqual([images.parent.name for images, _ in folders], ["acdc", "mms1", "corrections"])

    def test_the_frozen_check_is_cached_and_reused(self):
        self.build()
        caches = sorted(p.name for p in (self.root / "cache").iterdir())
        self.assertEqual(caches, ["whole-frozen-acdc-ffffffffffffffff.json", "whole-frozen-mms1-ffffffffffffffff.json"])
        self.frozen = FrozenIndex.from_arrays({"none.nii.gz": np.ones((12, 12, 1), dtype=np.float32) * np.arange(12)})
        manifest = self.build(out="again")                                  # same index hash: the cache answers
        self.assertIn(("mms1", "002_SA"), {(e["source"], e["patient"]) for e in manifest["excluded"]})

    def test_a_changed_source_folder_is_checked_again(self):
        self.build()
        write_pair(self.sources[1][1], self.sources[1][2], "009_SA_frame01", 999)
        self.frozen = FrozenIndex.from_arrays({"none.nii.gz": np.ones((12, 12, 1), dtype=np.float32) * np.arange(12)})
        manifest = self.build(out="again")
        self.assertNotIn(("mms1", "002_SA"), {(e["source"], e["patient"]) for e in manifest["excluded"]})

    def test_a_used_folder_is_refused(self):
        self.build()
        with self.assertRaises(SystemExit):
            self.build()

    def test_the_repeat_count(self):
        self.assertEqual(make_whole_set.repeats(7346, 10), 73)
        self.assertEqual(make_whole_set.repeats(50, 100), 1)


if __name__ == "__main__":
    unittest.main()
