# VisHeart — System Implementation Reference

> This document is a comprehensive technical reference for the VisHeart cardiac imaging platform, intended to support report writing covering system architecture, feature implementation, security, and optimizations.

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Module Integration](#2-module-integration)
3. [Backend Capabilities](#3-backend-capabilities)
4. [Frontend Capabilities](#4-frontend-capabilities)
5. [Core Features](#5-core-features)
   - 5.1 [Segmentation](#51-segmentation)
   - 5.2 [Landmark Detection](#52-landmark-detection)
   - 5.3 [Strain Computation](#53-strain-computation)
   - 5.4 [LV Model Reconstruction](#54-lv-model-reconstruction)
6. [Security Features](#6-security-features)
7. [Optimizations](#7-optimizations)
8. [Other Notable Features](#8-other-notable-features)
9. [Database Schema Summary](#9-database-schema-summary)
10. [Deployment](#10-deployment)

---

## 1. System Architecture Overview

VisHeart is a **microservices-based medical imaging web application** for cardiac analysis. It is composed of four independently deployable services, orchestrated via Docker Compose.

### Services

| Service | Technology | Port | Role |
|---|---|---|---|
| **Backend API** | Node.js / Express / TypeScript | 5000 | Business logic, auth, DB, S3, job management |
| **Frontend** | Next.js 13 / React / TypeScript | 3000 | User interface |
| **GPU Inference Service** | FastAPI / Python | 8001 | AI model execution (segmentation, reconstruction, landmark detection) |
| **MongoDB** | MongoDB 7.0 | 27017 | Primary database |
| **Redis** | Redis 7-alpine | 6379 | Session store |
| **MinIO** | S3-compatible object store | 9000/9001 | Medical file storage |

### High-Level Architecture Diagram (Text)

```
[Browser / User]
      |
      | HTTPS
      v
[Next.js Frontend :3000]
      |
      | REST API (Axios, withCredentials)
      v
[Express Backend :5000]
    /   |   \
   /    |    \
MongoDB Redis  MinIO/S3
              |
              | Presigned URLs + JWT-authenticated requests
              v
       [FastAPI GPU Service :8001]
              |
              | Webhook callback (async)
              v
       [Express Backend :5000]
```

All services communicate over a shared Docker bridge network (`visheart-network`). The GPU service is decoupled: the backend sends jobs to it and receives results asynchronously via webhook callbacks.

---

## 2. Module Integration

### Frontend ↔ Backend

- Frontend uses **Axios** with `withCredentials: true` so session cookies are included on every request.
- Base URL is configured via `NEXT_PUBLIC_API_URL` (e.g., `http://localhost:5000`).
- All API calls are grouped in `visheart-frontend/src/lib/api.ts` under: `authApi`, `projectApi`, `segmentationApi`, `reconstructionApi`, `landmarkApi`, `adminApi`, `supportApi`.
- Session state is restored on page load via `GET /auth/fetch` inside a React Context (`auth-context.tsx`).
- For long-running tasks (segmentation, reconstruction), the frontend **polls** dedicated job-status endpoints until the job reaches `COMPLETED` or `FAILED`.

### Backend ↔ GPU Service

- Every request to the GPU service is authenticated with a **short-lived JWT** (`gpuauthmiddleware.ts`) generated and auto-refreshed by `gpu_auth_client.ts` (refresh interval: 8 minutes; token lifetime: 600 seconds).
- The backend passes **S3 presigned URLs** to the GPU service so the GPU can download large NIfTI files directly from MinIO without going through the backend.
- After inference completes, the GPU service **POSTs results back** to the backend webhook (`/webhook/gpu-callback` for segmentation, `/webhook/gpu-reconstruction-callback` for reconstruction meshes). This keeps the API non-blocking.

### Backend ↔ Storage

- **MongoDB** (via Mongoose): stores users, projects, segmentation masks (RLE-encoded), reconstruction metadata, and job records.
- **Redis**: stores Express sessions with a 1-day TTL.
- **MinIO/S3**: stores original NIfTI/DICOM files, extracted JPEG slices, generated NIfTI masks, and reconstruction mesh TAR archives.

---

## 3. Backend Capabilities

The backend is a **Node.js / Express / TypeScript** server located in `Cardiac_Segmentation_FYP_Server/`.

### File Upload

- Accepts **NIfTI** (`.nii`, `.nii.gz`) and **DICOM** (`.dcm`) files.
- Maximum upload size: **200 GB** per file.
- Upload middleware (`uploadmiddleware.ts`) validates MIME type and file size before accepting.
- On upload, the backend:
  1. Runs `extract_metadata.py` to parse image dimensions (width × height × depth × frames) and the affine transformation matrix.
  2. Runs `convert_to_jpeg.py` to extract 2D JPEG slices for browser-side visualization.
  3. Stores the original file and JPEG slices in MinIO/S3.
  4. Saves project metadata (dimensions, affine matrix, file hash, type) to MongoDB.

### Multi-File / Project Management

- Each uploaded file becomes a **Project**. A user can have many projects.
- Projects can be named, described, saved (to prevent auto-cleanup), and deleted.
- Admin users can view and manage projects belonging to any user.
- Cascade delete: deleting a user removes all their projects, segmentations, reconstructions, and S3 files.

### Async Job System

- All AI tasks (segmentation, reconstruction, landmark detection) are tracked as **Jobs** in MongoDB with states: `PENDING → IN_PROGRESS → COMPLETED / FAILED`.
- The backend assigns each job a UUID, submits it to the GPU service, and returns immediately. The GPU posts results back via webhook when done.
- Frontend polls `/user-check-jobs` endpoints to display progress to the user.

### API Route Groups

| Route Prefix | Responsibilities |
|---|---|
| `/auth` | Register, login, logout, guest accounts, password change, role management, account lockout |
| `/project` | Upload, list, update, delete, presigned download URLs |
| `/segmentation` | Start AI/manual segmentation, fetch results, save/export masks |
| `/reconstruction` | Start 4D mesh generation, fetch results, job status |
| `/landmark-detection` | Start landmark inference, fetch results |
| `/status` | GPU status, system health |
| `/webhook` | Receive async results from GPU service |
| `/admintools` | GPU server configuration |
| `/metrics` | AWS CloudWatch metrics (EC2, S3, ALB, billing) |

### Key Backend Services (Business Logic)

| File | Size | Purpose |
|---|---|---|
| `src/services/database.ts` | 129 KB | All Mongoose schemas/models, auth logic, account lockout |
| `src/services/inference.ts` | 30 KB | Segmentation job orchestration |
| `src/services/reconstruction.ts` | 24 KB | 4D reconstruction pipeline |
| `src/services/segmentation_export.ts` | 24 KB | NIfTI export, bullseye analysis |
| `src/services/s3_handler.ts` | 15 KB | S3/MinIO CRUD, presigned URLs |
| `src/services/project_handler.ts` | 16 KB | Upload workflow, metadata extraction |
| `src/services/gpu_auth_client.ts` | 24 KB | GPU JWT generation and refresh |
| `src/services/landmark_inference.ts` | 9 KB | Landmark detection orchestration |

---

## 4. Frontend Capabilities

The frontend is a **Next.js 13 (App Router) / React / TypeScript** application in `visheart-frontend/`.

### Pages

| Page | Purpose |
|---|---|
| `/login`, `/register` | Authentication |
| `/dashboard` | List and manage projects |
| `/project/[projectId]` | Full project workspace (upload, visualize, segment, reconstruct) |
| `/profile` | User profile, password change |
| `/admin` | Admin dashboard (user management, AWS metrics, GPU status) |
| `/about`, `/doc`, `/policy`, `/sample` | Informational pages |

### Key UI Components

**Medical Imaging Viewer (`image-canvas.tsx`, 48 KB)**
- Renders extracted JPEG slices in a canvas.
- Frame and slice navigation (step through cardiac phases and spatial slices).
- Overlay of AI-generated segmentation masks decoded from RLE.
- Zoom and pan controls.
- Interactive drawing mode for manual segmentation correction.

**Segmentation Sidebar (`segmentation-sidebar.tsx`, 22 KB)**
- Displays bounding box detections with confidence scores.
- Toggle visibility of individual structure masks (RV, MYO, LVC).
- Shows segmentation history and multiple mask variants.

**Drawing Panel (`drawing-panel.tsx`, 12 KB)**
- Pencil, eraser, and fill tools for manual mask editing.
- Adjustable brush size.
- Undo / redo.

**Reconstruction UI**
- Form to configure ED frame, resolution, number of SDF iterations, and export format (GLB/OBJ).
- Job status display with queue position.
- Download link for TAR archive of mesh frames.

**Landmark UI**
- Button to trigger landmark detection.
- Overlay of detected RV insertion points on the imaging viewer.
- Job status tracking.

**Admin Dashboard**
- User list with role management and deletion.
- Real-time AWS CloudWatch metrics (CPU, S3 storage/costs, ALB, ASG, billing).
- GPU server health and VRAM usage.

### State Management

- **Auth Context** (`auth-context.tsx`): global login state, user role, restored on page load.
- **Project Context** (`ProjectContext.tsx`): shared state (project data, segmentation results, reconstruction results) across all project-page child components.
- Custom React hooks for job-status polling and data fetching.

---

## 5. Core Features

### 5.1 Segmentation

Segmentation identifies three cardiac structures in each frame/slice of the cardiac MRI: **Right Ventricle (RV)**, **Myocardium (MYO)**, and **Left Ventricle Cavity (LVC)**.

#### Automated Segmentation (AI Pipeline)

**Default model: YOLO + MedSAM**

1. User clicks "Start Segmentation" on the project page.
2. Backend creates a job record and sends a request to the GPU service with a presigned S3 URL for the NIfTI file.
3. GPU service:
   - Loads the NIfTI volume.
   - Runs **YOLO** (object detection model) to predict bounding boxes for RV, MYO, LVC on each 2D slice.
   - Feeds each bounding box into **MedSAM** (Medical Segment Anything Model, ViT-B backbone) to produce a precise segmentation mask within that region.
   - RLE-encodes all masks.
4. GPU POSTs results (masks + bounding boxes) back to `/webhook/gpu-callback`.
5. Backend stores results in MongoDB as a `ProjectSegmentationMasks` document.
6. Frontend poll detects `COMPLETED` and displays the masks as overlays on the imaging viewer.

**Alternative model: UNET**
- A UNet-based model is available as an alternative segmentation path, selectable from the model selector bar in the UI.
- Same async pipeline; GPU runs `unet_inference.py` instead of MedSAM.

**Dual-Mask System**
- Two mask documents are created per segmentation run:
  - `isMedSAMOutput: true` — The raw AI output; treated as a read-only reference.
  - `isMedSAMOutput: false` — An editable copy the user can refine.
- This preserves the original AI result while allowing corrections.

#### Manual Segmentation

- User draws a bounding box directly on the imaging canvas.
- The frontend sends this box via `POST /segmentation/start-manual-segmentation/:projectId`.
- The GPU service runs MedSAM on just that bounding box and returns masks synchronously (not async).
- Result is overlaid on the current slice immediately.

#### Correction / Editing

- The editable mask copy can be modified using the drawing tools (pencil, eraser, fill) in the Drawing Panel.
- Changes are reflected in real time on the canvas.
- User saves corrections via `PUT /segmentation/save-manual-segmentation/:projectId`, which stores the updated RLE masks in MongoDB.
- Undo/redo is supported within the session.

---

### 5.2 Landmark Detection

Landmark detection identifies the two **RV insertion points** — the anatomical junctions between the right ventricular free wall and the interventricular septum. These landmarks are used to orient cardiac coordinate systems for strain and model reconstruction.

#### Model: UNetResNet34

- Architecture: **ResNet34 encoder** + **UNet decoder** + **CBAM (Convolutional Block Attention Module)** attention gates.
- Trained to output two heatmaps per 2D slice — one per RV insertion point.

#### Automated Detection Pipeline

1. User initiates landmark detection from the project page.
2. Backend (`landmark_inference.ts`) sends the NIfTI to the GPU service at `/inference/v2/landmark-detection`.
3. GPU service (`landmark_inference_api.py`):
   - Extracts frame 0 from the NIfTI volume.
   - Processes each 2D spatial slice through UNetResNet34.
   - Produces two heatmaps per slice; extracts peak coordinates as `(x, y)` landmark positions.
   - Reports confidence metrics (heatmap peak values, inter-landmark distance).
   - Supports 2-chamber and 1-chamber cardiac views, with automatic fallback detection.
4. Results are stored in MongoDB via webhook callback.
5. Frontend overlays the detected points on the imaging viewer.

#### Correction

- Landmark detection results are displayed as visual overlays.
- The system stores per-slice predictions, giving users the ability to identify and verify landmark positions slice by slice.
- (Manual landmark adjustment is supported through the UI if the AI output is incorrect.)

---

### 5.3 Strain Computation

Strain computation quantifies myocardial deformation using the **AHA 17-Segment Bullseye Model** — the clinical standard for regional cardiac function assessment.

#### Implementation

**Primary path (GPU-based):**
1. After segmentation, the backend calls the GPU service at `POST /bullseye/analyze` with the segmentation NIfTI.
2. The GPU service computes per-segment statistics (area, wall thickness, and strain metrics) for all 17 AHA segments.
3. Results are stored in the `bullseye` field of the `ProjectSegmentationMasks` document in MongoDB.

**Fallback path (local Python):**
- If the GPU service is unavailable, `compute_bullseye_from_rle.py` runs locally on the backend.
- This script decodes the RLE-encoded masks stored in MongoDB and computes the same AHA 17-segment analysis without requiring the GPU service.

**Output:**
- Per-segment strain metrics stored in MongoDB.
- Results surfaced to the user in the project view (bullseye visualization).
- Also included in exported data (`GET /segmentation/export-project-data/:projectId`).

---

### 5.4 LV Model Reconstruction

The 4D reconstruction feature generates a **time-varying 3D mesh** of the left ventricle across all cardiac phases, producing a four-dimensional model of ventricular motion.

#### Implementation: SDF-Based Mesh Generation

**Model**: A neural Signed Distance Field (SDF) network (`fourd_model_epoch_250.pth`).

**Pipeline:**

1. User configures reconstruction parameters in the UI:
   - `ed_frame`: End-diastolic frame index (1-based).
   - `resolution`: Mesh resolution (32–256, default 128).
   - `num_iterations`: SDF optimization iterations (1–200, default 50).
   - `export_format`: `GLB` (default, web-optimized) or `OBJ` (legacy).
2. Backend (`reconstruction.ts`) validates that editable segmentation masks exist (`isMedSAMOutput: false`).
3. Backend generates a NIfTI file from the stored RLE masks:
   - **Preferred path** (`create_nifti_with_stored_affine.py`): Uses the affine matrix stored in MongoDB at upload time — fast, no S3 download.
   - **Legacy fallback** (`create_nifti_from_segmentations.py`): Downloads the original NIfTI from S3 to recover the affine — slower.
4. The NIfTI is uploaded to MinIO and a presigned URL is sent to the GPU service via `POST /inference/v2/4d-reconstruction`.
5. GPU service (`fourdreconstruction_handler.py`):
   - Loads the NIfTI segmentation masks.
   - Runs the SDF optimization per cardiac phase to fit a smooth surface.
   - Exports one mesh file per frame (named with `_ED` suffix for the end-diastolic frame).
   - Packages all frames into a TAR archive.
6. GPU POSTs the TAR archive to `/webhook/gpu-reconstruction-callback`.
7. Backend stores the archive in MinIO and records metadata in MongoDB.
8. Frontend polls for completion and provides a presigned download URL (1-hour expiry).

**Export Formats:**
- **GLB** (binary glTF): 30–50% smaller than OBJ; optimized for web/AR/VR rendering.
- **OBJ** (Wavefront): human-readable; compatible with legacy 3D software.

**Quality Safeguards:**
- Reconstruction is blocked if no editable masks exist (must run segmentation first).
- Affine matrix is preserved through the pipeline to maintain spatial accuracy.
- Frame count is validated against project dimensions before submission.

---

## 6. Security Features

### Login Security

| Mechanism | Detail |
|---|---|
| **Per-IP Rate Limiting** | Max **10 login attempts per 15 minutes** per IP address (via `express-rate-limit`). Returns HTTP 429 on breach. |
| **Per-Account Lockout** | Failed login attempts are tracked per username in MongoDB (`loginAttempts`, `lockUntil` fields). After exceeding the threshold, the account is locked for a configured duration. Auto-unlocks after the timeout period. |
| **Password Hashing** | bcrypt — no plain-text passwords stored. |
| **Secure Session Cookies** | Cookie name: `visheart.sid`. Flags: `httpOnly`, `sameSite=lax`, `secure` (production). Session TTL: **1 day**. |
| **Session Store** | Express sessions stored in **Redis** (not in-memory or DB), ensuring fast invalidation. |

### Authentication & Authorization

| Feature | Detail |
|---|---|
| **Session-Based Auth** | Passport.js local strategy; sessions over cookies (not user-facing JWTs). |
| **Role-Based Access** | Three roles: `Admin`, `User`, `Guest`. Middleware guards: `isAuth`, `isAuthAndAdmin`, `isAuthAndNotGuest`, `isAuthandGuest`. |
| **Guest Accounts** | Anonymous access with limited capabilities; can be upgraded to full accounts via `POST /auth/register-from-guest`. |
| **Ownership Validation** | Users can only access their own projects/segmentations/reconstructions. |
| **Admin Controls** | Admins can list, modify, or delete any user or project. |

### File Security

| Feature | Detail |
|---|---|
| **File Type Validation** | Upload middleware whitelist: `.nii`, `.nii.gz`, `.dcm`. Non-conforming files are rejected before storage. |
| **Max File Size** | 200 GB enforced at middleware level. |
| **S3 Presigned URLs** | Files are never served directly through the backend. Clients receive time-limited presigned URLs: 1800 seconds (30 min) for general files, 3600 seconds (1 hour) for reconstruction mesh archives. |
| **S3 Access Control** | Files are stored in private MinIO/S3 buckets; access only via presigned URLs. |
| **Cascade Delete** | Deleting a user removes all their data from both MongoDB and S3 (no orphaned files). |

### Network & Infrastructure Security

| Feature | Detail |
|---|---|
| **CORS** | Whitelist-based in production; open in development. |
| **Helmet.js** | Sets security-related HTTP response headers (CSP disabled to allow medical imaging assets). |
| **GPU Authentication** | Backend-to-GPU requests use short-lived JWTs (600-second lifetime, 8-minute refresh interval). GPU validates all incoming requests via `backend_authentication.py`. |
| **Debug Routes** | Routes exposing internal tokens and test endpoints are **disabled in production** (`NODE_ENV !== "production"`). |
| **Proxy Trust** | `trust proxy` enabled so `X-Forwarded-For` is correctly parsed behind a load balancer/reverse proxy. |

---

## 7. Optimizations

### Client-Side

| Optimization | Detail |
|---|---|
| **JPEG Slice Cache** | Extracted JPEG frames are cached in browser memory (`tar-image-cache.ts`), enabling smooth frame-by-frame navigation without repeated network requests. |
| **Reconstruction Mesh Cache** | Downloaded TAR mesh archives are cached client-side (`reconstruction-cache.ts`) to prevent re-downloading when revisiting results. |
| **Presigned URL Caching** | Generated presigned URLs are reused until near expiry, avoiding repeated S3 signing calls. |

### Backend

| Optimization | Detail |
|---|---|
| **Redis Session Store** | Sessions are read from Redis (sub-millisecond latency) rather than queried from MongoDB on every request. |
| **Stored Affine Matrix** | The NIfTI affine matrix is stored in MongoDB at upload time. Reconstruction uses this stored matrix (`create_nifti_with_stored_affine.py`) instead of re-downloading the original NIfTI from S3, significantly reducing reconstruction startup time. |
| **S3 Presigned URLs** | Large files are transferred directly between client/GPU and S3 — the backend is never in the data path for large payloads. |
| **Async Webhook Architecture** | Inference jobs are non-blocking: the backend submits to GPU and returns immediately; results arrive via webhook. No thread blocking. |
| **Batch Job Status** | `POST /reconstruction/batch-reconstruction-status` checks up to 50 project jobs in a single MongoDB query (vs. 50 individual calls). |
| **Parallel Promise.all()** | Concurrent async operations (e.g., multi-project metadata fetches) are run in parallel via `Promise.all()`. |
| **Bullseye Fallback** | GPU-side bullseye computation is preferred; local Python fallback ensures the feature works even if the GPU service is unreachable. |

### GPU Service

| Optimization | Detail |
|---|---|
| **Persistent Model Loading** | AI models (YOLO, MedSAM, SDF reconstruction, UNetResNet34) are loaded once at service startup and kept in memory for the service lifetime. No per-request model loading overhead. |
| **GPU Memory Preallocation** | GPU memory is preallocated at startup to reduce fragmentation during inference. |
| **Device-Agnostic Code** | All inference code supports CPU fallback, allowing the service to run without a GPU (slower but functional). |

---

## 8. Other Notable Features
## Landmark Detection Page
- Has dual model: If segmentation mask is available, it will run 2 channel(MRI and segmentation mask) model, if unavailable or segmentation mask is less than 50 points, it will fall to 1 channel(MRI) model
- Has confidence score: If the confidence (based on the brightest heatmap pixel) is more than 0.6 it is confident, if it is lower , it is less confident, if both points overlaps, it will find the mean point (show on the frontend too) to indicate the prediction is inaccurate.
- User can edit the landmmark point to correct place, however it is yet to be implemented to the backend. 
- Can view AHA 2D bullseye plot and choose which segmentation mask for it. There is 3D model beside it too and both 2D bullseye plot and 3D model is sync with the MRI slices, there is tooltip for both bullseye and 3D model, if user click on one category of the bullseye , the respective representation of that category (wall) will blink on the 3d model side. 3D model is always moving/ rotating, user can pause. User can zoom in and out of the model and the bullseye plot too and can reset view by just clicking the button.
- Other bullseye plot for strain works the same too there is GLS GRS and GLC , can zoom in and out and then can reset.
- The bullseye plot in bullseye tab indicate which wall is thin/thick
- There is strain chart.
- There is export report pdf and export data in csv function.

## Can choose which segmentation mask to use for 4D reconstruction
- User can choose which segmentation mask to use (for GPU: UNET and medsam) for 4D reconstruction
- User can only generate one 4d model for each segmentation mask, and only can regenerate if it is deleted. This is to prevent flooding.


## Cross-driver 
- Now it can be run on both GPU and CPU , however with limitation, for cpu, only UNET-Mamba can be used, medsam cannot. 
- Auto detect which driver user is on upon ./start.bat

### Multi-Role User System
- **Admin**: Full platform control — manage all users, projects, GPU config, and view infrastructure metrics.
- **User**: Standard access — upload files, run AI analyses, manage own projects.
- **Guest**: Limited access — can explore the platform without registering. Projects are auto-cleaned up. Can be upgraded to a full User account.

### Guest Account Cleanup
- A scheduled job (`guestcleanupjob.ts`) periodically deletes stale guest accounts and their associated projects and S3 files to prevent storage accumulation.

### Project Save / Auto-Cleanup Policy
- Projects have an `isSaved` flag. Unsaved projects are eligible for cleanup by `projectcleanupjob.ts`.
- Users explicitly save projects they want to retain, preventing unbounded storage growth.
- Users will be reminded before logout if the projects are not saved

### Export Functionality
- `GET /segmentation/export-project-data/:projectId` allows exporting segmentation results as:
  - **JSON** (raw mask data with bullseye stats)
  - **NIfTI** (reconstructed volumetric mask file)
  - **DICOM** (for clinical system compatibility)
  - Now we support choosing which segmentation mask to export (if user had Medsam chosen, when export it will export the 
  segmentation mask of that model)


### GPU Server Configuration (Admin)
- Admins can update the GPU server address, test connectivity, and reload configuration — all from the UI without restarting services.

### Model Selection
- Users can choose between **YOLO + MedSAM** (default, higher accuracy) and **UNET** (alternative) for segmentation directly from the project page model selector bar.

### Dark / Light Mode
- Full theme support via `theme-provider.tsx` and CSS variables.

### FAQ / Documentation
- Floating FAQ button (`FloatingFAQButton.tsx`) and guidance panels (`GuidancePanel.tsx`) provide in-context help throughout the app.
- Flashing of buttons to be pressed so users which to go to - New Project -> Start AI segmentation  -> Edit segmentation mask -> 
Create 4D reconstruction -> Landmark Detection

---

## 9. Database Schema Summary

### Users
```
username       String (unique)
password       String (bcrypt hash)
email          String
phone          String
role           "Admin" | "User" | "Guest"
loginAttempts  Number
lockUntil      Date
```

### Projects
```
userid              ObjectId (ref: User)
name, description   String
originalfilepath    String (S3 key)
filetype            "nifti" | "nifti_gz" | "dicom"
dimensions          { width, height, depth, frames }
affineMatrix        Number[][] (4x4 spatial transform)
filesize            Number
filehash            String
isSaved             Boolean
```

### ProjectSegmentationMasks
```
projectid         ObjectId
isMedSAMOutput    Boolean  (true = AI reference, false = editable)
segmentationModel "medsam" | "unet"
frames: [{
  frameindex  Number
  slices: [{
    sliceindex     Number
    boundingBoxes  [{ class, confidence, bbox:[x1,y1,x2,y2] }]
    segmentationMasks { RV, MYO, LVC: RLE_STRING }
  }]
}]
bullseye          { stats, segments }  (AHA 17-segment data)
```

### ProjectReconstructions
```
projectid       ObjectId
maskId          ObjectId
meshFormat      "GLB" | "OBJ"
ed_frame        Number
reconstructedMesh {
  path              String (S3 key)
  filesize          Number
  reconstructionTime Number
  numIterations     Number
  resolution        Number
}
```

### Jobs
```
uuid       String (unique)
userid     ObjectId
projectid  ObjectId
status     "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED"
type       "AI_SEGMENTATION" | "MANUAL_SEGMENTATION" | "4D_RECONSTRUCTION" | "LANDMARK_DETECTION"
result     Object (varies by type)
```

---

## 10. Deployment

### Local Development (Docker Compose)

```bash
cd visheart-local-deployment
docker-compose up -d               # Default: API + Frontend + MongoDB + Redis + MinIO
docker-compose --profile cpu up -d # Add CPU inference service
docker-compose --profile gpu up -d # Add GPU inference service (requires nvidia-docker)
```

| URL | Service |
|---|---|
| `http://localhost:3000` | Frontend |
| `http://localhost:5000` | Backend API |
| `http://localhost:8001` | GPU Inference |
| `http://localhost:9001` | MinIO Console |

### Environment Variables (Key)

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | Express session signing key |
| `MONGODB_URI` | MongoDB connection string |
| `REDIS_URL` | Redis connection string |
| `S3_*` | MinIO/S3 credentials and bucket |
| `GPU_HOST` | GPU service address |
| `GPU_JWT_SECRET` | Secret for backend-to-GPU JWT signing |
| `CALLBACK_URL` | Webhook URL for GPU to post results back |
| `NEXT_PUBLIC_API_URL` | Frontend API base URL |

---

*Generated from the VisHeart codebase (COS40005FYPA, branch: dev, 2026-05-28).*
