@echo off
REM VisHeart Stop Script
REM Stops the UNet Extend Training service (when this computer has it), then all Docker containers.
REM While a training runs it asks first; set STOP_TRAINING=yes or STOP_TRAINING=no to answer in advance.

echo ========================================
echo Stopping VisHeart Services
echo ========================================
echo.

cd /d "%~dp0"

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

docker-compose --profile %COMPOSE_PROFILES% down
docker-compose down --remove-orphans

if errorlevel 1 (
    echo.
    echo ERROR: Failed to stop services!
    echo Make sure Docker Desktop is running.
    pause
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
echo   docker-compose down -v
echo.
pause
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
