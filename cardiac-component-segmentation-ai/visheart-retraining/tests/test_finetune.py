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
import finetune  # noqa: E402
from common import build_model, sha256_file  # noqa: E402
from frozen_guard import FrozenIndex  # noqa: E402


class Finetune(unittest.TestCase):
    """One real epoch on tiny synthetic volumes; slow-ish (it saves and loads the 206 MB model twice)."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        rng = np.random.default_rng(0)
        for split, cases in (("train", ("t1", "t2")), ("val", ("v1",))):
            (cls.root / split / "images").mkdir(parents=True)
            (cls.root / split / "masks").mkdir(parents=True)
            for case in cases:
                mask = np.zeros((32, 32, 2), dtype=np.uint8)
                mask[8:16, 8:16, :] = 1
                mask[16:24, 16:24, :] = 3
                nib.save(nib.Nifti1Image(rng.random((32, 32, 2)).astype(np.float32), np.eye(4)),
                         str(cls.root / split / "images" / f"{case}.nii.gz"))
                nib.save(nib.Nifti1Image(mask, np.eye(4)), str(cls.root / split / "masks" / f"{case}_gt.nii.gz"))
        cls.base = cls.root / "base.pth"
        torch.save(build_model().state_dict(), cls.base)
        cls.base_state = torch.load(cls.base, map_location="cpu", weights_only=True)
        cls.out = cls.root / "versions"
        cls.frozen = cls.root / "frozen_slices.npz"
        FrozenIndex.from_arrays({"unrelated.nii.gz": rng.random((32, 32, 2)).astype(np.float32)}).save(cls.frozen)
        cls.args = ["--base-checkpoint", str(cls.base), "--frozen-slices", str(cls.frozen),
                    "--train", str(cls.root / "train" / "images"), str(cls.root / "train" / "masks"),
                    "--val", str(cls.root / "val" / "images"), str(cls.root / "val" / "masks"),
                    "--output-dir", str(cls.out), "--label", "ft-test",
                    "--epochs", "1", "--batch-size", "2", "--image-size", "64", "--val-every", "1"]
        cls.code = finetune.main(cls.args)
        cls.metadata = json.loads((cls.out / "ft-test.json").read_text(encoding="utf-8"))
        cls.trained = torch.load(cls.out / "ft-test.pth", map_location="cpu", weights_only=True)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_the_run_succeeds(self):
        self.assertEqual(self.code, 0)

    def test_encoder_weights_are_unchanged(self):
        encoder_keys = [key for key in self.base_state if key.startswith("encoder.")]
        self.assertTrue(encoder_keys)
        for key in encoder_keys:
            self.assertTrue(torch.equal(self.base_state[key], self.trained[key]), key)

    def test_the_decoder_was_trained(self):
        changed = [key for key in self.base_state
                   if not key.startswith("encoder.") and self.base_state[key].is_floating_point()
                   and not torch.equal(self.base_state[key], self.trained[key])]
        self.assertTrue(changed)

    def test_the_output_loads_strictly_into_the_production_architecture(self):
        build_model(checkpoint=self.out / "ft-test.pth")

    def test_metadata_records_the_run(self):
        meta = self.metadata
        self.assertEqual(meta["base_checkpoint"]["sha256"], sha256_file(self.base))
        self.assertEqual(meta["weights"]["sha256"], sha256_file(self.out / "ft-test.pth"))
        self.assertTrue(meta["hyperparameters"]["encoder_frozen"])
        self.assertEqual(meta["hyperparameters"]["augmentation"], "corrected")
        self.assertLess(meta["parameters"]["trainable"], meta["parameters"]["total"])
        self.assertEqual((meta["best_epoch"], len(meta["history"]), meta["train_slices"]), (1, 1, 4))

    def test_an_existing_label_is_never_overwritten(self):
        before = sha256_file(self.out / "ft-test.pth")
        self.assertEqual(finetune.main(self.args), 1)
        self.assertEqual(sha256_file(self.out / "ft-test.pth"), before)

    def test_training_data_containing_a_frozen_slice_is_refused(self):
        leak = self.root / "leak"
        (leak / "images").mkdir(parents=True)
        (leak / "masks").mkdir(parents=True)
        image = nib.load(str(self.root / "train" / "images" / "t2.nii.gz"))
        frozen_slice = np.asanyarray(image.dataobj, dtype=np.float32)[:, :, 1:2]
        nib.save(nib.Nifti1Image(frozen_slice, np.eye(4)), str(leak / "images" / "x.nii.gz"))
        nib.save(nib.Nifti1Image(np.zeros((32, 32, 1), dtype=np.uint8), np.eye(4)), str(leak / "masks" / "x_gt.nii.gz"))
        index = self.root / "frozen_with_t2.npz"
        FrozenIndex.from_arrays({"acdc/t2.nii.gz": np.asanyarray(image.dataobj, dtype=np.float32)}).save(index)
        args = [a if a != str(self.frozen) else str(index) for a in self.args]
        args[args.index("ft-test")] = "ft-leak"
        args += ["--train", str(leak / "images"), str(leak / "masks")]
        self.assertEqual(finetune.main(args), 1)
        self.assertFalse((self.out / "ft-leak.pth").exists())

    def test_a_missing_frozen_index_is_refused(self):
        args = [a if a != str(self.frozen) else str(self.root / "missing.npz") for a in self.args]
        args[args.index("ft-test")] = "ft-no-index"
        self.assertEqual(finetune.main(args), 1)
        self.assertFalse((self.out / "ft-no-index.pth").exists())

    def revalidate(self, weights):
        # Validation Dice of saved weights, computed exactly as finetune.py computes it during training.
        from common import import_v2
        from monai.losses import DiceLoss
        _, preprocess = import_v2()
        from train_runner import multiclass_dice
        loader, _ = finetune.make_loader([(self.root / "val" / "images", self.root / "val" / "masks")],
                                         preprocess.build_val_transforms(spatial_size=(64, 64)), preprocess, 2, False)
        model = build_model(checkpoint=weights)
        finetune.freeze_encoder(model)
        return finetune.run_epoch(model, loader, torch.nn.CrossEntropyLoss(), DiceLoss(to_onehot_y=True, softmax=True),
                                  multiclass_dice)["dice"]

    def test_the_default_selection_is_best_and_recorded(self):
        meta = self.metadata
        self.assertEqual(meta["hyperparameters"]["select"], "best")
        self.assertEqual((meta["kept_epoch"], meta["kept_val_dice"]), (meta["best_epoch"], meta["best_val_dice"]))
        self.assertAlmostEqual(self.revalidate(self.out / "ft-test.pth"), meta["kept_val_dice"], places=6)

    def test_select_last_keeps_the_final_epoch(self):
        args = list(self.args)
        args[args.index("ft-test")] = "ft-last"
        args[args.index("--epochs") + 1] = "2"
        self.assertEqual(finetune.main(args + ["--select", "last"]), 0)
        meta = json.loads((self.out / "ft-last.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["hyperparameters"]["select"], "last")
        self.assertEqual(meta["kept_epoch"], 2)
        self.assertEqual(meta["kept_val_dice"], meta["history"][-1]["val_dice"])
        self.assertAlmostEqual(self.revalidate(self.out / "ft-last.pth"), meta["kept_val_dice"], places=6)
        self.assertEqual(meta["improved_over_base_on_val"], meta["kept_val_dice"] > meta["base_val"]["dice"])

    def test_a_replay_manifest_beside_the_images_is_recorded(self):
        folder = self.root / "replay-set"
        (folder / "images").mkdir(parents=True)
        (folder / "replay_manifest.json").write_text("{}", encoding="utf-8")
        recorded = finetune.source_manifest(folder / "images")
        self.assertTrue(recorded["file"].endswith("replay_manifest.json"))
        self.assertEqual(recorded["sha256"], sha256_file(folder / "replay_manifest.json"))

    def test_the_guard_is_recorded_in_the_metadata(self):
        guard = self.metadata["frozen_guard"]
        self.assertEqual(guard["index"]["sha256"], sha256_file(self.frozen))
        self.assertEqual(guard["train_slices_checked"], 4)
        self.assertEqual(guard["matches"], 0)

    def test_freezing_leaves_only_the_decoder_trainable(self):
        model = build_model()
        finetune.freeze_encoder(model)
        trainable = [name for name, p in model.named_parameters() if p.requires_grad]
        self.assertTrue(trainable)
        self.assertFalse([name for name in trainable if name.startswith("encoder.")])


if __name__ == "__main__":
    unittest.main()
