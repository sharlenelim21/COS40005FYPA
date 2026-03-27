from contextlib import asynccontextmanager
import os
import logging
from fastapi import FastAPI

# Import your model handlers
from classes.yolo_handler import YoloHandler
from classes.medsam_handler import MedSamHandler
from classes.fourdreconstruction_handler import FourDReconstructionHandler

# Import logging utilities
from utils.logging_config import log_model_loading, log_startup_complete

# Base model path
MODEL_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "models"))

# Global model instances
yolo_model = None
medsam_model = None
fourd_reconstruction_model = None


@asynccontextmanager
async def yolo_model_lifespan(app: FastAPI):
    """
    Asynchronous context manager for YOLO model initialization and cleanup.

    Args:
        app (FastAPI): The FastAPI application instance.

    Yields:
        None: The main application runs during the yield statement.
    """
    global yolo_model

    # Get model name from environment variable with default fallback
    model_name = os.environ.get(
        "YOLO_MODEL_NAME", "24April2025-single-stage-usethis.pt"
    )

    # Construct absolute path to model file
    model_path = os.path.join(MODEL_DIR, model_name)

    log_model_loading("YOLO", model_path, "starting")
    yolo_model = YoloHandler(model_path)
    log_model_loading("YOLO", model_path, "success")

    # Main application runs during yield
    yield

    # Cleanup on shutdown
    yolo_model = None
    logging.getLogger("visheart").info("🔄 YOLO model unloaded")


@asynccontextmanager
async def medsam_model_lifespan(app: FastAPI):
    """
    Asynchronous context manager for MedSAM model initialization and cleanup.

    Args:
        app (FastAPI): The FastAPI application instance.

    Yields:
        None: The main application runs during the yield statement.
    """
    global medsam_model

    # Get model name from environment variable with default fallback
    model_name = os.environ.get("MEDSAM_MODEL_NAME", "medsam_vit_b.pth")

    # Construct absolute path to model file
    model_path = os.path.join(MODEL_DIR, model_name)

    log_model_loading("MedSAM", model_path, "starting")
    medsam_model = MedSamHandler(model_path)
    log_model_loading("MedSAM", model_path, "success")

    # Main application runs during yield
    yield

    # Cleanup on shutdown
    medsam_model = None
    logging.getLogger("visheart").info("🔄 MedSAM model unloaded")


def get_yolo_model():
    """
    Dependency function to get the loaded YOLO model instance.

    Returns:
        YoloHandler: The initialized YOLO model handler.

    Raises:
        RuntimeError: If the model hasn't been initialized.
    """
    if yolo_model is None:
        raise RuntimeError("YOLO model is not initialized")
    return yolo_model


def get_medsam_model():
    """
    Dependency function to get the loaded MedSAM model instance.

    Returns:
        MedSamHandler: The initialized MedSAM model handler.

    Raises:
        RuntimeError: If the model hasn't been initialized.
    """
    if medsam_model is None:
        raise RuntimeError("MedSAM model is not initialized")
    return medsam_model


@asynccontextmanager
async def fourd_reconstruction_model_lifespan(app: FastAPI):
    """
    Asynchronous context manager for 4D Reconstruction model initialization and cleanup.

    Args:
        app (FastAPI): The FastAPI application instance.

    Yields:
        None: The main application runs during the yield statement.
    """
    global fourd_reconstruction_model

    # Get model name from environment variable with default fallback
    model_name = os.environ.get("FOURD_RECONSTRUCTION_MODEL_NAME", "250.pth")

    # Construct absolute path to model file
    model_path = os.path.join(MODEL_DIR, model_name)

    log_model_loading("4D Reconstruction", model_path, "starting")
    fourd_reconstruction_model = FourDReconstructionHandler(model_path)
    log_model_loading("4D Reconstruction", model_path, "success")

    # Main application runs during yield
    yield

    # Cleanup on shutdown
    fourd_reconstruction_model = None
    logging.getLogger("visheart").info("🔄 4D Reconstruction model unloaded")


def get_fourd_reconstruction_model():
    """
    Dependency function to get the loaded 4D Reconstruction model instance.

    Returns:
        FourDReconstructionHandler: The initialized 4D Reconstruction model handler.

    Raises:
        RuntimeError: If the model hasn't been initialized.
    """
    if fourd_reconstruction_model is None:
        raise RuntimeError("4D Reconstruction model is not initialized")
    return fourd_reconstruction_model
