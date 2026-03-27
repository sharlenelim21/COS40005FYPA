"""
Logging configuration for the visheart-inference-gpu application.
"""
import logging
import warnings
import sys
from typing import Optional


def setup_logging(log_level: str = "INFO", hide_warnings: bool = True) -> logging.Logger:
    """
    Configure logging for the application.
    
    Args:
        log_level: The logging level (DEBUG, INFO, WARNING, ERROR)
        hide_warnings: Whether to hide specific warnings
    """
    # Set up basic logging configuration
    logging.basicConfig(
        level=getattr(logging, log_level.upper()),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Get application logger
    logger = logging.getLogger("visheart")
    
    if hide_warnings:
        # Hide specific PyTorch warnings about pickle weights
        warnings.filterwarnings(
            "ignore",
            message=".*torch.load.*weights_only=False.*",
            category=FutureWarning
        )
        
        # Hide weight_norm deprecation warning
        warnings.filterwarnings(
            "ignore",
            message=".*torch.nn.utils.weight_norm.*deprecated.*",
            category=FutureWarning
        )
        
        # Optionally reduce uvicorn logging verbosity
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    
    return logger


def log_startup_banner(env_type: str, models_info: Optional[dict] = None) -> None:
    """
    Log a formatted startup banner with application information.
    
    Args:
        env_type: The environment type (development/production)
        models_info: Dictionary containing model information
    """
    logger = logging.getLogger("visheart")
    
    # Create banner
    banner_width = 80
    banner_char = "="
    
    lines = [
        "",
        banner_char * banner_width,
        "🚀 VISHEART INFERENCE SERVER (0.4.5-beta)STARTING".center(banner_width),
        "",
        f"📍 Environment: {env_type.upper()}".center(banner_width),
    ]
    
    if env_type == "development":
        lines.extend([
            "🔓 Authentication: BYPASSED (development mode)".center(banner_width),
            "🛠️ Debug routes: ENABLED".center(banner_width),
        ])
    else:
        lines.extend([
            "🔒 Authentication: REQUIRED (production mode)".center(banner_width),
            "🛠️ Debug routes: DISABLED".center(banner_width),
        ])
    
    if models_info:
        lines.append("")
        lines.append("📦 MODELS TO LOAD:".center(banner_width))
        for model_type, model_path in models_info.items():
            model_name = model_path.split("/")[-1] if "/" in model_path else model_path
            lines.append(f"   • {model_type}: {model_name}".ljust(banner_width))
    
    lines.extend([
        "",
        banner_char * banner_width,
        ""
    ])
    
    # Log each line
    for line in lines:
        if line.strip():
            logger.info(line)
        else:
            logger.info("")


def log_model_loading(model_type: str, model_path: str, status: str = "starting") -> None:
    """
    Log model loading status with consistent formatting.
    
    Args:
        model_type: Type of model (e.g., "YOLO", "MedSAM", "4D Reconstruction")
        model_path: Path to the model file
        status: Loading status ("starting", "success", "error")
    """
    logger = logging.getLogger("visheart")
    model_name = model_path.split("/")[-1] if "/" in model_path else model_path
    
    if status == "starting":
        logger.info(f"🔄 Loading {model_type} model: {model_name}")
    elif status == "success":
        logger.info(f"✅ {model_type} model loaded successfully")
    elif status == "error":
        logger.error(f"❌ Failed to load {model_type} model: {model_name}")


def log_startup_complete() -> None:
    """Log startup completion message."""
    logger = logging.getLogger("visheart")
    logger.info("🎉 All models loaded successfully - Server is ready!")
    logger.info("=" * 80)