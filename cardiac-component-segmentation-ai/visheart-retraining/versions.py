"""Version registry for UNet checkpoints: register, compare, activate, go back to the original, reject, prune.

The shipped original is never written. It stays at app/models/unet.pth, and the same file is baked into the GPU
Docker image. A retrained version serves from the active slot, app/models/active/unet.pth, which the inference
service prefers whenever it exists (resolve_checkpoint_path in visheart-inference-gpu/app/helpers/
unet_inference_api.py). Removing the slot therefore returns to the original.

Jy's rules (2026-09-23):
- Choosing a version deletes the trained version it replaces. The original is always kept, and `reject` deletes a
  candidate nobody wants.
- A comparison never blocks. These are warnings, which activation lists and asks to confirm:
  - a lower score on the frozen public arm (the lower bound of the 95% interval for the paired change in
    cardiac-mean Dice is below -0.005);
  - an incomplete comparison;
  - no clinical improvement;
  - a comparison against another version, or none at all.
  What was confirmed is recorded. This departs from proposal §4, which asked for a block, so that a version that
  looks better on screen can still be chosen.
- A deletion that a switch causes is confirmed the same way.

  python versions.py init     --label unet-2026-05-01 [--original PATH] [--active-slot PATH]
  python versions.py register --label L
  python versions.py compare  --label L --public-report P.json [--clinical-report C.json] [--control-label CL]
                              [--manifest frozen_holdout.json]
  python versions.py activate --label L [--yes]
  python versions.py rollback [--yes]              back to the original
  python versions.py reject   --label L
  python versions.py prune    [--yes]
  python versions.py status

Every command takes --registry (default E:\\Jy\\Unet\\versions\\registry.json).
"""
import argparse
import datetime as dt
import json
import os
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import REPO_MODELS, UNET_ROOT, build_model, sha256_file  # noqa: E402
from evaluate import atomic_write_json, read_json  # noqa: E402,F401 (read_json waits out a brief Windows lock)

REGRESSION_MARGIN = 0.005
LABEL_PATTERN = r"[A-Za-z0-9][A-Za-z0-9._-]*"
DEFAULT_REGISTRY = str(UNET_ROOT / "versions" / "registry.json")
DEFAULT_MANIFEST = str(UNET_ROOT / "versions" / "frozen_holdout.json")
DEFAULT_ORIGINAL = str(REPO_MODELS / "unet.pth")
DEFAULT_ACTIVE_SLOT = str(REPO_MODELS / "active" / "unet.pth")
RESTART_HINT = ("Restart the inference service, which caches the model after its first request: from "
                "cardiac-component-segmentation-ai\\visheart-local-deployment, run "
                "docker compose restart gpu-cpu (or gpu-nvidia on a CUDA host).")


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def record(data, action, label, **detail):
    data["history"].append({"at": now(), "action": action, "label": label, **detail})


def check_label(label):
    if not re.fullmatch(LABEL_PATTERN, label):
        raise SystemExit(f"label {label!r} must match {LABEL_PATTERN}")


def verify_loadable(path):
    """The service loads with strict=False (external_unet_inference.py:279), so a key mismatch would only print
    warnings and serve untrained weights. Nothing is registered unless it loads strictly into UNet2D."""
    try:
        build_model(checkpoint=path)
    except Exception as error:  # any failure to load means the file must not be registered
        raise SystemExit(f"{Path(path).name} does not load strictly into UNet2D: {error}")


def copy_verified(source, destination, expected_sha256):
    """Copy through a temp file beside the destination; rename only if the copy hashes as expected."""
    destination = Path(destination)
    temp = destination.with_name(destination.name + ".tmp")
    shutil.copyfile(source, temp)
    if sha256_file(temp) != expected_sha256:
        temp.unlink()
        raise SystemExit(f"the copy of {source} does not match its registered SHA-256; {destination} is untouched")
    os.replace(temp, destination)


def confirm(lines, assume_yes):
    for line in lines:
        print(f"  - {line}")
    if assume_yes:
        return True
    try:
        answer = input("Type yes to continue: ")
    except EOFError:
        answer = ""
    return answer.strip().lower() == "yes"


