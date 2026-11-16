# VisHeart one-click Windows installer (Option A) — design

Date: 2026-11-14 · Status: reviewed, awaiting approval

## Intent

Today a new VisHeart user has to install Git, clone the repository, install Node and build the backend, install
WSL2 and Docker Desktop, pull the images, copy the training pack into place and find `start.bat`. We want one
download that an expert user (clinicians, researchers, our supervisor) runs once, after which a desktop icon starts
VisHeart. Everything we ship or depend on must cost nothing for this audience.

## Goals

- One download, one installer, then a desktop icon. No Git, Node, or command line for the user.
- The UNet Extend Training pack is included, so an admin can train without a separate setup.
- Reuse today's `start.ps1` (GPU/CPU detection, first-start training setup) instead of a second start path.
- Developers keep their current workflow (Docker Desktop, `start.bat` from the repository).

## Non-goals (later phases)

- Replacing Docker Desktop with Docker Engine in WSL2 (Option B). Only needed if a large hospital or government user
  appears; Docker Desktop is free for education, research, personal use and organisations under 250 staff and
  US$10M revenue.
- A fully offline installer with the images inside (Option C). Images are pulled on first start.
- Auto-update. A new version is a new installer run over the old one.

## Anti-goals

- Publishing the installer publicly. The training pack contains raw ACDC and M&Ms data; the installer goes only to
  the team and approved expert/research users, never to a public download page.
- A paid tool anywhere in the chain.
- Breaking the developer `start.bat` flow from a normal clone.

## Constraints

- Windows 10/11 x64 only. WSL2 needs virtualisation enabled; first WSL enable usually needs one reboot.
- Docker Desktop asks the user to accept its terms on first launch; the installer cannot click that.
- Size: models (`visheart-inference-gpu/app/models`) ~657 MB + training pack ~4 GB + code. Inno Setup 6.5.2+
  allows a single `Setup.exe` just under 4 GB (Windows limit), so we need **DiskSpanning**: the download is a folder
  (`VisHeart-Setup.exe` + `VisHeart-Setup-*.bin`), normally shipped as one zip or a shared Drive folder.
- Docker Hub images (`sharlene21/visheart-local`, `sharlene21/visheart-gpu`, `mongo`, `redis`, the MinIO images) must
  stay available, since they are pulled on first start.

## Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| A. Inno Setup + Docker Desktop, images pulled on first start | 2–4 days; low risk; Docker Desktop not free for large orgs | **Chosen** |
| B. Inno Setup + Docker Engine in WSL2 | Free for everyone; +~1 week; `host.docker.internal` points at the WSL VM, not Windows, so the training worker link needs mirrored networking or a rework | Later, if needed |
| C. A + images saved inside the installer | Works offline; installer grows to 15–20 GB | Later, if needed |
| Pinokio / single exe (PyInstaller, Electron) | Pinokio avoids Docker; a single exe cannot hold six services across Node, Python and CUDA | Rejected |

## Design

### 1. Staging script — `cardiac-component-segmentation-ai/installer/make-installer.ps1` (run by us)

Builds a clean staging folder laid out exactly as the installed app:

```
staging/
  visheart-local-deployment/        compose, start/stop scripts, Dockerfiles not needed
  Cardiac_Segmentation_FYP_Server/  dist/ (built here with npm ci + npm run build), src/python/
  visheart-inference-gpu/           start_server.py + the app/ files compose mounts + app/models/
  visheart-retraining/              worker and setup scripts (no __pycache__, no tests)
  UNETRESNET34/                     see "Path fix" below
  visheart-training-data/           the pack, from pack_training_data.py, verified with its `verify` command
  start.bat, stop.bat
```

Excludes `.git`, `node_modules`, `venv*`, `.venv`, `__pycache__`, jobs/exports. Then calls the Inno Setup
compiler (`ISCC.exe`) on `visheart.iss`.

**Two-level layout (builder check correction):** compose mounts `../../UNETRESNET34`, i.e. the repository-root
`UNETRESNET34` (20 tracked files, the landmark code). The inner `cardiac-component-segmentation-ai/UNETRESNET34` is a
different folder (strain notebook, v5-deform meshes), so the mount must not change. The installed layout copies the
repository's two levels: `C:\VisHeart\cardiac-component-segmentation-ai\…` and `C:\VisHeart\UNETRESNET34\`, and the
shortcuts point into the inner folder. Compose stays as it is for developers.

Also excluded from staging: this machine's `app/models/active` and `atlas_rv_backup_pre_lengthwise`. The staging
script checks that the shipped `unet.pth` matches the training pack's registry (`original_file` hash).

**Release compose (refined in the plan, 2026-11-16):** instead of rewriting a copy, the repository compose reads
`${VH_*:-<today's value>}`, so developers see no change; the installed copy adds `release.env` (pinned images, SMTP,
`127.0.0.1` binding) and a per-PC `secrets.env`. Every image is pinned to an exact tag or digest; no `:latest`
(`sharlene21/visheart-gpu` and `bitnamilegacy/minio*` use `:latest` today, so a later push would silently change
installed copies). Releases are built from a clean, committed checkout, never a working tree with local changes.

### 2. Installer script — `cardiac-component-segmentation-ai/installer/visheart.iss`

