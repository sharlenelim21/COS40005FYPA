# Build script for the GPU inference image.
#
# Stages the landmark architecture file + both checkpoints from the sibling
# UNETRESNET34 repo into _landmark_assets/ (gitignored, build-time only) so
# the Dockerfile can COPY them into the image. Without this step the
# Dockerfile's COPY fails outright rather than silently shipping an image
# with no landmark detection -- see the Dockerfile's own comment above that
# COPY for the full story.
#
# Usage:
#   .\build.ps1                 # tags sharlene21/visheart-gpu:latest
#   .\build.ps1 -Tag 1.4.0      # also tags sharlene21/visheart-gpu:1.4.0

param(
    [string]$Tag = "latest",
    [string]$ImageName = "sharlene21/visheart-gpu"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Building VisHeart GPU Inference Image" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# UNETRESNET34 lives two levels up from this file (a sibling of
# cardiac-component-segmentation-ai/, at the outer repo root) -- same path
# docker-compose.yml's volume mount uses (../../UNETRESNET34 from
# visheart-local-deployment/, which is also two levels above this repo).
$LandmarkRepo = Resolve-Path (Join-Path $ScriptDir "..\..\UNETRESNET34") -ErrorAction SilentlyContinue
if (-not $LandmarkRepo) {
    Write-Host "ERROR: UNETRESNET34 not found at $ScriptDir\..\..\UNETRESNET34" -ForegroundColor Red
    Write-Host "Landmark detection needs its architecture file + checkpoints from that repo." -ForegroundColor Red
    exit 1
}

$ArchFile = Join-Path $LandmarkRepo "models\unet_resnet34.py"
$Ckpt2ch  = Join-Path $LandmarkRepo "checkpoints\best_model_2ch.pth"
$Ckpt1ch  = Join-Path $LandmarkRepo "checkpoints\best_model_1ch.pth"

$Missing = @()
if (-not (Test-Path $ArchFile)) { $Missing += $ArchFile }
if (-not (Test-Path $Ckpt2ch))  { $Missing += $Ckpt2ch }
if (-not (Test-Path $Ckpt1ch))  { Write-Host "WARNING: $Ckpt1ch not found -- image will fall back to the 2ch model for MRI-only mode." -ForegroundColor Yellow }

if ($Missing.Count -gt 0) {
    Write-Host "ERROR: Missing required landmark file(s):" -ForegroundColor Red
    $Missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host "Landmark detection would silently be broken in the built image. Aborting." -ForegroundColor Red
    exit 1
}

Write-Host "Staging landmark assets into _landmark_assets\ ..." -ForegroundColor Yellow
Remove-Item -Recurse -Force ".\_landmark_assets" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path ".\_landmark_assets\models" | Out-Null
New-Item -ItemType Directory -Force -Path ".\_landmark_assets\checkpoints" | Out-Null

Copy-Item $ArchFile ".\_landmark_assets\models\unet_resnet34.py" -Force
Copy-Item $Ckpt2ch ".\_landmark_assets\checkpoints\best_model_2ch.pth" -Force
if (Test-Path $Ckpt1ch) {
    Copy-Item $Ckpt1ch ".\_landmark_assets\checkpoints\best_model_1ch.pth" -Force
}
Write-Host "OK: staged $(Get-ChildItem -Recurse .\_landmark_assets | Measure-Object).Count file(s)" -ForegroundColor Green
Write-Host ""

$FullImageName = "${ImageName}:${Tag}"
Write-Host "Building $FullImageName ..." -ForegroundColor Yellow
Write-Host "This will take several minutes." -ForegroundColor Gray
Write-Host ""

if ($Tag -eq "latest") {
    docker build -t $FullImageName .
} else {
    docker build -t $FullImageName -t "${ImageName}:latest" .
}

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Build Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Image built: $FullImageName" -ForegroundColor Green
Write-Host "Push with: docker push $FullImageName" -ForegroundColor White
