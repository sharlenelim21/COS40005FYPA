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
