@echo off
rem Stops the UNet Extend Training service. While a training runs it refuses; add --force to stop anyway (plan WS13).
setlocal
set "VENV=E:\Jy\Unet\.venv\Scripts"
"%VENV%\python.exe" "%~dp0worker.py" --stop %*
endlocal
