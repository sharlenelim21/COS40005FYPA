"""The UNet Extend Training service: the page's only way to run the retraining tools (plan WS13).

It runs on the host in E:\\Jy\\Unet\\.venv and listens on 127.0.0.1 only. The app container reaches it through
host.docker.internal, as checked on 2026-09-25; nothing on the network can. A request must name this computer in its
Host header, and every POST must be JSON, so a web page in a browser cannot drive it either. The rule that only one
training runs at a time lives here (jobs.JobRunner), not in the page.

Each user sees and trains only their own corrected cases (plan WS13 R1): the server adds the signed-in user's id, the
correction check is kept per user, and a training takes only mask ids from that user's latest check.

  python worker.py                    serve on 127.0.0.1:8010 (start-retraining-worker.bat runs it without a window)
  python worker.py --simulate         the same, but a job trains nothing and versions cannot change (to test the page)
  python worker.py --check-running    exit 0 if a worker answers
  python worker.py --wait-running N   wait up to N seconds for one to answer
  python worker.py --stop [--force]   stop the running worker; --force even while a job runs (it becomes interrupted)
"""
import argparse
import base64
import contextlib
import datetime as dt
import io
import json
import os
import re
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jobs  # noqa: E402
import pipeline  # noqa: E402
import versions  # noqa: E402
from evaluate import atomic_write_json, summarize  # noqa: E402

HOST, PORT = "127.0.0.1", 8010
ALLOWED_HOSTS = ("127.0.0.1", "localhost", "host.docker.internal")
MAX_BODY = 64 * 1024
FRESH_CHECK_SECONDS = 600
LABEL_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}")
OWNER_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
MAX_SELECTION = 500


