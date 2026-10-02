#!/usr/bin/env bash
# Starts the UNet Extend Training service in the background, on Linux (plan WS13; linux-and-cpu-support).
# Closing the browser never stops a training; stopping this service does (stop-retraining-worker.sh).
# Pass --simulate to test the page without training anything.
#
# VISHEART_UNET_ROOT   the data root (default ~/visheart-unet); the Python environment is its .venv
# VISHEART_PYTHON      another Python to use
# VISHEART_WORKER_ALSO_LISTEN   addresses to serve besides 127.0.0.1 (default: the Docker bridge's gateway, which is
#                      where containers reach the host through host.docker.internal)
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export VISHEART_UNET_ROOT="${VISHEART_UNET_ROOT:-$HOME/visheart-unet}"
PY="${VISHEART_PYTHON:-$VISHEART_UNET_ROOT/.venv/bin/python}"
if [ ! -x "$PY" ]; then
  echo "The training service is not set up on this computer: $PY was not found."
  exit 2
fi
if "$PY" "$HERE/worker.py" --check-running >/dev/null 2>&1; then
  echo "The training service is already running:"
  "$PY" "$HERE/worker.py" --check-running
  exit 0
fi
also="${VISHEART_WORKER_ALSO_LISTEN-$(${DOCKER:-docker} network inspect bridge \
  --format '{{range .IPAM.Config}}{{.Gateway}}{{end}}' 2>/dev/null)}"
extra=()
for address in $also; do
  extra+=(--also-listen "$address")
done
mkdir -p "$VISHEART_UNET_ROOT/jobs"
# setsid, and no inherited terminal or pipe: the service outlives this shell, and a caller reading this script's
# output is not kept waiting until the service stops.
setsid "$PY" "$HERE/worker.py" "$@" "${extra[@]}" </dev/null >/dev/null 2>&1 &
if ! "$PY" "$HERE/worker.py" --wait-running 30; then
  echo "The training service did not start. See $VISHEART_UNET_ROOT/jobs/worker.log"
  exit 1
fi
served="http://127.0.0.1:8010"
for address in $also; do
  # Asked is not served: say only what answers (the worker logs an address it could not use).
  if "$PY" -c 'import sys, urllib.request
urllib.request.urlopen(urllib.request.Request("http://%s:8010/health" % sys.argv[1],
                       headers={"Host": "host.docker.internal:8010"}), timeout=2)' "$address" >/dev/null 2>&1; then
    served="$served and http://$address:8010"
  else
    echo "Warning: the training service could not serve $address, so containers may not reach it."          "See $VISHEART_UNET_ROOT/jobs/worker.log"
  fi
done
echo "The training service is running on $served ."
