import json
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import holdout  # noqa: E402


class Holdout(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.images, self.masks = self.dir / "images", self.dir / "masks"
        self.images.mkdir()
        self.masks.mkdir()
        (self.images / "a.nii.gz").write_bytes(b"image-a")
        (self.masks / "a_gt.nii.gz").write_bytes(b"mask-a")
        self.manifest = self.dir / "frozen" / "holdout.json"

    def tearDown(self):
        self.tmp.cleanup()

    def make(self, manifest=None):
        return holdout.create(manifest or self.manifest, {"toy": (self.images, self.masks)})

    def write_json(self, name, payload):
        path = self.dir / name
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def ids(self, n):
        return [{"projectId": f"p{i:02d}"} for i in range(n)]

    def test_create_then_verify_passes(self):
        payload = self.make()
        self.assertEqual(list(payload["public"]["toy"]["mask_files"]), ["a_gt.nii.gz"])
        self.assertIsNone(payload["clinical"])
        self.assertEqual(holdout.verify(self.manifest), [])
        self.assertEqual(holdout.main(["verify", "--manifest", str(self.manifest)]), 0)

    def test_cli_create_accepts_windows_style_paths(self):
        other = self.dir / "frozen" / "cli.json"
        self.assertEqual(holdout.main(["create", "--manifest", str(other), "--dataset", "toy",
                                       str(self.images), str(self.masks)]), 0)
        self.assertIn("toy", json.loads(other.read_text(encoding="utf-8"))["public"])

    def test_verify_reports_changed_missing_and_unexpected_files(self):
        self.make()
        (self.images / "a.nii.gz").write_bytes(b"tampered")
        (self.masks / "a_gt.nii.gz").unlink()
        (self.masks / "b_gt.nii.gz").write_bytes(b"new")
        problems = holdout.verify(self.manifest)
        self.assertIn("toy: changed a.nii.gz", problems)
        self.assertIn("toy: missing a_gt.nii.gz", problems)
        self.assertIn("toy: unexpected b_gt.nii.gz", problems)
        self.assertEqual(holdout.main(["verify", "--manifest", str(self.manifest)]), 1)

    def test_create_never_overwrites(self):
        self.make()
        with self.assertRaises(SystemExit):
            self.make()

    def test_clinical_arm_not_drawn_below_the_minimum(self):
        self.make()
        result = holdout.add_clinical(self.manifest, self.write_json("dry.json", {"candidates": self.ids(9)}))
        self.assertFalse(result["drawn"])
        self.assertIsNone(json.loads(self.manifest.read_text(encoding="utf-8"))["clinical"])

    def test_clinical_arm_is_deterministic_and_drawn_once(self):
        self.make()
        candidates = self.write_json("dry.json", {"candidates": self.ids(20)})
        first = holdout.add_clinical(self.manifest, candidates)
        self.assertTrue(first["drawn"])
        self.assertEqual(len(first["project_ids"]), 6)
        with self.assertRaises(SystemExit):
            holdout.add_clinical(self.manifest, candidates)
        other = self.dir / "frozen" / "other.json"
        self.make(other)
        self.assertEqual(holdout.add_clinical(other, candidates)["project_ids"], first["project_ids"])

    def test_projects_already_exported_for_training_are_never_drawn(self):
        self.make()
        candidates = self.write_json("dry.json", {"candidates": self.ids(20)})
        exported = self.write_json("export.json", {"cases": self.ids(8)})
        result = holdout.add_clinical(self.manifest, candidates, [exported])
        self.assertTrue(result["drawn"])
        self.assertEqual((result["eligible"], result["excluded_as_exported"]), (12, 8))
        self.assertTrue(set(result["project_ids"]).isdisjoint({f"p{i:02d}" for i in range(8)}))


if __name__ == "__main__":
    unittest.main()