- Inno Setup 6.5.2 or later, `DiskSpanning=yes`, needs admin (for WSL/winget).
- Installs to `C:\VisHeart` (writable: start.ps1 writes logs, the training `.venv`, exports).
- Pre-install checks, each with a plain-language message:
  - Windows 10 2004+/11 x64.
  - WSL2 enabled; if not, run `wsl --install --no-distribution` and ask for a reboot.
  - Docker Desktop present; if not, `winget install -e --id Docker.DockerDesktop`.
  - NVIDIA driver present (`nvidia-smi`); if not, warn that VisHeart will use CPU mode and MedSAM is unavailable.
  - Python 3.11+; if not, `winget install -e --id Python.Python.3.13` (needed by the training service).
- Desktop and Start-menu shortcuts: **Start VisHeart** (`start.bat`), **Stop VisHeart** (`stop.bat`), and a
  **VisHeart** link to `http://localhost:3000`.
- Uninstall runs `stop.bat` first. Docker volumes (patient data in MongoDB/MinIO) are kept unless the user ticks
  "Also delete all VisHeart data".

### 3. Start script changes — `visheart-local-deployment/start.ps1`

- If Docker is installed but not running, start Docker Desktop and wait up to ~3 minutes for `docker version`, instead
  of failing at once.
- Before `docker compose up`, if the images are missing, say "First start: downloading VisHeart" with the real size
  and run `docker compose pull` with its progress visible. The local `sharlene21/visheart-gpu` image is ~25 GB
  uncompressed, so the first start can take an hour or more; the installer's disk check asks for ~40 GB free.
- Both changes also help developers; nothing changes for an already-running setup.

### 3b. Updates

The team keeps changing code; users get changes by running a newer installer over the installed one.

- `make-installer.ps1` produces two builds from the same staging: **Full** (with the training pack, for new
  machines) and **Update** (no training pack, a few hundred MB). Both use the same `AppId`, so Inno Setup upgrades
  in place.
- Before copying files, the installer runs `stop.bat`. Docker volumes (MongoDB, MinIO, Redis) are untouched, so
  patients, projects and accounts survive an update.
- `visheart-training-data` is installed only if it does not exist yet (`onlyifdoesntexist`), and the training
  `.venv`, `jobs/`, `app/models/active/` (the model in use after training) and `dist/temp_exports` are never touched.
  "Also delete all VisHeart data" on uninstall removes Docker volumes, trained versions and exports; unticked keeps
  all of them. Otherwise a reinstall would overwrite the admin's newly trained versions
  in `versions/registry.json`.
- The installer version comes from one place (e.g. `installer/VERSION`) and is shown in Add/Remove Programs.
- If a change needs a new Docker image (a new `sharlene21/visheart-local` tag), the compose file in the update points
  at the new tag and the next start pulls it; code that compose bind-mounts needs no image change.

### 4. User guide — `installer/INSTALL.md` (one page)

Requirements, the reboot and Docker-terms steps, first-start wait, default login, where to get help.

### 5. Test on a clean machine

A Windows PC or VM with no Docker, Git, Node or Python: install → reboot → accept Docker terms → Start VisHeart →
log in → run a segmentation → admin opens UNet Extend Training and sees the versions. Also test the CPU path
(no NVIDIA GPU) and uninstall.

## Left to the builder

- Exact Inno Setup Pascal code for the checks and reboot handling.
- How the staging script finds Node/npm and Inno Setup on the developer machine (clear error if missing).
- Whether to compress the training pack (`.npz`, `.pth` compress poorly; likely `Compression=lzma2/fast`).

## Decisions from review (2026-11-14)

- **Real patient data will be stored.** In this phase: every published port in the installed compose binds to
  `127.0.0.1` only (doctor and admin use the same PC, so nothing needs network access), MinIO anonymous download is
  removed from the installed copy, and MongoDB/MinIO/admin passwords plus `GPU_ACCESS_SECRET` are generated at
  install time into a local `.env`. The repository compose is not changed for developers in this phase.
- **SMTP secret.** The FAQ "send a message" form (`support_routes.ts`) needs SMTP to work; without `SMTP_HOST` the
  message is only written to the server log. So the team creates a dedicated, free support Gmail account (not a
  member's personal mail) with its own app password. The staging script reads those values from a local, git-ignored
  `installer/release.env` and writes them into the installed `.env`, so the FAQ works out of the box and the secret
  never enters git. The personal app password committed today is revoked and removed from the repository compose.
- **Images.** The team lead builds and pushes a new pinned `sharlene21/visheart-local` and `visheart-gpu` tag for each
  release; the staging script refuses to build if a pinned tag is missing on Docker Hub.
- **Target PC.** A hospital-run PC, managed by the hospital user who downloads VisHeart; doctor and admin use the same
  PC. Assume the installing Windows account has local admin rights. The installer adds that account to
  `docker-users`; if VisHeart is started from a Windows account without Docker access, `start.ps1` says so and
  `INSTALL.md` shows how to add that account. Python is installed for all users.

## Open items / risks

- The VisHeart login `admin / P@ssw0rd123!` from the README is replaced by an install-time password (see above).
- Docker Hub image availability (the MinIO images were already removed once); Option C removes this risk.
- Estimated 2–4 days, most of it clean-machine testing. Not yet verified.