class WorkerApp:
    def __init__(self, config, simulate=False, plan=None):
        self.config, self.simulate = config, simulate
        self.store = jobs.JobStore(config.jobs)
        self.interrupted = self.store.mark_interrupted()
        if plan is None:
            steps = pipeline.simulated_steps if simulate else pipeline.training_steps
            plan = lambda job: steps(config, job)  # noqa: E731
        self.runner = jobs.JobRunner(self.store, plan)
        self.check_lock = threading.Lock()
        self.compare_lock = threading.Lock()  # one comparison is prepared at a time
        self._integrity = None                 # (what it was computed from, the answer); see integrity()
        self.log_lock = threading.Lock()
        self.log_path = config.jobs / "worker.log"

    def log_event(self, line):
        with self.log_lock, open(self.log_path, "a", encoding="utf-8") as handle:
            handle.write(f"{jobs.now()} {line}\n")

    # reading ---------------------------------------------------------------------------------------------------

    def registry(self):
        if not self.config.registry.exists():
            raise jobs.JobError(503, f"The model registry is missing ({self.config.registry}). Run versions.py init.")
        return versions.Registry(self.config.registry)

    def eligible_path(self, owner):
        return self.config.jobs / (f"eligible-{owner}.json" if owner else "eligible.json")

    def eligible(self, owner=None):
        """This user's latest correction check, or None. Another user's check is never read."""
        path = self.eligible_path(owner)
        if not path.exists():
            return None
        data = versions.read_json(path)
        if data.get("simulated"):  # v1's made-up counts; R1 checks for real even in simulation
            return None
        age = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(data["checked_at"])).total_seconds()
        return {**data, "fresh": age < FRESH_CHECK_SECONDS}

    def version_view(self, registry, label):
        data, entry = registry.data, registry.data["versions"][label]
        metadata = registry.folder / f"{label}.json"
        recipe = None
        if entry["status"] != "deleted" and metadata.exists():
            recipe = (versions.read_json(metadata).get("recipe") or {}).get("name")
        # What is really on this computer: a copied registry can name versions whose files never came with it.
        on_disk = entry["status"] != "deleted" and registry.file(label).is_file()
        return {"label": label, "status": entry["status"], "registered_at": entry.get("registered_at"),
                "base": entry.get("base"), "is_active": label == data["active"],
                "is_original": label == data["original"], "gate": entry.get("gate"), "recipe": recipe,
                "deleted_because": entry.get("deleted_because"), "on_disk": on_disk}

    @staticmethod
    def listed(view):
        """Whether the page lists a version: one whose model file is not on this computer has no use here, so it is
        left out. The original (served from the models folder), the version in use (its copy is in the active slot)
        and deleted entries (history only, never offered) are always kept."""
        return view["on_disk"] or view["is_original"] or view["is_active"] or view["status"] == "deleted"

    def integrity(self, registry):
        """Why versions cannot be switched on this computer (registry.integrity_problem()), or None. It hashes the
        original model, so the answer is kept until either file it reads, or the registry's choice, changes."""
        data = registry.data

        def stamp(path):
            path = Path(path)
            return (path.stat().st_size, path.stat().st_mtime_ns) if path.is_file() else None
        key = (data["original"], data["active"], data["original_file"], data["active_slot"],
               stamp(data["original_file"]), stamp(data["active_slot"]))
        if self._integrity is None or self._integrity[0] != key:
            self._integrity = (key, registry.integrity_problem())
        return self._integrity[1]

    def status(self, owner=None):
        registry = self.registry()
        busy, eligible, job = self.runner.busy(), self.eligible(owner), self.runner.current()
        if busy:
            who = job["requested_by"] if job else "someone"
            reason = (f"A training is running (started by {who}). You can close this page; training continues. "
                      "Only one training can run at a time.")
            training = {"allowed": False, "reason": reason}
        elif eligible and eligible["fresh"] and eligible["slices"] == 0:
            training = {"allowed": False,
                        "reason": "No corrected slices qualify yet. Correct a segmentation and save it, then check again."}
        else:
            training = {"allowed": True, "reason": None}
        views = (self.version_view(registry, label) for label in registry.data["versions"])
        return {"simulated": self.simulate, "busy": busy, "training": training,
                "original": registry.data["original"], "active": registry.data["active"],
                "problem": self.integrity(registry),
                "versions": [view for view in views if self.listed(view)],
                "eligible": eligible, "job": job}

    def job(self, job_id):
        current = self.runner.current()
        return current if current and current["id"] == job_id else self.store.load(job_id)

    def log(self, job_id, tail):
        try:
            count = max(1, min(int(tail), 500))
        except ValueError:
            raise jobs.JobError(400, "tail must be a number.")
        return {"lines": self.store.tail(job_id, count)}

    def examples_index(self, label):
        index = self.config.examples / label / "index.json"
        return versions.read_json(index) if index.exists() else None

    def results(self, label):
        """A version's frozen-set comparison for each heart structure, from the report that scored it, and its examples."""
        registry = self.registry()
        self.known(registry, label)
        entry, original = registry.entry(label), registry.data["original"]
        gate = entry.get("gate")
        against = (gate or {}).get("against") or (None if label == original else original)
        view = {"label": label, "status": entry["status"], "against": against, "gate": gate, "report": None,
                "datasets": None, "examples": self.examples_index(label)}
        if against not in registry.data["versions"] or not self.config.frozen_manifest.exists():
            return view
        expected = pipeline.frozen_expected(self.config.frozen_manifest)
        wanted = {label: entry["sha256"], against: registry.entry(against)["sha256"]}
        found = pipeline.find_report(pipeline.report_paths(self.config), wanted, expected)
        if found is None:
            return view
        path, report = found
        scores = report["scores"]
        view["report"] = str(path)
        view["datasets"] = {name: {"n": len(scores[label][name]),
                                   "against": summarize(scores[against][name])["per_class_mean"],
                                   "label": summarize(scores[label][name])["per_class_mean"]} for name in expected}
        return view

    def comparison_folder(self, label, against):
        return self.config.examples / label / "compare" / against

    def comparison_ready(self, registry, label, against):
        """Whether against's predictions on label's example scans are there, from against's registered file."""
        index = self.comparison_folder(label, against) / "index.json"
        return index.exists() and versions.read_json(index).get("sha256") == registry.entry(against)["sha256"]

    def compare_examples(self, label, against):
        """Another version's predictions on label's example scans, for the Results tab's viewer. They are made once,
        about half a minute on a CPU, and kept; label's own and the version it was compared with come from training.
        A version made before the page has no example scans: they are made here first, about a minute more."""
        registry = self.registry()
        self.known(registry, label)
        self.known(registry, against)
        for name in (label, against):
            if registry.entry(name).get("status") == "deleted":
                raise jobs.JobError(409, f"{name} was deleted, so it cannot be compared.")
        view = {"label": label, "against": against, "ready": True, "rendered": False}
        index = self.examples_index(label)
        if not index:
            with self.compare_lock:
                if not self.examples_index(label):   # another request may have just made them
                    self.log_event(f"preparing {label}'s example scans")
                    render_examples_for(self.config, label, self.config.examples / label)
                    view["rendered"] = True
            index = self.examples_index(label)
            if not index:
                raise jobs.JobError(500, f"The example scans for {label} could not be prepared. See worker.log.")
        view["index"] = index
        if against in (label, index.get("against")) or self.comparison_ready(registry, label, against):
            return view
        with self.compare_lock:
            if not self.comparison_ready(registry, label, against):   # another request may have just made it
                self.log_event(f"preparing {against}'s predictions on {label}'s example scans")
                render_comparison(self.config, label, against, self.comparison_folder(label, against))
                view["rendered"] = True
        if not self.comparison_ready(registry, label, against):
            raise jobs.JobError(500, f"The comparison with {against} could not be prepared. See worker.log.")
        return view

    def predictions(self, registry, label, index, version, n):
        """Where version's predictions on example scan n of label are, as (folder, file prefix): made in training for
        label and the version it was compared with, otherwise by compare_examples."""
        folder = self.config.examples / label / str(n)
        if version == label:
            return folder, "label"
        if version == index.get("against"):
            return folder, "against"
        self.known(registry, version)
        if not self.comparison_ready(registry, label, version):
            raise jobs.JobError(409, f"{version}'s predictions on these scans are not prepared yet.")
        return self.comparison_folder(label, version) / str(n), "against"

    def example(self, label, n, left=None, right=None):
        """One example scan with two versions' predictions side by side. By default as trained: the version label was
        compared with on the left, label on the right; the page puts the model in use on the left. Never one version
        on both sides."""
        registry = self.registry()
        self.known(registry, label)
        index = self.examples_index(label) or {}
        entry = next((item for item in index.get("examples", []) if item["n"] == n), None)
        if entry is None:
            raise jobs.JobError(404, f"No example scan {n} for {label}.")
        left, right = left or index.get("against"), right or label
        if left == right:
            raise jobs.JobError(400, "Choose two different versions to compare.")
        (left_folder, left_name), (right_folder, right_name) = (
            self.predictions(registry, label, index, version, n) for version in (left, right))
        folder = self.config.examples / label / str(n)

        def png(path):
            return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")
        return {**{key: value for key, value in entry.items() if key != "slices"}, "count": entry["slices"],
                "size": index.get("size", 256), "left_label": left, "right_label": right,
                "slices": [{"image": png(folder / f"image_{k}.png"), "truth": png(folder / f"truth_{k}.png"),
                            "left": png(left_folder / f"{left_name}_{k}.png"),
                            "right": png(right_folder / f"{right_name}_{k}.png")}
                           for k in range(entry["slices"])]}

    # actions ---------------------------------------------------------------------------------------------------

    def check_eligible(self, owner=None):
        if self.runner.busy():
            raise jobs.JobError(409, "A training is running; it checks the corrections itself.")
        if not self.check_lock.acquire(blocking=False):
            raise jobs.JobError(409, "A check is already running.")
        try:
            result = pipeline.check_corrections(self.config, owner)  # read-only, so simulation checks for real too
        except jobs.StepFailed as failure:
            raise jobs.JobError(502, f"The saved corrections could not be checked: {failure}")
        finally:
            self.check_lock.release()
        atomic_write_json(self.eligible_path(owner), result)
        return self.eligible(owner)

    def chosen(self, owner, selection):
        """The chosen cases, which must come from this user's latest check: nobody trains a case they were not shown."""
        if not selection:
            raise jobs.JobError(400, "Choose at least one case to train on.")
        known = {case["maskId"]: case for case in (self.eligible(owner) or {}).get("cases", [])}
        if not known:
            raise jobs.JobError(409, "Check the corrections first, then choose the cases.")
        if any(mask_id not in known for mask_id in selection):
            raise jobs.JobError(409, "Some chosen cases are not in your latest check. Check again, then choose.")
        locked = [known[mask_id]["projectName"] for mask_id in selection if known[mask_id].get("frozen")]
        if locked:
            raise jobs.JobError(409, f"{', '.join(dict.fromkeys(locked))} is a test scan: every new version is "
                                     "tested on it, so it is not used for training. Clear it, then start again.")
        picked = list(dict.fromkeys(selection))
        return {"owner": owner, "selection": picked,
                "cases": [{"maskId": mask_id, "projectId": known[mask_id]["projectId"],
                           "projectName": known[mask_id]["projectName"], "model": known[mask_id]["model"],
                           "slices": len(known[mask_id]["slices"])} for mask_id in picked]}

    def start_training(self, requested_by, owner=None, selection=None):
        self.registry()
        params = {"label": f"unet-ui{dt.datetime.now():%m%d-%H%M%S}"}
        if selection is not None:
            params.update(self.chosen(owner, selection))
        elif owner:
            params["owner"] = owner
        return self.runner.start("train", requested_by, params)

    def cancel(self, job_id, requested_by):
        return self.runner.cancel(job_id, requested_by)

    def known(self, registry, label):
        if not LABEL_RE.fullmatch(label or "") or label not in registry.data["versions"]:
            raise jobs.JobError(404, f"No version called {label}.")

    def preview(self, label, action):
        registry = self.registry()
        self.known(registry, label)
        if action == "reject":
            refusal = versions.reject_refusal(registry, label)
            return {"label": label, "action": "reject", "refusal": refusal, "warnings": [],
                    "confirm": [] if refusal else [f"{label} will be deleted permanently"]}
        switch_action = "rollback" if label == registry.data["original"] else "activate"
        refusal = versions.switch_refusal(registry, label, switch_action)
        warnings, lines = ([], []) if refusal else versions.switch_lines(registry, label)
        return {"label": label, "action": switch_action, "refusal": refusal, "warnings": warnings, "confirm": lines}

    def activate(self, label, requested_by, confirm):
        return self.change(label, requested_by, confirm, "activate")

    def reject(self, label, requested_by, confirm):
        return self.change(label, requested_by, confirm, "reject")

    def change(self, label, requested_by, confirm, kind):
        if self.simulate:
            raise jobs.JobError(403, "Simulation mode: versions cannot be changed.")
        with self.runner.lock:
            if self.runner.busy():
                raise jobs.JobError(409, "A training is running. Versions can be changed when it has finished.")
            preview = self.preview(label, kind)
            if preview["refusal"]:
                raise jobs.JobError(409, preview["refusal"])
            if list(confirm) != preview["confirm"]:
                raise jobs.JobError(409, "What this change does has changed since it was shown. Review it again.")
            registry = self.registry()
            if kind == "reject":
                versions.reject(registry, label, by=requested_by)
                self.log_event(f"{requested_by} rejected {label}")
                return {"rejected": label}
            with contextlib.redirect_stdout(io.StringIO()) as output:
                code = versions.switch(registry, label, True, preview["action"], by=requested_by)
            if code != 0:
                raise jobs.JobError(409, output.getvalue().strip() or "The switch was refused.")
            self.log_event(f"{requested_by} {preview['action']} {label}; confirmed {preview['confirm']}")
        try:
            restarted, restart_error = pipeline.restart_gpu(self.config), None
        except jobs.StepFailed as failure:
            restarted, restart_error = [], str(failure)
        return {"active": label, "restarted": restarted, "restart_error": restart_error}


