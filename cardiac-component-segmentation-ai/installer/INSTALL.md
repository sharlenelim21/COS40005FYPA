# Installing VisHeart

VisHeart runs on one Windows PC. Doctors and administrators use it in a web browser on that PC. Nothing is reachable
from other computers.

## What you need

- Windows 10 version 2004 or later, or Windows 11, 64-bit.
- At least 40 GB free on drive C:.
- A Windows account with administrator rights, to install.
- An internet connection for the first start.
- An NVIDIA graphics card is optional. Without one, VisHeart runs in CPU mode: it is slower, and MedSAM is not
  available.

## Install

1. Unzip the download. Keep `VisHeart-Full-<version>.exe` and all the `.bin` files together in one folder.
2. Run `VisHeart-Full-<version>.exe` and allow it to make changes.
3. The installer checks the PC. If Docker Desktop, WSL2 or Python is missing, it installs them for you.
4. At the end it shows your **VisHeart login** (user `admin` and a password made for this PC). The same text is saved
   in `C:\VisHeart\FIRST-LOGIN.txt`.
5. Restart Windows if the installer asks you to.
6. Open **Docker Desktop** once and accept its terms. Docker Desktop is free for education, research and small
   organisations.

## Start and stop

- **Start VisHeart** (desktop icon) starts everything. Then open the **VisHeart** icon, or go to
  http://localhost:3000.
- The **first start downloads about 25 GB** and can take an hour or more. Later starts take about a minute.
- **Stop VisHeart** stops it. Your data is kept.

After your first login, change the admin password, then delete `FIRST-LOGIN.txt` or keep it somewhere safe.

## Updates

Run the newer **VisHeart-Update-<version>.exe** on the same PC. Your patients, accounts, passwords and trained models
are kept.

## Another Windows account

Docker only works for Windows accounts in the `docker-users` group. If VisHeart says your account cannot use Docker, an
administrator runs this in an administrator Command Prompt, and you then sign out and in again:

```
net localgroup docker-users "<DOMAIN>\<user name>" /add
```

## Uninstall

Use **Uninstall VisHeart** in the Start menu, or Windows Settings > Apps. The uninstaller asks whether to also delete
all VisHeart data:

- **No (default):** patients, accounts and trained models are kept. Installing VisHeart again finds them.
- **Yes:** everything is deleted and cannot be recovered. Docker Desktop must be running for the database to be
  deleted.

Docker Desktop, WSL2 and Python stay installed; remove them in Windows Settings > Apps if no other program needs them.

## Help

Use the FAQ page in VisHeart to send a message to the VisHeart team.
