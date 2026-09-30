import json
import sys
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np
import torch
from PIL import Image

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import render_examples  # noqa: E402


class ConstantModel(torch.nn.Module):
    """Predicts one class everywhere."""

    def __init__(self, label):
        super().__init__()
        self.label = label

    def forward(self, x):
        logits = torch.zeros(x.shape[0], 4, x.shape[2], x.shape[3])
        logits[:, self.label] = 1.0
        return logits


def scores(cardiac):
    return {"background": 0.99, "rv": cardiac, "myocardium": cardiac, "lv_cavity": cardiac}


def pixels(path):
    with Image.open(path) as image:          # closed at once: Windows cannot delete a file that is still open
        return np.asarray(image).copy()


class RenderExamples(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.images, self.masks = self.root / "images", self.root / "masks"
        self.images.mkdir()
        self.masks.mkdir()
        rng = np.random.default_rng(0)
        for case in ("a.nii.gz", "b.nii.gz", "c.nii.gz", "d.nii.gz"):
            mask = np.zeros((16, 16, 3), dtype=np.uint8)
            mask[4:8, 4:8, :] = 1                  # a 4 x 4 RV square on every slice; 16 -> 256 is an exact 16x resize
            nib.save(nib.Nifti1Image(rng.random((16, 16, 3)).astype(np.float32), np.eye(4)), str(self.images / case))
            nib.save(nib.Nifti1Image(mask, np.eye(4)), str(self.masks / case.replace(".nii.gz", "_gt.nii.gz")))
        # new minus old, cardiac mean: toy a -0.3, b +0.1, c 0.0, d +0.2; tiny has one case, +0.05
        self.report = {"scores": {
            "old": {"toy": {f"{c}.nii.gz": scores(0.8) for c in "abcd"}, "tiny": {"a.nii.gz": scores(0.7)}},
            "new": {"toy": {"a.nii.gz": scores(0.5), "b.nii.gz": scores(0.9), "c.nii.gz": scores(0.8),
                            "d.nii.gz": scores(1.0)},
                    "tiny": {"a.nii.gz": scores(0.75)}}}}

    def tearDown(self):
        self.tmp.cleanup()

    def test_picks_the_lowest_median_and_highest_change_of_every_dataset(self):
        picks = render_examples.pick_scans(self.report, "old", "new")
        self.assertEqual([(p["dataset"], p["case"], p["role"]) for p in picks],
                         [("tiny", "a.nii.gz", "lowest"), ("toy", "a.nii.gz", "lowest"),
                          ("toy", "b.nii.gz", "median"), ("toy", "d.nii.gz", "highest")])
        self.assertAlmostEqual(picks[1]["delta"], -0.3, places=6)          # the largest drop is always shown
        self.assertEqual((picks[1]["scores"]["against"]["rv"], picks[1]["scores"]["label"]["rv"]), (0.8, 0.5))

    def test_render_writes_what_each_version_predicted_and_replaces_a_folder_whole(self):
        picks = render_examples.pick_scans(self.report, "old", "new")[1:2]     # toy, a.nii.gz
        out = self.root / "examples" / "new"
        datasets = {"toy": (self.images, self.masks)}
        models = {"against": ConstantModel(0), "label": ConstantModel(2)}
        entries = render_examples.render(picks, datasets, models, out, log=lambda *_: None, meta={"label": "new"})
        self.assertEqual(entries[0]["slices"], 3)
        index = json.loads((out / "index.json").read_text(encoding="utf-8"))
        self.assertEqual((index["label"], index["size"], index["examples"][0]["case"]), ("new", 256, "a.nii.gz"))
        self.assertEqual(pixels(out / "0" / "image_0.png").shape, (256, 256))
        self.assertEqual((int(pixels(out / "0" / "against_1.png").max()), int(pixels(out / "0" / "label_1.png").min())),
                         (0, 2))
        self.assertEqual(int(pixels(out / "0" / "truth_2.png")[64:128, 64:128].min()), 1)
        self.assertFalse(out.with_name("new.partial").exists())
        (out / "stale.txt").write_text("from an earlier render", encoding="utf-8")
        render_examples.render(picks, datasets, models, out, log=lambda *_: None)
        self.assertFalse((out / "stale.txt").exists())                        # replaced whole, never merged


    def test_another_version_predicts_the_same_scans_into_its_own_folder(self):
        picks = render_examples.pick_scans(self.report, "old", "new")[1:2]     # toy, a.nii.gz
        out = self.root / "examples" / "new"
        datasets = {"toy": (self.images, self.masks)}
        render_examples.render(picks, datasets, {"against": ConstantModel(0), "label": ConstantModel(2)}, out,
                               log=lambda *_: None, meta={"label": "new", "against": "old"})
        index = json.loads((out / "index.json").read_text(encoding="utf-8"))
        other = out / "compare" / "older"
        render_examples.render_comparison(index, datasets, ConstantModel(3), other, log=lambda *_: None,
                                          meta={"label": "new", "against": "older", "sha256": "abc"})
        self.assertEqual(int(pixels(other / "0" / "against_1.png").min()), 3)            # the other version's labels
        self.assertEqual(sorted(path.name for path in (other / "0").iterdir()), ["against_0.png", "against_1.png",
                                                                                 "against_2.png"])
        self.assertEqual(json.loads((other / "index.json").read_text(encoding="utf-8"))["against"], "older")
        self.assertEqual(int(pixels(out / "0" / "against_1.png").max()), 0)              # the first set is untouched


if __name__ == "__main__":
    unittest.main()
