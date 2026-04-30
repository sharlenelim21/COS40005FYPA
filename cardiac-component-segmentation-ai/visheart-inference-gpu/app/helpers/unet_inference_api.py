import importlib.util
import os
import time
from typing import Any, Dict, Optional


_cached_unet_module = None


def _resolve_unet_script_path() -> str:
    """
    Resolve UNET inference script path.
    Priority:
    1) UNET_INFERENCE_SCRIPT_PATH env override
    2) Monorepo default path to Cardiac_Segmentation_FYP_Server/src/python/unet_inference.py
    """
    env_path = os.getenv("UNET_INFERENCE_SCRIPT_PATH", "").strip()
    if env_path:
        return env_path

    # Prefer local script inside visheart-inference-gpu container/workspace.
    local_script = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "external_unet_inference.py")
    )
    if os.path.exists(local_script):
        return local_script

    # Fallback to monorepo script path used in some development setups.
    current_dir = os.path.dirname(__file__)
    # app/helpers -> app -> visheart-inference-gpu -> cardiac-component-segmentation-ai
    monorepo_root = os.path.abspath(os.path.join(current_dir, "..", "..", ".."))
    return os.path.join(monorepo_root, "Cardiac_Segmentation_FYP_Server", "src", "python", "unet_inference.py")


def _load_unet_module():
    global _cached_unet_module
    if _cached_unet_module is not None:
        return _cached_unet_module

    script_path = _resolve_unet_script_path()
    print(f"[UNET API] Loading UNET module from script path: {script_path}")
    if not os.path.exists(script_path):
        raise FileNotFoundError(f"UNET inference script not found: {script_path}")

    spec = importlib.util.spec_from_file_location("external_unet_inference", script_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Failed to load UNET inference module from: {script_path}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _cached_unet_module = module
    return module


def run_unet_inference_from_nifti(
    nifti_path: str,
    device: str = "auto",
    checkpoint_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Execute UNET inference and return backend-compatible JSON result.
    Resolves checkpoint path portably: provided path > UNET_CHECKPOINT_PATH env > app/models/unet.pth
    """
    module = _load_unet_module()

    resolved_checkpoint = (checkpoint_path or os.getenv("UNET_CHECKPOINT_PATH", "")).strip()
    if not resolved_checkpoint:
        resolved_checkpoint = os.path.join(os.path.dirname(__file__), "..", "models", "unet.pth")
        resolved_checkpoint = os.path.abspath(resolved_checkpoint)

    print(
        "[UNET API] Inference config: "
        f"model=unet, device={device}, input_nifti={nifti_path}, checkpoint={resolved_checkpoint}"
    )

    # Validate checkpoint exists before passing to inference function
    if not os.path.isfile(resolved_checkpoint):
        return {
            "success": False,
            "error": f"UNet checkpoint file not found at: {resolved_checkpoint}\n"
                     f"Expected location: app/models/unet.pth\n"
                     f"Please follow the setup guide in visheart-inference-gpu/README.md"
        }

    start_time = time.perf_counter()
    print(f"[UNET API] Inference start: model=unet, device={device}")
    result = module.run_model2_inference(
        nifti_path=nifti_path,
        checkpoint_path=resolved_checkpoint,
        device=device,
    )
    elapsed_ms = int((time.perf_counter() - start_time) * 1000)
    print(f"[UNET API] Inference end: model=unet, device={device}, elapsed_ms={elapsed_ms}")
    return result