class Registry:
    def __init__(self, path):
        self.path = Path(path)
        self.folder = self.path.parent
        self.data = read_json(self.path)

    def entry(self, label):
        if label not in self.data["versions"]:
            raise SystemExit(f"{label} is not registered")
        return self.data["versions"][label]

    def file(self, label):
        return self.folder / self.entry(label)["file"]

    def save(self):
        atomic_write_json(self.path, self.data)

    def integrity_problem(self):
        """The original file must be untouched, and the slot must hold exactly the registered active version."""
        data = self.data
        original = Path(data["original_file"])
        if not original.exists() or sha256_file(original) != self.entry(data["original"])["sha256"]:
            return (f"{original} is not the registered original any more, and it must never be overwritten. Restore it "
                    f"from {self.file(data['original'])} or from the Docker image")
        slot = Path(data["active_slot"])
        if data["active"] == data["original"]:
            if slot.exists():
                return f"{slot} holds a file this registry did not put there"
        elif not slot.exists() or sha256_file(slot) != self.entry(data["active"])["sha256"]:
            return f"{slot} is not the registered active version {data['active']}"
        return None

    def delete(self, label, reason, by=None):
        """Mark first, then remove the files: a failed removal leaves a stray file, never a wrong registry."""
        entry = self.entry(label)
        entry.update({"status": "deleted", "deleted_at": now(), "deleted_because": reason})
        record(self.data, "delete", label, reason=reason, **({"by": by} if by else {}))
        self.save()
        weights = self.file(label)
        for path in (weights, weights.with_suffix(".json")):
            if path.exists():
                path.unlink()


def cmd_init(args):
    check_label(args.label)
    path, slot = Path(args.registry), Path(args.active_slot)
    if path.exists():
        raise SystemExit(f"{path} already exists; init runs once")
    if slot.exists():
        raise SystemExit(f"{slot} already holds a file that no registry knows about; move it away first")
    digest = sha256_file(args.original)
    verify_loadable(args.original)
    path.parent.mkdir(parents=True, exist_ok=True)
    weights = path.parent / f"{args.label}.pth"
    if not weights.exists():
        copy_verified(args.original, weights, digest)   # the base that fine-tunes start from
    elif sha256_file(weights) != digest:
        raise SystemExit(f"{weights} already exists and differs from the original")
    data = {"schema": 2, "original_file": str(Path(args.original).resolve()), "active_slot": str(slot.resolve()),
            "original": args.label, "active": args.label, "history": [],
            "versions": {args.label: {"file": weights.name, "sha256": digest, "registered_at": now(),
                                      "status": "original", "base": None, "gate": None}}}
    record(data, "init", args.label, sha256=digest)
    atomic_write_json(path, data)
    print(f"registered {args.label} ({digest[:8]}) as the original, now serving")
    return 0


def cmd_register(args):
    check_label(args.label)
    registry = Registry(args.registry)
    versions = registry.data["versions"]
    if args.label in versions:
        raise SystemExit(f"{args.label} is already registered")
    weights, metadata_file = registry.folder / f"{args.label}.pth", registry.folder / f"{args.label}.json"
    if not (weights.exists() and metadata_file.exists()):
        raise SystemExit(f"{weights.name} and {metadata_file.name} must both be in {registry.folder}")
    metadata = read_json(metadata_file)
    digest = sha256_file(weights)
    if metadata.get("weights", {}).get("sha256") != digest:
        raise SystemExit(f"{weights.name} does not match the SHA-256 recorded in {metadata_file.name}")
    base_sha = metadata.get("base_checkpoint", {}).get("sha256")
    base = next((label for label, entry in versions.items() if entry["sha256"] == base_sha), None)
    if base is None:
        raise SystemExit(f"{args.label} was trained from a checkpoint that is not registered ({base_sha})")
    verify_loadable(weights)
    versions[args.label] = {"file": weights.name, "sha256": digest, "registered_at": now(), "status": "candidate",
                            "base": base, "gate": None}
    record(registry.data, "register", args.label, base=base)
    registry.save()
    print(f"registered {args.label}, trained from {base}")
    return 0


def check_report(report, registry, labels, name):
    active = registry.data["active"]
    if report.get("baseline") != active:
        raise SystemExit(f"{name}: its baseline is {report.get('baseline')}, but the active version is {active}")
    for label in labels:
        scored = report.get("checkpoints", {}).get(label, {}).get("sha256")
        if scored != registry.entry(label)["sha256"]:
            raise SystemExit(f"{name}: {label} was scored from a file that is not the registered one")


