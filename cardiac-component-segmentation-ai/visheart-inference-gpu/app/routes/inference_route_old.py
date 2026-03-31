# This is the old version of the inference_route.py file. It contains the FastAPI routes for handling image inference requests, including bounding box detection and semantic segmentation using YOLO and MedSAM models. The code includes error handling, file fetching, and response formatting. This file is kept so that the test scripts are still compatible with it.

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, HttpUrl, Field, field_validator
import os, time, torch, math, traceback
from typing import Dict, List, Any
import numpy as np

# Import your handlers and dependencies
from app.classes.file_fetch_handler import FileFetchHandler
from app.classes.yolo_handler import YoloHandler
from app.dependencies.model_init import get_yolo_model

# For checking JWT token during authentication
from typing import Annotated  # Add Annotated

# Import the verification dependency and the payload model
from app.security.backend_authentication import conditional_verify_jwt, TokenPayLoad

# Initialize the router
router = APIRouter()


# Sample route for testing required JWT token
@router.get("/sample")
async def sample(
    token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
):
    # This is a sample route that requires a valid JWT token
    # The token payload is automatically validated and decoded
    client_id = token_payload.sub
    print(f"Client ID: {client_id} - Token is valid")

    # For demonstration, return a static image file
    image_path = os.path.join(
        os.path.dirname(__file__),
        "..",
        "scripts",
        "test_folder",
        "680da34e858d216b6bcf9d52_680da34e858d216b6bcf9d59_0_0.jpg",
    )
    return FileResponse(image_path, media_type="image/jpeg")


# Define request and response models
class PresignedUrlRequest(BaseModel):
    url: HttpUrl = Field(
        ..., description="Presigned URL for the image file or tar archive"
    )


@router.post("/bbox-inference", response_model=Dict[str, List[Dict[str, Any]]])
async def bbox_inference(
    token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
    request: PresignedUrlRequest,
    yolo_handler: YoloHandler = Depends(get_yolo_model),
):
    """
    Perform bounding box inference on images from a presigned URL.

    - Accepts a presigned URL to an image file or tar archive
    - Downloads and extracts the file(s)
    - Runs YOLO inference
    - Returns sanitized bounding box results
    """
    try:
        # Use FileFetchHandler as context manager to ensure proper cleanup
        with FileFetchHandler(str(request.url)) as handler:
            # Check if we have extracted files or just a single file
            if handler.extracted_dir and os.path.exists(handler.extracted_dir):
                # Check if the extracted directory contains any valid images
                image_files = [
                    f
                    for f in os.listdir(handler.extracted_dir)
                    if f.lower().endswith((".png", ".jpg", ".jpeg", ".bmp"))
                ]

                if not image_files:
                    raise HTTPException(
                        status_code=415,
                        detail="No valid image files found in the extracted archive",
                    )

                # Process all images in the extracted directory in batches
                results = yolo_handler.predict_batch(handler.extracted_dir)
            elif os.path.isfile(handler.file_path):
                # Check if the file is a valid image
                if not handler.file_path.lower().endswith(
                    (".png", ".jpg", ".jpeg", ".bmp")
                ):
                    raise HTTPException(
                        status_code=415,
                        detail="Downloaded file is not a supported image format",
                    )

                # Process single file
                results = yolo_handler.predict(handler.file_path)
            else:
                raise HTTPException(
                    status_code=404,
                    detail="No valid file was found at the provided URL",
                )

            # Sanitize results to remove full paths and simplify the response
            sanitized_results = yolo_handler._sanitize_results(results)

            # Return the sanitized results
            return sanitized_results

    except HTTPException:
        # Re-raise HTTP exceptions as they're already properly formatted
        raise
    except Exception as e:
        # Log the full error for debugging
        error_details = traceback.format_exc()
        print(f"Error in bbox_inference: {error_details}")

        # Return an appropriate HTTP error
        if "403" in str(e):
            raise HTTPException(
                status_code=403,
                detail="Access denied. The presigned URL may have expired or is invalid.",
            )
        elif "download" in str(e).lower():
            raise HTTPException(
                status_code=400, detail=f"Error downloading file: {str(e)}"
            )
        else:
            raise HTTPException(
                status_code=500, detail=f"An error occurred during inference: {str(e)}"
            )


