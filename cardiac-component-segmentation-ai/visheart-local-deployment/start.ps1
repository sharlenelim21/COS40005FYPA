param(
    [int]$WaitRetries = 12,
    [int]$WaitIntervalSec = 5
)

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
    # First, try to detect 'nvidia' runtime from docker info
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
                # ignore parse errors and fallback
            }
        }
    } catch {
        # ignore
    }

    # Fallback: attempt to run an nvidia/cuda container and execute nvidia-smi
    Write-Log "Attempting container-level GPU check (this may pull an image)."
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
        $medsamBaseUrl = 'http://gpu:8001'
        $unetBaseUrl = 'http://gpu:8001'
    } else {
        $profile = 'cpu'
        $inferenceContainer = 'visheart-gpu-cpu'
        $medsamBaseUrl = 'http://gpu:8001'
        $unetBaseUrl = 'http://gpu:8001'
    }

    # Generate env file for docker compose to ensure runtime routing (avoids hardcoding localhost)
    $envFile = Join-Path $scriptDir '.env.start'
    @(
        "MEDSAM_USE_LOCALHOST=false",
        "MEDSAM_LOCAL_BASE_URL=$medsamBaseUrl",
        "GPU_API_URL=$medsamBaseUrl",
        "GPU_SERVER_URL=gpu",
        "GPU_SERVER_PORT=8001"
    ) | Out-File -FilePath $envFile -Encoding UTF8

    Write-Log "Selected profile: $profile"
    Write-Log "Selected inference container: $inferenceContainer"
    Write-Log "Selected MedSAM base URL: $medsamBaseUrl"
    Write-Log "Selected UNet base URL: $unetBaseUrl"

    if (-not $gpuAvailable) {
        Write-Log 'WARNING: NVIDIA GPU not detected for Docker. Starting CPU profile. MedSAM may not function if it requires CUDA.'
    }

    # Start compose with the chosen profile and the generated env file
    Write-Log "Running: docker compose --env-file $envFile --profile $profile up -d"
    $startCmd = "docker compose --env-file `"$envFile`" --profile $profile up -d"
    Write-Log "Starting containers..."
    iex $startCmd

    # Create python symlink (minimal fix for backend python execution)
    Write-Log "Creating python symlink in backend container..."
    docker exec visheart-local sh -c "ln -sf /usr/bin/python3 /usr/bin/python" > $null 2>&1

    # Health checks
    $backendUrl = 'http://localhost:5000/'
    $frontendUrl = 'http://localhost:3000/'
    $inferenceStatusUrl = 'http://localhost:8001/status/server'
    $inferenceGpuUrl = 'http://localhost:8001/status/gpu'

    Write-Log 'Waiting for services to respond (this may take a minute)...'
    $backendOk = $false; $frontendOk = $false; $inferenceOk = $false; $inferenceGpuOk = $false

    for ($i = 0; $i -lt $WaitRetries; $i++) {
        if (-not $backendOk) { $backendOk = Test-Url $backendUrl }
        if (-not $frontendOk) { $frontendOk = Test-Url $frontendUrl }
        if (-not $inferenceOk) { $inferenceOk = Test-Url $inferenceStatusUrl }
        if ($gpuAvailable -and -not $inferenceGpuOk) { $inferenceGpuOk = Test-Url $inferenceGpuUrl }

        Write-Log "Health check iteration $($i+1): backend=$backendOk frontend=$frontendOk inference=$inferenceOk gpuStatus=$inferenceGpuOk"
        if ($backendOk -and $frontendOk -and $inferenceOk -and ((-not $gpuAvailable) -or $inferenceGpuOk)) { break }
        Start-Sleep -Seconds $WaitIntervalSec
    }

    Write-Log 'Health check summary:'
    Write-Log "  Backend (http://localhost:5000/) => $backendOk"
    Write-Log "  Frontend (http://localhost:3000/) => $frontendOk"
    Write-Log "  Inference /status/server (http://localhost:8001/status/server) => $inferenceOk"
    if ($gpuAvailable) { Write-Log "  Inference /status/gpu (http://localhost:8001/status/gpu) => $inferenceGpuOk" }

    if ($backendOk -and $frontendOk -and $inferenceOk -and ((-not $gpuAvailable) -or $inferenceGpuOk)) {
        Write-Log 'Startup successful.'
        exit 0
    } else {
        Write-Log 'Startup completed with warnings or failures.'
        if (-not $backendOk) { Write-Log 'ERROR: Backend did not respond.' }
        if (-not $frontendOk) { Write-Log 'ERROR: Frontend did not respond.' }
        if (-not $inferenceOk) { Write-Log 'ERROR: Inference service /status/server did not respond.' }
        if ($gpuAvailable -and -not $inferenceGpuOk) { Write-Log 'ERROR: Inference GPU status (/status/gpu) not responding though profile is GPU.' }
        exit 3
    }
} catch {
    Write-Log "Unexpected error: $($_.Exception.Message)"
    exit 4
}
# Quick Start Script for Combined Container Deployment
# This version uses a single container for both frontend and backend

# Get script path (works with both direct execution and -File parameter)
$scriptPath = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }

# Check admin status first
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# Check if hosts file needs updating (without admin privileges first)
$hostsPath = "C:\Windows\System32\drivers\etc\hosts"
$hostsContent = Get-Content -Path $hostsPath -ErrorAction SilentlyContinue
$needsHostsUpdate = -not ($hostsContent -match "127\.0\.0\.1\s+minio")

# If hosts file needs updating and not admin, auto-elevate
if ($needsHostsUpdate -and -not $isAdmin) {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "Admin Privileges Required" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "This script needs to add 'minio' to your hosts file for file preview to work." -ForegroundColor White
    Write-Host "Requesting Administrator privileges..." -ForegroundColor Yellow
    Write-Host ""
    
    # Relaunch as admin with execution policy bypass
    try {
        $arguments = "-ExecutionPolicy Bypass -NoExit -File `"$scriptPath`""
        Start-Process powershell -Verb RunAs -ArgumentList $arguments
        exit 0
    } catch {
        Write-Host "ERROR: Failed to elevate privileges. Please run PowerShell as Administrator manually." -ForegroundColor Red
        exit 1
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VisHeart Local - Combined Container" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is running
Write-Host "Checking Docker..." -ForegroundColor Yellow
$dockerRunning = $null
try {
    $dockerRunning = docker ps 2>&1
} catch {
    Write-Host "ERROR: Docker is not running. Please start Docker Desktop." -ForegroundColor Red
    exit 1
}
Write-Host "OK: Docker is running" -ForegroundColor Green
Write-Host ""

# Navigate to deployment directory
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $SCRIPT_DIR

# Add minio to hosts file if needed
Write-Host "Checking hosts file configuration..." -ForegroundColor Yellow
$minioEntry = "127.0.0.1`tminio"

if ($needsHostsUpdate) {
    Write-Host "Adding 'minio' to hosts file..." -ForegroundColor Yellow
    try {
        Add-Content -Path $hostsPath -Value "`n$minioEntry" -ErrorAction Stop
        Write-Host "OK: Successfully added minio to hosts file!" -ForegroundColor Green
        # Update the flag so we don't try to add it again
        $needsHostsUpdate = $false
    } catch {
        Write-Host "WARNING: Failed to update hosts file: $_" -ForegroundColor Yellow
        Write-Host "File preview may not work properly." -ForegroundColor Yellow
    }
} else {
    Write-Host "OK: Hosts file already configured" -ForegroundColor Green
}
Write-Host ""

# Detect Nvidia GPU automatically
Write-Host "Detecting hardware capabilities..." -ForegroundColor Yellow
$env:COMPOSE_PROFILES = "cpu"
$gpuDetected = $false
try {
    if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
        $nvidiaInfo = & nvidia-smi 2>&1
        if ($LASTEXITCODE -eq 0) {
            $env:COMPOSE_PROFILES = "gpu"
            $gpuDetected = $true
        }
    }
} catch {}

