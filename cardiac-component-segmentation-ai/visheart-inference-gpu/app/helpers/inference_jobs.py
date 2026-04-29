# File: app/helpers/inference_jobs.py
import asyncio
import httpx
import os, traceback, time, json, tempfile
import re
from enum import Enum
from functools import wraps
from uuid import UUID
from pydantic import HttpUrl, Field
from urllib.parse import urlparse
#import torch
import numpy as np
import base64
from typing import Dict, List, Union, Tuple, Any, TYPE_CHECKING

from fastapi import HTTPException # <-- Add HTTPException

from app.classes.device_runtime import (
    get_backend,
    safe_empty_cache,
    safe_memory_stats,
)

def _extract_frame_index_from_filename(filename: str) -> int | None:
    """Extract frame index from filename like 'patient006_4d_gt_4D_frame02_ED.obj'"""
    match = re.search(r'frame(\d+)', filename)
    return int(match.group(1)) if match else None

if TYPE_CHECKING:
    from app.classes.pydantic_schema import FourDReconstructionJobRequest

# File handler (now needs async usage)
from app.classes.file_fetch_handler import FileFetchHandler

# Model handlers (methods are now async)
from app.classes.yolo_handler import YoloHandler
from app.dependencies.model_init import get_yolo_model

def obj_to_npz_base64(obj_file_path: str) -> str:
    """
    Convert OBJ file to compressed NPZ format and encode as base64
    
    Args:
        obj_file_path: Path to the OBJ file
        
    Returns:
        Base64 encoded NPZ data
    """
    # Parse OBJ file
    vertices = []
    faces = []
    
    with open(obj_file_path, 'r') as f:
        for line in f:
            line = line.strip()
            if line.startswith('v '):
                # Vertex line: v x y z
                coords = list(map(float, line.split()[1:4]))
                vertices.append(coords)
            elif line.startswith('f '):
                # Face line: f v1 v2 v3 (convert to 0-based indexing)
                indices = [int(x.split('/')[0]) - 1 for x in line.split()[1:4]]
                faces.append(indices)
    
    # Convert to numpy arrays
    vertices_array = np.array(vertices, dtype=np.float32)
    faces_array = np.array(faces, dtype=np.int32)
    
    # Save to NPZ in memory
    import io
    npz_buffer = io.BytesIO()
    np.savez_compressed(npz_buffer, vertices=vertices_array, faces=faces_array)
    npz_data = npz_buffer.getvalue()
    
    # Encode as base64
    base64_data = base64.b64encode(npz_data).decode('utf-8')
    
    return base64_data
from app.classes.medsam_handler import MedSamHandler
from app.dependencies.model_init import get_medsam_model
from app.classes.fourdreconstruction_handler import FourDReconstructionHandler
from app.dependencies.model_init import get_fourd_reconstruction_model
from app.helpers.unet_inference_api import run_unet_inference_from_nifti

from app.helpers.inference_helpers import (
    filter_detections, encode_and_name_masks, sort_medsam_results,
)

# Import the new Pydantic models to be used for constructing the result
from app.classes.pydantic_schema import ManualInputBox, ResultPerImageManual


def normalize_unet_result_to_medsam_shape(raw_mask_payload: Any) -> Dict[str, Dict[str, Any]]:
    """
    Normalize UNET output payload to match MedSAM result shape:
    {
        "<filename>.jpg": {
            "boxes": [...],
            "masks": {"rv": "<rle>", ...}
        }
    }
    """
    if not isinstance(raw_mask_payload, dict):
        return {}

    # Already MedSAM-like: keep as-is and normalize order.
    if all(
        isinstance(value, dict) and "boxes" in value and "masks" in value
        for value in raw_mask_payload.values()
    ):
        return sort_medsam_results(raw_mask_payload)

    frames = raw_mask_payload.get("frames")
    if not isinstance(frames, list):
        return {}

    normalized: Dict[str, Dict[str, Any]] = {}
    for frame in frames:
        if not isinstance(frame, dict):
            continue

        frame_idx = frame.get("frameindex", frame.get("frame_index", 0))
        try:
            frame_idx = int(frame_idx)
        except (TypeError, ValueError):
            frame_idx = 0

        slices = frame.get("slices")
        if not isinstance(slices, list):
            continue

        for slice_item in slices:
            if not isinstance(slice_item, dict):
                continue

            slice_idx = slice_item.get("sliceindex", slice_item.get("slice_index", 0))
            try:
                slice_idx = int(slice_idx)
            except (TypeError, ValueError):
                slice_idx = 0

            masks_list = slice_item.get("segmentationmasks")
            if not isinstance(masks_list, list):
                masks_list = []

            masks: Dict[str, str] = {}
            for mask_item in masks_list:
                if not isinstance(mask_item, dict):
                    continue
                class_name = mask_item.get("class")
                rle_value = mask_item.get("segmentationmaskcontents")
                if isinstance(class_name, str) and isinstance(rle_value, str):
                    masks[class_name] = rle_value

            image_key = f"unet_prediction_{frame_idx}_{slice_idx}.jpg"
            normalized[image_key] = {"boxes": [], "masks": masks}

    return sort_medsam_results(normalized)

# Constants
serviceLocation = "Inference Service"
GPU_SEMAPHORE_COUNT = os.getenv("GPU_SEMAPHORE_COUNT", 1) # Default to 1 if not set
# Ensure GPU_SEMAPHORE_COUNT is an int, handle potential ValueError
try:
    gpu_semaphore_count_int = int(GPU_SEMAPHORE_COUNT)
    if gpu_semaphore_count_int <= 0:
        print(f"[{serviceLocation}] WARNING: GPU_SEMAPHORE_COUNT was {gpu_semaphore_count_int}, setting to 1.")
        gpu_semaphore_count_int = 1
