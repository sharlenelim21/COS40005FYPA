# VisHeart One-Click Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One download (`VisHeart-Setup.exe` + `.bin` slices) that installs VisHeart, the training pack and its prerequisites on a hospital Windows PC and leaves Start/Stop VisHeart icons on the desktop.

**Architecture:** All logic lives in small PowerShell scripts and modules (unit-tested with Pester); the Inno Setup script only orchestrates them. The repository `docker-compose.yml` becomes parameterised with `${VH_*:-<today's value>}` so developers see no change, while an installed copy supplies two env files: `release.env` (shipped, replaced on update: pinned images, SMTP, `127.0.0.1` binding) and `secrets.env` (generated once per PC, never replaced).

**Tech Stack:** Windows PowerShell 5.1, Pester 3.4 (built into Windows; use `Should Be` syntax), Docker Compose v2, Inno Setup 6.5.2+, winget, Node 20 (backend build).

**Spec:** `docs/superpowers/specs/2026-11-14-one-click-installer-design.md`

## Global Constraints

- Every tool in the chain is free. Docker Desktop stays (Option A); no Docker Engine-in-WSL work.
- Install directory `C:\VisHeart`, laid out as the repository's two levels: `C:\VisHeart\cardiac-component-segmentation-ai\…` and `C:\VisHeart\UNETRESNET34\`. Compose's `../../UNETRESNET34` mount is not changed.
- Inno Setup 6.5.2 or later, `DiskSpanning=yes`, one fixed `AppId` shared by Full and Update builds.
- Installed copy: every published port binds to `127.0.0.1`; MinIO anonymous access `none`; Mongo, MinIO, VisHeart admin passwords and `JWT_SECRET`, `SESSION_SECRET`, `GPU_ACCESS_SECRET`, `GPU_JWT_SECRET`, `GPU_SERVER_AUTH_JWT_SECRET` generated per PC.
- No image reference ends in `:latest` in `release.env`; staging refuses to build if any pinned image is missing on Docker Hub.
- The personal Gmail address and app password are removed from the repository. SMTP for installed copies comes from the git-ignored `installer/smtp.release.env` (dedicated team support account).
- Never overwritten on update: `secrets.env`, `visheart-training-data\`, `visheart-retraining\.venv\`, `visheart-retraining\jobs\`, `visheart-inference-gpu\app\models\active\`, `Cardiac_Segmentation_FYP_Server\dist\temp_exports\`.
- Disk check: at least 40 GB free on the install drive. Windows 10 build 19041+ or Windows 11, x64.
- Docker Compose must accept multiple `--env-file` flags (v2.17+); Task 1 verifies the installed version.
- Developers' `start.bat` / `stop.bat` from a normal clone behave exactly as today when no env files exist.
- Releases are built only from a clean, committed checkout.

## Review Focus

1. **Update over an existing install** must keep `secrets.env`; regenerating it would lock the app out of its own MongoDB. Test: Task 3 `secrets file is not rewritten on second run`; Task 6 manual update check.
2. **Docker installed but not running, or the Windows account is not in `docker-users`**: start must open Docker Desktop and wait, or say exactly which account to add, never hang or show a raw error. Test: Task 2 `Wait-DockerReady` cases.
3. **PC with no NVIDIA GPU**: installer warns but continues; VisHeart starts in CPU mode. Test: Task 5 `missing nvidia-smi is a warning, not a blocker`.
4. **Uninstall when Docker is not running or a training is running**: uninstall must finish without waiting on `pause`/`choice`. Test: Task 2 `stop.bat --no-pause` check.
5. **Pinned image missing on Docker Hub, or the shipped `unet.pth` not matching the pack's registry**: staging stops with a named error. Test: Task 4 cases.

---

### Task 0: Branch

- [ ] **Step 1:** From the repository root `E:\Jy\COS40005FYPA`, create `feat/one-click-installer` from `test/jiayi-hackathon`. Leave the existing uncommitted `visheart-frontend/src/app/project/[projectId]/page.tsx` change alone (do not stage it).

---

### Task 1: Parameterise the repository compose

**Files:**
- Modify: `cardiac-component-segmentation-ai/visheart-local-deployment/docker-compose.yml`
- Modify: `.gitignore` (repository root)
- Create: `cardiac-component-segmentation-ai/visheart-local-deployment/tests/Compose.Tests.ps1`
- Create: `cardiac-component-segmentation-ai/visheart-local-deployment/tests/fixtures/installed.env`

**Interfaces:**
- Produces the variable names later tasks write into env files:
  `VH_BIND`, `VH_APP_IMAGE`, `VH_GPU_IMAGE`, `VH_MINIO_IMAGE`, `VH_MINIO_CLIENT_IMAGE`, `VH_MINIO_ANON`,
  `VH_MONGO_PASSWORD`, `VH_MINIO_PASSWORD`, `VH_ADMIN_PASS`, `VH_JWT_SECRET`, `VH_SESSION_SECRET`,
  `VH_GPU_ACCESS_SECRET`, `VH_GPU_JWT_SECRET`, `VH_GPU_SERVER_AUTH_JWT_SECRET`,
  `VH_SUPPORT_EMAIL`, `VH_SMTP_USER`, `VH_SMTP_PASS`.
- Generated passwords are alphanumeric only, so `VH_MONGO_PASSWORD` is used unencoded inside `MONGODB_URI`. The dev default keeps today's encoded `P%40ssw0rd123%21` via a separate default: `${VH_MONGO_PASSWORD_URL:-P%40ssw0rd123%21}`; env files set `VH_MONGO_PASSWORD_URL` equal to `VH_MONGO_PASSWORD`.

- [ ] **Step 1: Check Compose version.** Run `docker compose version`. Expected: v2.17 or later. If older, stop and report.

- [ ] **Step 2: Write the failing tests** in `Compose.Tests.ps1` (Pester 3). Helper: `docker compose -f ..\docker-compose.yml [--env-file X] --profile gpu --profile cpu config --format json | ConvertFrom-Json`.
  - `defaults keep today's values`: with no env file, `visheart-app` port 3000 has no `host_ip` (or `0.0.0.0`); `visheart-app.image` = `sharlene21/visheart-local:1.5.0`; `mongodb.environment.MONGO_INITDB_ROOT_PASSWORD` = `P@ssw0rd123!`; `visheart-app.environment.MONGODB_URI` contains `admin:P%40ssw0rd123%21@`.
  - `no personal mail in repository`: the raw compose text does not match `meiqiliew334`, and `visheart-app.environment.SMTP_PASS` is empty.
  - `installed env applies`: with `--env-file tests\fixtures\installed.env`, every service's every port has `host_ip` `127.0.0.1`; `gpu-nvidia.image` = the fixture's `VH_GPU_IMAGE`; `visheart-app.environment.ADMIN_PASS` = fixture value; the `minio-setup` entrypoint contains `anonymous set none` and the fixture MinIO password.
