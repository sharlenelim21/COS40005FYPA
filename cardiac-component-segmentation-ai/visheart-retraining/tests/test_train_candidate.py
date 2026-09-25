import json
import sys
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np
import torch

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import train_candidate  # noqa: E402
from common import build_model  # noqa: E402
from frozen_guard import FrozenIndex  # noqa: E402

SHAPE = (16, 16, 6)          # slices 1-4 hold the heart


def write_volume(images, masks, stem, seed):
    rng = np.random.default_rng(seed)
    image = (rng.random(SHAPE) * 400).astype(np.float32)
    mask = np.zeros(SHAPE, dtype=np.uint8)
    for z in range(1, 5):
        mask[4:8, 4:8, z], mask[8:12, 8:12, z], mask[6:10, 10:13, z] = 1, 2, 3
    nib.save(nib.Nifti1Image(image, np.eye(4)), str(images / f"{stem}.nii.gz"))
    nib.save(nib.Nifti1Image(mask, np.eye(4)), str(masks / f"{stem}_gt.nii.gz"))
    return image, mask


class TrainCandidate(unittest.TestCase):
    """The default release recipe end to end on tiny data: one real fine-tune epoch, so this takes a little while."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = cls.root = Path(cls.tmp.name)
        cls.sources, volumes, seed = [], {}, 0
        for name in ("acdc", "mms2"):
            images, masks = root / name / "images", root / name / "masks"
            images.mkdir(parents=True)
            masks.mkdir(parents=True)
            for patient in range(4):
                for frame in ("frame01", "frame12"):
                    seed += 1
                    volumes[f"{name}p{patient}_{frame}"] = write_volume(images, masks, f"{name}p{patient}_{frame}", seed)
            cls.sources.append((name, images, masks))
        # The export: two slices of acdcp1, as a correction would bring them.
        cls.export = root / "exports" / "corr"
        (cls.export / "images").mkdir(parents=True)
        (cls.export / "masks").mkdir(parents=True)
        image, mask = volumes["acdcp1_frame01"]
        nib.save(nib.Nifti1Image(image[:, :, 2:4], np.eye(4)), str(cls.export / "images" / "p1_unet_f0.nii.gz"))
        nib.save(nib.Nifti1Image(mask[:, :, 2:4], np.eye(4)), str(cls.export / "masks" / "p1_unet_f0_gt.nii.gz"))
        (cls.export / "export_manifest.json").write_text(json.dumps({"counts": {"slices": 2}}), encoding="utf-8")
        cls.val = root / "val"
        for sub in ("images", "masks"):
            (cls.val / sub).mkdir(parents=True)
        write_volume(cls.val / "images", cls.val / "masks", "v1", 99)
        cls.base = root / "base.pth"
        torch.save(build_model().state_dict(), cls.base)
        cls.frozen = root / "frozen_slices.npz"
        FrozenIndex.from_arrays({"other.nii.gz": np.random.default_rng(7).random((16, 16, 2)).astype(np.float32)}).save(cls.frozen)
        cls.versions = root / "versions"
        cls.code = train_candidate.main(cls.argv("cand", "--replay-ratio", "2", "--replay-seed", "5"))
        cls.meta = json.loads((cls.versions / "cand.json").read_text(encoding="utf-8"))
        cls.replay = json.loads((root / "exports" / "replay-cand" / "replay_manifest.json").read_text(encoding="utf-8"))

    @classmethod
    def argv(cls, label, *extra):
        args = ["--export", str(cls.export), "--label", label, "--base-checkpoint", str(cls.base),
                "--output-dir", str(cls.versions), "--val", str(cls.val / "images"), str(cls.val / "masks"),
                "--frozen-slices", str(cls.frozen), "--epochs", "1", "--image-size", "64"]
        for name, images, masks in cls.sources:
            args += ["--source", name, str(images), str(masks)]
        return args + list(extra)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_the_run_succeeds(self):
        self.assertEqual(self.code, 0)
        self.assertTrue((self.versions / "cand.pth").exists())

    def test_replay_is_sized_by_the_ratio(self):
        self.assertEqual(self.replay["slices"], 4)                      # 2 corrected slices x ratio 2
        self.assertEqual(self.meta["recipe"]["replay_slices"], 4)
        self.assertEqual((self.meta["recipe"]["replay_ratio"], self.meta["recipe"]["replay_seed"]), (2, 5))

    def test_the_patient_of_a_correction_is_left_out(self):
        excluded = {(e["source"], e["patient"]): e["reason"] for e in self.replay["excluded"]}
        self.assertEqual(excluded.get(("acdc", "acdcp1")), "same image as a correction")

    def test_the_last_epoch_is_kept_and_both_folders_trained(self):
        self.assertEqual(self.meta["hyperparameters"]["select"], "last")
        trained = [Path(t["images"]).parent.name for t in self.meta["train"]]
        self.assertEqual(trained, ["corr", "replay-cand"])
        self.assertTrue(self.meta["train"][0]["manifest"]["file"].endswith("export_manifest.json"))
        self.assertTrue(self.meta["train"][1]["manifest"]["file"].endswith("replay_manifest.json"))
        self.assertEqual(self.meta["recipe"]["name"], train_candidate.RECIPE)

    def test_max_replay_caps_the_replay_set(self):
        code = train_candidate.main(self.argv("capped", "--replay-ratio", "10", "--max-replay", "3"))
        self.assertEqual(code, 0)
        manifest = json.loads((self.root / "exports" / "replay-capped" / "replay_manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["slices"], 3)

    def test_an_existing_label_is_refused_before_any_work(self):
        self.assertEqual(train_candidate.main(self.argv("cand", "--replay-out", str(self.root / "unused"))), 1)
        self.assertFalse((self.root / "unused").exists())

    def test_an_export_without_a_manifest_is_refused(self):
        bare = self.root / "bare"
        (bare / "images").mkdir(parents=True)
        argv = self.argv("bare-run")
        argv[argv.index(str(self.export))] = str(bare)
        self.assertEqual(train_candidate.main(argv), 1)


if __name__ == "__main__":
    unittest.main()
