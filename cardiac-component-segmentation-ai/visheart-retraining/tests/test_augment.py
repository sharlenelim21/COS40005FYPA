import sys
import unittest
from pathlib import Path

import numpy as np

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from augment import build_corrected_train_transforms  # noqa: E402


class CorrectedAugmentation(unittest.TestCase):
    def setUp(self):
        self.pipeline = build_corrected_train_transforms(spatial_size=(64, 64))
        self.names = [type(t).__name__ for t in self.pipeline.transforms]

    def test_no_rotation_group_and_no_flip(self):
        self.assertNotIn("RandRotate90d", self.names)
        self.assertNotIn("RandFlipd", self.names)
        self.assertIn("RandRotated", self.names)

    def test_rotation_actually_moves_pixels_on_2d_input(self):
        rotate = next(t for t in self.pipeline.transforms if type(t).__name__ == "RandRotated")
        rotate.prob = 1.0
        rotate.set_random_state(seed=0)
        image = np.zeros((1, 64, 64), dtype=np.float32)
        image[:, 30:34, 8:56] = 1.0  # a horizontal bar
        out = rotate({"image": image, "mask": image.astype(np.int64)})
        self.assertGreater(float(np.abs(np.asarray(out["image"]) - image).sum()), 1.0)

    def test_labels_stay_integer_classes_and_size_is_kept(self):
        self.pipeline.set_random_state(seed=1)
        mask = np.zeros((1, 80, 80), dtype=np.int64)
        mask[:, 20:40, 20:40] = 1
        mask[:, 40:60, 40:60] = 3
        image = np.random.default_rng(0).random((1, 80, 80)).astype(np.float32)
        for _ in range(5):
            out = self.pipeline({"image": image, "mask": mask})
            self.assertEqual(tuple(out["image"].shape), (1, 64, 64))
            self.assertTrue(set(np.unique(np.asarray(out["mask"])).tolist()) <= {0, 1, 2, 3})


if __name__ == "__main__":
    unittest.main()