def assess(public, clinical, candidate, active, manifest, control=None):
    """Warnings and notes; never a verdict. Activation shows the warnings and asks to confirm them."""
    warnings, notes, public_result = [], [], {}
    for name, locked in sorted(manifest["public"].items()):
        expected = len(locked["image_files"])
        row = public.get("comparison", {}).get(candidate, {}).get(name)
        if not row or row.get("n") != expected:
            scored = row.get("n") if row else 0
            public_result[name] = {"n": scored, "expected": expected, "complete": False}
            warnings.append(f"public {name}: only {scored} of {expected} cases scored, so this comparison is incomplete")
            continue
        low = row["ci95"][0]
        lower = low < -REGRESSION_MARGIN
        public_result[name] = {"n": row["n"], "mean_delta_cardiac": row["mean_delta_cardiac"], "ci95": row["ci95"],
                               "complete": True, "lower": lower}
        if lower:
            warnings.append(f"public {name}: lower score than {active} (mean change {row['mean_delta_cardiac']:+.4f}; "
                            f"95% CI lower bound {low:+.4f} is below -{REGRESSION_MARGIN})")
    if not manifest.get("clinical"):
        clinical_result = {"present": False}
        notes.append("no clinical arm: improvement on held-out corrections is not measured")
    elif clinical is None:
        clinical_result = {"present": True}
        warnings.append("clinical: an arm was drawn, but no clinical report was given")
    else:
        row = clinical.get("comparison", {}).get(candidate, {}).get("clinical")
        if not row or not row.get("n"):
            clinical_result = {"present": True}
            warnings.append("clinical: the report has no scored cases for this version")
        else:
            improved = row["mean_delta_cardiac"] > 0 and row["better"] > row["worse"]
            clinical_result = {"present": True, "improved": improved,
                               **{key: row[key] for key in ("n", "mean_delta_cardiac", "ci95", "better", "worse", "tied")}}
            if not improved:
                warnings.append(f"clinical: no improvement (mean change {row['mean_delta_cardiac']:+.4f}, "
                                f"better {row['better']}, worse {row['worse']})")
    result = {"checked_at": now(), "against": active, "public": public_result, "clinical": clinical_result,
              "warnings": warnings, "notes": notes}
    if control:
        result["control"] = {
            "label": control,
            "public": {name: public.get("comparison", {}).get(control, {}).get(name, {}).get("mean_delta_cardiac")
                       for name in sorted(manifest["public"])},
            "clinical": (clinical or {}).get("comparison", {}).get(control, {}).get("clinical", {}).get("mean_delta_cardiac"),
        }
    return result


def cmd_compare(args):
    registry = Registry(args.registry)
    active = registry.data["active"]
    entry = registry.entry(args.label)
    if args.label == active:
        raise SystemExit(f"{args.label} is the active version")
    if entry["status"] == "deleted":
        raise SystemExit(f"{args.label} was deleted")
    from holdout import verify
    problems = verify(args.manifest)
    if problems:
        raise SystemExit("the frozen manifest does not verify:\n" + "\n".join(problems))
    manifest = read_json(args.manifest)
    labels = [active, args.label] + ([args.control_label] if args.control_label else [])
    public = read_json(args.public_report)
    check_report(public, registry, labels, "public report")
    clinical = None
    if args.clinical_report:
        clinical = read_json(args.clinical_report)
        check_report(clinical, registry, labels, "clinical report")
    result = assess(public, clinical, args.label, active, manifest, args.control_label)
    entry["gate"] = result
    record(registry.data, "compare", args.label, against=active, warnings=result["warnings"])
    registry.save()
    print(json.dumps(result, indent=2))
    return 0


def activation_warnings(registry, label):
    active, gate = registry.data["active"], registry.entry(label).get("gate")
    if gate is None:
        return [f"{label} was never compared against the active version {active}"]
    if gate["against"] != active:
        return [f"{label} was compared against {gate['against']}, but {active} is active now"] + gate["warnings"]
    return list(gate["warnings"])


def switch_refusal(registry, target, action="activate"):
    """Why a switch to target cannot happen now, or None. switch() and the worker's preview both ask this first."""
    data, entry = registry.data, registry.entry(target)
    if target == data["active"]:
        return f"{target} is already serving"
    if entry["status"] == "deleted":
        return f"{target} was deleted and cannot serve again"
    if target != data["original"]:
        # Serving copies this file into the active slot: it must be here, and be the registered one.
        weights = registry.file(target)
        if not weights.is_file():
            return f"{target}'s model file is not on this computer ({weights}), so it cannot be used here"
        if sha256_file(weights) != entry["sha256"]:
            return f"{target}'s model file on this computer is not the registered one ({weights})"
    problem = registry.integrity_problem()
    return f"{action} refused: {problem}" if problem else None


def switch_lines(registry, target):
    """(warnings, lines to confirm): the target's warnings (D3), then the trained version the switch deletes (D4)."""
    active, original = registry.data["active"], registry.data["original"]
    warnings = [] if target == original else activation_warnings(registry, target)
    replaced = active if active != original else None
    deletion = ([f"{replaced} will be deleted, because {target} replaces it (the original is always kept)"]
                if replaced else [])
    return warnings, warnings + deletion


