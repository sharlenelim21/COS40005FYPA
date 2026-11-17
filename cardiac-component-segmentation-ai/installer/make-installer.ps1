<#
.SYNOPSIS
    Builds the VisHeart Windows installer.

.DESCRIPTION
    Full   = for a new PC: app, models and the UNet Extend Training data pack (needs -PackPath; the pack is
             verified in place and packed into the installer from there).
    Update = for a PC that already has VisHeart: app and models only; the training pack and every per-PC file
             (passwords, trained models, jobs, exports) stay as they are.

    Steps: refuse uncommitted changes in the shipped folders, build the backend, copy the shipped files to
    installer\out\staging, check the images in release.json, write release.env, and run Inno Setup (6.5.2+).
    Output: installer\out\VisHeart-<Variant>-<VERSION>\ (VisHeart-<Variant>-<VERSION>.exe plus .bin slices).

.EXAMPLE
    .\installer\make-installer.ps1 -Variant Full -PackPath F:\visheart-training-pack
    .\installer\make-installer.ps1 -Variant Update
#>
param(
    [Parameter(Mandatory = $true)][ValidateSet('Full', 'Update')][string]$Variant,
    [string]$PackPath,
    # Only for a dry run without internet; a real release must check its images.
    [switch]$SkipImageCheck
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'lib\Staging.psm1') -Force

$installerDir = $PSScriptRoot
$appRoot = Split-Path -Parent $installerDir           # cardiac-component-segmentation-ai
$repoRoot = Split-Path -Parent $appRoot
$outDir = Join-Path $installerDir 'out'
$staging = Join-Path $outDir 'staging'
$version = (Get-Content (Join-Path $installerDir 'VERSION') -TotalCount 1).Trim()

function Step([string]$Message) { Write-Host "==> $Message" -ForegroundColor Cyan }
function Stop-Build([string]$Message) { Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }

