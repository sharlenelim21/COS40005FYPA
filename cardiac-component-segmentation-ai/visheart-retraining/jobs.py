"""Training jobs for the Extend Training page: one at a time, saved to disk, never tied to a browser window.

A job is a list of steps run in a background thread. Its record, <jobs folder>/<id>.json, is saved after every change
and its output goes to <id>.log, so a page that was closed, refreshed or opened in a second tab reads the same state.
Only one job may be queued or running: the runner refuses a second one, whatever any page shows (plan WS13).
"""
import datetime as dt
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from evaluate import atomic_write_json, read_json  # noqa: E402

ACTIVE_STATES = ("queued", "running")
JOB_ID_PATTERN = r"job-\d{8}-\d{6}-[0-9a-f]{4}"
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)          # no console flashes when the worker runs under pythonw
NEW_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)  # so a cancel can end the whole process tree
# Elsewhere a command leads its own session, so its process group holds everything it starts (see kill_tree).
OWN_SESSION = {} if os.name == "nt" else {"start_new_session": True}


def kill_tree(pid):
    """End a command and everything it started: taskkill /T on Windows, the command's process group elsewhere.

    Killing only the command would leave its children running, still holding its output pipe open, so the job would
    never see the end of its output.
    """
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=NO_WINDOW)
        return
    import signal
    try:
        os.killpg(pid, signal.SIGKILL)  # the command's session leader: its group id is its pid
    except ProcessLookupError:
        pass


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


