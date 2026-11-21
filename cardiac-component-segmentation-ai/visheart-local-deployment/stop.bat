@echo off
REM VisHeart Stop Script
REM Stops the UNet Extend Training service (when this computer has it), then all Docker containers.
REM While a training runs it asks first; set STOP_TRAINING=yes or STOP_TRAINING=no to answer in advance.
REM   stop.bat --no-pause   never waits for a key (used by the installer and uninstaller); a running
REM                         training is stopped unless STOP_TRAINING=no is set.

echo ========================================
echo Stopping VisHeart Services
echo ========================================
echo.

cd /d "%~dp0"

set "NO_PAUSE="
if /I "%~1"=="--no-pause" set "NO_PAUSE=1"
if defined NO_PAUSE if not defined STOP_TRAINING set "STOP_TRAINING=yes"

rem An installed copy keeps its settings in release.env and secrets.env; a developer clone has neither.
set "ENV_ARGS="
if exist "%~dp0release.env" set ENV_ARGS=%ENV_ARGS% --env-file "%~dp0release.env"
if exist "%~dp0secrets.env" set ENV_ARGS=%ENV_ARGS% --env-file "%~dp0secrets.env"

set "WORKER_STOP=%~dp0..\visheart-retraining\stop-retraining-worker.bat"
if exist "%WORKER_STOP%" (
    call :stop_training_service
) else (
    echo UNet Extend Training service not found; skipping it.
)
echo.

echo Detecting hardware capabilities...
set COMPOSE_PROFILES=cpu
where nvidia-smi >nul 2>nul
if %errorlevel% equ 0 (
    set COMPOSE_PROFILES=gpu
)

rem Containers first, with their unnamed volumes (the AI service's checkpoints mount, MinIO's /certs, the key-file
rem helper's /data/db): "down" keeps those, so every start used to leave 3 behind (2026-11-21). Named volumes, the
rem data, are never removed by this.
docker compose%ENV_ARGS% --profile cpu --profile gpu rm -s -f -v
docker compose%ENV_ARGS% --profile %COMPOSE_PROFILES% down
docker compose%ENV_ARGS% down --remove-orphans

if errorlevel 1 (
    echo.
    echo ERROR: Failed to stop services!
    echo Make sure Docker Desktop is running.
    if not defined NO_PAUSE pause
    exit /b 1
)

echo.
echo ========================================
echo VisHeart Services Stopped
echo ========================================
echo.
echo All containers have been stopped and removed.
echo Data in volumes is preserved.
echo.
echo To remove all data (including volumes), run:
echo   docker compose down -v
echo.
if not defined NO_PAUSE pause
exit /b 0

:stop_training_service
echo Stopping the UNet Extend Training service...
call "%WORKER_STOP%"
if errorlevel 2 (
    echo UNet Extend Training is not set up on this computer; skipping it.
    exit /b 0
)
if not errorlevel 1 exit /b 0
rem Exit 1: a training is in progress, and the service refused to stop.
set "ANSWER=%STOP_TRAINING%"
if not defined ANSWER (
    choice /C YN /T 60 /D N /M "A training is in progress. Stop it too? A stopped training cannot be resumed"
    if errorlevel 2 (set "ANSWER=no") else (set "ANSWER=yes")
)
if /I "%ANSWER%"=="yes" (
    call "%WORKER_STOP%" --force
) else (
    echo The training keeps running on this computer. Its next steps that need VisHeart's containers will fail
    echo while VisHeart is stopped. Stop it later with visheart-retraining\stop-retraining-worker.bat --force.
)
exit /b 0
