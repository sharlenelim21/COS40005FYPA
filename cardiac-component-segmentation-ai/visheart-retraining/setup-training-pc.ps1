<#
Sets up UNet Extend Training on this computer from a pack made by pack_training_data.py (see SETUP-ANOTHER-PC.md).

  powershell -ExecutionPolicy Bypass -File setup-training-pc.ps1 -DataRoot D:\visheart-training-pack

Each step is skipped when it is already done, so it is safe to run again:
  1. a Python environment beside this script (.venv) with requirements.txt;
  2. the pack checked file by file (pack_training_data.py verify);
  3. the original model the registry names, in this repository's inference models folder;
  4. the pack's paths rewritten for this computer (relocate.py, which checks every file before writing);
  5. retraining.local.bat, so start.bat and the worker scripts find this setup;
  6. the training service restarted and asked for its status.
#>
param(
    [Parameter(Mandatory = $true)][string]$DataRoot,
    [string]$Python,
    [switch]$ReplaceOriginalModel
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$models = [IO.Path]::GetFullPath((Join-Path $here '..\visheart-inference-gpu\app\models'))
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
$venv = Join-Path $here '.venv'
$venvPython = Join-Path $venv 'Scripts\python.exe'

function Step([string]$text) { Write-Host ''; Write-Host "== $text" -ForegroundColor Cyan }
function Done([string]$text) { Write-Host "   $text" -ForegroundColor Green }
function Fail([string]$text) { Write-Host "STOPPED: $text" -ForegroundColor Red; exit 1 }

function Get-PythonVersion([string]$exe, [string[]]$arguments) {
    # 313 for Python 3.13, or 0 when this candidate is missing (a native error must not stop the script here).
    $ErrorActionPreference = 'Continue'
    try {
        $out = & $exe @arguments -c 'import sys; print(sys.version_info[0] * 100 + sys.version_info[1])' 2>$null
        if ($LASTEXITCODE -eq 0 -and "$out" -match '^\d+$') { return [int]"$out" }
    } catch { }
    return 0
}

if ($DataRoot -match '[^\x20-\x7E]') { Fail "$DataRoot has characters other than plain letters and digits; batch files cannot use it. Choose a folder like D:\visheart-training-pack." }
$packed = Join-Path $DataRoot 'PACKED.json'
if (-not (Test-Path $packed)) { Fail "$packed was not found. Copy the whole pack folder to $DataRoot first." }

Step '1/6 Python environment'
$requirements = Join-Path $here 'requirements.txt'
$installedMark = Join-Path $venv 'requirements.installed'
$wanted = (Get-FileHash $requirements -Algorithm SHA256).Hash
if (-not (Test-Path $venvPython)) {
    $candidates = @()
    if ($Python) { $candidates += @{ exe = $Python; args = @() } }
    else {
        foreach ($v in '-3.13', '-3.12', '-3.11') { $candidates += @{ exe = 'py'; args = @($v) } }
        $candidates += @{ exe = 'python'; args = @() }
    }
    $base = $null
    foreach ($candidate in $candidates) {
        $version = Get-PythonVersion $candidate.exe $candidate.args
        if ($version -ge 311) { $base = $candidate; break }
    }
    if (-not $base) { Fail 'Python 3.11 or newer was not found. Install Python 3.13 from python.org (tick "Add python.exe to PATH"), then run this again.' }
    Write-Host "   Creating $venv"
    & $base.exe @($base.args) -m venv $venv
    if ($LASTEXITCODE -ne 0) { Fail 'The Python environment could not be created.' }
}
if ((Test-Path $installedMark) -and ((Get-Content $installedMark -Raw).Trim() -eq $wanted)) {
    Done 'Already installed.'
} else {
    Write-Host '   Installing the packages (about 1 GB to download the first time)...'
    & $venvPython -m pip install --disable-pip-version-check -r $requirements
    if ($LASTEXITCODE -ne 0) { Fail 'The packages could not be installed. Check the internet connection and run this again.' }
    Set-Content -Path $installedMark -Value $wanted -Encoding ascii
    Done 'Installed.'
}

$relocate = Join-Path $here 'relocate.py'
$ErrorActionPreference = 'Continue'
$null = & $venvPython $relocate --old-root $DataRoot --new-root $DataRoot --models-dir $models --dry-run 2>&1
$inPlace = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = 'Stop'

if ($inPlace) {
    Step '2-4/6 The pack is already set up for this computer'
    Done "Every file checks out where it is: $DataRoot"
} else {
    Step '2/6 Checking the pack file by file (a few minutes)'
    & $venvPython (Join-Path $here 'pack_training_data.py') verify $DataRoot
    if ($LASTEXITCODE -ne 0) { Fail 'The pack is incomplete or damaged. Copy it again from the original computer.' }

    Step '3/6 The original model'
    $packModel = Join-Path $DataRoot 'repo-models\unet.pth'
    $target = Join-Path $models 'unet.pth'
    $want = (Get-FileHash $packModel -Algorithm SHA256).Hash
    $have = $null
    if (Test-Path $target) { $have = (Get-FileHash $target -Algorithm SHA256).Hash }
    if ($have -eq $want) {
        Done 'Already the registered original.'
    } else {
        if ($have -and -not $ReplaceOriginalModel) {
            Fail "$target is a different model from the one the training data was built on. Run this again with -ReplaceOriginalModel to use the pack's model; the current file is kept beside it as a backup."
        }
        if ($have) {
            $backup = "$target.before-training-setup-$(Get-Date -Format yyyyMMdd-HHmmss)"
            Copy-Item $target $backup
            Write-Host "   Kept the previous model as $backup"
        }
        if (-not (Test-Path $models)) { New-Item -ItemType Directory -Path $models | Out-Null }
        Copy-Item $packModel $target -Force
        Done "Installed $target"
    }

    Step '4/6 Rewriting the paths for this computer'
    # Python reads PACKED.json: Windows PowerShell's ConvertFrom-Json refuses files over about 2 MB. No double quotes
    # in the code: Windows PowerShell drops them from a native command's arguments.
    $oldRoot = & $venvPython -c 'import json, sys; print(json.load(open(sys.argv[1], encoding=''utf-8''))[''old_root''])' $packed
    if ($LASTEXITCODE -ne 0 -or -not $oldRoot) { Fail "$packed could not be read." }
    & $venvPython $relocate --old-root $oldRoot --new-root $DataRoot --models-dir $models
    if ($LASTEXITCODE -ne 0) { Fail 'relocate.py found a problem and changed nothing; see the lines above.' }
}

Step '5/6 Remembering this setup'
$local = Join-Path $here 'retraining.local.bat'
$lines = @(
    '@echo off',
    "rem Written by setup-training-pc.ps1 on $(Get-Date -Format 'yyyy-MM-dd HH:mm'): this computer's UNet Extend Training setup.",
    'rem Not committed (.gitignore). Run setup-training-pc.ps1 again to change it.',
    "set `"VISHEART_UNET_ROOT=$DataRoot`"",
    "set `"VISHEART_RETRAINING_VENV=$venv`""
)
[IO.File]::WriteAllText($local, (($lines -join "`r`n") + "`r`n"), [Text.Encoding]::ASCII)
Done "Wrote $local"

Step '6/6 Starting the training service'
& cmd.exe /c "`"$(Join-Path $here 'stop-retraining-worker.bat')`""
if ($LASTEXITCODE -eq 1) { Fail 'A training is running, so the service was not restarted. Run this again when it finishes.' }
& cmd.exe /c "`"$(Join-Path $here 'start-retraining-worker.bat')`""
if ($LASTEXITCODE -ne 0) { Fail "The training service did not start. See $DataRoot\jobs\worker.log" }
try {
    $status = (Invoke-RestMethod -Uri 'http://127.0.0.1:8010/status' -TimeoutSec 30).data
} catch {
    Fail "The training service started but did not answer: $($_.Exception.Message)"
}
$kept = @($status.versions | Where-Object { $_.status -ne 'deleted' }).Count
Done "Running. Model in use: $($status.active); $kept versions kept."
Write-Host ''
Write-Host 'Set up. Restart VisHeart (stop.bat, then start.bat in visheart-local-deployment) so the segmentation service'
Write-Host 'loads the original model, then open UNet Extend Training from the dashboard.'
