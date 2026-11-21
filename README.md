# VisHeart

VisHeart is a web application for analysing cardiac MRI. It runs on one Windows PC: doctors open it in a web browser
on that PC, and nothing is reachable from other computers. Patient data never leaves the PC.

## Features

- **Projects:** upload cardiac MRI scans (NIfTI) per patient, or try the built-in sample data.
- **AI segmentation:** outlines the heart's chambers on every slice with UNet (CPU or NVIDIA GPU) or MedSAM (GPU
  only). Results can be reviewed and corrected.
- **Landmark detection:** marks anatomical landmarks on the scans.
- **3D and 4D reconstruction:** builds a 3D model of the heart and its motion over the heartbeat.
- **LV and RV analysis:** bullseye plots of the left ventricle (17 segments) and right ventricle (9 segments,
  research), with reports.
- **UNet Extend Training:** administrators retrain the segmentation model on corrected cases from their own PC.
- **Accounts and administration:** doctor and admin roles, profile settings, and a FAQ page that sends questions to
  the VisHeart team.

## Install and use (for users)

**Download:** [VisHeart on Google Drive](https://drive.google.com/drive/folders/1XUpuhkLg4mF25GY7j9Gl1y7s0hChwndv?usp=sharing)

You need Windows 10 (version 2004 or later) or Windows 11, 64-bit, administrator rights to install, at least 40 GB
of free disk space for VisHeart, and about 6 GB more while installing (for the download). An NVIDIA graphics card is
optional: without one, VisHeart is slower and the MedSAM tool is not available.

1. Open the Google Drive folder, click the newest `VisHeart-Full-<version>.zip` (one file, about 2.8 GB) and click
   **Download**. Google Drive says it cannot scan large files for viruses; click **Download anyway**.
2. In your Downloads folder, right-click the zip and choose **Extract All**, then **Extract**.
3. In the extracted folder, double-click `VisHeart-Full-<version>.exe`. (If you open the `.exe` without extracting
   first, setup asks for "Disk 2". Cancel and do step 2.)
4. Choose the install folder (default `C:\VisHeart`). The installer installs Docker Desktop, WSL2 and Python if they
   are missing.
5. At the end it shows your **admin login** and saves it as `FIRST-LOGIN.txt` in the install folder. Click
   **Finish**. Restart Windows if the installer asks you to.
6. Double-click the **VisHeart** heart icon on the desktop. It starts Docker Desktop and VisHeart, then opens
   http://localhost:3000. The first time Docker Desktop opens, accept its terms. The first start downloads about 25 GB
   and can take an hour; later starts take about a minute.
7. Sign in, then change the admin password in **Profile Settings**. After that, the password in `FIRST-LOGIN.txt`
   no longer works.

- **Stop:** Start menu > VisHeart > **Stop VisHeart**.
- **Update:** VisHeart shows a popup when a new version is published. Download the newest
  `VisHeart-Update-<version>.zip`, extract it and run the `.exe` in it. Your data is kept.
- **Uninstall:** Windows Settings > Apps > Installed apps > VisHeart > **...** > Uninstall.

Full user guide: [`installer/INSTALL.md`](cardiac-component-segmentation-ai/installer/INSTALL.md).

## How it works

VisHeart runs as Docker containers on the user's PC, started together by one `docker-compose.yml`:

| Container | What it does |
|---|---|
| `visheart-local` | Web page (Next.js) and backend API (Node.js) in one image |
| `visheart-gpu-cpu` / `visheart-gpu-nvidia` | AI service (Python, FastAPI): runs the AI models and heart analyses |
| `visheart-mongodb` | Database: users, projects, results |
| `visheart-redis` | Login sessions and the login-lockout counters |
| `visheart-minio` | File storage: scans, masks, 3D models |

The **VisHeart** icon runs `start.bat`, which waits for Docker Desktop, picks GPU or CPU mode, starts the containers
and opens the browser. Users never get code from GitHub. The team builds a Windows **installer** that contains the
app files and AI models, and names the exact Docker images to download from Docker Hub. Each PC gets its own random
passwords when it is installed.

Code is delivered in two ways:

- **As files in the installer:** backend (`Cardiac_Segmentation_FYP_Server/dist`), AI service code, scripts, models.
- **Inside a Docker image:** the frontend, and the backend's npm packages and the AI service's Python packages.

## For developers

### Run VisHeart locally from source (to test your changes)

You need Windows 10/11 (64-bit), [Docker Desktop](https://www.docker.com/products/docker-desktop/), Node.js 18
with pnpm (`npm install -g pnpm`), Python 3.11 or later, and git.

1. Clone the repository and switch to the branch you work on.
2. **AI models.** Two model files are too large for git: `medsam_vit_b.pth` and `unet.pth`. Copy them from the team's
   Google Drive into `cardiac-component-segmentation-ai/visheart-inference-gpu/app/models/`. (With the training pack
   in step 3, the first start puts the right `unet.pth` there by itself.) The other models are already in git.
3. **Training data pack** (only needed for UNet Extend Training; everything else works without it). Download the
   training pack from the VisHeart Google Drive folder. Put its contents in
   `cardiac-component-segmentation-ai/visheart-training-data/`, so that `PACKED.json` is directly inside that folder:
   ```
   cardiac-component-segmentation-ai\
     start.bat
     visheart-training-data\
       PACKED.json
       ...
   ```
   If it is a zip, extract it first. Git ignores this folder.
4. **Build the backend once:**
   ```
   cd cardiac-component-segmentation-ai\Cardiac_Segmentation_FYP_Server
   pnpm install
   pnpm build
   ```
5. **Start:** double-click `cardiac-component-segmentation-ai\start.bat` (or run it with `--cpu` / `--gpu` to force a
   mode). The first start downloads about 25 GB of Docker images. With the training pack, the first start also sets up
   UNet Extend Training (about 10 minutes, the website is usable meanwhile). Open http://localhost:3000 and sign in as
   `admin` with password `P@ssw0rd123!` (the developer default).
6. **Stop:** `cardiac-component-segmentation-ai\stop.bat`.

More on the training pack (making one, problems):
[`visheart-retraining/SETUP-ANOTHER-PC.md`](cardiac-component-segmentation-ai/visheart-retraining/SETUP-ANOTHER-PC.md).
An installed VisHeart and a developer copy can be on the same PC, but only one can run at a time: stop one before
starting the other.

### After you change code

The containers do not reload changed code by themselves. After a change, run `stop.bat`, then `start.bat`.

| You changed | To test it locally | To get it to users |
|---|---|---|
| Backend (`Cardiac_Segmentation_FYP_Server/src`) | `pnpm build`, then `stop.bat` and `start.bat` | Commit; the next installer ships it |
| AI service code (`visheart-inference-gpu/app`) | `stop.bat` and `start.bat`. A **new** `.py` file also needs a mount line in `docker-compose.yml` under both `gpu-cpu` and `gpu-nvidia` (copy an existing line) | Commit; the next installer ships it |
| Frontend (`visheart-frontend`), backend npm packages, AI Python packages | Build a new image (below) and test it before pushing | New image, then a new installer |
| Scripts, `docker-compose.yml`, `visheart-retraining` | `stop.bat` and `start.bat` | Commit; the next installer ships it |

Run the tests before you push. GitHub Actions also runs them on every push (`.github/workflows/tests.yml`):

- Backend: `pnpm test` in `Cardiac_Segmentation_FYP_Server`. Three old test files (`auth`, `database._user`,
  `database_project`) are fully commented out and show as failed suites; CI skips them.
- Start, stop and installer scripts: `Invoke-Pester` on `visheart-local-deployment/tests` and `installer/tests`
  (Windows PowerShell, Pester 3.4).

### When you build a new image

1. Start Docker Desktop. In PowerShell, in `cardiac-component-segmentation-ai\visheart-local-deployment`, build the
   image with a **new version number** (one that was never pushed before):
   ```
   .\build.ps1 -Version 1.6.0
   ```
2. Test it locally before pushing: in `visheart-local-deployment\docker-compose.yml`, change the default image to the
   new tag, `${VH_APP_IMAGE:-sharlene21/visheart-local:1.6.0}`, then run `stop.bat` and `start.bat`. VisHeart now
   runs your new image.
3. Push it (needs access to the `sharlene21` Docker Hub account; ask the team lead):
   ```
   docker push sharlene21/visheart-local:1.6.0
   ```
4. Put the same tag in `cardiac-component-segmentation-ai/installer/release.json` (`VH_APP_IMAGE`). Commit both files,
   then make a release (below).

Why a new number every time: an installed PC downloads an image only when its tag is new to it. If you push a
changed image under an old tag, installed PCs never get it.

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

- `main` — stable branch, no direct push. Installed PCs read `installer/latest.json` from here.
- `dev` — integration branch for sprint work.
- `test/<name>` — each member's own work branch.
- Merge work through pull requests into `dev`.