# Separate MedSAM inference
from collections import defaultdict
from app.dependencies.model_init import get_medsam_model
from app.classes.medsam_handler import MedSamHandler


@router.post("/medsam-inference", response_model=Dict[str, Dict[str, Any]])
async def medsam_inference(
    token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
    request: PresignedUrlRequest,
    yolo_handler: YoloHandler = Depends(get_yolo_model),
    medsam_handler: MedSamHandler = Depends(get_medsam_model),
    response: Response = None,
):
    """
    Perform semantic segmentation using MedSAM with YOLO bounding boxes.
    Returns both bounding box detections and segmentation masks.
    """
    if response:
        response.headers["X-Accel-Buffering"] = "no"

    # Initialize handler
    handler = None
    # Add timing statistics
    start_time = time.time()

    try:
        print(f"[MedSAM] Starting inference process at {time.strftime('%H:%M:%S')}")

        # Use FileFetchHandler as context manager to ensure proper cleanup
        with FileFetchHandler(str(request.url)) as handler:
            # Dictionary to store results
            all_results = {}

            # Add debug logging
            print(f"[MedSAM] Handler file_path: {handler.file_path}")

            # First check if this is a tar archive by checking the file extension
            file_is_archive = False
            if hasattr(handler, "file_path") and os.path.isfile(handler.file_path):
                filename = os.path.basename(handler.file_path)
                if filename.lower().endswith((".tar", ".tar.gz", ".tgz")):
                    file_is_archive = True

            # First handle archives
            if (
                file_is_archive
                and hasattr(handler, "extracted_dir")
                and os.path.exists(handler.extracted_dir)
            ):
                print(
                    f"[MedSAM] Processing as archive: {os.path.basename(handler.file_path)}"
                )

                # Check if the extracted directory contains any valid images
                image_files = [
                    f
                    for f in os.listdir(handler.extracted_dir)
                    if f.lower().endswith((".png", ".jpg", ".jpeg", ".bmp"))
                ]

                if not image_files:
                    raise HTTPException(
                        status_code=415,
                        detail="No valid image files found in the extracted archive",
                    )

                # Process all images in the extracted directory
                image_paths = [
                    os.path.join(handler.extracted_dir, f) for f in image_files
                ]

                # Process archive contents (batch processing)
                # Log the start of YOLO batch inference
                yolo_start_time = time.time()
                print(
                    f"[MedSAM] Running YOLO batch inference on {len(image_paths)} images..."
                )

                batch_results = yolo_handler.predict_batch(image_paths)

                yolo_time = time.time() - yolo_start_time
                print(f"[MedSAM] YOLO batch inference completed in {yolo_time:.2f}s")

                # Filter relevant detections and count them
                filtered_images = []
                total_detections = 0
                for image_path, result in batch_results.items():
                    filtered_detections = filter_detections(result["detections"])
                    if filtered_detections:
                        filtered_images.append(image_path)
                        total_detections += len(filtered_detections)

                print(
                    f"[MedSAM] Found {total_detections} relevant detections across {len(filtered_images)} images"
                )
                print(f"[MedSAM] Starting segmentation mask generation...")

                # Process each image with progress tracking
                medsam_start_time = time.time()
                processed_count = 0

                # Process each image
                for image_path, result in batch_results.items():
                    filename = os.path.basename(image_path)

                    # Extract the filtered detections for this image
                    filtered_detections = filter_detections(result["detections"])

                    # Skip if no detections
                    if not filtered_detections:
                        continue

                    # Log progress percentage
                    processed_count += 1
                    progress = (processed_count / len(filtered_images)) * 100
                    print(
                        f"[MedSAM] Processing image {processed_count}/{len(filtered_images)} ({progress:.1f}%): {filename}"
                    )

                    # Generate masks with MedSAM for each detection
                    # With this retry logic:
                    max_retries = 2
                    retry_count = 0
                    while retry_count <= max_retries:
                        try:
                            # Your existing code to run inference
                            masks = medsam_handler.generate_mask(
                                image_path, filtered_detections
                            )
                            # Calculate true myocardium mask and overwrite 'myo'
                            if "myo" in masks and "lv" in masks:
                                try:
                                    # Ensure masks are NumPy arrays for subtraction
                                    myo_mask_np = np.array(masks["myo"])
                                    lv_mask_np = np.array(masks["lv"])

                                    # Perform subtraction: myo - lv
                                    true_myo_mask_np = np.clip(
                                        myo_mask_np - lv_mask_np, 0, 1
                                    )

                                    # *** CHANGE HERE: Overwrite the original 'myo' mask ***
                                    masks["myo"] = true_myo_mask_np

                                except Exception as subtraction_error:
                                    # Log error if subtraction fails
                                    print(
                                        f"[MedSAM] Error calculating and overwriting 'myo' mask for {filename}: {subtraction_error}"
                                    )
                                    # If calculation fails, the original 'myo' mask from generate_mask remains
                                    pass
                            else:
                                # Log if required masks are missing for calculation
                                print(
                                    f"[MedSAM] Skipping 'myo' mask overwrite for {filename} - missing original 'myo' or 'lv' mask."
                                )
                            break
                        except RuntimeError as e:
                            if "CUDA" in str(e) and retry_count < max_retries:
                                print(
                                    f"[MedSAM] CUDA error encountered, retrying ({retry_count+1}/{max_retries})..."
                                )
                                retry_count += 1
                                # Clear GPU memory before retry
                                torch.cuda.empty_cache()
                                time.sleep(1)  # Wait a bit before retry
                            else:
                                raise

                    # Encode masks with RLE and store with proper naming
                    mask_files = encode_and_name_masks(filename, masks, medsam_handler)

                    # Store both bounding boxes and masks in the results
                    all_results[filename] = {
                        "boxes": filtered_detections,
                        "masks": mask_files,
                    }

                medsam_time = time.time() - medsam_start_time
                print(
                    f"[MedSAM] Segmentation completed in {medsam_time:.2f}s for {processed_count} images"
                )

            elif hasattr(handler, "file_path") and os.path.isfile(handler.file_path):
                # Check if the file is a valid image
                if not handler.file_path.lower().endswith(
                    (".png", ".jpg", ".jpeg", ".bmp")
                ):
                    raise HTTPException(
                        status_code=415,
                        detail="Downloaded file is not a supported image format",
                    )

                print(
                    f"[MedSAM] Processing as single image: {os.path.basename(handler.file_path)}"
                )

                # Process single file
                yolo_start_time = time.time()
                print(f"[MedSAM] Running YOLO detection...")
                result = yolo_handler.predict(handler.file_path)
                yolo_time = time.time() - yolo_start_time
                print(f"[MedSAM] YOLO detection completed in {yolo_time:.2f}s")

                filename = os.path.basename(handler.file_path)

                # Extract the filtered detections
                filtered_detections = filter_detections(result["detections"])
                print(f"[MedSAM] Found {len(filtered_detections)} relevant detections")

                if not filtered_detections:
                    return {}

                # Generate masks with MedSAM for each detection
                # With this retry logic:
                print(f"[MedSAM] Generating segmentation masks...")
                medsam_start_time = time.time()
                max_retries = 2
                retry_count = 0
                while retry_count <= max_retries:
                    try:
                        # Fix: Use handler.file_path instead of image_path
                        masks = medsam_handler.generate_mask(
                            handler.file_path, filtered_detections
                        )

                        # Calculate true myocardium mask and overwrite 'myo'
                        if "myo" in masks and "lv" in masks:
                            try:
                                # Ensure masks are NumPy arrays for subtraction
                                myo_mask_np = np.array(masks["myo"])
                                lv_mask_np = np.array(masks["lv"])

                                # Perform subtraction: myo - lv
                                true_myo_mask_np = np.clip(
                                    myo_mask_np - lv_mask_np, 0, 1
                                )

                                # *** CHANGE HERE: Overwrite the original 'myo' mask ***
                                masks["myo"] = true_myo_mask_np

                            except Exception as subtraction_error:
                                # Log error if subtraction fails
                                print(
                                    f"[MedSAM] Error calculating and overwriting 'myo' mask for {filename}: {subtraction_error}"
                                )
                                # If calculation fails, the original 'myo' mask from generate_mask remains
                                pass
                        else:
                            # Log if required masks are missing for calculation
                            print(
                                f"[MedSAM] Skipping 'myo' mask overwrite for {filename} - missing original 'myo' or 'lv' mask."
                            )
                        break
                    except RuntimeError as e:
                        if "CUDA" in str(e) and retry_count < max_retries:
                            print(
                                f"[MedSAM] CUDA error encountered, retrying ({retry_count+1}/{max_retries})..."
                            )
                            retry_count += 1
                            # Clear GPU memory before retry
                            torch.cuda.empty_cache()
                            time.sleep(1)  # Wait a bit before retry
                        else:
                            raise

                medsam_time = time.time() - medsam_start_time
                print(f"[MedSAM] Segmentation completed in {medsam_time:.2f}s")

                # Encode masks with RLE and store with proper naming
                mask_files = encode_and_name_masks(filename, masks, medsam_handler)

                # Store both bounding boxes and masks in the results
                all_results[filename] = {
                    "boxes": filtered_detections,
                    "masks": mask_files,
                }

            else:
                raise HTTPException(
                    status_code=404,
                    detail="No valid file was found at the provided URL",
                )

            sorted_results = sort_medsam_results(all_results)

            # Log the final completion
            total_time = time.time() - start_time
            print(f"[MedSAM] Inference completed successfully in {total_time:.2f}s")
            print(
                f"[MedSAM] Generated masks for {len(all_results)} images with {sum(len(result['masks']) for result in all_results.values())} classes"
            )

            return sorted_results

    except HTTPException:
        # Re-raise HTTP exceptions as they're already properly formatted
        raise
    except Exception as e:
        # Log the full error for debugging
        error_details = traceback.format_exc()
        print(f"Error in medsam_inference: {error_details}")

        # Return an appropriate HTTP error
        if "403" in str(e):
            raise HTTPException(
                status_code=403,
                detail="Access denied. The presigned URL may have expired or is invalid.",
            )
        elif "download" in str(e).lower():
            raise HTTPException(
                status_code=400, detail=f"Error downloading file: {str(e)}"
            )
        else:
            raise HTTPException(
                status_code=500, detail=f"An error occurred during inference: {str(e)}"
            )
    finally:
        # Add safety checks before trying to access handler attributes
        if (
            handler
            and hasattr(handler, "extracted_dir")
            and handler.extracted_dir
            and os.path.exists(handler.extracted_dir)
        ):
            try:
                os.rmdir(handler.extracted_dir)
            except Exception as e:
                print(f"[MedSAM] Error cleaning up extracted directory: {e}")


