import json
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import jobs  # noqa: E402
import pipeline  # noqa: E402
from common import sha256_file  # noqa: E402

LABEL = "unet-ui0925-120000"


class FakeContext:
    """Records commands instead of running them; each effect stands in for what the real command leaves behind."""

    def __init__(self, effects=()):
        self.effects, self.commands = list(effects), []
        self.progress, self.fields, self.values, self.logged = {}, {}, {}, []
        self.cancellable = True

    def run_command(self, command, on_line=None, failure=None, cwd=None):
        command = [str(part) for part in command]
        self.commands.append(command)
        for matches, effect in self.effects:
            if matches(command):
                effect(command, on_line)
        return 0

    def update(self, **fields):
        self.progress.update(fields)

    def record(self, **fields):
        self.fields.update(fields)

    def log(self, line):
        self.logged.append(line)

    def check_cancelled(self):
        pass


class Pipeline(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        versions_dir = root / "unet" / "versions"
        self.config = pipeline.Config(tools=TOOLS, python=sys.executable, unet_root=root / "unet",
                                      registry=versions_dir / "registry.json",
                                      frozen_manifest=versions_dir / "frozen_holdout.json",
                                      frozen_index=versions_dir / "frozen_slices.npz", server_dir=root / "server")
        self.config.temp_exports.mkdir(parents=True)
        versions_dir.mkdir(parents=True)

    def tearDown(self):
        self.tmp.cleanup()

    def write_registry(self):
        folder = self.config.versions_dir
        (folder / "orig.pth").write_bytes(b"original weights")
        data = {"schema": 2, "original": "orig", "active": "orig", "original_file": str(folder / "orig.pth"),
                "active_slot": str(self.config.unet_root / "slot" / "unet.pth"), "history": [],
                "versions": {"orig": {"file": "orig.pth", "sha256": sha256_file(folder / "orig.pth"),
                                      "status": "original", "base": None, "gate": None}}}
        self.config.registry.write_text(json.dumps(data), encoding="utf-8")

    def staged(self, command):
        return self.config.temp_exports / command[command.index("--out") + 1].split("/")[-1]

    def dry_run(self, candidates):
        def effect(command, on_line):
            self.staged(command).mkdir(parents=True, exist_ok=True)
            (self.staged(command) / "dry_run.json").write_text(json.dumps(
                {"counts": {"projects": len(candidates), "conflicts": 1}, "candidates": candidates}), encoding="utf-8")
        return (lambda command: "--dry-run" in command), effect

    def real_export(self, slices):
        def effect(command, on_line):
            (self.staged(command) / "images").mkdir(parents=True, exist_ok=True)
            (self.staged(command) / "export_manifest.json").write_text(json.dumps(
                {"counts": {"projects": 2, "slices": slices, "conflicts": 1},
                 "frozen_excluded": [{"projectId": "p9"}]}), encoding="utf-8")
        return (lambda command: "--frozen-slices" in command), effect

    def test_prepare_runs_the_proven_export_commands_and_moves_the_export(self):
        ctx = FakeContext([self.dry_run([{"qualifyingSlices": 3}, {"qualifyingSlices": 4}]), self.real_export(7)])
        pipeline.prepare(self.config, ctx, LABEL)
        self.assertEqual(ctx.commands[0][:3], ["docker", "exec", "visheart-local"])
        self.assertEqual(sum(command[1] == "cp" for command in ctx.commands), 5)
        node = [command for command in ctx.commands if "node" in command]
        self.assertEqual(len(node), 2)
        self.assertIn("--dry-run", node[0])
        self.assertEqual(node[1][node[1].index("--frozen-slices") + 1], "/tmp/retraining/frozen_slices.npz")
        self.assertIn("frozen_guard.py", ctx.commands[-1][1])
        export = self.config.exports / f"export-{LABEL}"
        self.assertEqual(ctx.values["export"], export)
        self.assertTrue((export / "export_manifest.json").exists())
        self.assertFalse((self.config.temp_exports / f"export-{LABEL}").exists())
        self.assertEqual(ctx.progress["corrections"], {"projects": 2, "slices": 7, "conflicts": 1})
        self.assertEqual(ctx.progress["export"]["frozen_excluded"], 1)

    def test_prepare_exports_only_the_chosen_cases_of_their_owner(self):
        seen = {}

        def capture(command, on_line):
            selection = self.config.temp_exports / f"selection-{LABEL}.json"
            seen.setdefault("files", []).append(json.loads(selection.read_text(encoding="utf-8")))
        ctx = FakeContext([((lambda command: "node" in command), capture),
                           self.dry_run([{"qualifyingSlices": 3}]), self.real_export(3)])
        pipeline.prepare(self.config, ctx, LABEL, owner="u1", selection=["m1", "m2"])
        node = [command for command in ctx.commands if "node" in command]
        self.assertEqual(len(node), 2)
        for command in node:                                    # the dry run and the export see the same scope
            self.assertEqual(command[command.index("--owner") + 1], "u1")
            self.assertEqual(command[command.index("--selection") + 1], f"dist/temp_exports/selection-{LABEL}.json")
        self.assertEqual(seen["files"], [{"maskIds": ["m1", "m2"]}] * 2)
        self.assertFalse((self.config.temp_exports / f"selection-{LABEL}.json").exists())

    def test_a_selection_that_no_longer_qualifies_says_so(self):
        ctx = FakeContext([self.dry_run([])])
        with self.assertRaises(jobs.StepFailed) as failed:
            pipeline.prepare(self.config, ctx, LABEL, owner="u1", selection=["m1"])
        self.assertIn("chosen cases", str(failed.exception))
        self.assertFalse((self.config.temp_exports / f"selection-{LABEL}.json").exists())

    def test_nothing_is_exported_when_no_corrected_slice_qualifies(self):
        ctx = FakeContext([self.dry_run([])])
        with self.assertRaises(jobs.StepFailed) as failed:
            pipeline.prepare(self.config, ctx, LABEL)
        self.assertIn("No corrected slices", str(failed.exception))
        self.assertEqual(sum("node" in command for command in ctx.commands), 1)      # the dry run only
        self.assertFalse((self.config.temp_exports / f"export-{LABEL}").exists())

    def test_an_export_emptied_by_the_frozen_guard_stops_before_training(self):
        ctx = FakeContext([self.dry_run([{"qualifyingSlices": 2}]), self.real_export(0)])
        with self.assertRaises(jobs.StepFailed) as failed:
            pipeline.prepare(self.config, ctx, LABEL)
        self.assertIn("left out", str(failed.exception))
        self.assertNotIn("export", ctx.values)

    def test_training_uses_the_d7_recipe_from_the_original_and_reports_real_epochs(self):
        self.write_registry()
        lines = ['{"epoch": 0, "val_loss": 1.2, "val_dice": 0.5}', "replay set: 100 slices",
                 '{"epoch": 1, "train_loss": 0.9, "train_dice": 0.6}', '{"epoch": 2, "train_loss": 0.8, "train_dice": 0.7}']

        def effect(command, on_line):
            for line in lines:
                on_line(line + "\n")
        ctx = FakeContext([((lambda command: command[1].endswith("train_candidate.py")), effect)])
        ctx.values["export"] = self.config.exports / "export-x"
        pipeline.train(self.config, ctx, LABEL)
        command = ctx.commands[0]
        self.assertEqual(command[command.index("--epochs") + 1], "20")
        self.assertEqual(command[command.index("--base-checkpoint") + 1], str(self.config.versions_dir / "orig.pth"))
        self.assertEqual((ctx.progress["epoch"], ctx.progress["epochs"]), (2, 20))

    def test_seed_report_reuses_only_complete_scores_of_the_same_file_and_folders(self):
        folder = self.config.evaluations
        folder.mkdir(parents=True)
        expected = {"acdc": ("A", 2), "mms1": ("M", 1)}
        complete = {"checkpoints": {"orig": {"sha256": "s"}, "other": {"sha256": "x"}},
                    "datasets": {"acdc": {"images": "A", "masks": "a"}, "mms1": {"images": "M", "masks": "m"}},
                    "scores": {"orig": {"acdc": {"c1": {}, "c2": {}}, "mms1": {"c3": {}}}, "other": {"acdc": {}}}}
        variants = {"complete": complete,
                    "partial": {**complete, "scores": {"orig": {"acdc": {"c1": {}}, "mms1": {"c3": {}}}}},
                    "stale": {**complete, "checkpoints": {"orig": {"sha256": "old"}}},
                    "elsewhere": {**complete, "datasets": {"acdc": {"images": "B"}, "mms1": {"images": "M"}}}}
        for name, report in variants.items():
            (folder / f"{name}.json").write_text(json.dumps(report), encoding="utf-8")
        seed = pipeline.seed_report(folder, "orig", "s", expected)
        self.assertEqual(set(seed["checkpoints"]), {"orig"})
        self.assertEqual(seed["scores"]["orig"]["acdc"], {"c1": {}, "c2": {}})
        (folder / "complete.json").unlink()
        self.assertIsNone(pipeline.seed_report(folder, "orig", "s", expected))

    def test_find_report_takes_the_newest_report_that_scored_both_files_completely(self):
        folder = self.config.evaluations
        folder.mkdir(parents=True)
        expected = {"acdc": ("A", 2)}
        full = {"checkpoints": {"old": {"sha256": "o"}, "new": {"sha256": "n"}},
                "datasets": {"acdc": {"images": "A", "masks": "a"}},
                "scores": {"old": {"acdc": {"c1": {}, "c2": {}}}, "new": {"acdc": {"c1": {}, "c2": {}}}}}
        variants = {"full": full,
                    "half": {**full, "scores": {"old": full["scores"]["old"], "new": {"acdc": {"c1": {}}}}},
                    "other": {**full, "checkpoints": {"old": {"sha256": "o"}, "new": {"sha256": "another file"}}}}
        for name, report in variants.items():
            (folder / f"{name}.json").write_text(json.dumps(report), encoding="utf-8")
        (folder / "broken.json").write_text("{", encoding="utf-8")
        path, report = pipeline.find_report(sorted(folder.glob("*.json")), {"old": "o", "new": "n"}, expected)
        self.assertEqual((path.name, report["scores"]["new"]["acdc"]), ("full.json", {"c1": {}, "c2": {}}))
        self.assertIsNone(pipeline.find_report([folder / "half.json", folder / "other.json"],
                                               {"old": "o", "new": "n"}, expected))

    def test_scoring_seeds_the_active_version_then_registers_and_compares(self):
        self.write_registry()
        sha = sha256_file(self.config.versions_dir / "orig.pth")
        manifest = {"public": {"acdc": {"images": "A", "masks": "a", "image_files": {"c1": "h", "c2": "h"}},
                               "mms1": {"images": "M", "masks": "m", "image_files": {"c3": "h"}}}, "clinical": None}
        self.config.frozen_manifest.write_text(json.dumps(manifest), encoding="utf-8")
        self.config.evaluations.mkdir(parents=True)
        (self.config.evaluations / "baseline.json").write_text(json.dumps(
            {"checkpoints": {"orig": {"sha256": sha}},
             "datasets": {"acdc": {"images": "A", "masks": "a"}, "mms1": {"images": "M", "masks": "m"}},
             "scores": {"orig": {"acdc": {"c1": {}, "c2": {}}, "mms1": {"c3": {}}}}}), encoding="utf-8")
        gate = {"against": "orig", "warnings": ["public acdc: lower score"], "notes": ["no clinical arm"], "public": {}}

        def evaluated(command, on_line):
            report = Path(command[command.index("--output") + 1])
            seeded = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(set(seeded["scores"]), {"orig"})                 # the seed, before the candidate
            seeded["scores"][LABEL] = {"acdc": {"c1": {}, "c2": {}}, "mms1": {"c3": {}}}
            report.write_text(json.dumps(seeded), encoding="utf-8")

        def compared(command, on_line):
            data = json.loads(self.config.registry.read_text(encoding="utf-8"))
            data["versions"][LABEL] = {"file": f"{LABEL}.pth", "sha256": "n", "status": "candidate", "base": "orig",
                                       "gate": gate}
            self.config.registry.write_text(json.dumps(data), encoding="utf-8")

        ctx = FakeContext([((lambda command: command[1].endswith("evaluate.py")), evaluated),
                           ((lambda command: command[1].endswith("versions.py") and "compare" in command), compared)])
        pipeline.score_and_compare(self.config, ctx, LABEL)
        evaluate = ctx.commands[0]
        self.assertEqual([evaluate[i + 1] for i, part in enumerate(evaluate) if part == "--checkpoint"], ["orig", LABEL])
        self.assertEqual([evaluate[i + 1] for i, part in enumerate(evaluate) if part == "--dataset"], ["acdc", "mms1"])
        self.assertEqual([command[2] for command in ctx.commands[1:]], ["register", "compare"])
        self.assertFalse(ctx.cancellable)
        self.assertEqual(ctx.fields["result"]["warnings"], ["public acdc: lower score"])
        self.assertEqual((ctx.progress["scored"], ctx.progress["total"], ctx.progress["scoring_active_first"]), (3, 3, False))
        self.assertEqual(ctx.values["report"], self.config.evaluations / f"{LABEL}-public.json")

    def test_the_correction_check_lists_the_owners_cases_and_leaves_nothing_behind(self):
        commands = []

        def fake_run(command, timeout=170):
            commands.append([str(part) for part in command])
            if "node" not in command:
                return ""
            staged = self.staged(command)
            staged.mkdir(parents=True)
            (staged / "dry_run.json").write_text(json.dumps(
                {"counts": {"projects": 2, "conflicts": 0},
                 "candidates": [{"qualifyingSlices": 4}, {"qualifyingSlices": 6}],
                 "cases": [{"maskId": "m1"}, {"maskId": "m2"}]}), encoding="utf-8")
            return ""
        result = pipeline.check_corrections(self.config, "u1", run=fake_run)
        self.assertEqual((result["projects"], result["slices"], result["conflicts"]), (2, 10, 0))
        self.assertEqual([case["maskId"] for case in result["cases"]], ["m1", "m2"])
        # The builder and the frozen-set index go into the container first, so the check can lock frozen patients.
        self.assertEqual(sum(command[1] == "cp" for command in commands), 5)
        dry = next(command for command in commands if "node" in command)
        self.assertEqual(dry[dry.index("--owner") + 1], "u1")
        self.assertIn("--dry-run", dry)
        self.assertEqual(dry[dry.index("--builder") + 1], "/tmp/retraining/build_training_volumes.py")
        self.assertEqual(dry[dry.index("--frozen-slices") + 1], "/tmp/retraining/frozen_slices.npz")
        self.assertEqual(list(self.config.temp_exports.iterdir()), [])

    def test_example_scans_are_rendered_after_the_comparison_but_never_fail_the_job(self):
        report = self.config.evaluations / f"{LABEL}-public.json"
        progress = ((lambda command: command[1].endswith("render_examples.py")),
                    lambda command, on_line: on_line('{"example": 2, "of": 9}\n'))
        ctx = FakeContext([progress])
        ctx.values["report"] = report
        pipeline.render_examples_step(self.config, ctx, LABEL)
        command = ctx.commands[0]
        self.assertEqual(command[command.index("--report") + 1], str(report))
        self.assertEqual(command[command.index("--out") + 1], str(self.config.examples / LABEL))
        self.assertEqual(ctx.progress["examples"], {"done": 2, "total": 9, "ready": True})
        self.assertFalse(ctx.cancellable)

        def fail(command, on_line):
            raise jobs.StepFailed("no report")
        ctx = FakeContext([((lambda command: command[1].endswith("render_examples.py")), fail)])
        ctx.values["report"] = report
        pipeline.render_examples_step(self.config, ctx, LABEL)          # returns: the comparison is complete
        self.assertEqual((ctx.progress["examples"]["ready"], ctx.progress["examples"]["error"]), (False, "no report"))

    def test_only_running_gpu_containers_are_restarted(self):
        calls = []

        def fake_run(command, timeout=170):
            calls.append(command)
            return "visheart-local\nvisheart-gpu-nvidia\nvisheart-mongodb\n" if command[1] == "ps" else ""
        self.assertEqual(pipeline.restart_gpu(self.config, run=fake_run), ["visheart-gpu-nvidia"])
        self.assertEqual(calls[-1], ["docker", "restart", "visheart-gpu-nvidia"])

    def test_simulated_steps_mirror_the_real_ones(self):
        job = {"params": {"label": LABEL}}
        steps = pipeline.simulated_steps(self.config, job, seconds_per_epoch=0)
        real = pipeline.training_steps(self.config, job)
        self.assertEqual([(s.key, s.title) for s in steps], [(s.key, s.title) for s in real])
        self.assertEqual([s.key for s in real], ["prepare", "train", "evaluate", "examples"])


if __name__ == "__main__":
    unittest.main()
