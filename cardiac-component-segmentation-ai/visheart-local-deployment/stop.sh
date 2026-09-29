#!/usr/bin/env bash
# Stops the VisHeart containers on Linux (Windows: stop.bat). Data in volumes is kept. The UNet Extend Training
# service is left running, as on Windows: stop it with ../visheart-retraining/stop-retraining-worker.sh.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")"
DOCKER="${DOCKER:-docker}"
echo "Stopping VisHeart services..."
for profile in gpu cpu; do
  $DOCKER compose --profile "$profile" down
done
$DOCKER compose down --remove-orphans || { echo "ERROR: failed to stop the services. Is Docker running?"; exit 1; }
echo "All containers have been stopped and removed. Data in volumes is preserved."
echo "To remove all data (including volumes), run: docker compose down -v"
