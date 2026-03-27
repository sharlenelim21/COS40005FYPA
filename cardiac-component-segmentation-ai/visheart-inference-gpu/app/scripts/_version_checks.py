# This standalone script checks for the presence of required Python packages and their versions.
# It also checks if CUDA is available in PyTorch.

import importlib
import sys

REQUIRED_PACKAGES = [
    ("torch", "PyTorch"),
    ("torchvision", "TorchVision"),
    ("ultralytics", "Ultralytics"),
    ("cv2", "OpenCV"),
    ("numpy", "NumPy"),
    ("pandas", "Pandas"),
    ("scipy", "SciPy"),
    ("matplotlib", "Matplotlib"),
    ("psutil", "psutil"),
    ("fastapi", "FastAPI"),
    ("networkx", "NetworkX"),
    ("pydantic", "Pydantic"),
    ("statsmodels", "Statsmodels"),
    ("seaborn", "Seaborn"),
    ("PIL", "Pillow"),
    ("requests", "Requests"),
    ("tqdm", "tqdm"),
    ("uvicorn", "Uvicorn"),
    ("yaml", "PyYAML"),
]

def check_package(module_name, display_name):
    try:
        mod = importlib.import_module(module_name)
        version = getattr(mod, "__version__", "unknown")
        print(f"{display_name} ({module_name}) is installed, version: {version}")
    except ImportError:
        print(f"{display_name} ({module_name}) is NOT installed.", file=sys.stderr)

def check_cuda():
    try:
        torch = importlib.import_module("torch")
        if hasattr(torch, "cuda") and torch.cuda.is_available():
            print("CUDA is available and enabled in PyTorch.")
        else:
            print("CUDA is NOT available in PyTorch.", file=sys.stderr)
    except ImportError:
        print("PyTorch is not installed; cannot check CUDA.", file=sys.stderr)

if __name__ == "__main__":
    print("Checking required Python packages...\n")
    for module, name in REQUIRED_PACKAGES:
        check_package(module, name)
    print("\nChecking CUDA availability...\n")
    check_cuda()