# HTTP ----------------------------------------------------------------------------------------------------------

def who(body):
    name = body.get("requestedBy")
    if not isinstance(name, str) or not name.strip() or len(name) > 100:
        raise jobs.JobError(400, "requestedBy is required.")
    return name.strip()


def owner_of(value):
    """The signed-in user's id, which the server adds. It names that user's check file, so it must be a safe name."""
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not OWNER_RE.fullmatch(value):
        raise jobs.JobError(400, "The user id is not valid.")
    return value


def selection_of(body):
    chosen = body.get("selection")
    if chosen is None:
        return None
    if (not isinstance(chosen, list) or len(chosen) > MAX_SELECTION
            or not all(isinstance(mask_id, str) and mask_id for mask_id in chosen)):
        raise jobs.JobError(400, "selection must be a list of mask ids.")
    return chosen


def confirmation(body):
    lines = body.get("confirm")
    if not isinstance(lines, list) or not all(isinstance(line, str) for line in lines):
        raise jobs.JobError(400, "confirm must be the list of lines that were shown.")
    return lines


def host_allowed(header, port):
    if not header:
        return False
    name, _, given = header.strip().lower().rpartition(":")
    if not name:
        name, given = given, ""
    return name in ALLOWED_HOSTS and given in ("", str(port))


