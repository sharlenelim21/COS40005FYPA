# Template hearts — hand-checked workflow

Template hearts are read-only reference projects that every logged-in user can
open from **Dashboard → Templates**. They show the landmark page only; nothing
can be edited or re-run. This folder holds the tool that does the scripted parts
of making one. The checking and editing are done by hand in the app.

## Prerequisites

- The local Docker stack is running (frontend `:3000`, backend `:5000`, GPU service, `visheart-mongodb`).
- Python 3.10+ with `pip install requests numpy nibabel scipy`.
- `.template_account.json` in this folder: `{"username": "visheart_templates", "password": "..."}`.
  It is git-ignored — keep a copy somewhere safe. Published templates are owned by this account.
- Run the tool from this folder: `python template_tool.py <command> ...` (`--help` on any command).
  `prepare` and `landmarks` ask for your VisHeart password (never stored; or set `VISHEART_PASSWORD` for the
  session). `finalize` doesn't — it checks ownership in the database. It refuses a project whose masks have no
  saved edits (`--allow-unedited` to override) or that has no saved landmarks.

Frame numbers are **1-based**, exactly as the app shows them (`Frame 28`).

## Steps for one subject

| # | Where | What to do |
|---|---|---|
| 1 | App (your account) | Dashboard → upload the subject's `<code>_sa.nii.gz`. On the project page, **Start pipeline**: tick **UNet**, **UNet – LV** 3D and landmark detection. Wait until it finishes. Note the project ID from the URL (`/project/<ID>`). |
| 2 | `prepare` *(optional)* | Loads the experts' masks into the ED and ES frames. Run it **before** editing — it replaces those two frames. Skip it to edit the AI's masks yourself. |
| 3 | App → Segmentation | Check and edit the masks on **every frame and slice** (ED and ES start from the experts' masks). Clear masks on slices above the base / beyond the apex. **Save.** |
| 4 | `landmarks` *(optional)* | Places the RV insertion points on every frame and slice from your corrected masks. Skip it to start from the landmark model's points (press **Re-run** on the landmark page after editing the masks, so detection uses them). |
| 5 | App → Landmark page | Check and adjust the two RV insertion points on **every frame and slice** (drag; *place* missing ones; delete points on slices without a septum–RV junction). **Save.** |
| 6 | `finalize` | Moves the project to the template account and publishes it (locked), recomputes volumes/EF, wall thickness, LV and RV strain (ED→ES and full cycle), the health checks and the ACDC disease pattern gates (with the subject's BSA and sex), rebuilds the LV and RV 3D models from the ED frame and their smooth motion (~20–25 min). Prints the results next to the experts'. |

```bash
# 2 — experts' masks into ED / ES
python template_tool.py prepare --user <you> --project <ID> \
  --gt-dir "C:/Users/hp193/Downloads/PATIENT_DATA_4D_AND_SINGLE_FRAME/NOR/FEMALE_NOR_A5Q1W8" --ed 28 --es 11

# 4 — landmarks from your corrected masks (after step 3 is saved)
python template_tool.py landmarks --user <you> --project <ID>

# 6 — publish + recompute (after step 5 is saved)
python template_tool.py finalize --user <you> --project <ID> \
  --category NOR --sex female --age 35 --height 167 --weight 75 --ed 28 --es 11 \
  --subject-code A5Q1W8 --order 1 \
  --gt-dir "C:/Users/hp193/Downloads/PATIENT_DATA_4D_AND_SINGLE_FRAME/NOR/FEMALE_NOR_A5Q1W8"
```

To check your edits before publishing, `recompute` refreshes every result (volumes/EF, wall thickness,
LV/RV strain, health checks and disease pattern gates) of a project that is still yours, without publishing it or
rebuilding the 3D models (~5–10 min; asks for your password):

```bash
python template_tool.py recompute --user <you> --project <ID> --ed <ED> --es <ES> --height <cm> --weight <kg> --sex <sex> --category <NOR|HCM|DCM>
```

It stores the ED/ES (and height/weight for the mL/m² and g/m² values) in the project's template
settings first, so volumes/EF use the experts' frames rather than auto-detected ones.

If `finalize` stops part-way (e.g. the PC sleeps or the GPU restarts), run the same command again — it
resumes from the step that failed (`--restart` redoes everything). A 3D build that was cut off stays marked
"running" in the database and would block a new one; `finalize` marks such jobs as failed when they have
reported no progress for 20 minutes, so just wait that long before resuming if the cut-off was recent.

## The subjects

Values from `patient_data_filled_all.xlsx` (ED/ES converted to the app's 1-based frames).

| Template | Folder (under `PATIENT_DATA_4D_AND_SINGLE_FRAME`) | `--category --sex` | `--age --height --weight` | `--ed --es` | `--subject-code --order` |
|---|---|---|---|---|---|
| Normal heart (female) | `NOR/FEMALE_NOR_A5Q1W8` | `NOR female` | `35 167 75` | `28 11` | `A5Q1W8 1` |
| Normal heart (male) | `NOR/MALE_NOR_B5F8L9` | `NOR male` | `27 181 65` | `1 9` | `B5F8L9 2` |
| HCM heart (female) | `HCM/FEMALE_HCM_C2J0K3` | `HCM female` | `49 156 66.5` | `1 10` | `C2J0K3 3` |
| HCM heart (male) | `HCM/MALE_HCM_A7M7P8` | `HCM male` | `49 183 110` | `1 10` | `A7M7P8 4` |
| DCM heart (female) | `DCM/FEMALE_DCM_A4B5U4` | `DCM female` | `54 160 45` | `1 11` | `A4B5U4 5` |
| DCM heart (male) | `DCM/MALE_DCM_A6D5F9` | `DCM male` | `44 180 90` | `1 12` | `A6D5F9 6` |

A4B5U4 is an end-stage heart (experts' LVEF 5%, EDVI 262 mL/m²).

The expert masks in this dataset (M&Ms) use 1 = LV, 2 = myocardium, 3 = RV; the tool converts them
(`--labels acdc` for ACDC-style files).

## Changing a published template

To swap the experts' masks into ED/ES of a template that is already published (e.g. EF came out wrong
because the AI's ES cavity was left too big), no unpublishing or password is needed:

```bash
python template_tool.py prepare --published --project <ID> --gt-dir "<subject folder>" --ed <ED> --es <ES>
python template_tool.py finalize ...same arguments as before...   # recomputes every result
```

For any other change:

```bash
python template_tool.py unpublish --project <ID> --to-user <you>   # unlocks it and moves it back to you
# ... edit in the app, then run `finalize` again
python template_tool.py list                                       # current templates
```

## Sharing the templates with your team

Templates live in your local MongoDB and MinIO, not in git. To give teammates the same templates:

```bash
python template_tool.py export
```

This writes every published template to `visheart-local-deployment/seed/templates` (about 200 MB,
xz-compressed). It includes the documents (project, masks, landmarks, jobs, 3D model records) and the
files the read-only pages load (image stacks and 3D models). Left out: the original `.nii.gz` scans
(only the AI pipeline reads them, and templates never run it) and the 3D models' smooth-motion files
(they barely compress; the backend builds a template's motion the first time someone opens it, and the
3D heart plays frame by frame until then). Commit that folder.

After a teammate merges, they rebuild and restart their stack (see the commit/merge notes: `npm run build`
for the backend, `build.ps1` for the frontend image, then recreate `visheart-app`). On start-up the backend
loads every template their machine doesn't have yet (`src/services/template_seed.ts`); it takes about a
minute the first time and appears in the log as `TemplateSeed: loaded ...`. It creates the template account
with a random password.

- Run `export` again after changing a template and commit the result. Unchanged files are left
  byte-for-byte as they are, so git only stores what changed. Teammates' copies are replaced on their next
  start-up, and any change they made to a loaded template is overwritten.
- Templates you published on your own machine are never touched by the loader, so a restart can't replace
  your newer edits with an older export.
- `TEMPLATE_SEED=off` in the backend's environment skips loading.

## Good to know

- While you work, the project is a normal project in **your** Projects list. After `finalize` it leaves your
  list and appears under Templates, read-only for everyone (the server rejects any change that does not come
  from the template account).
- The server deletes model jobs older than 3 days (on start-up and daily at 2 AM), and the landmark page needs
  the landmark model's job to show anything. Published templates are exempt, but a project you are still
  working on is not. If it has been more than 3 days since you ran the pipeline, open its landmark page once
  before `finalize` so detection runs again. Your saved landmark edits are kept. `finalize` refuses a project
  without that job.
- Saving masks in the editor does not recompute anything; saving landmarks recomputes wall thickness and
  marks strain out of date. `finalize` recomputes everything, so you don't need to press any compute buttons.
- The same file cannot be uploaded twice by one account. To redo a subject, delete your old project first
  (or `unpublish` + edit the existing one).
- The read-only Landmarks tab shows a note on how the masks and landmarks were made. `finalize` words it
  from what you actually ran (`prepare` / `landmarks` or neither); `--note "..."` overrides it.
- The ED/ES frames of the template are the `--ed` / `--es` you give `finalize` — volumes/EF, strain and the
  3D models are all recomputed with them. The frames you pick in the app's Strain tab don't matter.
- Publishing writes the template flag and owner directly in the local MongoDB container
  (`--mongo-container`, default `visheart-mongodb`); there is intentionally no API for it.
