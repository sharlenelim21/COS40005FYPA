import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import nibabel as nib
import numpy as np
import torch

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import evaluate  # noqa: E402
import holdout  # noqa: E402


class ConstantModel(torch.nn.Module):
    """Predicts one class everywhere and counts its forward calls."""

    def __init__(self, label):
        super().__init__()
        self.label, self.calls = label, 0

    def forward(self, x):
        self.calls += 1
        logits = torch.zeros(x.shape[0], 4, x.shape[2], x.shape[3])
        logits[:, self.label] = 1.0
        return logits


class Evaluate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.images, self.masks = self.dir / "images", self.dir / "masks"
        self.images.mkdir()
        self.masks.mkdir()
        rng = np.random.default_rng(0)
        for case in ("c1", "c2", "c3"):
            mask = np.zeros((16, 16, 2), dtype=np.uint8)
            mask[4:8, 4:8, :] = 1  # a 4 x 4 RV square on both slices; 16 -> 256 is an exact 16x resize
            nib.save(nib.Nifti1Image(rng.random((16, 16, 2)).astype(np.float32), np.eye(4)),
                     str(self.images / f"{case}.nii.gz"))
            nib.save(nib.Nifti1Image(mask, np.eye(4)), str(self.masks / f"{case}_gt.nii.gz"))
        self.base, self.new = self.dir / "base.pth", self.dir / "new.pth"
        self.base.write_bytes(b"base")
        self.new.write_bytes(b"new")
        self.models = {"base.pth": ConstantModel(0), "new.pth": ConstantModel(1)}
        self.output = self.dir / "report.json"

    def tearDown(self):
        self.tmp.cleanup()

    def run_eval(self):
        return evaluate.evaluate([("base", self.base), ("new", self.new)], [("toy", self.images, self.masks)],
                                 self.output, model_factory=lambda p: self.models[Path(p).name],
                                 log=lambda *_: None)

    def test_dice_by_class_on_a_known_case(self):
        scores = evaluate.dice_by_class(np.array([[1, 1], [0, 0]]), np.array([[1, 0], [0, 0]]))
        self.assertAlmostEqual(scores["rv"], 2 / 3, places=6)
        self.assertAlmostEqual(scores["background"], 0.8, places=6)
        self.assertEqual((scores["myocardium"], scores["lv_cavity"]), (1.0, 1.0))

    def test_score_case_matches_hand_computed_dice(self):
        # all-background prediction: background 2B / (N + B) with N = 2 * 256^2, B = N - 2 * 64^2 -> 30/31
        scores = evaluate.score_case(ConstantModel(0), self.images / "c1.nii.gz", self.masks / "c1_gt.nii.gz")
        self.assertAlmostEqual(scores["background"], 30 / 31, places=6)
        self.assertAlmostEqual(scores["rv"], 0.0, places=6)
        self.assertEqual(scores["myocardium"], 1.0)

    def test_load_case_and_predict_are_exactly_what_scoring_uses(self):
        slices, target = evaluate.load_case(self.images / "c1.nii.gz", self.masks / "c1_gt.nii.gz")
        self.assertEqual((tuple(slices.shape), tuple(target.shape)), ((2, 1, 256, 256), (2, 256, 256)))
        self.assertGreaterEqual(float(slices.min()), 0.0)
        self.assertLessEqual(float(slices.max()), 1.0)
        self.assertEqual(int(target[:, 64:128, 64:128].min()), 1)   # the 4 x 4 RV square, resized 16x
        prediction = evaluate.predict(ConstantModel(1), slices, batch_size=1)
        self.assertEqual((prediction.shape, int(prediction.min()), int(prediction.max())), ((2, 256, 256), 1, 1))
        self.assertEqual(evaluate.dice_by_class(prediction, target.numpy()),
                         evaluate.score_case(ConstantModel(1), self.images / "c1.nii.gz", self.masks / "c1_gt.nii.gz"))

    def test_report_compares_every_checkpoint_with_the_first(self):
        report = self.run_eval()
        self.assertEqual(report["summary"]["base"]["toy"]["n"], 3)
        comparison = report["comparison"]["new"]["toy"]
        expected = (2 / 17 + 2) / 3 - 2 / 3  # all-RV prediction scores RV 2R / (N + R) = 2/17
        self.assertAlmostEqual(comparison["mean_delta_cardiac"], expected, places=5)
        self.assertAlmostEqual(comparison["ci95"][0], expected, places=5)
        self.assertAlmostEqual(comparison["ci95"][1], expected, places=5)
        self.assertEqual((comparison["better"], comparison["worse"], comparison["tied"]), (3, 0, 0))

    def test_resume_skips_scored_cases(self):
        self.run_eval()
        calls = {name: model.calls for name, model in self.models.items()}
        self.run_eval()
        self.assertEqual({name: model.calls for name, model in self.models.items()}, calls)

    def test_a_changed_checkpoint_file_is_rescored(self):
        self.run_eval()
        calls = self.models["new.pth"].calls
        self.new.write_bytes(b"retrained")
        self.run_eval()
        self.assertGreater(self.models["new.pth"].calls, calls)

    def test_refuses_a_4d_volume(self):
        bad = self.dir / "bad.nii.gz"
        nib.save(nib.Nifti1Image(np.zeros((16, 16, 2, 2), dtype=np.float32), np.eye(4)), str(bad))
        with self.assertRaises(ValueError):
            evaluate.score_case(ConstantModel(0), bad, self.masks / "c1_gt.nii.gz")

    def test_nothing_is_scored_when_the_frozen_manifest_does_not_verify(self):
        manifest = self.dir / "frozen.json"
        holdout.create(manifest, {"toy": (self.images, self.masks)})
        (self.masks / "c1_gt.nii.gz").write_bytes(b"tampered")
        code = evaluate.main(["--checkpoint", "base", str(self.base), "--dataset", "toy", str(self.images),
                              str(self.masks), "--output", str(self.output), "--manifest", str(manifest)])
        self.assertEqual(code, 1)
        self.assertFalse(self.output.exists())

    # files read by other threads or processes while they are rewritten (plan WS13) --------------------------

    def test_atomic_write_json_waits_for_a_reader_to_close_the_file(self):
        path = self.dir / "shared.json"
        evaluate.atomic_write_json(path, {"value": 1})
        reader = open(path, encoding="utf-8")        # a page or a progress watcher holding the file for a moment
        timer = threading.Timer(0.3, reader.close)
        timer.start()
        try:
            evaluate.atomic_write_json(path, {"value": 2})  # Windows refuses to replace a file that is open elsewhere
        finally:
            timer.cancel()
            reader.close()
        self.assertEqual(json.loads(path.read_text(encoding="utf-8")), {"value": 2})

    def test_read_json_retries_while_the_file_is_being_replaced(self):
        in_use = PermissionError(13, "The process cannot access the file")
        with mock.patch.object(Path, "read_text", side_effect=[in_use, in_use, '{"value": 3}']):
            self.assertEqual(evaluate.read_json(self.dir / "shared.json"), {"value": 3})


if __name__ == "__main__":
    unittest.main()