except ValueError:
    print(f"[{serviceLocation}] WARNING: Invalid GPU_SEMAPHORE_COUNT '{GPU_SEMAPHORE_COUNT}', setting to 1.")
    gpu_semaphore_count_int = 1
gpu_semaphore = asyncio.Semaphore(gpu_semaphore_count_int)


async def send_callback_with_files(
    callback_url: HttpUrl,
    uuid: UUID,
    success: bool,
    result: dict | None,
    error_detail: str | None,
    mesh_files: List[str] | None = None,
    export_format: str = "obj",
):
    """Sends the processing result back to the client's callback URL with mesh files as multipart/form-data."""
    
    # Determine MIME type based on export format
    mime_type_map = {
        "obj": "model/obj",
        "glb": "model/gltf-binary"
    }
    mesh_mime_type = mime_type_map.get(export_format, "application/octet-stream")
    
    # Prepare JSON metadata (without large base64 data)
    callback_payload = {
        "uuid": str(uuid),
        "status": "completed" if success else "failed",
        "result": result if success else None,
        "error": error_detail if not success else None,
    }
    
    parsed_url = urlparse(str(callback_url))
    host = parsed_url.hostname
    port = parsed_url.port or (443 if parsed_url.scheme == "https" else 80)
    print(f"[{serviceLocation}] Attempting callback to {host}:{port} for job {uuid}")
    
    try:
        if success and mesh_files:
            # Send as multipart/form-data with file attachments
            files = {}
            total_size = 0
            
            # Add JSON metadata as a form field
            files['metadata'] = ('metadata.json', json.dumps(callback_payload), 'application/json')
            
            # Add each mesh file
            for i, mesh_file_path in enumerate(mesh_files):
                if os.path.exists(mesh_file_path):
                    file_size = os.path.getsize(mesh_file_path)
                    total_size += file_size
                    
                    # Generate field name and filename
                    filename = os.path.basename(mesh_file_path)
                    field_name = f'mesh_{i}' if len(mesh_files) > 1 else 'mesh'
                    
                    # Read file content
                    with open(mesh_file_path, 'rb') as f:
                        file_content = f.read()
                    
                    files[field_name] = (filename, file_content, mesh_mime_type)
                    print(f"[{serviceLocation}] Added {filename} ({file_size} bytes, {mesh_mime_type}) to multipart payload")
            
            print(f"[{serviceLocation}] Multipart payload total size: {total_size} bytes ({len(files)} parts)")
            
            headers = {
                "User-Agent": "VisHeart-GPU-Service/1.0",
                "X-Job-ID": str(uuid),
                "X-File-Count": str(len(mesh_files)),
            }
            
            async with httpx.AsyncClient(timeout=60.0) as client:
                start_time = time.time()
                print(f"[{serviceLocation}] Sending multipart callback to {callback_url}")
                
                response = await client.post(
                    str(callback_url),
                    files=files,
                    headers=headers
                )
                
                elapsed = time.time() - start_time
                print(f"[{serviceLocation}] Multipart callback took {elapsed:.2f} seconds")
                print(f"[{serviceLocation}] Callback response status: {response.status_code}")
                print(f"[{serviceLocation}] Callback response headers: {dict(response.headers)}")
                
                response_text = response.text[:500]
                print(f"[{serviceLocation}] Callback response body: {response_text}")
                response.raise_for_status()
                print(f"[{serviceLocation}] Successfully sent multipart callback for job {uuid}")
        else:
            # Fall back to JSON-only for errors or when no files
            await send_callback(callback_url, uuid, success, result, error_detail)
            
    except Exception as e:
        print(f"[{serviceLocation}] Error sending multipart callback: {e}")
        # Fall back to JSON-only callback
        await send_callback(callback_url, uuid, success, result, error_detail)


async def send_callback(
    callback_url: HttpUrl,
    uuid: UUID,
    success: bool,
    result: dict | None,
    error_detail: str | None,
    segmentation_model: str = "medsam",
):
    """Sends the processing result back to the client's callback URL with enhanced error logging."""
    callback_payload = {
        "uuid": str(uuid),  # Convert UUID to string for JSON
        "status": "completed" if success else "failed",
        "result": result if success else None,
        "error": error_detail if not success else None,
        "segmentation_model": segmentation_model,
    }
    parsed_url = urlparse(str(callback_url))
    host = parsed_url.hostname
    port = parsed_url.port or (443 if parsed_url.scheme == "https" else 80)
    print(f"[{serviceLocation}] Attempting callback to {host}:{port} for job {uuid}")
    try:
        payload_size = len(json.dumps(callback_payload))
        print(f"[{serviceLocation}] Callback payload size: {payload_size} bytes")
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "VisHeart-GPU-Service/1.0",
            "X-Job-ID": str(uuid),
        }
        async with httpx.AsyncClient() as client:
            start_time = time.time()
            print(f"[{serviceLocation}] Sending callback to {callback_url}")
            response = await client.post(
                str(callback_url), json=callback_payload, headers=headers
            )
            elapsed = time.time() - start_time
            print(f"[{serviceLocation}] Callback request took {elapsed:.2f} seconds")
            print(
                f"[{serviceLocation}] Callback response status: {response.status_code}"
            )
            print(
                f"[{serviceLocation}] Callback response headers: {dict(response.headers)}"
            )
            response_text = response.text[:500]
            print(f"[{serviceLocation}] Callback response body: {response_text}")
            response.raise_for_status()
            print(f"[{serviceLocation}] Successfully sent callback for job {uuid}")
    except httpx.ConnectError as e:
        print(f"[{serviceLocation}] Connection error for {callback_url}")
        print(f"[{serviceLocation}] Failed to connect to {host}:{port} - {e}")
    except httpx.TimeoutException as e:
        print(f"[{serviceLocation}] Timeout error for {callback_url}: {e}")
        if hasattr(e, "timeout"):
            print(f"[{serviceLocation}] Request timed out after {e.timeout} seconds")
        else:
            print(f"[{serviceLocation}] Request timed out (timeout duration unknown)")
    except httpx.HTTPStatusError as e:
        print(
            f"[{serviceLocation}] HTTP error for {callback_url}: Status {e.response.status_code}"
        )
        print(f"[{serviceLocation}] Response headers: {dict(e.response.headers)}")
        print(
            f"[{serviceLocation}] Response body: {e.response.text[:1000]}"
        )
    except Exception as e:
        error_details = traceback.format_exc()
        print(
            f"[{serviceLocation}] Unexpected error sending callback for job {uuid}: {e}"
        )
        print(f"[{serviceLocation}] Error details: {error_details}")

