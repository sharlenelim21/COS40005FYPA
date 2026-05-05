# Cardiac Landmark Detection Model

This project trains and runs a deep learning model for detecting two cardiac landmarks from 2-D slices extracted from NIfTI MRI volumes. The model predicts two heatmaps, one per landmark, then converts the heatmap peaks back into `(x1, y1, x2, y2)` pixel coordinates.

The main model is a ResNet-34 encoder with a UNet-style decoder, CBAM attention, optional deep supervision, and subpixel post-processing.

## Important Note
The current loader follows the same general NIfTI 2-D slice loading concept of the 2nd segmentation model, but it is customized for landmark detection rather than segmentation. It does not use the exact same MONAI preprocessing pipeline.

## Project Structure

```text
Landmark_Detection_Model/
|-- data/ 
|   `-- lv-landmark/ #go to the link and download the dataset, and bring the folder here
|       |-- Training/
|       |   |-- images/      # Training NIfTI image volumes (.nii.gz)
|       |   `-- masks/       # Training NIfTI landmark masks (.nii.gz)
|       `-- Testing/
|           |-- images/      # Testing NIfTI image volumes (.nii.gz)
|           `-- masks/       # Testing masks
|-- dataset/
|   `-- landmark_dataset.py  # Dataset loader, preprocessing, augmentation, heatmap target creation
|-- models/
|   `-- unet_resnet34.py     # ResNet34 + UNet model definition
|-- utils/
|   |-- heatmap.py           # Converts landmark coordinates to Gaussian heatmaps
|   |-- loss.py              # Heatmap, Dice, coordinate, separation, and Wing loss
|   |-- metrics.py           # MRE, SDR, per-landmark error, percentile metrics
|   |-- postprocess.py       # Converts predicted heatmaps back to coordinates
|   `-- visualize.py         # Saves prediction grids and training curves
|-- train.py                 # Main training script
|-- finetune.py              # Fine-tunes a saved checkpoint
|-- inference.py             # Runs prediction on NIfTI image volumes
|-- tta_eval.py              # Evaluates checkpoint with test-time augmentation
|-- test_dataset.py          # Quick dataset smoke test
|-- check_labels.py          # Checks unique labels in a sample mask
|-- requirements.txt         # Python dependencies
`-- notebooks/
    `-- run_landmark_model.ipynb
```

## What Each File Does

| File | Purpose |
| --- | --- |
| `train.py` | Main training pipeline. Loads training data, splits train/validation, trains in phases, saves checkpoints and visualizations to `checkpoints/`. |
| `finetune.py` | Starts from an existing checkpoint and trains with tighter loss settings for final accuracy improvements. |
| `inference.py` | Loads a trained checkpoint and predicts landmarks on one image volume. Supports one slice, automatic slice selection, or all slices. |
| `tta_eval.py` | Evaluates a checkpoint with test-time augmentation, averaging predictions from flipped/rotated variants. |
| `test_dataset.py` | Verifies that the dataset can load samples and returns image, heatmap, and coordinate tensors. |
| `check_labels.py` | Prints the labels present in one sample mask and counts LV/RV pixels. Useful for checking mask values. |
| `dataset/landmark_dataset.py` | Reads `.nii.gz` volumes, extracts valid 2-D slices, finds landmark points from masks, normalizes images, applies augmentation, and creates heatmap targets. |
| `models/unet_resnet34.py` | Defines the ResNet34-UNet architecture, CBAM attention, fallback UNet, and optional pretrained encoder loading. |
| `utils/heatmap.py` | Creates Gaussian heatmaps from landmark coordinates. |
| `utils/loss.py` | Defines the combined training loss: BCE, Dice, coordinate Wing loss, and landmark separation loss. |
| `utils/metrics.py` | Computes Mean Radial Error (MRE), Successful Detection Rate (SDR), per-sample MRE, and percentiles. |
| `utils/postprocess.py` | Converts model heatmaps into coordinates using soft argmax, hard argmax, Gaussian subpixel argmax, or quadratic subpixel argmax. |
| `utils/visualize.py` | Saves validation image grids with predicted and ground-truth landmarks, plus training curves. |
| `requirements.txt` | Lists Python packages needed to run the project. |

## Data Format

The expected dataset layout is:

```text
data/lv-landmark/
|-- Training/
|   |-- images/
|   |   `-- DET0000101.nii.gz
|   `-- masks/
|       `-- DET0000101.nii.gz
`-- Testing/
    |-- images/
    |   `-- DET0000301.nii.gz
    `-- masks/
        `-- DET0000301.nii.gz
```

For each image volume, the mask file should have the same filename and shape. The dataset loader extracts the two most distant foreground points from each valid 2-D mask slice and treats them as the two target landmarks.

## Option 1: Run Locally on Your Own NVIDIA GPU

Use this option if your laptop/PC has an NVIDIA GPU such as a GeForce RTX/GTX card.

### 1. Create and activate a virtual environment

