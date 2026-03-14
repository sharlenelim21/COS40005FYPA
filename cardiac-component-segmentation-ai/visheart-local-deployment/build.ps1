# Build script for combined local deployment container
# This builds a single Docker image containing both frontend and backend

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Building VisHeart Combined Local Image" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$IMAGE_NAME = "jesmineting/visheart-local"
$VERSION = "1.0.0"
$FULL_IMAGE_NAME = "${IMAGE_NAME}:${VERSION}"

Write-Host "Image: $FULL_IMAGE_NAME" -ForegroundColor Green
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

# Navigate to project root
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Split-Path -Parent $SCRIPT_DIR)

Write-Host "Building from: $PWD" -ForegroundColor Yellow
Write-Host ""

# Build the combined image
Write-Host "Building combined image..." -ForegroundColor Yellow
Write-Host "This will take several minutes..." -ForegroundColor Gray
Write-Host ""

docker build -f visheart-local-deployment/Dockerfile -t $FULL_IMAGE_NAME -t "${IMAGE_NAME}:latest" --build-arg BUILDKIT_INLINE_CACHE=1 .

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR: Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Build Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Image built: $FULL_IMAGE_NAME" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Test locally using docker-compose.yml" -ForegroundColor White
Write-Host "  2. Or use the start.ps1 script" -ForegroundColor White
Write-Host "  3. Push to Docker Hub (optional): docker push $FULL_IMAGE_NAME" -ForegroundColor White
Write-Host ""
