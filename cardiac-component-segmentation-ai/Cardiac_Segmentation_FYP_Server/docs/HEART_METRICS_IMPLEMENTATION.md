# Heart Metrics — Implementation Guide

Feature branch: `metrics-jy`
Audience: a student new to VisHeart who needs to understand every moving part.

---

## 1. Overview

This feature adds a **new pipeline that computes cardiac clinical metrics from
the segmentation masks already stored in MongoDB** and stores them on the same
mask document, parallel to the existing `bullseye` field. It is **purely
additive** — nothing in the existing segmentation, strain, bullseye, landmark,
reconstruction, or export code was renamed or refactored.

Clinical meaning of each metric, in one line each:

| Metric | One-line meaning |
|--------|-------------------|
| **EDV** (End-Diastolic Volume, mL) | The size of the LV chamber when it is *fullest* — just before it contracts. |
| **ESV** (End-Systolic Volume, mL)  | The size of the LV chamber when it is *smallest* — right after it has contracted. |
| **SV** (Stroke Volume, mL)         | Blood ejected in one beat: `EDV − ESV`. |
| **EF** (Ejection Fraction, %)      | Fraction of the LV that is squeezed out per beat: `SV / EDV × 100`. The single most important number for pump function. |
| **LV mass** (grams)                | Weight of the LV wall muscle at ED. Elevated in hypertrophy. |

Everything above is derived **without patient demographics** (no height, no
weight). See §3 for why EF in particular is body-size-independent.

For where this fits in the wider Metrics → Strain → Disease-Similarity chain
see §2. For the safety net that catches bad affines / duplicated slices
before they poison the similarity comparison, see §9.

---

## 2. The `measurements` object — report-page integration contract

The Python script emits a **flat, generic-keyed `measurements` block at the
top of its output**. This is the *only* block the report page (and any future
consumer that just wants "the numbers") needs to read.

```json
"measurements": {
  "EF":           64.23,   // alias of LVEF
  "EDV":          152.33,  // alias of LVEDV
  "ESV":          54.49,   // alias of LVESV
  "StrokeVolume": 97.85,   // alias of LV_SV
  "PeakGRS":      null,    // filled by the strain pipeline at report assembly
  "PeakGCS":      null     // filled by the strain pipeline at report assembly
}
```

Contract rules:

- **Aliases, not recalculations.** `measurements.EF` is exactly the same
  Python float object as `LVEF` at the point of serialisation. A dedicated
  test asserts `measurements.EF === LVEF` by strict identity — if that
  assertion ever fires, the alias has drifted and the report will diverge.
- **Keys are generic.** No `LV` prefix; consumers do not need to know these
  numbers happen to be LV-derived.
- **Shape is stable.** `PeakGRS` and `PeakGCS` are always present. The heart-
  metrics script leaves them as `null`; the report assembler fills them from
  the strain pipeline (Peak **G**lobal **R**adial / **C**ircumferential
  **S**train). If strain hasn't run yet, they stay null and the report shows
  em-dashes — no crash.
- **Longform fields stay too.** `LVEDV`, `LVEF`, `RVEDV`, `RVEF`, `LV_mass_g`,
  `lv_volumes_ml[]`, `warnings[]`, spacing, units etc. remain untouched below
  `measurements` for anything that needs the RV side, the volume curve for a
  plot, or the per-mask audit trail.

The report page should read `mask.heartMetrics.measurements`; every other
consumer keeps reading `mask.heartMetrics.<LV-prefixed field>` and is
unaffected.

### 2.1 Where this fits in the wider pipeline

The heart-metrics compute is the **first** step in a three-stage per-mask
chain now wired into the backend. See `PIPELINE_INTEGRATION.md` (Sharlene,
branch `test/sharlene-disease-prediction`) for the full picture; the
one-paragraph summary is:

```text
   (this module)                (Stefani)                    (Sharlene)
   Heart Metrics    ─────►      Strain                ─────► Disease Similarity
   heartMetrics.                strain.global_grs            diseaseSimilarity
   measurements                 strain.global_gcs            (most_similar,
     .EF, .EDV,                 backfilled into              per-pattern %,
     .ESV, .StrokeVolume        heartMetrics                 reasoning)
     .PeakGRS = null            .measurements.PeakGRS
     .PeakGCS = null            .measurements.PeakGCS
```

- Strain runs **at the ED/ES frames this module auto-detected**
  (`heartMetrics.ed_frame` / `es_frame`). Overriding them here changes the
  frame pair strain uses — keep that in mind before setting overrides.
- Once strain finishes it backfills `measurements.PeakGRS` and
  `measurements.PeakGCS`, then auto-fires the similarity compute. Any
  consumer that reads `measurements` after that point sees a complete
  six-feature vector.