if ($gpuDetected) {
    Write-Host "OK: NVIDIA GPU Detected! Utilizing 'gpu' profile." -ForegroundColor Green
} else {
    Write-Host "INFO: No compatible NVIDIA GPU found. Falling back to 'cpu' profile." -ForegroundColor Cyan
}
Write-Host ""

# Remove stale container from opposite profile to avoid 8001 port conflicts
Write-Host "Checking for stale inference containers..." -ForegroundColor Yellow
if ($env:COMPOSE_PROFILES -eq "cpu") {
    $staleGpu = docker ps -aq --filter "name=visheart-gpu-nvidia"
    if ($staleGpu) {
        docker rm -f $staleGpu 2>$null | Out-Null
    }
} else {
    $staleCpu = docker ps -aq --filter "name=visheart-gpu-cpu"
    if ($staleCpu) {
        docker rm -f $staleCpu 2>$null | Out-Null
    }
}

# Remove stale non-running core containers so Compose can recreate with current config
Write-Host "Checking for stale core containers..." -ForegroundColor Yellow
$coreContainers = @("visheart-local", "visheart-mongodb", "visheart-redis", "visheart-minio", "visheart-minio-setup")
docker rm -f $coreContainers 2>$null | Out-Null

# Start services
Write-Host "Starting VisHeart services..." -ForegroundColor Yellow
Write-Host "This may take a few minutes on first run..." -ForegroundColor Gray  
Write-Host ""

docker-compose up -d

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Failed to start services!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Waiting for services to be healthy..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Check service status
Write-Host ""
Write-Host "Service Status:" -ForegroundColor Cyan
docker-compose ps

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VisHeart is Starting!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Please wait 30-60 seconds for all services to fully initialize..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Access Points:" -ForegroundColor Cyan
Write-Host "  Frontend:      http://localhost:3000" -ForegroundColor White
Write-Host "  Backend API:   http://localhost:5000" -ForegroundColor White
Write-Host "  MinIO Console: http://localhost:9001" -ForegroundColor White
Write-Host "  GPU Service:   http://localhost:8001" -ForegroundColor White
Write-Host ""
Write-Host "Default Credentials:" -ForegroundColor Cyan
Write-Host "  Application:   Create account on first visit" -ForegroundColor White
Write-Host "  MinIO Console: minioadmin / minioadmin123" -ForegroundColor White
Write-Host ""
Write-Host "Useful Commands:" -ForegroundColor Cyan
Write-Host "  View logs:     docker-compose logs -f" -ForegroundColor White
Write-Host "  Stop services: docker-compose down" -ForegroundColor White
Write-Host "  Restart:       docker-compose restart" -ForegroundColor White
Write-Host ""
Write-Host "Note: This deployment uses a SINGLE container for frontend + backend" -ForegroundColor Yellow
Write-Host "      Both services run together using PM2 process manager" -ForegroundColor Yellow
Write-Host ""
