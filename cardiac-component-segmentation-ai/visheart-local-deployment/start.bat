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

rem Always 64-bit PowerShell: the installer is a 32-bit program, and a start it launches would otherwise run 32-bit,
rem where "Program Files" is "Program Files (x86)" and Docker Desktop is not found. Sysnative exists only there.
set "PS_EXE=powershell.exe"
if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" set "PS_EXE=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"

"%PS_EXE%" -ExecutionPolicy Bypass -NoProfile -File "%~dp0start.ps1" %ARG_CPU% %ARG_GPU% %ARG_OPEN%

if errorlevel 1 (
    echo.
    echo Error: Failed to start VisHeart
    pause
)
