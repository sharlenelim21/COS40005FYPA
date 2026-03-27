# 4D Cardiac Reconstruction Pipeline API Documentation

## Overview

The 4D Cardiac Reconstruction Pipeline provides advanced cardiac mesh reconstruction capabilities using AI-powered SDF (Signed Distance Field) models. This pipeline transforms segmentation masks from cardiac imaging into detailed 3D mesh representations that can be visualized across all cardiac frames.

**Key Features**:
- **Dual Format Support**: Export reconstructions as GLB (default, optimized for web/AR/VR) or OBJ (backward compatible with legacy software)
- **4D Processing**: Generate mesh sequences across all cardiac frames for dynamic visualization
- **AI-Driven**: Leverages deep learning SDF models for high-quality mesh generation
- **Cloud Processing**: GPU-accelerated reconstruction on dedicated inference servers
- **Flexible Parameters**: Customizable resolution, iterations, and frame selection
- **Editable Masks**: Uses user-refined segmentation masks for better reconstruction accuracy

## Segmentation Mask System

The reconstruction pipeline works with a **dual-mask system**:

1. **AI-Generated Masks** (`isMedSAMOutput: true`): Raw output from MedSAM segmentation, automatically created when AI segmentation runs
2. **Editable Masks** (`isMedSAMOutput: false`): User-refined masks that can be manually edited and improved

**Important**: Both mask types exist together in the database after segmentation is completed. However, **reconstruction exclusively uses editable masks** (`isMedSAMOutput: false`) to ensure the highest quality results based on user refinements.

## Architecture

The reconstruction pipeline follows a distributed microservices architecture:

1. **Backend Server** (Node.js/Express) - Handles authentication, project management, and orchestrates reconstruction workflows
2. **GPU Inference Server** (FastAPI) - Processes 4D reconstruction using deep learning models 
3. **Storage Layer** (AWS S3) - Manages input segmentation data and output mesh files
4. **Database** (MongoDB) - Tracks reconstruction jobs, metadata, and user permissions

## Data Flow

```
[Client Request] → [Authentication] → [Segmentation Validation] → [GPU Processing] → [Mesh Generation] → [Storage & Database]
```

1. Client initiates reconstruction request with project ID and parameters
2. Server validates user permissions and **editable segmentation mask availability**
3. **Editable mask** data is packaged and sent to GPU server
4. GPU processes 4D cardiac reconstruction using SDF models
5. Resulting mesh files (GLB or OBJ) are returned via webhook callbacks
6. Server packages meshes into TAR archives and stores in S3
7. Reconstruction metadata is saved to database with download URLs

## Typical Workflow

```
User uploads NIfTI → Run AI Segmentation → Two masks created:
                                         ├─ AI-generated mask (isMedSAMOutput: true) - stored as reference
                                         └─ Editable mask (isMedSAMOutput: false) - used for reconstruction
                                                          ↓
                                         User refines/edits editable mask (optional)
                                                          ↓
                                         Start 4D Reconstruction → Uses ONLY editable mask
```

**Note**: Even if the user doesn't manually edit the masks, the editable mask (`isMedSAMOutput: false`) is automatically created and used for reconstruction. The AI-generated mask (`isMedSAMOutput: true`) is kept as a reference copy.

---

## API Endpoints

### Base Path: `/reconstruction`

All reconstruction endpoints require authentication via session cookies. GPU server communication is handled automatically by the backend.

