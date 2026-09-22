from contextlib import asynccontextmanager
import os
import logging
import threading
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
# Second 4D checkpoint, for the right ventricle. Loading both costs ~17 MB total (the 4D
# checkpoint is 8.69 MB) against MedSAM's 357 MB, so swap-per-request was rejected in favour of
# holding both. Plan task 4.13.
fourd_reconstruction_model_rv = None
landmark_model_2ch = None
landmark_model_1ch = None

_bootstrap_lock = threading.Lock()
_bootstrap_started = False
_bootstrap_finished = False
_bootstrap_errors: dict[str, str] = {}
_bootstrap_status: dict[str, dict[str, str | bool | None]] = {
    "yolo": {"state": "pending", "loaded": False, "error": None},
    "medsam": {"state": "pending", "loaded": False, "error": None},
    "fourd_reconstruction": {"state": "pending", "loaded": False, "error": None},
}


def _set_bootstrap_status(model_key: str, state: str, error: str | None = None) -> None:
    _bootstrap_status[model_key] = {
        "state": state,
        "loaded": state == "loaded",
        "error": error,
    }


def _load_model_safely(model_key: str, model_path: str, loader) -> None:
    logger = logging.getLogger("visheart")
    try:
        log_model_loading(model_key.upper() if model_key != "fourd_reconstruction" else "4D Reconstruction", model_path, "starting")
        logger.info(f"🔄 Bootstrap loading {model_key} from {model_path}")
        loader(model_path)
        _set_bootstrap_status(model_key, "loaded")
        log_model_loading(model_key.upper() if model_key != "fourd_reconstruction" else "4D Reconstruction", model_path, "success")
        logger.info(f"✅ Bootstrap finished loading {model_key}")
    except Exception as exc:
        message = str(exc)
        _bootstrap_errors[model_key] = message
        _set_bootstrap_status(model_key, "error", message)
        log_model_loading(model_key.upper() if model_key != "fourd_reconstruction" else "4D Reconstruction", model_path, "error")
        logger.exception(f"❌ Bootstrap failed while loading {model_key}: {message}")


def _load_landmark_models(logger: logging.Logger) -> None:
    """Load both UNetResNet34 landmark models into module-level globals."""
    global landmark_model_2ch, landmark_model_1ch

    try:
        from app.helpers.landmark_inference_api import load_landmark_model
    except Exception as exc:
        logger.error(f"[Landmark] Cannot import load_landmark_model: {exc} — landmark disabled")
        return

    device = os.getenv("VISHEART_DEVICE", "cpu")

    unetresnet_dir = os.path.join(os.path.dirname(__file__), "..", "..", "UNETRESNET34")
    ckpt_dir = os.path.join(unetresnet_dir, "checkpoints")
    ckpt_2ch = os.path.join(ckpt_dir, "best_model_2ch.pth")
    ckpt_1ch = os.path.join(ckpt_dir, "best_model_1ch.pth")

    # Fall back to env-var paths if the relative path doesn't exist
    if not os.path.exists(ckpt_2ch):
        ckpt_2ch = os.getenv("LANDMARK_MODEL_2CH_PATH", ckpt_2ch)
    if not os.path.exists(ckpt_1ch):
        ckpt_1ch = os.getenv("LANDMARK_MODEL_1CH_PATH", ckpt_1ch)

    if os.path.exists(ckpt_2ch):
        logger.info(f"[Landmark] Loading 2ch model from {ckpt_2ch}")
        try:
            landmark_model_2ch = load_landmark_model(ckpt_2ch, in_channels=2, device=device)
            logger.info("[Landmark] 2ch model loaded OK")
        except Exception as exc:
            logger.error(f"[Landmark] FAILED to load 2ch model: {exc}")
    else:
        logger.error(f"[Landmark] No 2ch checkpoint found at {ckpt_2ch}")

    if os.path.exists(ckpt_1ch):
        logger.info(f"[Landmark] Loading 1ch model from {ckpt_1ch}")
        try:
            landmark_model_1ch = load_landmark_model(ckpt_1ch, in_channels=1, device=device)
            logger.info("[Landmark] 1ch model loaded OK")
        except Exception as exc:
            logger.warning(f"[Landmark] Could not load 1ch model: {exc} — using 2ch as fallback")
            landmark_model_1ch = landmark_model_2ch
    else:
        logger.warning(f"[Landmark] No 1ch checkpoint found at {ckpt_1ch} — using 2ch as fallback")
        landmark_model_1ch = landmark_model_2ch

    # Publish into landmark_inference_api so run_landmark_inference_from_nifti can use them
    try:
        import app.helpers.landmark_inference_api as _lm_api
        _lm_api._LOADED_MODEL_2CH = landmark_model_2ch
        _lm_api._LOADED_MODEL_1CH = landmark_model_1ch
        _lm_api._LOADED_DEVICE = device
    except Exception:
        pass


