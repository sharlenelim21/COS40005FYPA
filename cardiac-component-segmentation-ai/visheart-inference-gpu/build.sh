#!/bin/bash
# Build script for the GPU inference image.
#
# Stages the landmark architecture file + both checkpoints from the sibling
# UNETRESNET34 repo into _landmark_assets/ (gitignored, build-time only) so
# the Dockerfile can COPY them into the image. Without this step the
# Dockerfile's COPY fails outright rather than silently shipping an image
# with no landmark detection -- see the Dockerfile's own comment above that
# COPY for the full story.
#
# Usage:
#   ./build.sh              # tags sharlene21/visheart-gpu:latest
#   ./build.sh 1.4.0         # also tags sharlene21/visheart-gpu:1.4.0

set -euo pipefail

TAG="${1:-latest}"
IMAGE_NAME="${IMAGE_NAME:-sharlene21/visheart-gpu}"

echo "========================================"
echo "Building VisHeart GPU Inference Image"
echo "========================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# UNETRESNET34 lives two levels up from this file (a sibling of
# cardiac-component-segmentation-ai/, at the outer repo root) -- same path
# docker-compose.yml's volume mount uses (../../UNETRESNET34 from
# visheart-local-deployment/, which is also two levels above this repo).
LANDMARK_REPO="$SCRIPT_DIR/../../UNETRESNET34"
if [ ! -d "$LANDMARK_REPO" ]; then
    echo "ERROR: UNETRESNET34 not found at $LANDMARK_REPO"
    echo "Landmark detection needs its architecture file + checkpoints from that repo."
    exit 1
fi

ARCH_FILE="$LANDMARK_REPO/models/unet_resnet34.py"
CKPT_2CH="$LANDMARK_REPO/checkpoints/best_model_2ch.pth"
CKPT_1CH="$LANDMARK_REPO/checkpoints/best_model_1ch.pth"

MISSING=0
[ -f "$ARCH_FILE" ] || { echo "ERROR: missing $ARCH_FILE"; MISSING=1; }
[ -f "$CKPT_2CH" ] || { echo "ERROR: missing $CKPT_2CH"; MISSING=1; }
if [ ! -f "$CKPT_1CH" ]; then
    echo "WARNING: $CKPT_1CH not found -- image will fall back to the 2ch model for MRI-only mode."
fi

if [ "$MISSING" -eq 1 ]; then
    echo "Landmark detection would silently be broken in the built image. Aborting."
    exit 1
fi

echo "Staging landmark assets into _landmark_assets/ ..."
rm -rf ./_landmark_assets
mkdir -p ./_landmark_assets/models ./_landmark_assets/checkpoints
cp "$ARCH_FILE" ./_landmark_assets/models/unet_resnet34.py
cp "$CKPT_2CH" ./_landmark_assets/checkpoints/best_model_2ch.pth
[ -f "$CKPT_1CH" ] && cp "$CKPT_1CH" ./_landmark_assets/checkpoints/best_model_1ch.pth
echo "OK: staged $(find ./_landmark_assets -type f | wc -l) file(s)"
echo ""

FULL_IMAGE_NAME="${IMAGE_NAME}:${TAG}"
echo "Building $FULL_IMAGE_NAME ..."
echo "This will take several minutes."
echo ""

if [ "$TAG" = "latest" ]; then
    docker build -t "$FULL_IMAGE_NAME" .
else
    docker build -t "$FULL_IMAGE_NAME" -t "${IMAGE_NAME}:latest" .
fi

echo ""
echo "========================================"
echo "Build Complete!"
echo "========================================"
echo "Image built: $FULL_IMAGE_NAME"
echo "Push with: docker push $FULL_IMAGE_NAME"