### Endpoint Summary

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/start-reconstruction/:projectId` | POST | Start 4D reconstruction job | User/Admin |
| `/reconstruction-results/:projectId` | GET | Get reconstruction results with download URLs | Any authenticated |
| `/user-check-jobs` | GET | Check all reconstruction jobs for current user | Any authenticated |
| `/batch-reconstruction-status` | POST | Batch check reconstruction status for multiple projects | Any authenticated |
| `/delete-project-reconstructions/:projectId` | DELETE | Delete all reconstructions for a project | User/Admin |

---

## 1. Start 4D Reconstruction

**Endpoint**: `POST /reconstruction/start-reconstruction/:projectId`

**Description**: Initiates 4D cardiac reconstruction processing for a project with completed editable segmentation masks.

**Authentication**: Required (User or Admin role, Guest users blocked)

**URL Parameters**:
- `projectId` (string, required): MongoDB project ID to reconstruct

**Request Body**: `application/json`
```json
{
  "reconstructionName": "string",
  "reconstructionDescription": "string", 
  "parameters": {
    "num_iterations": "number",
    "resolution": "number", 
    "process_all_frames": "boolean",
    "debug_save": "boolean",
    "debug_dir": "string"
  },
  "ed_frame": "number",
  "export_format": "string"
}
```

### Request Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `reconstructionName` | string | ❌ | `"4D Reconstruction - {ISO timestamp}"` | Name for the reconstruction job |
| `reconstructionDescription` | string | ❌ | `"4D cardiac reconstruction using SDF model"` | Description of the reconstruction |
| `ed_frame` | number | ✅ | `1` | End-diastolic frame number (1-based indexing) |
| `export_format` | string | ❌ | `"glb"` | Export format for the reconstruction mesh. Supported formats: `"glb"` (default, optimized for web/AR/VR) or `"obj"` (backward compatible, widely supported). GLB provides smaller file sizes and better performance for 3D visualization. |
| `parameters.num_iterations` | number | ❌ | `50` | SDF optimization iterations (range: 1-200) |
| `parameters.resolution` | number | ❌ | `128` | Mesh resolution (range: 32-256) |
| `parameters.process_all_frames` | boolean | ❌ | `true` | Enable 4D processing across all cardiac frames |
| `parameters.debug_save` | boolean | ❌ | `false` | Save debug outputs to persistent location |
| `parameters.debug_dir` | string | ❌ | `"/tmp/4d_reconstruction_debug"` | Debug directory path for intermediate files |

**Prerequisites**:
- Project must exist and belong to the authenticated user
- Project must have completed editable segmentation masks (`isMedSAMOutput: false`)
  - **Note**: Both AI-generated (`isMedSAMOutput: true`) and editable (`isMedSAMOutput: false`) masks exist together after segmentation
  - Reconstruction uses **only the editable mask** for processing
- Valid `ed_frame` parameter within project's frame range

**Success Response** (HTTP 200):
```json
{
  "message": "4D reconstruction job accepted. UUID: {job-uuid}",
  "uuid": "string - Unique job identifier for tracking"
}
```

**Error Responses**:
- **400 Bad Request**: Invalid `ed_frame` parameter or missing required fields
- **403 Forbidden**: User lacks access to the specified project  
- **404 Not Found**: Project does not exist
- **500 Internal Server Error**: GPU server communication failure or segmentation validation error

**Example Request**:
```bash
curl -X POST https://api.visheart.art/reconstruction/start-reconstruction/507f1f77bcf86cd799439011 \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=your-session-cookie" \
  -d '{
    "reconstructionName": "Patient A - ED Analysis",
    "reconstructionDescription": "4D reconstruction for end-diastolic analysis",
    "parameters": {
      "num_iterations": 75,
      "resolution": 256,
      "process_all_frames": true
    },
    "ed_frame": 12,
    "export_format": "glb"
  }'
```

**Notes on Export Formats**:
- **GLB (default)**: Binary glTF format optimized for web rendering, AR/VR applications. Smaller file sizes, faster loading, better performance in modern 3D viewers.
- **OBJ (backward compatible)**: Wavefront OBJ format, widely supported across legacy 3D software. Text-based format with separate material files.
- **Format Selection Priority**: User-specified `export_format` parameter → Environment variable `RECONSTRUCTION_MESH_FORMAT` → Default (GLB)

---

## 2. Get Reconstruction Results

**Endpoint**: `GET /reconstruction/reconstruction-results/:projectId`

**Description**: Retrieves all 4D reconstruction results for a specific project, including presigned download URLs for mesh files.

**Export/Download Mechanism**: This endpoint generates **fresh presigned S3 URLs** on every request. The reconstruction TAR files are stored permanently in S3, and each API call creates a new temporary download URL with a 1-hour expiry. This means:
- ✅ Reconstructions persist indefinitely (until manually deleted)
- ✅ Export functionality works at any time, even days/weeks after reconstruction
- ✅ Each request generates a fresh download URL with a new 1-hour timer
- ⚠️ Do not cache download URLs - always fetch fresh when exporting

**Authentication**: Required (Any authenticated user)

**URL Parameters**:
- `projectId` (string, required): MongoDB project ID

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "reconstructions": [
    {
      "reconstructionId": "string - MongoDB reconstruction document ID",
      "name": "string - User-defined reconstruction name", 
      "description": "string - Reconstruction description",
      "isSaved": "boolean - Whether reconstruction is marked as saved",
      "isAIGenerated": "boolean - Whether reconstruction was AI-generated", 
      "meshFormat": "string - Mesh file format ('GLB' or 'OBJ', packaged as TAR archive)",
      "meshFileSize": "number - File size in bytes (from reconstructedMesh)",
      "downloadUrl": "string|null - Presigned S3 URL for mesh download (1 hour expiry, null if no mesh)",
      "metadata": {
        "edFrameIndex": "number - End-diastolic frame used (1-based from ed_frame)",
        "reconstructionTime": "number - Processing time in seconds", 
        "numIterations": "number - SDF optimization iterations used",
        "resolution": "number - Mesh resolution",
        "filename": "string - Generated mesh filename", 
        "filesize": "number - File size in bytes (root level)",
        "filehash": "string - SHA256 hash for integrity verification"
      },
      "createdAt": "string (ISO 8601) - Creation timestamp",
      "updatedAt": "string (ISO 8601) - Last modification timestamp"
    }
  ]
}
```

