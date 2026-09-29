"""The Extend Training job's steps: the commands the loop-test notebook proved (run 0924-1804), in order (plan WS13).

1. Preparing data: copy the export builder and the frozen-set files into the app container, run the export dry run
   (stop if no corrected slice qualifies), run the export with the frozen-set guard, move it to <unet>/exports and
   check it again on the host.
2. Training: train_candidate.py from the registry's original, the D7 recipe (plan WS12).
3. Comparing with the current model: score the frozen set (seeded with the active version's saved scores when they
   exist, so only the new version is scored), then versions.py register and compare. Nothing is activated.
4. Preparing example scans: render_examples.py predicts 9 frozen-set scans with both versions, for the Results tab
   (plan WS13 R1). It never fails the job, because the comparison is already complete.

With an owner and a selection (R1), the dry run and the export keep only that user's chosen masks.
"""
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import versions  # noqa: E402
from common import sha256_file  # noqa: E402
from evaluate import atomic_write_json  # noqa: E402
from frozen_guard import DEFAULT_INDEX  # noqa: E402
from jobs import NO_WINDOW, Step, StepFailed, now  # noqa: E402

TRAIN_EPOCHS = 20  # train_candidate.py's default, passed explicitly so "epoch k of 20" on the page is always true
STEP_TITLES = {"prepare": "Preparing data", "train": "Training", "evaluate": "Comparing with the current model",
               "examples": "Preparing example scans"}
NOTHING_QUALIFIES = "No corrected slices qualify for training yet. Correct a segmentation, save it, then train again."
NOTHING_CHOSEN = "None of the chosen cases qualifies for training any more. Check the corrections again, then choose."
BUILDER_FILES = ("build_training_volumes.py", "common.py", "frozen_guard.py")


@dataclass
class Config:
    tools: Path
    python: str
    unet_root: Path
    registry: Path
    frozen_manifest: Path
    frozen_index: Path
    server_dir: Path
    docker: list = field(default_factory=lambda: ["docker"])
    app_container: str = "visheart-local"
    gpu_containers: tuple = ("visheart-gpu-nvidia", "visheart-gpu-cpu")

    @property
    def exports(self):
        return self.unet_root / "exports"

    @property
    def evaluations(self):
        return self.unet_root / "evaluations"

    @property
    def examples(self):
        return self.unet_root / "examples"

    @property
    def jobs(self):
        return self.unet_root / "jobs"

    @property
    def versions_dir(self):
        return self.registry.parent

    @property
    def temp_exports(self):
        return self.server_dir / "dist" / "temp_exports"


def default_config():
    tools = Path(__file__).resolve().parent
    python = Path(sys.executable)
    if python.name.lower() == "pythonw.exe" and python.with_name("python.exe").exists():
        python = python.with_name("python.exe")  # the tools print their progress; pythonw has no output of its own
    return Config(tools=tools, python=str(python), unet_root=Path(os.environ.get("VISHEART_UNET_ROOT", r"E:\Jy\Unet")),
                  registry=Path(versions.DEFAULT_REGISTRY), frozen_manifest=Path(versions.DEFAULT_MANIFEST),
                  frozen_index=Path(DEFAULT_INDEX), server_dir=tools.parent / "Cardiac_Segmentation_FYP_Server")


def run_quiet(command, timeout=170):
    """Run a short command outside any job; return its output or raise StepFailed with its last words."""
    command = [str(part) for part in command]
    try:
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                timeout=timeout, creationflags=NO_WINDOW)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise StepFailed(f"{' '.join(command[:3])} could not run: {error}")
    if result.returncode != 0:
        raise StepFailed(f"{' '.join(command[:3])} failed: {(result.stderr or result.stdout).strip()[-300:]}")
    return result.stdout


def qualifying(dry):
    return sum(int(candidate["qualifyingSlices"]) for candidate in dry["candidates"])


def export_command(config, name):
    return [*config.docker, "exec", "-w", "/app/backend", config.app_container, "node",
            "dist/scripts/export_training_set.js", "--out", f"dist/temp_exports/{name}"]


def staging_commands(config):
    """Copy the export builder and the frozen-set files into the app container, where the export runs."""
    yield [*config.docker, "exec", config.app_container, "mkdir", "-p", "/tmp/retraining"]
    for source in [config.tools / file for file in BUILDER_FILES] + [config.frozen_index, config.frozen_manifest]:
        yield [*config.docker, "cp", source, f"{config.app_container}:/tmp/retraining/"]


