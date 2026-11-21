# VisHeart

VisHeart is a web application for analysing cardiac MRI. It runs on one Windows PC: doctors open it in a web browser
on that PC, and nothing is reachable from other computers. Patient data never leaves the PC.

## Features

- **Projects:** upload cardiac MRI scans (NIfTI) per patient, or try the built-in sample data.
- **AI segmentation:** outlines the heart's chambers on every slice with UNet (CPU or NVIDIA GPU) or MedSAM (GPU
  only). Results can be reviewed and corrected.
- **Landmark detection:** finds the anatomical landmarks used for the analyses below.
- **3D and 4D reconstruction:** builds a 3D model of the heart and its motion over the heartbeat.
- **LV and RV analysis:** bullseye plots of the left ventricle (17 segments) and right ventricle (9 segments,
  research), with reports.
- **UNet Extend Training:** administrators retrain the segmentation model on corrected cases from their own PC.
- **Accounts and administration:** doctor and admin roles, profile settings, and a FAQ page that sends questions to
  the VisHeart team.

## Install and use (for users)

**Download:** [VisHeart on Google Drive](PUT-THE-GOOGLE-DRIVE-LINK-HERE)

You need Windows 10 (2004 or later) or Windows 11, 64-bit, at least 40 GB free disk space, and administrator rights
to install. An NVIDIA graphics card is optional (without one, VisHeart is slower and MedSAM is not available).

1. Download `VisHeart-Full-<version>.zip` (one file, about 2.8 GB). Google Drive warns it cannot scan large files;
   click **Download anyway**.
2. Right-click the zip, choose **Extract All**, then run `VisHeart-Full-<version>.exe` from the extracted folder.
   Do not run it from inside the zip.
3. Choose the install folder (default `C:\VisHeart`). The installer installs Docker Desktop, WSL2 and Python if they
   are missing.
4. At the end it shows your **admin login**. The same login is saved in `FIRST-LOGIN.txt` in the install folder.
   Restart Windows if asked, then open Docker Desktop once and accept its terms.
5. Double-click the **VisHeart** heart icon on the desktop. It starts everything and opens http://localhost:3000.
   The first start downloads about 25 GB and can take an hour; later starts take about a minute.
6. After your first login, change the admin password in **Profile Settings**.

**Stop:** Start menu > VisHeart > **Stop VisHeart**. **Update:** download the newest `VisHeart-Update-<version>.zip`
and run it the same way; your data is kept. VisHeart shows a popup when a new version is published.
**Uninstall:** Windows Settings > Apps > Installed apps > VisHeart.

Full user guide: [`installer/INSTALL.md`](cardiac-component-segmentation-ai/installer/INSTALL.md).

## How it works

VisHeart runs as Docker containers on the user's PC, started together by one `docker-compose.yml`:

| Container | What it does |
|---|---|
| `visheart-local` | Web page (Next.js) and backend API (Node.js) in one image |
| `visheart-gpu-cpu` / `visheart-gpu-nvidia` | AI service (Python, FastAPI): runs the AI models and heart analyses |
| `visheart-mongodb` | Database: users, projects, results |
| `visheart-redis` | Job queue for long AI tasks |
| `visheart-minio` | File storage: scans, masks, 3D models |

The **VisHeart** icon runs `start.bat`, which waits for Docker Desktop, picks GPU or CPU mode, starts the containers
and opens the browser. Users never get code from GitHub. The team builds a Windows **installer** that contains the
app files and AI models, and names the exact Docker images to download from Docker Hub. Each PC gets its own random
passwords when it is installed.

Code is delivered in two ways:

- **As files in the installer:** backend (`Cardiac_Segmentation_FYP_Server/dist`), AI service code, scripts, models.
- **Inside a Docker image:** the frontend, and the backend's npm packages and the AI service's Python packages.

## For developers

### Run from source

1. Install Docker Desktop, Node.js 18 with pnpm (`npm install -g pnpm`), and Python 3.11 or later.
2. Copy the model files (`unet.pth`, `medsam_vit_b.pth`, ...) from the team's drive into
   `cardiac-component-segmentation-ai/visheart-inference-gpu/app/models/`. They are not in git.