**No Results Response** (HTTP 200):
```json
{
  "message": "No reconstruction results found for this project.",
  "success": false,
  "reconstructions": []
}
```

**Error Responses**:
- **400 Bad Request**: Missing or invalid project ID
- **404 Not Found**: Project does not exist
- **500 Internal Server Error**: Database or S3 access error

**Example Request**:
```bash
curl -X GET https://api.visheart.art/reconstruction/reconstruction-results/507f1f77bcf86cd799439011 \
  -H "Cookie: connect.sid=your-session-cookie"
```

---

## 3. Check User Reconstruction Jobs

**Endpoint**: `GET /reconstruction/user-check-jobs`

**Description**: Retrieves all reconstruction jobs for the authenticated user, including job status and queue position.

**Authentication**: Required (Any authenticated user)

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "activeJobCount": "number - Count of pending/in-progress jobs",
  "totalJobs": "number - Total jobs returned (limited to 20 recent)",
  "jobs": [
    {
      "jobId": "string - Job UUID",
      "projectId": "string - Associated project ID",
      "status": "string - Job status (PENDING, IN_PROGRESS, COMPLETED, FAILED)",
      "name": "string - Job name",
      "description": "string - Job description",
      "queuePosition": "number|null - Queue position for pending jobs (1-based)"
    }
  ]
}
```

**Job Status Values**:
- `PENDING`: Job submitted and waiting for GPU processing
- `IN_PROGRESS`: Currently being processed by GPU server
- `COMPLETED`: Processing finished successfully
- `FAILED`: Processing failed due to error

**Error Response** (HTTP 500):
```json
{
  "success": false,
  "message": "An error occurred while fetching reconstruction jobs"
}
```

**Example Request**:
```bash
curl -X GET https://api.visheart.art/reconstruction/user-check-jobs \
  -H "Cookie: connect.sid=your-session-cookie"
```

---

## 4. Batch Reconstruction Status Check

**Endpoint**: `POST /reconstruction/batch-reconstruction-status`

**Description**: Batch endpoint for checking reconstruction status of multiple projects in a single request. Optimized for dashboard views that need to display reconstruction status across many projects.

**Authentication**: Required (Any authenticated user)

**Request Body**: `application/json`
```json
{
  "projectIds": ["string", "string", ...]
}
```

**Request Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectIds` | array of strings | ✅ | Array of MongoDB project IDs to check (max 50) |

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "statuses": {
    "507f1f77bcf86cd799439011": {
      "hasReconstructions": true,
      "reconstructionCount": 3
    },
    "507f1f77bcf86cd799439012": {
      "hasReconstructions": false,
      "reconstructionCount": 0
    }
  }
}
```

**Response Fields**:
- `success` (boolean): Whether the batch operation succeeded
- `statuses` (object): Map of project IDs to their reconstruction status
  - `hasReconstructions` (boolean): Whether project has any completed reconstructions
  - `reconstructionCount` (number): Total number of reconstructions for this project

**Error Responses**:
- **400 Bad Request**: Invalid or empty `projectIds` array, or batch size exceeds 50 projects
- **401 Unauthorized**: User not authenticated
- **403 Forbidden**: User attempting to access projects they don't own
- **500 Internal Server Error**: Database query error

**Example Request**:
```bash
curl -X POST https://api.visheart.art/reconstruction/batch-reconstruction-status \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=your-session-cookie" \
  -d '{
    "projectIds": [
      "507f1f77bcf86cd799439011",
      "507f1f77bcf86cd799439012",
      "507f1f77bcf86cd799439013"
    ]
  }'