- Similarity **only trusts strain peaks computed at the metrics-module's
  ED/ES frames**; otherwise it falls back to volume-only features. So the
  ED/ES numbers this module emits are load-bearing for the whole chain.
- **Because similarity consumes the numbers this module produces, a bad
  affine here silently propagates into a wrong disease-pattern match**.
  See §9 for the guards that make that failure loud.

---

## 3. The math — auditable end to end

### 3.1 Voxel → mm → mL

A **voxel** is a 3D pixel. Cardiac MRI voxels are usually anisotropic — thin
in-plane (~1.5 mm) and much thicker through-plane (~5–10 mm). Two voxels of
the same *count* can mean very different volumes, so you must always multiply
by the physical voxel volume:

```text
spacing = sqrt( sum(affine[:3, :3] ** 2, axis=0) )      # -> (dx, dy, dz) in mm
voxel_mm3 = dx * dy * dz                                 # mm^3 per voxel
volume_mL = voxel_count * voxel_mm3 / 1000.0             # 1 mL = 1000 mm^3
```

*Why the L2 norm of each affine column?* — The NIfTI affine's first three
columns are `direction_cosine * spacing_along_that_axis`. The direction
cosines are unit vectors, so their norm equals the spacing scalar. This
extracts spacing correctly even if the scanner acquired the volume off-axis.

**Never hardcode spacing.** Rotated scans, non-square pixels, and coarse
short-axis stacks all break constant-spacing assumptions.

### 3.2 ED / ES auto-detection

For every frame we count LV-cavity (label 3) voxels across all its slices,
convert to mL, then:

- `ed_frame = argmax(LV_volume_per_frame)` — the fullest chamber is
  end-diastole.
- `es_frame = argmin(LV_volume_per_frame)` restricted to frames with
  positive LV volume — an all-zero frame is an unsegmented phase, not a real
  "smallest" candidate.
