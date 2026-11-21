# VisHeart Inference GPU

> This project is a part of the final year project A (FYP-A) 2025 March for the Bachelor of Computer Science (Hons) at Swinburne University of Technology, Sarawak Campus.

A **GPU-accelerated cardiac MRI segmentation and 4D reconstruction inference server** using YOLO + MedSAM + 4D deep SDF models in a containerized FastAPI service.

[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/downloads/release/python-3120/)
[![PyTorch 2.5.1](https://img.shields.io/badge/pytorch-2.5.1-red.svg)](https://pytorch.org/)
[![CUDA 11.8](https://img.shields.io/badge/cuda-11.8-green.svg)](https://developer.nvidia.com/cuda-11-8-0-download-archive)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Overview

VisHeart Inference GPU is a specialized, high-performance and concurrent inference server designed for segmenting cardiac MRI images and reconstructing 4D myocardium models. It leverages the power of GPU acceleration by combining three key machine learning models: YOLO (You Only Look Once) for initial chamber detection, MedSAM (Medical Segment Anything Model) for precise segmentation, and a 4D deep SDF model for temporal myocardium reconstruction. This service is containerized using Docker and exposes its functionality through a FastAPI-based web interface, specifically supporting the VisHeart backend (`../Cardiac_Segmentation_FYP_Server` in this repository).

>[!IMPORTANT]
> An NVIDIA GPU with CUDA is recommended but not required. The service picks CUDA, ROCm or CPU at start-up
> (`app/classes/device_runtime.py`). In the local install, `start.bat` runs the `gpu-nvidia` container when it finds
> a working NVIDIA GPU and the `gpu-cpu` container otherwise. On CPU, MedSAM is not loaded
> (`SKIP_MEDSAM_MODEL_LOAD=true` in `docker-compose.yml`), so MedSAM segmentation is unavailable; YOLO, UNet,
> landmarks and 4D reconstruction still run, more slowly. MPS (Apple) is not supported.

## Key Features

- FastAPI-based inference endpoints with asynchronous processing
- NVIDIA CUDA acceleration with TensorRT support
- Support for both single images and batch processing
- **4D temporal myocardium reconstruction with multi-frame processing**
- **Multipart file delivery for large mesh datasets**
- **Professional logging system with structured formatting**
- Webhook callback mechanism for completed jobs
- Concurrent request handling with GPU resource management
- Docker containerization for easy deployment

## Table of Contents

- [VisHeart Inference GPU](#visheart-inference-gpu)
  - [Overview](#overview)
  - [Key Features](#key-features)
  - [Table of Contents](#table-of-contents)
  - [Project Structure](#project-structure)
  - [Quick Start (without Docker)](#quick-start-without-docker)
  - [Quick Start (Docker)](#quick-start-docker)
  - [Environment Variables](#environment-variables)
  - [Environment Setup](#environment-setup)
    - [1. Install PyTorch dependencies first](#1-install-pytorch-dependencies-first)
    - [2. Install the rest of the dependencies depending on your environment](#2-install-the-rest-of-the-dependencies-depending-on-your-environment)
  - [Models](#models)
  - [API Documentation](#api-documentation)
    - [Base URL](#base-url)
    - [Status Endpoints](#status-endpoints)
    - [Inference Endpoints](#inference-endpoints)
      - [Bounding Box Inference](#bounding-box-inference)
      - [Segmentation Mask Inference](#segmentation-mask-inference)
      - [Manual Segmentation Inference](#manual-segmentation-inference)
      - [4D Myocardium Reconstruction](#4d-myocardium-reconstruction)
        - [Complete Request with ALL Possible Fields](#complete-request-with-all-possible-fields)
        - [Minimal Request (using defaults)](#minimal-request-using-defaults)
        - [Immediate HTTP Response (202 Accepted)](#immediate-http-response-202-accepted)
        - [Field Descriptions](#field-descriptions)
        - [Multipart Callback Response](#multipart-callback-response)
        - [Error Response Sample](#error-response-sample)
        - [Temporal Frame Processing](#temporal-frame-processing)
    - [Callback Mechanism](#callback-mechanism)
    - [Endpoints Summary](#endpoints-summary)
  - [Logging Features](#logging-features)
    - [Features](#features)
    - [Sample Output](#sample-output)
    - [Configuration](#configuration)
  - [Development](#development)
    - [Concurrency Management](#concurrency-management)
    - [Utility Scripts](#utility-scripts)
  - [Acknowledgments](#acknowledgments)

## Project Structure

```bash
visheart-inference-gpu/
├── app/                      # Main application code
│   ├── classes/              # Core object classes
│   ├── dependencies/         # Resource management
│   ├── helpers/              # Utility functions
│   ├── models/               # ML model files
│   ├── routes/               # API endpoints
│   ├── scripts/              # Utility scripts
│   └── security/             # Authentication
├── docker/                   # Docker configuration
│   └── scripts/              # Docker helper scripts
├── Dockerfile                # Container definition
├── requirements_*.txt        # Dependency files
└── .env.template             # Environment variable template
```

## Quick Start (without Docker)

![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![Python](https://img.shields.io/badge/python-3670A0?style=for-the-badge&logo=python&logoColor=ffdd54)

> [!WARNING]
> This project was developed and tested on a **Ubuntu 22.04 system** running under **WSL2** with NVIDIA GPU support. It is **not guaranteed** to work on other operating systems or environments.

> [!IMPORTANT]
> For GPU use, ensure the CUDA toolkit is installed and the GPU is accessible. Most developers run this service in
> Docker instead, as described in the [Quick Start (Docker)](#quick-start-docker) section.

1.  **Go to this folder.** This service is part of the VisHeart repository; there is no separate repository to clone:

    ```bash
    cd cardiac-component-segmentation-ai/visheart-inference-gpu
    ```

2.  **Create a secret file (`.env`):**

    - In this folder, create a secret file named `.env`. Use `.env.template` and the [Environment Variables](#environment-variables) section as a guide for the required environment variables.

    - _Important:_ Do not use quotation marks (`" "`) for the values in the `.env` file. For example, use `SERVER_USERNAME=myusername` instead of `SERVER_USERNAME="myusername"`.

3.  **Install dependencies:**

    ```bash
    # Strongly recommended to use a virtual environment
    # e.g. python -m venv venv
    # source venv/bin/activate (Linux/Mac)
    # venv\Scripts\activate (Windows)

    # Install PyTorch dependencies first then the rest
    pip install -r requirements_torch.txt --index-url https://download.pytorch.org/whl/cu118
    pip install -r requirements_prod.txt
    ```

4.  **Get the models that are not in git:**
    `medsam_vit_b.pth` and `unet.pth` go in `app/models`. See [Models](#models).

5.  **(Optional) Edit `start_server.py`:**
    `start_server.py` is in this folder. It starts uvicorn on port 8001 with 1 worker and a concurrency limit of 100;
    change those there if needed.

6.  **Run the server:**

    ```bash
    python start_server.py
    ```

7.  **(Optional) Test the API:**
    ```bash
    curl http://localhost:8001/status/server
    ```

## Quick Start (Docker)

![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![Python](https://img.shields.io/badge/python-3670A0?style=for-the-badge&logo=python&logoColor=ffdd54)

> [!IMPORTANT]
> Before building the docker image, ensure:
>
> 1. Docker is installed and running.
> 2. (Optional) Docker Buildkit (default builder in Docker Desktop 2.3.0+) is recommended but not a strict requirement. See the [Docker Documentations](https://docs.docker.com/build/buildkit/) on how to enable it. If you do not have it, instead of `docker buildx build`, use the `docker build` command.

**In VisHeart (the usual way):** you do not run this image by hand. `visheart-local-deployment/docker-compose.yml`
runs it as the `gpu-cpu` or `gpu-nvidia` service (container `visheart-gpu-cpu` / `visheart-gpu-nvidia`, port 8001),
and `start.bat` starts the right one. The compose file mounts the service's `.py` files (each one listed by name) and
`app/models` into the container, so a code change only needs `stop.bat` and `start.bat`; a new `.py` file also needs
its own mount line. See the root README, "After you change code".

**Building the image:**

1.  **Go to this folder:**

    ```bash
    cd cardiac-component-segmentation-ai/visheart-inference-gpu
    ```

2.  **Get the models that are not in git** (`medsam_vit_b.pth`, `unet.pth`) into `app/models`. See [Models](#models).
    The image includes the model files listed in `.dockerignore`.

3.  **Build with the build script, not plain `docker build`:**

    ```powershell
    .\build.ps1                 # Windows: tags sharlene21/visheart-gpu:latest
    .\build.ps1 -Tag 1.4.0      # also tags sharlene21/visheart-gpu:1.4.0
    ```

    On Linux or macOS use `./build.sh` (or `./build.sh 1.4.0`). The script copies the landmark model files from the root `UNETRESNET34`
    folder into the build; a plain `docker build .` fails at that step.

4.  **(Optional) Run it on its own**, listening on port 8001, with a `.env` file made from `.env.template`
    (no quotation marks around values):

    ```bash
    docker run --rm -it -p 8001:8001 --env-file .env --gpus all sharlene21/visheart-gpu:latest
    ```

    Leave out `--gpus all` on a computer without an NVIDIA GPU.

5.  To use a new image in VisHeart, change the default of `VH_GPU_IMAGE` in `docker-compose.yml` (for your own
    copy) and the `VH_GPU_IMAGE` entry in `installer/release.json` (for installed copies), the same way the root
    README describes for the app image ("When you build a new image").

6.  **(Optional) Test the API with curl:**
    ```bash
    curl http://localhost:8001/status/server
    ```
7.  **(Optional) Save the Docker image to a tar file:**
    ```bash
    # No compression
    docker save -o visheart-inference-gpu.tar sharlene21/visheart-gpu:latest
    # With gzip compression
    docker save sharlene21/visheart-gpu:latest | gzip > visheart-inference-gpu.tar.gz
    ```
    This command will create a tar (or tar.gz if compressed) file named `visheart-inference-gpu` in the current directory, which can be used to transfer the image to another machine or for backup purposes.
8.  **(Optional) Load the Docker image from a tar file:**
    ```bash
    docker load -i visheart-inference-gpu.tar # add .gz if compressed
    ```
    This command will load the Docker image from the `visheart-inference-gpu` file into your local Docker registry, making it available for use.

## Environment Variables

The following environment variables are required for the server to run properly.

| Variable Name                | Description                                                                                                      | Default Value / Example                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `YOLO_MODEL_NAME`            | Specifies the filename of the YOLO model. This model must be located within the `./app/models` directory.      | `24April2025-single-stage-usethis.engine` |
| `MEDSAM_MODEL_NAME`          | Specifies the filename of the MedSAM model. This model must be located within the `./app/models` directory.    | `medsam_vit_b.pth`                        |
| `FOURD_RECONSTRUCTION_MODEL_NAME` | Specifies the filename of the 4D reconstruction model within the `./app/models` directory.           | `fourd_model_epoch_250.pth`                                    |
| `GPU_ACCESS_SECRET`          | A secret key used for JWT (JSON Web Token) authentication to secure access to this GPU inference endpoints     | `Ugry1L2FzTULsOnyKY3pFXdQ1Cq91NO5`        |
| `SERVER_USERNAME`            | The username that this inference server will use, potentially for identifying itself or for JWT generation.     | `visheart-gpu-inference`                  |
| `ALLOWED_NODE_USERNAME`      | The username of an allowed client (e.g., a node server) that can access this inference server's API.           | `visheart-node-server`                    |
| `ENV_TYPE`                   | Defines the operating environment for the server. Can be set to `development` or `production`.                  | `production`                              |
| `GPU_SEMAPHORE_COUNT`        | Determines the maximum number of concurrent GPU inference tasks that can be processed at the same time.         | `1`                                       |
| `FOURD_RV_MODEL_NAME`        | Optional. RV 4D reconstruction checkpoint (file in `./app/models` or an absolute path). Unset: RV requests get 503. | `fourd_rv_epoch_50.pth`                |
| `VISHEART_DEVICE`            | Optional. `auto`, `cpu`, `cuda`, `rocm` or a torch device string. The `gpu-cpu` service sets `cpu`.              | `auto`                                    |
| `SKIP_MEDSAM_MODEL_LOAD`     | Optional. `true` skips loading MedSAM (the `gpu-cpu` service sets it). Also `SKIP_YOLO_MODEL_LOAD`, `SKIP_FOURD_RECONSTRUCTION_MODEL_LOAD`. | `false` |

`visheart-local-deployment/docker-compose.yml` holds the values the local install uses (the `x-gpu-environment`
block and the `gpu-cpu` / `gpu-nvidia` services). It sets `ENV_TYPE=development`, so JWT checks are skipped there.

> [!WARNING]
> The `GPU_ACCESS_SECRET` is a secret key used for JWT (JSON Web Token) authentication to secure access to this GPU inference endpoints and is used to generate a JWT token that is required for accessing the inference endpoints. If you do not set this variable, the server will not start. This key's value is shared between the inference server and the node server. The JWT token is generated using the `SERVER_USERNAME` and `GPU_ACCESS_SECRET` variables, and it is used to authenticate requests to the inference endpoints.
>
> In the production environment, JWT authentication is enabled and this server's inference endpoints will only accept HTTP requests with a valid JWT token in the `Authorization` header. The token must be in the format `Bearer <token>`, where `<token>` is the JWT token generated using the `SERVER_USERNAME` and `GPU_ACCESS_SECRET` variables. The token is valid for 8 minutes and will expire after that time. The server will return a 401 Unauthorized error if the token is missing or invalid.
>
> In the development environment, JWT authentication is disabled but the HTTP requests still require the `Authorization` header with content `Bearer <token>` where `<token` can be a random HS256 hash.

## Environment Setup

**Key Dependencies**:

- **Production Environment**:
  - Python 3.12
  - PyTorch 2.5.1 with CUDA 11.8 support (⚠️ do not use 2.6.0+)
  - Ultralytics (YOLO), MedSAM
  - FastAPI, Uvicorn, httpx (for callbacks)
  - OpenCV, NumPy, NiBabel, etc.
- **Development Environment**:
  - All production dependencies
  - TensorRT, ONNX, ONNX Runtime

Three environment files are provided in the root directory:

- **requirements_torch.txt**: PyTorch dependencies
  - Includes PyTorch 2.5.1 with CUDA 11.8 support
  - Use `--index-url https://download.pytorch.org/whl/cu118` to install the correct version
- **requirements_prod.txt**: Minimal runtime environment
  - Includes only the necessarydependencies for running the inference server including FastAPI, TensorRT and YOLOv11
- **requirements_dev.txt**: Full development environment
  - Includes previous necessary dependencies - requirements_prod.tx + `onnx`, `onnxruntime`, and `onnx-slim` for building the TensorRT engine

> [!TIP]
> Use an environment like [virtualenv](https://virtualenv.pypa.io/en/latest/) before using the commands below to isolate the dependencies.
> Alternatively, you can use [Anaconda](https://docs.conda.io/en/latest/) to create a new environment.

### 1. Install PyTorch dependencies first

```bash
pip install -r requirements_torch.txt --index-url https://download.pytorch.org/whl/cu118
```

### 2. Install the rest of the dependencies depending on your environment

```bash
# Production environment
pip install -r requirements_prod.txt

# Development environment
pip install -r requirements_dev.txt
```

## Models

Model files are stored in the `app/models` directory:

- **YOLOv11**: `24April2025-single-stage-usethis.engine` (TensorRT optimized) or `24April2025-single-stage-usethis.pt` (PyTorch model)
  - This model is already provided in the repository.
- **MedSAM**: `medsam_vit_b.pth` (PyTorch model)
  - Download weights here: [MedSAM](https://github.com/bowang-lab/MedSAM)
> [!IMPORTANT]
> The **MedSAM model** is not provided in the repository due to its large size.
- **4D Reconstruction Model**: `fourd_model_epoch_250.pth` (PyTorch model)
  - This model is already provided in the repository.
- **RV 4D Reconstruction Model**: `fourd_rv_epoch_50.pth`, and the CPD atlases `atlas/` (LV) and `atlas_rv/` (RV)
  - Already provided in the repository.
- **UNet segmentation**: `unet.pth` (PyTorch model)
  - Not in the repository (gitignored, large). It is looked up in this order: the `UNET_CHECKPOINT_PATH`
    environment variable, `app/models/active/unet.pth` (a retrained version activated by Extend Training),
    then `app/models/unet.pth` (the original).

### Getting `unet.pth` and `medsam_vit_b.pth` for the Docker stack

`visheart-local-deployment/docker-compose.yml` mounts this repo's `app/models` folder over the image's
`/app/app/models` (read-only), which hides the copies baked into the image. On a fresh clone the folder has
neither file, so UNet fails with "UNet checkpoint file not found" and MedSAM cannot load.

The usual way is to download both into `app/models`: `medsam_vit_b.pth` from the
[MedSAM project](https://github.com/bowang-lab/MedSAM) and `unet.pth` from [Google Drive](https://drive.google.com/file/d/1qL-Gxft-KdHQ7pPbxlRNiUr-L-Dn64sU/view?usp=sharing) (see "For developers" in the
root README). Alternatively, copy them out of the image once (Linux, macOS or Git Bash; run from
`visheart-inference-gpu/`):

```bash
docker pull sharlene21/visheart-gpu:latest
docker run --rm --entrypoint ls sharlene21/visheart-gpu:latest -l /app/app/models   # check what the image has
id=$(docker create sharlene21/visheart-gpu:latest)
docker cp "$id:/app/app/models/unet.pth" app/models/unet.pth
docker cp "$id:/app/app/models/medsam_vit_b.pth" app/models/medsam_vit_b.pth
docker rm "$id"
```

Then restart the inference container (`docker restart visheart-gpu-cpu` or `visheart-gpu-nvidia`). On Windows,
`visheart-retraining/setup-training-pc.ps1` (run by `start.ps1` when the training data pack is present) also
puts the original `unet.pth` in place. See `visheart-local-deployment/README.md` for the full Linux setup.

## API Documentation

### Base URL

When running locally: `http://localhost:8001`

### Status Endpoints

- **GET /status/server**: Server status (CPU, memory, disk usage)
- **GET /status/gpu**: GPU status (name, memory usage, utilization)
- **GET /status/ready**: Whether every model has finished loading (`ready: true`) or is still `starting`
- **GET /status/environment**: `ENV_TYPE`, whether authentication is required, and the configured model names
- **GET /status/models**: Which models are loaded in memory

Interactive API docs (FastAPI): `http://localhost:8001/docs`.

### Inference Endpoints

#### Bounding Box Inference

```
POST /inference/v2/bbox-inference
```

Performs cardiac chamber detection using only the YOLOv11 model.

**Request Body:**

```json
{
  "url": "https://your-s3-bucket.s3.amazonaws.com/path/to/image-or-archive?AWSAccessKeyId=...",
  "uuid": "b7d9b7f9-c572-4eb3-89e7-060549c320f5",
  "callback_url": "https://your-server.com/api/callback"
}
```

**Response (202 Accepted):**

```json
{
  "message": "Inference job accepted",
  "uuid": "b7d9b7f9-c572-4eb3-89e7-060549c320f5"
}
```

#### Segmentation Mask Inference

```
POST /inference/v2/medsam-inference
```

Performs cardiac chamber segmentation using YOLO+MedSAM.

**Request Body:**

```json
{
  "url": "https://your-s3-bucket.s3.amazonaws.com/path/to/image-or-archive?AWSAccessKeyId=...",
  "uuid": "b7d9b7f9-c572-4eb3-89e7-060549c320f5",
  "callback_url": "https://your-server.com/api/callback"
}
```

**Response (202 Accepted):**

```json
{
  "message": "Inference job accepted",
  "uuid": "b7d9b7f9-c572-4eb3-89e7-060549c320f5"
}
```

#### Manual Segmentation Inference

```
POST /inference/v2/medsam-inference-manual
```

Performs segmentation using MedSAM only with a manually specified bounding box. This endpoint operates **synchronously** and returns the result directly in the response body. It does not use the callback mechanism and is not managed by the GPU semaphore.

**Request Body:**

```json
{
  "url": "https://your-s3-bucket.s3.amazonaws.com/path/to/archive?AWSAccessKeyId=...",
  "uuid": "b7d9b7f9-c572-4eb3-89e7-060549c320f5",
  "image_name": "123456_2630fced_0_0.jpg",
  "bbox": [113.45, 92.0, 146.95, 115.8] // format of [x1, y1, x2, y2]
}
```

**Response (200 OK):**

If successful, the response will be:

```json
{
  "uuid": "b7d9b7f9-c572-4eb3-89e7-060549c320f5",
  "status": "completed",
  "result": {
    "123456_2630fced_0_0.jpg": {
      "boxes": [
        {
          "bbox": [113.45, 92.0, 146.95, 115.8],
          "confidence": 1.0,
          "class_id": -1,
          "class_name": "manual"
        }
      ],
      "masks": {
        "manual": "rle_encoded_mask_string..."
      }
    }
  },
  "error": null
}
```

If an error occurs:

```json
{
  "uuid": "b7d9b7f9-c572-4eb3-89e7-060549c320f5",
  "status": "failed",
  "result": null,
  "error": "Error details message"
}
```

#### 4D Myocardium Reconstruction

```
POST /inference/v2/4d-reconstruction
```

**4D reconstruction supporting both 3D and 4D temporal sequences with multipart file delivery.**

Reconstructs myocardium meshes from NiFTI segmentation files using the deep SDF model. Supports full temporal sequence processing (4D files) with multiple mesh file generation.

**Key Features:**
- ✅ **4D Temporal Processing**: Multi-frame cardiac cycle reconstruction
- ✅ **Multiple Export Formats**: OBJ (Wavefront) or GLB (glTF 2.0 binary) mesh export
- ✅ **Multipart Delivery**: Binary mesh files sent as form attachments
- ✅ **ED Frame Detection**: Automatic End Diastolic reference frame

> [!IMPORTANT]
> This endpoint delivers results via **multipart/form-data** callbacks with binary mesh file attachments for efficient handling of multiple mesh files.

##### Complete Request with ALL Possible Fields

**Headers:**
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NzUxNGFjOWI2YzgzYzgzZjM0YjY1MjciLCJpYXQiOjE3MzM0NzA0MDEsImV4cCI6MTczMzQ3NDAwMX0.LJrfKbpHE7pX6MNOyEGpWQaomW1qyWgMQ7fz2HlME9U
Content-Type: application/json
```

**JSON Body:**
```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "url": "https://dev-visheart-s3-bucket.s3.ap-southeast-1.amazonaws.com/patient006_4d_gt.nii.gz?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...",
  "callback_url": "http://localhost:3000/webhook",
  "ed_frame_index": 0,
  "num_iterations": 150,
  "resolution": 128,
  "process_all_frames": true,
  "export_format": "glb",
  "debug_save": true,
  "debug_dir": "/tmp/debug_reconstruction"
}
```

> [!IMPORTANT]
> `debug_dir` and `debug_save` are intended for debugging purposes only from within the server. Enabling `debug_save` will store intermediate files persistently, which may consume significant disk space.

##### Minimal Request (using defaults)
```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440001",
  "url": "https://s3-bucket.com/patient_data.nii.gz",
  "callback_url": "http://localhost:3000/webhook"
}
```

##### Immediate HTTP Response (202 Accepted)
```json
{
  "message": "Inference job accepted",
  "uuid": "550e8400-e29b-41d4-a716-446655440000"
}
```

##### Field Descriptions

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `uuid` | string (UUID) | ✅ | - | Client-provided unique identifier |
| `url` | string (HttpUrl) | ✅ | - | Presigned S3 URL for NiFTI file |
| `callback_url` | string (HttpUrl) | ✅ | - | Webhook endpoint for results |
| `ed_frame_index` | integer | ❌ | 0 | End Diastolic frame reference (0-based) |
| `num_iterations` | integer | ❌ | 50 | SDF optimization iterations (1-500) |
| `resolution` | integer | ❌ | 128 | Mesh resolution (32-256) |
| `process_all_frames` | boolean | ❌ | true | Enable multi-frame processing |
| `export_format` | string | ❌ | "obj" | Mesh export format: "obj" (Wavefront) or "glb" (glTF 2.0 binary) **(recommended)** |
| `chamber` | string | ❌ | "lv" | `"lv"` meshes the LV myocardial wall (label 2). `"rv"` meshes the RV cavity (label 1) with the RV checkpoint; returns 503 if `FOURD_RV_MODEL_NAME` is not set |
| `seed` | integer | ❌ | null | Seed for the starting latent code (0 to 2^31-1). Set it to make a job repeatable |
| `num_candidates` | integer | ❌ | 1 | Fit this many seeds and keep the one that best matches the input contour (1-10). About N times slower |
| `code_reg_lambda` | number | ❌ | 0.0001 | L2 regularization of the latent code (0-0.01). Experimental |
| `verbose_logging` | boolean | ❌ | false | Log optimization details per epoch |
| `debug_save` | boolean | ❌ | false | Save files persistently |
| `debug_dir` | string | ❌ | "/tmp/4d_reconstruction_debug" | Debug file location |

All request fields are defined in `FourDReconstructionJobRequest` in `app/classes/pydantic_schema.py`. The VisHeart
backend always sends `ed_frame_index`, `num_iterations`, `resolution`, `process_all_frames`, `export_format`
(`glb` unless asked otherwise), `debug_save`, `debug_dir` and `chamber` (`src/services/reconstruction.ts`).

> [!NOTE]
> `pydantic_schema.py` also defines a `FourDReconstructionResult` model with `mesh_format: "npz"`, `mesh_data` and
> `mesh_files`. The current code does not use it: results are sent as `.obj` / `.glb` files in the multipart
> callback below, with the metadata built in `app/helpers/inference_jobs.py`.

**Export Format Notes:**
- **OBJ (Wavefront)**: Plain text format with vertex and face data. Widely supported, human-readable.
- **GLB (glTF 2.0 Binary)**: Binary format optimized for web and modern 3D applications. Smaller file size, faster transmission.
- The `export_format` field defaults to `"obj"` for backward compatibility.
- Both formats are generated from the same PLY mesh using the Trimesh library.

##### Multipart Callback Response

**HTTP Callback to:** `http://localhost:3000/webhook`

**Method:** `POST`  
**Content-Type:** `multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW`

**Headers:**
```http
User-Agent: VisHeart-GPU-Service/1.0
X-Job-ID: 550e8400-e29b-41d4-a716-446655440000
X-File-Count: 5
```

**Form Fields:**

1. **Metadata Field (`metadata`)** - JSON with reconstruction details:
```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "result": {
    "mesh_filename": "patient006_4d_gt_4D_frame00_ED.glb",
    "mesh_file_size": 1247856,
    "total_mesh_files": 5,
    "total_mesh_size": 6239280,
    "mesh_format": "obj",
    "chamber": "lv",
    "aha_vertex_labels": "...",
    "frame_aha_vertex_labels": "...",
    "reconstruction_time": 127.45,
    "num_iterations": 150,
    "resolution": 128,
    "status": "reconstruction_completed",
    "message": "4D reconstruction completed successfully. 5 mesh files sent as multipart attachments.",
    "is_4d_input": true,
    "total_frames": 20,
    "ed_frame_index": 0,
    "processed_frames": 5,
    "temporal_info": {
      "type": "4d_sequence_processing",
      "total_temporal_frames": 20,
      "processed_frame_indices": [0, 4, 9, 14, 19],
      "ed_frame_position": 0,
      "mesh_file_count": 5,
      "note": "Full temporal sequence processing with multi-frame reconstruction."
    },
    "mesh_files_info": [
      {
        "filename": "patient006_4d_gt_4D_frame00_ED.glb",
        "size": 1247856,
        "frame_index": 0
      },
      {
        "filename": "patient006_4d_gt_4D_frame04.glb",
        "size": 1245123,
        "frame_index": 4
      },
      {
        "filename": "patient006_4d_gt_4D_frame09.glb",
        "size": 1252147,
        "frame_index": 9
      },
      {
        "filename": "patient006_4d_gt_4D_frame14.glb",
        "size": 1248963,
        "frame_index": 14
      },
      {
        "filename": "patient006_4d_gt_4D_frame19.glb",
        "size": 1245191,
        "frame_index": 19
      }
    ]
  },
  "error": null
}
```

2. **Binary Mesh Files** - Multiple mesh attachments:

**Field:** `mesh_0`  
**Content-Type:** `model/gltf-binary` (for GLB) or `model/obj` (for OBJ)  
**Filename:** `patient006_4d_gt_4D_frame00_ED.glb` (End Diastolic frame)

**Field:** `mesh_1` through `mesh_4`  
**Content-Type:** `model/gltf-binary` (for GLB) or `model/obj` (for OBJ)  
**Filenames:** `patient006_4d_gt_4D_frame04.glb`, `patient006_4d_gt_4D_frame09.glb`, etc.

With only one mesh file the field is named `mesh`. The metadata's `mesh_format` is always `"obj"` in the current
code, even for GLB files; the file extension and Content-Type show the real format. `aha_vertex_labels` and
`frame_aha_vertex_labels` (shortened above) hold the segment label of each mesh vertex (AHA segments for LV), for
the main mesh and per frame; they are `null` when labelling fails.

##### Error Response Sample

```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "status": "failed",
  "result": null,
  "error": "Access denied. The presigned URL may have expired or is invalid."
}
```

##### Temporal Frame Processing

The system supports advanced temporal sequence processing:

**4D NiFTI Detection:**
- Automatically detects input dimensionality
- 4D files: `[X, Y, Z, T]` where T is temporal frames
- 3D files: Processed as single-frame

**Frame Extraction Process:**
1. **Load 4D Volume**: Read temporal sequence (e.g., 20 frames)
2. **Frame Processing**: Process all temporal frames
3. **Individual Processing**: Each frame → contour extraction → SDF optimization → mesh generation
4. **File Naming**: 
   - ED frame: `patient_4D_frame00_ED.{obj|glb}`
   - Other frames: `patient_4D_frame09.{obj|glb}`

**Processing Modes:**
- **Single Frame**: ED frame only processing (when `process_all_frames=false`)
- **Multi-Frame**: Full temporal sequence processing (when `process_all_frames=true`)

**Response Fields:**
- **`is_4d_input`**: Detected input dimensionality
- **`total_frames`**: Original temporal frame count
- **`processed_frames`**: Actual frames processed
- **`temporal_info`**: Detailed temporal processing metadata
- **`mesh_files_info`**: Per-file metadata array
- **`total_mesh_size`**: Combined file size in bytes


### Callback Mechanism

Most inference endpoints (`bbox-inference`, `medsam-inference`, `unet-inference`, `landmark-detection`,
`4d-reconstruction`) answer `202 Accepted` at once and later POST the result to the request's `callback_url`.

> [!NOTE]
> `/inference/v2/medsam-inference-manual`, `/inference/v2/4d-motion` and the `/bullseye/*` endpoints are exceptions.
> They work synchronously and return the result directly in the HTTP response.

### Endpoints Summary

"Requires Auth" means a backend JWT in the `Authorization` header. It is only checked when `ENV_TYPE=production`;
the local install runs with `ENV_TYPE=development`. Routers: `app/routes/status_routes.py`, `inference_route.py`,
`bullseye_route.py`.

| Endpoint                                | Method | Description                                    | Requires Auth |
| --------------------------------------- | ------ | ---------------------------------------------- | ------------- |
| `/status/server`                        | GET    | Server status                                  | No            |
| `/status/gpu`                           | GET    | GPU status and utilization                     | No            |
| `/status/ready`                         | GET    | Whether all models have finished loading       | No            |
| `/status/environment`                   | GET    | Environment type, auth mode, model names       | No            |
| `/status/models`                        | GET    | Which models are loaded                        | No            |
| `/inference/v2/bbox-inference`          | POST   | YOLO chamber detection (Async)                 | Yes           |
| `/inference/v2/medsam-inference`        | POST   | Full chamber segmentation (Async)              | Yes           |
| `/inference/v2/unet-inference`          | POST   | UNet segmentation of a NIfTI file (Async)      | Yes           |
| `/inference/v2/landmark-detection`      | POST   | Landmark detection, UNetResNet34 (Async)       | Yes           |
| `/inference/v2/medsam-inference-manual` | POST   | Manual bounding box segmentation (Synchronous) | Yes           |
| `/inference/v2/4d-reconstruction`       | POST   | 4D myocardium reconstruction (Async)           | Yes           |
| `/inference/v2/4d-motion`               | POST   | Smooth motion from a finished reconstruction's TAR (body), CPU only, one at a time; query `chamber`, `ed_frame` | Yes |
| `/bullseye/analyze`                     | POST   | AHA 17-segment analysis, NIfTI mask uploaded   | Yes           |
| `/bullseye/analyze-from-s3`             | POST   | AHA 17-segment analysis, mask from a presigned URL | Yes       |
| `/bullseye/compute-strain`              | POST   | LV strain (GRS, GCS) from ED + ES masks        | Yes           |
| `/bullseye/compute-rv-strain`           | POST   | RV 9-segment strain (GCS, GAS) from ED + ES masks | Yes        |

`/inference/v2/3d-reconstruction` is commented out in `inference_route.py` and not available.

> [!NOTE]
> The `/inference/v1/` synchronous endpoints are available, but deprecated. They are retained for backward compatibility with the `_interactive_medsam_ui.py` script and will only be exposed in the development environment.
> This endpoint also does not contain the 3d reconstruction logic and is not managed by the GPU semaphore.

## Logging Features

The server includes comprehensive logging with professional formatting and warning suppression:

### Features

- **Structured Logging**: Proper timestamps and formatted output
- **Startup Banner**: Clear environment and model information display
- **Warning Suppression**: Hides PyTorch pickle and deprecation warnings
- **Model Loading Status**: Consistent progress indicators with emojis
- **Environment Awareness**: Clear development vs production mode indication

### Sample Output

**Before (cluttered with warnings):**
```
INFO:     Uvicorn running on http://0.0.0.0:8001
/home/user/.venv/lib/python3.12/site-packages/torch/load.py:105: FutureWarning: You are using `torch.load` with `weights_only=False`...
Loading YOLO model from /path/to/model.engine...
```

**After (clean and professional):**
```
2025-09-27 12:34:56 - visheart - INFO - 
================================================================================
                   🚀 VISHEART INFERENCE SERVER STARTING
                       📍 Environment: DEVELOPMENT
             🔓 Authentication: BYPASSED (development mode)
                     🛠️ Debug routes: ENABLED
                          📦 MODELS TO LOAD:
   • YOLO: 24April2025-single-stage-usethis.engine
   • MedSAM: medsam_vit_b.pth
   • 4D Reconstruction: fourd_model_epoch_250.pth
================================================================================

2025-09-27 12:34:56 - visheart - INFO - 🔄 Loading YOLO model: 24April2025-single-stage-usethis.engine
2025-09-27 12:34:56 - visheart - INFO - ✅ YOLO model loaded successfully
2025-09-27 12:34:56 - visheart - INFO - 🎉 All models loaded successfully - Server is ready!
```

### Configuration

Logging is automatically configured on startup via `app/utils/logging_config.py`. No additional setup required.

## Development

### Concurrency Management

The API supports concurrent requests with GPU resource management for its asynchronous endpoints:

- Asynchronous job requests (`/inference/v2/bbox-inference`, `/inference/v2/medsam-inference`, `/inference/v2/4d-reconstruction`) are immediately accepted with 202 status.
- Most code for these jobs is asynchronous, allowing multiple jobs to be queued.
- Inference tasks for these jobs are processed in a separate thread pool.
- A semaphore (`gpu_semaphore`) controls access to GPU resources for these asynchronous jobs.
- By default, `gpu_semaphore = asyncio.Semaphore(1)` limits to one active asynchronous GPU job concurrently, but does not limit over increased worker count.
- Increase this value based on your GPU VRAM capacity (e.g., 1 for 4GB VRAM, 2-3 for 10GB VRAM, 3-5 for 16GB VRAM GPUs).
- Additional asynchronous requests wait in queue until GPU resources are available.
- Each asynchronous job sends results via callback when complete.

The synchronous endpoint `/inference/v2/medsam-inference-manual` operates outside this semaphore-controlled asynchronous workflow. It processes requests one by one as they arrive and blocks until completion, returning the result directly in the HTTP response.

To increase concurrency for asynchronous jobs:

- (Recommended) Modify `gpu_semaphore` in inference_jobs.py or via the environment variable `GPU_SEMAPHORE_COUNT`.
- Increase the worker counts in `start_server.py`.

### Utility Scripts

The repository includes utility scripts in the `app/scripts` folder:

- `_interactive_medsam_ui.py`: GUI tool for testing manual segmentation - the server **must** be running in development environment.
- `_decode_rle.py`: Converts Sparse RLE to binary masks
- `_yolo_to_tensorrt.py`: Converts YOLOv11 `.pt` model to TensorRT engine - produces `.onnx` and `.engine` files for the YOLOv11 model.

> [!WARNING]
> Other scripts not mentioned are deprecated and not recommended for use with the current asynchronous inference pipeline since version `3.0.0`.

## Acknowledgments

- [Ultralytics YOLO](https://github.com/ultralytics/ultralytics): Real-time object detection model
- [MedSAM](https://github.com/bowang-lab/MedSAM): Jun Ma, Yuting He, Feifei Li, Lin Han, Chenyu You & Bo Wang (2024)
- [4D Myocardium Reconstruction](https://github.com/yuan-xiaohan/4D-Myocardium-Reconstruction-with-Decoupled-Motion-and-Shape-Model): Xiaohan Yuan, Cong Liu & Yangang Wang (2023)
- [FastAPI](https://fastapi.tiangolo.com/): Modern, fast web framework for building APIs
- [MetaSAM](https://github.com/facebookresearch/segment-anything): Meta AI's Segment Anything Model
- [NVIDIA](https://developer.nvidia.com/): For TensorRT, CUDA and providing the Docker base image with CUDA runtime support

I like to thank the following individuals for their support and contributions to this project:

- [Ms. Kathy Wong Hui Ying](hywong@swinburne.edu.my): Our client and provider of the dataset, project requirements, pre-trained Yolov11 model and feedback
- [Dr. Miko MayLee Chang](mchang@swinburne.edu.my): Our supervisor of the FYP project for her guidance and support
