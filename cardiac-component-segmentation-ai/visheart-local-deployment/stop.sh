#!/usr/bin/env bash
# Stops VisHeart on Linux (Windows: stop.bat): the UNet Extend Training service when this computer has it, then the
# containers. Data in volumes is kept. While a training runs it asks first; STOP_TRAINING=yes or no answers in
# advance, and no answer within 60 s keeps the training running.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")"
DOCKER="${DOCKER:-docker}"
echo "Stopping VisHeart services..."

worker="../visheart-retraining/stop-retraining-worker.sh"
if [ -f "$worker" ]; then
  echo "Stopping the UNet Extend Training service..."
  bash "$worker"
  code=$?
  if [ "$code" -eq 2 ]; then
    echo "UNet Extend Training is not set up on this computer; skipping it."
  elif [ "$code" -eq 1 ]; then
    # A training is in progress, and the service refused to stop.
    answer="${STOP_TRAINING:-}"
    if [ -z "$answer" ]; then
      read -r -t 60 -p "A training is in progress. Stop it too? A stopped training cannot be resumed [y/N] " answer \
        || answer=no
      echo
    fi
    case "$answer" in
      [Yy]*) bash "$worker" --force ;;
      *) echo "The training keeps running on this computer. Its next steps that need VisHeart's containers will fail"
         echo "while VisHeart is stopped. Stop it later with ../visheart-retraining/stop-retraining-worker.sh --force." ;;
    esac
  fi
else
  echo "UNet Extend Training service not found; skipping it."
fi

for profile in gpu cpu; do
  $DOCKER compose --profile "$profile" down
done
$DOCKER compose down --remove-orphans || { echo "ERROR: failed to stop the services. Is Docker running?"; exit 1; }
echo "All containers have been stopped and removed. Data in volumes is preserved."
echo "To remove all data (including volumes), run: docker compose down -v"
