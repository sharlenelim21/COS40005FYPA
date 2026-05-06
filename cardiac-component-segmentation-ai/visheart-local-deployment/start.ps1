param(
    [int]$WaitRetries = 12,
    [int]$WaitIntervalSec = 5
)

# VisHeart local-deployment startup script.
# - Detects whether Docker has access to an NVIDIA GPU.
# - Picks the matching docker-compose profile: 'gpu' (NVIDIA) or 'cpu'.
# - Brings up visheart-app + dependencies + the chosen inference container.
# - Health-checks frontend, backend, and the inference service.
#
# Both gpu-cpu and gpu-nvidia services in docker-compose.yml share the
# network alias `gpu` and bind uvicorn on port 8011, so visheart-app
# always reaches the inference service at http://gpu:8011 regardless of
# which profile is active.

function Write-Log {
    param([string]$Msg)
    $ts = (Get-Date).ToString('u')
    Write-Host "[$ts] $Msg"
}

function Test-DockerAvailable {
    try {
        docker version > $null 2>&1
        return $true
    } catch {
        return $false
    }
}

function Test-DockerGpuAvailable {
    # Method 1: check whether Docker exposes the 'nvidia' runtime.
    try {
        $runtimes = docker info --format '{{json .Runtimes}}' 2>$null
        if ($runtimes) {
            try {
                $obj = $runtimes | ConvertFrom-Json -ErrorAction Stop
                if ($obj.PSObject.Properties.Name -contains 'nvidia') {
                    Write-Log "Detected 'nvidia' runtime in 'docker info'."
                    return $true
                }
            } catch {
                # ignore parse errors and fall through to Method 2
            }
        }
    } catch {
        # ignore; fall through to Method 2
    }

    # Method 2: actually attempt to run nvidia-smi inside a CUDA container.
    Write-Log "Attempting container-level GPU check (this may pull a CUDA base image)."
    $img = 'nvidia/cuda:12.4.1-base-ubuntu22.04'
    try {
        & docker run --rm --gpus all $img nvidia-smi > $null 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Log 'Container-level GPU check succeeded.'
            return $true
        } else {
            Write-Log 'Container-level GPU check failed (non-zero exit).'
            return $false
        }
    } catch {
        Write-Log 'Container-level GPU check failed (exception).'
        return $false
    }
}

function Test-Url {
    param([string]$url)
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 6 -Method GET -ErrorAction Stop
        return $true
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
        $inferenceContainer = 'visheart-gpu-nvidia'
    } else {
        $profile = 'cpu'
        $inferenceContainer = 'visheart-gpu-cpu'
    }

    Write-Log "Selected profile: $profile"
    Write-Log "Selected inference container: $inferenceContainer"
    if (-not $gpuAvailable) {
        Write-Log 'INFO: NVIDIA GPU not detected. Starting CPU profile. MedSAM is GPU-only and will be unavailable; UNet runs on CPU.'
    }

    # Remove a stale container from the *opposite* profile so the 8011
    # host port doesn't collide between consecutive runs.
    $oppositeContainer = if ($gpuAvailable) { 'visheart-gpu-cpu' } else { 'visheart-gpu-nvidia' }
    $stale = docker ps -aq --filter "name=$oppositeContainer" 2>$null
    if ($stale) {
        Write-Log "Removing stale '$oppositeContainer' container to avoid port 8011 conflicts."
        docker rm -f $stale 2>$null | Out-Null
    }

    Write-Log "Running: docker compose --profile $profile up -d"
    & docker compose --profile $profile up -d
    if ($LASTEXITCODE -ne 0) {
        Write-Log "ERROR: 'docker compose --profile $profile up -d' failed (exit $LASTEXITCODE)."
        exit 5
    }

    # Backend image runs Node.js but invokes a Python helper for landmark/UNet
    # local paths via a `python` shim. Some base images only ship `python3`;
    # link them so child_process.execFile('python', ...) resolves.
    Write-Log 'Ensuring `python` symlink exists in backend container...'
    docker exec visheart-local sh -c "command -v python >/dev/null 2>&1 || ln -sf /usr/bin/python3 /usr/bin/python" > $null 2>&1

    # Health checks. /status/server is always available; /status/gpu is only
    # expected to report `backend: cuda` when the GPU profile is active.
    $backendUrl       = 'http://localhost:5000/'
    $frontendUrl      = 'http://localhost:3000/'
    # Prebuilt GPU image listens on 8001. If you rebuild from local
    # source (which uses 8011), update this together with the compose
    # `ports:` mapping and the visheart-app env block.
    $inferenceServerUrl = 'http://localhost:8001/status/server'
    $inferenceGpuUrl    = 'http://localhost:8001/status/gpu'

    Write-Log 'Waiting for services to respond (this may take a minute)...'
    $backendOk = $false; $frontendOk = $false; $inferenceOk = $false; $inferenceGpuOk = $false

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
