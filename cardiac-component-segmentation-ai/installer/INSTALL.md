# Installing VisHeart

VisHeart runs on one Windows PC. Doctors and administrators use it in a web browser on that PC. Nothing is reachable
from other computers.

## What you need

- Windows 10 version 2004 or later, or Windows 11, 64-bit.
- At least 40 GB free: about 10 GB where VisHeart is installed and 30 GB where Docker Desktop keeps its data (both
  on C: unless you choose otherwise).
- About 10 GB more, on any drive, for the download while you install (you can delete it afterwards).
- A Windows account with administrator rights, to install.
- An internet connection for the first start.
- An NVIDIA graphics card is optional. Without one, VisHeart runs in CPU mode: it is slower, and MedSAM is not
  available.

## Download

The VisHeart team shares a Google Drive folder with you. Ask them for access if you do not have it.

1. In that folder, find the newest `VisHeart-Full-<version>.zip` (about 2.7 GB). It is one file.
2. Click it, then **Download**. Google Drive says it cannot scan such a large file for viruses; click
   **Download anyway**.
3. In your Downloads folder, right-click the zip, choose **Extract All**, then **Extract**. You get a folder with
   one `.exe` and two `.bin` files.

Extract first. Double-clicking the `.exe` while looking inside the zip makes setup say **"Please insert Disk 2"**,
because the `.bin` files are not next to it. If you see that, cancel, extract the zip, and run the `.exe` from the
extracted folder.

Already have VisHeart? The newest `VisHeart-Full` installer also updates it and keeps your data. The smaller
`VisHeart-Update-<version>.zip` does the same (see Updates).

## Install

1. Open the folder you unzipped.
2. Run `VisHeart-Full-<version>.exe` and allow it to make changes.
3. Choose where to install. `C:\VisHeart` is the default; if C: is nearly full, choose another drive, for example
   `E:\VisHeart` (a short folder name without spaces). The installer checks that this drive, and the drive where Docker
   Desktop keeps its data, have enough room.
4. The installer checks the PC. If Docker Desktop, WSL2 or Python is missing, it installs them for you.
5. At the end it shows your **VisHeart login** (user `admin` and a password made for this PC) and the next steps, in
   a box you can scroll and copy from. The same login is saved as `FIRST-LOGIN.txt` in the install folder. Two options are
   ticked: **Start VisHeart now** and **Open the login note**. Leave them ticked and click Finish.
6. Restart Windows if the installer asks you to.
7. Open **Docker Desktop** once and accept its terms. Docker Desktop is free for education, research and small
   organisations.

## Start and stop

- Double-click the **VisHeart** heart icon on the desktop (also in the Start menu). It starts everything and opens
  http://localhost:3000 in your browser. When VisHeart is already running, it opens the page at once.
- The **first start downloads about 25 GB** and can take an hour or more. Later starts take about a minute. A window
  shows the progress; it closes by itself when VisHeart is ready.
- To stop VisHeart: **Start menu > VisHeart > Stop VisHeart**. Your data is kept. You rarely need to: updating and
  uninstalling stop VisHeart by themselves.
- Do not start VisHeart with the **Run** button in Docker Desktop. That starts only part of VisHeart, which then
  fails (the log shows `redis://undefined`). Delete that container in Docker Desktop and use the **VisHeart** icon.

After your first login, change the admin password, then delete `FIRST-LOGIN.txt` or keep it somewhere safe.

## Updates

Running a newer installer on a PC that has VisHeart says which version is installed and that it updates it. An
older installer than the installed version changes nothing.

When the team tells you there is a new version, or starting VisHeart shows a "VisHeart update available" popup
(it checks the team's GitHub page each time it starts; VisHeart keeps running either way):

1. Download the newest `VisHeart-Update-<version>.zip` from the Google Drive folder and extract it, as above. It is
   about 800 MB.
2. Run `VisHeart-Update-<version>.exe`. It stops VisHeart, then updates it. It needs at least 10 GB free on C:.
3. Use the **VisHeart** icon as usual. If the new version needs new parts, this start downloads them first and takes
   longer.

Your patients, accounts, passwords and trained models are kept.

## Uninstall

Open Windows **Settings > Apps > Installed apps**, find **VisHeart**, click **...** and **Uninstall**. (Windows 11 does
not show uninstall shortcuts in the Start menu.) The uninstaller asks whether to also delete
all VisHeart data:

- **No (default):** patients, accounts, trained models and the downloaded images are kept. Installing VisHeart
  again finds them and starts quickly.
- **Yes:** everything is deleted and cannot be recovered, including the downloaded VisHeart images (about 25 GB).
  The uninstaller starts Docker Desktop itself when it is not running. If Docker Desktop cannot start, nothing is
  deleted and the uninstaller tells you how to finish later.

Docker Desktop, WSL2 and Python stay installed; remove them in Windows Settings > Apps if no other program needs them.

## Good to know

- **Another Windows account.** Docker only works for Windows accounts in the `docker-users` group. If VisHeart says
  your account cannot use Docker, an administrator runs this in an administrator Command Prompt, and you then sign
  out and in again:
  ```
  net localgroup docker-users "<DOMAIN>\<user name>" /add
  ```
- **Who can see VisHeart's files.** Only administrators and members of `docker-users` can change the `C:\VisHeart`
  folder. Other Windows accounts cannot read VisHeart's passwords or training data.
- **"Port 5000 is used by another program".** VisHeart needs ports 3000, 5000, 9000 and 8001. Start VisHeart names
  the program that holds one; close it (or end it in Task Manager > Details by its process id), then start again.
- **A developer copy (from git) on the same PC.** The installed VisHeart keeps its own containers and database, so
  the two do not mix. Start VisHeart removes the developer copy's containers (not its data) so it can start; the
  developer copy's `start.bat` creates them again. Only one of the two can run at a time.
- **"This PC already has a VisHeart database made by another copy".** That data belongs to an earlier or developer
  copy of VisHeart. Ask the VisHeart team before deleting it.

## Help

Use the FAQ page in VisHeart to send a message to the VisHeart team.