def start_model_bootstrap() -> None:
    """Start model loading in the background so the server can bind immediately."""
    global _bootstrap_started, _bootstrap_finished

    with _bootstrap_lock:
        if _bootstrap_started:
            return
        _bootstrap_started = True

    def _runner() -> None:
        global yolo_model, medsam_model, fourd_reconstruction_model
        global fourd_reconstruction_model_rv, _bootstrap_finished

        logger = logging.getLogger("visheart")
        logger.info("🚀 Starting background model bootstrap (server will be available immediately)")

        skip_yolo = os.getenv("SKIP_YOLO_MODEL_LOAD", "false").lower() == "true"
        skip_medsam = os.getenv("SKIP_MEDSAM_MODEL_LOAD", "false").lower() == "true"
        skip_fourd = os.getenv("SKIP_FOURD_RECONSTRUCTION_MODEL_LOAD", "false").lower() == "true"

        if skip_yolo:
            _set_bootstrap_status("yolo", "skipped")
            logger.info("ℹ️ Skipping YOLO model load because SKIP_YOLO_MODEL_LOAD=true")
        else:
            model_name = os.environ.get("YOLO_MODEL_NAME", "24April2025-single-stage-usethis.pt")
            model_path = os.path.join(MODEL_DIR, model_name)
            _load_model_safely("yolo", model_path, lambda path: globals().__setitem__("yolo_model", YoloHandler(path)))

        if skip_medsam:
            _set_bootstrap_status("medsam", "skipped")
            logger.info("ℹ️ Skipping MedSAM model load because SKIP_MEDSAM_MODEL_LOAD=true")
        else:
            model_name = os.environ.get("MEDSAM_MODEL_NAME", "medsam_vit_b.pth")
            model_path = os.path.join(MODEL_DIR, model_name)
            _load_model_safely("medsam", model_path, lambda path: globals().__setitem__("medsam_model", MedSamHandler(path)))

        if skip_fourd:
            _set_bootstrap_status("fourd_reconstruction", "skipped")
            logger.info("ℹ️ Skipping 4D Reconstruction model load because SKIP_FOURD_RECONSTRUCTION_MODEL_LOAD=true")
        else:
            model_name = os.environ.get("FOURD_RECONSTRUCTION_MODEL_NAME", "fourd_model_epoch_250.pth")
            model_path = os.path.join(MODEL_DIR, model_name)
            _load_model_safely("fourd_reconstruction", model_path, lambda path: globals().__setitem__("fourd_reconstruction_model", FourDReconstructionHandler(path)))

            # RV checkpoint, optional. Absent means RV reconstruction is simply unavailable and
            # every LV path behaves exactly as before -- so this can be deployed before the
            # checkpoint is in place. The RV model shares the LV network architecture (CsLength
            # and CmLength are both 256 in its training specs), so the default specs load it.
            rv_model_name = os.environ.get("FOURD_RV_MODEL_NAME", "")
            if rv_model_name:
                # An absolute path is honoured as-is so the RV checkpoint can live outside this
                # repository. It is a shared team repo and the RV model is still under a
                # production no-go, so committing its weights here would be the wrong signal.
                rv_model_path = (rv_model_name if os.path.isabs(rv_model_name)
                                 else os.path.join(MODEL_DIR, rv_model_name))
                if os.path.isfile(rv_model_path):
                    _load_model_safely(
                        "fourd_reconstruction_rv", rv_model_path,
                        lambda path: globals().__setitem__(
                            "fourd_reconstruction_model_rv", FourDReconstructionHandler(path)))
                else:
                    logger.warning(
                        f"FOURD_RV_MODEL_NAME is set to '{rv_model_name}' but no such file exists "
                        f"at {rv_model_path}; RV reconstruction will be unavailable")
            else:
                logger.info("FOURD_RV_MODEL_NAME not set; RV reconstruction is unavailable")

        # Load landmark models (UNetResNet34 1ch + 2ch)
        _load_landmark_models(logger)

        _bootstrap_finished = True

        if _bootstrap_errors:
            logger.error(f"⚠ Model bootstrap completed with errors: {_bootstrap_errors}")
        else:
            log_startup_complete()

    threading.Thread(target=_runner, name="visheart-model-bootstrap", daemon=True).start()