Windows PowerShell:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks activation, run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\.venv\Scripts\Activate.ps1
```

### 2. Install dependencies

```powershell
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

If PyTorch does not detect your GPU, reinstall PyTorch using the command from the official PyTorch selector for your CUDA version.

### 3. Verify Python, PyTorch, and CUDA

```powershell
python -c "import sys, torch, torchvision; print(sys.executable); print('torch:', torch.__version__); print('torchvision:', torchvision.__version__); print('cuda available:', torch.cuda.is_available()); print('gpu:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU only')"
```

Expected result for GPU training:

```text
cuda available: True
gpu: NVIDIA GeForce ...
```

### 4. Check that the dataset loads

```powershell
python test_dataset.py
```

Expected output shape:

```text
torch.Size([1, 256, 256])
torch.Size([2, 256, 256])
torch.Size([4])
```

### 5. Train the model

```powershell
python train.py
```

Training outputs are saved under:

```text
checkpoints/YYYY-MM-DD_HH-MM-SS/
|-- best_p2.pth
|-- best_model.pth
|-- last_model.pth
|-- training_curve.png
`-- grids/
```

The most important checkpoint is usually:

```text
checkpoints/<run_name>/best_model.pth
```

### 6. Fine-tune an existing checkpoint, optional

```powershell
python finetune.py --checkpoint checkpoints/<run_name>/best_model.pth
```

Fine-tuning saves a new folder such as:

```text
checkpoints/finetune_YYYY-MM-DD_HH-MM-SS/
```

### 7. Run inference on a test image

Single slice:

```powershell
python inference.py --checkpoint checkpoints/<run_name>/best_model.pth --image data/lv-landmark/Testing/images/DET0000301.nii.gz --slice 4 --out inference_results
```

Automatically choose the best slice:

```powershell
python inference.py --checkpoint checkpoints/<run_name>/best_model.pth --image data/lv-landmark/Testing/images/DET0000301.nii.gz --auto --out inference_results
```

Run all slices:

```powershell
python inference.py --checkpoint checkpoints/<run_name>/best_model.pth --image data/lv-landmark/Testing/images/DET0000301.nii.gz --all-slices --out inference_results
```

Results are saved as images in:

```text
inference_results/
```

## Option 2: Run in a Notebook

Yes, an `.ipynb` notebook is doable and useful, especially if someone does not have an NVIDIA GPU locally. The easiest notebook environment is Google Colab or Kaggle with GPU enabled.

A starter notebook is included here:

```text
notebooks/run_landmark_model.ipynb
```

Recommended workflow:

1. Open the notebook in Google Colab, Kaggle, Jupyter, or VS Code.
2. Enable GPU runtime.
3. Install requirements.
4. Upload or mount the dataset so the folder structure matches `data/lv-landmark/...`.
5. Run `test_dataset.py`.
6. Run `train.py`.
7. Run `inference.py` using the saved checkpoint.

In Colab, enable GPU from:

```text
Runtime -> Change runtime type -> Hardware accelerator -> GPU
```

Then check GPU availability:

```python
import torch
print(torch.cuda.is_available())
print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU only")
```

Notebook training command:

```python
!python train.py
```

Notebook inference command:

```python
!python inference.py --checkpoint checkpoints/YOUR_RUN/best_model.pth --image data/lv-landmark/Testing/images/DET0000301.nii.gz --auto --out inference_results
```

## Common Issues

### VS Code says `Import "torchvision.models" could not be resolved`

This usually means VS Code/Pylance is using the wrong Python interpreter.

Fix:

1. Press `Ctrl+Shift+P`
2. Select `Python: Select Interpreter`
3. Choose:

```text
.\.venv\Scripts\python.exe
```

4. Run `Developer: Reload Window`

### CUDA is not available

If this prints `False`:

```powershell
python -c "import torch; print(torch.cuda.is_available())"
```

then PyTorch is not seeing your NVIDIA GPU. Possible causes:

- You installed a CPU-only PyTorch build.
- Your NVIDIA driver is missing or outdated.
- You are using the wrong Python environment.
- Your machine does not have an NVIDIA GPU.

### `No valid samples found`

Check that:

- `data/lv-landmark/Training/images` exists.
- `data/lv-landmark/Training/masks` exists.
- Image and mask filenames match exactly.
- Image and mask volumes have the same shape.
- Masks contain at least two foreground pixels on valid slices.

### Windows Unicode print errors

The runtime print messages have been changed to ASCII-safe text. If this still appears in old scripts:

```text
UnicodeEncodeError: 'charmap' codec can't encode character
```

run Python with UTF-8 enabled:

```powershell
$env:PYTHONUTF8="1"
python train.py
```

## Notes

- The model input size is fixed at `256 x 256`.
- Training uses heatmap targets with a sigma curriculum.
- Validation reports MRE, per-landmark MRE, SDR at 2/5/10 pixels, and MRE percentiles.
- Checkpoints are selected using P90 MRE so hard validation samples matter, not only the mean error.
