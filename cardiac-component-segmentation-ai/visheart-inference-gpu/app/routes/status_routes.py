from fastapi import APIRouter
from fastapi.responses import FileResponse
import os
import subprocess

router = APIRouter()

def get_gpu_status():
    """
    Retrieves the status and details of the GPU using the `nvidia-smi` command.

    Returns:
        dict: A dictionary containing the following keys:
            - gpu_name (str): The name of the GPU.
            - architecture (str): The compute capability (architecture) of the GPU.
            - cuda_version (str or None): The CUDA version installed, or None if not found.
            - memory_total_mb (int): Total GPU memory in megabytes.
            - memory_used_mb (int): Used GPU memory in megabytes.
            - gpu_utilization_percent (int): GPU utilization percentage.
            - status (str): "ok" if GPU utilization is below 90%, otherwise "busy".
            - error (str, optional): Error message if an exception occurs.

    Raises:
        Exception: If any subprocess call fails or outputs unexpected results.
    """
    try:
        # Get basic GPU memory and utilization info
        result_basic = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.used,utilization.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        output_basic = result_basic.stdout.strip()
        parts = output_basic.split(", ")
        gpu_name = parts[0]
        memory_total, memory_used, utilization = map(int, parts[1:])

        # Get GPU architecture info
        result_arch = subprocess.run(
            ["nvidia-smi", "--query-gpu=compute_cap", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            check=True,
        )
        architecture = result_arch.stdout.strip()

        # Get CUDA version
        result_cuda = subprocess.run(
            ["nvidia-smi", "--query", "--display=COMPUTE"],
            capture_output=True,
            text=True,
            check=True,
        )
        cuda_output = result_cuda.stdout
        cuda_version = None
        for line in cuda_output.split("\n"):
            if "CUDA Version" in line:
                cuda_version = line.split(":")[1].strip()
                break

        return {
            "gpu_name": gpu_name,
            "architecture": architecture,
            "cuda_version": cuda_version,
            "memory_total_mb": memory_total,
            "memory_used_mb": memory_used,
            "gpu_utilization_percent": utilization,
            "status": "ok" if utilization < 90 else "busy",
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


@router.get("/gpu")
def gpu_status():
    """
    Endpoint to check the health status of the GPU.

    Returns:
        dict: A dictionary containing the overall status and detailed GPU status.
            - "status": A string indicating the overall health status ("ok" or "degraded").
            - "gpu": A dictionary with detailed GPU status information retrieved from `get_gpu_status()`.
    """
    gpu_status = get_gpu_status()
    return {
        "status": "ok" if gpu_status.get("status") == "ok" else "degraded",
        "gpu": gpu_status,
    }


# SERVER STATUS

import psutil
import platform
from datetime import datetime

@router.get("/server")
def server_status():
    """
    Endpoint to check the health status of the server.
    
    Returns:
        dict: A dictionary containing server health metrics:
            - "status": Overall server status ("ok" or "degraded")
            - "cpu": CPU usage information
            - "memory": Memory usage information
            - "disk": Disk usage information 
            - "system": General system information
            - "timestamp": Current server time
    """
    try:
        # Get CPU information
        cpu_percent = psutil.cpu_percent(interval=1)
        cpu_count = psutil.cpu_count(logical=True)
        
        # Get memory information
        memory = psutil.virtual_memory()
        memory_total_gb = round(memory.total / (1024**3), 2)
        memory_used_gb = round(memory.used / (1024**3), 2)
        memory_percent = memory.percent
        
        # Get disk information
        disk = psutil.disk_usage('/')
        disk_total_gb = round(disk.total / (1024**3), 2)
        disk_used_gb = round(disk.used / (1024**3), 2)
        disk_percent = disk.percent
        
        # Get system information
        boot_time = datetime.fromtimestamp(psutil.boot_time()).strftime("%Y-%m-%d %H:%M:%S")
        uptime_seconds = (datetime.now() - datetime.fromtimestamp(psutil.boot_time())).total_seconds()
        uptime_days = round(uptime_seconds / (60 * 60 * 24), 2)
        
        # Determine overall status
        status = "ok"
        if cpu_percent > 90 or memory_percent > 90 or disk_percent > 90:
            status = "degraded"
            
        return {
            "status": status,
            "cpu": {
                "usage_percent": cpu_percent,
                "core_count": cpu_count,
                "status": "ok" if cpu_percent < 90 else "high"
            },
            "memory": {
                "total_gb": memory_total_gb,
                "used_gb": memory_used_gb,
                "usage_percent": memory_percent,
                "status": "ok" if memory_percent < 90 else "high"
            },
            "disk": {
                "total_gb": disk_total_gb,
                "used_gb": disk_used_gb,
                "usage_percent": disk_percent,
                "status": "ok" if disk_percent < 90 else "high"
            },
            "system": {
                "platform": platform.system(),
                "release": platform.release(),
                "boot_time": boot_time,
                "uptime_days": uptime_days
            },
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


@router.get("/environment")
def environment_status():
    """
    Endpoint to check the current environment configuration.
    
    Returns:
        dict: A dictionary containing environment information:
            - "env_type": Current environment type (development/production)
            - "authentication": Authentication status
            - "debug_routes": Whether debug routes are enabled
            - "models": Model configuration
    """
    try:
        env_type = os.getenv("ENV_TYPE", "production")
        
        return {
            "status": "ok",
            "environment": {
                "env_type": env_type,
                "authentication": "bypassed" if env_type == "development" else "required",
                "debug_routes": env_type == "development",
                "auth_configured": all([
                    os.getenv("GPU_ACCESS_SECRET"),
                    os.getenv("SERVER_USERNAME"),
                    os.getenv("ALLOWED_NODE_USERNAME")
                ])
            },
            "models": {
                "yolo_model": os.getenv("YOLO_MODEL_NAME", "not_set"),
                "medsam_model": os.getenv("MEDSAM_MODEL_NAME", "not_set"),
                "fourd_reconstruction_model": os.getenv("FOURD_RECONSTRUCTION_MODEL_NAME", "not_set")
            },
            "api": {
                "version": "v2",
                "4d_reconstruction_endpoint": "/inference/v2/4d-reconstruction",
                "phase1_features": [
                    "4d_nifti_detection", 
                    "ed_frame_selection", 
                    "parameter_validation",
                    "backward_compatibility"
                ]
            }
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}