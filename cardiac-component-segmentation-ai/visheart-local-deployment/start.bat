@echo off
REM VisHeart Launcher - Bypasses PowerShell Execution Policy
REM Usage:
REM   start.bat            (auto-detect GPU vs CPU)
REM   start.bat --cpu      (force CPU profile, skip GPU detection)
REM   start.bat --gpu      (force GPU profile, skip GPU detection)
REM   start.bat --open     (the VisHeart desktop icon: open the web page, starting VisHeart first when needed)

echo ========================================
echo VisHeart Launcher
echo ========================================
echo.

set "ARG_CPU="
set "ARG_GPU="
set "ARG_OPEN="
for %%A in (%*) do (
    if /I "%%~A"=="--cpu" set "ARG_CPU=-ForceCpu"
    if /I "%%~A"=="--gpu" set "ARG_GPU=-ForceGpu"
    if /I "%%~A"=="--open" set "ARG_OPEN=-OpenBrowser"
)

powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0start.ps1" %ARG_CPU% %ARG_GPU% %ARG_OPEN%

if errorlevel 1 (
    echo.
    echo Error: Failed to start VisHeart
    pause
)