- [ ] **Step 3: Run** `powershell -NoProfile -Command "Invoke-Pester .\tests\Compose.Tests.ps1"` from `visheart-local-deployment`. Expected: the `installed env applies` and `no personal mail` cases FAIL.
- [ ] **Step 4: Edit `docker-compose.yml`:** every `"H:C"` port → `"${VH_BIND:-0.0.0.0}:H:C"`; each image → `${VH_<NAME>_IMAGE:-<today's ref>}`; each secret listed in Interfaces → `${VH_…:-<today's value>}` (including the Mongo healthcheck and the `mc alias set` line); add `ADMIN_PASS: ${VH_ADMIN_PASS:-P@ssw0rd123!}` to `visheart-app`; `mc anonymous set ${VH_MINIO_ANON:-download}`; `ADMIN_SUPPORT_EMAIL`, `SMTP_FROM`, `SMTP_USER` → `${VH_SUPPORT_EMAIL:-}` / `${VH_SMTP_USER:-}`, `SMTP_PASS` → `${VH_SMTP_PASS:-}`. Escape any literal `$` already in the file as `$$`.
- [ ] **Step 5: Add to root `.gitignore`:** `cardiac-component-segmentation-ai/visheart-local-deployment/secrets.env`, `cardiac-component-segmentation-ai/visheart-local-deployment/release.env`, `cardiac-component-segmentation-ai/installer/smtp.release.env`, `cardiac-component-segmentation-ai/installer/out/`.
- [ ] **Step 6: Run the tests.** Expected: all PASS. Then run `start.bat` from the repository and confirm login at `http://localhost:3000` with `admin` / `P@ssw0rd123!` still works (dev behaviour unchanged).
- [ ] **Step 7: Commit** `docker-compose.yml`, `.gitignore`, the tests and fixture: "Parameterise local compose for installed copies; drop personal SMTP credentials".

