import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import nibabel as nib
import numpy as np

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import holdout  # noqa: E402
import versions  # noqa: E402
from common import sha256_file  # noqa: E402

SERVICE_API = TOOLS.parent / "visheart-inference-gpu" / "app" / "helpers" / "unet_inference_api.py"


class Versions(unittest.TestCase):
    def setUp(self):
        # The weights below are a few bytes, not a model; the real strict-load check has its own test.
        self.strict_load = versions.verify_loadable
        versions.verify_loadable = lambda path: None
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.folder = self.dir / "versions"
        self.registry = self.folder / "registry.json"
        self.models = self.dir / "models"
        self.models.mkdir()
        self.original = self.models / "unet.pth"
        self.original.write_bytes(b"original weights")
        self.original_sha = sha256_file(self.original)
        self.slot = self.models / "active" / "unet.pth"
        self.counts = {"acdc": 2, "mms1": 3}
        datasets = {}
        for name, count in self.counts.items():
            images, masks = self.dir / name / "images", self.dir / name / "masks"
            images.mkdir(parents=True)
            masks.mkdir(parents=True)
            for index in range(count):
                volume = np.full((4, 4, 1), index, dtype=np.float32)
                nib.save(nib.Nifti1Image(volume, np.eye(4)), str(images / f"c{index}.nii.gz"))
                nib.save(nib.Nifti1Image(volume.astype(np.uint8), np.eye(4)), str(masks / f"c{index}_gt.nii.gz"))
            datasets[name] = (images, masks)
        self.manifest = self.dir / "frozen.json"
        holdout.create(self.manifest, datasets)
        self.assertEqual(self.cli("init", "--label", "orig", "--original", str(self.original),
                                  "--active-slot", str(self.slot)), 0)

    def tearDown(self):
        versions.verify_loadable = self.strict_load
        self.tmp.cleanup()

    # helpers ---------------------------------------------------------------------------------------------

    def cli(self, command, *argv):
        with contextlib.redirect_stdout(io.StringIO()):
            return versions.main([command, "--registry", str(self.registry), *argv])

    def data(self):
        return json.loads(self.registry.read_text(encoding="utf-8"))

    def add_candidate(self, label, content, base_sha=None):
        weights = self.folder / f"{label}.pth"
        weights.write_bytes(content)
        metadata = {"weights": {"sha256": sha256_file(weights)}, "base_checkpoint": {"sha256": base_sha or self.original_sha}}
        (self.folder / f"{label}.json").write_text(json.dumps(metadata), encoding="utf-8")
        return self.cli("register", "--label", label)

    def write(self, name, report):
        path = self.dir / name
        path.write_text(json.dumps(report), encoding="utf-8")
        return path

    def header(self, candidate, candidate_sha=None):
        data = self.data()
        active = data["active"]
        return {"baseline": active,
                "checkpoints": {active: {"sha256": data["versions"][active]["sha256"]},
                                candidate: {"sha256": candidate_sha or data["versions"][candidate]["sha256"]}}}

    def public_report(self, candidate, low, counts=None, candidate_sha=None):
        rows = {name: {"n": n, "mean_delta_cardiac": low + 0.002, "ci95": [low, low + 0.004],
                       "better": 1, "worse": 1, "tied": 0} for name, n in (counts or self.counts).items()}
        return self.write(f"public-{candidate}.json",
                          {**self.header(candidate, candidate_sha), "comparison": {candidate: rows}})

    def clinical_report(self, candidate, mean, better, worse):
        row = {"n": better + worse, "mean_delta_cardiac": mean, "ci95": [mean - 0.02, mean + 0.02],
               "better": better, "worse": worse, "tied": 0}
        return self.write(f"clinical-{candidate}.json",
                          {**self.header(candidate), "comparison": {candidate: {"clinical": row}}})

    def draw_clinical_arm(self):
        manifest = json.loads(self.manifest.read_text(encoding="utf-8"))
        manifest["clinical"] = {"project_ids": ["p1", "p2", "p3"], "seed": 20260914, "fraction": 0.3}
        self.manifest.write_text(json.dumps(manifest), encoding="utf-8")

    def compare(self, candidate, public, clinical=None):
        argv = ["--label", candidate, "--public-report", str(public), "--manifest", str(self.manifest)]
        return self.cli("compare", *argv, *(["--clinical-report", str(clinical)] if clinical else []))

    def clean(self, candidate, content):
        """Registered and compared against the active version, with nothing to warn about."""
        self.add_candidate(candidate, content)
        return self.compare(candidate, self.public_report(candidate, low=-0.004))

    def gate(self, label):
        return self.data()["versions"][label]["gate"]

    # init and register ------------------------------------------------------------------------------------

    def test_init_registers_the_original_and_leaves_it_untouched(self):
        data = self.data()
        self.assertEqual((data["original"], data["active"]), ("orig", "orig"))
        self.assertEqual(sha256_file(self.folder / "orig.pth"), self.original_sha)
        self.assertEqual(sha256_file(self.original), self.original_sha)
        self.assertFalse(self.slot.exists())
        with self.assertRaises(SystemExit):
            self.cli("init", "--label", "again", "--original", str(self.original), "--active-slot", str(self.slot))

    def test_init_refuses_an_unregistered_file_in_the_active_slot(self):
        self.registry.unlink()
        self.slot.parent.mkdir()
        self.slot.write_bytes(b"left over")
        with self.assertRaises(SystemExit):
            self.cli("init", "--label", "orig", "--original", str(self.original), "--active-slot", str(self.slot))

    def test_a_file_that_is_not_a_loadable_checkpoint_is_refused(self):
        garbage = self.dir / "garbage.pth"
        garbage.write_bytes(b"not a checkpoint")
        with self.assertRaises(SystemExit):
            self.strict_load(garbage)  # the real check, which builds UNet2D and loads strictly

    def test_register_runs_the_strict_load_check(self):
        checked = []
        versions.verify_loadable = checked.append
        self.add_candidate("cand", b"candidate weights")
        self.assertEqual([Path(path).name for path in checked], ["cand.pth"])

    def test_register_refuses_weights_that_do_not_match_their_metadata(self):
        (self.folder / "bad.pth").write_bytes(b"weights")
        (self.folder / "bad.json").write_text(json.dumps(
            {"weights": {"sha256": "0" * 64}, "base_checkpoint": {"sha256": self.original_sha}}), encoding="utf-8")
        with self.assertRaises(SystemExit):
            self.cli("register", "--label", "bad")

    def test_register_refuses_an_unregistered_base(self):
        with self.assertRaises(SystemExit):
            self.add_candidate("orphan", b"orphan weights", base_sha="f" * 64)

    # compare: warnings, never blocks ------------------------------------------------------------------------

    def test_a_decrease_inside_the_margin_gives_no_warning_and_notes_the_missing_clinical_arm(self):
        self.assertEqual(self.clean("cand", b"candidate weights"), 0)
        gate = self.gate("cand")
        self.assertEqual(gate["warnings"], [])
        self.assertEqual(gate["against"], "orig")
        self.assertIn("not measured", " ".join(gate["notes"]))

    def test_a_lower_score_is_a_warning_not_a_block(self):
        self.add_candidate("cand", b"candidate weights")
        self.assertEqual(self.compare("cand", self.public_report("cand", low=-0.006)), 0)
        self.assertIn("lower", " ".join(self.gate("cand")["warnings"]))

    def test_a_partly_scored_public_arm_is_a_warning(self):
        self.add_candidate("cand", b"candidate weights")
        self.compare("cand", self.public_report("cand", low=0.0, counts={"acdc": 2, "mms1": 1}))
        self.assertIn("mms1", " ".join(self.gate("cand")["warnings"]))

    def test_no_clinical_improvement_is_a_warning(self):
        self.add_candidate("cand", b"candidate weights")
        self.draw_clinical_arm()
        self.compare("cand", self.public_report("cand", low=0.0), self.clinical_report("cand", 0.01, 1, 3))
        self.assertIn("clinical", " ".join(self.gate("cand")["warnings"]))

    def test_a_report_scored_from_another_file_is_refused(self):
        self.add_candidate("cand", b"candidate weights")
        with self.assertRaises(SystemExit):
            self.compare("cand", self.public_report("cand", low=0.0, candidate_sha="e" * 64))

    # activate: the original is never written ---------------------------------------------------------------

    def test_a_clean_candidate_activates_into_the_slot_without_touching_the_original(self):
        self.clean("cand", b"candidate weights")
        self.assertEqual(self.cli("activate", "--label", "cand"), 0)
        self.assertEqual(sha256_file(self.slot), sha256_file(self.folder / "cand.pth"))
        self.assertEqual(sha256_file(self.original), self.original_sha)
        self.assertEqual(self.data()["active"], "cand")

    def test_warnings_need_confirmation_and_are_recorded(self):
        self.add_candidate("cand", b"candidate weights")
        self.compare("cand", self.public_report("cand", low=-0.02))
        with mock.patch("sys.stdin", io.StringIO("no\n")):
            self.assertEqual(self.cli("activate", "--label", "cand"), 1)
        self.assertFalse(self.slot.exists())
        self.assertEqual(self.cli("activate", "--label", "cand", "--yes"), 0)
        last = self.data()["history"][-1]
        self.assertEqual(last["action"], "activate")
        self.assertIn("lower", " ".join(last["confirmed_warnings"]))

    def test_typing_yes_confirms(self):
        self.add_candidate("cand", b"candidate weights")
        with mock.patch("sys.stdin", io.StringIO("yes\n")):
            self.assertEqual(self.cli("activate", "--label", "cand"), 0)
        self.assertIn("never compared", " ".join(self.data()["history"][-1]["confirmed_warnings"]))

    def test_a_comparison_against_another_version_is_a_warning(self):
        self.clean("first", b"first weights")
        self.clean("second", b"second weights")               # both compared against orig
        self.assertEqual(self.cli("activate", "--label", "first"), 0)
        self.assertEqual(self.cli("activate", "--label", "second"), 1)   # stale comparison, and first would be deleted
        self.assertEqual(self.cli("activate", "--label", "second", "--yes"), 0)
        history = self.data()["history"]
        activation = [h for h in history if h["action"] == "activate"][-1]
        self.assertIn("compared against orig", " ".join(activation["confirmed_warnings"]))
        self.assertEqual((history[-1]["action"], history[-1]["label"]), ("delete", "first"))  # the replaced version

    def test_choosing_a_new_version_deletes_the_one_it_replaces(self):
        self.clean("a", b"a weights")
        self.cli("activate", "--label", "a")
        self.add_candidate("b", b"b weights", base_sha=sha256_file(self.folder / "a.pth"))
        self.compare("b", self.public_report("b", low=0.0))
        self.assertEqual(self.cli("activate", "--label", "b", "--yes"), 0)
        self.assertFalse((self.folder / "a.pth").exists())
        self.assertFalse((self.folder / "a.json").exists())
        self.assertEqual(self.data()["versions"]["a"]["status"], "deleted")
        self.assertEqual(sha256_file(self.slot), sha256_file(self.folder / "b.pth"))
        self.assertEqual(sha256_file(self.original), self.original_sha)
        self.assertEqual(self.cli("activate", "--label", "a", "--yes"), 1)  # a deleted version cannot come back

    def test_rollback_returns_to_the_original_and_deletes_the_trained_version(self):
        self.clean("cand", b"candidate weights")
        self.cli("activate", "--label", "cand")
        self.assertEqual(self.cli("rollback"), 1)                           # deleting cand needs confirmation
        self.assertTrue(self.slot.exists())
        self.assertEqual(self.cli("rollback", "--yes"), 0)
        self.assertFalse(self.slot.exists())
        self.assertEqual(self.data()["active"], "orig")
        self.assertFalse((self.folder / "cand.pth").exists())
        self.assertTrue((self.folder / "orig.pth").exists())
        self.assertEqual(sha256_file(self.original), self.original_sha)
        self.assertEqual(self.cli("rollback", "--yes"), 1)                  # already on the original

    def test_a_changed_original_file_blocks_every_switch(self):
        self.clean("cand", b"candidate weights")
        self.original.write_bytes(b"overwritten by hand")
        self.assertEqual(self.cli("activate", "--label", "cand", "--yes"), 1)
        self.assertFalse(self.slot.exists())

    def test_a_hand_placed_slot_file_blocks_activation(self):
        self.clean("cand", b"candidate weights")
        self.slot.parent.mkdir()
        self.slot.write_bytes(b"dropped in by hand")
        self.assertEqual(self.cli("activate", "--label", "cand", "--yes"), 1)
        self.assertEqual(self.slot.read_bytes(), b"dropped in by hand")

    # reject and prune ------------------------------------------------------------------------------------

    def test_reject_deletes_a_candidate_but_never_the_original_or_active(self):
        self.clean("cand", b"candidate weights")
        self.assertEqual(self.cli("reject", "--label", "cand"), 0)
        self.assertFalse((self.folder / "cand.pth").exists())
        self.assertEqual(self.data()["versions"]["cand"]["status"], "deleted")
        with self.assertRaises(SystemExit):
            self.cli("reject", "--label", "orig")

    def test_prune_lists_first_and_keeps_original_and_active(self):
        for label, content in (("a", b"a weights"), ("b", b"b weights"), ("c", b"c weights")):
            self.clean(label, content)
        self.assertEqual(self.cli("activate", "--label", "a"), 0)
        self.assertEqual(self.cli("prune"), 0)
        self.assertTrue((self.folder / "b.pth").exists())
        self.assertEqual(self.cli("prune", "--yes"), 0)
        self.assertFalse((self.folder / "b.pth").exists())
        self.assertFalse((self.folder / "c.json").exists())
        self.assertTrue((self.folder / "orig.pth").exists())
        self.assertTrue((self.folder / "a.pth").exists())
        self.assertEqual(self.data()["versions"]["b"]["status"], "deleted")


