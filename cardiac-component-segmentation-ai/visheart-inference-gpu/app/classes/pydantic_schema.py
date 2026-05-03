# In zz_gemini/app/classes/pydantic_schema.py
from pydantic import BaseModel, HttpUrl, Field, field_validator
from uuid import UUID
from typing import List, Dict, Any, Literal, Optional 

import math

# JobAcceptedResponse and async request models (ManualBboxJobRequest, JobRequest) remain the same
class JobAcceptedResponse(BaseModel):
    message: str = "Inference job accepted"
    uuid: UUID

class ManualBboxJobRequest(BaseModel):
    url: HttpUrl = Field(..., description="Presigned URL for the tar archive")
    image_name: str = Field(..., description="Name of the image in the archive")
    bbox: List[float] = Field(
        ..., description="Bounding box coordinates [x1, y1, x2, y2]"
    )
    uuid: UUID = Field(
        ..., description="Unique identifier (UUID) for this job provided by the client"
    )
    callback_url: HttpUrl = Field(
        ..., description="URL on the Node.js server where results should be POSTed"
    )

    @field_validator("bbox")
    @classmethod
    def validate_bbox(cls, v):
        # ... (validation logic as before) ...
        if not isinstance(v, list):
            raise ValueError("Bounding box must be a list of coordinates")
        if len(v) != 4:
            raise ValueError(
                "Bounding box must contain exactly 4 values [x1, y1, x2, y2]"
            )
        for i, coord in enumerate(v):
            if not isinstance(coord, (int, float)):
                raise ValueError(f"Coordinate {i} must be a number")
            if math.isnan(coord) or math.isinf(coord):
                raise ValueError(f"Coordinate {i} cannot be NaN or infinity")
        x1, y1, x2, y2 = v
        if x1 >= x2:
            raise ValueError(
                f"Invalid bounding box: x1 ({x1}) must be less than x2 ({x2})"
            )
        if y1 >= y2:
            raise ValueError(
                f"Invalid bounding box: y1 ({y1}) must be less than y2 ({y2})"
            )
        if any(coord < 0 for coord in v):
            raise ValueError("Bounding box coordinates must be positive")
        MAX_DIMENSION = 10000
        if any(coord > MAX_DIMENSION for coord in v):
            raise ValueError(
                f"Coordinate values exceeding {MAX_DIMENSION} are likely invalid"
            )
        width = x2 - x1
        height = y2 - y1
        MIN_SIZE = 5
        if width < MIN_SIZE or height < MIN_SIZE:
            raise ValueError(
                f"Bounding box too small: width={width}, height={height}. Minimum size is {MIN_SIZE}px"
            )
        return v

class SynchronousManualBboxRequest(BaseModel):
    """Request model for synchronous manual MedSAM inference."""
    url: HttpUrl = Field(..., description="Presigned URL for the tar archive")
    image_name: str = Field(..., description="Name of the image in the archive")
    bbox: List[float] = Field(
        ..., description="Bounding box coordinates [x1, y1, x2, y2]"
    )
    uuid: UUID = Field(
        ..., description="Unique identifier (UUID) for this request, provided by the client"
    )

    @field_validator("bbox")
    @classmethod
    def validate_bbox_sync(cls, v):
        # ... (validation logic as before, same as validate_bbox) ...
        if not isinstance(v, list):
            raise ValueError("Bounding box must be a list of coordinates")
        if len(v) != 4:
            raise ValueError(
                "Bounding box must contain exactly 4 values [x1, y1, x2, y2]"
            )
        for i, coord in enumerate(v):
            if not isinstance(coord, (int, float)):
                raise ValueError(f"Coordinate {i} must be a number")
            if math.isnan(coord) or math.isinf(coord):
                raise ValueError(f"Coordinate {i} cannot be NaN or infinity")
        x1, y1, x2, y2 = v
        if x1 >= x2:
            raise ValueError(
                f"Invalid bounding box: x1 ({x1}) must be less than x2 ({x2})"
            )
        if y1 >= y2:
            raise ValueError(
                f"Invalid bounding box: y1 ({y1}) must be less than y2 ({y2})"
            )
        if any(coord < 0 for coord in v):
            raise ValueError("Bounding box coordinates must be positive")
        MAX_DIMENSION = 10000
        if any(coord > MAX_DIMENSION for coord in v):
            raise ValueError(
                f"Coordinate values exceeding {MAX_DIMENSION} are likely invalid"
            )
        width = x2 - x1
        height = y2 - y1
        MIN_SIZE = 5
        if width < MIN_SIZE or height < MIN_SIZE:
            raise ValueError(
                f"Bounding box too small: width={width}, height={height}. Minimum size is {MIN_SIZE}px"
            )
        return v

# --- Updated models for Synchronous Manual MedSAM Endpoint Result ---

class ManualInputBox(BaseModel): # Renamed from DetectionObject for clarity
    """Represents the manually input bounding box with fields similar to YOLO detections."""
    bbox: List[float] # [x1, y1, x2, y2]
    confidence: float = 1.0
    class_id: int = -1 # Placeholder ID for "manual"
    class_name: Literal["manual"] = "manual"


class ResultPerImageManual(BaseModel):
    """Structure for a single image's result in manual MedSAM inference."""
    boxes: List[ManualInputBox]
    masks: Dict[str, str] # e.g., {"manual": "rle_string"}

class MedSamManualSynchronousResult(BaseModel):
    """
    Response model for successful synchronous manual MedSAM inference,
    with nested 'boxes' and 'masks' structure.
    """
    uuid: UUID
    status: Literal["completed"] = "completed"
    result: Dict[str, ResultPerImageManual] # Key is image_filename
    error: Optional[Any] = None

