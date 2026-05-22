#!/bin/bash
# Check for required model files before building Docker image

MODEL_DIR="./app/models"
MISSING_FILES=0

# Check if directory exists
if [ ! -d "$MODEL_DIR" ]; then
<<<<<<< HEAD
    echo "❌ ERROR: Models directory not found: $MODEL_DIR"
=======
    echo "ERROR: Models directory not found: $MODEL_DIR"
>>>>>>> backup-finalsprint3
    echo "Creating directory..."
    mkdir -p "$MODEL_DIR"
    MISSING_FILES=1
fi

# Check MedSAM model
if [ -f "$MODEL_DIR/medsam_vit_b.pth" ]; then
<<<<<<< HEAD
    echo "✅ MedSAM model found: medsam_vit_b.pth"
else
    echo "❌ ERROR: MedSAM model not found at $MODEL_DIR/medsam_vit_b.pth"
=======
    echo "OK: MedSAM model found: medsam_vit_b.pth"
else
    echo "ERROR: MedSAM model not found at $MODEL_DIR/medsam_vit_b.pth"
>>>>>>> backup-finalsprint3
    MISSING_FILES=1
fi

# Check YOLO model
if [ -f "$MODEL_DIR/24April2025-single-stage-usethis.engine" ]; then
<<<<<<< HEAD
    echo "✅ YOLO model found: 24April2025-single-stage-usethis.engine"
else
    echo "❌ ERROR: YOLO model not found at $MODEL_DIR/24April2025-single-stage-usethis.engine"
=======
    echo "OK: YOLO model found: 24April2025-single-stage-usethis.engine"
else
    echo "ERROR: YOLO model not found at $MODEL_DIR/24April2025-single-stage-usethis.engine"
>>>>>>> backup-finalsprint3
    MISSING_FILES=1
fi

# Prompt to continue or abort
if [ $MISSING_FILES -eq 1 ]; then
    echo ""
<<<<<<< HEAD
    echo "⚠️  WARNING: Missing model files detected."
=======
    echo "WARNING: Missing model files detected."
>>>>>>> backup-finalsprint3
    read -p "Do you want to continue with the Docker build anyway? (y/n): " choice
    if [[ "$choice" != "y" && "$choice" != "Y" ]]; then
        echo "Docker build aborted."
        exit 1
    fi
    echo "Continuing with Docker build despite missing files..."
fi

echo "Proceeding with Docker build..."