class ServingRule(unittest.TestCase):
    """The inference service's own rule, which versions.py relies on: active slot if present, else the original."""

    def setUp(self):
        spec = importlib.util.spec_from_file_location("unet_inference_api", SERVICE_API)
        self.api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.api)
        self.tmp = tempfile.TemporaryDirectory()
        self.models = Path(self.tmp.name)
        (self.models / "unet.pth").write_bytes(b"original")

    def tearDown(self):
        self.tmp.cleanup()

    def resolve(self, explicit=None, env=""):
        with mock.patch.dict(os.environ, {"UNET_CHECKPOINT_PATH": env}):
            return Path(self.api.resolve_checkpoint_path(explicit, models_dir=str(self.models)))

    def test_without_an_active_slot_the_original_serves(self):
        self.assertEqual(self.resolve(), self.models / "unet.pth")

    def test_an_active_slot_serves_when_present(self):
        (self.models / "active").mkdir()
        (self.models / "active" / "unet.pth").write_bytes(b"retrained")
        self.assertEqual(self.resolve(), self.models / "active" / "unet.pth")

    def test_an_explicit_path_or_the_environment_still_wins(self):
        (self.models / "active").mkdir()
        (self.models / "active" / "unet.pth").write_bytes(b"retrained")
        self.assertEqual(self.resolve(env="/env/unet.pth"), Path("/env/unet.pth"))
        self.assertEqual(self.resolve(explicit="/call/unet.pth", env="/env/unet.pth"), Path("/call/unet.pth"))


if __name__ == "__main__":
    unittest.main()
