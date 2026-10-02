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

## 2. On the other computer (once)

1. Install Python 3.13: from python.org, ticking "Add python.exe to PATH", or `winget install -e --id Python.Python.3.13`.
2. Pull this branch, and copy the pack into the project folder as `visheart-training-data`, beside `start.bat`:

   ```
   cardiac-component-segmentation-ai\
     start.bat
     visheart-training-data\     <- the pack (PACKED.json, versions, ...); git ignores it
   ```

3. Run `start.bat` as usual. On this first start it finds the pack and sets training up by itself, which takes about
   10 minutes. The website is already usable meanwhile.
   - It installs a Python environment (`.venv`, about 1 GB to download) and checks the pack file by file.
   - It puts the original model in `visheart-inference-gpu\app\models`, and rewrites the pack's paths for this
     computer with `relocate.py`, which changes nothing unless every file checks out.
   - If this computer's `unet.pth` is a different model, it asks before replacing it, and keeps the old file as a
     backup. With no answer, it leaves the file alone after a minute and training stays off.

   Every later `start.bat` starts the training service at once, and `stop.bat` stops it.

To keep the pack somewhere else, set it up by hand instead, from `visheart-retraining`:

```bat
powershell -ExecutionPolicy Bypass -File setup-training-pc.ps1 -DataRoot D:\visheart-training-pack
```

Add `-ReplaceOriginalModel` to replace a different `unet.pth` without asking. It is safe to run again.

## Before a demo

- Run `start.bat` and wait for "The training service is running on http://127.0.0.1:8010".
- Open UNet Extend Training. The Results tab should list the versions, with the original in use.
- Training runs on the CPU and takes about 40 minutes for the default recipe. Start it early, or show a version that
  has already been trained.
- Training uses the corrections saved by the account that is signed in, from the database this VisHeart uses.

## If the page still says "not available"

| What `start.bat` printed | What to do |
|---|---|
| "copy the training data pack to ...\visheart-training-data" | The pack is not there yet (step 2.2). |
| "STOPPED: Python 3.11 or newer was not found" | Install Python (step 2.1), then run `start.bat` again. |
| "STOPPED: ... is a different model" | Run `start.bat` again and answer Y, or run the setup by hand with `-ReplaceOriginalModel`. |
| "did not start. See ...\jobs\worker.log" | The last lines of that log name the problem. |
| Nothing about the training service | `start.bat` did not find `visheart-retraining`. Pull the branch again. |
