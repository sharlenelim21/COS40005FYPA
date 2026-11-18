#!/usr/bin/env pwsh

param(
    [int]$WaitRetries = 60,
    [int]$WaitIntervalSec = 2,
    # start.bat --cpu / --gpu pass these to skip GPU detection.
    [switch]$ForceCpu,
    [switch]$ForceGpu
)

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ssZ"
    Write-Host "[$timestamp] $Message"
}

function Test-DockerGpuAvailable {
    try {
        $dockerInfo = docker info 2>$null
        if ($dockerInfo -like "*nvidia*") {
            Write-Log "Detected 'nvidia' runtime in 'docker info'. Will perform container-level verification to confirm GPU usability."
            Write-Log "Attempting container-level GPU check (this may pull a lightweight CUDA base image)."

            docker run --rm --gpus all "nvidia/cuda:12.3.0-base-ubuntu22.04" nvidia-smi 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) {
                Write-Log "Container-level GPU check passed."
                return $true
            } else {
                Write-Log "Container-level GPU check failed (non-zero exit)."
                return $false
            }
        }
        return $false
    } catch {
        return $false
    }
}

function Test-Url {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3 -Method GET -ErrorAction Stop
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Start-RetrainingWorker {
    # UNet Extend Training runs on this computer, not in Docker. A container cannot start it, so the launcher does.
    # Computers without the training setup skip it; the rest of VisHeart does not depend on it. A computer that has the
    # training data pack in visheart-training-data but no setup yet is set up on its first start (about 10 minutes).
    $retraining = Join-Path $scriptDir '..\visheart-retraining'
    $worker = Join-Path $retraining 'start-retraining-worker.bat'
    if (-not (Test-Path $worker)) {
        Write-Log 'INFO: UNet Extend Training service not found; skipping it.'
        return
    }
    Write-Log 'Starting the UNet Extend Training service...'
    & cmd.exe /c "`"$worker`"" | ForEach-Object { Write-Log "  $_" }
    $code = $LASTEXITCODE
    $pack = [IO.Path]::GetFullPath((Join-Path $scriptDir '..\visheart-training-data'))
    if ($code -eq 2 -and (Test-Path (Join-Path $pack 'PACKED.json'))) {
        Write-Log 'Setting up UNet Extend Training from visheart-training-data (first start only, about 10 minutes)...'
        $model = Join-Path $scriptDir '..\visheart-inference-gpu\app\models\unet.pth'
        $before = if (Test-Path $model) { (Get-FileHash $model -Algorithm SHA256).Hash } else { '' }
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $retraining 'setup-training-pc.ps1') -DataRoot $pack -Auto |
            ForEach-Object { Write-Log "  $_" }
        $code = $LASTEXITCODE
        $after = if (Test-Path $model) { (Get-FileHash $model -Algorithm SHA256).Hash } else { '' }
        if ($after -ne $before -and $inferenceContainer) {
            # The segmentation service started before the original model was put in place; it loads it on restart.
            Write-Log "Restarting $inferenceContainer so it loads the original model..."
            & docker restart $inferenceContainer | Out-Null
        }
    } elseif ($code -eq 2) {
        Write-Log "INFO: To use UNet Extend Training here, copy the training data pack to $pack (see visheart-retraining\SETUP-ANOTHER-PC.md)."
    }
    if ($code -ne 0) {
        Write-Log 'INFO: UNet Extend Training is unavailable; the rest of VisHeart is not affected.'
    }
}

try {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    Set-Location $scriptDir
    Write-Log 'Starting VisHeart startup helper...'

    Import-Module (Join-Path $scriptDir 'lib\VisHeartStart.psm1') -Force

    $docker = Wait-DockerReady
    if (-not $docker.Ready) {
        $account = "$env:USERDOMAIN\$env:USERNAME"
        switch ($docker.Reason) {
            'not-installed' { Write-Log 'Docker Desktop is not installed. Install it from https://www.docker.com/products/docker-desktop/ (or run the VisHeart installer again), then start VisHeart.' }
            'no-access'     { Write-Log "Docker is installed but this Windows account ($account) cannot use it. Ask the person who installed VisHeart to run: net localgroup docker-users `"$account`" /add  then sign out and in again." }
            default         { Write-Log 'Docker Desktop did not become ready within 3 minutes. Open Docker Desktop, wait until it says Docker is running, then start VisHeart again.' }
        }
        exit 2
    }

    # An installed copy has release.env / secrets.env here; a developer clone has neither and uses the defaults.
    $envArgs = @(Get-ComposeEnvArgs $scriptDir)
    if ($envArgs.Count -gt 0) { Write-Log 'Using the installed settings (release.env / secrets.env).' }

    $database = Test-DatabaseVolume $scriptDir
    if (-not $database.Ok) {
        Write-Log "This PC already has a VisHeart database ($($database.Volume)) that was made by another copy of VisHeart, with other passwords, so this copy cannot open it."
        Write-Log "If that data is not needed, delete it (this cannot be undone) in a Command Prompt with:  cd /d `"$scriptDir`" && docker compose --profile cpu --profile gpu down -v  then start VisHeart again."
        Write-Log 'If it is needed, ask the VisHeart team before doing anything.'
        exit 7
    }

    if (-not (Initialize-BackendFolders $scriptDir).Built) {
        Write-Log 'The backend is not built (Cardiac_Segmentation_FYP_Server\dist\index.js is missing).'
        Write-Log 'In a Command Prompt run:  cd /d "..\Cardiac_Segmentation_FYP_Server" && pnpm install && pnpm build  then start VisHeart again.'
        exit 8
    }

    foreach ($name in @(Remove-OtherCopyContainers $scriptDir)) {
        Write-Log "Removed container '$name' left by another copy of VisHeart (its data is kept)."
    }

    $busy = @(Get-BusyPorts)
    if ($busy.Count -gt 0) {
        foreach ($b in $busy) {
            Write-Log "Port $($b.Port) is used by another program: $($b.Process) (process id $($b.Id)). VisHeart needs this port."
        }
        Write-Log 'Close that program (or stop it in Task Manager > Details, by its process id), then start VisHeart again.'
        exit 9
    }

    if ($ForceCpu) {
        Write-Log 'CPU mode requested (--cpu); skipping GPU detection.'
        $gpuAvailable = $false
    } elseif ($ForceGpu) {
        Write-Log 'GPU mode requested (--gpu); skipping GPU detection.'
        $gpuAvailable = $true
    } else {
        $gpuAvailable = Test-DockerGpuAvailable
    }

    if ($gpuAvailable) {
        $profile = 'gpu'
        $inferenceService = 'gpu-nvidia'
        $inferenceContainer = 'visheart-gpu-nvidia'
    } else {
        $profile = 'cpu'
        $inferenceService = 'gpu-cpu'
        $inferenceContainer = 'visheart-gpu-cpu'
    }

    Write-Log "Selected profile: $profile"
    Write-Log "Selected inference service: $inferenceService (container: $inferenceContainer)"
    if (-not $gpuAvailable) {
        Write-Log 'INFO: NVIDIA GPU not detected. Starting CPU profile. MedSAM is GPU-only and will be unavailable; UNet runs on CPU.'
    }

    $oppositeContainer = if ($gpuAvailable) { 'visheart-gpu-cpu' } else { 'visheart-gpu-nvidia' }
    $stale = docker ps -aq --filter "name=$oppositeContainer" 2>$null
    if ($stale) {
        Write-Log "Removing stale '$oppositeContainer' container to avoid port 8001 conflicts."
        docker rm -f $stale 2>$null | Out-Null
    }

    $pullExit = Invoke-FirstPull (@('compose') + $envArgs + @('--profile', $profile)) @('visheart-app', $inferenceService)
    if ($pullExit -ne 0) {
        Write-Log "ERROR: Downloading VisHeart failed (exit $pullExit). Check the internet connection and start VisHeart again; the download continues where it stopped."
        exit 6
    }

    Write-Log "Running: docker compose --profile $profile up -d visheart-app $inferenceService"
    & docker compose @envArgs --profile $profile up -d visheart-app $inferenceService
    $composeExit = $LASTEXITCODE

    if ($composeExit -ne 0) {
        Write-Log "ERROR: 'docker compose --profile $profile up -d visheart-app $inferenceContainer' failed (exit $composeExit)."
        if ($profile -eq 'gpu') {
            Write-Log "GPU profile startup failed - attempting automatic CPU fallback."
            $profile = 'cpu'
            $inferenceService = 'gpu-cpu'
            $inferenceContainer = 'visheart-gpu-cpu'

            $staleGpu = docker ps -aq --filter "name=visheart-gpu-nvidia" 2>$null
            if ($staleGpu) {
                Write-Log "Removing partially-created 'visheart-gpu-nvidia' container."
                docker rm -f $staleGpu 2>$null | Out-Null
            }

            Write-Log "Running: docker compose --profile cpu up -d visheart-app $inferenceService"
            & docker compose @envArgs --profile cpu up -d visheart-app $inferenceService
            $composeExit2 = $LASTEXITCODE
            if ($composeExit2 -ne 0) {
                Write-Log "ERROR: CPU fallback also failed (exit $composeExit2). Aborting startup."
                exit 5
            }

            $gpuAvailable = $false
            Write-Log "CPU fallback succeeded. Selected profile: $profile (container: $inferenceContainer)"
        } else {
            exit 5
        }
    }

    Write-Log 'Ensuring python symlink exists in backend container...'
    $pythonFixCmd = 'command -v python >/dev/null 2>&1 || ln -sf /usr/bin/python3 /usr/bin/python'
    & docker exec visheart-local sh -c 'command -v python >/dev/null 2>&1 || ln -sf /usr/bin/python3 /usr/bin/python' > $null 2>&1

    Start-RetrainingWorker

    $backendUrl = 'http://localhost:5000/'
    $frontendUrl = 'http://localhost:3000/'
    $inferenceServerUrl = 'http://localhost:8001/status/server'
    $inferenceGpuUrl = 'http://localhost:8001/status/gpu'

    Write-Log 'Waiting for services to respond (this may take a minute)...'
    $backendOk = $false
    $frontendOk = $false
    $inferenceOk = $false
    $inferenceGpuOk = $false

    for ($i = 0; $i -lt $WaitRetries; $i++) {
        if (-not $backendOk)   { $backendOk   = Test-Url $backendUrl }
        if (-not $frontendOk)  { $frontendOk  = Test-Url $frontendUrl }
        if (-not $inferenceOk) { $inferenceOk = Test-Url $inferenceServerUrl }
        if ($gpuAvailable -and -not $inferenceGpuOk) {
            $inferenceGpuOk = Test-Url $inferenceGpuUrl
        }

        Write-Log "Health check iteration $($i+1): backend=$backendOk frontend=$frontendOk inference=$inferenceOk gpuStatus=$inferenceGpuOk"
        if ($backendOk -and $frontendOk -and $inferenceOk -and ((-not $gpuAvailable) -or $inferenceGpuOk)) { break }
        Start-Sleep -Seconds $WaitIntervalSec
    }

    Write-Log 'Health check summary:'
    Write-Log "  Backend          (http://localhost:5000/)            => $backendOk"
    Write-Log "  Frontend         (http://localhost:3000/)            => $frontendOk"
    Write-Log "  Inference server (http://localhost:8001/status/server) => $inferenceOk"
    if ($gpuAvailable) {
        Write-Log "  Inference GPU    (http://localhost:8001/status/gpu)    => $inferenceGpuOk"
    }

    # An installed copy asks whether the team has published a newer version. This window closes by itself after a
    # successful start, so the notice is also shown in a popup that stays until the user presses OK.
    $update = Get-UpdateNotice $scriptDir
    if ($update) {
        $text = "A new version of VisHeart ($($update.Version)) is available."
        if ($update.Note) { $text += "`n`n$($update.Note)" }
        if ($update.Download) { $text += "`n`nDownload the Update installer from:`n$($update.Download)" }
        else { $text += "`n`nAsk the VisHeart team where to download it." }
        $text += "`n`nVisHeart is running and you can keep using it. Install the update when convenient."
        foreach ($line in ($text -split "`n")) { if ($line) { Write-Log "UPDATE: $line" } }
        try { (New-Object -ComObject WScript.Shell).Popup($text, 0, 'VisHeart update available', 64) | Out-Null } catch { }
    }

    if ($backendOk -and $frontendOk -and $inferenceOk -and ((-not $gpuAvailable) -or $inferenceGpuOk)) {
        Write-Log 'Startup successful.'
        Write-Log ''
        Write-Log 'Open http://localhost:3000 in your browser.'
        Write-Log ('Inference profile: ' + $profile + ' (container: ' + $inferenceContainer + ')')
        exit 0
    } else {
        Write-Log 'Startup completed with warnings or failures.'
        if (-not $backendOk)   { Write-Log 'ERROR: Backend did not respond.' }
        if (-not $frontendOk)  { Write-Log 'ERROR: Frontend did not respond.' }
        if (-not $inferenceOk) { Write-Log 'ERROR: Inference service /status/server did not respond.' }
        if ($gpuAvailable -and -not $inferenceGpuOk) {
            Write-Log 'ERROR: Inference GPU status (/status/gpu) not responding though profile is GPU.'
        }
        exit 3
    }
} catch {
    Write-Log "Unexpected error: $($_.Exception.Message)"
    exit 4
}
