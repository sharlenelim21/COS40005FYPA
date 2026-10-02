"""relocate.py: moving the retraining data to another root (plan linux-and-cpu-support, Task 2)."""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import holdout  # noqa: E402
import relocate  # noqa: E402
from common import sha256_file  # noqa: E402
from frozen_guard import FrozenIndex, build  # noqa: E402


def volume(seed):
    return np.random.default_rng(seed).random((12, 10, 3)).astype(np.float32) * 400


class Relocate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.old, self.new = base / "old-root", base / "new-root"
        self.old_models, self.new_models = base / "old-repo" / "models", base / "new-repo" / "models"
        data = self.old / "data" / "testing-acdc"
        for split in ("images", "masks"):
            (data / split).mkdir(parents=True)
        nib.save(nib.Nifti1Image(volume(1), np.eye(4)), str(data / "images" / "p1.nii.gz"))
        nib.save(nib.Nifti1Image(np.zeros((12, 10, 3), dtype=np.uint8), np.eye(4)), str(data / "masks" / "p1_gt.nii.gz"))
        versions_dir = self.old / "versions"
        versions_dir.mkdir()
        holdout.create(versions_dir / "frozen_holdout.json", {"acdc": (data / "images", data / "masks")})
        build(versions_dir / "frozen_holdout.json", versions_dir / "frozen_slices.npz")
        (self.old_models / "active").mkdir(parents=True)
        (self.old_models / "unet.pth").write_bytes(b"original weights")
        (versions_dir / "orig.pth").write_bytes(b"original weights")
        (versions_dir / "cand.pth").write_bytes(b"candidate weights")
        digest = sha256_file(self.old_models / "unet.pth")
        registry = {"schema": 2, "original_file": str(self.old_models / "unet.pth"),
                    "active_slot": str(self.old_models / "active" / "unet.pth"),
                    "original": "orig", "active": "orig", "history": [],
                    "versions": {"orig": {"file": "orig.pth", "sha256": digest, "status": "original"},
                                 "cand": {"file": "cand.pth", "sha256": sha256_file(versions_dir / "cand.pth"),
                                          "status": "candidate"},
                                 "gone": {"file": "gone.pth", "sha256": "0" * 64, "status": "deleted"}}}
        (versions_dir / "registry.json").write_text(json.dumps(registry), encoding="utf-8")
        report = {"datasets": {"acdc": {"images": str(data / "images"), "masks": str(data / "masks")}}, "scores": {}}
        (self.old / "evaluations").mkdir()
        (self.old / "evaluations" / "cand-public.json").write_text(json.dumps(report), encoding="utf-8")
        (self.old / "evidence" / "run-1").mkdir(parents=True)
        (self.old / "evidence" / "run-1" / "public.json").write_text(json.dumps(report), encoding="utf-8")
        # The data is copied to the new machine as it is; its files still name the old root.
        shutil.copytree(self.old, self.new)
        shutil.copytree(self.old_models, self.new_models)

    def tearDown(self):
        self.tmp.cleanup()

    def run_relocate(self, *extra):
        return relocate.main(["--old-root", str(self.old), "--new-root", str(self.new),
                              "--models-dir", str(self.new_models), *extra])

    def read(self, *parts):
        return json.loads((self.new.joinpath(*parts)).read_text(encoding="utf-8"))

    def test_a_path_moves_whatever_its_separators_and_case(self):
        self.assertEqual(relocate.moved(r"E:\Jy\Unet\versions\registry.json", r"E:\Jy\Unet", "/srv/visheart"),
                         Path("/srv/visheart/versions/registry.json"))
        self.assertEqual(relocate.moved(r"e:/jy/unet/data/a", r"E:\Jy\Unet", "/srv/visheart"), Path("/srv/visheart/data/a"))
        self.assertEqual(relocate.moved(r"E:\Jy\Unet", r"E:\Jy\Unet", "/srv/visheart"), Path("/srv/visheart"))
        self.assertIsNone(relocate.moved(r"E:\Jy\Unet2\x", r"E:\Jy\Unet", "/srv/visheart"))
        self.assertIsNone(relocate.moved(r"D:\other\x", r"E:\Jy\Unet", "/srv/visheart"))

    def test_the_data_moves_after_every_file_checks_out(self):
        self.assertEqual(self.run_relocate(), 0)
        manifest = self.new / "versions" / "frozen_holdout.json"
        images = Path(self.read("versions", "frozen_holdout.json")["public"]["acdc"]["images"])
        self.assertEqual(images, self.new / "data" / "testing-acdc" / "images")
        self.assertEqual(holdout.verify(manifest), [])
        registry = self.read("versions", "registry.json")
        self.assertEqual(Path(registry["original_file"]), self.new_models / "unet.pth")
        self.assertEqual(Path(registry["active_slot"]), self.new_models / "active" / "unet.pth")
        # The index was rebuilt from the moved manifest, so fine-tuning accepts it.
        index = FrozenIndex.load(self.new / "versions" / "frozen_slices.npz")
        self.assertEqual(Path(index.manifest["path"]), manifest)
        self.assertIsNone(index.manifest_problem())
        # The pipeline's own reports follow; the evidence is never touched.
        self.assertEqual(Path(self.read("evaluations", "cand-public.json")["datasets"]["acdc"]["images"]), images)
        self.assertEqual(Path(self.read("evidence", "run-1", "public.json")["datasets"]["acdc"]["images"]),
                         self.old / "data" / "testing-acdc" / "images")
        backups = list((self.new / "versions").glob("relocation-backup-*"))
        self.assertEqual(len(backups), 1)
        self.assertTrue((backups[0] / "registry.json").exists())

    def test_a_missing_or_changed_file_stops_everything(self):
        (self.new / "data" / "testing-acdc" / "masks" / "p1_gt.nii.gz").unlink()
        before = (self.new / "versions" / "frozen_holdout.json").read_bytes()
        self.assertEqual(self.run_relocate(), 1)
        self.assertEqual((self.new / "versions" / "frozen_holdout.json").read_bytes(), before)
        self.assertEqual(list((self.new / "versions").glob("relocation-backup-*")), [])

    def test_a_checkpoint_that_did_not_arrive_stops_everything(self):
        (self.new / "versions" / "cand.pth").unlink()
        self.assertEqual(self.run_relocate(), 1)
        self.assertEqual(Path(self.read("versions", "registry.json")["original_file"]), self.old_models / "unet.pth")

    def test_a_dry_run_checks_and_writes_nothing(self):
        before = {path: path.read_bytes() for path in (self.new / "versions").iterdir() if path.is_file()}
        self.assertEqual(self.run_relocate("--dry-run"), 0)
        after = {path: path.read_bytes() for path in (self.new / "versions").iterdir() if path.is_file()}
        self.assertEqual(after, before)


if __name__ == "__main__":
    unittest.main()
