# In zz_gemini/app/routes/inference_route.py
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from pydantic import BaseModel, HttpUrl, Field, field_validator
import os, asyncio, traceback
from uuid import UUID
from typing import (
    Dict,
    List,
    Any,
    Literal,
)  # Added Any for MedSamManualSynchronousError
try:
    from typing import Annotated
except ImportError:
    from typing_extensions import Annotated

# Import handlers and dependencies
from app.classes.file_fetch_handler import FileFetchHandler
from app.classes.yolo_handler import YoloHandler
from app.dependencies.model_init import get_yolo_model
from app.classes.medsam_handler import MedSamHandler
from app.dependencies.model_init import get_medsam_model
from app.classes.fourdreconstruction_handler import FourDReconstructionHandler
from app.dependencies.model_init import get_fourd_reconstruction_model

# Import the verification dependency and the payload model
from app.security.backend_authentication import conditional_verify_jwt, TokenPayLoad

# Import inference jobs
from app.helpers.inference_jobs import (
    process_bbox_job_with_semaphore,
    process_medsam_job_with_semaphore,
    execute_medsam_manual_job_synchronously,
    process_fourd_reconstruction_job_with_semaphore,
    process_unet_job_with_semaphore,
    process_landmark_job_with_semaphore,
)

from app.helpers.inference_helpers import (
    filter_detections,
    encode_and_name_masks,
    sort_medsam_results,
)

# Import the request and response models
from app.classes.pydantic_schema import (
    JobAcceptedResponse,
    SynchronousManualBboxRequest,
    MedSamManualSynchronousResult,  # Updated model
    MedSamManualSynchronousError,
    FourDReconstructionJobRequest,
    FourDReconstructionResult,
    ResultPerImageManual,  # Add this missing import
)

router = APIRouter()


# Sample route (remains the same)
@router.get("/sample")
async def sample(
    token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
):
    client_id = token_payload.sub
    print(f"Client ID: {client_id} - Token is valid")
    image_path = os.path.join(
        os.path.dirname(__file__),
        "..",
        "images",
        "681192f4a2a37c21a2bd7532_6811d7c8136add126d3f0bd9_0_0.jpg",
    )
    if not os.path.exists(image_path):
        return {"message": "Sample route working, but sample image not found."}
    return FileResponse(image_path, media_type="image/jpeg")


# JobRequest for async endpoints (remains the same)
class JobRequest(BaseModel):
    url: HttpUrl = Field(
        ..., description="Presigned URL for the image file or tar archive"
    )
    uuid: UUID = Field(..., description="Unique identifier for this job")
    callback_url: HttpUrl = Field(..., description="Callback URL for sending results")


class UnetInferenceRequest(BaseModel):
    url: HttpUrl = Field(..., description="Presigned URL for input NIfTI file")
    uuid: UUID = Field(..., description="Unique identifier for this UNET inference request")
    callback_url: HttpUrl = Field(..., description="Callback URL for sending results")
    device: Literal["cpu", "cuda", "auto"] = Field(default="auto", description="Compute device: cpu, cuda, or auto")
    checkpoint_path: str | None = Field(default=None, description="Optional checkpoint override path")
    segmentation_model: Literal["unet"] = Field(default="unet", description="Model tag used by webhook processing")

    @field_validator('device')
    @classmethod
    def validate_device(cls, v: str) -> str:
        """Validate device field contains only allowed values."""
        allowed_devices = {"cpu", "cuda", "auto"}
        if v not in allowed_devices:
            raise ValueError(
                f"Invalid device '{v}'. Must be one of: {', '.join(allowed_devices)}"
            )
        return v


