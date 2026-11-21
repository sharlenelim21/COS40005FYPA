# Installing VisHeart

VisHeart runs on one Windows PC. You use it in a web browser on that PC. Other computers cannot reach it.

## What you need

- Windows 10 version 2004 or later, or Windows 11, 64-bit.
- A Windows account with administrator rights (only to install).
- Free disk space:
  - **40 GB** for VisHeart itself: about 10 GB for its files and about 30 GB for the parts Docker downloads on the
    first start. If you install VisHeart on another drive (for example E:), that drive needs 10 GB and the drive where
    Docker Desktop keeps its data (normally C:) needs 30 GB. The installer checks this for you. Choosing another drive
    for VisHeart does **not** move Docker's 30 GB; see "Not enough room for Docker's downloads" under Problems.
  - **About 6 GB more while you install**, for the downloaded zip (2.8 GB) and the folder you unzip it into (2.8 GB).
    Delete both after installing.
- An internet connection for the first start.
- Optional: an NVIDIA graphics card. Without one, VisHeart is slower and the MedSAM tool is not available.

## Download

The VisHeart team shares a Google Drive folder with you. Ask them for access if you do not have it.

1. In that folder, click the newest `VisHeart-Full-<version>.zip` (about 2.8 GB) and click **Download**.
2. Google Drive says it cannot scan the file for viruses because it is large. Click **Download anyway**.

## Install

1. Open your **Downloads** folder. Right-click `VisHeart-Full-<version>.zip` and choose **Extract All**, then
   **Extract**. A new folder opens with three files: `VisHeart-Full-<version>.exe` and two `.bin` files.
2. Double-click `VisHeart-Full-<version>.exe` **in that new folder**. If Windows asks whether to allow the app to make
   changes, click **Yes**. If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**.
3. Choose where to install. `C:\VisHeart` is the default. If C: is nearly full, type another drive, for example
   `E:\VisHeart`. Use a short folder name without spaces.
4. The installer checks the PC. If Docker Desktop, WSL2 or Python is missing, it installs them. This can take several
   minutes.
5. At the end it shows your **VisHeart login**: user `admin` and a password made for this PC. The same login is saved
   in `FIRST-LOGIN.txt` in the install folder, and opens in Notepad when you click **Finish**. Leave the two options
   ticked (**Start VisHeart now** and **Open the login note**) and click **Finish**.
6. If the installer asks you to restart Windows, restart, then double-click the **VisHeart** icon on the desktop.
7. The first time Docker Desktop opens, it asks you to accept its terms. Accept them. Docker Desktop is free for
   education, research and small organisations.

> **Setup says "Please insert Disk 2"?** You opened the `.exe` from inside the zip, where setup cannot find the two
> `.bin` files. Click **Cancel**, do step 1 (Extract All), and run the `.exe` from the extracted folder.

## Start and stop

- **Start:** double-click the **VisHeart** heart icon on the desktop (it is also in the Start menu). A black window
  shows the progress and closes by itself when VisHeart is ready. Your browser then opens http://localhost:3000.
  If VisHeart is already running, the icon just opens the page.
- **The first start downloads about 25 GB** and can take an hour or more. Later starts take about a minute.
- **Stop:** Start menu > **VisHeart** > **Stop VisHeart**. Your data is kept. You rarely need this: updating and
  uninstalling stop VisHeart by themselves.
- Do not start VisHeart with the **Run** button in Docker Desktop. That starts only part of it, and it fails. Use the
  **VisHeart** icon.

