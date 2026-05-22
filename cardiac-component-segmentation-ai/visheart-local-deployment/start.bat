@echo off
REM VisHeart Launcher - Bypasses PowerShell Execution Policy
REM Usage:
REM   start.bat            (auto-detect GPU vs CPU)
REM   start.bat --cpu      (force CPU profile, skip GPU detection)
REM   start.bat --gpu      (force GPU profile, skip GPU detection)

echo ========================================
echo VisHeart Launcher
echo ========================================
echo.

set "PS_ARGS="
if /I "%~1"=="--cpu" set "PS_ARGS=-ForceCpu"
if /I "%~1"=="--gpu" set "PS_ARGS=-ForceGpu"

powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0start.ps1" %PS_ARGS%

if errorlevel 1 (
    echo.
    echo Error: Failed to start VisHeart
    pause
)