# Define the request model for manual bounding box inference
class ManualBboxRequest(BaseModel):
    url: HttpUrl = Field(..., description="Presigned URL for the tar archive")
    image_name: str = Field(..., description="Name of the image in the archive")
    bbox: List[float] = Field(
        ..., description="Bounding box coordinates [x1, y1, x2, y2]"
    )

    # Replace deprecated validator with field_validator
    @field_validator("bbox")
    @classmethod
    def validate_bbox(cls, v):
        # Check length
        if not isinstance(v, list):
            raise ValueError("Bounding box must be a list of coordinates")

        if len(v) != 4:
            raise ValueError(
                "Bounding box must contain exactly 4 values [x1, y1, x2, y2]"
            )

        # Ensure all values are numerical and not NaN/inf
        for i, coord in enumerate(v):
            if not isinstance(coord, (int, float)):
                raise ValueError(f"Coordinate {i} must be a number")

            if math.isnan(coord) or math.isinf(coord):
                raise ValueError(f"Coordinate {i} cannot be NaN or infinity")

        # Check x1 < x2 and y1 < y2
        x1, y1, x2, y2 = v
        if x1 >= x2:
            raise ValueError(
                f"Invalid bounding box: x1 ({x1}) must be less than x2 ({x2})"
            )

        if y1 >= y2:
            raise ValueError(
                f"Invalid bounding box: y1 ({y1}) must be less than y2 ({y2})"
            )

        # Ensure coordinates are positive
        if any(coord < 0 for coord in v):
            raise ValueError("Bounding box coordinates must be positive")

        # Check for unreasonably large values (image size sanity check)
        MAX_DIMENSION = 10000  # Most medical images won't exceed this
        if any(coord > MAX_DIMENSION for coord in v):
            raise ValueError(
                f"Coordinate values exceeding {MAX_DIMENSION} are likely invalid"
            )

        # Check for minimum bounding box size
        width = x2 - x1
        height = y2 - y1
        MIN_SIZE = 5  # Minimum reasonable size in pixels

        if width < MIN_SIZE or height < MIN_SIZE:
            raise ValueError(
                f"Bounding box too small: width={width}, height={height}. Minimum size is {MIN_SIZE}px"
            )

        return v


