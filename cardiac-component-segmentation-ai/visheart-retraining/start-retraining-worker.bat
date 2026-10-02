@echo off
rem Starts the UNet Extend Training service in the background, without a window (plan WS13).
rem Closing the browser never stops a training; stopping this service does (stop-retraining-worker.bat).
rem Pass --simulate to test the page without training anything.
setlocal
set "HERE=%~dp0"
call "%HERE%retraining-env.bat"
if not exist "%VENV%\pythonw.exe" (
  echo The training service is not set up on this computer: %VENV% was not found.
  echo To set it up, see SETUP-ANOTHER-PC.md in visheart-retraining.
  exit /b 2
)
"%VENV%\python.exe" "%HERE%worker.py" --check-running >nul 2>&1
if not errorlevel 1 (
  echo The training service is already running:
  "%VENV%\python.exe" "%HERE%worker.py" --check-running
  exit /b 0
)
rem Start-Process, not "start": "start" hands the service this window's handles, so a caller reading this script's
rem output (start.ps1) would wait until the service stops.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%VENV%\pythonw.exe' -ArgumentList '\"%HERE%worker.py\" %*'"
"%VENV%\python.exe" "%HERE%worker.py" --wait-running 30
if errorlevel 1 (
  echo The training service did not start. See %TRAINING_DATA%\jobs\worker.log
  exit /b 1
)
echo The training service is running on http://127.0.0.1:8010 . You can close this window.
endlocal
