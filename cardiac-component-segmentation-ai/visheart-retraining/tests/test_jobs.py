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

PY = sys.executable


def wait_until(predicate, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


class Jobs(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = jobs.JobStore(Path(self.tmp.name) / "jobs")
        self.release = threading.Event()
        self.runner = None

    def tearDown(self):
        self.release.set()
        if self.runner is not None and self.runner.thread is not None:
            self.runner.thread.join(timeout=30)
        self.tmp.cleanup()

    def make_runner(self, steps):
        self.runner = jobs.JobRunner(self.store, lambda job: steps)
        return self.runner

    def finished(self, job_id):
        return wait_until(lambda: self.store.load(job_id)["state"] not in jobs.ACTIVE_STATES)

    def test_a_job_runs_its_steps_in_order_and_saves_every_state(self):
        seen = []
        steps = [jobs.Step("a", "First", lambda ctx: seen.append("a")),
                 jobs.Step("b", "Second", lambda ctx: ctx.run_command([PY, "-c", "print('hello from b')"]))]
        job = self.make_runner(steps).start("train", "dr-lee", {"label": "x"})
        self.assertTrue(self.finished(job["id"]))
        saved = self.store.load(job["id"])
        self.assertEqual((saved["state"], saved["requested_by"]), ("succeeded", "dr-lee"))
        self.assertEqual([s["state"] for s in saved["steps"]], ["done", "done"])
        self.assertIn("hello from b", "\n".join(self.store.tail(job["id"])))
        self.assertEqual(seen, ["a"])

    def test_a_second_job_is_refused_while_one_runs_whatever_asks(self):
        steps = [jobs.Step("wait", "Waiting", lambda ctx: self.release.wait(10))]
        runner = self.make_runner(steps)
        first = runner.start("train", "dr-lee", {})
        with self.assertRaises(jobs.JobError) as refused:
            runner.start("train", "dr-tan", {})
        self.assertEqual(refused.exception.status, 409)
        self.assertIn("dr-lee", str(refused.exception))
        self.assertTrue(runner.busy())
        other = jobs.JobRunner(self.store, lambda job: steps)   # a second reader of the same folder refuses too
        with self.assertRaises(jobs.JobError):
            other.start("train", "dr-tan", {})
        self.release.set()
        self.assertTrue(self.finished(first["id"]))
        self.assertTrue(wait_until(lambda: not runner.busy()))  # the thread ends just after the final save
        second = runner.start("train", "dr-tan", {})             # allowed once the first has finished
        self.assertTrue(self.finished(second["id"]))

    def test_cancel_kills_the_running_command_and_records_who(self):
        script = "import time; print('started', flush=True); time.sleep(60)"
        runner = self.make_runner([jobs.Step("sleep", "Sleeping", lambda ctx: ctx.run_command([PY, "-c", script]))])
        job = runner.start("train", "dr-lee", {})
        self.assertTrue(wait_until(lambda: "started" in "\n".join(self.store.tail(job["id"]))))
        runner.cancel(job["id"], "dr-tan")
        self.assertTrue(self.finished(job["id"]))
        saved = self.store.load(job["id"])
        self.assertEqual((saved["state"], saved["cancel_requested_by"]), ("cancelled", "dr-tan"))
        self.assertEqual(saved["steps"][0]["state"], "cancelled")
        self.assertIn("dr-tan", saved["error"])

    def test_a_failing_command_fails_the_job_with_its_readable_reason(self):
        failing = [PY, "-c", "import sys; sys.exit(3)"]
        steps = [jobs.Step("bad", "Bad", lambda ctx: ctx.run_command(failing, failure="The export failed."))]
        job = self.make_runner(steps).start("train", "dr-lee", {})
        self.assertTrue(self.finished(job["id"]))
        saved = self.store.load(job["id"])
        self.assertEqual((saved["state"], saved["error"], saved["steps"][0]["state"]), ("failed", "The export failed.", "failed"))

    def test_an_unexpected_error_fails_the_job_and_the_runner_carries_on(self):
        def broken(ctx):
            raise ValueError("boom")
        runner = self.make_runner([jobs.Step("x", "X", broken)])
        job = runner.start("train", "dr-lee", {})
        self.assertTrue(self.finished(job["id"]))
        saved = self.store.load(job["id"])
        self.assertEqual(saved["state"], "failed")
        self.assertIn("boom", saved["error"])
        self.assertIn("ValueError", "\n".join(self.store.tail(job["id"])))
        self.assertTrue(wait_until(lambda: not runner.busy()))

    def test_jobs_left_running_by_a_stopped_worker_are_marked_interrupted(self):
        job = jobs.new_job("train", "dr-lee", {})
        job.update(state="running", steps=[{"key": "train", "title": "Training", "state": "running",
                                             "started_at": None, "finished_at": None}])
        self.store.save(job)
        self.assertEqual(self.store.mark_interrupted(), [job["id"]])
        saved = self.store.load(job["id"])
        self.assertEqual((saved["state"], saved["steps"][0]["state"]), ("interrupted", "interrupted"))
        self.assertIn("stopped", saved["error"])
        self.assertIsNone(self.store.active())

    def test_progress_reaches_readers_at_once_and_bad_ids_are_404(self):
        def step(ctx):
            ctx.update(epoch=3, epochs=20)
            self.release.wait(10)
        runner = self.make_runner([jobs.Step("train", "Training", step)])
        job = runner.start("train", "dr-lee", {})
        self.assertTrue(wait_until(lambda: self.store.load(job["id"])["progress"].get("epoch") == 3))
        self.assertEqual(runner.current()["id"], job["id"])
        for bad in ("job-20260101-000000-abcd", "../registry"):
            with self.assertRaises(jobs.JobError) as missing:
                self.store.load(bad)
            self.assertEqual(missing.exception.status, 404)

    def test_a_step_can_refuse_cancellation_near_its_end(self):
        def step(ctx):
            ctx.cancellable = False
            self.release.wait(10)
        runner = self.make_runner([jobs.Step("register", "Registering", step)])
        job = runner.start("train", "dr-lee", {})
        self.assertTrue(wait_until(lambda: runner.context is not None and not runner.context.cancellable))
        with self.assertRaises(jobs.JobError) as refused:
            runner.cancel(job["id"], "dr-tan")
        self.assertEqual(refused.exception.status, 409)
        self.release.set()
        self.assertTrue(self.finished(job["id"]))
        self.assertEqual(self.store.load(job["id"])["state"], "succeeded")

    def test_a_job_file_briefly_locked_by_windows_is_read_again_not_skipped(self):
        job = jobs.new_job("train", "dr-lee", {})
        job["state"] = "running"
        self.store.save(job)
        real, calls = Path.read_text, []

        def locked_once(path, *args, **kwargs):  # the moment a save replaces the file, Windows refuses the open
            calls.append(path)
            if len(calls) == 1:
                raise PermissionError(13, "The process cannot access the file")
            return real(path, *args, **kwargs)
        with mock.patch.object(Path, "read_text", locked_once):
            self.assertEqual(self.store.active()["id"], job["id"])  # skipping it would let a second training start
            self.assertEqual(self.store.load(job["id"])["state"], "running")


if __name__ == "__main__":
    unittest.main()