---

### Task 2: Start/stop scripts use env files and wait for Docker

**Files:**
- Create: `cardiac-component-segmentation-ai/visheart-local-deployment/lib/VisHeartStart.psm1`
- Modify: `cardiac-component-segmentation-ai/visheart-local-deployment/start.ps1` (replace `Test-DockerAvailable` at lines 14–21; add the env args to every `docker compose` call, lines 125–144; call `Invoke-FirstPull` before `compose up`)
- Modify: `cardiac-component-segmentation-ai/visheart-local-deployment/stop.bat`
- Test: `cardiac-component-segmentation-ai/visheart-local-deployment/tests/VisHeartStart.Tests.ps1`

**Interfaces:**
- Produces (exported from `VisHeartStart.psm1`):
  - `Get-ComposeEnvArgs([string]$DeploymentDir) -> string[]`: `@('--env-file','<dir>\release.env','--env-file','<dir>\secrets.env')`, including only files that exist; `@()` when neither does.
  - `Invoke-Docker([string[]]$Arguments) -> int` (exit code; the only place `docker` is called, so tests mock it).
  - `Wait-DockerReady([int]$TimeoutSec = 180, [string]$DesktopExe = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe") -> [pscustomobject]@{ Ready=[bool]; Reason=[string] }`. Reasons: `ok`, `not-installed`, `no-access`, `timeout`.
  - `Invoke-FirstPull([string[]]$ComposeArgs, [string[]]$Services) -> int`.
- Consumes: Task 1 env file names.

- [ ] **Step 1: Write the failing tests** (mock `Invoke-Docker`, `Start-Process`, `Test-Path`, `Start-Sleep`):
  - `Get-ComposeEnvArgs` returns `@()` for an empty temp dir, and the two-file array in order release then secrets when both exist.
  - `Wait-DockerReady` returns `Ready=$true, Reason='ok'` when `Invoke-Docker version` returns 0 first time, and does not call `Start-Process`.
  - Returns `not-installed` when `version` fails and `$DesktopExe` does not exist.
  - Starts Docker Desktop once and returns `ok` when `version` fails twice then succeeds.
  - Returns `timeout` with `-TimeoutSec 0` when `version` keeps failing.
  - Returns `no-access` when the docker error output contains `Access is denied` or `permission denied` and the pipe exists.
  - `Invoke-FirstPull` calls `compose … pull` only when `Invoke-Docker image inspect <image>` fails for some service image.
