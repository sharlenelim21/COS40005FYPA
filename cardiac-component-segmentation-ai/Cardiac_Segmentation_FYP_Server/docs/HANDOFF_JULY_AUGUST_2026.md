# VisHeart — Handoff: work since `dev` (Jul 1 – Jul 31, 2026)

**Purpose of this file:** `test/sharlene-hackathon` is 43 commits ahead of `dev`
with zero commits the other way (`dev` is a strict ancestor). If you start a new
repository from `dev`, this document — plus the commit list below, which you can
cherry-pick or re-apply — is what reproduces the current state. Read this FIRST
in any new session before touching the pipeline; it explains not just *what*
changed but *why*, which matters because several of the fixes correct a wrong
first instinct (documented below so it isn't repeated).

Read alongside:
- `docs/HEART_METRICS_IMPLEMENTATION.md` — heart-metrics formulas & references
- `docs/DISEASE_SIMILARITY_REFERENCES.md` — disease-similarity methodology & citations

---

## 1. The 43 commits, in order

```
23debe8  2026-07-01  sharlenelim21  Connect the editable landmark to the backend
f2b82df  2026-07-14  Moonnie88      Fix GCS to use mid-wall radius and global metrics to use ratio-of-means
e82e1e7  2026-07-14  Moonnie88      Disable checkpoint bind-mount that shadows working landmark models
09f6a22  2026-07-14  Moonnie88      Fix crash when a segmentation model has no valid myocardium in any slice
787bbdb  2026-07-15  Moonnie88      fix: correct RV-insertion alignment angle formula for landmark-derived strain orientation
2fa4f37  2026-07-15  Liew Mei Qi    Add regional strain analysis views and printable patient report
5e8bbb0  2026-07-15  Moonnie88      fix: rewire Bullseye tab to landmark-aware GPU path, fix NaN-crash in stats
4011b95  2026-07-15  Moonnie88      ui: redesign strain compute panel with dual-handle frame picker
6413c41  2026-07-15  jy465          Add heart metrics export pipeline
908a47c  2026-07-16  sharlenelim21  Merge 'origin/metrics-jy'
ea279b1  2026-07-16  sharlenelim21  Merge 'test/stefani'
a28c50b  2026-07-16  sharlenelim21  combined with stefani's and jy's metrics changes, added disease pattern similarity integration
32a5bd0  2026-07-17  sharlenelim21  Landmark persistence + shared edits + bullseye recompute
55c8f25  2026-07-19  sharlenelim21  Wire disease-similarity pipeline: persist strain, auto-chain, fix stale caches
c627633  2026-07-19  sharlenelim21  Add per-model results page (mockup) for metrics + disease similarity
e2d4096  2026-07-21  sharlenelim21  changes
4583451  2026-07-22  jy465          Add health status pipeline and metrics hardening
537e51b  2026-07-22  jy465          Merge 'origin/test/meiqi-fypB-ui'
ca66835  2026-07-23  sharlenelim21  update
09c59f7  2026-07-23  sharlenelim21  Merge 'metrics-jy'
b55e200  2026-07-23  sharlenelim21  Add per-frame strain series with wall thickness
574b72a  2026-07-23  sharlenelim21  Fix strain playback axis and wire strain UI to computed data
a67d10f  2026-07-23  sharlenelim21  Render report from stored results with interactive screen view
7d45f77  2026-07-23  sharlenelim21  Split landmark detection into Landmarks and Strain workspaces
ef89f95  2026-07-26  jy465          feat(heart-metrics): duplicate-slice detection + soft-exclude resolution (Task 3)
0e276e3  2026-07-27  sharlenelim21  Polish landmark/strain UI: model defaults, tab fixes, region charts
e8dcc4d  2026-07-27  sharlenelim21  Fix tab desync, add CSV export, shared tooltips, report polish
fc35d1e  2026-07-27  sharlenelim21  Updated Chart fix
b65454a  2026-07-27  sharlenelim21  remove the A4 and pages header in report page
8a1ed99  2026-07-27  jy465          Merge 'origin/test/sharlene'
cb069fd  2026-07-27  sharlenelim21  Connected research assistant chatbot to the system, fixed the footer, and fix ui for chatbot
78f619b  2026-07-29  sharlenelim21  fixed all the stale and persistence bugs for strain page
fca947d  2026-07-29  sharlenelim21  Update research api with Unpaywall (Free PDFs)
2b2e000  2026-07-29  Liew Mei Qi    Update landmark docs, assets and home UI
c200207  2026-07-29  jy465          Add advisory regional health status pipeline
fa9ca8c  2026-07-29  sharlenelim21  Fix dark-mode charts, compute/loading labels, remount flashes
993c98a  2026-07-29  sharlenelim21  Update CardiacResearchAssistant.tsx
08e896b  2026-07-29  jy465          Merge 'origin/test/sharlene-research-assistant-testing'
8113603  2026-07-29  sharlenelim21  Merge 'origin/test/meiqi-fypB-ui'
7830017  2026-07-30  jy465          fix(report): correct mirrored AHA bullseye geometry
d91cf18  2026-07-30  jy465          Improve report UX and extend API timeout
0913e46  2026-07-30  sharlenelim21  Merge 'origin/metrics-jy'
1ce5b37  2026-07-31  sharlenelim21  Update LandmarkSidebar.tsx
```

If the new repo is created by branching from `dev`, the fastest reproduction is
`git cherry-pick 23debe8^..1ce5b37` (or just merge the old branch in) rather than
re-typing anything by hand — this doc is for understanding *why*, not for typing
code back in.

---

## 2. The pipeline, end to end

```
Segmentation (UNet / MedSAM)
        ↓
Heart Metrics  (EF, EDV, ESV, SV, LV mass, auto ED/ES)
        ↓
Strain  — two distinct computes, often confused, see §3
        ↓
Health Status (rule-based, ASE/EACVI-style)  +  Regional Health Status (advisory, per-AHA-segment)
        ↓
Disease Pattern Similarity (NOR/HCM/DCM, z-score + softmax — NOT a diagnosis)
        ↓
Report (screen + PDF, one shared data source)  +  CSV export  +  Research Assistant chatbot
```

Everything is **per segmentation model** — UNet and MedSAM are separate mask
documents in Mongo (`segmentationModel` field) and are scored independently,
because they segment differently and can disagree substantially (seen in
practice: MedSAM strain came out physiologically implausible on the same heart
UNet handled fine).

### Key non-negotiable design rules established this session

1. **Never show fabricated/dummy data next to real data without saying so.**
   Every panel that used to fall back to a sine-wave/dummy generator when no
   real compute existed now shows an explicit empty state instead ("No strain
   computed for this model yet — Compute all frames"). This was a repeated
   theme — multiple dummy fallbacks were found and removed over the session.
2. **One source of truth per piece of state**, not one per widget. The biggest
   recurring bug class this session was *desync*: bullseye showing one model,
   strain tab showing another, tab switching not agreeing between panels. Fixed
   by lifting `activeModel` and `workspace` (tab) to the page and persisting
   them in the URL query string (`?tab=strain&model=unet`) rather than letting
   each component keep its own copy.
3. **Strain peaks only feed clinical modules (disease similarity, health
   status) when computed at the auto-detected true ED/ES frames** — not an
   arbitrary user-picked range. Off-frame strain is still shown for inspection
   but is excluded from scoring (backend writes `null` rather than a
   misleading value). See `assembleSimilarityMeasurements()` in
   `segmentation_routes.ts`.
4. **Report screen and PDF must never disagree** — both read from one shared
   hook (`useProjectResults`), so the model shown on screen is guaranteed to
   be the model in the exported PDF/CSV.

---

## 3. §3 — Strain: the ED→ES single result vs. the full-cycle series

This distinction caused confusion more than once and is worth stating
precisely for a fresh session:

| | **ED→ES single strain** (`strain` field) | **Full-cycle series** (`strainSeries` field) |
|---|---|---|
| Trigger | "Compute Strain" button, picker chooses ED/ES frames | "Compute all frames" button |
| GPU calls | 1 (`/bullseye/compute-strain`, ED vs ES) | N (one per frame, ED held fixed as reference) |
| Output | Global GRS/GCS + 17-segment GRS/GCS/wall-thickness, **2 points** | Same fields **per frame** — a real curve |
| Feeds bullseye animation? | No (single measurement, static) | Yes (`wt_mm` per frame → animated wall thickness) |
| Feeds Strain Results side panel (Current/Peak, Global/Region/Cycle charts)? | Only if series absent (fallback) | Yes, primary source |
| Feeds disease similarity / health status? | Yes, IF computed at true auto ED/ES | Not directly — those read the single `strain` result |

**Wall thickness (bullseye tab) and strain % (side panel / report bullseye) are
two different fields extracted from the same per-frame GPU call** — never two
separate computations. The GPU returns both `wt_es_mm` (thickness) and
`grs`/`gcs` (strain) from one comparison; the frontend just plots different
fields into differently-labelled widgets. The **report page's own bullseye**
plots strain (`grs`/`gcs`), not thickness — genuinely a different metric than
the landmark-detection page's bullseye tab, despite looking like the same
widget. Worth calling out explicitly in any demo.

**Backend routes** (`segmentation_routes.ts`):
- `POST /segmentation/compute-strain-from-frames` — the single ED→ES result
- `POST /segmentation/compute-strain-series` — the full-cycle series (added
  this session; bounded concurrency of 3, `frameStep` param for subsampling,
  a failed individual frame is skipped rather than failing the whole batch)

---

## 4. Heart Metrics

`compute_heart_metrics_from_rle.py`. EF/EDV/ESV/SV/LV mass from voxel counts ×
the project's stored NIfTI affine. **EF is a ratio** so it's immune to
spacing/scaling bugs that hit absolute volumes.

- **Auto ED/ES detection**: ED = frame with the largest LV-cavity voxel count,
  ES = the smallest (among frames with positive LV). This is the standard
  method and is correct — it runs on the *model's own segmentation*, so it can
  differ by a frame or two from expert-annotated ground truth (e.g. the ACDC
  info CSV). That difference is a measure of segmentation quality on those
  phases, not a detection bug. Documented directly in the Python file's
  comments so this isn't re-litigated.
- **Duplicate-slice detection** (Jiayi, `ef89f95`) — catches copied/
  re-appended slices that would otherwise double-count and inflate volumes.
- **Known unresolved issue, flagged but not fixed this session**: absolute
  volumes (EDV specifically) were observed roughly 2× too high in the report
  on at least one project (306.9 mL). EF was unaffected. Root cause not
  confirmed — worth investigating voxel-spacing / affine handling before
  trusting absolute volumes in a demo.

---

## 5. Health Status

Two layers, deliberately separate:

1. **Overall Health Status** (`compute_health_status.py`, Jiayi) — rule-based
   grading of LV systolic function (Healthy/Mild/Moderate/Severe) against
   ASE/EACVI-style thresholds on EF, EDV, strain. Fully deterministic,
   evidence lines printed per threshold check.
2. **Regional Health Status** (`compute_regional_health_status.py`, Jiayi,
   `c200207`) — an *advisory* layer sitting beside the overall grade, flagging
   individual AHA segments with reduced strain (`reduced_count`,
   `affected_idx`). It **never changes** the overall grade
   (`overall_grade_unchanged: true` always) — it's a callout, not a
   diagnosis-in-itself. Only meaningful when the strain frames align with the
   auto-detected ED/ES (same guard as §3).

**Important operational note**: this module was merged into the codebase
(`c200207`) but the running backend needs `pnpm build` + container
restart before it's live — the compiled `dist/python/` and
`dist/services/*.js` need to actually contain the new module. This was missed
at least once this session (regional findings appeared to "not show" when it
was actually a stale build, not a code bug). **Always rebuild + restart after
merging or pulling backend changes before concluding something is broken.**

---

## 6. Disease Pattern Similarity

`compute_disease_similarity.py`. NOT a diagnosis — a similarity comparator.

- **Method**: z-score weighted Euclidean distance against three reference
  profiles (NOR/HCM/DCM) → softmax → percentage. Chosen over Mahalanobis
  (needs training data/covariance we don't have) and cosine (ignores
  magnitude — wrong for volumetric data).
- **Inputs**: EF, EDV, ESV, StrokeVolume, PeakGRS, PeakGCS. Weights: EF & EDV
  = 1.0 (primary discriminators), ESV = 0.8, StrokeVolume = 0.5 (redundant
  with EDV−ESV), PeakGRS/PeakGCS = 0.6 (supporting evidence, gated by the
  ED/ES-alignment rule in §3).
- **Reference range provenance — read this before presenting it as fact**:
  the EF/EDV numbers are grounded in **ACDC cohort statistics** (the same
  dataset the segmentation model trains on), which is defensible since it's
  project-aligned data. **However**, the *exact* published table those numbers
  were pulled from could not be conclusively traced to a single citable paper
  during this session — multiple search/verification attempts did not
  resolve it. ESV/StrokeVolume standard deviations are estimates (not
  published), derived arithmetically from EF+EDV, not measured. **Do not
  present these reference ranges as peer-reviewed without independently
  verifying the source before any formal presentation or report.** This is
  documented in detail in `docs/DISEASE_SIMILARITY_REFERENCES.md`.
- **Output includes per-metric reasoning** ("Why DCM") — this was previously
  computed but not displayed in the report; now shown (`e8dcc4d`).

---

## 7. Report (screen + PDF) + CSV Export + Chatbot

### Report — one data source, two presentations
`useProjectResults` (frontend hook) is the single source of truth for a
project's stored per-model results — measurements, strain, health status,
disease similarity. Both the interactive **screen** view
(`InteractiveReport.tsx`) and the paginated **A4 PDF**
(`ReportPageFrame.tsx` + friends) read from the same hook call, so they cannot
disagree. `window.print()` renders the same underlying data as the screen.

- **Model selection**: defaults to whichever model (UNet/MedSAM) was most
  recently computed — no manual toggle on the report (client-requested: "one
  report, not a confusing choice"). `useProjectResults(projectId, "recent")`.
- **Empty/no-data state**: if nothing has been computed, the PDF prints
  "No results to report" rather than ever showing placeholder numbers — this
  was a real bug found and fixed (`e8dcc4d`): the PDF used to fall back to
  hardcoded demo numbers (EF 58%, "Healthy") completely independent of the
  patient's actual (possibly Severe) status.
- **Bullseye colour scale**: uses the same red→green contraction gradient as
  the landmark-detection bullseye (continuous interpolation, not discrete
  bands) so the two visually read the same way, even though (per §3) they can
  be plotting different metrics.
- **Mirrored AHA geometry bug** — found and fixed by Jiayi (`7830017`): the
  report's bullseye had reversed left/right orientation vs. clinical
  convention.

### CSV Export (`exportResultsCsv.ts`)
Was a placeholder `alert()` until this session. Now a real sectioned CSV:
measurements, health status + evidence, disease similarity + reasoning,
per-segment ED→ES strain, and the full per-frame series — for **both**
models, real values only (blank cells for anything not computed), UTF-8 BOM
for Excel, non-diagnostic disclaimers written into the section headers so
they travel with the exported file.

### Research Assistant chatbot
Separate service/repo: `cardiac-research-assistant`. FastAPI + Ollama
(Qwen 2.5, local LLM) + retrieval-augmented generation grounded in literature
(with Unpaywall integration for free PDF retrieval, `fca947d`). Connected
into the report page this session (`cb069fd`). **To run it**: Ollama must be
running locally (`ollama pull qwen2.5:7b` once, then it serves via its own
daemon), then `uvicorn app:app --reload --port 8000` from that repo's
`backend/` folder. Not part of the main Docker Compose stack — runs
separately.

---

## 8. UI architecture — Landmarks vs. Strain workspace split

The landmark-detection page was restructured this session
(`7d45f77`, `0e276e3`, `e8dcc4d`) into two **workspaces**, not just two tabs:

- **Landmarks workspace** — MRI slice viewer only (widened to fill the space),
  playback steps through **slices**, per-slice confidence indicator strip
  (green/orange/grey — high/low/collapsed-to-mean), Save button lives here
  (blinks/pulses when there are unsaved edits).
- **Strain workspace** — bullseye + 3D heart only (MRI viewer hidden),
  playback steps through **cardiac frames** (a completely different axis from
  slices — this was a real, confusing bug: the header used to show a slice
  count mislabelled as "Frames").

**Root causes fixed, worth knowing so they aren't reintroduced:**
- `state.totalFrames` in the old code was actually a **slice count** (landmark
  detection runs per-slice), mislabelled throughout the UI as "frames."
  Playback showed "1/10" on a 30-frame study because of this.
- The resizable panel group was keyed on workspace to force clean re-layout
  on switch, which had the side effect of **remounting the sidebar**, which
  reset its internal tab state back to "Landmarks" even when the page thought
  it was on "Strain" — a real desync bug, fixed by controlling the tab from
  the page (`activeTab` prop) instead of local state.
- Dark-mode chart text was invisible: CSS wrapped theme tokens as
  `hsl(var(--x))`, but the tokens are `oklch()` values — `hsl()` around an
  `oklch()` value is invalid, silently rendering as black-on-black. Fixed by
  using `var(--x)` directly (26 occurrences across 3 chart files).
- `useProjectResults` mounts multiple times per page (bullseye panel, strain
  tab, etc.) and the sidebar remounts on every tab switch — each instance
  used to start at `masks=null`, causing an empty-flash-then-populate glitch
  and model-switch lag. Fixed with a module-level cache keyed by projectId so
  remounts seed synchronously.

---

## 9. Known open issues at end of session (not fixed, worth tracking)

1. **EDV possibly ~2× too high** on at least one project (306.9 mL) — EF
   unaffected. Not root-caused.
2. **MedSAM strain values sometimes physiologically implausible** (e.g. GRS
   83.2%, GCS −0.08% on a heart where UNet gave 14.5%/−10.2%) — a computation
   quality issue, not a display bug. Worth investigating the MedSAM
   segmentation quality on ED/ES frames specifically.
3. **Disease-similarity reference range citation unverified** — see §6.
   Needs a real literature search with a human verifying the exact source
   table before this can be presented as peer-reviewed-grounded in a formal
   report.
4. **Per-slice landmark delete** — requested, scoped, deliberately deferred as
   too large to do safely inside an already-large batch. Needs: a
   deleted/hidden flag per landmark per slice in the edit model, delete UI in
   the slice viewer, save-serialization support, and bullseye/strain handling
   for slices with no landmarks.
5. **Multi-chamber (LA) strain — assessed as infeasible**, not just
   deferred: there is no LA segmentation class (`RV`/`MYO`/`LVC` only), ACDC
   (the training dataset) has no LA labels to fine-tune on, and LA reservoir
   strain is inherently a long-axis measurement while this pipeline is
   short-axis only. Do not attempt without a different dataset + retrained
   segmentation + long-axis view support.
6. **RV free-wall strain — feasible but nontrivial**, not a quick add: the
   existing strain algorithm (`visheart-inference-gpu/app/bullseye_analysis.py`)
   ray-casts from a centroid outward, which works because the LV myocardium is
   a closed ring around that centroid. The RV free wall is a crescent, not a
   ring — rays would cross the septum (wrong tissue) or miss entirely. Needs
   genuinely new geometry (arc-parameterised, not radial), not a
   parameter change. RV **volumetric** comparison (RVEF/RVEDV/RVESV vs LV,
   already computed and stored, just not surfaced) is the cheap, feasible
   version of the same clinical idea — recommended over free-wall strain if
   time is limited.

---

## 10. Operational reminders for a fresh session

- **Backend runs from `dist/`, not `src/`, in Docker.** After any backend
  `.ts`/`.py` change: `pnpm build` in `Cardiac_Segmentation_FYP_Server`, then
  `docker restart visheart-local`. Missing this step was the cause of more
  than one "why isn't this showing" investigation this session.
- **Frontend hot-reloads** via `pnpm dev` on port 5001 — no rebuild needed for
  `.tsx` changes, but `rm -rf .next && pnpm dev` if something looks stale
  after a big merge.
- **MongoDB collection name has a space**: `"segmentation masks"` (from the
  Mongoose model name `"Segmentation Masks"`), not `segmentationmasks`.
  `projectid` is stored as a **String**, not `ObjectId` — quote it in Compass
  queries.
- **ACDC dataset must never be committed** — it's gitignored (`/acdc/` at
  repo root, `data/` inside the server folder). ~2GB of NIfTI files.
- Docker Desktop itself must be running before `docker start`/`restart` will
  work at all — was a recurring false alarm this session ("container won't
  start" was actually "Docker Desktop isn't open").