@router.post("/medsam-inference-manual", response_model=Dict[str, Dict[str, str]])
async def medsam_inference_manual(
    token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
    request: ManualBboxRequest,
    medsam_handler: MedSamHandler = Depends(get_medsam_model),
    response: Response = None,
):
    """
    Perform semantic segmentation using MedSAM with a manually provided bounding box.

    - Accepts a presigned URL to a tar archive
    - Expects the name of a specific image in the archive
    - Uses the provided bounding box coordinates to guide segmentation
    - Returns an RLE-encoded segmentation mask
    """
    if response:
        response.headers["X-Accel-Buffering"] = "no"

    # Initialize handler
    handler = None
    start_time = time.time()

    try:
        print(
            f"[MedSAM-Manual] Starting inference process at {time.strftime('%H:%M:%S')}"
        )

        # Use FileFetchHandler as context manager to ensure proper cleanup
        with FileFetchHandler(str(request.url)) as handler:
            # Dictionary to store results
            all_results = {}

            if not (
                hasattr(handler, "extracted_dir")
                and os.path.exists(handler.extracted_dir)
            ):
                raise HTTPException(
                    status_code=415, detail="Invalid or missing archive file"
                )

            # Find the requested image
            target_image_path = os.path.join(handler.extracted_dir, request.image_name)
            if not os.path.isfile(target_image_path):
                raise HTTPException(
                    status_code=404,
                    detail=f"Image '{request.image_name}' not found in the archive",
                )

            # Validate image dimensions against bbox
            try:
                import cv2

                img = cv2.imread(target_image_path)
                if img is None:
                    raise HTTPException(
                        status_code=415,
                        detail="Unable to read image file - possibly corrupted",
                    )

                h, w = img.shape[:2]
                x1, y1, x2, y2 = request.bbox

                # Check if bbox is within image bounds with detailed error message
                if x1 < 0 or y1 < 0 or x2 > w or y2 > h:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Bounding box ({x1},{y1},{x2},{y2}) exceeds image dimensions ({w}x{h})",
                    )
            except Exception as e:
                if isinstance(e, HTTPException):
                    raise
                raise HTTPException(
                    status_code=500,
                    detail=f"Error validating bounding box against image: {str(e)}",
                )

            # Create a simplified detection object with only bbox info
            manual_detection = {
                "bbox": request.bbox,
                "class_name": "manual",  # Fixed value, not from request
            }
            # Generate mask with MedSAM
            print(
                f"[MedSAM-Manual] Generating segmentation mask for {request.image_name}..."
            )
            medsam_start_time = time.time()

            # Apply retry logic
            max_retries = 2
            retry_count = 0
            masks = None

            while retry_count <= max_retries:
                try:
                    masks = medsam_handler.generate_mask(
                        target_image_path, [manual_detection]
                    )
                    break
                except RuntimeError as e:
                    if "CUDA" in str(e) and retry_count < max_retries:
                        print(
                            f"[MedSAM-Manual] CUDA error encountered, retrying ({retry_count+1}/{max_retries})..."
                        )
                        retry_count += 1
                        torch.cuda.empty_cache()
                        time.sleep(1)
                    else:
                        raise

            medsam_time = time.time() - medsam_start_time
            print(f"[MedSAM-Manual] Segmentation completed in {medsam_time:.2f}s")

            if not masks:
                raise HTTPException(
                    status_code=500,
                    detail="Failed to generate mask after multiple attempts",
                )

            # Encode mask using RLE
            mask_files = encode_and_name_masks(
                request.image_name, masks, medsam_handler
            )

            # Simplified response - only the masks
            all_results[request.image_name] = mask_files

            # Log the final completion
            total_time = time.time() - start_time
            print(f"[MedSAM-Manual] Inference completed in {total_time:.2f}s")

            return all_results

    except HTTPException:
        raise
    except Exception as e:
        error_details = traceback.format_exc()
        print(f"Error in medsam_inference_manual: {error_details}")

        if "403" in str(e):
            raise HTTPException(
                status_code=403,
                detail="Access denied. The presigned URL may have expired or is invalid.",
            )
        elif "download" in str(e).lower():
            raise HTTPException(
                status_code=400, detail=f"Error downloading file: {str(e)}"
            )
        else:
            raise HTTPException(
                status_code=500, detail=f"An error occurred during inference: {str(e)}"
            )


