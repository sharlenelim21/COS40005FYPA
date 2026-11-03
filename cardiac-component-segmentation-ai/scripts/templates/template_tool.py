#!/usr/bin/env python3
"""
VisHeart template hearts — the scripted steps of the hand-checked workflow.

Per subject (see README.md for the full walkthrough):

  1. (app)     Upload the 4D cine under your own account; Start pipeline with
               UNet segmentation + LV 3D + landmark detection.
  2. prepare   Load the experts' masks into the ED and ES frames.
  3. (app)     Check / edit the masks on every frame in the segmentation editor. Save.
  4. landmarks Place the RV insertion points on every frame and slice from your
               corrected masks (saved as landmark edits).
  5. (app)     Check / adjust the landmarks on every frame on the landmark page. Save.
  6. finalize  Move the project to the template account, publish it as a
               read-only template, recompute every result and rebuild the 3D models.

  recompute    Recompute every result of a project that is not published yet
               (volumes/EF, wall thickness, strain, health / similarity) without
               publishing it — to check your edits before `finalize`.
  unpublish    Take a template back to your account (unlocked) to edit it again.
  list         Show the current templates.
  export       Write the published templates to visheart-local-deployment/seed/templates.
               Committed, they are loaded on start-up on every teammate's machine.

Everything goes through the app's own API, except publish / unpublish, which
set the template flag and owner directly in the local MongoDB container (there
is deliberately no API for making a project visible to every user).

Frame numbers on the command line are 1-based, as the app shows them.
Requires: Python 3.10+, requests, numpy, nibabel, scipy; the local Docker stack running.
"""

from __future__ import annotations

import argparse
import getpass
import glob
import json
import os
import subprocess
import sys
import time

import numpy as np
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

DEFAULT_ACCOUNT_FILE = os.path.join(HERE, ".template_account.json")
STATE_DIR = os.path.join(HERE, ".state")
CATEGORY_LABEL = {"NOR": "Normal heart", "HCM": "HCM heart", "DCM": "DCM heart"}
# Expert (ground-truth) label values -> app mask classes.
LABELS = {
    "mnms": (("lvc", 1), ("myo", 2), ("rv", 3)),   # M&Ms: 1 = LV cavity, 2 = myocardium, 3 = RV
    "acdc": (("rv", 1), ("myo", 2), ("lvc", 3)),   # ACDC: 1 = RV, 2 = myocardium, 3 = LV cavity
}


def log(*parts):
    print(time.strftime("%H:%M:%S"), *parts, flush=True)


def die(msg):
    log("ERROR:", msg)
    sys.exit(1)


# ── API session ───────────────────────────────────────────────────────────────

class Api:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.s = requests.Session()

    def call(self, method, path, **kw):
        kw.setdefault("timeout", 1800)
        r = self.s.request(method, self.base + path, **kw)
        try:
            body = r.json()
        except ValueError:
            body = {"raw": r.text[:300]}
        return r.status_code, body

    def login(self, username: str, password: str):
        code, body = self.call("POST", "/auth/login", json={"username": username, "password": password})
        if code != 200:
            die(f"login as {username} failed ({code}): {body.get('message')}")

    def project(self, pid: str) -> dict:
        code, body = self.call("GET", f"/project/get-project-info/{pid}")
        if code != 200:
            die(f"project {pid} not found or not yours ({code})")
        return body["project"]

    def editable_mask(self, pid: str, model: str) -> dict | None:
        code, body = self.call("GET", f"/segmentation/segmentation-results/{pid}")
        for m in body.get("segmentations", []) if code == 200 else []:
            if not m.get("isMedSAMOutput") and str(m.get("segmentationModel", "")).lower() == model and m.get("frames"):
                return m
        return None

    def wait(self, what, check, every=5, limit=1800):
        t0 = time.time()
        while time.time() - t0 < limit:
            value = check()
            if value:
                return value
            time.sleep(every)
        die(f"timed out waiting for {what}")

    def failed_job(self, uuid):
        if not uuid:
            return None
        for path in ("/segmentation/user-check-jobs", "/reconstruction/user-check-jobs"):
            code, body = self.call("GET", path)
            for j in body.get("jobs", []) if isinstance(body, dict) else []:
                if (j.get("jobId") or j.get("uuid")) == uuid and str(j.get("status")).lower() in ("failed", "error", "cancelled"):
                    return j
        return None


def password_for(username: str) -> str:
    return os.environ.get("VISHEART_PASSWORD") or getpass.getpass(f"Password for {username}: ")


def template_account(path: str) -> dict:
    if not os.path.exists(path):
        die(f"template account file not found: {path} (see README.md)")
    return json.load(open(path, encoding="utf-8"))


# ── MongoDB (publish / unpublish only) ────────────────────────────────────────