def export_scope(owner, selection_file):
    """--owner and --selection for the export. The selection file sits in temp_exports, which the container mounts."""
    scope = ["--owner", owner] if owner else []
    if selection_file is not None:
        scope += ["--selection", f"dist/temp_exports/{Path(selection_file).name}"]
    return scope


def prepare(config, ctx, label, owner=None, selection=None):
    name = f"export-{label}"
    staged, export = config.temp_exports / name, config.exports / name
    if staged.exists() or export.exists():
        raise StepFailed(f"An export called {name} already exists. Start a new training.")
    selection_file = config.temp_exports / f"selection-{label}.json" if selection else None
    if selection_file is not None:
        atomic_write_json(selection_file, {"maskIds": list(selection)})
    scope = export_scope(owner, selection_file)
    try:
        for command in staging_commands(config):
            ctx.run_command(command)
        ctx.run_command([*export_command(config, name), *scope, "--dry-run"],
                        failure="The check of the saved corrections failed. The log shows why.")
        dry = versions.read_json(staged / "dry_run.json")
        slices = qualifying(dry)
        ctx.update(corrections={"projects": dry["counts"]["projects"], "slices": slices,
                                "conflicts": dry["counts"]["conflicts"]})
        if slices == 0:
            shutil.rmtree(staged, ignore_errors=True)
            raise StepFailed(NOTHING_CHOSEN if selection else NOTHING_QUALIFIES)
        ctx.run_command([*export_command(config, name), *scope, "--builder", "/tmp/retraining/build_training_volumes.py",
                         "--holdout", f"/tmp/retraining/{config.frozen_manifest.name}",
                         "--frozen-slices", f"/tmp/retraining/{config.frozen_index.name}"],
                        failure="The export of the corrections failed. The log shows why.")
    finally:
        if selection_file is not None:
            selection_file.unlink(missing_ok=True)
    ctx.check_cancelled()
    config.exports.mkdir(parents=True, exist_ok=True)
    shutil.move(str(staged), str(export))
    manifest = versions.read_json(export / "export_manifest.json")
    counts = manifest["counts"]
    ctx.update(export={"folder": str(export), "projects": counts["projects"], "slices": counts["slices"],
                       "conflicts": counts["conflicts"], "frozen_excluded": len(manifest.get("frozen_excluded", []))})
    if counts["slices"] < 1:
        raise StepFailed("Every corrected project was left out of the export (for example, it holds a frozen test "
                         "scan), so there is nothing to train on. The log lists the reasons.")
    ctx.run_command([config.python, config.tools / "frozen_guard.py", "check", "--index", config.frozen_index,
                     export / "images"],
                    failure="The frozen-set guard found a test scan in the export, so nothing was trained.")
    ctx.values["export"] = export


def epoch_progress(ctx):
    def on_line(line):
        line = line.strip()
        if not (line.startswith("{") and '"train_loss"' in line):
            return
        try:
            row = json.loads(line)
        except ValueError:
            return
        ctx.update(epoch=int(row["epoch"]), epochs=TRAIN_EPOCHS)
    return on_line


def train(config, ctx, label):
    registry = versions.Registry(config.registry)
    base = registry.file(registry.data["original"])  # D7: every version is trained from the original
    ctx.update(epoch=0, epochs=TRAIN_EPOCHS)
    ctx.run_command([config.python, config.tools / "train_candidate.py", "--export", ctx.values["export"],
                     "--label", label, "--base-checkpoint", base, "--epochs", TRAIN_EPOCHS,
                     "--output-dir", config.versions_dir, "--frozen-slices", config.frozen_index],
                    on_line=epoch_progress(ctx), failure="Training stopped with an error. The log shows why.")


def frozen_expected(manifest_path):
    """{dataset: (images_dir, number_of_cases)} for every public dataset of the frozen manifest."""
    manifest = versions.read_json(manifest_path)
    return {name: (entry["images"], len(entry["image_files"])) for name, entry in sorted(manifest["public"].items())}


def report_paths(config):
    """Where frozen-set reports are kept: the pipeline's own first, then the evidence runs' (only ever read)."""
    return sorted(config.evaluations.glob("*.json")) + sorted((config.unet_root / "evidence").glob("*/public*.json"))