class LandmarkInferenceRequest(BaseModel):
    url: HttpUrl = Field(..., description="Presigned URL for input NIfTI file")
    uuid: UUID = Field(..., description="Unique identifier for this landmark inference request")
    callback_url: HttpUrl = Field(..., description="Callback URL for sending results")
    model: str = Field(default="unetresnet34-landmark", description="Landmark model tag")
    device: Literal["cpu", "cuda", "auto"] = Field(default="auto", description="Compute device: cpu, cuda, or auto")
    checkpoint_path: str | None = Field(default=None, description="Optional checkpoint override path")

    @field_validator('device')
    @classmethod
    def validate_device(cls, v: str) -> str:
        allowed_devices = {"cpu", "cuda", "auto"}
        if v not in allowed_devices:
            raise ValueError(f"Invalid device '{v}'. Must be one of: {', '.join(allowed_devices)}")
        return v


# Async /bbox-inference (remains the same)
@router.post(
    "/bbox-inference",
    status_code=202,
    response_model=JobAcceptedResponse,
)
async def queue_bbox_inference(
    token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
    request: JobRequest,
    yolo_handler: YoloHandler = Depends(get_yolo_model),
):
    client_id = token_payload.sub
    print(f"Received bbox job {request.uuid} from client {client_id}")
    asyncio.create_task(
        process_bbox_job_with_semaphore(
            input_url=request.url,
            uuid=request.uuid,
            callback_url=request.callback_url,
            yolo_handler=yolo_handler,
        )
    )
    print(f"[{request.uuid}] BBox task added.")
    response_data = JobAcceptedResponse(uuid=request.uuid)
    return response_data


# Async /medsam-inference (remains the same)
@router.post(
    "/medsam-inference",
    status_code=202,
    response_model=JobAcceptedResponse,
)
async def queue_medsam_inference(
    token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
    request: JobRequest,
    yolo_handler: YoloHandler = Depends(get_yolo_model),
    medsam_handler: MedSamHandler = Depends(get_medsam_model),
):
    client_id = token_payload.sub
    print(f"Received MedSAM job {request.uuid} from client {client_id}")
    asyncio.create_task(
        process_medsam_job_with_semaphore(
            input_url=request.url,
            uuid=request.uuid,
            callback_url=request.callback_url,
            yolo_handler=yolo_handler,
            medsam_handler=medsam_handler,
        )
    )
    print(f"[{request.uuid}] MedSAM task added.")
    response_data = JobAcceptedResponse(uuid=request.uuid)
    return response_data


@router.post(
    "/unet-inference",
    status_code=202,
    response_model=JobAcceptedResponse,
    summary="Asynchronous UNET inference for NIfTI input",
)
async def unet_inference_async(
    token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
    request: UnetInferenceRequest,
    background_tasks: BackgroundTasks,
):
    client_id = token_payload.sub
    print(f"Received UNET inference job {request.uuid} from client {client_id}")

    background_tasks.add_task(
        process_unet_job_with_semaphore,
        input_url=request.url,
        uuid=request.uuid,
        callback_url=request.callback_url,
        device=request.device,
        checkpoint_path=request.checkpoint_path,
    )

    print(f"[{request.uuid}] UNET async task added.")
    response_data = JobAcceptedResponse(uuid=request.uuid)
    return response_data


@router.post(
    "/landmark-detection",
    status_code=202,
    response_model=JobAcceptedResponse,
    summary="Asynchronous landmark detection for NIfTI input",
)
async def landmark_detection_async(
    token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
    request: LandmarkInferenceRequest,
    background_tasks: BackgroundTasks,
):
    client_id = token_payload.sub
    print(f"Received landmark detection job {request.uuid} from client {client_id}")

    background_tasks.add_task(
        process_landmark_job_with_semaphore,
        input_url=request.url,
        uuid=request.uuid,
        callback_url=request.callback_url,
        device=request.device,
        checkpoint_path=request.checkpoint_path,
    )

    print(f"[{request.uuid}] Landmark async task added.")
    return JobAcceptedResponse(uuid=request.uuid)


