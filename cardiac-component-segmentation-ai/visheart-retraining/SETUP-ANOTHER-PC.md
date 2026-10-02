# Running UNet Extend Training on another computer

The Extend Training page talks to a training service (`worker.py`) that runs on the computer itself, not in Docker.
It needs about 4 GB of data that is not in this repository: the version registry and checkpoints, the frozen test
set, the ACDC, M&Ms and M&Ms-2 datasets, the v2-unet code, and the original `unet.pth` the registry checks. Without
them the page says **"The training service is not available"**; the rest of VisHeart works as before.

## 1. On the computer that has the training data

Pack the data into a new folder, for example on a USB drive:

```bat
E:\Jy\Unet\.venv\Scripts\python.exe pack_training_data.py pack --out F:\visheart-training-pack
```

It copies only what the service needs and records every file's SHA-256 in `PACKED.json`. Copy the whole folder to
the other computer, by USB drive or through Google Drive. To send a single file, zip it first and unzip it there
(Windows 10 and 11 include `tar`):

```bat
tar -a -cf visheart-training-pack.zip -C F:\visheart-training-pack .
tar -xf visheart-training-pack.zip -C D:\visheart-training-pack
```

## 2. On the other computer

1. Install Python 3.13 from python.org, and tick "Add python.exe to PATH".
2. Pull this branch, and put the pack at a path made of plain letters and digits, for example
   `D:\visheart-training-pack`.
3. In `visheart-retraining`, run:

   ```bat
   powershell -ExecutionPolicy Bypass -File setup-training-pc.ps1 -DataRoot D:\visheart-training-pack
   ```

   It sets up a Python environment (`.venv`, about 1 GB to download the first time) and checks the pack file by file.
   It then puts the original model in `visheart-inference-gpu\app\models`, and rewrites the pack's paths for this
   computer with `relocate.py`, which changes nothing unless every file checks out. Finally it writes
   `retraining.local.bat` and starts the service. It is safe to run again.

   If this computer's `unet.pth` is a different model, the script stops and says so. Run it again with
   `-ReplaceOriginalModel` to use the pack's model; the old file is kept beside it as a backup.
4. Restart VisHeart: `stop.bat`, then `start.bat` in `visheart-local-deployment`. From now on `start.bat` starts the
   training service too, and `stop.bat` stops it.

## Before a demo

- Run `start.bat` and wait for "The training service is running on http://127.0.0.1:8010".
- Open UNet Extend Training. The Results tab should list the versions, with the original in use.
- Training runs on the CPU and takes about 40 minutes for the default recipe. Start it early, or show a version that
  has already been trained.
- Training uses the corrections saved by the account that is signed in, from the database this VisHeart uses.

## If the page still says "not available"

| What `start.bat` printed | What to do |
|---|---|
| "not set up on this computer" | Run `setup-training-pc.ps1` (step 2.3). |
| "did not start. See ...\jobs\worker.log" | The last lines of that log name the problem. |
| Nothing about the training service | `start.bat` did not find `visheart-retraining`. Pull the branch again. |