def log_gpu_status(uuid, stage):
    """Log GPU status for debugging"""
    try:
        backend = get_backend()
        stats = safe_memory_stats()
        mem_allocated = stats["allocated_bytes"] / (1024**2)
        mem_reserved = stats["reserved_bytes"] / (1024**2)
        print(
            f"[{serviceLocation}] Job {uuid} {stage} - backend={backend}, "
            f"Memory: {mem_allocated:.2f}MB allocated, {mem_reserved:.2f}MB reserved"
        )
    except Exception as e:
        print(f"[{serviceLocation}] Job {uuid} {stage} - unable to read memory stats: {e}")

# --- BBox Job (existing async callback version) ---
async def process_bbox_job_with_semaphore(
    input_url: HttpUrl, uuid: UUID, callback_url: HttpUrl, yolo_handler: YoloHandler
):
    print(f"[{serviceLocation}] Job {uuid} waiting for GPU access (bbox)...")
    async with gpu_semaphore:
        print(f"[{serviceLocation}] Job {uuid} acquired GPU access (bbox)")
        log_gpu_status(uuid, "start-bbox")
        try:
            await _process_bbox_job(input_url, uuid, callback_url, yolo_handler)
        finally:
            log_gpu_status(uuid, "end-bbox")
            print(f"[{serviceLocation}] Job {uuid} released GPU access (bbox)")

async def _process_bbox_job(
    input_url: HttpUrl, uuid: UUID, callback_url: HttpUrl, yolo_handler: YoloHandler
):
    print(f"[{serviceLocation}] Starting bbox job {uuid}")
    result = None
    error_detail = None
    success = False
    parsed_url = urlparse(str(input_url))
    if not all([parsed_url.scheme, parsed_url.netloc]):
        error_detail = "Invalid URL provided. Please check the URL format."
        print(f"[{serviceLocation}] Error in job {uuid}: {error_detail}")
        await send_callback(callback_url, uuid, success, result, error_detail)
        return
    try:
        async with FileFetchHandler(str(input_url)) as handler:
            extracted_path = handler.get_extracted_path()
            file_path = handler.get_file_path()
            if extracted_path and os.path.exists(extracted_path) and os.listdir(extracted_path):
                image_files = [f for f in os.listdir(extracted_path) if f.lower().endswith((".png", ".jpg", ".jpeg", ".bmp"))]
                if not image_files:
                    error_detail = "No valid image files found in extracted archive"
                    print(f"[{serviceLocation}] Error in job {uuid}: {error_detail}")
                    await send_callback(callback_url, uuid, success, result, error_detail)
                    return
                results = await yolo_handler.predict_batch(extracted_path)
            elif file_path and os.path.isfile(file_path):
                if not file_path.lower().endswith((".png", ".jpg", ".jpeg", ".bmp")):
                    error_detail = "Downloaded file is not supported image format"
                    print(f"[{serviceLocation}] Error in job {uuid}: {error_detail}")
                    await send_callback(callback_url, uuid, success, result, error_detail)
                    return
                results = await yolo_handler.predict(file_path)
            else:
                error_detail = "No valid file was found at the provided URL"
                print(f"[{serviceLocation}] Error in job {uuid}: {error_detail}")
                await send_callback(callback_url, uuid, success, result, error_detail)
                return
            result = yolo_handler._sanitize_results(results)
            success = True
            print(f"[{serviceLocation}] Successfully processed bbox job {uuid}")
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"[{serviceLocation}] Error in bbox job {uuid}: {error_details}")
        if "403" in str(e):
            error_detail = "Access denied. The presigned URL may have expired or is invalid."
        elif "download" in str(e).lower():
            error_detail = f"Error downloading file: {str(e)}"
        else:
            error_detail = f"Error during bbox inference: {str(e)}"
    await send_callback(callback_url, uuid, success, result, error_detail)

# --- MedSAM Job (existing async callback version) ---
async def process_medsam_job_with_semaphore(
    input_url: HttpUrl, uuid: UUID, callback_url: HttpUrl,
    yolo_handler: YoloHandler, medsam_handler: MedSamHandler,
):
    print(f"[{serviceLocation}] Job {uuid} waiting for GPU access (medsam)...")
    async with gpu_semaphore:
        print(f"[{serviceLocation}] Job {uuid} acquired GPU access (medsam)")
        log_gpu_status(uuid, "start-medsam")
        try:
            await _process_medsam_job(
                input_url, uuid, callback_url, yolo_handler, medsam_handler
            )
        finally:
            log_gpu_status(uuid, "end-medsam")
            print(f"[{serviceLocation}] Job {uuid} released GPU access (medsam)")

