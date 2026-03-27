from fastapi import FastAPI
from contextlib import asynccontextmanager
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv(dotenv_path=".env", override=True)

# Import logging configuration
from utils.logging_config import setup_logging, log_startup_banner

# Class imports
from classes.yolo_handler import YoloHandler

# Route imports
from routes.inference_route import router as inference_router
from routes.status_routes import router as status_router
from routes.inference_route_old import router as inference_router_old

# Import the lifespans (custom dependencies)
# Import the combined lifespan manager
from dependencies.model_init import yolo_model_lifespan, medsam_model_lifespan, fourd_reconstruction_model_lifespan # Updated import

# Import additional logging functions
from utils.logging_config import log_startup_complete

# Composite the lifespans
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Asynchronous context manager for managing the lifespan of the FastAPI application.
    """
    async with yolo_model_lifespan(app):
        async with medsam_model_lifespan(app):
            async with fourd_reconstruction_model_lifespan(app):
                # Log startup completion after all models are loaded
                log_startup_complete()
                # Add more lifespans, sequentially nested depend on load order
                yield


app = FastAPI(lifespan=lifespan)

# Setup logging and environment status
env_type = os.getenv("ENV_TYPE", "production")
logger = setup_logging("INFO", hide_warnings=True)

# Prepare model information for startup banner
models_info = {
    "YOLO": os.getenv("YOLO_MODEL_NAME", "24April2025-single-stage-usethis.pt"),
    "MedSAM": os.getenv("MEDSAM_MODEL_NAME", "medsam_vit_b.pth"),
    "4D Reconstruction": os.getenv("FOURD_RECONSTRUCTION_MODEL_NAME", "250.pth")
}

log_startup_banner(env_type, models_info)

app.include_router(inference_router, prefix="/inference/v2")
app.include_router(status_router, prefix="/status")
# Kept for script compatibility
if env_type == "development":
    logger.info("🔧 Development mode: Including legacy inference routes")
    app.include_router(inference_router_old, prefix="/inference/v1")

# Root endpoint
@app.get("/")
async def root():
    """
    Handles the root endpoint of the application.

    Returns:
        dict: A JSON response containing a humorous message.
    """
    return {
        "message": f"I told my therapist about my trust issues... ...he didn't believe me."
    }