3. Build the backend once: `cd cardiac-component-segmentation-ai/Cardiac_Segmentation_FYP_Server`, then
   `pnpm install` and `pnpm build`.
4. Run `cardiac-component-segmentation-ai/start.bat` (`--cpu` or `--gpu` to force a mode) and open
   http://localhost:3000. Stop with `stop.bat`. A developer copy uses the defaults in `docker-compose.yml`
   (admin password `P@ssw0rd123!`).

An installed VisHeart and a developer copy can be on the same PC, but only one can run at a time.

### After you change code

| You changed | What to do |
|---|---|
| Backend (`Cardiac_Segmentation_FYP_Server/src`) | Run `pnpm build`, then `start.bat` again. For users: commit; the next installer ships it. |
| AI service code (`visheart-inference-gpu/app`) | Restart with `start.bat`. A **new** `.py` file must also get a mount line in `docker-compose.yml`. |
| Frontend (`visheart-frontend`), npm or Python packages | Build a new Docker image (below). |
| Scripts, `docker-compose.yml`, `visheart-retraining` | Commit; the next installer ships them. |

Run the tests before you push. GitHub Actions also runs them on every push (`.github/workflows/tests.yml`):

- Backend: `pnpm test` in `Cardiac_Segmentation_FYP_Server`. Three old test files (`auth`, `database._user`,
  `database_project`) are fully commented out and show as failed suites; CI skips them.
- Start, stop and installer scripts: `Invoke-Pester` on `visheart-local-deployment/tests` and `installer/tests`
  (Windows PowerShell, Pester 3.4).

### When you build a new image

1. Start Docker Desktop, then in `cardiac-component-segmentation-ai/visheart-local-deployment` run:
   ```
   .\build.ps1 -Version 1.6.0
   docker push sharlene21/visheart-local:1.6.0
   ```
   Use a **new version number every time**. An installed PC downloads an image only when its tag is new to it, so
   re-pushing an existing tag never reaches users. Pushing needs access to the `sharlene21` Docker Hub account.
2. Put the new tag in `installer/release.json` (`VH_APP_IMAGE`) and as the default in `docker-compose.yml`
   (`${VH_APP_IMAGE:-sharlene21/visheart-local:1.6.0}`), so users and developers get it.
3. Commit, then make a release (below).

### Make a release

1. Commit everything (the build refuses uncommitted changes).
2. Raise the version in `installer/VERSION`, for example `1.0.1` to `1.0.2`.
3. Build: `.\cardiac-component-segmentation-ai\installer\make-installer.ps1 -Variant Update`, and for new PCs also
   `-Variant Full -PackPath <training data pack>`. It checks the code, models and images, and writes one zip per
   installer to `installer/out/`.
4. Test the installer, then upload **only the zip** to the Google Drive folder.
5. Edit `installer/latest.json` (new version, Drive link, short note) and merge it into `main`. Installed PCs then
   show the "update available" popup.

Updates remove what the old version no longer uses: old program files and old VisHeart Docker images. User data is
never removed. Never ship a file that VisHeart writes data into: deleting it from the repository deletes it from
users' PCs at their next update.

Step-by-step release guide, including the one-time build PC setup:
[`installer/RELEASING.md`](cardiac-component-segmentation-ai/installer/RELEASING.md). Map of the code:
[`README_CODEBASE.md`](README_CODEBASE.md).

## Team rules

- `main` — stable branch, no direct push.
- `develop` — integration branch for sprint work.
- `feature/<name-task>` — individual work branches; `fix/<issue>` — bug-fix branches when needed.
- Merge work through pull requests into `develop`.

Sprint 1 branches: `feature/meiqi-branch-strategy-frontend-audit`, `feature/jiayi-docker-device-agnostic`,
`feature/stefani-nifti-smoke-amd-fix`, `feature/sharlene-readme-linux-support`.
