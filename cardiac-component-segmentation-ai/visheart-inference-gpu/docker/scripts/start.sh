#!/bin/bash

# This script is used to start the FastAPI server for the visheart project
# and is intended to be called from the Docker Container.

set -e  # Exit immediately if a command exits with a non-zero status.

echo "[INFO] Visheart application starting..."

# Check if python3 is available in the PATH and is executable
if ! command -v python3 &> /dev/null
then
    echo "[ERROR] python3 could not be found. Please ensure it's installed and in the PATH."
    # As a fallback, check for 'python' if 'python3' is not found.
    # This might be relevant in some base images or venv setups, though python3 is standard.
    if ! command -v python &> /dev/null
    then
        echo "[ERROR] python also could not be found. Cannot proceed."
        exit 1
    else
        echo "[INFO] Found 'python'. Will attempt to use it."
        PYTHON_EXEC="python"
    fi
else
    echo "[INFO] Found 'python3'. Will use it."
    PYTHON_EXEC="python3"
fi

# Verify that the Python executable is indeed from the virtual environment (optional check, good for debugging)
echo "[INFO] Using Python interpreter at: $(command -v $PYTHON_EXEC)"
echo "[INFO] Python version: $($PYTHON_EXEC --version)"

# Check if the main application script exists
APP_SCRIPT="start_server.py"
if [ ! -f "$APP_SCRIPT" ]; then
    echo "[ERROR] Application script '$APP_SCRIPT' not found in the current directory ($(pwd))."
    echo "[INFO] Listing directory contents:"
    ls -la
    exit 1
fi

echo "[INFO] Starting FastAPI server using '$APP_SCRIPT'..."
# Execute the Python script.
# The 'exec' command replaces the shell process with the Python process.
exec $PYTHON_EXEC "$APP_SCRIPT"

# If exec fails for some reason (e.g., script not executable, though python handles this),
# the script would exit here due to 'set -e'.
# Adding an explicit error message for clarity if exec itself fails before running python.
echo "[ERROR] Failed to execute '$PYTHON_EXEC $APP_SCRIPT'."
exit 1
