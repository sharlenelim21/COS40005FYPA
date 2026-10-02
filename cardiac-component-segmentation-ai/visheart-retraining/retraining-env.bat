@echo off
rem Finds this computer's training setup for start- and stop-retraining-worker.bat (call it after setlocal).
rem retraining.local.bat, written by setup-training-pc.ps1 and never committed, names the data folder and the Python
rem environment. Without it: a .venv beside this script, then this repository's original computer (E:\Jy\Unet).
if exist "%~dp0retraining.local.bat" call "%~dp0retraining.local.bat"
if not defined VISHEART_RETRAINING_VENV if exist "%~dp0.venv\Scripts\python.exe" set "VISHEART_RETRAINING_VENV=%~dp0.venv"
if not defined VISHEART_RETRAINING_VENV set "VISHEART_RETRAINING_VENV=E:\Jy\Unet\.venv"
set "VENV=%VISHEART_RETRAINING_VENV%\Scripts"
if defined VISHEART_UNET_ROOT (set "TRAINING_DATA=%VISHEART_UNET_ROOT%") else (set "TRAINING_DATA=E:\Jy\Unet")