```

**Performance Notes**:
- Uses MongoDB aggregation pipeline for efficient batch queries
- Validates user ownership of all requested projects
- Limited to 50 projects per request to prevent abuse
- Ideal for dashboard/gallery views displaying multiple projects

---

## 5. Delete Project Reconstructions

**Endpoint**: `DELETE /reconstruction/delete-project-reconstructions/:projectId`

**Description**: Deletes all reconstruction data for a project, including database records and S3 mesh files. Designed for workflows where masks are re-edited and only one reconstruction should be kept at a time.

**Authentication**: Required (User or Admin role, Guest users blocked)

**URL Parameters**:
- `projectId` (string, required): MongoDB project ID

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "message": "Successfully deleted 3 reconstruction(s).",
  "deletedCount": 3
}
```

**No Reconstructions Response** (HTTP 200):
```json
{
  "success": true,
  "message": "No reconstructions to delete.",
  "deletedCount": 0
}
```

**Error Responses**:
- **400 Bad Request**: Missing project ID
- **401 Unauthorized**: User not authenticated
- **403 Forbidden**: User does not own the project or project not found
- **500 Internal Server Error**: S3 deletion or database operation error

**Example Request**:
```bash
curl -X DELETE https://api.visheart.art/reconstruction/delete-project-reconstructions/507f1f77bcf86cd799439011 \
  -H "Cookie: connect.sid=your-session-cookie"
```

**Processing Flow**:
1. Verifies user owns the project
2. Fetches all reconstructions for the project
3. Deletes mesh TAR files from S3 storage
4. Deletes reconstruction database records
5. Returns count of successfully deleted reconstructions

**Use Cases**:
- User wants to re-run reconstruction after editing segmentation masks
- Cleaning up old/incorrect reconstructions
- Managing storage space by removing unused reconstructions
- Project workflow reset before final reconstruction

**Important Notes**:
- **Irreversible operation**: Deleted reconstructions cannot be recovered
- **S3 cleanup**: Automatically removes mesh files from cloud storage
- **Job status**: Does not cancel in-progress reconstruction jobs
- **Permissions**: Only project owner can delete reconstructions

---

## GPU Webhook Callback (Internal)

**Endpoint**: `POST /webhook/gpu-reconstruction-callback`

**Description**: Internal webhook endpoint for receiving reconstruction results from the GPU server. This endpoint is not intended for direct client use.

**Authentication**: GPU server authentication (automatic)

**Request Format**: `multipart/form-data`
- OBJ or GLB mesh files for each cardiac frame (format depends on `export_format` parameter)
- JSON metadata with reconstruction parameters and results

**Processing Flow**:
1. Validates incoming mesh files (supports both .obj and .glb formats)
2. Creates TAR archive containing all frame meshes  
3. Uploads TAR to S3 with project-based organization
4. Creates reconstruction database record with metadata
5. Updates job status to COMPLETED

**Supported Mesh Formats**:
- **GLB files**: Binary glTF format validated by checking glTF magic number (0x46546C67)
- **OBJ files**: Wavefront OBJ format validated by checking for vertex/face definitions

---

## Mesh Format Support

The reconstruction pipeline supports two primary mesh export formats:

### GLB Format (Default, Recommended)
**File Extension**: `.glb`  
**Description**: Binary glTF (GL Transmission Format)  
**Advantages**:
- ✅ Optimized for web rendering and real-time 3D applications
- ✅ Smaller file sizes (typically 30-50% smaller than OBJ)
- ✅ Faster loading and parsing performance
- ✅ Native support in modern web browsers and AR/VR platforms
- ✅ Single-file format (all data embedded)
- ✅ Supports animations, materials, and PBR textures

**Best For**: Web-based 3D viewers, AR/VR applications, modern visualization platforms

### OBJ Format (Backward Compatible)
**File Extension**: `.obj`  
**Description**: Wavefront OBJ format  
**Advantages**:
- ✅ Widely supported across legacy 3D software (Maya, Blender, 3ds Max, etc.)
- ✅ Human-readable text format
- ✅ Easy to debug and inspect manually
- ✅ Compatible with older 3D modeling tools

