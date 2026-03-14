@echo off
REM VisHeart Launcher - Bypasses PowerShell Execution Policy
REM This batch file runs start.ps1 without requiring execution policy changes

echo ========================================
echo VisHeart Launcher
echo ========================================
echo.

powershell.exe -ExecutionPolicy Bypass -NoProfile -File "%~dp0start.ps1"

if errorlevel 1 (
    echo.
    echo Error: Failed to start VisHeart
    pause
)