class MedSamManualSynchronousError(BaseModel):
    """Error response model for synchronous manual MedSAM inference."""
    detail: Any
    uuid: UUID

# --- 4D Reconstruction Models ---

class FourDReconstructionJobRequest(BaseModel):
    """Request model for 4D reconstruction job."""
    url: HttpUrl = Field(..., description="Presigned URL for the NiFTI file (.nii or .nii.gz) - supports both 3D and 4D")
    uuid: UUID = Field(
        ..., description="Unique identifier (UUID) for this job provided by the client"
    )
    callback_url: HttpUrl = Field(
        ..., description="URL on the Node.js server where results should be POSTed"
    )
    ed_frame_index: int = Field(
        default=0, 
        description="Zero-indexed frame number for End Diastolic reference (only used for 4D NiFTI)",
        ge=0
    )
    num_iterations: Optional[int] = Field(
        default=50, 
        description="Number of optimization iterations for latent code fitting",
        ge=1, le=500
    )
    resolution: Optional[int] = Field(
        default=128,
        description="Marching cubes resolution for mesh generation",
        ge=32, le=256
    )
    # PHASE 1 EXPERIMENT: Configurable regularization
    code_reg_lambda: Optional[float] = Field(
        default=1e-4,
        description="L2 regularization weight for latent codes. Default 1e-4 (standard). Lower values (1e-5, 1e-6) or 0 allow more extreme shapes.",
        ge=0, le=1e-2
    )
    verbose_logging: Optional[bool] = Field(
        default=False,
        description="Enable detailed optimization logging (latent code norms, regularization losses per epoch)"
    )
    process_all_frames: Optional[bool] = Field(
        default=True,
        description="If True, process all cardiac phases (4D). If False, ED frame only (3D-like)"
    )
    export_format: Optional[Literal["obj", "glb"]] = Field(
        default="obj",
        description="Output mesh format: 'obj' for Wavefront OBJ or 'glb' for binary glTF 2.0"
    )
    debug_save: Optional[bool] = Field(
        default=False,
        description="If true, saves the generated mesh file to a persistent debug location"
    )
    debug_dir: Optional[str] = Field(
        default="/tmp/4d_reconstruction_debug",
        description="Directory path for saving debug files (only used if debug_save is true)"
    )

# --- Bullseye AHA 17-Segment Analysis Models ---

class BullseyeS3Request(BaseModel):
    """Request model for bullseye analysis via S3 presigned URL."""
    s3_url: HttpUrl = Field(..., description="Presigned S3 URL for the NIfTI mask file (.nii or .nii.gz)")
    request_id: Optional[str] = Field(None, description="Optional client-provided request identifier")


class BullseyeSegmentMeta(BaseModel):
    """Metadata for a single AHA segment."""
    idx: int = Field(..., description="AHA segment index (1–17)")
    name: str = Field(..., description="Anatomical segment name")
    ring: str = Field(..., description="Ring name: Basal | Mid-cavity | Apical | Apex")
    value: float = Field(..., description="Mean wall thickness in pixels (NaN if no data)")


class BullseyeStats(BaseModel):
    """Summary statistics across all 17 segments."""
    min: float
    max: float
    mean: float
    n_nan: int = Field(..., description="Number of segments with NaN (no valid slices)")


class BullseyeAnalysisResult(BaseModel):
    """Response model for AHA 17-segment wall-thickness analysis."""
    request_id: Optional[str] = Field(None, description="Echo of the client-provided request_id, if any")
    segment_values: List[float] = Field(..., description="Wall thickness per AHA segment, index 0 = segment 1")
    segment_metadata: List[Dict[str, Any]] = Field(..., description="Per-segment name, ring, and value")
    stats: Dict[str, Any] = Field(..., description="min / max / mean / n_nan across all segments")
    input_shape: List[int] = Field(..., description="Shape of the input mask [H, W, N_slices]")
    slice_labels: List[str] = Field(..., description="Label per slice: basal | mid | apical | apex | none")


class FourDReconstructionResult(BaseModel):
    """Result model for 4D reconstruction job."""
    # For backward compatibility, keep single mesh fields for 3D cases
    mesh_filename: Optional[str] = Field(None, description="Name of the generated mesh file (.npz) - for single frame")
    mesh_file_size: Optional[int] = Field(None, description="Size of the original OBJ file in bytes - for single frame")
    mesh_data: Optional[str] = Field(None, description="Base64 encoded NPZ mesh data (compressed) - for single frame")
    
    # New fields for multi-frame support
    mesh_files: Optional[List[Dict[str, Any]]] = Field(None, description="List of generated mesh files with metadata")
    
    # Common fields
    mesh_format: Literal["npz"] = Field(default="npz", description="Compressed mesh file format")
    original_format: Literal["obj"] = Field(default="obj", description="Original mesh format before compression")
    reconstruction_time: float = Field(..., description="Total reconstruction time in seconds")
    num_iterations: int = Field(..., description="Number of optimization iterations used")
    resolution: int = Field(..., description="Marching cubes resolution used")
    status: Literal["reconstruction_completed"] = "reconstruction_completed"
    message: str = Field(..., description="Status message")
    
    # 4D-specific metadata
    is_4d_input: bool = Field(..., description="Whether input was 4D NiFTI")
    ed_frame_index: int = Field(..., description="ED frame index used")
    total_frames_processed: int = Field(..., description="Number of frames processed")
    temporal_info: Optional[Dict[str, Any]] = Field(None, description="Temporal sequence metadata")