@echo off
REM VisHeart Root Stop Script
REM Automatically navigates to visheart-local-deployment and stops all services

echo ========================================
echo VisHeart Stop Launcher
echo ========================================
echo.
echo Stopping VisHeart from root directory...
echo Navigating to visheart-local-deployment...
echo.

cd /d "%~dp0visheart-local-deployment"

if not exist "stop.bat" (
    echo ERROR: visheart-local-deployment\stop.bat not found!
    echo Please ensure you are running this from the monorepo root directory.
    pause
    exit /b 1
)

call stop.bat

if errorlevel 1 (
    echo.
    echo Error: Failed to stop VisHeart
    pause
    exit /b 1
)
