@echo off
rem Stops the UNet Extend Training service. While a training runs it refuses; add --force to stop anyway (plan WS13).
rem Exit codes: 0 stopped or not running, 1 refused because a training is in progress, 2 not set up here.
setlocal
call "%~dp0retraining-env.bat"
if not exist "%VENV%\python.exe" (
  echo The training service is not set up on this computer: %VENV% was not found.
  echo To set it up, see SETUP-ANOTHER-PC.md in visheart-retraining.
  exit /b 2
)
"%VENV%\python.exe" "%~dp0worker.py" --stop %*
exit /b %ERRORLEVEL%
