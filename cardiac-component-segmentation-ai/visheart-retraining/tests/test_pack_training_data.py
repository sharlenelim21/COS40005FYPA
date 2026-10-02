"""pack_training_data.py: the training data, packed for another computer and checked there."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import holdout  # noqa: E402
import pack_training_data as packing  # noqa: E402
import relocate  # noqa: E402
from common import sha256_file  # noqa: E402
from frozen_guard import build  # noqa: E402


def write(path, data=b"x"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


class PackTrainingData(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.root, self.models = base / "Unet", base / "repo" / "models"
        root = self.root
        v2 = root / "2023_FRGS_HeartDigitalTwin" / "segmentation" / "v2-unet"
        self.v2 = v2
        data = v2 / "data" / "testing-acdc"
        for split in ("images", "masks"):
            (data / split).mkdir(parents=True)
        image = np.random.default_rng(1).random((12, 10, 3)).astype(np.float32) * 400
        nib.save(nib.Nifti1Image(image, np.eye(4)), str(data / "images" / "p1.nii.gz"))
        nib.save(nib.Nifti1Image(np.zeros((12, 10, 3), dtype=np.uint8), np.eye(4)), str(data / "masks" / "p1_gt.nii.gz"))
        write(v2 / "data" / "training-acdc" / "images" / "p2.nii.gz", b"training image")
        write(v2 / "data.zip", b"the same data again")
        write(v2 / "train_runner.py", b"# trainer")
        write(v2 / "requirements.txt", b"torch")
        write(v2 / "models" / "unet2d.py", b"# model")
        write(v2 / "models" / "checkpoints" / "old.pth", b"old checkpoint")
        write(v2 / "models" / "medsam_vit_b.pth", b"another model")
        write(v2 / "utils" / "preprocess.py", b"# preprocess")
        write(v2 / "utils" / "__pycache__" / "preprocess.cpython-313.pyc", b"cache")

        versions_dir = root / "versions"
        versions_dir.mkdir()
        holdout.create(versions_dir / "frozen_holdout.json", {"acdc": (data / "images", data / "masks")})
        build(versions_dir / "frozen_holdout.json", versions_dir / "frozen_slices.npz")
        write(self.models / "unet.pth", b"original weights")
        (self.models / "active").mkdir()
        write(versions_dir / "orig.pth", b"original weights")
        write(versions_dir / "cand.pth", b"candidate weights")
        write(versions_dir / "cand.json", b"{}")
        write(versions_dir / "stray.pth", b"not in the registry")
        write(versions_dir / "relocation-backup-20260101-000000" / "registry.json", b"{}")
        registry = {"schema": 2, "original_file": str(self.models / "unet.pth"),
                    "active_slot": str(self.models / "active" / "unet.pth"),
                    "original": "orig", "active": "orig", "history": [],
                    "versions": {"orig": {"file": "orig.pth", "sha256": sha256_file(self.models / "unet.pth"),
                                          "status": "original"},
                                 "cand": {"file": "cand.pth", "sha256": sha256_file(versions_dir / "cand.pth"),
                                          "status": "candidate"},
                                 "gone": {"file": "gone.pth", "sha256": "0" * 64, "status": "deleted"}}}
        (versions_dir / "registry.json").write_text(json.dumps(registry), encoding="utf-8")

        report = {"datasets": {"acdc": {"images": str(data / "images"), "masks": str(data / "masks")}}, "scores": {}}
        write(root / "evaluations" / "cand-public.json", json.dumps(report).encode("utf-8"))
        write(root / "evidence" / "run-1" / "public-cand.json", json.dumps(report).encode("utf-8"))
        write(root / "evidence" / "run-1" / "notes.md", b"private notes")
        write(root / "examples" / "cand" / "index.json", b"{}")
        write(root / "examples" / "cand" / "0" / "image_0.png", b"png")
        write(root / "jobs" / "worker.log", b"log")
        write(root / "exports" / "export.npz", b"export")
        write(root / "scratch-versions" / "x.pth", b"scratch")
        write(root / ".venv" / "Scripts" / "python.exe", b"python")
        self.out = base / "pack"

    def tearDown(self):
        self.tmp.cleanup()

    def test_the_pack_holds_what_another_computer_needs_and_nothing_else(self):
        chosen = sorted(rel for _, rel in packing.selection(self.root, self.v2))
        v2 = "2023_FRGS_HeartDigitalTwin/segmentation/v2-unet"
        self.assertEqual(chosen, sorted([
            "versions/registry.json", "versions/frozen_holdout.json", "versions/frozen_slices.npz",
            "versions/orig.pth", "versions/cand.pth", "versions/cand.json",
            f"{v2}/train_runner.py", f"{v2}/requirements.txt", f"{v2}/models/unet2d.py", f"{v2}/utils/preprocess.py",
            f"{v2}/data/testing-acdc/images/p1.nii.gz", f"{v2}/data/testing-acdc/masks/p1_gt.nii.gz",
            f"{v2}/data/training-acdc/images/p2.nii.gz",
            "evaluations/cand-public.json", "evaluations/from-evidence-run-1-public-cand.json",
            "examples/cand/index.json", "examples/cand/0/image_0.png",
            "repo-models/unet.pth",
        ]))

    def test_a_pack_is_checked_file_by_file(self):
        manifest = packing.pack(self.root, self.out, self.v2, log=lambda *_: None)
        self.assertEqual(manifest["old_root"], str(self.root))
        self.assertEqual(manifest["old_models_dir"], str(self.models))
        self.assertEqual(len(manifest["files"]), 18)
        self.assertTrue((self.out / packing.PACK_MANIFEST).exists())
        self.assertFalse((self.out / "evidence").exists())               # only the reports, copied into evaluations
        self.assertEqual(packing.verify(self.out), [])
        (self.out / "versions" / "cand.pth").write_bytes(b"damaged in transit")
        (self.out / "examples" / "cand" / "index.json").unlink()
        problems = packing.verify(self.out)
        self.assertEqual(len(problems), 2)
        self.assertTrue(any("versions/cand.pth" in problem for problem in problems))
        self.assertTrue(any("examples/cand/index.json" in problem and "missing" in problem for problem in problems))

    def test_it_never_packs_into_a_folder_that_holds_something(self):
        write(self.out / "keep.txt", b"someone's file")
        with self.assertRaises(SystemExit):
            packing.pack(self.root, self.out, self.v2, log=lambda *_: None)
        self.assertEqual((self.out / "keep.txt").read_bytes(), b"someone's file")

    def test_an_unfinished_pack_does_not_verify(self):
        self.out.mkdir()
        write(self.out / "versions" / "registry.json", b"{}")
        self.assertEqual(len(packing.verify(self.out)), 1)
        self.assertIn(packing.PACK_MANIFEST, packing.verify(self.out)[0])

    def test_a_pack_moves_to_its_new_place_with_relocate(self):
        manifest = packing.pack(self.root, self.out, self.v2, log=lambda *_: None)
        new_models = Path(self.tmp.name) / "other-pc-repo" / "models"
        write(new_models / "unet.pth", (self.out / "repo-models" / "unet.pth").read_bytes())
        self.assertEqual(relocate.main(["--old-root", manifest["old_root"], "--new-root", str(self.out),
                                        "--models-dir", str(new_models)]), 0)
        registry = json.loads((self.out / "versions" / "registry.json").read_text(encoding="utf-8"))
        self.assertEqual(registry["original_file"], str(new_models / "unet.pth"))
        frozen = json.loads((self.out / "versions" / "frozen_holdout.json").read_text(encoding="utf-8"))
        self.assertTrue(frozen["public"]["acdc"]["images"].startswith(str(self.out)))
        copied = json.loads((self.out / "evaluations" / "from-evidence-run-1-public-cand.json").read_text(encoding="utf-8"))
        self.assertTrue(copied["datasets"]["acdc"]["images"].startswith(str(self.out)))   # so Results finds its scores
        original = json.loads((self.root / "evidence" / "run-1" / "public-cand.json").read_text(encoding="utf-8"))
        self.assertTrue(original["datasets"]["acdc"]["images"].startswith(str(self.root)))  # the evidence is untouched


if __name__ == "__main__":
    unittest.main()