ROUTES = [
    ("GET", r"/health", lambda app, m, q, b: {"ok": True, "busy": app.runner.busy(), "simulated": app.simulate,
                                              "pid": os.getpid()}),
    ("GET", r"/status", lambda app, m, q, b: app.status(owner_of(q.get("owner", [None])[0]))),
    ("POST", r"/eligible/check", lambda app, m, q, b: app.check_eligible(owner_of(b.get("requestedById")))),
    ("POST", r"/jobs/train", lambda app, m, q, b: app.start_training(who(b), owner_of(b.get("requestedById")),
                                                                     selection_of(b))),
    ("GET", r"/jobs/current", lambda app, m, q, b: app.runner.current()),
    ("GET", rf"/jobs/({jobs.JOB_ID_PATTERN})", lambda app, m, q, b: app.job(m[1])),
    ("GET", rf"/jobs/({jobs.JOB_ID_PATTERN})/log", lambda app, m, q, b: app.log(m[1], q.get("tail", ["200"])[0])),
    ("POST", rf"/jobs/({jobs.JOB_ID_PATTERN})/cancel", lambda app, m, q, b: app.cancel(m[1], who(b))),
    ("GET", r"/versions/([^/]+)/preview", lambda app, m, q, b: app.preview(m[1], q.get("action", ["activate"])[0])),
    ("GET", r"/versions/([^/]+)/results", lambda app, m, q, b: app.results(m[1])),
    ("GET", r"/versions/([^/]+)/examples/(\d{1,2})",
     lambda app, m, q, b: app.example(m[1], int(m[2]), q.get("left", [None])[0], q.get("right", [None])[0])),
    ("POST", r"/versions/([^/]+)/compare", lambda app, m, q, b: app.compare_examples(m[1], str(b.get("against") or ""))),
    ("POST", r"/versions/([^/]+)/activate", lambda app, m, q, b: app.activate(m[1], who(b), confirmation(b))),
    ("POST", r"/versions/([^/]+)/reject", lambda app, m, q, b: app.reject(m[1], who(b), confirmation(b))),
]


