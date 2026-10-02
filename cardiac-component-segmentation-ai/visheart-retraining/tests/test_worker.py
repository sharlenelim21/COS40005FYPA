import contextlib
import http.client
import io
import json
import socket
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import jobs  # noqa: E402
import pipeline  # noqa: E402
import versions  # noqa: E402
import worker  # noqa: E402
from common import sha256_file  # noqa: E402


def wait_until(predicate, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


class Worker(unittest.TestCase):
    def setUp(self):
        # The weights below are a few bytes, not a model; the real strict-load check is tested in test_versions.
        self.strict_load = versions.verify_loadable
        versions.verify_loadable = lambda path: None
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        folder = root / "unet" / "versions"
        folder.mkdir(parents=True)
        models = root / "models"
        models.mkdir()
        (models / "unet.pth").write_bytes(b"original weights")
        self.registry = folder / "registry.json"
        self.assertEqual(self.cli("init", "--label", "orig", "--original", str(models / "unet.pth"),
                                  "--active-slot", str(models / "active" / "unet.pth")), 0)
        self.config = pipeline.Config(tools=TOOLS, python=sys.executable, unet_root=root / "unet",
                                      registry=self.registry, frozen_manifest=folder / "frozen_holdout.json",
                                      frozen_index=folder / "frozen_slices.npz", server_dir=root / "server")
        self.release = threading.Event()
        restart = mock.patch.object(pipeline, "restart_gpu", return_value=["visheart-gpu-nvidia"])
        self.restart = restart.start()
        self.addCleanup(restart.stop)
        self.apps = []

    def tearDown(self):
        self.release.set()
        for app in self.apps:
            if app.runner.thread is not None:
                app.runner.thread.join(timeout=30)
        versions.verify_loadable = self.strict_load
        self.tmp.cleanup()

    def cli(self, command, *argv):
        with contextlib.redirect_stdout(io.StringIO()):
            return versions.main([command, "--registry", str(self.registry), *argv])

    def make_app(self, steps=None, simulate=False):
        app = worker.WorkerApp(self.config, simulate=simulate, plan=(lambda job: steps) if steps is not None else None)
        self.apps.append(app)
        return app

    def waiting(self):
        return [jobs.Step("train", "Training", lambda ctx: self.release.wait(10))]

    def registry_data(self):
        return json.loads(self.registry.read_text(encoding="utf-8"))

    def add_candidate(self, label, content, warn):
        """Register a candidate and give it a comparison against the active version, with or without a warning."""
        folder = self.registry.parent
        weights = folder / f"{label}.pth"
        weights.write_bytes(content)
        data = self.registry_data()
        (folder / f"{label}.json").write_text(json.dumps(
            {"weights": {"sha256": sha256_file(weights)},
             "base_checkpoint": {"sha256": data["versions"][data["active"]]["sha256"]},
             "recipe": {"name": "test recipe"}}), encoding="utf-8")
        self.assertEqual(self.cli("register", "--label", label), 0)
        data = self.registry_data()
        data["versions"][label]["gate"] = {"checked_at": jobs.now(), "against": data["active"], "public": {},
                                           "clinical": {"present": False}, "notes": ["no clinical arm"],
                                           "warnings": ["public acdc: lower score"] if warn else []}
        self.registry.write_text(json.dumps(data), encoding="utf-8")

    # use cases -------------------------------------------------------------------------------------------------

    def test_status_lists_versions_and_allows_training_when_idle(self):
        self.add_candidate("cand", b"candidate weights", warn=True)
        status = self.make_app().status()
        self.assertEqual((status["original"], status["active"], status["busy"]), ("orig", "orig", False))
        self.assertEqual(status["training"], {"allowed": True, "reason": None})
        cand = next(v for v in status["versions"] if v["label"] == "cand")
        self.assertEqual((cand["status"], cand["recipe"], cand["gate"]["warnings"]),
                         ("candidate", "test recipe", ["public acdc: lower score"]))
        self.assertIsNone(status["job"])

    def test_a_second_training_is_refused_and_every_reader_sees_why(self):
        app = self.make_app(self.waiting())
        job = app.start_training("dr-lee")
        self.assertTrue(job["params"]["label"].startswith("unet-ui"))
        with self.assertRaises(jobs.JobError) as refused:
            app.start_training("dr-tan")
        self.assertEqual(refused.exception.status, 409)
        status = app.status()                                    # what a refreshed page or a second tab reads
        self.assertEqual((status["busy"], status["training"]["allowed"]), (True, False))
        self.assertIn("dr-lee", status["training"]["reason"])
        self.assertEqual(status["job"]["id"], job["id"])
        self.release.set()
        self.assertTrue(wait_until(lambda: not app.runner.busy()))
        self.assertTrue(app.status()["training"]["allowed"])

    def test_activation_needs_exactly_the_lines_that_were_shown(self):
        self.add_candidate("cand", b"candidate weights", warn=True)
        app = self.make_app()
        preview = app.preview("cand", "activate")
        self.assertEqual((preview["action"], preview["refusal"], preview["confirm"]),
                         ("activate", None, ["public acdc: lower score"]))
        with self.assertRaises(jobs.JobError) as stale:
            app.activate("cand", "dr-lee", [])
        self.assertEqual(stale.exception.status, 409)
        self.assertEqual(self.registry_data()["active"], "orig")
        result = app.activate("cand", "dr-lee", preview["confirm"])
        self.assertEqual((result["active"], result["restarted"], result["restart_error"]),
                         ("cand", ["visheart-gpu-nvidia"], None))
        last = self.registry_data()["history"][-1]
        self.assertEqual((self.registry_data()["active"], last["action"], last["by"]), ("cand", "activate", "dr-lee"))
        self.restart.assert_called_once()

    def test_going_back_to_the_original_confirms_the_deletion_first(self):
        self.add_candidate("cand", b"candidate weights", warn=False)
        app = self.make_app()
        app.activate("cand", "dr-lee", app.preview("cand", "activate")["confirm"])
        back = app.preview("orig", "activate")
        self.assertEqual(back["action"], "rollback")
        self.assertEqual(len(back["confirm"]), 1)
        self.assertIn("cand will be deleted", back["confirm"][0])
        app.activate("orig", "dr-tan", back["confirm"])
        data = self.registry_data()
        self.assertEqual((data["active"], data["versions"]["cand"]["status"]), ("orig", "deleted"))
        self.assertEqual(app.preview("orig", "activate")["refusal"], "orig is already serving")

    def test_versions_cannot_change_while_training_or_in_simulation(self):
        self.add_candidate("cand", b"candidate weights", warn=False)
        app = self.make_app(self.waiting())
        app.start_training("dr-lee")
        with self.assertRaises(jobs.JobError) as busy:
            app.activate("cand", "dr-tan", [])
        self.assertEqual(busy.exception.status, 409)
        self.release.set()
        self.assertTrue(wait_until(lambda: not app.runner.busy()))
        with self.assertRaises(jobs.JobError) as refused:
            self.make_app(simulate=True).activate("cand", "dr-tan", [])
        self.assertEqual(refused.exception.status, 403)
        self.assertEqual(self.registry_data()["active"], "orig")

    def test_reject_needs_its_confirmation_and_never_touches_the_original(self):
        self.add_candidate("cand", b"candidate weights", warn=False)
        app = self.make_app()
        preview = app.preview("cand", "reject")
        self.assertEqual(preview["confirm"], ["cand will be deleted permanently"])
        with self.assertRaises(jobs.JobError):
            app.reject("cand", "dr-lee", [])
        app.reject("cand", "dr-lee", preview["confirm"])
        self.assertEqual(self.registry_data()["versions"]["cand"]["status"], "deleted")
        self.assertIsNotNone(app.preview("orig", "reject")["refusal"])
        with self.assertRaises(jobs.JobError) as unknown:
            app.preview("../registry", "activate")
        self.assertEqual(unknown.exception.status, 404)

    def test_each_users_check_is_kept_apart_and_only_a_fresh_zero_blocks_training(self):
        app = self.make_app()
        empty = {"checked_at": jobs.now(), "projects": 0, "slices": 0, "conflicts": 0, "cases": []}
        with mock.patch.object(pipeline, "check_corrections", return_value=empty) as check:
            eligible = app.check_eligible("u1")
        check.assert_called_once_with(self.config, "u1")
        self.assertEqual((eligible["slices"], eligible["fresh"]), (0, True))
        status = app.status("u1")
        self.assertFalse(status["training"]["allowed"])
        self.assertIn("No corrected slices", status["training"]["reason"])
        self.assertIsNone(app.status("u2")["eligible"])                  # another user's check is never shown
        (self.config.jobs / "eligible-u1.json").write_text(
            json.dumps({**empty, "checked_at": "2026-01-01T00:00:00+00:00"}), encoding="utf-8")
        self.assertTrue(app.status("u1")["training"]["allowed"])    # an old count never blocks: the job checks again

    def test_a_training_takes_only_cases_from_that_users_latest_check(self):
        app = self.make_app(self.waiting())
        cases = [{"maskId": "m1", "projectId": "p1", "projectName": "Patient 012", "model": "unet", "slices": [{}, {}]},
                 {"maskId": "m2", "projectId": "p2", "projectName": "Patient 007", "model": "medsam", "slices": [{}]},
                 {"maskId": "m3", "projectId": "p3", "projectName": "patient108_4d", "model": "unet", "slices": [{}],
                  "frozen": {"frame": 0, "slice": 0, "frozen": "acdc/patient108_frame01.nii.gz#z0"}}]
        checked = {"checked_at": jobs.now(), "projects": 2, "slices": 3, "conflicts": 0, "cases": cases}
        with mock.patch.object(pipeline, "check_corrections", return_value=checked):
            app.check_eligible("u1")
        for owner, selection, status in (("u1", [], 400), ("u2", ["m1"], 409), ("u1", ["m1", "m9"], 409),
                                         ("u1", ["m2", "m3"], 409)):   # m3 is a frozen test patient: it never trains
            with self.assertRaises(jobs.JobError) as refused:
                app.start_training("dr-lee", owner, selection)
            self.assertEqual(refused.exception.status, status)
        self.assertIn("is a test scan", str(refused.exception))
        job = app.start_training("dr-lee", "u1", ["m2", "m2"])
        self.assertEqual((job["params"]["owner"], job["params"]["selection"]), ("u1", ["m2"]))
        self.assertEqual(job["params"]["cases"], [{"maskId": "m2", "projectId": "p2", "projectName": "Patient 007",
                                                   "model": "medsam", "slices": 1}])

    def test_results_show_each_structure_from_the_report_that_scored_both_files(self):
        self.add_candidate("cand", b"candidate weights", warn=True)
        data = self.registry_data()
        manifest = {"public": {"acdc": {"images": "A", "masks": "a", "image_files": {"c1": "h", "c2": "h"}}},
                    "clinical": None}
        self.config.frozen_manifest.write_text(json.dumps(manifest), encoding="utf-8")

        def score(value):
            return {"background": 0.99, "rv": value, "myocardium": value, "lv_cavity": value}
        report = {"checkpoints": {"orig": {"sha256": data["versions"]["orig"]["sha256"]},
                                  "cand": {"sha256": data["versions"]["cand"]["sha256"]}},
                  "datasets": {"acdc": {"images": "A", "masks": "a"}},
                  "scores": {"orig": {"acdc": {"c1": score(0.8), "c2": score(0.9)}},
                             "cand": {"acdc": {"c1": score(0.7), "c2": score(0.9)}}}}
        self.config.evaluations.mkdir(parents=True)
        (self.config.evaluations / "cand-public.json").write_text(json.dumps(report), encoding="utf-8")
        results = self.make_app().results("cand")
        self.assertEqual((results["against"], results["report"]),
                         ("orig", str(self.config.evaluations / "cand-public.json")))
        acdc = results["datasets"]["acdc"]
        self.assertEqual(acdc["n"], 2)
        self.assertAlmostEqual(acdc["against"]["rv"], 0.85)
        self.assertAlmostEqual(acdc["label"]["rv"], 0.8)
        self.assertEqual((results["gate"]["warnings"], results["examples"]), (["public acdc: lower score"], None))
        self.assertIsNone(self.make_app().results("orig")["datasets"])     # the original is compared with nothing

    def test_an_example_scan_is_served_with_its_images(self):
        self.add_candidate("cand", b"candidate weights", warn=False)
        folder = self.config.examples / "cand"
        (folder / "0").mkdir(parents=True)
        for name in ("image_0", "truth_0", "against_0", "label_0"):
            (folder / "0" / f"{name}.png").write_bytes(b"\x89PNG " + name.encode("ascii"))
        (folder / "index.json").write_text(json.dumps({"label": "cand", "against": "orig", "size": 256, "examples": [
            {"n": 0, "dataset": "acdc", "case": "c1.nii.gz", "role": "lowest", "delta": -0.1, "scores": {},
             "slices": 1}]}), encoding="utf-8")
        app = self.make_app()
        self.assertEqual(app.results("cand")["examples"]["examples"][0]["case"], "c1.nii.gz")
        example = app.example("cand", 0)
        self.assertEqual((example["case"], example["count"], example["size"], len(example["slices"])),
                         ("c1.nii.gz", 1, 256, 1))
        self.assertTrue(example["slices"][0]["right"].startswith("data:image/png;base64,"))
        with self.assertRaises(jobs.JobError) as missing:
            app.example("cand", 5)
        self.assertEqual(missing.exception.status, 404)

    def test_the_example_scans_can_be_compared_with_another_version_that_still_exists(self):
        self.add_candidate("cand", b"candidate weights", warn=False)
        self.add_candidate("older", b"older weights", warn=False)
        self.add_candidate("gone", b"gone weights", warn=False)
        data = self.registry_data()
        data["versions"]["gone"]["status"] = "deleted"
        self.registry.write_text(json.dumps(data), encoding="utf-8")
        folder = self.config.examples / "cand"
        (folder / "0").mkdir(parents=True)
        for name in ("image_0", "truth_0", "against_0", "label_0"):
            (folder / "0" / f"{name}.png").write_bytes(b"\x89PNG " + name.encode("ascii"))
        (folder / "index.json").write_text(json.dumps({"label": "cand", "against": "orig", "size": 256, "examples": [
            {"n": 0, "dataset": "acdc", "case": "c1.nii.gz", "role": "lowest", "delta": -0.1, "scores": {},
             "slices": 1}]}), encoding="utf-8")
        app = self.make_app()
        renders = []

        def fake_render(config, label, against, out):
            renders.append((label, against))
            (out / "0").mkdir(parents=True)
            (out / "0" / "against_0.png").write_bytes(b"\x89PNG older")
            sha = json.loads(self.registry.read_text(encoding="utf-8"))["versions"][against]["sha256"]
            (out / "index.json").write_text(json.dumps({"label": label, "against": against, "sha256": sha}),
                                            encoding="utf-8")

        with mock.patch.object(worker, "render_comparison", side_effect=fake_render):
            self.assertEqual(app.compare_examples("cand", "orig")["rendered"], False)   # the one it was compared with
            self.assertEqual(app.compare_examples("cand", "cand")["rendered"], False)   # its own: made in training
            for other, status in (("gone", 409), ("nobody", 404)):
                with self.assertRaises(jobs.JobError) as refused:
                    app.compare_examples("cand", other)
                self.assertEqual(refused.exception.status, status)
            with self.assertRaises(jobs.JobError) as early:
                app.example("cand", 0, left="older")                                    # not prepared yet
            self.assertEqual(early.exception.status, 409)
            self.assertEqual(app.compare_examples("cand", "older")["rendered"], True)
            self.assertEqual(app.compare_examples("cand", "older")["rendered"], False)  # kept: done once
        self.assertEqual(renders, [("cand", "older")])
        import base64

        def shows(scan, side):
            return base64.b64decode(scan["slices"][0][side].split(",")[1])
        default = app.example("cand", 0)                     # as trained: the version it was compared with, and itself
        self.assertEqual((default["left_label"], default["right_label"]), ("orig", "cand"))
        self.assertEqual((shows(default, "left"), shows(default, "right")), (b"\x89PNG against_0", b"\x89PNG label_0"))
        # The model in use on the left, any other version on the right: either side can be any prepared version.
        for left, right, pictures in (("older", "cand", (b"\x89PNG older", b"\x89PNG label_0")),
                                      ("cand", "older", (b"\x89PNG label_0", b"\x89PNG older")),
                                      ("orig", "older", (b"\x89PNG against_0", b"\x89PNG older"))):
            shown = app.example("cand", 0, left=left, right=right)
            self.assertEqual((shown["left_label"], shown["right_label"]), (left, right))
            self.assertEqual((shows(shown, "left"), shows(shown, "right")), pictures)
            self.assertEqual(base64.b64decode(shown["slices"][0]["truth"].split(",")[1]), b"\x89PNG truth_0")
        for left, right, status in (("older", "older", 400), ("cand", None, 400), ("nobody", "cand", 404)):
            with self.assertRaises(jobs.JobError) as refused:
                app.example("cand", 0, left=left, right=right)    # never the same version on both sides
            self.assertEqual(refused.exception.status, status)

    def test_a_job_cut_off_by_a_stopped_worker_is_reported_when_it_starts_again(self):
        store = jobs.JobStore(self.config.jobs)
        job = jobs.new_job("train", "dr-lee", {"label": "unet-ui0925-120000"})
        job.update(state="running", steps=[{"key": "train", "title": "Training", "state": "running",
                                             "started_at": None, "finished_at": None}])
        store.save(job)
        app = self.make_app()
        self.assertEqual(app.interrupted, [job["id"]])
        status = app.status()
        self.assertEqual((status["job"]["state"], status["busy"]), ("interrupted", False))
        self.assertIn("stopped", status["job"]["error"])

    # the HTTP service ------------------------------------------------------------------------------------------

    def serve(self, app):
        server = worker.make_server(app, "127.0.0.1", 0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server.server_address[1]

    def request(self, port, method, path, body=None, host=None, content_type="application/json"):
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        headers = {"Host": host or f"127.0.0.1:{port}"}
        payload = None
        if body is not None:
            payload = json.dumps(body).encode("utf-8") if isinstance(body, dict) else body
            headers["Content-Type"] = content_type
        connection.request(method, path, body=payload, headers=headers)
        response = connection.getresponse()
        data = json.loads(response.read())
        connection.close()
        return response.status, data

    def test_the_example_route_passes_both_sides(self):
        self.add_candidate("cand", b"candidate weights", warn=False)
        folder = self.config.examples / "cand"
        (folder / "0").mkdir(parents=True)
        for name in ("image_0", "truth_0", "against_0", "label_0"):
            (folder / "0" / f"{name}.png").write_bytes(b"\x89PNG " + name.encode("ascii"))
        (folder / "index.json").write_text(json.dumps({"label": "cand", "against": "orig", "size": 256, "examples": [
            {"n": 0, "dataset": "acdc", "case": "c1.nii.gz", "role": "lowest", "delta": -0.1, "scores": {},
             "slices": 1}]}), encoding="utf-8")
        port = self.serve(self.make_app())
        status, reply = self.request(port, "GET", "/versions/cand/examples/0?left=cand&right=orig")
        self.assertEqual((status, reply["data"]["left_label"], reply["data"]["right_label"]), (200, "cand", "orig"))
        status, reply = self.request(port, "GET", "/versions/cand/examples/0?left=orig&right=orig")
        self.assertEqual(status, 400)

    def test_the_service_answers_only_requests_addressed_to_this_computer(self):
        port = self.serve(self.make_app())
        self.assertEqual(self.request(port, "GET", "/status")[0], 200)
        self.assertEqual(self.request(port, "GET", "/status", host=f"host.docker.internal:{port}")[0], 200)
        self.assertEqual(self.request(port, "GET", "/status", host="evil.example:80")[0], 403)
        status, body = self.request(port, "POST", "/jobs/train", body=b"requestedBy=x",
                                    content_type="application/x-www-form-urlencoded")
        self.assertEqual((status, body["ok"]), (415, False))
        self.assertEqual(self.request(port, "GET", "/no/such/endpoint")[0], 404)
        self.assertEqual(self.request(port, "GET", "/versions/..%2Fregistry/preview")[0], 404)
        self.assertEqual(self.request(port, "GET", "/status?owner=..%2Fjobs")[0], 400)   # a user id is a safe name
        status, body = self.request(port, "POST", "/jobs/train", body={})        # no requestedBy: nothing starts
        self.assertEqual((status, body["ok"]), (400, False))

    def test_check_running_reports_whether_a_worker_answers(self):
        port = self.serve(self.make_app())
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(worker.main(["--check-running", "--port", str(port)]), 0)
        self.assertIn("running", out.getvalue())
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            free = probe.getsockname()[1]
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.assertEqual(worker.main(["--check-running", "--port", str(free)]), 1)
        self.assertIn("not running", out.getvalue())


class Termination(unittest.TestCase):
    def test_a_stop_signal_ends_a_running_jobs_commands_before_the_worker_exits(self):
        calls = []
        context = mock.Mock(kill=lambda: calls.append("kill job"))
        app = mock.Mock(runner=mock.Mock(context=context), log_event=lambda line: calls.append("log"))
        worker.terminate(app, exit=lambda code: calls.append(f"exit {code}"))
        self.assertEqual(calls, ["log", "kill job", "exit 0"])
        calls.clear()
        worker.terminate(mock.Mock(runner=mock.Mock(context=None), log_event=lambda line: calls.append("log")),
                         exit=lambda code: calls.append(f"exit {code}"))
        self.assertEqual(calls, ["log", "exit 0"])



class ExtraAddress(unittest.TestCase):
    """On Linux, containers reach the host through the Docker bridge, not 127.0.0.1 (plan linux-and-cpu-support)."""

    def test_the_worker_also_serves_a_named_address_and_logs_one_it_cannot_use(self):
        import os
        import subprocess
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        with tempfile.TemporaryDirectory() as root:
            env = {**os.environ, "VISHEART_UNET_ROOT": root, "PYTHONDONTWRITEBYTECODE": "1"}
            command = [sys.executable, str(Path(worker.__file__)), "--port", str(port), "--simulate",
                       "--also-listen", "127.0.0.2", "--also-listen", "203.0.113.7"]
            process = subprocess.Popen(command, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                def answers(address, host):
                    try:
                        connection = http.client.HTTPConnection(address, port, timeout=2)
                        connection.request("GET", "/health", headers={"Host": host})
                        return connection.getresponse().status == 200
                    except OSError:
                        return False
                self.assertTrue(wait_until(lambda: answers("127.0.0.1", f"127.0.0.1:{port}")))
                self.assertTrue(wait_until(lambda: answers("127.0.0.2", f"host.docker.internal:{port}")))
                log = (Path(root) / "jobs" / "worker.log").read_text(encoding="utf-8")
                self.assertIn("could not also listen on 203.0.113.7", log)
            finally:
                subprocess.run(command[:2] + ["--port", str(port), "--stop", "--force"], env=env, capture_output=True)
                process.wait(timeout=20)


if __name__ == "__main__":
    unittest.main()