async def _process_medsam_job(
    input_url: HttpUrl, uuid: UUID, callback_url: HttpUrl,
    yolo_handler: YoloHandler, medsam_handler: MedSamHandler,
):
    print(f"[{serviceLocation}] Starting MedSAM job {uuid}")
    result = None
    error_detail = None
    success = False
    parsed_url = urlparse(str(input_url))
    if not all([parsed_url.scheme, parsed_url.netloc]):
        error_detail = "Invalid URL provided. Please check the URL format."
        print(f"[{serviceLocation}] Error in job {uuid}: {error_detail}")
        await send_callback(callback_url, uuid, success, result, error_detail)
        return
    try:
        async with FileFetchHandler(str(input_url)) as handler:
            extracted_path = handler.get_extracted_path()
            file_path = handler.get_file_path()
            all_results = {}
            if extracted_path and os.path.exists(extracted_path) and os.listdir(extracted_path):
                print(f"[{serviceLocation}] Processing archive content...")
                image_files = [f for f in os.listdir(extracted_path) if f.lower().endswith((".png", ".jpg", ".jpeg", ".bmp"))]
                if not image_files:
                    error_detail = "No valid image files found in the extracted archive"
                    print(f"[{serviceLocation}] Error in job {uuid}: {error_detail}")
                    await send_callback(callback_url, uuid, success, result, "No valid images in archive")
                    return
                image_paths = [os.path.join(extracted_path, f) for f in image_files]
                print(f"[{serviceLocation}] Running ASYNC YOLO batch inference on {len(image_paths)} images...")
                batch_results = await yolo_handler.predict_batch(image_paths)
                filtered_images_map = {
                     img_path: filter_detections(res.get("detections", []))
                     for img_path, res in batch_results.items()
                }
                num_filtered_images = sum(1 for dets in filtered_images_map.values() if dets)
                total_detections = sum(len(dets) for dets in filtered_images_map.values())
                print(f"[{serviceLocation}] Found {total_detections} relevant detections across {num_filtered_images} images")
                processed_count = 0
                for image_path, filtered_dets in filtered_images_map.items():
                    if not filtered_dets:
                        continue
                    filename = os.path.basename(image_path)
                    processed_count += 1
                    print(f"[{serviceLocation}] Processing image {processed_count}/{num_filtered_images}: {filename}")
                    max_retries = 2
                    retry_count = 0
                    masks = None
                    while retry_count <= max_retries:
                        try:
                            masks = await medsam_handler.generate_mask(image_path, filtered_dets)
                            break
                        except RuntimeError as e:
                            msg = str(e)
                            is_runtime_device_error = any(k in msg.lower() for k in [
                                "cuda", "cudnn", "hip", "rocm", "out of memory", "device-side"
                            ])

                            if is_runtime_device_error and retry_count < max_retries:
                                print(f"[{serviceLocation}] Device/backend runtime error, retrying ({retry_count+1}/{max_retries})... err={msg}")
                                retry_count += 1
                                safe_empty_cache()
                                await asyncio.sleep(1)
                            else:
                                raise
                    if not masks:
                        print(f"[{serviceLocation}] Failed to generate masks for {filename} after {max_retries} retries")
                        continue
                    if "myo" in masks and "lv" in masks:
                        try:
                            myo_mask_np = np.array(masks["myo"])
                            lv_mask_np = np.array(masks["lv"])
                            true_myo_mask_np = np.clip(myo_mask_np - lv_mask_np, 0, 1)
                            if np.sum(true_myo_mask_np) == 0:
                                print(f"[{serviceLocation}] True myocardium mask is empty for {filename}, removing from results")
                                masks.pop("myo", None) # Use pop with default to avoid KeyError if myo was already removed
                            else:    
                                masks["myo"] = true_myo_mask_np
                        except Exception as subtraction_error:
                            print(f"[{serviceLocation}] Error calculating 'myo' mask for {filename}: {subtraction_error}")
                    mask_files = encode_and_name_masks(filename, masks, medsam_handler)
                    all_results[filename] = {"boxes": filtered_dets, "masks": mask_files}
            elif file_path and os.path.isfile(file_path):
                if not file_path.lower().endswith((".png", ".jpg", ".jpeg", ".bmp")):
                    error_detail = "Downloaded file is not a supported image format"
                    print(f"[{serviceLocation}] Error in job {uuid}: {error_detail}")
                    await send_callback(callback_url, uuid, success, result, error_detail)
                    return
                print(f"[{serviceLocation}] Processing single image: {os.path.basename(file_path)}")
                yolo_result = await yolo_handler.predict(file_path)
                filename = os.path.basename(file_path)
                filtered_detections = filter_detections(yolo_result.get("detections", []))
                if filtered_detections:
                    max_retries = 2
                    retry_count = 0
                    masks = None
                    while retry_count <= max_retries:
                        try:
                            masks = await medsam_handler.generate_mask(file_path, filtered_detections)
                            break
                        except RuntimeError as e:
                            msg = str(e)
                            is_runtime_device_error = any(k in msg.lower() for k in [
                                "cuda", "cudnn", "hip", "rocm", "out of memory", "device-side"
                            ])

                            if is_runtime_device_error and retry_count < max_retries:
                                print(f"[{serviceLocation}] Device/backend runtime error, retrying ({retry_count+1}/{max_retries})... err={msg}")
                                retry_count += 1
                                safe_empty_cache()
                                await asyncio.sleep(1)
                            else:
                                raise
                    if not masks:
                        error_detail = f"Failed to generate masks for {filename} after {max_retries} retries"
                        print(f"[{serviceLocation}] {error_detail}")
                        await send_callback(callback_url, uuid, success, result, error_detail)
                        return
                    if "myo" in masks and "lv" in masks:
                        try:
                            myo_mask_np = np.array(masks["myo"])
                            lv_mask_np = np.array(masks["lv"])
                            true_myo_mask_np = np.clip(myo_mask_np - lv_mask_np, 0, 1)
                            if np.sum(true_myo_mask_np) == 0:
                                print(f"[{serviceLocation}] True myocardium mask is empty for {filename}, removing from results")
                                masks.pop("myo", None)
                            else:    
                                masks["myo"] = true_myo_mask_np
                        except Exception as subtraction_error:
                            print(f"[{serviceLocation}] Error calculating 'myo' mask for {filename}: {subtraction_error}")
                    mask_files = encode_and_name_masks(filename, masks, medsam_handler)
                    all_results[filename] = {"boxes": filtered_detections, "masks": mask_files}
                else:
                    print(f"[{serviceLocation}] No relevant detections found for {filename}")
                    all_results[filename] = {"boxes": [], "masks": {}}
            else:
                error_detail = "No valid file found at URL after download/extraction"
                print(f"[{serviceLocation}] Error in job {uuid}: {error_detail}")
                await send_callback(callback_url, uuid, success, result, error_detail)
                return
            sorted_results = sort_medsam_results(all_results)
            result = sorted_results
            success = True
            print(f"[{serviceLocation}] Successfully processed MedSAM job {uuid}")
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"[{serviceLocation}] Error in MedSAM job {uuid}: {error_details}")
        if "403" in str(e):
            error_detail = "Access denied (403). Presigned URL invalid/expired."
        elif "download" in str(e).lower() or "extraction" in str(e).lower():
            error_detail = f"Error downloading/extracting file: {str(e)}"
        else:
            error_detail = f"An error occurred during inference: {str(e)}"
    finally:
        print(f"[{serviceLocation}] Sending final callback for job {uuid} with success={success}")
        await send_callback(callback_url, uuid, success, result, error_detail, segmentation_model="medsam")