def mongo(js: str, container: str) -> dict:
    """Run a mongosh script inside the MongoDB container; it must print one JSON line last."""
    subprocess.run(["docker", "exec", "-i", container, "sh", "-c", "cat > /tmp/visheart_template_tool.js"],
                   input=js.encode("utf-8"), check=True)
    r = subprocess.run(["docker", "exec", container, "sh", "-c",
                        'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" '
                        '--authenticationDatabase admin "$MONGO_INITDB_DATABASE" /tmp/visheart_template_tool.js'],
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        die(f"mongosh failed: {(r.stderr or r.stdout).strip()[:500]}")
    lines = [l for l in r.stdout.strip().splitlines() if l.strip()]
    return json.loads(lines[-1]) if lines else {}


def clear_stale_jobs(project_id: str, container: str, minutes: int = 20) -> int:
    """Mark this project's jobs that are still 'pending'/'in_progress' but have
    not reported progress for `minutes` as failed. A job left behind by a PC
    shutdown or GPU restart otherwise blocks a new 3D build (the app refuses a
    second build while one is 'running'). Live jobs report progress every few
    seconds, so they are never touched."""
    res = mongo(f"""
const P = {json.dumps({"projectId": project_id, "minutes": minutes})};
const cutoff = new Date(Date.now() - P.minutes * 60000);
const r = db.jobs.updateMany(
  {{ projectid: {{ $in: [P.projectId, ObjectId(P.projectId)] }}, status: {{ $in: ["pending", "in_progress"] }}, updatedAt: {{ $lt: cutoff }} }},
  {{ $set: {{ status: "failed", message: "Interrupted: no progress for " + P.minutes + " min (marked failed by template_tool)", updatedAt: new Date() }} }});
print(JSON.stringify({{ cleared: r.modifiedCount }}));
""", container)
    return int(res.get("cleared", 0))


# ── RLE ───────────────────────────────────────────────────────────────────────

def rle_encode(mask2d: np.ndarray) -> str:
    flat = np.concatenate([[0], mask2d.astype(np.int8).ravel(order="C"), [0]])
    d = np.diff(flat)
    starts, ends = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
    return " ".join(f"{s} {e - s}" for s, e in zip(starts, ends))


def rle_decode(rle: str, H: int, W: int) -> np.ndarray:
    flat = np.zeros(H * W, dtype=bool)
    t = rle.split()
    for i in range(0, len(t) - 1, 2):
        o, n = int(t[i]), int(t[i + 1])
        flat[o:o + n] = True
    return flat.reshape(H, W)


def gt_file(gt_dir: str, frame0: int) -> str:
    hits = [p for p in glob.glob(os.path.join(gt_dir, f"*_{frame0}_gt.nii.gz")) if "_sa_" not in os.path.basename(p)]
    if len(hits) != 1:
        die(f"expected one *_{frame0}_gt.nii.gz in {gt_dir}, found {len(hits)}")
    return hits[0]


def frame0(n: int, n_frames: int, what: str) -> int:
    if not 1 <= n <= n_frames:
        die(f"{what} frame {n} is outside 1..{n_frames}")
    return n - 1


# ── prepare: experts' masks into ED and ES ────────────────────────────────────

def cmd_prepare(a):
    import nibabel as nib
    api = Api(a.api)
    if a.published:
        # A published template belongs to the template account, which may still change it.
        acct = template_account(a.template_account)
        api.login(acct["username"], acct["password"])
        p = api.project(a.project)
        if not p.get("isTemplate"):
            die("--published is for templates; this project is not published")
    else:
        if not a.user:
            die("--user is required (the project's owner)")
        api.login(a.user, password_for(a.user))
        p = api.project(a.project)
        if p.get("isTemplate"):
            die("this project is already a template — unpublish it first, or use --published")
    H, W = p["dimensions"]["height"], p["dimensions"]["width"]
    n_frames = p["dimensions"].get("frames") or 1
    ed, es = frame0(a.ed, n_frames, "ED"), frame0(a.es, n_frames, "ES")
    if not api.editable_mask(a.project, a.model):
        die(f"no editable {a.model.upper()} segmentation yet — run the pipeline first")

    frames = []
    for t in (ed, es):
        path = gt_file(a.gt_dir, t)
        gt = np.asarray(nib.load(path).dataobj).astype(np.int16)
        if gt.ndim == 4:
            gt = gt[..., 0]
        if gt.shape[:2] != (H, W):
            die(f"{os.path.basename(path)} is {gt.shape[:2]}, the project is {(H, W)} — wrong file?")
        frames.append({"frameindex": t, "slices": [
            {"sliceindex": z, "segmentationmasks": [
                {"class": cls, "segmentationmaskcontents": rle_encode(gt[:, :, z] == lab)}
                for cls, lab in LABELS[a.labels] if (gt[:, :, z] == lab).any()]}
            for z in range(gt.shape[2])]})
        log(f"frame {t + 1}: {os.path.basename(path)}")

    if not a.yes:
        ans = input(f"Replace the masks of frames {ed + 1} (ED) and {es + 1} (ES) with the experts' masks? [y/N] ")
        if ans.strip().lower() != "y":
            die("cancelled")
    code, body = api.call("PUT", f"/segmentation/save-manual-segmentation/{a.project}", json={"frames": frames, "model": a.model})
    if code != 200:
        die(f"save failed ({code}): {body.get('message')}")
    record_helper(a.project, "prepare", {"ed": ed + 1, "es": es + 1, "after_editing": bool(a.published)})
    log("experts' masks saved into ED and ES. Edit tracking:", json.dumps(body.get("editTracking"))[:200])
    if not a.published:
        log("Next: check/edit every frame in the segmentation editor, Save, then run `landmarks`.")
        return

    # Published template: its results are now out of date. Keep only the
    # "published" step so `finalize` recomputes everything, and update the
    # note on the read-only Landmarks tab (and the description that ends with it).
    _, state_path = load_state(a.project)
    save_state(["published"], state_path)
    note = default_note(a.project)
    res = mongo(f"""
const P = {json.dumps({"projectId": a.project, "note": note})};
const proj = db.projects.findOne({{ _id: ObjectId(P.projectId) }});
const old = (proj.templateInfo && proj.templateInfo.landmarkNote) || "";
const desc = old && proj.description && proj.description.endsWith(old)
  ? proj.description.slice(0, proj.description.length - old.length) + P.note : proj.description;
db.projects.updateOne({{ _id: proj._id }}, {{ $set: {{ "templateInfo.landmarkNote": P.note, description: desc }} }});
print(JSON.stringify({{ ok: true }}));
""", a.mongo_container)
    log("template note updated:", note)
    log("Next: run `finalize` with the same arguments as before — it will recompute every result.")


# ── landmarks: pre-fill from the corrected masks ──────────────────────────────

def cmd_landmarks(a):
    from mask_landmarks import insertion_points
    api = Api(a.api)
    api.login(a.user, password_for(a.user))
    p = api.project(a.project)
    if p.get("isTemplate"):
        die("this project is already a template — unpublish it first")
    H, W = p["dimensions"]["height"], p["dimensions"]["width"]
    code, body = api.call("GET", f"/landmark-detection/results/{a.project}")
    if not body.get("result"):
        die("no landmark detection result yet — open the landmark page (or Start pipeline) first")
    code, body = api.call("GET", f"/landmark-detection/load-landmarks/{a.project}")
    if body.get("result") and not a.overwrite:
        die("this project already has saved landmark edits; re-run with --overwrite to replace them")
    m = api.editable_mask(a.project, a.model)
    if not m:
        die(f"no editable {a.model.upper()} segmentation")

    out, n_both, n_total = [], 0, 0
    for fr in sorted(m["frames"], key=lambda f: f["frameindex"]):
        slices = []
        for s in sorted(fr["slices"], key=lambda s: s["sliceindex"]):
            masks = {k: np.zeros((H, W), bool) for k in ("rv", "myo", "lvc")}
            for seg in s["segmentationmasks"]:
                k = str(seg.get("class", "")).lower()
                if k in masks and seg.get("segmentationmaskcontents"):
                    masks[k] = rle_decode(seg["segmentationmaskcontents"], H, W)
            pts = insertion_points(masks["rv"], masks["myo"], masks["lvc"])
            n_total += 1
            if pts:
                hi, lo = sorted(pts, key=lambda q: q[1])          # point 1 = the higher dot, as the app stores it
                lm = [{"key": "rv_insertion_1", "x": round(hi[0], 2), "y": round(hi[1], 2), "flag": "normal"},
                      {"key": "rv_insertion_2", "x": round(lo[0], 2), "y": round(lo[1], 2), "flag": "normal"}]
                n_both += 1
            else:
                lm = []                                           # no RV–septum contact: no points on this slice
            slices.append({"sliceindex": s["sliceindex"], "landmarks": lm})
        out.append({"frameindex": fr["frameindex"], "frameinferred": True, "slices": slices})

    code, body = api.call("PUT", f"/landmark-detection/save-landmarks/{a.project}",
                          json={"frames": out, "segmentationModel": a.model, "name": "Landmarks (pre-filled from masks)",
                                "description": "RV insertion points at the ends of each slice's RV–septum contact line"})
    if code != 200:
        die(f"save failed ({code}): {str(body)[:300]}")
    record_helper(a.project, "landmarks", {"slice_frames_with_points": n_both})
    log(f"landmarks saved: {n_both}/{n_total} slice-frames have both points (the rest have no RV–septum contact).")
    log("Next: check/adjust every frame on the landmark page, Save, then run `finalize`.")


# ── finalize: publish + recompute ─────────────────────────────────────────────

def load_state(pid):
    path = os.path.join(STATE_DIR, f"{pid}.json")
    return (json.load(open(path)) if os.path.exists(path) else []), path


def helpers_used(pid) -> dict:
    """Which optional helpers (prepare / landmarks) were run on this project."""
    path = os.path.join(STATE_DIR, f"{pid}.helpers.json")
    return json.load(open(path)) if os.path.exists(path) else {}


def record_helper(pid, name, data):
    used = helpers_used(pid)
    used[name] = data
    os.makedirs(STATE_DIR, exist_ok=True)
    json.dump(used, open(os.path.join(STATE_DIR, f"{pid}.helpers.json"), "w"), indent=1)


def default_note(pid) -> str:
    """How the masks and landmarks were made, for the read-only Landmarks tab."""
    used = helpers_used(pid)
    note = "Masks and RV insertion points were checked and corrected by hand on every frame"
    if "prepare" in used:
        p = used["prepare"]
        if p.get("after_editing"):
            note += (f"; the end-diastole (frame {p['ed']}) and end-systole (frame {p['es']}) masks "
                     f"are the experts' masks")
        else:
            note += (f", starting from the experts' masks at end-diastole (frame {p['ed']}) "
                     f"and end-systole (frame {p['es']})")
    if "landmarks" in used:
        note += (", with the RV insertion points first placed from the corrected masks" if "prepare" in used
                 else ", starting from RV insertion points placed from the corrected masks")
    return note + "."


def save_state(done, path):
    os.makedirs(STATE_DIR, exist_ok=True)
    json.dump(done, open(path, "w"), indent=1)


def recompute_analyses(api: Api, project: str, model: str, ed: int, es: int,
                       step=lambda name: True, mark=lambda name: None, strict: bool = True) -> None:
    """Recompute every analysis of the project's editable mask through the app's
    API: volumes/EF (+ maximal wall thickness), the wall-thickness bullseye, LV
    and RV strain (ED → ES and the full cycle) and the health / similarity
    checks. ED/ES are 0-based. `step`/`mark` let finalize resume a run. Heart
    metrics pick their own ED/ES (the template's, else auto-detected); a
    mismatch with `ed`/`es` stops the run when `strict`, else only warns."""
    m = api.editable_mask(project, model)
    mid = m["_id"]

    def changed(field, before, limit=900):
        def check():
            x = api.editable_mask(project, model)
            return x if x and (x.get(field) or {}).get("computed_at") not in (None, before) else None
        return api.wait(field, check, every=5, limit=limit)

    if step("metrics"):
        before = (m.get("heartMetrics") or {}).get("computed_at")
        api.call("POST", f"/segmentation/trigger-heart-metrics/{mid}")
        hm = changed("heartMetrics", before)["heartMetrics"]
        if (hm["ed_frame"], hm["es_frame"]) != (ed, es):
            msg = f"heart metrics used frames {hm['ed_frame'] + 1}/{hm['es_frame'] + 1}, expected {ed + 1}/{es + 1}"
            if strict:
                die(msg)
            log("WARNING:", msg, "(auto-detected from the masks; finalize uses the template's frames)")
        log(f"volumes/EF: LVEF {hm['LVEF']:.1f}%  RVEF {hm['RVEF']:.1f}%  LVEDV {hm['LVEDV']:.0f} mL  LV mass {hm['LV_mass_g']:.0f} g")
        mark("metrics")

    if step("wall_thickness"):
        m = api.editable_mask(project, model)
        before = {f: (m.get(f) or {}).get("computed_at") for f in ("bullseye", "frameBullseye", "rvFrameAreas")}
        api.call("POST", f"/segmentation/trigger-bullseye/{mid}")
        for f, v in before.items():
            changed(f, v)
        log("wall thickness + per-frame RV areas recomputed")
        mark("wall_thickness")

    for field, path, payload in (
        ("strain", "/segmentation/compute-strain-from-frames", {"projectId": project, "edFrameIndex": ed, "esFrameIndex": es, "modelType": model}),
        ("rvStrain", "/segmentation/compute-rv-strain-from-frames", {"projectId": project, "edFrameIndex": ed, "esFrameIndex": es, "modelType": model}),
        ("strainSeries", "/segmentation/compute-strain-series", {"projectId": project, "edFrameIndex": ed, "modelType": model}),
        ("rvStrainSeries", "/segmentation/compute-rv-strain-series", {"projectId": project, "edFrameIndex": ed, "modelType": model}),
    ):
        if not step(field):
            continue
        t0 = time.time()
        code, body = api.call("POST", path, json=payload)
        if code != 200:
            die(f"{field} failed ({code}): {str(body)[:300]}")
        log(f"{field} done ({time.time() - t0:.0f}s)")
        mark(field)

    for field, path in (("healthStatus", "trigger-health-status"), ("rvHealthStatus", "trigger-rv-health-status"),
                        ("diseaseSimilarity", "trigger-disease-similarity"),
                        ("regionalHealthStatus", "trigger-regional-health-status"),
                        ("rvRegionalHealthStatus", "trigger-rv-regional-health-status")):
        if not step(field):
            continue
        before = ((api.editable_mask(project, model) or {}).get(field) or {}).get("computed_at")
        api.call("POST", f"/segmentation/{path}/{mid}")
        changed(field, before, limit=300)
        mark(field)


# ── recompute: refresh every result without publishing ────────────────────────

def cmd_recompute(a):
    api = Api(a.api)
    api.login(a.user, password_for(a.user))
    p = api.project(a.project)
    if p.get("isTemplate"):
        die("this project is a published template — run `finalize` again instead (it recomputes as the template account)")
    n_frames = p["dimensions"].get("frames") or 1
    ed, es = frame0(a.ed, n_frames, "ED"), frame0(a.es, n_frames, "ES")
    if not api.editable_mask(a.project, a.model):
        die(f"no editable {a.model.upper()} segmentation yet — run the pipeline first")

    # Heart metrics take ED/ES (and the BSA for indexed values) from the
    # project's templateInfo; without it they pick ED as the frame with the
    # largest LV cavity, which can be an AI-segmented frame next to the
    # experts' ED. Store the subject's values there, as finalize does
    # (finalize later replaces templateInfo as a whole).
    fields = {"edFrame": ed, "esFrame": es}
    for key, value in (("heightCm", a.height), ("weightKg", a.weight), ("sex", a.sex), ("category", a.category)):
        if value is not None:
            fields[key] = value
    mongo(f"""
const P = {json.dumps({"projectId": a.project, "fields": fields})};
const set = {{}};
for (const [k, v] of Object.entries(P.fields)) set["templateInfo." + k] = v;
db.projects.updateOne({{ _id: ObjectId(P.projectId) }}, {{ $set: set }});
print(JSON.stringify({{ ok: true }}));
""", a.mongo_container)
    if a.height is None or a.weight is None:
        log("no --height/--weight: indexed values (mL/m2, g/m2) use the height/weight already stored, if any")

    log(f"recomputing {p['name']} with ED {a.ed} / ES {a.es} (takes several minutes; the 3D models are not rebuilt)")
    recompute_analyses(api, a.project, a.model, ed, es)

    m = api.editable_mask(a.project, a.model)
    hm, st = m.get("heartMetrics") or {}, m.get("strain") or {}
    hs, ds = m.get("healthStatus") or {}, m.get("diseaseSimilarity") or {}
    num = lambda v, f: format(v, f) if isinstance(v, (int, float)) else "—"
    print(f"\n==== Recomputed: {p['name']} ({a.project})")
    print(f"  LVEF {num(hm.get('LVEF'), '.1f')}%   RVEF {num(hm.get('RVEF'), '.1f')}%   LVEDV {num(hm.get('LVEDV'), '.0f')} mL   "
          f"LV mass {num(hm.get('LV_mass_g'), '.0f')} g   max wall thickness {num(hm.get('max_wall_thickness_mm'), '.1f')} mm")
    print(f"  strain: GRS {num(st.get('global_grs'), '+.1f')}%   GCS {num(st.get('global_gcs'), '.1f')}%")
    print(f"  health: {hs.get('status')}   most similar: {ds.get('most_similar')} — {ds.get('phenotype_headline')}")


def cmd_finalize(a):
    acct = template_account(a.template_account)
    done, state_path = load_state(a.project)
    if a.restart:
        done = []

    def step(name):
        return name not in done

    def mark(name):
        done.append(name)
        save_state(done, state_path)

    # 1. Checks, read straight from the database (so no need for your password):
    #    the project is yours and not yet a template, its edited masks cover
    #    ED and ES, and you have saved landmarks.
    if step("published"):
        chk = mongo(f"""
const P = {json.dumps({"projectId": a.project, "owner": a.user, "model": a.model})};
const owner = db.users.findOne({{ username: P.owner }});
const proj = db.projects.findOne({{ _id: ObjectId(P.projectId) }});
const out = {{ found: !!proj }};
if (proj) {{
  out.isTemplate = !!proj.isTemplate;
  out.ownerMatches = !!owner && proj.userid === owner._id.toString();
  out.frames = (proj.dimensions && proj.dimensions.frames) || 1;
  const m = db.getCollection("segmentation masks").findOne(
    {{ projectid: P.projectId, isMedSAMOutput: false, $or: [{{ segmentationModel: P.model }}, {{ model_used: P.model }}] }},
    {{ "frames.frameindex": 1, "frames.slices.segmentationmasks.class": 1, "editTracking.editedSliceCount": 1 }});
  out.hasMask = !!m;
  out.maskFrames = m ? m.frames.filter((f) => f.slices.some((s) => (s.segmentationmasks || []).length)).map((f) => f.frameindex) : [];
  out.editedSlices = m && m.editTracking ? m.editTracking.editedSliceCount : null;
  out.hasLandmarks = !!db.getCollection("project landmarks").findOne({{ projectid: P.projectId, isModelOutput: false }}, {{ _id: 1 }});
  out.hasLandmarkJob = !!db.jobs.findOne({{ projectid: {{ $in: [P.projectId, proj._id] }}, model_used: /landmark/i, status: "completed", result: {{ $exists: true, $ne: null }} }}, {{ _id: 1 }});
}}
print(JSON.stringify(out));
""", a.mongo_container)
        if not chk.get("found"):
            die(f"project {a.project} not found")
        if chk.get("isTemplate"):
            die("already a template — use --restart only after `unpublish`")
        if not chk.get("ownerMatches"):
            die(f"project {a.project} does not belong to {a.user}")
        ed, es = frame0(a.ed, chk["frames"], "ED"), frame0(a.es, chk["frames"], "ES")
        if not chk.get("hasMask"):
            die(f"no editable {a.model.upper()} segmentation")
        if ed not in chk["maskFrames"] or es not in chk["maskFrames"]:
            die("the ED or ES frame has no masks")
        if not chk.get("hasLandmarks"):
            die("no saved landmarks — check them on the landmark page and press Save first")
        if not chk.get("hasLandmarkJob"):
            die("the landmark model's results are missing (the server deletes jobs older than 3 days). Open the "
                "project's landmark page once so detection runs again — your saved landmark edits are kept — "
                "then run finalize")
        if not chk.get("editedSlices") and not a.allow_unedited:
            die("the masks are identical to the AI output (no saved edits) — save your edits in the "
                "segmentation editor first, or pass --allow-unedited to publish the AI masks as they are")

        # 2. Publish: move to the template account, mark as template
        label = CATEGORY_LABEL[a.category]
        name = a.name or f"Template – {label} ({a.sex})"
        note = a.note or default_note(a.project)
        desc = (f"Reference template: {label.lower()}, {a.sex}, age {a.age}, height {a.height} cm, weight {a.weight} kg."
                + (f" Subject {a.subject_code}." if a.subject_code else "")
                + f" ED frame {a.ed}, ES frame {a.es}. {note}")
        info = {"category": a.category, "sex": a.sex, "age": a.age, "heightCm": a.height, "weightKg": a.weight,
                "edFrame": ed, "esFrame": es, "order": a.order, "landmarkNote": note}
        if a.subject_code:
            info["subjectCode"] = a.subject_code
        params = {"projectId": a.project, "owner": a.user, "templateUser": acct["username"],
                  "info": info, "name": name, "description": desc}
        res = mongo(f"""
const P = {json.dumps(params)};
const tpl = db.users.findOne({{ username: P.templateUser }});
const owner = db.users.findOne({{ username: P.owner }});
if (!tpl) throw new Error("template account not found: " + P.templateUser);
const proj = db.projects.findOne({{ _id: ObjectId(P.projectId) }});
if (!proj) throw new Error("project not found");
const tplId = tpl._id.toString();
if (proj.userid !== tplId && (!owner || proj.userid !== owner._id.toString()))
  throw new Error("the project is not owned by " + P.owner);
db.projects.updateOne({{ _id: proj._id }}, {{ $set: {{ userid: tplId, isTemplate: true, templateInfo: P.info, name: P.name, description: P.description }} }});
const jobs = db.jobs.updateMany({{ projectid: {{ $in: [P.projectId, proj._id] }} }}, {{ $set: {{ userid: tplId }} }});
print(JSON.stringify({{ ok: true, jobsMoved: jobs.modifiedCount }}));
""", a.mongo_container)
        log(f"published as '{name}' (moved {res.get('jobsMoved')} jobs to the template account)")
        mark("published")

    # 3. Recompute everything as the template account
    api = Api(a.api)
    api.login(acct["username"], acct["password"])
    p = api.project(a.project)
    info = p.get("templateInfo") or {}
    ed, es = info["edFrame"], info["esFrame"]
    recompute_analyses(api, a.project, a.model, ed, es, step, mark)

    stale = clear_stale_jobs(a.project, a.mongo_container)
    if stale:
        log(f"cleared {stale} interrupted job(s) left 'running' from an earlier attempt")

    if step("reconstructions_reset"):
        code, body = api.call("DELETE", f"/reconstruction/delete-model-reconstruction/{a.project}", params={"segmentationModel": a.model})
        log("old 3D models removed:", body.get("message"))
        mark("reconstructions_reset")
    for chamber in ("lv", "rv"):
        if not step(f"reconstruction_{chamber}"):
            continue
        payload = {"reconstructionName": (f"RV Reconstruction — RESEARCH ONLY ({a.model.upper()}) - {p['name']}" if chamber == "rv"
                                          else f"4D Cardiac Reconstruction ({a.model.upper()}) - {p['name']}"),
                   "reconstructionDescription": "Template reconstruction", "ed_frame": ed + 1, "export_format": "glb",
                   "segmentationModel": a.model, "chamber": chamber,
                   "parameters": {"num_iterations": 200, "resolution": 128, "process_all_frames": True}}
        code, body = api.call("POST", f"/reconstruction/start-reconstruction/{a.project}", json=payload)
        if code != 200:
            die(f"{chamber.upper()} 3D build did not start ({code}): {body.get('message')}")
        uuid = body.get("uuid")
        log(f"{chamber.upper()} 3D build started (takes a few minutes)")

        def ready(c=chamber, u=uuid):
            if api.failed_job(u):
                die(f"{c.upper()} 3D build failed")
            code_, b = api.call("GET", f"/reconstruction/reconstruction-results/{a.project}")
            return any(r.get("chamber") == c and r.get("segmentationModel") == a.model for r in b.get("reconstructions", []))
        api.wait(f"{chamber} 3D build", ready, every=20, limit=7200)
        log(f"{chamber.upper()} 3D model ready")
        mark(f"reconstruction_{chamber}")

    # 4. Report
    m = api.editable_mask(a.project, a.model)
    hm = m.get("heartMetrics") or {}
    hs, ds = m.get("healthStatus") or {}, m.get("diseaseSimilarity") or {}
    print("\n==== Template ready:", p["name"], f"({a.project})")
    print(f"  LVEF {hm.get('LVEF', float('nan')):.1f}%   RVEF {hm.get('RVEF', float('nan')):.1f}%   "
          f"LVEDV {hm.get('LVEDV', float('nan')):.0f} mL   LVESV {hm.get('LVESV', float('nan')):.0f} mL   LV mass {hm.get('LV_mass_g', float('nan')):.0f} g")
    print(f"  health: {hs.get('status')}   most similar: {ds.get('most_similar')} — {ds.get('phenotype_headline')}")
    if a.gt_dir:
        import nibabel as nib
        lab = dict(LABELS[a.labels])
        vols = {}
        for which, t in (("ED", ed), ("ES", es)):
            img = nib.load(gt_file(a.gt_dir, t))
            g = np.asarray(img.dataobj)
            vox = float(np.prod(img.header.get_zooms()[:3])) / 1000.0
            vols[which] = ((g == lab["lvc"]).sum() * vox, (g == lab["rv"]).sum() * vox)
        lvef = (vols["ED"][0] - vols["ES"][0]) / vols["ED"][0] * 100
        rvef = (vols["ED"][1] - vols["ES"][1]) / vols["ED"][1] * 100
        print(f"  experts: LVEF {lvef:.1f}%   RVEF {rvef:.1f}%   LVEDV {vols['ED'][0]:.0f} mL   LVESV {vols['ES'][0]:.0f} mL")
    print("  View it: dashboard → Templates.")


# ── unpublish / list ──────────────────────────────────────────────────────────

def cmd_unpublish(a):
    res = mongo(f"""
const P = {json.dumps({"projectId": a.project, "to": a.to_user})};
const user = db.users.findOne({{ username: P.to }});
if (!user) throw new Error("user not found: " + P.to);
const proj = db.projects.findOne({{ _id: ObjectId(P.projectId) }});
if (!proj) throw new Error("project not found");
db.projects.updateOne({{ _id: proj._id }}, {{ $set: {{ isTemplate: false, userid: user._id.toString() }} }});
const jobs = db.jobs.updateMany({{ projectid: {{ $in: [P.projectId, proj._id] }} }}, {{ $set: {{ userid: user._id.toString() }} }});
print(JSON.stringify({{ ok: true, name: proj.name, jobsMoved: jobs.modifiedCount }}));
""", a.mongo_container)
    done_path = os.path.join(STATE_DIR, f"{a.project}.json")
    if os.path.exists(done_path):
        os.remove(done_path)
    log(f"'{res.get('name')}' is unlocked and back in {a.to_user}'s projects. Edit it, then run `finalize` again.")


def cmd_list(a):
    res = mongo("""
const out = db.projects.find({ isTemplate: true }, { name: 1, templateInfo: 1, userid: 1 }).toArray()
  .map((p) => ({ id: p._id.toString(), name: p.name, info: p.templateInfo || null }));
print(JSON.stringify({ templates: out }));
""", a.mongo_container)
    for t in res.get("templates", []):
        i = t.get("info") or {}
        print(f"{t['id']}  {t['name']}  [{i.get('category')}/{i.get('sex')}, ED {i.get('edFrame', -1) + 1}, ES {i.get('esFrame', -1) + 1}]")
    if not res.get("templates"):
        print("(no templates)")


# ── export: the published templates as seed files committed to the repo ───────
#
# The backend loads them on start-up (Cardiac_Segmentation_FYP_Server/src/services/
# template_seed.ts) on any machine that does not have them yet, so a teammate sees
# the templates after merging and restarting the stack, without running anything.

DEFAULT_SEED_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "visheart-local-deployment", "seed", "templates"))
# The collections that hold a template's documents besides `projects` (all keyed by projectid).
SEED_COLLECTIONS = ("segmentation masks", "project landmarks", "jobs", "4d reconstructions")