- [ ] **Step 2: Run** `Invoke-Pester .\tests\VisHeartStart.Tests.ps1`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `VisHeartStart.psm1`.** Use `$LASTEXITCODE`, not try/catch, to detect native failures (the current `Test-DockerAvailable` never sees them). Poll every 3 s. For `no-access`, the message `start.ps1` prints is: `Docker is installed but this Windows account (<DOMAIN\user>) cannot use it. Ask the person who installed VisHeart to run: net localgroup docker-users "<DOMAIN\user>" /add  then sign out and in again.` Before `Invoke-FirstPull` pulls, print `First start: downloading VisHeart (about 25 GB). This can take an hour or more; later starts take about a minute.`
- [ ] **Step 4: Wire into `start.ps1`:** add `[switch]$ForceCpu, [switch]$ForceGpu` to `param()` (start.bat already passes them and PowerShell currently rejects them) and honour them in the profile choice; import the module; replace the Docker check with `Wait-DockerReady` and exit 1 with the reason's message when not ready; prefix every `docker compose` call with `Get-ComposeEnvArgs $scriptDir`; call `Invoke-FirstPull` before `compose up`.
- [ ] **Step 5: Update `stop.bat`:** `docker-compose` → `docker compose`; add `release.env`/`secrets.env` `--env-file` flags when each exists; accept `--no-pause` (skip both `pause` lines) and, with `--no-pause`, default `STOP_TRAINING=yes` when unset.
- [ ] **Step 6: Run the tests.** Expected: PASS. Manual: quit Docker Desktop, run `start.bat`: it opens Docker Desktop and continues. Run `stop.bat --no-pause` with Docker quit: it exits without waiting.
- [ ] **Step 7: Commit:** "Start waits for Docker Desktop and reads installed env files; stop.bat --no-pause".

---

### Task 3: Per-PC secrets generator

**Files:**
- Create: `cardiac-component-segmentation-ai/installer/scripts/New-VisHeartSecrets.ps1`
- Test: `cardiac-component-segmentation-ai/installer/tests/New-VisHeartSecrets.Tests.ps1`

**Interfaces:**
- Produces: `New-VisHeartSecrets.ps1 -DeploymentDir <path> -LoginNotePath <path>` writes `<DeploymentDir>\secrets.env` with every secret `VH_*` name from Task 1 (plus `VH_MONGO_PASSWORD_URL` = `VH_MONGO_PASSWORD`) and writes `<LoginNotePath>` with the VisHeart login. Exit 0 when written or already present, 1 on failure.

- [ ] **Step 1: Write the failing tests:**
  - `writes all secret keys`: the file has exactly these keys: `VH_MONGO_PASSWORD, VH_MONGO_PASSWORD_URL, VH_MINIO_PASSWORD, VH_ADMIN_PASS, VH_JWT_SECRET, VH_SESSION_SECRET, VH_GPU_ACCESS_SECRET, VH_GPU_JWT_SECRET, VH_GPU_SERVER_AUTH_JWT_SECRET`.
  - `machine secrets are 32 alphanumeric chars`: every value except `VH_ADMIN_PASS` matches `^[A-Za-z0-9]{32}$`; two runs in different temp dirs give different values.
  - `admin password meets the login rules`: 16 chars, at least one each of upper, lower, digit and one of `!@#%`.
  - `secrets file is not rewritten on second run`: content and `LastWriteTime` unchanged after a second call.
  - `login note`: contains `admin`, the admin password, `http://localhost:3000`, and `Change this password after your first login.`
- [ ] **Step 2: Run** `Invoke-Pester .\installer\tests`. Expected: FAIL.
- [ ] **Step 3: Implement** with `System.Security.Cryptography.RNGCryptoServiceProvider`. Write UTF-8 without BOM (Compose rejects a BOM on the first key).
- [ ] **Step 4: Run tests.** Expected: PASS. Also run Task 1's `docker compose --env-file <generated> config` once to confirm Compose parses the generated file.
- [ ] **Step 5: Commit:** "Add per-PC secrets generator for installed copies".

---

### Task 4: Release config and staging script

