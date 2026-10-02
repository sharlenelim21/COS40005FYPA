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
import review_queue  # noqa: E402
from frozen_guard import FrozenIndex  # noqa: E402


class FeatureEncoder(torch.nn.Module):
    """Returns NHWC feature maps like the mambaout encoder in UNet2D (unet2d.py forward permutes them)."""

    def forward(self, x):
        return [torch.cat([x, 1 - x], dim=1).permute(0, 2, 3, 1)]


class IntensityModel(torch.nn.Module):
    """Background vs RV decided by intensity: mid-grey pixels are the unsure ones."""

    def __init__(self):
        super().__init__()
        self.encoder = FeatureEncoder()

    def forward(self, x):
        self.encoder(x)
        zeros = torch.zeros_like(x)
        return torch.cat([(1 - x) * 8, x * 8, zeros - 20, zeros - 20], dim=1)


def candidate(project_id, uncertainty, embedding):
    return {"projectId": project_id, "uncertainty": uncertainty, "embedding": np.asarray(embedding, dtype=np.float64)}


class Uncertainty(unittest.TestCase):
    def test_normalized_entropy_known_values(self):
        probs = torch.tensor([[0.25, 0.25, 0.25, 0.25], [1.0, 0.0, 0.0, 0.0], [0.5, 0.5, 0.0, 0.0]])
        probs = probs.T.reshape(1, 4, 3, 1)
        entropy = review_queue.normalized_entropy(probs).flatten().tolist()
        self.assertAlmostEqual(entropy[0], 1.0, places=5)
        self.assertAlmostEqual(entropy[1], 0.0, places=5)
        self.assertAlmostEqual(entropy[2], 0.5, places=5)  # a coin flip between two classes

    def test_slice_uncertainty_uses_the_heart_region_only(self):
        pixels = [[1.0, 0.0, 0.0, 0.0],    # confident background: outside the region
                  [0.5, 0.5, 0.0, 0.0],    # unsure: inside, entropy 0.5
                  [0.0, 1.0, 0.0, 0.0],    # confident RV: inside, entropy 0
                  [0.95, 0.05, 0.0, 0.0]]  # 5 % foreground: below the 10 % floor, outside
        probs = torch.tensor(pixels).T.reshape(1, 4, 2, 2)
        [result] = review_queue.slice_uncertainty(probs, foreground_min_prob=0.1, unsure_entropy=0.5)
        self.assertEqual(result["region_pixels"], 2)
        self.assertAlmostEqual(result["score"], 0.25, places=5)
        self.assertEqual(result["unsure_pixels"], 1)

    def test_a_slice_with_no_heart_region_has_no_score(self):
        probs = torch.zeros(1, 4, 2, 2)
        probs[:, 0] = 1.0
        self.assertEqual(review_queue.slice_uncertainty(probs, 0.1, 0.5), [None])


class Selection(unittest.TestCase):
    def ids(self, queue):
        return [entry["projectId"] for entry in queue]

    def test_variety_beats_a_near_duplicate(self):
        pool = [candidate("A", 0.9, [1, 0]), candidate("B", 0.85, [1, 0]), candidate("C", 0.5, [0, 1])]
        self.assertEqual(self.ids(review_queue.select_queue(pool, [], top=3, diversity_weight=1.0)), ["A", "C", "B"])

    def test_without_diversity_it_is_pure_uncertainty(self):
        pool = [candidate("A", 0.9, [1, 0]), candidate("B", 0.85, [1, 0]), candidate("C", 0.5, [0, 1])]
        self.assertEqual(self.ids(review_queue.select_queue(pool, [], top=3, diversity_weight=0.0)), ["A", "B", "C"])

    def test_corrected_cases_push_the_queue_away_from_themselves(self):
        pool = [candidate("A", 0.9, [1, 0]), candidate("B", 0.85, [1, 0]), candidate("C", 0.7, [0, 1]),
                candidate("D", 0.5, [0, 1])]
        queue = review_queue.select_queue(pool, [np.array([1.0, 0.0])], top=2, diversity_weight=1.0)
        self.assertEqual(self.ids(queue), ["C", "A"])
        self.assertEqual(queue[0]["rank"], 1)
        self.assertAlmostEqual(queue[0]["novelty"], 1.0, places=6)

    def test_top_limits_the_queue(self):
        pool = [candidate(str(i), i / 10, [1, i]) for i in range(5)]
        self.assertEqual(len(review_queue.select_queue(pool, [], top=2, diversity_weight=1.0)), 2)