def mongo_lines(js: str, container: str) -> list[str]:
    """Like mongo(), but returns every line the script prints."""
    subprocess.run(["docker", "exec", "-i", container, "sh", "-c", "cat > /tmp/visheart_template_tool.js"],
                   input=js.encode("utf-8"), check=True)
    r = subprocess.run(["docker", "exec", container, "sh", "-c",
                        'mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" '
                        '--authenticationDatabase admin "$MONGO_INITDB_DATABASE" /tmp/visheart_template_tool.js'],
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        die(f"mongosh failed: {(r.stderr or r.stdout).strip()[:500]}")
    return [l for l in r.stdout.splitlines() if l.strip()]


def bucket_keys(value, prefixes: tuple[str, ...], out: set):
    """Collect the object keys of every s3:// or https://<bucket>... URL in an EJSON document."""
    if isinstance(value, str):
        for p in prefixes:
            if value.startswith(p):
                out.add(value[len(p):].split("?")[0])
    elif isinstance(value, list):
        for v in value:
            bucket_keys(v, prefixes, out)
    elif isinstance(value, dict):
        for v in value.values():
            bucket_keys(v, prefixes, out)


def cmd_export(a):
    import hashlib
    import lzma
    from concurrent.futures import ThreadPoolExecutor

    sha = lambda b: hashlib.sha256(b).hexdigest()
    os.makedirs(os.path.join(a.out, "db"), exist_ok=True)
    os.makedirs(os.path.join(a.out, "objects"), exist_ok=True)
    manifest_path = os.path.join(a.out, "manifest.json")
    old = json.load(open(manifest_path, encoding="utf-8")) if os.path.exists(manifest_path) else {}
    old_files = {o["key"]: o for t in old.get("templates", []) for o in t["objects"]}
    old_db = {t["project_id"]: t["db"] for t in old.get("templates", [])}

    def write_xz(rel: str, raw: bytes, digest: str, previous: dict | None) -> bool:
        """Compress `raw` to <out>/<rel>, unless the same content is already there (keeps git diffs empty)."""
        path = os.path.join(a.out, rel)
        if previous and previous.get("sha256") == digest and previous.get("file") == rel and os.path.exists(path):
            return False
        with open(path, "wb") as f:
            f.write(lzma.compress(raw, preset=9))
        return True

    # 1. Documents: every template's project + its masks, landmarks, jobs and 3D model
    #    records as canonical EJSON (keeps ObjectIds, dates and number types), one per line.
    lines = mongo_lines(f"""
const P = {json.dumps({"colls": SEED_COLLECTIONS})};
const out = (c, d) => print(EJSON.stringify({{ c: c, d: d }}, {{ relaxed: false }}));
const projects = db.projects.find({{ isTemplate: true }}).sort({{ "templateInfo.order": 1, _id: 1 }}).toArray();
for (const p of projects) {{
  const id = p._id.toString();
  print(JSON.stringify({{ template: id }}));
  out("projects", p);
  for (const c of P.colls) db.getCollection(c).find({{ projectid: {{ $in: [id, p._id] }} }}).sort({{ _id: 1 }}).forEach((d) => out(c, d));
}}
const owners = [...new Set(projects.map((p) => p.userid))];
print(JSON.stringify({{ owners: owners }}));
for (const o of owners) {{
  const u = db.users.findOne({{ _id: ObjectId(o) }});
  if (u) {{ delete u.password; out("users", u); }}   // the loader sets a fresh, unknown password
}}
""", a.mongo_container)
    templates, current, account = [], None, None
    for line in lines:
        j = json.loads(line)
        if "template" in j:
            current = {"project_id": j["template"], "lines": []}
            templates.append(current)
        elif "owners" in j:
            if len(j["owners"]) != 1:
                die(f"templates must all belong to one account, found {j['owners']}")
            current = None
        elif j.get("c") == "users":
            account = j["d"]
        else:
            current["lines"].append(line)
    if not templates:
        die("no published templates to export")
    if account is None:
        die("the template account was not found")

    # 2. Their files in MinIO: the image stacks and 3D models. The original .nii.gz scans
    #    are left out — only the AI pipeline reads them, and templates never run it.
    def minio(*cmd: str, binary: bool = False):
        return subprocess.run(["docker", "exec", a.minio_container, "mc", *cmd], capture_output=True, text=not binary)
    r = subprocess.run(["docker", "exec", a.minio_container, "sh", "-c",
                        'mc alias set visheart_seed http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"'],
                       capture_output=True, text=True)
    if r.returncode != 0:
        die(f"cannot reach MinIO in {a.minio_container}: {(r.stderr or r.stdout).strip()[:300]}")
    prefixes = (f"s3://{a.bucket}/", f"https://{a.bucket}.s3.amazonaws.com/")

    def export_object(key: str) -> dict | None:
        if key.endswith("/"):
            return None  # a folder path (basepath)
        st = minio("stat", "--json", f"visheart_seed/{a.bucket}/{key}")
        info = json.loads(st.stdout.strip().splitlines()[0]) if st.returncode == 0 and st.stdout.strip() else {}
        if info.get("type") != "file" or info.get("name") != os.path.basename(key):
            return None  # a folder, or a file an older job left behind and was since removed
        raw = minio("cat", f"visheart_seed/{a.bucket}/{key}", binary=True).stdout
        digest = sha(raw)
        rel = f"objects/{os.path.basename(key)}.xz"
        written = write_xz(rel, raw, digest, old_files.get(key))
        return {"key": key, "file": rel, "size": len(raw), "sha256": digest, "written": written}

    names, kept = set(), {"manifest.json", "db/template_account.json"}
    out_templates = []
    with ThreadPoolExecutor(max_workers=2) as pool:  # lzma preset 9 needs ~0.7 GB per worker
        for t in templates:
            docs = [json.loads(l) for l in t["lines"]]
            project = next(d["d"] for d in docs if d["c"] == "projects")
            keys: set = set()
            for d in docs:
                bucket_keys(d["d"], prefixes, keys)
            keys = sorted(k for k in keys if not k.endswith(".nii.gz"))
            log(f"{project['name']}: {len(docs)} documents, {len(keys)} file paths")
            objects = [o for o in pool.map(export_object, keys) if o]
            for o in objects:
                if o["file"] in names:
                    die(f"two files share the name {o['file']}")
                names.add(o["file"])
                log(f"   {'wrote' if o.pop('written') else 'kept '} {o['file']}  ({o['size'] / 1e6:.1f} MB)")
            raw_db = ("\n".join(t["lines"]) + "\n").encode("utf-8")
            db_rel = f"db/{t['project_id']}.ndjson.xz"
            db_entry = {"file": db_rel, "sha256": sha(raw_db),
                        "documents": {c: sum(d["c"] == c for d in docs) for c in ("projects",) + SEED_COLLECTIONS}}
            write_xz(db_rel, raw_db, db_entry["sha256"], old_db.get(t["project_id"]))
            version = sha((db_entry["sha256"] + "".join(f"\n{o['key']} {o['sha256']}" for o in objects)).encode())[:16]
            out_templates.append({"project_id": t["project_id"], "name": project["name"], "version": version,
                                  "db": db_entry, "objects": objects})
            kept.update([db_rel, *(o["file"] for o in objects)])

    with open(os.path.join(a.out, "db", "template_account.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(account, f, indent=1, ensure_ascii=False)
        f.write("\n")
    manifest = {"format": 1, "bucket": a.bucket, "template_account": "db/template_account.json", "templates": out_templates}
    with open(manifest_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=1, ensure_ascii=False)
        f.write("\n")

    # Drop files of templates or 3D models that no longer exist.
    for sub in ("db", "objects"):
        for name in os.listdir(os.path.join(a.out, sub)):
            if f"{sub}/{name}" not in kept:
                os.remove(os.path.join(a.out, sub, name))
                log(f"removed {sub}/{name}")
    total = sum(os.path.getsize(os.path.join(dp, n)) for dp, _, fs in os.walk(a.out) for n in fs)
    log(f"exported {len(out_templates)} templates to {a.out} ({total / 1e6:.0f} MB). Commit that folder; "
        "the backend loads it on start-up on machines that don't have these templates yet.")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default="http://localhost:5000", help="backend URL (default %(default)s)")
    ap.add_argument("--mongo-container", default="visheart-mongodb", help="MongoDB container (default %(default)s)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p, need_user=True):
        p.add_argument("--project", required=True, help="project ID (from the project page URL)")
        if need_user:
            p.add_argument("--user", required=True, help="your VisHeart username (the project's owner; "
                                                          "prepare/landmarks/recompute ask for its password, finalize doesn't)")
        p.add_argument("--model", default="unet", choices=["unet", "medsam"], help="segmentation model (default unet)")

    p = sub.add_parser("prepare", help="load the experts' masks into ED and ES")
    common(p, need_user=False)
    p.add_argument("--user", help="your VisHeart username (the project's owner); not needed with --published")
    p.add_argument("--published", action="store_true",
                   help="the project is already a published template: work as the template account, "
                        "then run `finalize` again to recompute")
    p.add_argument("--template-account", default=DEFAULT_ACCOUNT_FILE, help="JSON with the template account's login")
    p.add_argument("--gt-dir", required=True, help="subject folder with <code>_<frame>_gt.nii.gz files")
    p.add_argument("--ed", type=int, required=True, help="ED frame number (1-based, as shown in the app)")
    p.add_argument("--es", type=int, required=True, help="ES frame number (1-based)")
    p.add_argument("--labels", default="mnms", choices=list(LABELS), help="label convention of the expert files (default mnms)")
    p.add_argument("--yes", action="store_true", help="don't ask for confirmation")
    p.set_defaults(func=cmd_prepare)

    p = sub.add_parser("landmarks", help="pre-fill RV insertion points from your corrected masks")
    common(p)
    p.add_argument("--overwrite", action="store_true", help="replace landmark edits that are already saved")
    p.set_defaults(func=cmd_landmarks)

    p = sub.add_parser("recompute", help="recompute every result of your (unpublished) project, without publishing")
    common(p)
    p.add_argument("--ed", type=int, required=True, help="ED frame number (1-based, as shown in the app)")
    p.add_argument("--es", type=int, required=True, help="ES frame number (1-based)")
    p.add_argument("--height", type=float, help="cm — with --weight, gives indexed values (mL/m2, g/m2)")
    p.add_argument("--weight", type=float, help="kg")
    p.add_argument("--sex", choices=["female", "male"])
    p.add_argument("--category", choices=list(CATEGORY_LABEL))
    p.set_defaults(func=cmd_recompute)

    p = sub.add_parser("finalize", help="publish as a template and recompute everything")
    common(p)
    p.add_argument("--category", required=True, choices=list(CATEGORY_LABEL))
    p.add_argument("--sex", required=True, choices=["female", "male"])
    p.add_argument("--age", type=int, required=True)
    p.add_argument("--height", type=float, required=True, help="cm")
    p.add_argument("--weight", type=float, required=True, help="kg")
    p.add_argument("--ed", type=int, required=True, help="ED frame number (1-based)")
    p.add_argument("--es", type=int, required=True, help="ES frame number (1-based)")
    p.add_argument("--subject-code", help="dataset subject code, e.g. A5Q1W8")
    p.add_argument("--order", type=int, default=99, help="card order on the Templates tab")
    p.add_argument("--name", help="template name (default 'Template – <category> heart (<sex>)')")
    p.add_argument("--note", help="how the masks/landmarks were made (shown on the read-only page)")
    p.add_argument("--gt-dir", help="expert files, to print the experts' values next to the app's")
    p.add_argument("--labels", default="mnms", choices=list(LABELS))
    p.add_argument("--template-account", default=DEFAULT_ACCOUNT_FILE, help="JSON with the template account's username/password")
    p.add_argument("--restart", action="store_true", help="redo every step instead of resuming")
    p.add_argument("--allow-unedited", action="store_true", help="publish even if the masks have no saved edits")
    p.set_defaults(func=cmd_finalize)

    p = sub.add_parser("unpublish", help="unlock a template and give it back to a user")
    p.add_argument("--project", required=True)
    p.add_argument("--to-user", required=True, help="username to give the project back to")
    p.set_defaults(func=cmd_unpublish)

    p = sub.add_parser("list", help="list the current templates")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("export", help="write the published templates to the repo's seed folder (commit it to share them)")
    p.add_argument("--out", default=DEFAULT_SEED_DIR, help="seed folder (default visheart-local-deployment/seed/templates)")
    p.add_argument("--minio-container", default="visheart-minio", help="MinIO container (default %(default)s)")
    p.add_argument("--bucket", default="visheart-bucket", help="bucket the app stores files in (default %(default)s)")
    p.set_defaults(func=cmd_export)

    a = ap.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