def find_report(paths, wanted, expected):
    """The newest report that scored every label in `wanted` ({label: sha256}) completely, on the expected folders.

    expected: {dataset: (images_dir, number_of_cases)}. Returns (path, report), or None.
    """
    best, best_time = None, -1.0
    for path in map(Path, paths):
        try:
            report = versions.read_json(path)
        except (OSError, ValueError):
            continue
        if not isinstance(report, dict):
            continue
        checkpoints, scores, sources = report.get("checkpoints", {}), report.get("scores", {}), report.get("datasets", {})
        if any(checkpoints.get(label, {}).get("sha256") != sha256 for label, sha256 in wanted.items()):
            continue
        complete = all(len(scores.get(label, {}).get(name, {})) >= count
                       and str(sources.get(name, {}).get("images")) == str(images)
                       for label in wanted for name, (images, count) in expected.items())
        if complete and path.stat().st_mtime > best_time:
            best, best_time = (path, report), path.stat().st_mtime
    return best


def seed_report(folder, label, sha256, expected):
    """The newest saved report that holds every frozen-set score of `label` for this exact file and these folders.

    expected: {dataset: (images_dir, number_of_cases)}. Returns a report trimmed to that label, or None.
    """
    found = find_report(Path(folder).glob("*.json"), {label: sha256}, expected)
    if found is None:
        return None
    best = found[1]
    return {"checkpoints": {label: best["checkpoints"][label]},
            "scores": {label: {name: best["scores"][label][name] for name in expected}},
            "datasets": {name: best["datasets"][name] for name in expected}}


def watch_scoring(report, label, total, ctx, stop):
    while not stop.wait(3):
        try:
            scores = versions.read_json(report).get("scores", {}).get(label, {})
        except (OSError, ValueError):
            continue
        ctx.update(scored=sum(len(cases) for cases in scores.values()), total=total)


def score_and_compare(config, ctx, label):
    registry = versions.Registry(config.registry)
    active = registry.data["active"]
    active_file = registry.file(active)
    manifest = versions.read_json(config.frozen_manifest)
    public = sorted(manifest["public"].items())
    expected = frozen_expected(config.frozen_manifest)
    total = sum(count for _, count in expected.values())
    report = config.evaluations / f"{label}-public.json"
    ctx.values["report"] = report
    seed = seed_report(config.evaluations, active, sha256_file(active_file), expected)
    if seed is not None:
        atomic_write_json(report, seed)
        ctx.log(f"reusing the saved frozen-set scores of {active}; only {label} is scored")
    ctx.update(scored=0, total=total, scoring_active_first=seed is None)
    datasets = [part for name, entry in public for part in ("--dataset", name, entry["images"], entry["masks"])]
    stop = threading.Event()
    watcher = threading.Thread(target=watch_scoring, args=(report, label, total, ctx, stop), daemon=True)
    watcher.start()
    try:
        ctx.run_command([config.python, config.tools / "evaluate.py", "--manifest", config.frozen_manifest,
                         "--checkpoint", active, active_file, "--checkpoint", label, config.versions_dir / f"{label}.pth",
                         *datasets, "--output", report],
                        failure="Scoring on the scans the model has never seen failed. The log shows why.")
    finally:
        stop.set()
        watcher.join()
    ctx.update(scored=total, total=total)
    ctx.cancellable = False  # the last two commands take seconds; stopping between them would leave it uncompared
    ctx.run_command([config.python, config.tools / "versions.py", "register", "--registry", config.registry,
                     "--label", label], failure="The new version could not be registered. The log shows why.")
    ctx.run_command([config.python, config.tools / "versions.py", "compare", "--registry", config.registry,
                     "--label", label, "--public-report", report, "--manifest", config.frozen_manifest],
                    failure="The comparison with the current model failed. The log shows why.")
    gate = versions.Registry(config.registry).entry(label)["gate"]
    ctx.record(result={"label": label, "against": gate["against"], "warnings": gate["warnings"],
                       "notes": gate["notes"], "public": gate["public"], "report": str(report)})


def render_examples_step(config, ctx, label):
    """Example scans for the Results tab (plan WS13 R1). It never fails the job: the comparison is already complete."""
    ctx.cancellable = False  # the version is registered and compared; only its pictures are left to make
    progress = {"done": 0, "total": 0, "ready": False}

    def on_line(line):
        line = line.strip()
        if not (line.startswith("{") and '"example"' in line):
            return
        try:
            row = json.loads(line)
            progress.update(done=int(row["example"]), total=int(row["of"]))
        except (ValueError, KeyError, TypeError):
            return
        ctx.update(examples=dict(progress))

    try:
        ctx.run_command([config.python, config.tools / "render_examples.py", "--label", label,
                         "--report", ctx.values["report"], "--registry", config.registry,
                         "--manifest", config.frozen_manifest, "--out", config.examples / label],
                        on_line=on_line, failure="The example scans could not be prepared. The comparison is complete.")
        progress["ready"] = True
    except StepFailed as failure:
        progress["error"] = str(failure)
        ctx.log(f"example scans skipped: {failure}")
    ctx.update(examples=dict(progress))


