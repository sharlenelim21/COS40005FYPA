# Releasing VisHeart (for developers)

This is how your code changes reach the people who install VisHeart. Users never get code from GitHub. They get an
installer that one team member builds with `make-installer.ps1` and puts on the team's Google Drive. A change that
is not in that installer, or in a Docker image it names, does not reach users.

There are two installers:

| Installer | Size | Contains | Who runs it |
|---|---|---|---|
| `VisHeart-Full-<version>.zip` | about 2.8 GB | app files, models, UNet Extend Training data pack | any PC: installs VisHeart, or updates an installed copy and keeps its data |
| `VisHeart-Update-<version>.zip` | about 800 MB | app files and models | a PC that already has VisHeart (it refuses to run on a PC without one) |

Both download the Docker images (about 25 GB) on the first start of a new version, not in the installer.

## 1. Where your change goes

Find the folder you changed, then do what the table says.

| You changed | How it reaches users | What you must do |
|---|---|---|
| `Cardiac_Segmentation_FYP_Server/src` (backend) | `make-installer` builds `dist` and ships it | Commit. Nothing else. |
| `visheart-inference-gpu/app` (a file that already exists) | shipped, and mounted into the GPU container | Commit. Nothing else. |
| `visheart-inference-gpu/app` (a **new** `.py` file) | shipped, but the GPU container only sees the files listed in `docker-compose.yml` | Add a mount line for it under **both** `gpu-cpu` and `gpu-nvidia` in `visheart-local-deployment/docker-compose.yml` (copy an existing line). Commit. |
| `UNETRESNET34`, `visheart-retraining`, `visheart-local-deployment` (scripts, compose) | shipped | Commit. Nothing else. |
| `visheart-frontend` (any page or component) | **not shipped as files.** The frontend is built into the Docker image `sharlene21/visheart-local` | Build and push a new image, then name it in `release.json` (section 3). |
| Backend `package.json` (a new npm package) | the image holds `node_modules` | New image (section 3). |
| GPU Python packages (`requirements`) | the image holds them | New GPU image, pushed with a version tag; put it in `release.json` as `VH_GPU_IMAGE` (section 3). |
| `app/models/*.pth` | shipped from the build PC's folder (the models are not in git) | Put the new file in `visheart-inference-gpu/app/models` on the build PC, and add its name to `$ShippedModelNames` in `installer/lib/Staging.psm1` **and** to the `app/models` lines of `visheart-inference-gpu/.dockerignore`. Only listed files ship or go into the GPU image. Do **not** replace `unet.pth`: it is UNet Extend Training's registered original, and an update never overwrites it. |
| UNet Extend Training data (versions, datasets) | in the Full installer only, from the training pack | Make a new pack (section 4) and build a Full installer. |

**Deleting or renaming a shipped file** removes it from installed PCs at their next update: each installer writes
`shipped-files.txt` (every file it ships), and an update removes the files the old list has and the new one does not.
So never ship a file that VisHeart writes data into. Files VisHeart creates while it runs are never on the list and
are never removed. Old Docker images are removed by the first start after an update (`Remove-OldVisHeartImages`):
only other versions of the images named in `release.json`, never one a container uses or the `docker-compose.yml`
default.

## 2. One-time setup of the build PC

The build PC is the computer that makes the installers. It needs:

1. A git checkout of the repository, on the branch you are releasing.
2. **Inno Setup 6.5.2 or later.** Install it with:
   ```
   winget install -e --id JRSoftware.InnoSetup
   ```
3. **pnpm**, to build the backend (`npm install -g pnpm`), and **Docker Desktop**. Only the `docker` command is used
   here, to check that the images exist on Docker Hub, so Docker Desktop need not be running.
4. **Python 3.11 or later**, for a Full installer only (it checks the training pack).
5. **The two model files that are not in git**, in `cardiac-component-segmentation-ai/visheart-inference-gpu/app/models/`:
   `medsam_vit_b.pth` from the [MedSAM project](https://github.com/bowang-lab/MedSAM) (its README links the
   `medsam_vit_b` weights), and `unet.pth` from the team's Google Drive. For a Full installer, `unet.pth` must be the
   one the training pack was made with (section 4).
6. **`installer/smtp.release.env`**, the support mailbox that the FAQ page sends from:
   1. Copy `installer/smtp.release.env.example` to `installer/smtp.release.env`.
   2. Fill in the team's support Gmail address and a Gmail **app password** for it.
   3. Never use a personal mailbox, and never commit this file (git already ignores it).

## 3. Making a release

1. **Merge and commit everything.** `make-installer` refuses to build when the shipped folders have uncommitted
   changes, because a release must come from committed code.