After your first login, change the admin password in **Profile Settings** (http://localhost:3000/profile), and
replace the placeholder email `admin@visheart.local` with your own. Then delete `FIRST-LOGIN.txt`, or keep it
somewhere safe. Once you change the password, the one in the note no longer works.

## Updates

When the team tells you there is a new version, or VisHeart shows a **"VisHeart update available"** popup when it
starts (VisHeart keeps working while the popup is open):

1. Download the newest `VisHeart-Update-<version>.zip` (about 800 MB) from the Google Drive folder.
2. Extract it as in Install step 1, and run `VisHeart-Update-<version>.exe` from the extracted folder. It stops
   VisHeart and updates it. The drive VisHeart is installed on needs at least 10 GB free.
3. Start VisHeart with the icon as usual. If the new version needs new parts, this start downloads them first and
   takes longer.

You do not need to uninstall or delete anything first. Your patients, accounts, passwords and trained models are kept.
The update deletes only program files the new version no longer uses, and the next start deletes old VisHeart
download parts (Docker images), so updates do not keep filling the disk.

The newest `VisHeart-Full` installer also works as an update. An installer older than the installed version changes
nothing.

## Uninstall

Open Windows **Settings > Apps > Installed apps**, find **VisHeart**, click **...** and choose **Uninstall**. (Windows
11 does not show uninstall shortcuts in the Start menu.)

The uninstaller asks whether to also delete all VisHeart data:

- **No (default):** patients, accounts, trained models and the downloaded parts are kept. If you install VisHeart
  again, it finds them and starts quickly.
- **Yes:** everything is deleted and cannot be recovered, including the 25 GB of downloaded parts. The uninstaller
  starts Docker Desktop by itself if needed. If Docker Desktop cannot start, nothing is deleted and the uninstaller
  tells you what to do.

Docker Desktop, WSL2 and Python stay installed. Remove them in Settings > Apps if no other program needs them.

**Getting the disk space back.** Docker Desktop keeps everything in one large file (`docker_data.vhdx`, on C: unless
you moved it). When VisHeart's images are deleted, the space is freed inside that file, but the file does not shrink,
so Windows does not get the space back. To get it back, either uninstall Docker Desktop (Settings > Apps), or, if no
other program uses Docker, open Docker Desktop > **Troubleshoot** > **Clean / Purge data**. Both delete everything
stored in Docker, not only VisHeart's.

## Problems

| What you see | What to do |
|---|---|
| "Not enough room for Docker's downloads" (although you chose another drive) | VisHeart's files go to the folder you chose, but its 25 GB of downloads go to Docker Desktop's storage, which is on C: by default. Either free space on that drive, or move Docker's storage: Docker Desktop > **Settings** > **Resources** > **Advanced** > **Disk image location**, choose a folder on a drive with 30 GB free (for example `E:\DockerData`), click **Apply & restart**, then run the installer again. If Docker Desktop is not installed yet, install it first. |
| "Port 5000 is used by another program: ..." | VisHeart needs ports 3000, 5000, 9000 and 8001. The message names the program and its process id. Close that program (or end it in **Task Manager > Details**), then start VisHeart again. |
| "Docker is installed but this Windows account (...) cannot use it" | See **Using VisHeart from another Windows account** below. |
| "This PC already has a VisHeart database (...) that was made by another copy of VisHeart" | The data belongs to an earlier or developer copy of VisHeart. Ask the VisHeart team before deleting anything. |
| Docker Desktop says "Virtual Machine Platform is not enabled" | A Windows feature Docker needs is off, or Windows has not restarted since it was turned on. Double-click the VisHeart icon: it asks to turn the feature on (click **Yes**, then **Yes** in the Windows permission window) and then to restart Windows. Restarting Docker Desktop alone is not enough. |
| "Docker Desktop did not become ready within 3 minutes" | Open Docker Desktop, wait until it says Docker is running, then start VisHeart again. |
| The login is rejected | If you changed the admin password, use your new password, not the one in `FIRST-LOGIN.txt`. After 5 wrong tries the account is locked for 10 minutes. |

### Using VisHeart from another Windows account

VisHeart works for the Windows account that installed it. If another person signs in to the same PC with their own
Windows account, Docker refuses that account until it is added to the Windows group **docker-users**:

1. The other person signs in and starts VisHeart once. The message names their account, for example
   `DESKTOP-ABC\maria`.
2. An administrator opens the Start menu, types `cmd`, right-clicks **Command Prompt** and chooses
   **Run as administrator**.
3. They type this, with the account name from step 1, and press Enter:
   ```
   net localgroup docker-users "DESKTOP-ABC\maria" /add
   ```
4. The other person signs out of Windows and signs in again. VisHeart now works for them.

## Good to know

- **Privacy on a shared PC.** Only administrators, the account that installed VisHeart and members of docker-users
  can change the VisHeart folder. Other Windows accounts cannot read VisHeart's passwords or training data.
- **A developer copy on the same PC** (VisHeart from git). The installed VisHeart and the developer copy keep separate
  databases, but only one can run at a time. Stop one before starting the other: **Stop VisHeart** for the installed
  copy, `stop.bat` for the developer copy. (Starting the installed copy also removes a developer copy's leftover
  containers by itself; their data is kept.)

## Help

Use the FAQ page in VisHeart to send a message to the VisHeart team.