try {
    if ($Variant -eq 'Full' -and -not $PackPath) { Stop-Build 'A Full installer needs -PackPath <folder of the training data pack>.' }
    if ($PackPath -and -not (Test-Path (Join-Path $PackPath 'PACKED.json'))) {
        Stop-Build "$PackPath has no PACKED.json; make the pack with visheart-retraining\pack_training_data.py pack."
    }

    Step "VisHeart $Variant installer, version $version"

    # Only the shipped folders must be clean: unrelated work elsewhere in the checkout does not reach the installer.
    $shipped = @('UNETRESNET34', 'cardiac-component-segmentation-ai/start.bat', 'cardiac-component-segmentation-ai/stop.bat',
        'cardiac-component-segmentation-ai/visheart-local-deployment', 'cardiac-component-segmentation-ai/Cardiac_Segmentation_FYP_Server',
        'cardiac-component-segmentation-ai/visheart-inference-gpu', 'cardiac-component-segmentation-ai/visheart-retraining',
        'cardiac-component-segmentation-ai/installer')
    $dirty = @(& git -C $repoRoot status --porcelain -- @shipped)
    if ($LASTEXITCODE -ne 0) { Stop-Build 'git status failed; run this from a git checkout of the repository.' }
    if ($dirty.Count -gt 0) {
        Stop-Build ("These shipped files have uncommitted changes; commit or stash them, because a release is built only from committed code:`n  " + ($dirty -join "`n  "))
    }

    $models = Join-Path $appRoot 'visheart-inference-gpu\app\models'
    foreach ($model in @('unet.pth', 'medsam_vit_b.pth')) {
        if (-not (Test-Path (Join-Path $models $model))) {
            Stop-Build "$model is missing from visheart-inference-gpu\app\models (it is not in git); copy it there first."
        }
    }
    if ($Variant -eq 'Full' -and -not (Test-ModelMatchesPack (Join-Path $models 'unet.pth') $PackPath)) {
        Stop-Build 'unet.pth does not match the training pack (PACKED.json). Re-pack with pack_training_data.py or ship the matching model.'
    }

    Step 'Checking release images'
    $release = Get-Content -Raw (Join-Path $installerDir 'release.json') | ConvertFrom-Json
    $images = @{}
    foreach ($p in $release.images.PSObject.Properties) { $images[$p.Name] = [string]$p.Value }
    if ($SkipImageCheck) {
        Write-Host '    Skipped (-SkipImageCheck). Do not ship this build.' -ForegroundColor Yellow
    } else {
        $bad = @(Test-ReleaseImages $images)
        if ($bad.Count -gt 0) {
            Stop-Build ("Image $($bad[0]) is not pinned, or Docker Hub did not confirm it after three tries. Check the internet " +
                "connection and run again; if it still fails, ask the team lead to push the image or fix installer/release.json." +
                $(if ($bad.Count -gt 1) { " Also: " + ($bad[1..($bad.Count - 1)] -join ', ') } else { '' }))
        }
    }

    Step 'Building the backend'
    $server = Join-Path $appRoot 'Cardiac_Segmentation_FYP_Server'
    Push-Location $server
    try {
        if ((Test-Path 'pnpm-lock.yaml') -and (Get-Command pnpm -ErrorAction SilentlyContinue)) {
            & pnpm install --frozen-lockfile; if ($LASTEXITCODE -ne 0) { Stop-Build 'pnpm install failed.' }
            & pnpm run build; if ($LASTEXITCODE -ne 0) { Stop-Build 'Backend build (pnpm run build) failed.' }
        } else {
            & npm ci; if ($LASTEXITCODE -ne 0) { Stop-Build 'npm ci failed.' }
            & npm run build; if ($LASTEXITCODE -ne 0) { Stop-Build 'Backend build (npm run build) failed.' }
        }
    } finally { Pop-Location }

    Step "Copying files to $staging"
    if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
    $selection = @(Get-StagingSelection $repoRoot)
    foreach ($item in $selection) {
        $target = Join-Path $staging $item.Target
        $parent = Split-Path -Parent $target
        if (-not (Test-Path $parent)) { New-Item -ItemType Directory $parent -Force | Out-Null }
        Copy-Item -LiteralPath $item.Source -Destination $target
    }
    $bytes = ($selection | ForEach-Object { (Get-Item -LiteralPath $_.Source).Length } | Measure-Object -Sum).Sum
    Write-Host ("    {0} files, {1:N2} GB" -f $selection.Count, ($bytes / 1GB))

    if ($Variant -eq 'Full') {
        # The pack goes into the installer straight from -PackPath (no 4 GB copy); check it file by file first.
        Step 'Verifying the training data pack'
        $python = if (Get-Command py -ErrorAction SilentlyContinue) { @('py', '-3') } else { @('python') }
        $packer = Join-Path $appRoot 'visheart-retraining\pack_training_data.py'
        & $python[0] @($python | Select-Object -Skip 1) $packer verify $PackPath
        if ($LASTEXITCODE -ne 0) { Stop-Build 'The training pack failed pack_training_data.py verify; make a new pack.' }
    }

    Step 'Writing release.env'
    Write-ReleaseEnv $images (Join-Path $installerDir 'smtp.release.env') `
        (Join-Path $staging 'cardiac-component-segmentation-ai\visheart-local-deployment\release.env')

    Step 'Compiling the installer'
    $iscc = Find-InnoCompiler
    if (-not $iscc) { Stop-Build 'Inno Setup 6.5.2+ not found (ISCC.exe). Install it with: winget install -e --id JRSoftware.InnoSetup' }
    $target = Join-Path $outDir "VisHeart-$Variant-$version"
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    $isccArgs = @("/DVariant=$Variant", "/DAppVersion=$version", "/DStagingDir=$staging", "/O$target")
    if ($Variant -eq 'Full') { $isccArgs += "/DPackDir=$((Resolve-Path $PackPath).Path)" }
    & $iscc @isccArgs (Join-Path $installerDir 'visheart.iss')
    if ($LASTEXITCODE -ne 0) { Stop-Build "Inno Setup failed (exit $LASTEXITCODE)." }

    Step "Done: $target"
    exit 0
} catch {
    Stop-Build $_.Exception.Message
}