class Handler(BaseHTTPRequestHandler):
    server_version = "VisHeartRetraining/1"

    def log_message(self, format, *args):  # into worker.log, never to a console
        self.server.app.log_event(f"{self.address_string()} {format % args}")

    def do_GET(self):
        self.answer("GET")

    def do_POST(self):
        self.answer("POST")

    def answer(self, method):
        try:
            status, payload = 200, {"ok": True, "data": self.dispatch(method)}
        except jobs.JobError as refused:
            status, payload = refused.status, {"ok": False, "error": str(refused)}
        except SystemExit as refused:  # versions.py refuses by raising SystemExit
            status, payload = 409, {"ok": False, "error": str(refused)}
        except Exception as error:  # keep serving; the page shows the message
            self.server.app.log_event(traceback.format_exc())
            status, payload = 500, {"ok": False, "error": f"The training service hit an error: {error}"}
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def dispatch(self, method):
        if not host_allowed(self.headers.get("Host"), self.server.server_address[1]):
            raise jobs.JobError(403, "This service answers only requests addressed to this computer.")
        body = {}
        if method == "POST":
            if not (self.headers.get("Content-Type") or "").lower().startswith("application/json"):
                raise jobs.JobError(415, "POST requests must be JSON.")
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                raise jobs.JobError(413, "The request is too large.")
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                raise jobs.JobError(400, "The request body is not valid JSON.")
            if not isinstance(body, dict):
                raise jobs.JobError(400, "The request body must be a JSON object.")
        url = urlparse(self.path)
        query = parse_qs(url.query)
        for route_method, pattern, handler in ROUTES:
            match = re.fullmatch(pattern, url.path)
            if match and route_method == method:
                return handler(self.server.app, match, query, body)
        raise jobs.JobError(404, f"No such endpoint: {method} {url.path}")


def make_server(app, host=HOST, port=PORT):
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.app = app
    return server


# command line --------------------------------------------------------------------------------------------------

