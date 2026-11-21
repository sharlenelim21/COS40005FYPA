@echo off
rem Finds this computer's training setup for start- and stop-retraining-worker.bat (call it after setlocal).
rem retraining.local.bat, written by setup-training-pc.ps1 and never committed, names the data folder and the Python
rem environment. Without it: the training data folder beside these scripts (visheart-training-data, where the
rem installer puts the pack, wherever VisHeart is installed) and a .venv beside this script.
if exist "%~dp0retraining.local.bat" call "%~dp0retraining.local.bat"
if not defined VISHEART_UNET_ROOT for %%I in ("%~dp0..\visheart-training-data") do set "VISHEART_UNET_ROOT=%%~fI"
if not defined VISHEART_RETRAINING_VENV set "VISHEART_RETRAINING_VENV=%~dp0.venv"
set "VENV=%VISHEART_RETRAINING_VENV%\Scripts"
set "TRAINING_DATA=%VISHEART_UNET_ROOT%"
