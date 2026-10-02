import json
import sys
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import make_replay_set  # noqa: E402
from frozen_guard import FrozenIndex, check_paths  # noqa: E402

SHAPE = (16, 16, 6)          # slices 1-4 hold the heart, slices 0 and 5 are empty


def write_volume(images, masks, stem, seed):
    rng = np.random.default_rng(seed)
    image = (rng.random(SHAPE) * 400).astype(np.float32)
    mask = np.zeros(SHAPE, dtype=np.uint8)
    for z in range(1, 5):
        mask[4:8, 4:8, z], mask[8:12, 8:12, z], mask[6:10, 10:13, z] = 1, 2, 3
    nib.save(nib.Nifti1Image(image, np.eye(4)), str(images / f"{stem}.nii.gz"))
    nib.save(nib.Nifti1Image(mask, np.eye(4)), str(masks / f"{stem}_gt.nii.gz"))
    return image


class ReplaySet(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.sources, self.volumes, seed = [], {}, 0
        for name in ("acdc", "mms2"):
            images, masks = self.dir / name / "images", self.dir / name / "masks"
            images.mkdir(parents=True)
            masks.mkdir(parents=True)
            for patient in range(4):
                for frame in ("frame01", "frame12"):
                    seed += 1
                    stem = f"{name}p{patient}_{frame}"
                    self.volumes[stem] = write_volume(images, masks, stem, seed)
            self.sources.append((name, images, masks))
        self.out = self.dir / "replay"

    def tearDown(self):
        self.tmp.cleanup()

    def build(self, **kwargs):
        options = {"slices": 8, "per_volume": 2, "seed": 7}
        options.update(kwargs)
        return make_replay_set.build(self.sources, out=self.out, **options)

    def written(self):
        return sorted(p.name for p in (self.out / "images").glob("*.nii.gz"))

    def test_equal_shares_of_heart_slices_copied_exactly(self):
        manifest = self.build()
        self.assertEqual(manifest["slices"], 8)
        self.assertEqual({name: s["slices"] for name, s in manifest["sources"].items()}, {"acdc": 4, "mms2": 4})
        for entry in (f for s in manifest["sources"].values() for f in s["files"]):
            image = np.asanyarray(nib.load(str(self.out / "images" / entry["image"])).dataobj)
            mask = np.asanyarray(nib.load(str(self.out / "masks" / entry["image"].replace(".nii.gz", "_gt.nii.gz"))).dataobj)
            source = self.volumes[entry["source_image"].replace(".nii.gz", "")]
            np.testing.assert_array_equal(image, source[:, :, entry["slice_indices"]])
            self.assertTrue(all(mask[:, :, k].any() for k in range(mask.shape[2])))
            self.assertTrue(set(entry["slice_indices"]) <= {1, 2, 3, 4})

    def test_a_frozen_patient_is_left_out_whole(self):
        index = FrozenIndex.from_arrays({"acdc/test_frame01.nii.gz": self.volumes["acdcp1_frame01"]})
        manifest = self.build(frozen_index=index)
        self.assertFalse([name for name in self.written() if "acdcp1_" in name])      # neither frame
        reasons = {(e["source"], e["patient"]): e["reason"] for e in manifest["excluded"]}
        self.assertEqual(reasons.get(("acdc", "acdcp1")), "frozen test slice")

    def test_the_patient_of_a_correction_is_left_out_whole(self):
        corrections = self.dir / "corrections"
        corrections.mkdir()
        slice_ = self.volumes["mms2p2_frame12"][:, :, 3:4]
        nib.save(nib.Nifti1Image(slice_, np.eye(4)), str(corrections / "p123_unet_f0.nii.gz"))
        manifest = self.build(exclude_like=corrections)
        self.assertFalse([name for name in self.written() if "mms2p2_" in name])
        reasons = {(e["source"], e["patient"]): e["reason"] for e in manifest["excluded"]}
        self.assertEqual(reasons.get(("mms2", "mms2p2")), "same image as a correction")

    def test_the_output_passes_the_frozen_guard(self):
        index = FrozenIndex.from_arrays({"acdc/test_frame01.nii.gz": self.volumes["acdcp1_frame01"]})
        self.build(frozen_index=index)
        _, checked, matches = check_paths(index, [self.out / "images"])
        self.assertEqual((checked, matches), (8, []))

    def test_the_same_seed_draws_the_same_set(self):
        first = self.build()["sources"]
        self.out = self.dir / "replay-again"
        self.assertEqual(self.build()["sources"], first)

    def test_a_used_folder_is_refused(self):
        self.build()
        with self.assertRaises(SystemExit):
            self.build()

    def test_too_few_slices_is_refused(self):
        with self.assertRaises(SystemExit):
            self.build(slices=40)         # 4 patients x 2 slices per source cannot give 20 each

    def test_main_writes_a_manifest(self):
        index = self.dir / "frozen_slices.npz"
        FrozenIndex.from_arrays({"acdc/test_frame01.nii.gz": self.volumes["acdcp1_frame01"]}).save(index)
        argv = []
        for name, images, masks in self.sources:
            argv += ["--source", name, str(images), str(masks)]
        code = make_replay_set.main(argv + ["--slices", "4", "--out", str(self.out), "--seed", "3",
                                            "--frozen-slices", str(index)])
        self.assertEqual(code, 0)
        manifest = json.loads((self.out / "replay_manifest.json").read_text(encoding="utf-8"))
        self.assertEqual((manifest["slices"], manifest["seed"], manifest["per_volume"]), (4, 3, 2))
        self.assertEqual(manifest["frozen_index"]["path"], str(index.resolve()))

    def test_main_refuses_to_run_without_the_frozen_index(self):
        argv = ["--source", "acdc", str(self.sources[0][1]), str(self.sources[0][2]), "--slices", "2",
                "--out", str(self.out), "--frozen-slices", str(self.dir / "missing.npz")]
        self.assertEqual(make_replay_set.main(argv), 1)
        self.assertFalse(self.out.exists())


if __name__ == "__main__":
    unittest.main()
