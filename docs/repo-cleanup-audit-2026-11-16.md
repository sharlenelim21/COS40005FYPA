# Repository cleanup audit — 2026-11-16

Read-only audit of tracked files on `test/jiayi-hackathon`. "Unreferenced" means `git grep` over tracked files found
no reference to the file name, module or import path; Docker/compose mounts and launch scripts were also checked.
Nothing has been deleted yet. Spot-checked by hand: `visualisation.zip`, `client-heart-assets`, `3dheart.glb`,
`pinker-heart.glb`, `trigger_bullseye_direct.js` are unreferenced; `start.ps1` has no `-ForceCpu/-ForceGpu`
parameters; `visheart-local-deployment/.gitignore` is corrupted.

## Batch 1 — remove, high confidence

**Done 2026-11-16 (not committed yet).** References re-checked with `git grep` before removal; 69 tracked files
removed with `git rm` (82.2 MB, not the ~170 MB first estimated). `visheart-local-deployment/.gitignore` rewritten;
`git ls-files -ci --exclude-standard` shows no tracked file is now ignored. Checks after removal: frontend
`pnpm build` passes; backend `tsc --noEmit` passes, jest 50/50 tests pass (3 suites fail only because
`auth.test.ts`, `database._user.test.ts`, `database_project.test.ts` contain no tests — unchanged by this cleanup).
`visheart-frontend/README.md` still lists `heart.mp4`; fix it in the README rewrite.

| Path | Why |
|---|---|
| `visualisation.zip` (root, 32.5 MB) | Unreferenced; a Vite project zipped with its `node_modules` |
| `trigger_bullseye_direct.js` (root) | One-off script; hard-coded mask id, JWT secret and Mongo password |
| `cardiac-component-segmentation-ai/.gitmodules` | Declares 3 submodules that are plain folders now |
| `Cardiac_Segmentation_FYP_Server/.github/` (2 workflows, dependabot) | GitHub ignores `.github` in subfolders; workflows fully commented out |
| `Cardiac_Segmentation_FYP_Server/.github/copilot-instructions.md`, `visheart-frontend/.github/copilot-instructions.md` | Stale AI-assistant notes (port 3001, old line counts, Redis Cloud) |
| `Cardiac_Segmentation_FYP_Server/src/python/__pycache__/*.pyc` | Bytecode committed despite `.gitignore` |
| `Cardiac_Segmentation_FYP_Server/src/tests/quick_npz_test.ts` (1.35 MB), `test_nifti_extract.ts` | Not run by jest; a pasted webhook blob and a teammate's OneDrive path |
| `Cardiac_Segmentation_FYP_Server/scripts/check_bullseye.ts` + `.js` | `.ts` is UTF-16 corrupted; Mongo password inline |
| `visheart-local-deployment/passportjs.js` | Stray tsc output; not mounted or copied anywhere |
| `visheart-local-deployment/.env` | Not read by compose or any script; contains secrets; tracked only because `.gitignore` is corrupted |
| `visheart-inference-gpu/app/models/atlas_rv_backup_pre_lengthwise/` | No code reads it (`atlas_rv` is used) |
| `visheart-frontend/public/client-heart-assets/` | Unreferenced; byte-identical to the inference atlas |
| `visheart-frontend/public/3dheart.glb`, `pinker-heart.glb`, `image-1.png`, `image-2.png`, `image-3.png`, `heart.mp4`, `visheart_logo_background.jpeg` | Unreferenced (~45 MB) |
| `visheart-frontend/public/images/about/pfp-cla.jpg`, `pfp-james.jpg`, `pfp-jes.jpg`, `pfp-qh.jpg`, `pfp-zia.jpg` | About page imports other photos only |
| `visheart-frontend/src/sample/*` | No imports (the `/sample` page in `src/app/sample` is used — keep it) |
| Unimported components: `commands.tsx`, `SuggestionBanner.tsx`, `ReconstructionDonePopup.tsx`, `debug/ReconstructionDebugCard.tsx`, `landmark/RvCrescentDiagram.tsx`, `landmark/RvStrainChart.tsx`, `segmentation/model-selector-bar.tsx`, `upload/UploadButton.tsx`, `upload/index.ts`, `lib/landmarkPdfExport.ts` | Never imported (verify with `pnpm build` after removal) |

Fix, not delete: `visheart-local-deployment/.gitignore` (lines merged, e.g. `.env.env`).

## Batch 2 — remove after a teammate confirms (medium)