**Best For**: Legacy 3D software integration, manual mesh inspection, compatibility with older tools

### Format Comparison Table

| Feature | GLB | OBJ |
|---------|-----|-----|
| File Size | Smaller (binary) | Larger (text) |
| Web Performance | Excellent | Good |
| Browser Support | Native (modern) | Requires loader |
| AR/VR Ready | ✅ Yes | ⚠️ Requires conversion |
| Legacy Software | Limited | Excellent |
| Human Readable | ❌ No | ✅ Yes |
| Single File | ✅ Yes | ✅ Yes |
| Animation Support | ✅ Yes | ❌ No |

### TAR Archive Packaging

Regardless of mesh format (GLB or OBJ), all reconstruction results are packaged as **TAR archives** for efficient storage and transfer:
- **Naming Convention**: `{userId}_{filehash}_mesh.tar`
- **Contents**: All cardiac frame meshes with GPU-generated filenames `gpu_callback_{timestamp}_{uuid}.nii_4D_frame{frame_number}_{frame_label}.{format}`
- **Storage**: S3 bucket with presigned download URLs (1-hour expiry)
- **Extraction**: Standard TAR tools on all platforms (`tar -xf mesh.tar`)

**Example TAR Contents (GLB format)**:
```
gpu_callback_1761471371546_0545be3b-702d-459c-9fea-2b167391a34b.nii_4D_frame00_ED.glb  (ED frame)
gpu_callback_1761471371546_0545be3b-702d-459c-9fea-2b167391a34b.nii_4D_frame01.glb
gpu_callback_1761471371546_0545be3b-702d-459c-9fea-2b167391a34b.nii_4D_frame02.glb
gpu_callback_1761471371546_0545be3b-702d-459c-9fea-2b167391a34b.nii_4D_frame03.glb
...
gpu_callback_1761471371546_0545be3b-702d-459c-9fea-2b167391a34b.nii_4D_frame29.glb
```

**Example TAR Contents (OBJ format)**:
```
gpu_callback_1761471371546_0545be3b-702d-459c-9fea-2b167391a34b.nii_4D_frame00_ED.obj  (ED frame)
gpu_callback_1761471371546_0545be3b-702d-459c-9fea-2b167391a34b.nii_4D_frame01.obj
gpu_callback_1761471371546_0545be3b-702d-459c-9fea-2b167391a34b.nii_4D_frame02.obj
gpu_callback_1761471371546_0545be3b-702d-459c-9fea-2b167391a34b.nii_4D_frame03.obj
...
gpu_callback_1761471371546_0545be3b-702d-459c-9fea-2b167391a34b.nii_4D_frame29.obj
```

**Filename Pattern**: `gpu_callback_{timestamp}_{uuid}.nii_4D_frame{frame_number}_{frame_label}.{format}`
- `gpu_callback`: Fixed prefix for all reconstruction output files
- `timestamp`: Unix timestamp in milliseconds/unique identifier (e.g., `1761471371546`)
- `uuid`: Job/reconstruction UUID (e.g., `0545be3b-702d-459c-9fea-2b167391a34b`)
- `frame_number`: Frame number with zero-padding (00, 01, 02, ..., 29)
- `frame_label`: Frame label such as `ED` (End-Diastole) - appears only on specific cardiac phase frames
- `format`: File extension (`.glb` or `.obj`)

**Frame Label Conventions**:
- `_ED`: End-Diastolic frame (appears on the frame specified by `ed_frame` parameter)
- No label: Regular frames that are not specific cardiac phases

**Note**: 
- Frame numbering starts at **00** (default), with the **ED (End-Diastolic) frame marked with `_ED` suffix** (e.g., `frame00_ED`) based on the `ed_frame` parameter specified during reconstruction.
- **Only the ED frame has the `_ED` suffix** - all other frames use standard naming (e.g., `frame01`, `frame02`, etc.).
- OBJ format reconstruction outputs are **standalone mesh files without material (.mtl) files**. The GPU server generates geometry-only OBJ files that do not require separate material definitions.
- Both formats contain the same number of frames and follow identical naming conventions.
- Filenames are generated by the GPU server and include the original NIfTI filename, timestamp, and reconstruction UUID.
- **Timestamp difference**: OBJ and GLB files may have slightly different timestamps since OBJ is generated first, then converted to GLB (if GLB format is requested).