# --- MODIFIED Synchronous MedSAM Manual Inference Endpoint ---
@router.post(
    "/medsam-inference-manual",
    response_model=MedSamManualSynchronousResult,  # This model now expects the nested structure
    summary="Synchronous MedSAM Manual Inference with Nested Result",
    # ... (description and responses as before) ...
)
async def medsam_inference_manual_synchronous(
    token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
    request: SynchronousManualBboxRequest,
    medsam_handler: MedSamHandler = Depends(get_medsam_model),
) -> MedSamManualSynchronousResult:
    # ... (client_id print statement) ...
    try:
        # execute_medsam_manual_job_synchronously now returns Dict[str, ResultPerImageManual]
        segmentation_results: Dict[str, ResultPerImageManual] = (
            await execute_medsam_manual_job_synchronously(
                input_url=request.url,
                uuid=request.uuid,
                image_name=request.image_name,
                bbox=request.bbox,
                medsam_handler=medsam_handler,
            )
        )

        print(
            f"[{request.uuid}] SYNC Manual MedSAM task completed with nested structure. Returning results."
        )
        return MedSamManualSynchronousResult(
            uuid=request.uuid,
            status="completed",
            result=segmentation_results,  # This now correctly fits the updated MedSamManualSynchronousResult.result type
            error=None,
        )

    except HTTPException as http_exc:
        print(
            f"[{request.uuid}] SYNC Manual MedSAM task failed with HTTPException: Status {http_exc.status_code}, Detail: {http_exc.detail}"
        )
        # To make error responses also structured with uuid, if the detail from execute_medsam_manual_job_synchronously
        # is already {"detail": "message", "uuid": "id_str"}, FastAPI will pass it through.
        # If you want errors to also have the "status/result/error" structure, you'd need to catch HTTPException
        # here and return a custom JSONResponse, e.g.:
        # from fastapi.responses import JSONResponse
        # error_content = {
        #     "uuid": str(request.uuid), # Assuming request.uuid is available
        #     "status": "failed",
        #     "result": None,
        #     "error": http_exc.detail.get("detail") if isinstance(http_exc.detail, dict) else http_exc.detail
        # }
        # return JSONResponse(status_code=http_exc.status_code, content=error_content)
        # For now, re-raising to use FastAPI's default HTTPException handling which uses MedSamManualSynchronousError.
        raise http_exc
    except Exception as e:
        error_details = traceback.format_exc()
        print(
            f"[{request.uuid}] Unexpected error in SYNC Manual MedSAM endpoint: {str(e)}. Traceback: {error_details}"
        )
        # This will use the MedSamManualSynchronousError model due to FastAPI's exception handling if the detail is structured.
        raise HTTPException(
            status_code=500,
            detail={
                "detail": f"An unexpected server error occurred: {str(e)}",
                "uuid": str(request.uuid),
            },
        )


# # Async 3D reconstruction endpoint (remains the same)
# @router.post(
#     "/3d-reconstruction",
#     status_code=202,
#     response_model=JobAcceptedResponse,
# )
# async def queue_3d_reconstruction(
#     token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
#     request: JobRequest,
#     file_fetch_handler: FileFetchHandler = Depends(FileFetchHandler),
# ):


# 4D Reconstruction endpoint
@router.post(
    "/4d-reconstruction",
    status_code=202,
    response_model=JobAcceptedResponse,
)
async def queue_4d_reconstruction(
    token_payload: Annotated[TokenPayLoad, Depends(conditional_verify_jwt)],
    request: FourDReconstructionJobRequest,
    fourd_handler: FourDReconstructionHandler = Depends(get_fourd_reconstruction_model),
):
    """
    Queue a 4D myocardium reconstruction job.
    
    This endpoint accepts a single NiFTI segmentation file and reconstructs 
    a 3D mesh of the myocardium using the 4D decoupled motion and shape model.
    
    Args:
        request: 4D reconstruction job request containing NiFTI file URL and parameters
        fourd_handler: 4D reconstruction model handler (injected)
        
    Returns:
        Job acceptance confirmation with UUID
    """
    try:
        # Start the 4D reconstruction job in background
        asyncio.create_task(
            process_fourd_reconstruction_job_with_semaphore(
                request,
                fourd_handler
            )
        )

        return JobAcceptedResponse(uuid=request.uuid)

    except Exception as e:
        print(f"Error queuing 4D reconstruction job {request.uuid}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to queue 4D reconstruction job: {str(e)}"
        )