def switch(registry, target, assume_yes, action, by=None):
    data = registry.data
    active, original = data["active"], data["original"]
    entry = registry.entry(target)
    refusal = switch_refusal(registry, target, action)
    if refusal:
        print(refusal)
        return 1
    warnings, lines = switch_lines(registry, target)
    replaced = active if active != original else None
    if lines:
        print(f"{action} {target}:")
        if not confirm(lines, assume_yes):
            print("nothing changed")
            return 1
    slot = Path(data["active_slot"])
    if target == original:
        slot.unlink()
    else:
        slot.parent.mkdir(parents=True, exist_ok=True)
        copy_verified(registry.file(target), slot, entry["sha256"])
        entry["status"] = "active"
    data["active"] = target
    record(data, action, target, replaced=active, confirmed_warnings=warnings, **({"by": by} if by else {}))
    registry.save()
    if replaced:
        registry.delete(replaced, f"replaced by {target}", by=by)
    print(f"{target} is now serving{' (the original)' if target == original else ''}. {RESTART_HINT}")
    return 0


def cmd_activate(args):
    return switch(Registry(args.registry), args.label, args.yes, "activate")


def cmd_rollback(args):
    registry = Registry(args.registry)
    return switch(registry, registry.data["original"], args.yes, "rollback")


def reject_refusal(registry, label):
    """Why label cannot be rejected, or None: only a candidate can be, never the original or the active version."""
    data, entry = registry.data, registry.entry(label)
    if label in (data["original"], data["active"]) or entry["status"] != "candidate":
        return f"only a candidate can be rejected; {label} is {entry['status']}"
    return None


def reject(registry, label, by=None):
    refusal = reject_refusal(registry, label)
    if refusal:
        raise SystemExit(refusal)
    registry.delete(label, "rejected", by=by)


def cmd_reject(args):
    reject(Registry(args.registry), args.label)
    print(f"deleted {args.label}")
    return 0


def cmd_prune(args):
    registry = Registry(args.registry)
    doomed = [label for label, entry in registry.data["versions"].items() if entry["status"] == "candidate"]
    if not doomed:
        print("nothing to prune")
        return 0
    if not args.yes:
        print("would delete " + ", ".join(doomed) + "; run again with --yes to delete them")
        return 0
    for label in doomed:
        registry.delete(label, "pruned")
    print("deleted " + ", ".join(doomed))
    return 0


def cmd_status(args):
    registry = Registry(args.registry)
    data = registry.data
    print(f"original file: {data['original_file']}")
    print(f"active slot:   {data['active_slot']} ({'in use' if Path(data['active_slot']).exists() else 'empty'})")
    problem = registry.integrity_problem()
    if problem:
        print(f"PROBLEM: {problem}")
    for label, entry in data["versions"].items():
        role = "serving" if data["active"] == label else ""
        gate = entry.get("gate")
        verdict = "" if not gate else f"  compared with {gate['against']}: {len(gate['warnings'])} warning(s)"
        print(f"{label:<28} {entry['sha256'][:8]}  {entry['status']:<9} {role:<8}{verdict}")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)

    def command(name, handler):
        sub = commands.add_parser(name)
        sub.add_argument("--registry", default=DEFAULT_REGISTRY)
        sub.set_defaults(handler=handler)
        return sub

    init = command("init", cmd_init)
    init.add_argument("--label", required=True)
    init.add_argument("--original", default=DEFAULT_ORIGINAL)
    init.add_argument("--active-slot", default=DEFAULT_ACTIVE_SLOT)
    command("register", cmd_register).add_argument("--label", required=True)
    compare = command("compare", cmd_compare)
    compare.add_argument("--label", required=True)
    compare.add_argument("--public-report", required=True)
    compare.add_argument("--clinical-report")
    compare.add_argument("--control-label")
    compare.add_argument("--manifest", default=DEFAULT_MANIFEST)
    activate = command("activate", cmd_activate)
    activate.add_argument("--label", required=True)
    activate.add_argument("--yes", action="store_true", help="confirm every warning and deletion without asking")
    command("rollback", cmd_rollback).add_argument("--yes", action="store_true")
    command("reject", cmd_reject).add_argument("--label", required=True)
    command("prune", cmd_prune).add_argument("--yes", action="store_true")
    command("status", cmd_status)
    args = parser.parse_args(argv)
    return args.handler(args)


if __name__ == "__main__":
    sys.exit(main())