def health(port, timeout=2):
    request = urllib.request.Request(f"http://127.0.0.1:{port}/health", headers={"Host": f"127.0.0.1:{port}"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())["data"]


def run_renderer(config, arguments, what):
    """render_examples.py in its own process (it loads models); a failure is reported with its last line."""
    command = [config.python, str(config.tools / "render_examples.py"), *arguments,
               "--registry", str(config.registry), "--manifest", str(config.frozen_manifest)]
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONUTF8": "1", "MPLBACKEND": "Agg"}
    try:
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                timeout=900, env=env, creationflags=jobs.NO_WINDOW)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise jobs.JobError(500, f"{what} could not run: {error}")
    if result.returncode != 0:
        last = (result.stderr or result.stdout).strip().splitlines()[-1:] or ["no output"]
        raise jobs.JobError(500, f"{what} failed: {last[0]}")


def render_comparison(config, label, against, out):
    """against's predictions on label's example scans."""
    run_renderer(config, ["--label", label, "--compare-with", against, "--out", str(out)],
                 f"The comparison with {against}")


def render_examples_for(config, label, out):
    """label's own example scans, as training makes them, for a version made before the page: the scans of the frozen
    set whose score changed least, most and in between against the version it was compared with."""
    run_renderer(config, ["--label", label, "--out", str(out)], f"The example scans for {label}")


def terminate(app, exit=os._exit):
    """A stop signal (Linux, stop-retraining-worker.sh --force): end a running job's commands first, then leave at
    once, as taskkill /T does on Windows. The job stays "running" on disk and is reported as interrupted at the next
    start, rather than recorded as failed by a command that was killed."""
    app.log_event("stop signal received; ending the running job's commands, if any, and stopping")
    context = app.runner.context
    if context is not None:
        context.kill()
    exit(0)


def stop_process(pid):
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=jobs.NO_WINDOW)
    else:
        os.kill(pid, 15)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--simulate", action="store_true")
    parser.add_argument("--check-running", action="store_true")
    parser.add_argument("--wait-running", type=float, metavar="SECONDS")
    parser.add_argument("--stop", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--also-listen", action="append", default=[], metavar="ADDRESS",
                        help="another address to serve on, besides 127.0.0.1: on Linux, the Docker bridge's gateway, "
                             "which is where containers reach the host (start-retraining-worker.sh passes it)")
    args = parser.parse_args(argv)

    if args.check_running or args.wait_running is not None:
        deadline = time.time() + (args.wait_running or 0)
        while True:
            try:
                info = health(args.port)
            except OSError:
                if time.time() >= deadline:
                    print("not running")
                    return 1
                time.sleep(0.5)
                continue
            print(f"running (pid {info['pid']}{', simulation' if info['simulated'] else ''}"
                  f"{', a training is in progress' if info['busy'] else ''})")
            return 0

    if args.stop:
        try:
            info = health(args.port)
        except OSError:
            print("not running")
            return 0
        if info["busy"] and not args.force:
            print("A training is in progress. Stopping now interrupts it. Run with --stop --force to stop anyway.")
            return 1
        stop_process(info["pid"])
        print(f"stopped (pid {info['pid']})")
        return 0

    config = pipeline.default_config()
    config.jobs.mkdir(parents=True, exist_ok=True)
    try:
        server = ThreadingHTTPServer((HOST, args.port), Handler)  # bind first: a second worker must not touch the jobs
    except OSError as error:
        with open(config.jobs / "worker.log", "a", encoding="utf-8") as handle:
            handle.write(f"{jobs.now()} could not listen on {HOST}:{args.port} ({error}); is a worker already running?\n")
        print(f"could not listen on {HOST}:{args.port}: {error}")
        return 1
    server.daemon_threads = True
    server.app = WorkerApp(config, simulate=args.simulate)
    addresses = [HOST]
    for address in args.also_listen:
        try:
            other = ThreadingHTTPServer((address, args.port), Handler)
        except OSError as error:
            server.app.log_event(f"could not also listen on {address}:{args.port} ({error}); containers that reach "
                                 "the host there will find the training service unavailable")
            continue
        other.daemon_threads = True
        other.app = server.app
        threading.Thread(target=other.serve_forever, daemon=True).start()
        addresses.append(address)
    if os.name != "nt":
        import signal
        signal.signal(signal.SIGTERM, lambda *_: terminate(server.app))
    server.app.log_event(f"serving on {', '.join(addresses)} port {args.port} (pid {os.getpid()}, "
                         f"simulate={args.simulate}); interrupted at start: {server.app.interrupted}")
    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