- The caller can override by passing `ed_frame` and/or `es_frame` in the
  input JSON. Overrides are only honoured when they refer to a frame that
  actually contains LV voxels (silently ignored otherwise, so the caller
  can't accidentally aim ED at an empty phase).

### 3.3 Volumes, EF, mass

```text
LVEDV = LVC_voxels_at_ED * voxel_mm3 / 1000
LVESV = LVC_voxels_at_ES * voxel_mm3 / 1000
LV_SV = LVEDV - LVESV
LVEF  = (LVEDV - LVESV) / LVEDV * 100
RVEDV, RVESV, RV_SV, RVEF   # same, on class 1 (RV)
LV_mass_g = MYO_voxels_at_ED * voxel_mm3 / 1000 * 1.05     # 1.05 g/mL
```

Muscle density `1.05 g/mL` is the standard cardiology constant used by ACDC
and Bernard et al. 2018 (§ 6).

### 3.4 Why EF needs no patient data

EF is a ratio of two volumes measured on the *same image*, in the *same
voxel units*:

```
EF = (EDV - ESV) / EDV
   = (voxel_mm3 * (n_ED - n_ES) / 1000)  /  (voxel_mm3 * n_ED / 1000)
   = (n_ED - n_ES) / n_ED
```

The `voxel_mm3` and the `/ 1000` cancel. EF is dimensionless — it is
independent of image spacing, body size, and even whether you converted to mL
at all. That is why we can (and do) report EF without collecting height or
weight from the patient. Absolute volumes and mass are **not** ratios and do
depend on spacing, which is why a valid 4×4 affine is a hard requirement
(see §4.2).

### 3.5 Guards — Additions A and B

- **Addition A (EF non-computable).** If fewer than two frames contain LV
  voxels, or the detected ED and ES resolve to the same frame, then EF is
  undefined. Rather than emit a bogus `0 %` or `NaN`, we set `LVEF`,
  `LV_SV`, `RVEF`, `RV_SV` (and their aliases in `measurements`) to `null`
  and push a human-readable line into `warnings[]`. Volumes we *can*
  compute (EDV, mass) are still emitted.
- **Addition B (missing MYO).** If the ED frame has LV cavity but no
  myocardium voxels, LV mass is undefined. We set `LV_mass_g` to `null`
  with a warning, but the entire volumes/EF payload is still returned. This
  is graceful degradation, not failure.

Hard errors (error JSON + `exit 1`) are reserved for two situations only:

1. **No LV cavity in any frame** — without an LV curve there is no ED to
   detect and nothing to report.
2. **Affine missing or not 4×4** — without spacing we cannot produce any
   physical volume at all.

---

## 4. Files created / changed

Everything is inside `cardiac-component-segmentation-ai/Cardiac_Segmentation_FYP_Server/`.

**Added**
- `src/python/compute_heart_metrics_from_rle.py` — new stdin→stdout Python
  script. Reuses `decode_rle`, the `CLASS_MAP`, and the `_safe_float` helper
  from the bullseye script so behaviour on RLE input is byte-for-byte the
  same across both computations.
- `scripts/check_heart_metrics.js` — standalone, framework-free runner that
  feeds synthetic frames into the Python script and asserts on the output.
  Covers happy path, single-frame EF-null, missing-MYO mass-null, no-LVC
  hard error, and wrong-shape-affine hard error.
- `docs/HEART_METRICS_IMPLEMENTATION.md` — this file.

**Edited (additive only)**
- `src/types/database_types.ts` — added a `heartMetrics?` block on
  `IProjectSegmentationMask` parallel to `bullseye?`. Includes the typed
  `measurements` sub-block.
- `src/services/database.ts` — one Mongoose field:
  `heartMetrics: { type: Schema.Types.Mixed, required: false }`.
- `src/services/segmentation_export.ts` — new
  `computeHeartMetricsFromMaskDoc(...)` export, and a fire-and-forget call
  to it inside the existing recon for-loop that already fires bullseye per
  editable mask. Guarded on `project.affineMatrix`.
- `src/routes/segmentation_routes.ts` — new
  `POST /segmentation/trigger-heart-metrics/:maskId` endpoint, mirroring
  `trigger-bullseye/:maskId` 1-to-1 with an added affine-required check.
  **Later** (Part D, §12): a second endpoint
  `POST /segmentation/resolve-duplicate-slice/:maskId`.

Duplicate-slice detection + resolution (Part A + D, §12) additionally touched,
still additively:
- `src/python/compute_heart_metrics_from_rle.py` — `detect_duplicate_slices()`
  + the `duplicate_slices` / `duplicate_slices_detected` output fields + an
  `excluded`-slice skip in `count_voxels_per_frame`.
- `src/services/database.ts` — one Mongoose field on the slice subschema:
  `excluded: { type: Boolean, required: false }` (needed or strict mode drops it).
- `src/types/database_types.ts` — optional `excluded?` on the slice type and
  `duplicate_slices?` / `duplicate_slices_detected?` / `acknowledgedDuplicates?`
  on `heartMetrics`.
- `scripts/check_duplicate_slices.js` — new standalone runner (28 assertions).

**Not touched** — segmentation, strain, bullseye, landmark, reconstruction,
`GET /segmentation/export-project-data/:projectId`, **frontend** (the
results-page buttons for Part D are a separate coordinated frontend task).

---

## 5. Data-flow walkthrough

```text
    +----------------------------------------------------+
    | 1. Trigger                                         |
    |    - Recon pipeline finishes                       |
    |      (segmentation_export.ts, per editable mask)   |
    |    - OR client hits POST /trigger-heart-metrics/   |
    |      :maskId                                       |
    +----------------------------------------------------+
                            |
                            v
    +----------------------------------------------------+
    | 2. Backend service                                 |
    |    computeHeartMetricsFromMaskDoc(maskId,          |
    |        frames, width, height, affineMatrix)        |
    |                                                    |
    |    - Fetches nothing from the DB — the caller      |
    |      already has frames + dims + affine.           |
    |    - Spawns `python3 compute_heart_metrics_from_   |
    |      rle.py` and writes JSON to its stdin.         |
    +----------------------------------------------------+
                            |
        stdin JSON:         v
        {                                            +----------------------+
          frames,        <--------------------->     | 3. Python script     |
          width, height,                             |    - decode_rle()    |
          affine,           stdout JSON:             |    - per-frame LVC / |
          ed_frame?,     <--------------------->     |      MYO / RV counts |
          es_frame?      { measurements: {...},      |    - spacing from    |
        }                  ed_frame, es_frame,       |      affine          |
                           lv_volumes_ml[], ...,     |    - EF guards       |
                           LVEDV, LVEF, ...,         |    - mass guard      |
                           LV_mass_g,                |    - _safe_float()   |
                           warnings[], units }       +----------------------+
                            |
                            v
    +----------------------------------------------------+
    | 4. Storage                                         |
    |    projectSegmentationMaskModel.collection         |
    |      .updateOne(                                   |
    |        { _id: ObjectId(maskId) },                  |
    |        { $set: {                                   |
    |            heartMetrics: {                         |
    |              ...result,                            |
    |              computed_at: <ISO string>             |
    |            },                                      |
    |            updatedAt: <Date>                       |
    |          }                                         |
    |        }                                           |
    |      )                                             |
    +----------------------------------------------------+
                            |
                            v
    +----------------------------------------------------+
    | 5. Exposure                                        |
    |    Read via the SAME mask-read paths that already  |
    |    surface `bullseye`. The heart-metrics feature   |
    |    does NOT modify /segmentation/export-project-   |
    |    data — that endpoint is a NIfTI file export.    |
    +----------------------------------------------------+
```

The service never throws. If the Python script fails, or exits with an
error, or the write fails, a `logger.warn` is emitted and the promise
resolves — bullseye and reconstruction proceed as normal.

---

## 6. References

- **ACDC challenge** — `metrics_acdc.py` in the ACDC evaluation code
  defines chamber volume as `voxel_count × voxel_volume_mm3 / 1000` and EF
  as `(EDV − ESV) / EDV × 100`, and uses `1.05 g/mL` for LV mass.
- **Bernard, O., et al. (2018).** *Deep Learning Techniques for Automatic MRI
  Cardiac Multi-Structures Segmentation and Diagnosis: Is the Problem
  Solved?* IEEE Transactions on Medical Imaging 37(11), 2514–2525. — The
  paper behind the ACDC benchmark; defines the clinical evaluation contract
  we follow.

The heart-metrics script cites both directly in its module docstring so the
provenance is visible in the code.

---

## 7. How to run and test locally

### 7.1 The standalone check script

```bash
cd cardiac-component-segmentation-ai/Cardiac_Segmentation_FYP_Server
node scripts/check_heart_metrics.js
```

- Requires **Python 3 with numpy** on PATH. The script auto-detects
  `python3`, `python`, or `py` and picks the first one that can
  `import numpy`. If none can, it prints a clear "install numpy" message.
- Requires **no** MongoDB, no HTTP server, no test framework.
- Prints raw Python output for each scenario so you can eyeball the numbers.
- Exits 0 on all **46 assertions** passing, 1 on any failure. The eight
  scenarios cover: happy multi-frame path, single-frame → EF null,
  missing-MYO → mass null, no-LVC hard error, wrong-shape-affine hard
  error, duplicate-(frame,slice,class) → union-not-sum (§9 fix a),
  identity-affine → plausibility warning (§9 fix b), and sheared-affine
  → det-based volume (§9 note on det vs. column-norm product).

### 7.2 Manually triggering for a real mask

Assuming the server is running and the recon pipeline hasn't already fired
for that mask:

```bash
curl -X POST \
     -H "Cookie: <your auth cookie>" \
     http://localhost:<PORT>/segmentation/trigger-heart-metrics/<maskId>
```

Response is immediate (`{success:true,message:"Heart-metrics computation
started."}`); the actual write to the mask doc happens async. Check the
server log for a `[HeartMetrics] Stored heart metrics for mask <id> —
LVEDV=… LVESV=… LVEF=… LV_mass_g=… warnings=… matched=1 modified=1` line.

### 7.3 Inspecting the stored result

Query the segmentation-mask document by `_id` and read the `heartMetrics`
field. Its shape is documented on `IProjectSegmentationMask.heartMetrics`
in `src/types/database_types.ts`.

---

## 8. Known limitations

- **BSA-indexed volumes not computed.** Reporting "EDVi" (indexed to Body
  Surface Area) requires height and weight, which VisHeart does not collect
  today. When the project starts collecting demographics, the assembler can
  derive `EDVi = EDV / BSA(height, weight)` from the values already in
  `measurements`.
- **Wall thickness and cavity dimensions not computed.** Those live in the
  bullseye pipeline (per-segment thickness) and would need a separate
  short-axis-diameter step. Out of scope here.
- **Single-orientation assumption.** Voxel volume from the affine is exact
  regardless of orientation, but the ED / ES *detection* assumes the LV
  curve is monotone-ish across the phase axis — which it is for standard
  short-axis CINE. Highly irregular curves (arrhythmia, motion) may pick a
  weird ED/ES. The `ed_frame` / `es_frame` overrides are the escape hatch.
- **Same-mask assumption per compute.** The pipeline computes metrics per
  segmentation mask, mirroring bullseye. Aggregating across MedSAM and UNet
  masks is not attempted — each mask gets its own `heartMetrics`.
- **`measurements.PeakGRS` / `PeakGCS` are placeholders.** They are filled
  by the strain pipeline at report-assembly time, not by this script.

---

## 9. Diagnostic guards — the affine / dedup safety net

Added after Sharlene reported (`PIPELINE_INTEGRATION.md §6`) that absolute
volumes came out **~30× too small in one run and very large in another**,
while EF stayed sane. EF being unaffected is diagnostic: since EF is a ratio
of two volumes measured in the same units, only voxel *count* or voxel
*volume* variation can move volumes without moving EF — and identical
frames data across two runs makes the count constant, so the culprit is
`voxel_mm3` (bad affine) or something inflating counts (duplicated slices).

The formula itself was audited and is correct — this is an **input-
variability** problem, not a math bug. Three additive fixes were made:

### Fix (a) — Per-`(frameindex, sliceindex, class)` union deduplication

`count_voxels_per_frame` used to `+=` every occurrence of a class in the
mask document. If `frames[]` contained two entries with the same
`(frameindex, sliceindex)` — e.g. because a manual edit re-appended
instead of replacing, or because a data migration duplicated a row — the
same LV disc was counted twice and volumes doubled.

Now the counter mirrors what `compute_bullseye_from_rle.py :: build_mask_3d`
already does: bucket boolean masks by `(frameindex, sliceindex, class_val)`,
**OR them together on duplicate keys**, then sum. Same effective mask
across both pipelines. Regression guard: check-script test [6] compares a
frames array with and without a duplicated LV slice and asserts the two
LVEDVs are equal (not 2×).

> **Union dedup only catches a slice re-appended under its OWN
> `(frame, slice, class)` key.** A slice *copied to a NEW `sliceindex`* lands
> under a different key, so the union can't merge it and its voxels are
> double-counted. That harder case is caught by the duplicate-slice
> **detector** — see §12.

### Fix (b) — Plausibility warnings on `voxel_mm3` and `LVEDV`

Both guards **do not fail** the pipeline. They push a human-readable line
into `warnings[]`, which the backend service now also re-emits as a
`logger.warn` per warning:

- `voxel_mm3 < 0.1 mm³` or `voxel_mm3 > 200 mm³` — cardiac MRI voxels
  are typically 1–30 mm³; anything outside that strongly suggests a bad
  affine (identity fallback, cm-in-mm misread, resampled affine, etc.).
- `LVEDV < 30 mL` or `LVEDV > 400 mL` — adult LVEDV is typically
  60–250 mL; grossly-outside values catch the failure mode where
  `voxel_mm3` is inside the wide 0.1–200 window but the resulting volume
  is still implausible (identity affine at `voxel_mm3 = 1.0` produces
  ~1 mL LVEDV — well outside the LVEDV band, caught here).

The two bands overlap on purpose: an anomalous affine is caught by at
least one of them.

Regression guard: check-script test [7] feeds the identity affine and
asserts (i) exit code 0, (ii) warnings contain a spacing/affine flag,
(iii) warnings contain an LVEDV plausibility flag, (iv) LVEF is still
valid despite the bad affine.

### Fix (c) — Service-side log line surfaces the spacing

The backend log line for a stored heart-metrics compute now includes
`voxel_mm3` and `spacing_mm=[dx, dy, dz]`, and every Python warning is
also emitted as its own `logger.warn`. A single grep across recent runs
now reveals which projects have a suspicious affine without JSON-parsing
the stored payload:

```bash
docker logs -f visheart-local | grep '\[HeartMetrics\]'
```

Look for:
- `voxel_mm3=1` — identity affine
- `voxel_mm3=0.0...` — sub-mm³, likely cm-in-mm or `pixdim` misread
- `voxel_mm3=1000+` — inflated affine
- Any `[HeartMetrics] mask <id> — Suspicious voxel_mm3=... / LVEDV=...`
  line — those are the projects to look at.

### Why the formula itself is not the issue

- `spacing = sqrt(sum(affine[:3, :3] ** 2, axis=0))` is the standard
  NIfTI-affine spacing extraction: the top-left 3×3 is
  `direction_cosines × spacing`, and the direction cosines are unit
  vectors, so their column norms equal the spacing scalars.
- `voxel_count × voxel_mm3 / 1000` matches ACDC and Bernard 2018 exactly.
- The 46/46 assertion pass with a fixed affine (42 original + 4 new for
  the shear-affine regression, see below) proves the formula is
  deterministic — the swing in production is entirely upstream input
  variance, which the new guards make visible.

### Note: `voxel_mm3` is det-based, `spacing_mm` is per-column-norm

As of the Part-A hardening for Task 2:

- **`voxel_mm3`** is now computed as `|det(affine[:3, :3])|`. This is the
  correct geometric parallelepiped volume regardless of whether the affine
  is orthogonal or oblique/sheared.
- **`spacing_mm[dx, dy, dz]`** is still per-column L2 norm — kept for the
  per-axis in-plane / through-plane spacing display, which is what the user
  usually wants to inspect.

For **orthogonal cardiac short-axis data** (essentially all real projects),
`|det| == dx * dy * dz` exactly — so all pre-hardening test fixtures produce
the same numbers bit-for-bit. For an **oblique or sheared affine**, the two
differ: the column-norm product over-estimates by the sine of the inter-axis
angles, and det is the correct volume. If you inspect a stored payload and
find `voxel_mm3 ≠ spacing_mm[0] * spacing_mm[1] * spacing_mm[2]`, that is
diagnostic of an oblique affine, not a bug — see test [8] in
`scripts/check_heart_metrics.js` for the reference case.

### What this fixes and what it doesn't

- **Fixes:** duplicate-slice inflation (fix a) and silent bad-affine
  runs (fix b + c). Both are common real-world failure modes that were
  producing the ~30× swing.
- **Does NOT fix:** the underlying bad-affine data itself. If a project
  has an identity affine in Mongo, the guards will now shout, but the
  actual repair (re-ingesting with the correct affine, or backfilling
  from the original NIfTI) is a separate follow-up on the ingestion
  side. Coordinate with whoever owns `project.affineMatrix` writes.

---

## 10. Beginner FAQ

**Q. What is a voxel, really?**
A voxel is a volume element — a 3D pixel. A 2D image pixel has an area; a
voxel has a volume. In cardiac MRI, one voxel represents a tiny cuboid of
tissue, typically about 1.5 mm × 1.5 mm × 8 mm (18 mm³). Chamber volume is
literally "count the voxels inside the chamber and multiply by the size of
one voxel."

**Q. Why is a "frame" time and a "slice" space? Aren't they both just image
indices?**
In cardiac CINE MRI, the scanner captures the same slice repeatedly through
one heartbeat. Each capture in time is a **frame** (a cardiac phase — the
heart looks slightly different because it's beating). Then the scanner
moves down and does another stack of frames. Once you stitch them together
you have a 4D volume: (H, W, slice, frame). To compute the volume of the
chamber *at one phase*, you sum across all slices *for that one frame*. To
compute EF, you compare the frame where the chamber is biggest (ED) with
the frame where it is smallest (ES).

**Q. Why `(ED − ES) / ED` and not, say, `ES / ED`?**
Because the numerator `ED − ES` is exactly the *amount squeezed out* — the
stroke volume. Dividing by ED gives "what fraction of the full chamber got
ejected." A healthy LV ejects about 55–70 % per beat. The alternative
`ES/ED` would give you "what fraction of the chamber was still left" —
correct but harder to interpret at a glance.

**Q. Why does the script hard-error on a missing affine but not on missing
myocardium?**
Because *every* physical volume in the output depends on `voxel_mm3`. Without
the affine we cannot produce a single meaningful number, so returning
`{LVEDV: null, ...}` would just be a shell of a payload. Missing myocardium
only kills mass — the entire volumes/EF side is still fine, so we return
what we have and flag `LV_mass_g: null` with a warning.

**Q. Why is `measurements` at the top of the JSON and not the bottom?**
Two reasons. First, the report assembler reads it first — putting it up
front matches the primary consumer's mental model. Second, when a human
scans the log line or the raw JSON, the summary numbers are what they want
to see first; the per-frame arrays and diagnostic warnings belong further
down.

---

## 11. Deployment note

The backend runs from `dist/` inside Docker (`visheart-local`). Any change
to `.ts` files under `src/` — including the additions in this feature —
needs a rebuild + container restart to take effect. The Python script is
executed directly and does not require rebuilding.

```bash
cd cardiac-component-segmentation-ai/Cardiac_Segmentation_FYP_Server
pnpm build
docker restart visheart-local
```

Verifying the heart-metrics chain from the logs:

```bash
docker logs -f visheart-local | grep '\[HeartMetrics\]'
```

You should see one `Stored heart metrics for mask <id> — LVEDV=... LVESV=...
LVEF=... LV_mass_g=... voxel_mm3=... spacing_mm=[...]` line per editable
mask when a segmentation completes, followed by one `logger.warn` per
plausibility warning if any fired. If you see no `[HeartMetrics]` lines at
all after a segmentation finish, the recon pipeline's fire-and-forget call
never reached this module — check for a missing `project.affineMatrix`
(`logger.warn` line `[HeartMetrics] Skipped mask <id> ... — project has no
stored affineMatrix`) rather than assuming Python failed.

For the wider Metrics → Strain → Similarity chain verification steps see
`PIPELINE_INTEGRATION.md §7`.

---

## 12. Duplicate-slice detection + resolution (Part A + Part D)

An additive feature in two halves: **detect + warn** about a copied slice
(Part A, in the Python script), and let the user **resolve** a flagged
duplicate — soft-exclude it (recompute without it) or keep it (Part D, a new
backend endpoint). Both are additive: on clean data nothing is flagged,
nothing is excluded, and every existing number is bit-for-bit unchanged.

### 12.1 Why — the gap the union dedup can't close

§9 fix (a) deduplicates a slice **re-appended under its own
`(frameindex, sliceindex, class)` key** by OR-ing the two masks together. But
consider a slice that was **copied to a *new* `sliceindex`** — a manual
duplicate, a bad merge, an ingestion that renumbered instead of replaced. Now
there are two *different* keys holding the same pixels:

```text
(frame 3, slice 5, lvc) -> disc            \   union dedup sees two DIFFERENT
(frame 3, slice 9, lvc) -> the same disc   /   keys → cannot merge → summed
```

Both survive the union and their voxels are **added twice**, inflating that
frame's volume by one slice's worth. If the inflated frame is ED, `LVEDV` (and
everything derived from it) is wrong. This is the copied-slice case §9 fix (a)
explicitly does **not** cover.

### 12.2 How — two-stage detection (cheap screen → precise confirm)

Run once per `(frame, class)` group, over the same deduped masks the volume
used (`detect_duplicate_slices()`):

- **Stage 1 — voxel COUNT (cheap, ~O(n)).** A copied slice has the *same voxel
  count* as its original. Bucket the positive-count slices by count; only
  equal-count slices can be copies. Usually every count is distinct → zero
  candidates → Stage 2 never runs. `count == 0` slices are ignored.
- **Stage 2 — voxel POSITION (only on candidates).** Confirm by
  `IoU = |mask_i ∩ mask_j| / |mask_i ∪ mask_j|`. Thresholds (constants at the
  top of the script):
  - `DUP_IOU_EXACT = 1.0` — perfect overlap → **exact** duplicate.
  - `DUP_IOU_NEAR  = 0.98` — `0.98 ≤ IoU < 1.0` → **near** duplicate (e.g. a
    1–2 px edit after a copy). `IoU < 0.98` → genuinely different slice, left
    alone.

**Minority rule (the key guard).** Within a `(frame, class)` group, a pair is
only confirmed if the group *also contains at least one positive slice that
differs from it*. If **every** positive slice in the group is mutually
identical, the group is a **uniform/degenerate stack** (a synthetic fixture
that repeats one slice, a padded acquisition), **not** an accidental copy —
nothing is emitted. This is what keeps the existing fixtures clean:
`check_heart_metrics.js`'s happy path (3 identical slices/frame) and
`verify.py` (5 identical slices/frame) are wall-to-wall "duplicates" by raw
IoU, but as fully-uniform groups they are correctly ignored, so both still run
at **zero** duplicate warnings.

### 12.3 What it emits (all additive, all optional)

Per confirmed pair, a human line is appended to `warnings[]`:

```text
Possible duplicate slice: frame 3, slices 5 & 9 (class lvc) — identical voxel
count (1257) and 100% overlap. Est. inflation +22.6 mL.
```

…and a machine-readable entry is added to a new output field:

```json
"duplicate_slices": [
  { "frame": 3, "class": "lvc",
    "slice_keep": 5, "slice_remove": 9,
    "voxel_count": 1257, "iou": 1.0, "est_inflation_ml": 22.626 }
],
"duplicate_slices_detected": true
```

`slice_remove` is the **higher** `sliceindex` of the identical pair — arbitrary
(the slices are identical) but deterministic. `est_inflation_ml =
voxel_count × voxel_mm3 / 1000` is exactly the volume that slice adds, i.e. the
amount `LVEDV` will drop if it is excluded. On clean data
`duplicate_slices` is `[]` and `duplicate_slices_detected` is `false`.

### 12.4 It rides `warnings[]` → low-confidence health status until resolved

A confirmed duplicate puts a line in `heartMetrics.warnings`. The health-status
rule engine treats *any* non-empty `heartMetrics.warnings` as
`volumes_unreliable`: it suppresses the numeric EDV evidence line and drops
`confidence` to `"low"` (`compute_health_status.py`, §"Defensive behaviour"
(b)). So an un-resolved duplicate automatically makes the health status
low-confidence — correct, because the volume is inflated — and **resolving it
(exclude) clears the warning and lets confidence return to normal** on the next
recompute (assuming nothing else is wrong). EF, a ratio, is unaffected
throughout.

### 12.5 Resolution model — soft-exclude vs keep (Part D)

`POST /segmentation/resolve-duplicate-slice/:maskId`

```jsonc
// body
{ "frameindex": 3, "sliceindex": 9, "action": "exclude" | "keep" | "restore" }
```

| action | effect | recompute? | reversible? |
|--------|--------|-----------|-------------|
| `exclude` | `$set` the named slice's `excluded = true` | yes — heart metrics **and** health status re-run | yes, via `restore` |
| `restore` | `$set` the same slice's `excluded = false` | yes — both re-run | — |
| `keep` | `$addToSet` `{frameindex, sliceindex}` into `heartMetrics.acknowledgedDuplicates` | **no** | — (advisory) |

**This is NOT a hard delete.** `exclude` only *flags* the slice; its RLE stays
in the document untouched. A normal recompute skips any slice with
`excluded === true` (one `continue` in `count_voxels_per_frame`, the sole place
slices are iterated — so counts, per-frame curves, ED/ES, EF and mass all honour
it at once), so the volume drops by that slice's contribution and the pair stops
being flagged. `restore` flips the flag back and the volume + flag return — the
whole point of soft-exclude over deletion is that the user can undo it. `keep`
leaves the volume as-is and records that the user accepted the duplicate, so the
report can show "duplicate present, accepted by user" while the warning-driven
low confidence persists.

**Responses.** `exclude` / `restore` await the recompute and return the fresh
state so the caller sees the effect immediately (unlike the fire-and-forget
`trigger-*` routes):

```jsonc
// 200 — exclude / restore
{ "success": true, "action": "exclude", "frameindex": 3, "sliceindex": 9,
  "slicesUpdated": 1, "heartMetrics": { … }, "healthStatus": { … } }
// 200 — keep
{ "success": true, "action": "keep",
  "acknowledgedDuplicates": [ { "frameindex": 3, "sliceindex": 9 } ] }
```

**Status codes.** `400` — bad `action`, non-integer indices, or (exclude/restore)
a project missing dimensions/affine so recompute is impossible; `404` — mask,
frame, or slice not found; `403` — project access denied; `500` — otherwise.
Auth is `isAuthAndNotGuest` (this route *mutates* stored mask data, like
`save-*-segmentation`; the read-only `trigger-*` routes use `isAuth`).

**Implementation notes worth knowing:**

- The frame/slice are located **by value** (`f.frameindex === …`,
  `s.sliceindex === …`), not by array index — a mask may hold sparse frames like
  `[0, 5, 12]` where `frames[5]` is the wrong entry.
- The `excluded` write uses `arrayFilters` (`frames.$[f].slices.$[s].excluded`)
  so it marks **every** document entry for that one logical
  `(frameindex, sliceindex)`. The union dedup collapses repeated entries into a
  single key, so marking only the first occurrence would leave the volume
  unchanged. `slicesUpdated` reports how many matched.
- `excluded` **must** be declared on `projectSegmentationMaskSliceSchema` (it
  is) — Mongoose strict mode silently drops an unknown path on both `updateOne`
  and the save/merge round-trip in `save-manual-segmentation`, which would make
  the exclusion quietly un-stick.

### 12.6 How to test

```bash
cd cardiac-component-segmentation-ai/Cardiac_Segmentation_FYP_Server
node scripts/check_duplicate_slices.js   # 28 assertions, no Mongo / HTTP
```

Covers: detect (one entry, `iou == 1.0`, `est_inflation_ml` exact), exclude
(`LVEDV` drops by exactly `est_inflation_ml`, duplicate + warning cleared),
restore (reversibility), keep (Python-observable invariants), a same-count
different-shape non-false-positive (proves Stage 2 rejects, not Stage 1), and a
fully-uniform stack staying clean (the minority rule). The route half (`keep`'s
`acknowledgedDuplicates` persistence, the arrayFilters write) is covered by
`tsc --noEmit` plus this manual call:

```bash
curl -X POST -H "Content-Type: application/json" -H "Cookie: <auth>" \
     -d '{"frameindex":3,"sliceindex":9,"action":"exclude"}' \
     http://localhost:<PORT>/segmentation/resolve-duplicate-slice/<maskId>
```

Regression gate held green by this change: `check_heart_metrics.js` (46/46,
happy path still 0 warnings), `verify.py` (LVEDV 144.0 / LVEF 64.0),
`check_health_status.js` (52/52).

### 12.7 Limitations + TODO

- **Fully-uniform-group false negative (by design).** The minority rule ignores
  a group whose positive slices are *all* identical. So a genuine copy inside a
  wholly-uniform stack — e.g. a 2-slice mask where slice 1 is an exact copy of
  slice 0 with nothing else in that frame/class to break the tie — is **not**
  flagged. This is the deliberate trade for never flagging synthetic/padded
  uniform stacks (and for keeping the existing fixtures clean). In real
  short-axis data, slices vary genuinely down the stack, so a copy is a minority
  artifact and is caught; the false negative only bites degenerate inputs.
- **Earliest catch is upstream, at ingestion.** The most robust fix is to hash
  the raw slice pixels *before* they are assigned a `sliceindex` and reject/merge
  identical rasters at ingestion — before numbering can disguise a copy as a
  distinct slice. That is out of scope here (it belongs to whoever writes the
  mask document on upload) and is left as a TODO; this feature is the
  compute-time safety net, not the ingestion-time cure.
- **Results-page buttons are a separate coordinated frontend task.** This change
  is backend-only: the detector, the schema, and the resolve endpoint. Wiring
  "Exclude / Keep" controls on the per-model results page to
  `resolve-duplicate-slice` is deliberately left to the frontend work so the two
  can be coordinated.
- **Near-duplicate threshold is a heuristic.** `DUP_IOU_NEAR = 0.98` with an
  equal-count prerequisite is deliberately conservative (a near-copy must share
  the exact voxel count *and* overlap ≥ 98%). Slices that were copied and then
  meaningfully edited — changing the voxel count — are treated as genuine
  slices, not near-duplicates.
