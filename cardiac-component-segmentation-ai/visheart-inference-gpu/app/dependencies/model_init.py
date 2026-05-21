from contextlib import asynccontextmanager
import os
import logging
import torch
from fastapi import FastAPI

# Import your model handlers
from app.classes.yolo_handler import YoloHandler
from app.classes.medsam_handler import MedSamHandler
from app.classes.fourdreconstruction_handler import FourDReconstructionHandler

# Import logging utilities
from app.utils.logging_config import log_model_loading, log_startup_complete

# Base model path
MODEL_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "models"))

# Global model instances
yolo_model = None
medsam_model = None
fourd_reconstruction_model = None
landmark_model_2ch = None
landmark_model_1ch = None


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
    model_name = os.environ.get("FOURD_RECONSTRUCTION_MODEL_NAME", "fourd_model_epoch_250.pth")

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


@asynccontextmanager
async def landmark_model_lifespan(app: FastAPI):
    """
    Load both UNetResNet34 landmark models at server startup.

    model_2ch — 2-channel BatchNorm model, used when a valid seg mask is present.
    model_1ch — 1-channel BatchNorm model, used as fallback when seg mask is
                missing, invalid, or download failed.

    If best_model_1ch.pth is absent, logs a warning and uses model_2ch as fallback.
    Never crashes the server on missing/broken checkpoint.
    """
    global landmark_model_2ch, landmark_model_1ch

    _log = logging.getLogger("visheart")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    # Import load helper from volume-mounted landmark_inference_api
    try:
        from app.helpers.landmark_inference_api import load_landmark_model
    except Exception as exc:
        _log.error(f"[Landmark] Cannot import load_landmark_model: {exc} — landmark disabled")
        yield
        return

    ckpt_2ch = os.path.join(MODEL_DIR, "best_model.pth")
    ckpt_1ch = os.path.join(MODEL_DIR, "best_model_1ch.pth")

    # Load 2ch model
    _log.info(f"[Landmark] Loading 2ch model from {ckpt_2ch}")
    try:
        from pathlib import Path
        landmark_model_2ch = load_landmark_model(Path(ckpt_2ch), in_channels=2, device=device)
        _log.info("[Landmark] 2ch model loaded OK")
    except Exception as exc:
        _log.error(f"[Landmark] FAILED to load 2ch model: {exc}")
        landmark_model_2ch = None

    # Load 1ch model (optional)
    if os.path.exists(ckpt_1ch):
        _log.info(f"[Landmark] Loading 1ch model from {ckpt_1ch}")
        try:
            from pathlib import Path
            landmark_model_1ch = load_landmark_model(Path(ckpt_1ch), in_channels=1, device=device)
            _log.info("[Landmark] 1ch model loaded OK")
        except Exception as exc:
            _log.warning(f"[Landmark] Could not load 1ch model: {exc} — using 2ch as fallback")
            landmark_model_1ch = landmark_model_2ch
    else:
        _log.warning(f"[Landmark] best_model_1ch.pth not found at {ckpt_1ch} — using 2ch as 1ch fallback")
        landmark_model_1ch = landmark_model_2ch

    # Publish into landmark_inference_api module so run_landmark_inference_from_nifti
    # can access them without reloading from disk on every request
    try:
        import app.helpers.landmark_inference_api as _lm_api
        _lm_api._LOADED_MODEL_2CH = landmark_model_2ch
        _lm_api._LOADED_MODEL_1CH = landmark_model_1ch
        _lm_api._LOADED_DEVICE = device
    except Exception:
        pass

    yield

    # Cleanup
    landmark_model_2ch = None
    landmark_model_1ch = None
    _log.info("[Landmark] Models unloaded")