async def process_unet_job_with_semaphore(
    input_url: HttpUrl,
    uuid: UUID,
    callback_url: HttpUrl,
    device: str = "auto",
    checkpoint_path: str | None = None,
):
    print(f"[{serviceLocation}] Job {uuid} waiting for GPU access (unet)...")
    async with gpu_semaphore:
        print(f"[{serviceLocation}] Job {uuid} acquired GPU access (unet)")
        log_gpu_status(uuid, "start-unet")
        try:
            await _process_unet_job(input_url, uuid, callback_url, device, checkpoint_path)
        finally:
            log_gpu_status(uuid, "end-unet")
            print(f"[{serviceLocation}] Job {uuid} released GPU access (unet)")


async def _process_unet_job(
    input_url: HttpUrl,
    uuid: UUID,
    callback_url: HttpUrl,
    device: str = "auto",
    checkpoint_path: str | None = None,
):
    print(f"[{serviceLocation}] Starting UNET job {uuid}")
    result = None
    error_detail = None
    success = False
    parsed_url = urlparse(str(input_url))

    if not all([parsed_url.scheme, parsed_url.netloc]):
        error_detail = "Invalid URL provided. Please check the URL format."
        print(f"[{serviceLocation}] Error in UNET job {uuid}: {error_detail}")
        await send_callback(callback_url, uuid, success, result, error_detail, segmentation_model="unet")
        return

    try:
        async with FileFetchHandler(str(input_url)) as handler:
            file_path = handler.get_file_path()

            if not file_path or not os.path.isfile(file_path):
                error_detail = "No valid NIfTI file was found at the provided URL"
                print(f"[{serviceLocation}] Error in UNET job {uuid}: {error_detail}")
                await send_callback(callback_url, uuid, success, result, error_detail, segmentation_model="unet")
                return

            inference_output = await asyncio.to_thread(
                run_unet_inference_from_nifti,
                file_path,
                device,
                checkpoint_path,
            )

            if not isinstance(inference_output, dict) or not inference_output.get("success"):
                error_detail = (inference_output or {}).get("error", "UNET inference failed without detailed error.")
                print(f"[{serviceLocation}] Error in UNET job {uuid}: {error_detail}")
            else:
                normalized_result = normalize_unet_result_to_medsam_shape(
                    inference_output.get("mask")
                )

                if not normalized_result:
                    error_detail = "UNET inference returned no parsable masks in expected structure."
                    print(f"[{serviceLocation}] Error in UNET job {uuid}: {error_detail}")
                else:
                    result = normalized_result
                    success = True
                    print(f"[{serviceLocation}] Successfully processed UNET job {uuid}")

    except Exception as e:
        error_details = traceback.format_exc()
        print(f"[{serviceLocation}] Error in UNET job {uuid}: {error_details}")
        if "403" in str(e):
            error_detail = "Access denied (403). Presigned URL invalid/expired."
        elif "download" in str(e).lower() or "extraction" in str(e).lower():
            error_detail = f"Error downloading/extracting file: {str(e)}"
        else:
            error_detail = f"Error during UNET inference: {str(e)}"
    finally:
        print(f"[{serviceLocation}] Sending final callback for UNET job {uuid} with success={success}")
        await send_callback(callback_url, uuid, success, result, error_detail, segmentation_model="unet")

# --- MedSAM Manual Job (existing async callback version) ---
async def process_medsam_manual_job_with_semaphore(
    input_url: HttpUrl, uuid: UUID, callback_url: HttpUrl,
    image_name: str, bbox: List[float], medsam_handler: MedSamHandler,
):
    print(f"[{serviceLocation}] Job {uuid} waiting for GPU access (manual)...")
    async with gpu_semaphore:
        print(f"[{serviceLocation}] Job {uuid} acquired GPU access (manual)")
        log_gpu_status(uuid, "start-manual")
        try:
            await _process_medsam_manual_job(
                input_url, uuid, callback_url, image_name, bbox, medsam_handler
            )
        finally:
            log_gpu_status(uuid, "end-manual")
            print(f"[{serviceLocation}] Job {uuid} released GPU access (manual)")