def filter_detections(detections):
    """
    Filter detections to keep at most 3 unique classes with highest confidence

    Args:
        detections (list): List of detection dictionaries

    Returns:
        list: Filtered list of detections
    """
    if not detections:
        return []

    # Group detections by class name
    class_groups = defaultdict(list)
    for det in detections:
        class_groups[det["class_name"]].append(det)

    # Get the highest confidence detection for each class
    top_detections_by_class = []
    for class_name, group in class_groups.items():
        # Sort by confidence (descending)
        group.sort(key=lambda x: x["confidence"], reverse=True)
        # Keep the highest confidence detection for each class
        top_detections_by_class.append(group[0])

    # Sort by confidence across classes
    top_detections_by_class.sort(key=lambda x: x["confidence"], reverse=True)

    # Limit to top 3 classes
    return top_detections_by_class[:3]


def encode_and_name_masks(filename, masks, medsam_handler):
    """
    Encode masks using RLE format and name them according to the convention

    Args:
        filename (str): Original image filename
        masks (dict): Dictionary of masks with class names as keys
        medsam_handler (MedSamHandler): Instance of MedSamHandler to use for RLE encoding

    Returns:
        dict: Dictionary of RLE-encoded masks with proper naming
    """
    # Extract user_id, hash_id, frame, and slice from filename
    # Expected format: {user_id}_{hash_id}_{frame}_{slice}.{ext}
    parts = os.path.splitext(filename)[0].split("_")

    if len(parts) >= 4:
        user_id = parts[0]
        hash_id = parts[1]
        frame = parts[2]
        slice_num = parts[3]
    else:
        # If filename doesn't match expected format, use original name
        user_id = "unknown"
        hash_id = "unknown"
        frame = "0"
        slice_num = "0"

    # Encode masks and generate output filenames
    result = {}

    for class_name, mask in masks.items():
        # Encode mask using RLE
        rle_encoded = medsam_handler.encode_rle(mask)

        # Store encoded mask with filename
        result[class_name] = rle_encoded

    return result


def sort_medsam_results(results):
    """
    Sort MedSAM results by slice numbers extracted from filenames.

    Args:
        results: Dictionary with filenames as keys and mask results as values

    Returns:
        dict: Sorted dictionary with consistent ordering
    """

    # Function to extract slice numbers from filename (same as in YoloHandler)
    def get_slice_numbers(filename):
        # Extract the X_Y part from filename
        try:
            parts = filename.split("_")
            # Make sure we have at least 2 parts
            if len(parts) >= 2:
                # Try to get the last two parts before the file extension
                x = int(parts[-2]) if parts[-2].isdigit() else 0
                y_part = parts[-1].split(".")[0]  # Remove file extension
                y = int(y_part) if y_part.isdigit() else 0
                return (x, y)
            return (0, 0)  # Default if pattern doesn't match
        except (ValueError, IndexError):
            return (0, 0)  # Default if parsing fails

    # Sort the keys and create a new ordered dictionary
    sorted_items = sorted(results.items(), key=lambda item: get_slice_numbers(item[0]))
    return dict(sorted_items)
