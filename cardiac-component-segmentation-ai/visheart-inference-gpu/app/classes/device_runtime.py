from __future__ import annotations

from typing import Literal, Optional, Dict, Any
import torch

Backend = Literal["cpu", "cuda", "rocm"]


def _detect_backend_from_torch() -> Backend:
    """
    Detect backend based on torch runtime.

    Rules:
    - if torch.cuda.is_available() and torch.version.hip is not None => rocm
    - else if torch.cuda.is_available() and torch.version.cuda is not None => cuda
    - else => cpu
    """
    cuda_available = bool(torch.cuda.is_available())
    hip_version = getattr(torch.version, "hip", None)
    cuda_version = getattr(torch.version, "cuda", None)

    if cuda_available and hip_version is not None:
        return "rocm"
    if cuda_available and cuda_version is not None:
        return "cuda"
    return "cpu"


def get_backend() -> Backend:
    """
    Return active backend: 'cpu' | 'cuda' | 'rocm'
    """
    return _detect_backend_from_torch()


def is_gpu_available() -> bool:
    """
    True if a GPU backend is available (CUDA or ROCm under torch.cuda API).
    """
    return get_backend() in ("cuda", "rocm")


def resolve_device(preferred: str = "auto") -> torch.device:
    """
    Resolve torch device according to preferred mode.

    preferred:
      - 'auto'  : choose GPU if available, else CPU
      - 'cpu'   : force CPU
      - 'cuda'  : force CUDA (NVIDIA), fail if unavailable
      - 'rocm'  : force ROCm (AMD), fail if unavailable
      - 'gpu'   : alias for auto GPU selection
      - any torch-style device string (e.g. 'cuda:0', 'cpu')

    Returns:
      torch.device
    """
    mode = (preferred or "auto").strip().lower()
    backend = get_backend()

    if mode in ("auto", "gpu"):
        return torch.device("cuda" if is_gpu_available() else "cpu")

    if mode == "cpu":
        return torch.device("cpu")

    if mode == "cuda":
        if backend != "cuda":
            raise RuntimeError(
                f"Preferred device 'cuda' requested, but detected backend is '{backend}'."
            )
        return torch.device("cuda")

    if mode == "rocm":
        if backend != "rocm":
            raise RuntimeError(
                f"Preferred device 'rocm' requested, but detected backend is '{backend}'."
            )
        # ROCm still uses torch 'cuda' device namespace
        return torch.device("cuda")

    # fallback: allow explicit torch device strings like "cuda:0", "cpu"
    try:
        return torch.device(mode)
    except Exception as exc:
        raise ValueError(f"Unsupported preferred device mode: '{preferred}'") from exc


def safe_empty_cache(device: Optional[torch.device] = None) -> None:
    """
    Safely empty GPU cache.
    - No-op on CPU.
    """
    try:
        if is_gpu_available():
            torch.cuda.empty_cache()
            # ipc_collect may not be supported on all builds, guard it
            if hasattr(torch.cuda, "ipc_collect"):
                torch.cuda.ipc_collect()
    except Exception:
        # intentionally swallow to keep cleanup safe
        pass


def safe_synchronize(device: Optional[torch.device] = None) -> None:
    """
    Safely synchronize GPU.
    - No-op on CPU.
    """
    try:
        if is_gpu_available():
            torch.cuda.synchronize()
    except Exception:
        pass


def safe_memory_stats(device: Optional[torch.device] = None) -> Dict[str, Any]:
    """
    Return memory stats in bytes.
    Returns zeros/no-op values on CPU.

    Keys:
      - allocated_bytes
      - reserved_bytes
      - max_allocated_bytes
      - max_reserved_bytes
      - backend
      - gpu_available
    """
    backend = get_backend()

    if backend == "cpu":
        return {
            "allocated_bytes": 0,
            "reserved_bytes": 0,
            "max_allocated_bytes": 0,
            "max_reserved_bytes": 0,
            "backend": backend,
            "gpu_available": False,
        }

    try:
        allocated = int(torch.cuda.memory_allocated())
        reserved = int(torch.cuda.memory_reserved())

        # max_memory_reserved may not exist in very old versions
        max_allocated = int(torch.cuda.max_memory_allocated())
        max_reserved = (
            int(torch.cuda.max_memory_reserved())
            if hasattr(torch.cuda, "max_memory_reserved")
            else reserved
        )

        return {
            "allocated_bytes": allocated,
            "reserved_bytes": reserved,
            "max_allocated_bytes": max_allocated,
            "max_reserved_bytes": max_reserved,
            "backend": backend,
            "gpu_available": True,
        }
    except Exception:
        # fallback-safe result even if cuda APIs fail unexpectedly
        return {
            "allocated_bytes": 0,
            "reserved_bytes": 0,
            "max_allocated_bytes": 0,
            "max_reserved_bytes": 0,
            "backend": backend,
            "gpu_available": is_gpu_available(),
        }