class JobError(Exception):
    """A refused request; status is the HTTP status the worker answers with."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


class Cancelled(Exception):
    pass


class StepFailed(Exception):
    """A reason written for the page, which shows it as it is."""


class Step:
    def __init__(self, key, title, run):
        self.key, self.title, self.run = key, title, run


def new_job(kind, requested_by, params):
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    return {"id": f"job-{stamp}-{secrets.token_hex(2)}", "kind": kind, "state": "queued", "requested_by": requested_by,
            "created_at": now(), "started_at": None, "finished_at": None, "params": params, "steps": [],
            "progress": {}, "error": None, "cancel_requested_by": None}


class JobStore:
    def __init__(self, folder):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()

    def path(self, job_id):
        return self.folder / f"{job_id}.json"

    def save(self, job):
        with self.lock:
            atomic_write_json(self.path(job["id"]), job)

    def load(self, job_id):
        if not re.fullmatch(JOB_ID_PATTERN, str(job_id)) or not self.path(job_id).exists():
            raise JobError(404, f"No job called {job_id}.")
        return read_json(self.path(job_id))

    def jobs(self):
        found = []
        for path in self.folder.glob("job-*.json"):
            try:
                found.append(read_json(path))  # a brief Windows lock is waited out, never skipped (plan WS13)
            except (FileNotFoundError, ValueError):
                continue
        return sorted(found, key=lambda job: job["id"])

    def latest(self):
        found = self.jobs()
        return found[-1] if found else None

    def active(self):
        return next((job for job in reversed(self.jobs()) if job["state"] in ACTIVE_STATES), None)

    def mark_interrupted(self):
        """At start-up: a job still queued or running belonged to a worker that stopped, so it can never finish."""
        marked = []
        for job in self.jobs():
            if job["state"] in ACTIVE_STATES:
                job.update(state="interrupted", finished_at=now(),
                           error="The training service stopped while this job was running. Start a new training.")
                for step in job["steps"]:
                    if step["state"] == "running":
                        step["state"] = "interrupted"
                self.save(job)
                marked.append(job["id"])
        return marked

    def log(self, job_id, line):
        with self.lock, open(self.folder / f"{job_id}.log", "a", encoding="utf-8") as handle:
            handle.write(line.rstrip("\r\n") + "\n")

    def tail(self, job_id, lines=200):
        self.load(job_id)
        path = self.folder / f"{job_id}.log"
        if not path.exists():
            return []
        return path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:]


class JobContext:
    """What a step may do: run commands (streamed into the job log), report progress, hand values to later steps."""

    def __init__(self, runner, job):
        self.runner, self.job = runner, job
        self.values = {}
        self.process = None
        self.cancellable = True

    @property
    def cancelled(self):
        return self.runner.cancel_event.is_set()

    def check_cancelled(self):
        if self.cancelled:
            raise Cancelled()

    def log(self, line):
        self.runner.store.log(self.job["id"], line)

    def update(self, **progress):
        with self.runner.lock:
            self.job["progress"].update(progress)
            self.runner.store.save(self.job)

    def record(self, **fields):
        with self.runner.lock:
            self.job.update(fields)
            self.runner.store.save(self.job)

    def run_command(self, command, on_line=None, failure=None, cwd=None):
        self.check_cancelled()
        command = [str(part) for part in command]
        self.log("$ " + " ".join(f'"{part}"' if " " in part else part for part in command))
        env = {**os.environ, "PYTHONUNBUFFERED": "1", "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1",
               "MPLBACKEND": "Agg"}
        process = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                                   creationflags=NO_WINDOW | NEW_GROUP, **OWN_SESSION)
        self.process = process
        try:
            for line in process.stdout:
                self.log(line)
                if on_line:
                    on_line(line)
            code = process.wait()
        finally:
            self.process = None
        self.check_cancelled()
        if code != 0:
            name = " ".join(Path(part).name for part in command[:2])
            raise StepFailed(failure or f"{name} stopped with exit code {code}. The log shows why.")
        return code

    def kill(self):
        process = self.process
        if process is not None and process.poll() is None:
            kill_tree(process.pid)


class JobRunner:
    """Runs one job at a time in a background thread. The single-job rule lives here, not in any page."""

    def __init__(self, store, plan_steps):
        self.store, self.plan_steps = store, plan_steps
        self.lock = threading.RLock()
        self.cancel_event = threading.Event()
        self.context = None
        self.thread = None

    def busy(self):
        return (self.thread is not None and self.thread.is_alive()) or self.store.active() is not None

    def start(self, kind, requested_by, params):
        with self.lock:
            active = self.store.active()
            if active is not None or (self.thread is not None and self.thread.is_alive()):
                who = active["requested_by"] if active else "someone"
                raise JobError(409, f"A training is already running (started by {who}). Only one can run at a time.")
            job = new_job(kind, requested_by, params)
            steps = self.plan_steps(job)
            job["steps"] = [{"key": step.key, "title": step.title, "state": "pending", "started_at": None,
                             "finished_at": None} for step in steps]
            self.store.save(job)
            self.cancel_event = threading.Event()
            self.context = JobContext(self, job)
            self.thread = threading.Thread(target=self._run, args=(self.context, steps), name=job["id"], daemon=True)
            self.thread.start()
            return json.loads(json.dumps(job))

    def _run(self, context, steps):
        job = context.job
        with self.lock:
            job.update(state="running", started_at=now())
            self.store.save(job)
        state, error, current = "succeeded", None, None
        try:
            for step, record in zip(steps, job["steps"]):
                current = record
                with self.lock:
                    record.update(state="running", started_at=now())
                    job["progress"]["step"] = step.key
                    self.store.save(job)
                step.run(context)
                with self.lock:
                    record.update(state="done", finished_at=now())
                    self.store.save(job)
                current = None
        except Cancelled:
            state, error = "cancelled", f"Cancelled by {job.get('cancel_requested_by') or 'a user'}."
        except StepFailed as failure:
            state, error = "failed", str(failure)
        except Exception as unexpected:  # a bug in a step must not take the worker down
            context.log(traceback.format_exc())
            state, error = "failed", f"Unexpected error: {unexpected}. The log shows the details."
        finally:
            with self.lock:
                if current is not None:
                    current.update(state=state, finished_at=now())
                job.update(state=state, error=error, finished_at=now())
                self.store.save(job)
                self.context = None

    def cancel(self, job_id, requested_by):
        with self.lock:
            self.store.load(job_id)
            context = self.context
            if context is None or context.job["id"] != job_id:
                raise JobError(409, "This job is not running.")
            if not context.cancellable:
                raise JobError(409, "The new version is already being registered, or its example scans prepared, so "
                                    "the job cannot be cancelled now. It finishes within a few minutes.")
            context.job["cancel_requested_by"] = requested_by
            self.store.save(context.job)
            self.cancel_event.set()
        context.kill()
        return json.loads(json.dumps(context.job))

    def current(self):
        """The running job, or else the most recent one: what every page shows."""
        with self.lock:
            if self.context is not None:
                return json.loads(json.dumps(self.context.job))
        return self.store.latest()