class BuildQueue(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        (self.dir / "volumes").mkdir()
        rng = np.random.default_rng(0)
        sharp = np.zeros((8, 8, 2), dtype=np.float32)
        sharp[:, 4:, :] = 1.0                                          # 0 or 1: the model is sure everywhere
        blurry = rng.uniform(0.3, 0.7, size=(8, 8, 2, 2)).astype(np.float32)
        blurry[0, 0] = 0.0                                             # pin min-max so mid-grey stays mid-grey
        blurry[0, 1] = 1.0
        for name, data in (("sharp", sharp), ("blurry", blurry), ("done", sharp)):
            nib.save(nib.Nifti1Image(data, np.eye(4)), str(self.dir / "volumes" / f"p{name}.nii.gz"))

        def entry(pid, eligible=True, corrected=False, volume=True):
            return {"projectId": pid, "name": f"Case {pid}", "eligible": eligible, "reason": None if eligible else "not_nifti",
                    "corrected": corrected, "hasUnetResult": True,
                    "volume": f"volumes/p{pid}.nii.gz" if volume else None}
        self.manifest = self.dir / "review_manifest.json"
        self.manifest.write_text(json.dumps({"projects": [
            entry("sharp"), entry("blurry"), entry("done", corrected=True), entry("dicom", eligible=False),
            entry("lost", volume=False)]}), encoding="utf-8")
        self.checkpoint = self.dir / "model.pth"
        self.checkpoint.write_bytes(b"weights")
        self.output = self.dir / "queue.json"
        self.blurry = blurry
        self.frozen = FrozenIndex.from_arrays({"other.nii.gz": rng.random((8, 8, 2)).astype(np.float32)})

    def tearDown(self):
        self.tmp.cleanup()

    def build(self):
        return review_queue.build_queue(self.manifest, self.checkpoint, self.output, self.frozen, top=5,
                                        model_factory=lambda _: IntensityModel(), log=lambda *_: None)

    def test_a_frozen_test_patient_is_never_queued(self):
        self.frozen = FrozenIndex.from_arrays({"acdc/patient101_frame01.nii.gz": self.blurry[:, :, :, 1]})
        report = self.build()
        self.assertEqual([e["projectId"] for e in report["queue"]], ["sharp"])
        self.assertEqual(report["excluded"], [{"projectId": "blurry", "name": "Case blurry", "corrected": False,
                                               "frozen_match": {"frame": 1, "slice": 0,
                                                                "frozen": "acdc/patient101_frame01.nii.gz#z0"}}])
        self.assertEqual(report["counts"]["skipped"]["frozen_test_patient"], 1)

    def test_the_unsure_case_comes_first_and_corrected_cases_are_left_out(self):
        report = self.build()
        ids = [entry["projectId"] for entry in report["queue"]]
        self.assertEqual(ids, ["blurry", "sharp"])
        self.assertEqual([c["projectId"] for c in report["corrected"]], ["done"])
        self.assertEqual(report["counts"]["skipped"], {"ineligible": 1, "no_volume": 1})
        first = report["queue"][0]
        self.assertEqual(first["open"], "/project/blurry/segmentation")
        self.assertEqual(first["slices_total"], 4)
        self.assertTrue({"frameindex", "sliceindex", "score"} <= set(first["top_slices"][0]))
        self.assertIn("unsure", first["reason"])
        self.assertNotIn("embedding", json.dumps(report))

    def test_the_report_records_what_produced_it(self):
        report = json.loads(self.output.read_text(encoding="utf-8")) if self.build() else None
        self.assertEqual(report["checkpoint"]["sha256"], review_queue.sha256_file(self.checkpoint))
        self.assertEqual(report["manifest"]["sha256"], review_queue.sha256_file(self.manifest))
        self.assertEqual(report["parameters"]["top"], 5)

    def test_an_existing_queue_is_never_overwritten(self):
        self.output.write_text("earlier queue", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            self.build()
        self.assertEqual(self.output.read_text(encoding="utf-8"), "earlier queue")


class RealArchitecture(unittest.TestCase):
    def test_embedding_comes_from_the_deepest_encoder_features(self):
        from common import build_model
        model = build_model().eval()                       # random weights; only the shapes matter here
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "v.nii.gz"
        nib.save(nib.Nifti1Image(np.random.default_rng(1).random((32, 32, 1)).astype(np.float32), np.eye(4)), str(path))
        scored = review_queue.score_volume(model, path)
        self.assertEqual(scored["embedding"].shape, (model.encoder.feature_info.channels()[-1],))
        self.assertAlmostEqual(float(np.linalg.norm(scored["embedding"])), 1.0, places=5)


if __name__ == "__main__":
    unittest.main()
