@echo off
REM VisHeart Stop Script
REM Stops all Docker containers

echo ========================================
echo Stopping VisHeart Services
echo ========================================
echo.

cd /d "%~dp0"

echo Detecting hardware capabilities...
set COMPOSE_PROFILES=cpu
where nvidia-smi >nul 2>nul
if %errorlevel% equ 0 (
    set COMPOSE_PROFILES=gpu
)

docker-compose --profile %COMPOSE_PROFILES% down

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
