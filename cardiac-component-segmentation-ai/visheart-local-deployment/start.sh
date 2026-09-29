#!/usr/bin/env bash
# VisHeart launcher for Linux (Windows: start.bat / start.ps1). Plan linux-and-cpu-support.
#   ./start.sh          detect an NVIDIA GPU; use the CPU profile without one
#   ./start.sh --cpu    force the CPU profile
#   ./start.sh --gpu    force the GPU profile
# Needs Docker Engine with the compose plugin, and a user in the docker group. DOCKER=... replaces the docker command
# (for testing); WAIT_RETRIES and WAIT_INTERVAL tune the health checks.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")"
export DOCKER="${DOCKER:-docker}"
WAIT_RETRIES="${WAIT_RETRIES:-60}"
WAIT_INTERVAL="${WAIT_INTERVAL:-2}"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
ok() { curl -fsS -m 3 -o /dev/null "$1" 2>/dev/null; }

log "Starting VisHeart startup helper..."
if ! $DOCKER version >/dev/null 2>&1; then
  log "Docker not available. Start the Docker service (and check that you are in the docker group), then try again."
  exit 2
fi

profile=""
case "${1:-}" in
  --cpu) profile=cpu ;;
  --gpu) profile=gpu ;;
esac
if [ -z "$profile" ]; then
  profile=cpu
  if $DOCKER info 2>/dev/null | grep -qi nvidia; then
    log "Detected the NVIDIA runtime; checking that a container can use the GPU."
    if $DOCKER run --rm --gpus all nvidia/cuda:12.3.0-base-ubuntu22.04 nvidia-smi >/dev/null 2>&1; then
      log "Container-level GPU check passed."
      profile=gpu
    else
      log "Container-level GPU check failed."
    fi
  fi
fi

use_profile() {
  profile="$1"
  if [ "$profile" = gpu ]; then
    service=gpu-nvidia; container=visheart-gpu-nvidia; opposite=visheart-gpu-cpu
  else
    service=gpu-cpu; container=visheart-gpu-cpu; opposite=visheart-gpu-nvidia
  fi
}
use_profile "$profile"
log "Selected profile: $profile (container: $container)"
[ "$profile" = cpu ] && log "INFO: no NVIDIA GPU in use. MedSAM is GPU-only and will be unavailable; UNet runs on CPU."

stale="$($DOCKER ps -aq --filter "name=$opposite" 2>/dev/null)"
if [ -n "$stale" ]; then
  log "Removing stale '$opposite' container to avoid port 8001 conflicts."
  $DOCKER rm -f $stale >/dev/null 2>&1
fi

log "Running: docker compose --profile $profile up -d visheart-app $service"
if ! $DOCKER compose --profile "$profile" up -d visheart-app "$service"; then
  log "ERROR: docker compose up failed for the $profile profile."
  if [ "$profile" = gpu ] && [ "${1:-}" != --gpu ]; then
    log "GPU profile startup failed - attempting automatic CPU fallback."
    $DOCKER rm -f visheart-gpu-nvidia >/dev/null 2>&1
    use_profile cpu
    if ! $DOCKER compose --profile cpu up -d visheart-app "$service"; then
      log "ERROR: CPU fallback also failed. Aborting startup."
      exit 5
    fi
    log "CPU fallback succeeded."
  else
    exit 5
  fi
fi

log "Ensuring python symlink exists in backend container..."
$DOCKER exec visheart-local sh -c 'command -v python >/dev/null 2>&1 || ln -sf /usr/bin/python3 /usr/bin/python' \
  >/dev/null 2>&1

# UNet Extend Training runs on this computer, not in Docker: a container cannot start it, so the launcher does.
# Computers without the training setup skip it; the rest of VisHeart does not depend on it.
worker="../visheart-retraining/start-retraining-worker.sh"
if [ -f "$worker" ]; then
  log "Starting the UNet Extend Training service..."
  bash "$worker" 2>&1 | while IFS= read -r line; do log "  $line"; done
  [ "${PIPESTATUS[0]}" -eq 0 ] || log "INFO: UNet Extend Training is unavailable; the rest of VisHeart is not affected."
else
  log "INFO: UNet Extend Training service not found; skipping it."
fi

log "Waiting for services to respond (this may take a minute)..."
backend=false; frontend=false; inference=false; gpu_status=false
for ((i = 1; i <= WAIT_RETRIES; i++)); do
  $backend || { ok http://localhost:5000/ && backend=true; }
  $frontend || { ok http://localhost:3000/ && frontend=true; }
  $inference || { ok http://localhost:8001/status/server && inference=true; }
  if [ "$profile" = gpu ]; then $gpu_status || { ok http://localhost:8001/status/gpu && gpu_status=true; }; else gpu_status=true; fi
  if $backend && $frontend && $inference && $gpu_status; then break; fi
  sleep "$WAIT_INTERVAL"
done

log "Health check summary:"
log "  Backend          (http://localhost:5000/)              => $backend"
log "  Frontend         (http://localhost:3000/)              => $frontend"
log "  Inference server (http://localhost:8001/status/server) => $inference"
[ "$profile" = gpu ] && log "  Inference GPU    (http://localhost:8001/status/gpu)    => $gpu_status"
if $backend && $frontend && $inference && $gpu_status; then
  log "Startup successful."
  log "Open http://localhost:3000 in your browser."
  log "Inference profile: $profile (container: $container)"
  exit 0
fi
log "Startup completed with warnings or failures."
exit 3
