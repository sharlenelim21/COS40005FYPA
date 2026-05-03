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