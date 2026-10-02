#!/usr/bin/env bash
# Stops the UNet Extend Training service. While a training runs it refuses; add --force to stop anyway, which ends
# the training's commands too (plan WS13; linux-and-cpu-support).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export VISHEART_UNET_ROOT="${VISHEART_UNET_ROOT:-$HOME/visheart-unet}"
PY="${VISHEART_PYTHON:-$VISHEART_UNET_ROOT/.venv/bin/python}"
if [ ! -x "$PY" ]; then
  echo "The training service is not set up on this computer: $PY was not found."
  exit 2
fi
exec "$PY" "$HERE/worker.py" --stop "$@"
