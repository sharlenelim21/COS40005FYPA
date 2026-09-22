#!/bin/bash
# Check for required model files before building Docker image

MODEL_DIR="./app/models"
MISSING_FILES=0

# Check if directory exists
if [ ! -d "$MODEL_DIR" ]; then
    echo "ERROR: Models directory not found: $MODEL_DIR"
    echo "Creating directory..."
    mkdir -p "$MODEL_DIR"
    MISSING_FILES=1
fi

# Check MedSAM model
if [ -f "$MODEL_DIR/medsam_vit_b.pth" ]; then
    echo "OK: MedSAM model found: medsam_vit_b.pth"
else
    echo "ERROR: MedSAM model not found at $MODEL_DIR/medsam_vit_b.pth"
    MISSING_FILES=1
fi

# Check YOLO model
if [ -f "$MODEL_DIR/24April2025-single-stage-usethis.engine" ]; then
    echo "OK: YOLO model found: 24April2025-single-stage-usethis.engine"
else
    echo "ERROR: YOLO model not found at $MODEL_DIR/24April2025-single-stage-usethis.engine"
    MISSING_FILES=1
fi

# Check landmark model (architecture + both checkpoints, copied in from the
# sibling UNETRESNET34 repo by build.ps1/build.sh -- see the Dockerfile's
# COPY comment). Runs AFTER that COPY, so a missing file here means staging
# didn't happen, not just that the check ran too early.
LANDMARK_DIR="/app/UNETRESNET34"
if [ -f "$LANDMARK_DIR/models/unet_resnet34.py" ]; then
    echo "OK: Landmark architecture found: models/unet_resnet34.py"
else
    echo "ERROR: Landmark architecture not found at $LANDMARK_DIR/models/unet_resnet34.py"
    MISSING_FILES=1
fi

if [ -f "$LANDMARK_DIR/checkpoints/best_model_2ch.pth" ]; then
    echo "OK: Landmark 2ch checkpoint found: best_model_2ch.pth"
else
    echo "ERROR: Landmark 2ch checkpoint not found at $LANDMARK_DIR/checkpoints/best_model_2ch.pth — landmark detection will not work"
    MISSING_FILES=1
fi

if [ -f "$LANDMARK_DIR/checkpoints/best_model_1ch.pth" ]; then
    echo "OK: Landmark 1ch checkpoint found: best_model_1ch.pth"
else
    echo "WARNING: Landmark 1ch checkpoint not found at $LANDMARK_DIR/checkpoints/best_model_1ch.pth — MRI-only fallback will use the 2ch model instead"
fi

# Prompt to continue or abort
if [ $MISSING_FILES -eq 1 ]; then
    echo ""
    echo "WARNING: Missing model files detected."
    read -p "Do you want to continue with the Docker build anyway? (y/n): " choice
    if [[ "$choice" != "y" && "$choice" != "Y" ]]; then
        echo "Docker build aborted."
        exit 1
    fi
    echo "Continuing with Docker build despite missing files..."
fi

echo "Proceeding with Docker build..."