def get_bootstrap_status() -> dict[str, object]:
    """Return a snapshot of the background bootstrap state."""
    return {
        "started": _bootstrap_started,
        "finished": _bootstrap_finished,
        "errors": dict(_bootstrap_errors),
        "models": {
            "yolo": dict(_bootstrap_status["yolo"]),
            "medsam": dict(_bootstrap_status["medsam"]),
            "fourd_reconstruction": dict(_bootstrap_status["fourd_reconstruction"]),
        },
    }


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

    start_model_bootstrap()

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

    start_model_bootstrap()

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

    start_model_bootstrap()

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


def get_fourd_reconstruction_model_for_chamber(chamber: str = "lv"):
    """Return the 4D handler for a chamber.

    'lv' is the shipped checkpoint and always available. 'rv' requires FOURD_RV_MODEL_NAME to
    point at an RV checkpoint in the model directory; if it does not, this raises rather than
    silently reconstructing an RV request with the LV model, which would return a plausible-looking
    but wrong mesh. Plan task 4.13.
    """
    key = (chamber or "lv").lower()
    if key == "rv":
        if fourd_reconstruction_model_rv is None:
            raise RuntimeError(
                "RV 4D reconstruction was requested but no RV checkpoint is loaded. "
                "Set FOURD_RV_MODEL_NAME to a checkpoint in the model directory and restart.")
        return fourd_reconstruction_model_rv
    return get_fourd_reconstruction_model()


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

    from pathlib import Path

    # Resolve 2ch checkpoint: models dir first, then UNETRESNET34/checkpoints
    _unetresnet_dir = Path("/app/UNETRESNET34")
    _models_dir = Path(MODEL_DIR)

    def _find_ckpt(names_in_models: list, names_in_repo: list) -> Path | None:
        for name in names_in_models:
            p = _models_dir / name
            if p.exists():
                return p
        for name in names_in_repo:
            p = _unetresnet_dir / "checkpoints" / name
            if p.exists():
                return p
        return None

    ckpt_2ch_path = _find_ckpt(["best_model_2ch.pth", "best_model.pth"], ["best_model_2ch.pth"])
    ckpt_1ch_path = _find_ckpt(["best_model_1ch.pth"], ["best_model_1ch.pth"])

    # Load 2ch model
    if ckpt_2ch_path:
        _log.info(f"[Landmark] Loading 2ch model from {ckpt_2ch_path}")
        try:
            landmark_model_2ch = load_landmark_model(ckpt_2ch_path, in_channels=2, device=device)
            _log.info("[Landmark] 2ch model loaded OK")
        except Exception as exc:
            _log.error(f"[Landmark] FAILED to load 2ch model: {exc}")
            landmark_model_2ch = None
    else:
        _log.error("[Landmark] No 2ch checkpoint found in models/ or UNETRESNET34/checkpoints/")
        landmark_model_2ch = None

    # Load 1ch model (optional — falls back to 2ch)
    if ckpt_1ch_path:
        _log.info(f"[Landmark] Loading 1ch model from {ckpt_1ch_path}")
        try:
            landmark_model_1ch = load_landmark_model(ckpt_1ch_path, in_channels=1, device=device)
            _log.info("[Landmark] 1ch model loaded OK")
        except Exception as exc:
            _log.warning(f"[Landmark] Could not load 1ch model: {exc} — using 2ch as fallback")
            landmark_model_1ch = landmark_model_2ch
    else:
        _log.warning("[Landmark] No 1ch checkpoint found — using 2ch as 1ch fallback")
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