**Files:**
- Create: `cardiac-component-segmentation-ai/installer/VERSION` (content `1.0.0`)
- Create: `cardiac-component-segmentation-ai/installer/release.json`
- Create: `cardiac-component-segmentation-ai/installer/smtp.release.env.example`
- Create: `cardiac-component-segmentation-ai/installer/lib/Staging.psm1`
- Create: `cardiac-component-segmentation-ai/installer/make-installer.ps1`
- Test: `cardiac-component-segmentation-ai/installer/tests/Staging.Tests.ps1`

**Interfaces:**
- `release.json`: `{ "images": { "VH_APP_IMAGE": "sharlene21/visheart-local:<tag>", "VH_GPU_IMAGE": "sharlene21/visheart-gpu:<tag>", "VH_MINIO_IMAGE": "…", "VH_MINIO_CLIENT_IMAGE": "…" } }`. Tags are filled by the team lead after pushing; mongo `7.0` and redis `7-alpine` stay as in compose.
- `smtp.release.env` keys: `VH_SUPPORT_EMAIL`, `VH_SMTP_USER`, `VH_SMTP_PASS`.
- Exported from `Staging.psm1`:
  - `Get-StagingSelection([string]$RepoRoot) -> [pscustomobject[]]` with `Source`, `Target` (relative to staging root, two-level layout).
  - `Test-ReleaseImages([hashtable]$Images) -> string[]` (missing refs; uses `docker manifest inspect`; any `:latest` counts as invalid).
  - `Test-ModelMatchesPack([string]$UnetPath, [string]$PackRoot) -> bool` (SHA-256 of `unet.pth` vs the pack's `PACKED.json` entry for `repo-models/unet.pth`).
  - `Write-ReleaseEnv([hashtable]$Images, [string]$SmtpEnvPath, [string]$OutPath)` writes images + SMTP + `VH_BIND=127.0.0.1` + `VH_MINIO_ANON=none`.
- `make-installer.ps1 -Variant Full|Update [-PackPath <path>] [-SkipImageCheck]`: refuses on a dirty `git status --porcelain`; runs `npm ci` and `npm run build` in `Cardiac_Segmentation_FYP_Server`; stages to `installer\out\staging`; for `Full`, copies the pack to `cardiac-component-segmentation-ai\visheart-training-data` in staging and runs `pack_training_data.py verify` on it; writes `release.env`; calls `ISCC.exe /DVariant=<Variant> /DAppVersion=<VERSION> visheart.iss`. Output `installer\out\VisHeart-<Variant>-<VERSION>\`.

- [ ] **Step 1: Write the failing tests** (temp fake repo tree):
  - `selection uses the two-level layout`: includes `UNETRESNET34\check_labels.py` at staging root and `cardiac-component-segmentation-ai\visheart-local-deployment\docker-compose.yml`.
  - `selection excludes dev and per-PC folders`: no path under `.git`, `node_modules`, `venv313`, `.venv`, `__pycache__`, `tests`, `app\models\active`, `atlas_rv_backup_pre_lengthwise`, `visheart-retraining\jobs`, `dist\temp_exports`, and no `secrets.env`.
  - `selection includes the built backend`: `Cardiac_Segmentation_FYP_Server\dist\index.js` and `src\python\…`.
  - `latest and missing images are reported` (mock the docker call): `:latest` ref and a ref whose manifest call fails are returned; a good ref is not.
  - `model hash mismatch is detected`: `Test-ModelMatchesPack` false when bytes differ, true when equal.
  - `release env content`: `Write-ReleaseEnv` output has the four image keys, three SMTP keys, `VH_BIND=127.0.0.1`, `VH_MINIO_ANON=none`, no BOM.
- [ ] **Step 2: Run** `Invoke-Pester .\installer\tests\Staging.Tests.ps1`. Expected: FAIL.
- [ ] **Step 3: Implement `Staging.psm1` and `make-installer.ps1`.** Error messages name the failing item, e.g. `Image sharlene21/visheart-gpu:1.6.0 is not on Docker Hub. Ask the team lead to push it, or fix installer/release.json.` and `unet.pth does not match the training pack (PACKED.json). Re-pack with pack_training_data.py or ship the matching model.`
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Dry run:** `.\installer\make-installer.ps1 -Variant Update -SkipImageCheck` on a clean checkout with ISCC absent: staging completes and the script stops with `Inno Setup 6.5.2+ not found (ISCC.exe)`. Inspect `installer\out\staging` for the two-level layout.
- [ ] **Step 6: Commit:** "Add release config and installer staging script".

---

### Task 5: Prerequisite checks

**Files:**
- Create: `cardiac-component-segmentation-ai/installer/scripts/Test-VisHeartPrerequisites.ps1`
- Test: `cardiac-component-segmentation-ai/installer/tests/Prerequisites.Tests.ps1`

**Interfaces:**
- Produces: `Test-VisHeartPrerequisites.ps1 -InstallDrive C: -OutJson <path>` writes `[{ "Name": "windows|wsl|docker|nvidia|python|disk", "Status": "ok|missing|warn|block", "Message": "<plain sentence>" }]`. Exit 0 when nothing is `block`, 2 otherwise. Each probe is a function (`Get-WindowsBuild`, `Test-WslEnabled`, `Test-DockerDesktopInstalled`, `Test-NvidiaDriver`, `Get-PythonVersion`, `Get-FreeSpaceGB`) so tests can mock it.

- [ ] **Step 1: Write the failing tests:**
  - `old Windows blocks`: build 18363 → `windows` `block`.
  - `missing WSL and Docker are 'missing', not 'block'` (installer fixes them).
  - `missing nvidia-smi is a warning, not a blocker`: `nvidia` `warn` with message containing `CPU mode` and `MedSAM`.
  - `python below 3.11 is 'missing'`; 3.13 is `ok`.
  - `less than 40 GB blocks`: 39.9 → `disk` `block`, message names the free and needed GB.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** WSL: `wsl --status` exit code; Docker: `Docker Desktop.exe` under `$env:ProgramFiles\Docker\Docker`; Python: `py -3 --version` then `python --version`.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit:** "Add installer prerequisite checks".

---

### Task 6: Inno Setup installer

**Files:**
- Create: `cardiac-component-segmentation-ai/installer/visheart.iss`
- Create: `cardiac-component-segmentation-ai/installer/INSTALL.md`

**Interfaces:**
- Consumes: staging layout (Task 4), `Test-VisHeartPrerequisites.ps1` (Task 5), `New-VisHeartSecrets.ps1` (Task 3), `stop.bat --no-pause` (Task 2).

- [ ] **Step 1: Install Inno Setup** on the build PC (ask the user first): `winget install -e --id JRSoftware.InnoSetup`, then confirm `ISCC.exe` reports 6.5.2 or later.
- [ ] **Step 2: Write `visheart.iss`:**
  - `[Setup]`: fixed `AppId` GUID (generate once, keep forever), `AppVersion={#AppVersion}`, `DefaultDirName=C:\VisHeart`, `DisableDirPage=yes`, `PrivilegesRequired=admin`, `ArchitecturesAllowed=x64compatible`, `DiskSpanning=yes`, `Compression=lzma2/fast`, `OutputBaseFilename=VisHeart-{#Variant}-{#AppVersion}`.
  - `[Files]`: staging tree; `Flags: onlyifdoesntexist uninsneveruninstall` for `visheart-training-data\*` (Full only, `#if Variant == "Full"`); never ship `secrets.env`.
  - `[Code]` `InitializeSetup`: run the prerequisites script into `{tmp}`; on any `block`, show its message and abort; show `warn` messages in one dialog with Continue.
  - `[Run]` / `CurStepChanged(ssPostInstall)`: if WSL missing `wsl --install --no-distribution`; if Docker missing `winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements`; if Python missing `winget install -e --id Python.Python.3.13 --scope machine`; `net localgroup docker-users "{username}" /add` (ignore "already a member"); run `New-VisHeartSecrets.ps1 -DeploymentDir {app}\cardiac-component-segmentation-ai\visheart-local-deployment -LoginNotePath {app}\FIRST-LOGIN.txt`; set `NeedRestart` when WSL or Docker was installed.
  - `PrepareToInstall`: if `{app}` exists, run `stop.bat --no-pause` first.
  - Finish page shows the content of `FIRST-LOGIN.txt` and reminds the user that Docker Desktop will ask them to accept its terms on first launch.
  - `[Icons]`: desktop + Start menu `Start VisHeart` → `{app}\cardiac-component-segmentation-ai\start.bat`, `Stop VisHeart` → `…\stop.bat`, `VisHeart` → URL `http://localhost:3000`.
  - `[UninstallRun]`: `stop.bat --no-pause`. Uninstall page checkbox `Also delete all VisHeart data (patients, accounts, trained models)`: when ticked, `docker compose … down -v` and delete `visheart-training-data`, `visheart-retraining\.venv`, `jobs`, `models\active`, `dist\temp_exports`, `secrets.env`, `FIRST-LOGIN.txt`.
- [ ] **Step 3: Build both variants:** `.\installer\make-installer.ps1 -Variant Full -PackPath <pack>` and `-Variant Update`. Expected: `installer\out\VisHeart-Full-1.0.0\VisHeart-Full-1.0.0.exe` + `.bin` slices; Update well under 1 GB.
- [ ] **Step 4: Write `INSTALL.md`** (one page, plain language): requirements (Windows 10 2004+/11, 40 GB free, admin rights, NVIDIA optional), run `VisHeart-Full-….exe` from the unzipped folder, reboot if asked, accept Docker Desktop's terms once, first start downloads ~25 GB, where `FIRST-LOGIN.txt` is, how to update (run the Update installer), how to add another Windows account to `docker-users`, how to uninstall and what the delete-data box does.
- [ ] **Step 5: Commit** `visheart.iss`, `INSTALL.md`: "Add Inno Setup installer and install guide". Do not commit `installer/out`.

---

### Task 7: Clean-machine acceptance test

**Files:**
- Create: `docs/superpowers/plans/2026-11-16-one-click-installer-test-log.md` (results)

- [ ] **Step 1: Prepare** a Windows 10/11 PC or VM with virtualisation and no Docker, Git, Node or Python. Copy `VisHeart-Full-1.0.0\` to it.
- [ ] **Step 2: Fresh install path:** run the installer → reboot when asked → accept Docker terms → `Start VisHeart` → first pull completes → log in with the `FIRST-LOGIN.txt` password → upload a study and run a segmentation → as admin, open UNet Extend Training and see the version list with the original in use. Record each step pass/fail and time.
- [ ] **Step 3: Network exposure:** from another PC on the same network, `Test-NetConnection <pc> -Port 27017` and ports 3000, 5000, 6379, 9000, 8001. Expected: all fail. Locally, `http://localhost:9000/visheart-bucket/<any key>` returns AccessDenied.
- [ ] **Step 4: FAQ mail:** send a FAQ message; it arrives at the support mailbox.
- [ ] **Step 5: Update path:** create one patient, run `VisHeart-Update-1.0.0.exe` over the install, start again. Expected: login with the same password works, the patient is still there, `secrets.env` and `visheart-training-data\versions\registry.json` are byte-identical to before.
- [ ] **Step 6: CPU path:** on a PC without an NVIDIA GPU (or with `start.bat --cpu`): installer shows the CPU-mode warning and VisHeart starts.
- [ ] **Step 7: Uninstall:** uninstall with the delete box unticked while Docker Desktop is closed: finishes without hanging; data volumes remain (`docker volume ls`). Reinstall, then uninstall with the box ticked: volumes and training data are gone.
- [ ] **Step 8:** Fix any failures in the owning task (with a test where possible), rebuild, re-run the failed steps; commit the test log.
