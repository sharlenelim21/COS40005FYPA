#!/usr/bin/env pwsh
# VisHeart Local Deployment Startup Script
# Implements GPU detection with automatic CPU fallback and health checks.

param(
    [int]$WaitRetries = 60,
    [int]$WaitIntervalSec = 2
)

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ssZ"
    Write-Host "[$timestamp] $Message"
}

function Test-DockerAvailable {
    try {
        docker version | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Test-DockerGpuAvailable {
    # Check if nvidia runtime is present
    try {
        $dockerInfo = docker info 2>$null
        if ($dockerInfo -like "*nvidia*") {
            Write-Log "Detected 'nvidia' runtime in 'docker info'. Will perform container-level verification to confirm GPU usability."
            Write-Log "Attempting container-level GPU check (this may pull a lightweight CUDA base image)."
            
            # Actually test GPU with a container
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

try {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    Set-Location $scriptDir
    Write-Log 'Starting VisHeart startup helper...'

    if (-not (Test-DockerAvailable)) {
        Write-Log 'Docker not available. Please start Docker Desktop and try again.'
        exit 2
    }

    $gpuAvailable = Test-DockerGpuAvailable

    if ($gpuAvailable) {
        $profile = 'gpu'
        $inferenceService = 'gpu-nvidia'      # compose SERVICE name
        $inferenceContainer = 'visheart-gpu-nvidia'  # container name
    } else {
        $profile = 'cpu'
        $inferenceService = 'gpu-cpu'         # compose SERVICE name
        $inferenceContainer = 'visheart-gpu-cpu'    # container name
    }

    Write-Log "Selected profile: $profile"
    Write-Log "Selected inference service: $inferenceService (container: $inferenceContainer)"
    if (-not $gpuAvailable) {
        Write-Log 'INFO: NVIDIA GPU not detected. Starting CPU profile. MedSAM is GPU-only and will be unavailable; UNet runs on CPU.'
    }

    # Remove a stale container from the *opposite* profile so the 8001
    # host port doesn't collide between consecutive runs.
    $oppositeContainer = if ($gpuAvailable) { 'visheart-gpu-cpu' } else { 'visheart-gpu-nvidia' }
    $stale = docker ps -aq --filter "name=$oppositeContainer" 2>$null
    if ($stale) {
        Write-Log "Removing stale '$oppositeContainer' container to avoid port 8001 conflicts."
        docker rm -f $stale 2>$null | Out-Null
    }

    Write-Log "Running: docker compose --profile $profile up -d visheart-app $inferenceService"
    & docker compose --profile $profile up -d visheart-app $inferenceService
    $composeExit = $LASTEXITCODE

    if ($composeExit -ne 0) {
        Write-Log "ERROR: 'docker compose --profile $profile up -d visheart-app $inferenceContainer' failed (exit $composeExit)."
        if ($profile -eq 'gpu') {
            Write-Log "GPU profile startup failed - attempting automatic CPU fallback."
            # Switch to CPU profile and attempt to start again.
            $profile = 'cpu'
            $inferenceService = 'gpu-cpu'
            $inferenceContainer = 'visheart-gpu-cpu'

            # Remove any partially-created GPU container to avoid port conflicts.
            $staleGpu = docker ps -aq --filter "name=visheart-gpu-nvidia" 2>$null
            if ($staleGpu) {
                Write-Log "Removing partially-created 'visheart-gpu-nvidia' container."
                docker rm -f $staleGpu 2>$null | Out-Null
            }

            Write-Log "Running: docker compose --profile cpu up -d visheart-app $inferenceService"
            & docker compose --profile cpu up -d visheart-app $inferenceService
            $composeExit2 = $LASTEXITCODE
            if ($composeExit2 -ne 0) {
                Write-Log "ERROR: CPU fallback also failed (exit $composeExit2). Aborting startup."
                exit 5
            }

            # After successful CPU fallback, we no longer expect GPU-specific endpoints.
            $gpuAvailable = $false
            Write-Log "CPU fallback succeeded. Selected profile: $profile (container: $inferenceContainer)"
        } else {
            exit 5
        }
    }

    # Backend image runs Node.js but invokes a Python helper for landmark/UNet
    # local paths via a python shim. Some base images only ship python3;
    # link them so child_process.execFile('python', ...) resolves.
    Write-Log 'Ensuring python symlink exists in backend container...'
    $pythonFixCmd = 'command -v python >/dev/null 2>&1 || ln -sf /usr/bin/python3 /usr/bin/python'
    # Run the fix inside the container shell; ensure PowerShell passes the
    # full shell string as a single argument by using a single-quoted string.
    & docker exec visheart-local sh -c 'command -v python >/dev/null 2>&1 || ln -sf /usr/bin/python3 /usr/bin/python' > $null 2>&1

    # Health checks. /status/server is always available; /status/gpu is only
    # expected to report backend: cuda when the GPU profile is active.
    $backendUrl = 'http://localhost:5000/'
    $frontendUrl = 'http://localhost:3000/'
    # Prebuilt GPU image listens on 8001. If you rebuild from local
    # source (which uses 8011), update this together with the compose
    # ports mapping and the visheart-app env block.
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