async def _process_medsam_manual_job(
    input_url: HttpUrl, uuid: UUID, callback_url: HttpUrl,
    image_name: str, bbox: List[float], medsam_handler: MedSamHandler,
):
    print(f"[{serviceLocation}] Starting Manual MedSAM job {uuid}")
    result = None
    error_detail = None
    success = False
    try:
        async with FileFetchHandler(str(input_url)) as handler:
            extracted_path = handler.get_extracted_path()
            if not (extracted_path and os.path.exists(extracted_path) and os.listdir(extracted_path)):
                error_detail = "Invalid or missing archive file"
                print(f"[{serviceLocation}] Error in job {uuid}: {error_detail}")
                await send_callback(callback_url, uuid, success, result, "Invalid/missing archive file")
                return
            target_image_path = os.path.join(extracted_path, image_name)
            if not os.path.isfile(target_image_path):
                error_detail = f"Image '{image_name}' not found in the archive"
                print(f"[{serviceLocation}] Error in job {uuid}: {error_detail}")
                await send_callback(callback_url, uuid, success, result, f"Image '{image_name}' not found")
                return
            manual_detection = {"bbox": bbox, "class_name": "manual"}
            max_retries = 2
            retry_count = 0
            masks = None
            while retry_count <= max_retries:
                try:
                    masks = await medsam_handler.generate_mask(
                        target_image_path, [manual_detection]
                    )
                    break
                except RuntimeError as e:
                    msg = str(e)
                    is_runtime_device_error = any(k in msg.lower() for k in [
                        "cuda", "cudnn", "hip", "rocm", "out of memory", "device-side"
                    ])

                    if is_runtime_device_error and retry_count < max_retries:
                        print(f"[{serviceLocation}] Device/backend runtime error, retrying ({retry_count+1}/{max_retries})... err={msg}")
                        retry_count += 1
                        safe_empty_cache()
                        await asyncio.sleep(1)
                    else:
                        raise
            if not masks:
                error_detail = f"Failed to generate mask for {image_name} after {max_retries} retries"
                print(f"[{serviceLocation}] Error in job {uuid}: {error_detail}")
                await send_callback(callback_url, uuid, success, result, error_detail)
                return
            mask_files = encode_and_name_masks(image_name, masks, medsam_handler)
            all_results = {image_name: mask_files}
            result = all_results
            success = True
            print(f"[{serviceLocation}] Successfully processed Manual MedSAM job {uuid}")
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"[{serviceLocation}] Error in Manual MedSAM job {uuid}: {error_details}")
        if "403" in str(e):
            error_detail = "Access denied (403). Presigned URL invalid/expired."
        elif "download" in str(e).lower() or "extraction" in str(e).lower():
            error_detail = f"Error downloading/extracting file: {str(e)}"
        else:
            error_detail = f"An error occurred during inference: {str(e)}"
    finally:
        print(f"[{serviceLocation}] Sending final callback for manual job {uuid} with success={success}")
        await send_callback(callback_url, uuid, success, result, error_detail)