2. **If the frontend or an npm package changed, build, test and push a new app image.** Start Docker Desktop, then:
   1. Build it with a version number that was never pushed before:
      ```
      cd cardiac-component-segmentation-ai\visheart-local-deployment
      .\build.ps1 -Version 1.6.0
      ```
   2. Set the default image in `visheart-local-deployment\docker-compose.yml` to the new tag
      (`${VH_APP_IMAGE:-sharlene21/visheart-local:1.6.0}`), run `stop.bat` and `start.bat`, and check your change in
      the browser.
   3. Push it. You need push access to the `sharlene21` Docker Hub account; ask the team lead.
      ```
      docker push sharlene21/visheart-local:1.6.0
      ```
   4. Set `"VH_APP_IMAGE": "sharlene21/visheart-local:1.6.0"` in `installer/release.json`.

   Use a new version number every time, never `latest` or an old number: an installed PC downloads an image only when
   its tag is new to it, so a changed image pushed under an old tag never reaches users.
3. **Raise the version.** Edit `installer/VERSION`, for example `1.0.0` to `1.0.1`. Commit.
4. **Build the installer.** From the repository root:
   ```
   .\cardiac-component-segmentation-ai\installer\make-installer.ps1 -Variant Update
   ```
   For new PCs, also build a Full installer (it takes about 10 minutes):
   ```
   .\cardiac-component-segmentation-ai\installer\make-installer.ps1 -Variant Full -PackPath E:\Jy\visheart-training-pack
   ```
   The output is `cardiac-component-segmentation-ai\installer\out\VisHeart-<Variant>-<version>\`: one `.exe` and
   one or more `.bin` files, and next to it `VisHeart-<Variant>-<version>.zip`, the same folder packed into one file.
   The build copies the app files to `vh-staging` at the root of the drive that holds the repository (for example
   `E:\vh-staging`), because the full paths are too long inside the repository folder. That folder holds the support
   mail password in `release.env`: never upload or share it.
5. **Test it before you upload.** Install the Update over a test install and check that you can still log in and
   that your change is there. The first time, and after any change to the installer itself, test the Full installer
   on a clean Windows PC or VM.
6. **Upload.** Put `VisHeart-<Variant>-<version>.zip` (the one file, not the folder) in the team's VisHeart Google
   Drive folder. Google Drive splits a folder download over about 2 GB into several dated zips, and a user who
   extracts only one gets "Please insert Disk 2"; a single file downloads whole, under its own name. Remove or rename
   older versions, so users pick the newest.
7. **Tell the users** which version to download, and whether it is an Update or needs a Full install.
8. **Publish the update notice**, only after step 6, so the link works. Edit `installer/latest.json`: set `version` to
   the new `installer/VERSION`, `download` to the https link of the Google Drive folder, and `note` to one or two
   sentences. Commit it and get it onto the `main` branch on GitHub. Each installed PC reads that file every time
   VisHeart starts (`updateUrl` in `release.json`) and shows a popup when the version is newer than its own.
   Without internet, or while the file is not on `main`, there is simply no popup; starting is never blocked.

## 4. A new training data pack (Full installer only)

On the PC that holds the UNet Extend Training data:
```
py -3 cardiac-component-segmentation-ai\visheart-retraining\pack_training_data.py pack --out F:\visheart-training-pack
```
Then build the Full installer with `-PackPath F:\visheart-training-pack`. The `unet.pth` in `app/models` must be the
one the pack was made with; `make-installer` checks this. An Update installer never ships the pack, and a PC that
already has a pack keeps its own.

The pack holds the **original version only**. Versions trained on your PC (candidates, test runs, the one in use)
stay on your PC: the packed registry lists the original alone, in use, so every installed PC starts clean and shows
only the versions it trains itself. A pack made before this rule still lists trained versions; it does not verify,
and `make-installer` refuses it. Make a new pack.

## 5. When the build stops

| Message | Meaning |
|---|---|
| `These shipped files have uncommitted changes` | Commit or stash the listed files. |
| `<model> is missing from visheart-inference-gpu\app\models` | Copy the model files from the team's drive (section 2). |
| `app\models holds files that are not shipped models` | A test or trained model is in that folder. Move it out. A real new model: see section 1. |
| `The training pack failed pack_training_data.py verify` | If it lists `versions trained on another computer`, the pack is from before trained versions were left out. Make a new pack (section 4). |
| `unet.pth does not match the training pack` | Make a new pack, or use the `unet.pth` the pack was made with. |
| `Image ... is not pinned, or Docker Hub did not confirm it` | Check the internet connection. If it still fails, the image in `release.json` was never pushed, or it uses `latest`. |
| `installer/smtp.release.env` missing or incomplete | Create it (section 2). |
| `Inno Setup 6.5.2+ not found` | Install Inno Setup (section 2). |

## 6. Developers who only run VisHeart from git

See "Run VisHeart locally from source" and "After you change code" in the repository's top-level `README.md`.
A developer copy uses the defaults in `docker-compose.yml` and needs no `release.env` or `secrets.env`.