def training_steps(config, job):
    params = job["params"]
    label = params["label"]
    return [Step("prepare", STEP_TITLES["prepare"],
                 lambda ctx: prepare(config, ctx, label, params.get("owner"), params.get("selection"))),
            Step("train", STEP_TITLES["train"], lambda ctx: train(config, ctx, label)),
            Step("evaluate", STEP_TITLES["evaluate"], lambda ctx: score_and_compare(config, ctx, label)),
            Step("examples", STEP_TITLES["examples"], lambda ctx: render_examples_step(config, ctx, label))]


def check_corrections(config, owner=None, run=None):
    """The export dry run, read-only: the cases that would train now, one user's when an owner is given. It checks
    each project against the frozen set too, so the page can lock a frozen test patient's cases."""
    run = run or run_quiet
    name = f"check-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}"
    staged = config.temp_exports / name
    try:
        for command in staging_commands(config):
            run(command)
        run([*export_command(config, name), *export_scope(owner, None), "--dry-run",
             "--builder", "/tmp/retraining/build_training_volumes.py",
             "--frozen-slices", f"/tmp/retraining/{config.frozen_index.name}"])
        dry = versions.read_json(staged / "dry_run.json")
    finally:
        shutil.rmtree(staged, ignore_errors=True)
    return {"checked_at": now(), "projects": dry["counts"]["projects"], "slices": qualifying(dry),
            "conflicts": dry["counts"]["conflicts"], "cases": dry.get("cases", [])}


def restart_gpu(config, run=None):
    """Restart every running segmentation-service container so it loads the model the registry now serves (WS8)."""
    run = run or run_quiet
    running = set(run([*config.docker, "ps", "--format", "{{.Names}}"]).split())
    restarted = []
    for name in config.gpu_containers:
        if name in running:
            run([*config.docker, "restart", name], timeout=180)
            restarted.append(name)
    return restarted


def simulated_steps(config, job, seconds_per_epoch=1.0):
    """worker.py --simulate: the same steps and progress for testing the page, but nothing is exported or trained."""
    pause = float(seconds_per_epoch)
    chosen = job["params"].get("cases") or []

    def prepare_sim(ctx):
        ctx.run_command([config.python, "-c", f"import time; print('simulation: nothing is exported'); time.sleep({pause * 3})"])
        projects = len({case["projectId"] for case in chosen}) or 2
        slices = sum(int(case["slices"]) for case in chosen) or 10
        ctx.update(corrections={"projects": projects, "slices": slices, "conflicts": 0},
                   export={"folder": "(simulation)", "projects": projects, "slices": slices, "conflicts": 0,
                           "frozen_excluded": 0})

    def train_sim(ctx):
        script = ("import json, time\n"
                  f"for epoch in range(1, {TRAIN_EPOCHS + 1}):\n"
                  f"    time.sleep({pause})\n"
                  "    print(json.dumps({'epoch': epoch, 'train_loss': 1.0 / epoch}), flush=True)\n")
        ctx.update(epoch=0, epochs=TRAIN_EPOCHS)
        ctx.run_command([config.python, "-c", script], on_line=epoch_progress(ctx))

    def evaluate_sim(ctx):
        total = 692
        for scored in range(0, total + 1, 173):
            ctx.check_cancelled()
            ctx.update(scored=scored, total=total, scoring_active_first=False)
            time.sleep(pause)
        ctx.record(result={"label": job["params"]["label"], "against": "(simulation)", "warnings": [],
                           "notes": ["Simulation: nothing was exported, trained or registered."], "public": {},
                           "report": None, "simulated": True})

    def examples_sim(ctx):
        ctx.cancellable = False
        for done in range(1, 10):
            ctx.update(examples={"done": done, "total": 9, "ready": done == 9})
            time.sleep(pause / 3)

    return [Step("prepare", STEP_TITLES["prepare"], prepare_sim), Step("train", STEP_TITLES["train"], train_sim),
            Step("evaluate", STEP_TITLES["evaluate"], evaluate_sim),
            Step("examples", STEP_TITLES["examples"], examples_sim)]