async def execute_medsam_manual_job_synchronously(
    input_url: HttpUrl,
    uuid: UUID,
    image_name: str,
    bbox: List[float], # This is the input bbox: [x1, y1, x2, y2]
    medsam_handler: MedSamHandler,
) -> Dict[str, ResultPerImageManual]:
    """
    Processes a manual MedSAM job synchronously.
    Does NOT use the gpu_semaphore. Returns result or raises HTTPException.
    Result structure is nested with "boxes" (including confidence and class_id) and "masks".
    """
    print(f"[{serviceLocation}] Starting SYNC Manual MedSAM job {uuid} for image '{image_name}'")
    log_gpu_status(uuid, "acquire-manual-sync")

    try:
        async with FileFetchHandler(str(input_url)) as handler:
            extracted_path = handler.get_extracted_path()
            if not (extracted_path and os.path.exists(extracted_path) and os.listdir(extracted_path)):
                err_detail = "Invalid or empty archive file. Ensure the tar file is not empty and correctly structured."
                print(f"[{serviceLocation}] Error in SYNC job {uuid}: {err_detail} at {input_url}")
                log_gpu_status(uuid, "error-manual-sync-filefetch")
                raise HTTPException(status_code=400, detail={"detail": err_detail, "uuid": str(uuid)})

            target_image_path = os.path.join(extracted_path, image_name)
            if not os.path.isfile(target_image_path):
                err_detail = f"Image '{image_name}' not found in the archive."
                print(f"[{serviceLocation}] Error in SYNC job {uuid}: {err_detail} from {input_url}")
                log_gpu_status(uuid, "error-manual-sync-imgnotfound")
                raise HTTPException(status_code=404, detail={"detail": err_detail, "uuid": str(uuid)})

            # This is the single detection object based on the manual input bbox
            # MedSAM needs it in this format for its generate_mask function's "detections" argument
            manual_detection_for_medsam = {"bbox": bbox, "class_name": "manual"}
            
            log_gpu_status(uuid, "start-gensyncmask-manual")
            masks_from_medsam = None
            max_retries = 2
            for attempt in range(max_retries + 1):
                try:
                    masks_from_medsam = await medsam_handler.generate_mask(
                        target_image_path, [manual_detection_for_medsam]
                    )
                    break
                except RuntimeError as e:
                    msg = str(e)
                    is_runtime_device_error = any(k in msg.lower() for k in [
                        "cuda", "cudnn", "hip", "rocm", "out of memory", "device-side"
                    ])

                    if is_runtime_device_error and attempt < max_retries:
                        print(f"[{serviceLocation}] Device/backend runtime error, retrying ({attempt+1}/{max_retries+1})... err={msg}")
                        safe_empty_cache()
                        await asyncio.sleep(1 + attempt)
                    elif "Input image is None" in msg or "Failed to load image" in msg:
                        err_detail = f"MedSAM handler failed to load image: {image_name}. Underlying error: {msg}"
                        print(f"[{serviceLocation}] Error in SYNC job {uuid}: {err_detail} at '{target_image_path}'.")
                        log_gpu_status(uuid, "error-manual-sync-imgloadfail")
                        raise HTTPException(status_code=400, detail={"detail": err_detail, "uuid": str(uuid)})
                    else:
                        err_detail = f"Error during MedSAM mask generation for {image_name}: {msg}"
                        print(f"[{serviceLocation}] Error in SYNC job {uuid} during mask generation (attempt {attempt+1}): {err_detail}")
                        log_gpu_status(uuid, "error-manual-sync-maskgenruntime")
                        if is_runtime_device_error:
                            raise HTTPException(status_code=503, detail={"detail": f"GPU error processing {image_name} after {max_retries + 1} attempts: {msg}", "uuid": str(uuid)})
                        raise HTTPException(status_code=500, detail={"detail": err_detail, "uuid": str(uuid)})
                except ValueError as e:
                    err_detail = f"Invalid input for MedSAM processing of {image_name}. Likely bad image or bbox. Error: {str(e)}"
                    print(f"[{serviceLocation}] Error in SYNC job {uuid}: {err_detail} for '{target_image_path}'.")
                    log_gpu_status(uuid, "error-manual-sync-valueerror")
                    raise HTTPException(status_code=400, detail={"detail": err_detail, "uuid": str(uuid)})
            
            log_gpu_status(uuid, "end-gensyncmask-manual")

            if masks_from_medsam is None:
                err_detail = f"Failed to generate masks for {image_name} after {max_retries + 1} retries."
                print(f"[{serviceLocation}] Error in SYNC job {uuid}: {err_detail}")
                log_gpu_status(uuid, "error-manual-sync-nomask")
                raise HTTPException(status_code=500, detail={"detail": err_detail, "uuid": str(uuid)})

            rle_encoded_masks = encode_and_name_masks(image_name, masks_from_medsam, medsam_handler)

            # Prepare the "boxes" part using the input bbox, now with confidence and class_id
            input_box_object = ManualInputBox(
                bbox=bbox,
                confidence=1.0, # Set confidence to 1.0 for manual input
                class_id=-1,    # Set class_id to -1 for "manual"
                class_name="manual" # class_name is already "manual" by default
            )

            image_result_data = ResultPerImageManual(
                boxes=[input_box_object],
                masks=rle_encoded_masks
            )

            all_results = {image_name: image_result_data}

            print(f"[{serviceLocation}] Successfully processed SYNC Manual MedSAM job {uuid}")
            log_gpu_status(uuid, "release-manual-sync")
            return all_results

    except FileNotFoundError as e:
        err_detail = f"A required file was not found during SYNC job {uuid}: {str(e)}"
        print(f"[{serviceLocation}] {err_detail}")
        log_gpu_status(uuid, "error-manual-sync-filenotfound")
        raise HTTPException(status_code=404, detail={"detail": err_detail, "uuid": str(uuid)})
    except HTTPException as e:
        if "error-manual-sync" not in str(e.detail):
             log_gpu_status(uuid, "error-manual-sync-http")
        raise e
    except Exception as e:
        error_details = traceback.format_exc()
        err_detail = f"An unexpected error occurred during synchronous manual inference for job {uuid}: {str(e)}"
        print(f"[{serviceLocation}] {err_detail}. Traceback: {error_details}")
        log_gpu_status(uuid, "error-manual-sync-unexpected")
        if "403" in str(e) or "Presigned URL access denied" in str(e):
            raise HTTPException(status_code=403, detail={"detail": "Access denied. The presigned URL may have expired, be invalid, or lack permissions.", "uuid": str(uuid)})
        elif "download" in str(e).lower() or "extraction" in str(e).lower():
            raise HTTPException(status_code=400, detail={"detail": f"Error downloading/extracting file: {str(e)}", "uuid": str(uuid)})
        raise HTTPException(status_code=500, detail={"detail": err_detail, "uuid": str(uuid)})


# --- 4D Reconstruction Job ---
async def process_fourd_reconstruction_job_with_semaphore(
    request: "FourDReconstructionJobRequest", 
    fourd_handler: FourDReconstructionHandler
):
    """Process 4D reconstruction job with GPU semaphore control"""
    print(f"[{serviceLocation}] Job {request.uuid} waiting for GPU access (4D reconstruction)...")
    async with gpu_semaphore:
        print(f"[{serviceLocation}] Job {request.uuid} acquired GPU access (4D reconstruction)")
        log_gpu_status(request.uuid, "start-4d-reconstruction")
        try:
            await _process_fourd_reconstruction_job(request, fourd_handler)
        finally:
            log_gpu_status(request.uuid, "end-4d-reconstruction")
            print(f"[{serviceLocation}] Job {request.uuid} released GPU access (4D reconstruction)")


