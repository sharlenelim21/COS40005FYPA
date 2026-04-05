# 4D Myocardium Reconstruction API

## Sample JSON Job Request

### Endpoint
```
POST /inference/v2/4d-reconstruction
```

### Headers
```json
{
  "Content-Type": "application/json",
  "Authorization": "Bearer YOUR_JWT_TOKEN"
}
```

### Sample Request Body

```json
{
  "url": "https://your-s3-bucket.s3.amazonaws.com/patient001_frame01_gt.nii.gz?AWSAccessKeyId=AKIA...&Signature=...",
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "callback_url": "https://your-node-server.com/api/reconstruction/callback",
  "num_iterations": 50,
  "resolution": 128
}
```

### Request Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string (HttpUrl) | ✅ | Presigned URL for the NiFTI file (.nii or .nii.gz) |
| `uuid` | string (UUID) | ✅ | Unique identifier for this job provided by the client |
| `callback_url` | string (HttpUrl) | ✅ | URL on your server where results should be POSTed |
| `num_iterations` | integer | ❌ | Number of optimization iterations (default: 50, range: 1-200) |
| `resolution` | integer | ❌ | Marching cubes resolution for mesh generation (default: 128, range: 32-256) |
| `extract_point_cloud` | boolean | ❌ | If true, exports pre-marching-cubes point cloud per frame (default: false) |
| `point_cloud_format` | string | ❌ | Point cloud format when extraction enabled: `npy` or `ply` (default: `npy`) |
| `extract_sdf` | boolean | ❌ | If true, exports dense pre-marching-cubes SDF volume per frame as `.npy` (default: false) |
| `verify_sdf_sign` | boolean | ❌ | If true, writes per-frame sign spot-check JSON (`inside negative`, `outside positive`) |
| `debug_save` | boolean | ❌ | Save OBJ file to persistent debug location (default: false) |
| `debug_dir` | string | ❌ | Debug directory path (default: "/tmp/4d_reconstruction_debug") |

### Response (202 Accepted)

```json
{
  "message": "Inference job accepted",
  "uuid": "123e4567-e89b-12d3-a456-426614174000"
}
```

### Callback Response (POST to your callback_url)

#### Success Case
```json
{
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "status": "completed",
  "result": {
    "mesh_filename": "patient001_frame01_gt_reconstructed.obj",
    "mesh_file_size": 2048576,
    "reconstruction_time": 45.32,
    "num_iterations": 50,
    "resolution": 128,
    "status": "reconstruction_completed",
    "message": "4D reconstruction completed successfully. File handling implementation pending."
  },
  "error": null
}
```

#### Error Case
```json
{
  "uuid": "123e4567-e89b-12d3-a456-426614174000",
  "status": "failed",
  "result": null,
  "error": "Error during 4D reconstruction: Invalid NiFTI file format"
}
```

### Example cURL Command

```bash
curl -X POST "http://your-gpu-server:8000/inference/v2/4d-reconstruction" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "url": "https://your-s3-bucket.s3.amazonaws.com/patient001_frame01_gt.nii.gz?AWSAccessKeyId=AKIA...&Signature=...",
    "uuid": "123e4567-e89b-12d3-a456-426614174000",
    "callback_url": "https://your-node-server.com/api/reconstruction/callback",
    "num_iterations": 75,
    "resolution": 256
  }'
```

### Debug Mode Example

For development/testing, you can save the generated OBJ file to a persistent location:

```bash
curl -X POST "http://your-gpu-server:8000/inference/v2/4d-reconstruction" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "url": "https://your-s3-bucket.s3.amazonaws.com/patient001_frame01_gt.nii.gz?...",
    "uuid": "123e4567-e89b-12d3-a456-426614174000",
    "callback_url": "https://your-node-server.com/api/reconstruction/callback",
    "num_iterations": 50,
    "resolution": 128,
    "debug_save": true,
    "debug_dir": "/tmp/my_debug_meshes"
  }'
```

This will save a copy of the generated OBJ file to `/tmp/my_debug_meshes/debug_patient001_frame01_gt_reconstructed.obj` that you can examine before it gets cleaned up from the temporary processing directory.

### Notes

1. **File Format**: Only single NiFTI files (.nii or .nii.gz) are supported
2. **3D Dimensions**: The NiFTI file should contain 3D segmentation data
3. **Processing Time**: Typical processing takes 30-60 seconds depending on parameters
4. **GPU Memory**: The service uses GPU semaphore control to manage concurrent jobs
5. **Output**: Currently returns mesh file information (TODO: implement file upload/download mechanism)

### Status Codes

- `202 Accepted`: Job queued successfully
- `400 Bad Request`: Invalid request format or parameters
- `401 Unauthorized`: Invalid or missing JWT token
- `403 Forbidden`: Access denied or expired presigned URL
- `500 Internal Server Error`: Server error during job processing