| Path | Ask |
|---|---|
| `Cardiac_Segmentation_FYP_Server/public/patient001–005_4d.nii.gz` (~85 MB) | Static serving is commented out; still copied into the image. Anyone using them for demos? |
| `visheart-inference-gpu/app/models/24April2025-single-stage-usethis.onnx` (37.8 MB) | Runtime uses `.pt` |
| `visheart-inference-gpu/app/main_updated.py` (+ its 2 compose mount lines) | Nothing imports it |
| `Cardiac_Segmentation_FYP_Server/ecosystem.config.js`, `visheart-frontend/ecosystem.config.js` | Old EC2/PM2 configs (the one in `visheart-local-deployment` IS used) |
| `Cardiac_Segmentation_FYP_Server/unet_config.env`, `src/types/api_types.ts`, `src/python/compute_rv_area_strain_from_rle.py` | Not loaded / not imported |
| `scripts/migrate_role_user_to_doctor.js` | Superseded by `migrate_role_doctor_to_user.js` |
| `src/tests/_db_test.ts`, `test_npz_conversion.ts`, `_generate_s3_presigned.ts` | Manual scripts, not run by jest |
| `components/report/CardiacResearchAssistant.tsx` + `lib/researchApi.ts` | Not imported anywhere |
| `visheart-frontend/scratch/` (UAT form drafts) | Move to docs or delete |
| `visheart-local-deployment/volumes/**/.gitkeep`, `Dockerfile.gpu` | Compose uses named volumes; two recipes for one image tag |
| `requirement_mamba_unet.txt` | Unreferenced |
| `cardiac-component-segmentation-ai/UNETRESNET34/` (notebooks, Drive-export OBJs) | Research only; name clashes with the real root `UNETRESNET34/` — rename or move to `research/` |
| `alignment_17seg-update20260817.ipynb` (root) | Method source for bullseye — move to `research/`, don't delete |

## README / docs

| Doc | Action |
|---|---|
| `cardiac-component-segmentation-ai/README.md` | Rewrite (see "Wrong today" below) |
| `README.md` (root) | Update: Sprint-1 branch list and `develop` are obsolete |
| `README_CODEBASE.md` + `VISHEART_SYSTEM_REPORT.md` | Merge into one current architecture doc (both stale: `stop.ps1`, Next 13, `REDIS_URL`, missing routes) |
| `Cardiac_Segmentation_FYP_Server/README_SEGMENTATION.md` | Remove (older copy of README.md) |
| `README_RECONSTRUCTION.md`, `README_AWS-METRICS.md` | Merge into the backend README (duplicates) |
| `Cardiac_Segmentation_FYP_Server/README.md` | Update: missing `/landmark-detection`, `/pipeline`, `/support`, `/retraining`, `/admin`, `/sample-nifti` |
| `docs/HANDOFF_JULY_AUGUST_2026.md` | Remove or archive (one-off hand-off) |
| `docs/HEART_METRICS_IMPLEMENTATION.md` | Minor: dead links to `PIPELINE_INTEGRATION.md`, `verify.py` |
| `visheart-frontend/README.md` | Update: backend port 3001 → 5000, missing files, `pnpm export` |
| `visheart-inference-gpu/README.md` | Update: says GPU-only (CPU works now), wrong paths, missing endpoints |
| `visheart-inference-gpu/4d-reconstruction-api.md` | Merge into inference README (missing `chamber`, `ed_frame_index`, …) |
| `app/dependencies/README.md`, `app/routes/possible_optimization.md` | Remove (placeholder / scratch) |
| `UNETRESNET34/README.md` | Minor: wrong dataset file name, PYTHONPATH, required checkpoints |
| `app/scripts/README.md`, `visheart-retraining/SETUP-ANOTHER-PC.md` | Keep (tiny fixes) |

**Wrong today in `cardiac-component-segmentation-ai/README.md`:** says Windows only (Linux `start.sh` exists); says
an NVIDIA GPU is required (CPU fallback works, only MedSAM needs GPU); MinIO console on :9001 (this image has none);
never says to build the backend `dist` before the first start; omits the root `UNETRESNET34` dependency and its
checkpoints, the image names, and UNet Extend Training; prints default passwords; documents `start.bat --cpu/--gpu`,
which is broken (`start.ps1` has no `-ForceCpu/-ForceGpu` parameters).

## Secrets in tracked files (rotate; deleting does not remove them from git history)

`visheart-local-deployment/docker-compose.yml` (SMTP app password, GPU/JWT/session secrets — handled by installer
plan Task 1), `visheart-local-deployment/.env` and `.env.example` (real-looking values), `trigger_bullseye_direct.js`,
`scripts/check_bullseye.*` (Mongo URI with password), `pilot_acdc_segmentation_upload.js`,
`derive_system_reference_ranges.js`, `retrigger_heart_metrics_batch2.js` (`PILOT_PASSWORD`),
`src/routes/debug_routes.ts` and `app/scripts/_test_bbox_inference_pipeline.py` (expired-looking AWS presigned URLs).
No long-lived AWS keys, private keys or GitHub tokens were found.

## Other bugs found on the way

- `start.bat --cpu/--gpu` fails (missing parameters) — added to installer plan Task 2.
- `components/home/Second.tsx:369` links `/sample-nifti`; the page is `/sample`.
- Compose comment says `start_server.py` uses 8011; it binds 8001.