---

## Error Handling

### Common Error Scenarios

**Authentication Errors**:
```json
{
  "message": "Authentication required"
}
```

**Insufficient Permissions**:
```json
{
  "message": "Access denied to this project"
}
```

**Missing Editable Segmentation**:
```json
{
  "message": "4D reconstruction requires completed segmentation masks. Please complete or refine segmentation before starting reconstruction."
}
```

**Invalid Frame Parameter**:
```json
{
  "message": "Invalid end-diastole frame number: 25. Must be a positive integer >= 1."
}
```

**GPU Server Communication Failure**:
```json
{
  "message": "Failed to start 4D reconstruction: Error communicating with Cloud GPU"
}
```

---

## Prerequisites & Dependencies

### Project Requirements
- **Completed Project Upload**: NIfTI/DICOM files successfully uploaded and processed
- **Editable Segmentation**: Project must have editable/refined segmentation masks (`isMedSAMOutput: false`)
- **Frame Validation**: `ed_frame` parameter must be within project's actual frame count

### System Dependencies
- **GPU Server**: Active connection to inference server with SDF models
- **S3 Storage**: Configured AWS bucket for mesh file storage
- **Database**: MongoDB connection for job tracking and metadata

### Authentication Requirements
- **User Session**: Valid session cookie from `/auth/login`
- **Role Permissions**: User or Admin role (Guest users blocked)
- **Project Access**: User must own or have access to the target project

---

## Performance & Limitations

### Processing Times
- **Typical reconstruction**: 3-10 minutes for standard cardiac datasets
- **High-resolution (256+)**: 10-20 minutes depending on frame count
- **Queue wait time**: Variable based on GPU server load

### File Size Limits
- **Input segmentation**: Generated automatically from existing project data
- **Output meshes (GLB, Single frame)**: Typically 30-70MB TAR archives per reconstruction
- **Output meshes (GLB, Multiple frames)**: Typically 100-150MB TAR archives for ~30 cardiac frames
- **Output meshes (OBJ, Single frame)**: Typically 50-100MB TAR archives per reconstruction
- **Output meshes (OBJ, Multiple frames)**: Typically 150-200MB TAR archives for ~30 cardiac frames
- **Format efficiency**: GLB files are typically 30-50% smaller than OBJ equivalents
- **S3 storage**: No explicit limits, managed by AWS billing

### Rate Limiting
- **Concurrent jobs**: Limited by GPU server capacity
- **User limits**: No explicit per-user limits currently enforced
- **Queue management**: FIFO processing with status tracking

### Best Practices
1. **Frame Selection**: Choose end-diastolic frames carefully for optimal results
2. **Parameter Tuning**: Start with default parameters before optimizing
3. **Status Monitoring**: Use `/user-check-jobs` endpoint to track progress
4. **Error Handling**: Implement retry logic for GPU server communication failures
5. **Resource Management**: Allow adequate processing time before retry attempts

---

## Troubleshooting

### Common Issues

**"No editable segmentation masks found"**
- Ensure segmentation has been completed or refined/edited by the user
- Raw AI segmentation masks (unedited) are not supported for reconstruction
- Verify segmentation masks have `isMedSAMOutput: false` (editable masks)

**"End-diastole frame X exceeds project frame count"**
- Check project metadata for actual frame count
- Use 1-based indexing for `ed_frame` parameter
- Verify frame count via project details endpoint

**"Failed to start 4D reconstruction: GPU server communication error"**  
- Check GPU server status and connectivity
- Verify AWS S3 access and credentials
- Review server logs for detailed error messages

**Reconstruction jobs stuck in PENDING status**
- Monitor GPU server queue via `/user-check-jobs`
- Check server logs for processing bottlenecks
- Contact system administrator if queues are stalled

### Debug Information

Enable debug mode by setting `debug_save: true` in reconstruction parameters:
```json
{
  "parameters": {
    "debug_save": true,
    "debug_dir": "/tmp/debug_reconstruction"
  }
}
```

This saves intermediate processing files for troubleshooting mesh generation issues.

### Support Contacts

For technical issues:
- Review server logs at `/logs/winston_logger/`
- Check GPU server status endpoint
- Contact development team with job UUID and error details