async def _process_fourd_reconstruction_job(
    request: "FourDReconstructionJobRequest", 
    fourd_handler: FourDReconstructionHandler
):
    """Process 4D reconstruction job"""
    print(f"[{serviceLocation}] Starting 4D reconstruction job {request.uuid}")
    result = None
    error_detail = None
    success = False
    mesh_files = None  # Initialize mesh files list
    
    # Validate URL
    parsed_url = urlparse(str(request.url))
    if not all([parsed_url.scheme, parsed_url.netloc]):
        error_detail = "Invalid URL provided. Please check the URL format."
        print(f"[{serviceLocation}] Error in job {request.uuid}: {error_detail}")
        await send_callback(request.callback_url, request.uuid, success, result, error_detail)
        return
    
    try:
        async with FileFetchHandler(str(request.url)) as handler:
            file_path = handler.get_file_path()
            
            # Check if we have a single NiFTI file
            if file_path and os.path.isfile(file_path):
                if not file_path.lower().endswith(('.nii', '.nii.gz')):
                    error_detail = "Downloaded file is not a NiFTI format (.nii or .nii.gz)"
                    print(f"[{serviceLocation}] Error in job {request.uuid}: {error_detail}")
                    await send_callback(request.callback_url, request.uuid, success, result, error_detail)
                    return
                
                # Create temporary output directory
                with tempfile.TemporaryDirectory() as temp_output_dir:
                    # Process the 4D reconstruction with new parameters
                    reconstruction_result = await fourd_handler.predict(
                        nifti_file_path=file_path,
                        output_dir=temp_output_dir,
                        # Pass request parameters
                        ed_frame_index=request.ed_frame_index,
                        num_iterations=request.num_iterations,
                        resolution=request.resolution,
                        process_all_frames=request.process_all_frames,
                        export_format=request.export_format,
                        debug_save=request.debug_save,
                        debug_dir=request.debug_dir,
                        # PHASE 1 EXPERIMENT: Pass new parameters
                        code_reg_lambda=request.code_reg_lambda,
                        verbose_logging=request.verbose_logging
                    )
                    
                    if reconstruction_result["success"]:
                        # TODO: Implement file handling logic here
                        # Options:
                        # 1. Upload mesh file to S3 and return URL
                        # 2. Return base64 encoded mesh data
                        # 3. Save to shared storage and return path
                        
                        # For now, return file information
                        mesh_file = reconstruction_result["mesh_file"]
                        
                        # Prepare result with metadata (no large data in JSON)
                        mesh_file = reconstruction_result["mesh_file"]  # Primary mesh file
                        all_mesh_files = reconstruction_result.get("mesh_files", [mesh_file])  # All mesh files
                        
                        if os.path.exists(mesh_file):
                            # Calculate total size of all mesh files
                            total_size = sum(os.path.getsize(f) for f in all_mesh_files if os.path.exists(f))
                            primary_size = os.path.getsize(mesh_file)
                            
                            result = {
                                "mesh_filename": os.path.basename(mesh_file),
                                "mesh_file_size": primary_size,
                                "total_mesh_files": len(all_mesh_files),
                                "total_mesh_size": total_size,
                                "mesh_format": "obj",
                                "reconstruction_time": reconstruction_result["reconstruction_time"],
                                "num_iterations": reconstruction_result["num_iterations"],
                                "resolution": reconstruction_result["resolution"],
                                "status": "reconstruction_completed",
                                "message": f"4D reconstruction completed successfully. {len(all_mesh_files)} mesh files sent as multipart attachments.",
                                
                                # Add 4D-specific metadata
                                "is_4d_input": reconstruction_result.get("is_4d_input", False),
                                "total_frames": reconstruction_result.get("temporal_info", {}).get("total_temporal_frames", 1),
                                "ed_frame_index": reconstruction_result.get("ed_frame_index", 0),
                                "processed_frames": reconstruction_result.get("total_frames_processed", 1),
                                "temporal_info": reconstruction_result.get("temporal_info", {}),
                                
                                # File list metadata
                                "mesh_files_info": [
                                    {
                                        "filename": os.path.basename(f),
                                        "size": os.path.getsize(f) if os.path.exists(f) else 0,
                                        "frame_index": _extract_frame_index_from_filename(os.path.basename(f))
                                    }
                                    for f in all_mesh_files
                                ]
                            }
                            
                            success = True
                            mesh_files = all_mesh_files  # List of all files to send as attachments
                            print(f"[{serviceLocation}] Successfully processed 4D reconstruction job {request.uuid}")
                            print(f"[{serviceLocation}] Prepared {len(mesh_files)} mesh files for multipart upload (total: {total_size} bytes)")
                            for i, f in enumerate(mesh_files):
                                size = os.path.getsize(f) if os.path.exists(f) else 0
                                print(f"[{serviceLocation}]   File {i+1}: {os.path.basename(f)} ({size} bytes)")
                            
                            # Send callback WHILE files still exist in temp directory
                            print(f"[{serviceLocation}] Sending multipart callback with {len(mesh_files)} files...")
                            export_format = reconstruction_result.get("export_format", "obj")
                            await send_callback_with_files(request.callback_url, request.uuid, success, result, None, mesh_files, export_format)
                            print(f"[{serviceLocation}] Multipart callback sent successfully for job {request.uuid}")
                            return  # Exit early after successful callback
                            
                        else:
                            error_detail = f"Primary mesh file was not generated: {mesh_file}"
                            # Send error callback
                            await send_callback(request.callback_url, request.uuid, False, None, error_detail)
                            return  # Exit early after error callback
                    else:
                        error_detail = reconstruction_result.get("error", "Unknown error during reconstruction")
                        # Send error callback
                        await send_callback(request.callback_url, request.uuid, False, None, error_detail)
                        return  # Exit early after error callback
                        
            else:
                error_detail = "No valid NiFTI file was found at the provided URL"
                print(f"[{serviceLocation}] Error in job {request.uuid}: {error_detail}")
                
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"[{serviceLocation}] Error in 4D reconstruction job {request.uuid}: {error_details}")
        
        if "403" in str(e):
            error_detail = "Access denied. The presigned URL may have expired or is invalid."
        elif "download" in str(e).lower():
            error_detail = f"Error downloading file: {str(e)}"
        else:
            error_detail = f"Error during 4D reconstruction: {str(e)}"
    
    # Use multipart callback for successful cases with mesh files
    if success and 'mesh_files' in locals() and mesh_files:
        export_format = result.get("export_format", "obj") if result else "obj"
        await send_callback_with_files(request.callback_url, request.uuid, success, result, error_detail, mesh_files, export_format)
    else:
        await send_callback(request.callback_url, request.uuid, success, result, error_detail)
