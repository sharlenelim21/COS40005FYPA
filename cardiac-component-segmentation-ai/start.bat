@echo off
REM VisHeart Root Launcher
REM Automatically navigates to visheart-local-deployment and runs the deployment script

echo ========================================
echo VisHeart Launcher
echo ========================================
echo.
echo Starting VisHeart from root directory...
echo Navigating to visheart-local-deployment...
echo.

cd /d "%~dp0visheart-local-deployment"

if not exist "start.bat" (
    echo ERROR: visheart-local-deployment\start.bat not found!
    echo Please ensure you are running this from the monorepo root directory.
    pause
    exit /b 1
)

call start.bat

if errorlevel 1 (
    echo.
    echo Error: Failed to start VisHeart
    pause
    exit /b 1
)
