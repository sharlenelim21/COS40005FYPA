# VisHeart Backend Server

Stack:

![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB)
![MongoDB](https://img.shields.io/badge/MongoDB-%234ea94b.svg?style=for-the-badge&logo=mongodb&logoColor=white)

Written in:

![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)

# API Documentation

A comprehensive medical imaging backend server for cardiac segmentation and 4D reconstruction, featuring AI-powered analysis, cloud-based GPU processing, and AWS infrastructure monitoring.

## Table of Contents

1. [Overview](#overview)
2. [General API Notes](#general-api-notes)
3. [Authentication Routes](#authentication-routes)
4. [Project Routes](#project-routes)
5. [Segmentation Routes](#segmentation-routes)
6. [4D Reconstruction Routes](#4d-reconstruction-routes)
7. [GPU Status Routes](#gpu-status-routes)
8. [Webhook Routes](#webhook-routes)
9. [Admin Tools Routes](#admin-tools-routes)
10. [AWS CloudWatch Metrics API](#aws-cloudwatch-metrics-api)
11. [Debug Routes](#debug-routes-development-only)
12. [Environment Configuration](#environment-configuration)

---

## Overview

The VisHeart Backend Server provides a complete medical imaging pipeline for cardiac analysis:

- **Medical Image Processing**: NIfTI file handling with metadata extraction
- **AI-Powered Segmentation**: YOLO + MedSAM integration for cardiac structure segmentation
- **4D Reconstruction**: SDF-based mesh generation across cardiac phases
- **Cloud Infrastructure Monitoring**: Real-time AWS metrics and cost tracking
- **Distributed Architecture**: Microservices coordination between backend, GPU server, and storage

**Architecture Components**:
- Node.js/Express API (this server)
- FastAPI GPU Server for AI inference
- MongoDB for data persistence
- Redis for session management
- AWS S3 for file storage
- AWS CloudWatch for infrastructure monitoring

---

## General API Notes

### Authentication
- **Session-based**: Uses `express-session` with Redis storage (not JWT for user auth)
- **Session Cookie**: Established after successful login via `/auth/login`
- **Middleware Protection**: 
  - `isAuth`: Requires any authenticated user
  - `isAuthAndNotGuest`: Requires User or Admin role
  - `isAuthAndAdmin`: Requires Admin role only
  - `isAuthandGuest`: Requires Guest role (registration upgrade flow)

### GPU Server Authentication
- **Separate System**: Backend manages JWT tokens for GPU server communication
- **Automatic Handling**: `injectGpuAuthToken` middleware handles token refresh
- **Client Transparency**: Clients don't manage GPU tokens directly

### Validation & Error Responses
- **Input Validation**: Performed on all endpoints with user input
- **Error Format**: JSON with `message` or `errors` field
- **HTTP Status Codes**:
  - `200`: Success
  - `400`: Bad Request (validation errors)
  - `401`: Unauthorized (not authenticated)
  - `403`: Forbidden (insufficient permissions)
  - `404`: Not Found
  - `500`: Internal Server Error

---

## Authentication Routes (`/auth`)

**Base Path**: `/auth`

User registration, login, profile management, and role-based access control.

### 1. Register New User

```http
POST /auth/register
```

**Description**: Creates a new user account with full access privileges.

**Request Body**: `application/json`
```json
{
  "username": "string (required, unique)",
  "password": "string (required, must meet complexity requirements)",
  "email": "string (required, valid email format)",
  "phone": "string (required, valid phone number format)"
}
```

**Authentication**: None

**Success Response** (HTTP 200):
```json
{
  "message": "User registered successfully"
}
```

**Error Responses**:
- **400**: Username already exists, invalid email/phone format, weak password
- **500**: Database error during registration

---

### 2. Register From Guest

```http
POST /auth/register-from-guest
```

**Description**: Upgrades a temporary guest account to a full user account.

**Request Body**: `application/json`
```json
{
  "username": "string (required, unique)",
  "password": "string (required, must meet complexity requirements)",
  "email": "string (required, valid email format)",
  "phone": "string (required, valid phone number format)"
}
```

**Authentication**: Required (`isAuthandGuest` - must be logged in as guest)

**Success Response** (HTTP 200):
```json
{
  "message": "Guest account upgraded successfully"
}
```

---

### 3. User Login

```http
POST /auth/login
```

**Description**: Authenticates user and establishes session cookie.

**Request Body**: `application/json`
```json
{
  "username": "string (required)",
  "password": "string (required)"
}
```

**Authentication**: None

**Success Response** (HTTP 200):
```json
{
  "message": "Login successful",
  "user": {
    "username": "string",
    "email": "string",
    "phone": "string",
    "role": "string (User|Admin|Guest)"
  }
}
```

**Error Responses**:
- **400**: Missing credentials
- **401**: Invalid username or password

---

### 4. User Logout

```http
POST /auth/logout
```

**Description**: Invalidates the current user session.

**Request Body**: None

**Authentication**: Required (`isAuth`)

**Success Response** (HTTP 200):
```json
{
  "message": "Logout successful"
}
```

---

### 5. Delete User Account

```http
POST /auth/delete
```

**Description**: Permanently deletes the authenticated user's account and all associated data (projects, segmentations, reconstructions).

**Request Body**: `application/json`
```json
{
  "password": "string (required, current password for verification)"
}
```

**Authentication**: Required (`isAuthAndNotGuest`)

**Success Response** (HTTP 200):
```json
{
  "message": "User account deleted successfully"
}
```

**Error Responses**:
- **400**: Incorrect password
- **403**: Guest users cannot delete accounts via this endpoint

---

### 6. Guest Login

```http
POST /auth/guest
```

**Description**: Creates a temporary guest account with limited privileges (expires after inactivity).

**Request Body**: None

**Authentication**: None

**Success Response** (HTTP 200):
```json
{
  "message": "Guest login successful",
  "user": {
    "username": "string (auto-generated)",
    "role": "Guest"
  }
}
```

---

### 7. Update User Information

```http
POST /auth/update
```

**Description**: Updates the authenticated user's profile information.

**Request Body**: `application/json`
```json
{
  "username": "string (optional, new username)",
  "email": "string (optional, valid email format)",
  "phone": "string (optional, valid phone number format)"
}
```

**Authentication**: Required (`isAuthAndNotGuest`)

**Success Response** (HTTP 200):
```json
{
  "message": "User information updated successfully"
}
```

---

### 8. Update User Password

```http
POST /auth/update-password
```

**Description**: Changes the authenticated user's password.

**Request Body**: `application/json`
```json
{
  "old_password": "string (required, current password)",
  "password": "string (required, new password with complexity requirements)"
}
```

**Authentication**: Required (`isAuthAndNotGuest`)

**Success Response** (HTTP 200):
```json
{
  "message": "Password updated successfully"
}
```

**Error Responses**:
- **400**: Incorrect old password, new password doesn't meet requirements

---

### 9. Update User Role (Admin)

```http
POST /auth/update-role
```

**Description**: Allows administrators to change a user's role.

**Request Body**: `application/json`
```json
{
  "username": "string (required, target username)",
  "newrole": "string (required, User|Admin|Guest)"
}
```

**Authentication**: Required (`isAuthAndAdmin`)

**Success Response** (HTTP 200):
```json
{
  "message": "User role updated successfully"
}
```

---

### 10. Fetch User Information

```http
GET /auth/fetch
```

**Description**: Retrieves the current user's profile information.

**Request Body**: None

**Authentication**: Required (`isAuth`)

**Success Response** (HTTP 200):
```json
{
  "username": "string",
  "email": "string",
  "phone": "string",
  "role": "string (User|Admin|Guest)",
  "createdAt": "string (ISO 8601 timestamp)"
}
```

---

### 11. Admin Route Test

```http
GET /auth/admin
```

**Description**: Test endpoint to verify admin authentication.

**Request Body**: None

**Authentication**: Required (`isAuthAndAdmin`)

**Success Response** (HTTP 200):
```json
{
  "message": "Admin access granted"
}
```

---

### 12. Admin Delete User

```http
POST /auth/admin-delete-user
```

**Description**: Allows administrators to delete any user account.

**Request Body**: `application/json`
```json
{
  "username": "string (required, username to delete)"
}
```

**Authentication**: Required (`isAuthAndAdmin`)

**Success Response** (HTTP 200):
```json
{
  "message": "User deleted successfully"
}
```

---

### 13. Admin Update User

```http
POST /auth/admin-update-user
```

**Description**: Allows administrators to update any user's information.

**Request Body**: `application/json`
```json
{
  "username": "string (required, current username)",
  "newUsername": "string (optional, new username)",
  "email": "string (optional, new email)",
  "phone": "string (optional, new phone)",
  "role": "string (optional, new role)"
}
```

**Authentication**: Required (`isAuthAndAdmin`)

**Success Response** (HTTP 200):
```json
{
  "message": "User updated successfully"
}
```

---

### 14. Get All Users (Admin)

```http
GET /auth/users
```

**Description**: Retrieves a list of all registered users.

**Request Body**: None

**Authentication**: Required (`isAuthAndAdmin`)

**Success Response** (HTTP 200):
```json
{
  "users": [
    {
      "username": "string",
      "email": "string",
      "phone": "string",
      "role": "string",
      "createdAt": "string (ISO 8601)"
    }
  ]
}
```

---

### 15. Protected Route Test

```http
GET /auth/protected
```

**Description**: Test endpoint to verify user authentication.

**Request Body**: None

**Authentication**: Required (`isAuth`)

**Success Response** (HTTP 200):
```json
{
  "message": "Access granted"
}
```

---

## Project Routes (`/project`)

**Base Path**: `/project`

Medical image file upload, project management, and metadata operations.

### 1. Get Project Information

```http
GET /project/get-project-info/:projectId
```

**Description**: Retrieves detailed information about a specific project.

**URL Parameters**:
- `projectId` (string, required): MongoDB project ID

**Request Body**: None

**Authentication**: Required (`isAuth`)

**Success Response** (HTTP 200):
```json
{
  "projectId": "string",
  "name": "string",
  "description": "string",
  "fileMetadata": {
    "filename": "string",
    "filesize": "number",
    "filetype": "string (nifti|nifti_gz|dicom)",
    "dimensions": "object",
    "frames": "number"
  },
  "createdAt": "string (ISO 8601)",
  "updatedAt": "string (ISO 8601)",
  "isSaved": "boolean"
}
```

---

### 2. Upload New Project

```http
PUT /project/upload-new-project
```

**Description**: Uploads a medical imaging file (NIfTI/DICOM) and creates a new project.

**Request Body**: `multipart/form-data`
- `files`: File (required, max 1 file, max 200GB)
  - Allowed extensions: `.nii`, `.nii.gz`, `.dcm`
- `name`: String (required, project name)
- `description`: String (required, project description)

**Authentication**: Required (`isAuth`)

**Success Response** (HTTP 200):
```json
{
  "message": "Project uploaded successfully",
  "projectId": "string"
}
```

**Example cURL**:
```bash
curl -X PUT http://localhost:5000/project/upload-new-project \
  -H "Cookie: connect.sid=your-session-cookie" \
  -F "files=@/path/to/cardiac.nii.gz" \
  -F "name=Patient A - Cardiac MRI" \
  -F "description=4D cardiac cine acquisition"
```

---

### 3. Get Projects List

```http
GET /project/get-projects-list
```

**Description**: Retrieves filtered list of projects for the authenticated user.

**Query Parameters** (all optional):
- `projectid` (string): Filter by specific project ID
- `name` (string): Substring match on project name
- `filetype` (string|array): Filter by file type(s)
  - Values: `nifti`, `nifti_gz`, `dicom`
  - Example: `?filetype=nifti` or `?filetype=nifti&filetype=dicom`
- `daterange` (JSON string): Filter by creation date range
  - Format: `{"start":"2023-01-01T00:00:00.000Z","end":"2023-12-31T23:59:59.999Z"}`

**Request Body**: None

**Authentication**: Required (`isAuth`)

**Success Response** (HTTP 200):
```json
{
  "projects": [
    {
      "projectId": "string",
      "name": "string",
      "description": "string",
      "fileMetadata": { "..." },
      "createdAt": "string (ISO 8601)",
      "isSaved": "boolean"
    }
  ]
}
```

---

### 4. Get All Users with Projects (Admin)

```http
GET /project/get-allusers-with-projects
```

**Description**: Retrieves all users and their associated projects (admin monitoring).

**Request Body**: None

**Authentication**: Required (`isAuthAndAdmin`)

**Success Response** (HTTP 200):
```json
{
  "users": [
    {
      "username": "string",
      "projects": [
        {
          "projectId": "string",
          "name": "string",
          "createdAt": "string (ISO 8601)"
        }
      ]
    }
  ]
}
```

---

### 5. Update Project Details

```http
PATCH /project/update-project
```

**Description**: Updates project name and/or description.

**Request Body**: `application/json`
```json
{
  "projectId": "string (required)",
  "name": "string (optional)",
  "description": "string (optional)"
}
```

**Authentication**: Required (`isAuth`)

**Success Response** (HTTP 200):
```json
{
  "message": "Project updated successfully"
}
```

---

### 6. Save/Unsave Project

```http
PATCH /project/save-project
```

**Description**: Marks a project as saved (prevents automatic cleanup) or unsaved.

**Request Body**: `application/json`
```json
{
  "projectId": "string (required)",
  "isSaved": "boolean (required)"
}
```

**Authentication**: Required (`isAuthAndNotGuest`)

**Success Response** (HTTP 200):
```json
{
  "message": "Project save status updated"
}
```

---

### 7. Get Project Presigned URL

```http
GET /project/get-project-presigned-url
```

**Description**: Generates a presigned S3 URL for downloading the original project file.

**Query Parameters**:
- `projectId` (string, required): Project ID
- `expiryInSeconds` (number, optional): URL expiry time (default: 1800)

**Request Body**: None

**Authentication**: Required (`isAuth`)

**Success Response** (HTTP 200):
```json
{
  "url": "string (presigned S3 URL)",
  "expiresIn": "number (seconds)"
}
```

---

### 8. User Delete Project

```http
DELETE /project/user-delete-project/:projectId
```

**Description**: Allows users to delete their own projects and all associated data.

**URL Parameters**:
- `projectId` (string, required): Project ID to delete

**Request Body**: None

**Authentication**: Required (`isAuthAndNotGuest`)

**Success Response** (HTTP 200):
```json
{
  "message": "Project deleted successfully"
}
```

---

### 9. Admin Delete Project

```http
DELETE /project/admin-delete-project/:projectId
```

**Description**: Allows administrators to delete any project.

**URL Parameters**:
- `projectId` (string, required): Project ID to delete

**Request Body**: None

**Authentication**: Required (`isAuthAndAdmin`)

**Success Response** (HTTP 200):
```json
{
  "message": "Project deleted successfully"
}
```

---

## Segmentation Routes (`/segmentation`)

**Base Path**: `/segmentation`

AI-powered cardiac segmentation using YOLO + MedSAM models on GPU server.

### 1. Start AI Segmentation

```http
POST /segmentation/start-segmentation/:projectId
```

**Description**: Initiates AI segmentation inference on GPU server for a project.

**URL Parameters**:
- `projectId` (string, required): Project ID to segment

**Request Body**: None

**Authentication**: Required (`isAuth`), GPU auth handled by `injectGpuAuthToken` middleware

**Success Response** (HTTP 200):
```json
{
  "message": "Segmentation job started",
  "jobId": "string (UUID)"
}
```

**Error Responses**:
- **400**: Project has no uploaded file
- **404**: Project not found
- **500**: GPU server communication error

---

### 2. Get Segmentation Results

```http
GET /segmentation/segmentation-results/:projectId
```

**Description**: Retrieves AI segmentation results (bounding boxes and RLE-encoded masks).

**URL Parameters**:
- `projectId` (string, required): Project ID

**Request Body**: None

**Authentication**: Required (`isAuth`)

**Success Response** (HTTP 200):
```json
{
  "segmentations": [
    {
      "segmentationId": "string",
      "name": "string",
      "description": "string",
      "isMedSAMOutput": "boolean",
      "isSaved": "boolean",
      "frames": [
        {
          "frameIndex": "number",
          "slices": [
            {
              "sliceIndex": "number",
              "boundingBoxes": [
                {
                  "class": "string (RV|MYO|LVC)",
                  "confidence": "number",
                  "bbox": [x1, y1, x2, y2]
                }
              ],
              "segmentationMasks": {
                "RV": "string (RLE encoded mask)",
                "MYO": "string (RLE encoded mask)",
                "LVC": "string (RLE encoded mask)"
              }
            }
          ]
        }
      ]
    }
  ]
}
```

**Cardiac Structure Classes**:
- `RV`: Right Ventricle
- `MYO`: Myocardium (heart muscle)
- `LVC`: Left Ventricle Cavity

---

### 3. Start Manual Segmentation

```http
POST /segmentation/start-manual-segmentation/:projectId
```

**Description**: Initiates manual segmentation using user-provided bounding box.

**URL Parameters**:
- `projectId` (string, required): Project ID

**Request Body**: `application/json`
```json
{
  "image_name": "string (required, e.g., 'frame0_slice5.jpg')",
  "bbox": "array (required, [x1, y1, x2, y2])",
  "segmentationName": "string (optional)",
  "segmentationDescription": "string (optional)"
}
```

**Authentication**: Required (`isAuth`), GPU auth handled by `injectGpuAuthToken` middleware

**Success Response** (HTTP 200):
```json
{
  "message": "Manual segmentation job started",
  "jobId": "string (UUID)"
}
```

---

### 4. Check User Jobs

```http
GET /segmentation/user-check-jobs
```

**Description**: Retrieves status of all segmentation jobs for the authenticated user.

**Request Body**: None

**Authentication**: Required (`isAuth`)

**Success Response** (HTTP 200):
```json
{
  "jobs": [
    {
      "jobId": "string (UUID)",
      "projectId": "string",
      "status": "string (PENDING|IN_PROGRESS|COMPLETED|FAILED)",
      "type": "string (AI_SEGMENTATION|MANUAL_SEGMENTATION)",
      "createdAt": "string (ISO 8601)"
    }
  ]
}
```

---

### 5. Check All Jobs Status (Admin)

```http
GET /segmentation/admin-check-all-jobs-status
```

**Description**: Retrieves status of all segmentation jobs across all users.

**Request Body**: None

**Authentication**: Required (`isAuthAndAdmin`)

**Success Response** (HTTP 200):
```json
{
  "jobs": [
    {
      "jobId": "string",
      "userId": "string",
      "projectId": "string",
      "status": "string",
      "type": "string",
      "createdAt": "string (ISO 8601)"
    }
  ]
}
```

---

### 6. Save AI Segmentation

```http
PATCH /segmentation/save-ai-segmentation
```

**Description**: Marks an AI segmentation as saved (prevents automatic cleanup).

**Request Body**: `application/json`
```json
{
  "projectId": "string (required)",
  "segmentationId": "string (required)"
}
```

**Authentication**: Required (`isAuthAndNotGuest`)

**Success Response** (HTTP 200):
```json
{
  "message": "Segmentation saved successfully"
}
```

---

### 7. Save Manual Segmentation

```http
PUT /segmentation/save-manual-segmentation/:projectId
```

**Description**: Saves user-created manual segmentation masks to the database.

**URL Parameters**:
- `projectId` (string, required): Project ID

**Request Body**: `application/json`
```json
{
  "segmentationData": "object (required, segmentation mask data)",
  "segmentationName": "string (optional)",
  "segmentationDescription": "string (optional)"
}
```

**Authentication**: Required (`isAuth`)

**Success Response** (HTTP 200):
```json
{
  "message": "Manual segmentation saved successfully"
}
```

---

### 8. Export Project Data

```http
GET /segmentation/export-project-data/:projectId
```

**Description**: Exports project data and segmentation results in various formats.

**URL Parameters**:
- `projectId` (string, required): Project ID

**Query Parameters**:
- `format` (string, optional): Export format
  - Values: `json`, `nifti`, `dicom`
  - Default: `json`

**Request Body**: None

**Authentication**: Required (`isAuth`)

**Success Response** (HTTP 200):
- Content-Type varies based on format
- Returns file download with appropriate headers

---

## 4D Reconstruction Routes (`/reconstruction`)

**Base Path**: `/reconstruction`

SDF-based 4D cardiac mesh reconstruction from segmentation masks.

### Architecture Overview

The reconstruction pipeline uses editable segmentation masks to generate 4D mesh sequences:

1. **Dual-Mask System**:
   - AI-Generated Masks (`isMedSAMOutput: true`): Raw MedSAM output (reference only)
   - Editable Masks (`isMedSAMOutput: false`): User-refined masks **used for reconstruction**

2. **Processing Flow**:
   ```
   Editable Masks → GPU SDF Model → 4D Mesh Sequence → TAR Archive → S3 Storage
   ```

3. **Supported Formats**:
   - **GLB** (default): Optimized for web/AR/VR, smaller files, faster loading
   - **OBJ**: Legacy format for 3D software compatibility

### 1. Start 4D Reconstruction

```http
POST /reconstruction/start-reconstruction/:projectId
```

**Description**: Initiates 4D cardiac reconstruction using editable segmentation masks.

**URL Parameters**:
- `projectId` (string, required): Project ID

**Request Body**: `application/json`
```json
{
  "reconstructionName": "string (optional, default: '4D Reconstruction - {timestamp}')",
  "reconstructionDescription": "string (optional, default: '4D cardiac reconstruction using SDF model')",
  "ed_frame": "number (required, 1-based end-diastolic frame index)",
  "export_format": "string (optional, 'glb'|'obj', default: 'glb')",
  "parameters": {
    "num_iterations": "number (optional, 1-200, default: 50)",
    "resolution": "number (optional, 32-256, default: 128)",
    "process_all_frames": "boolean (optional, default: true)",
    "debug_save": "boolean (optional, default: false)",
    "debug_dir": "string (optional, default: '/tmp/4d_reconstruction_debug')"
  }
}
```

**Request Fields**:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `reconstructionName` | string | ❌ | `"4D Reconstruction - {ISO timestamp}"` | Reconstruction job name |
| `reconstructionDescription` | string | ❌ | `"4D cardiac reconstruction using SDF model"` | Job description |
| `ed_frame` | number | ✅ | N/A | End-diastolic frame (1-based, must be ≥ 1 and ≤ project frame count) |
| `export_format` | string | ❌ | `"glb"` | Mesh format: `"glb"` (web-optimized) or `"obj"` (legacy) |
| `parameters.num_iterations` | number | ❌ | `50` | SDF optimization iterations (1-200) |
| `parameters.resolution` | number | ❌ | `128` | Mesh resolution (32-256) |
| `parameters.process_all_frames` | boolean | ❌ | `true` | Process all frames for 4D sequence |
| `parameters.debug_save` | boolean | ❌ | `false` | Save debug outputs |
| `parameters.debug_dir` | string | ❌ | `"/tmp/4d_reconstruction_debug"` | Debug output directory |

**Prerequisites**:
- Project must exist and belong to authenticated user
- Project must have **editable segmentation masks** (`isMedSAMOutput: false`)
  - Both AI-generated and editable masks exist after segmentation
  - Reconstruction uses **only the editable mask** for processing
  - If no editable mask exists, returns error: `"No editable segmentation mask available for reconstruction. Please complete or refine segmentation first."`
- `ed_frame` parameter must be within project's actual frame count (1-based indexing)
- Valid frame range: `1 ≤ ed_frame ≤ project.dimensions.frames`

**Authentication**: Required (`isAuthAndNotGuest`), GPU auth handled by `injectGpuAuthToken` middleware

**Success Response** (HTTP 200):
```json
{
  "message": "4D reconstruction job accepted. UUID: {job-uuid}",
  "uuid": "string (job UUID for tracking)"
}
```

**Error Responses**:
- **400**: Invalid `ed_frame` (out of range or invalid format), missing required fields
- **403**: User lacks access to project
- **404**: Project not found
- **500**: GPU server communication error, **missing editable segmentation mask**, or NIfTI generation failure

**Example Request**:
```bash
curl -X POST https://api.visheart.art/reconstruction/start-reconstruction/507f1f77bcf86cd799439011 \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=your-session-cookie" \
  -d '{
    "reconstructionName": "Patient A - ED Analysis",
    "reconstructionDescription": "High-resolution 4D reconstruction",
    "ed_frame": 12,
    "export_format": "glb",
    "parameters": {
      "num_iterations": 75,
      "resolution": 256,
      "process_all_frames": true
    }
  }'
```

---

### 2. Get Reconstruction Results

```http
GET /reconstruction/reconstruction-results/:projectId
```

**Description**: Retrieves all reconstruction results for a project with presigned download URLs.

**Export/Download Mechanism**: 
- Generates **fresh presigned S3 URLs** on every request
- Reconstruction TAR files stored permanently in S3
- Each API call creates new temporary download URL (1-hour expiry)
- Do not cache download URLs - always fetch fresh when exporting

**URL Parameters**:
- `projectId` (string, required): Project ID

**Request Body**: None

**Authentication**: Required (`isAuth`)

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "reconstructions": [
    {
      "reconstructionId": "string (MongoDB document ID)",
      "name": "string",
      "description": "string",
      "isSaved": "boolean",
      "isAIGenerated": "boolean",
      "meshFormat": "string ('GLB'|'OBJ', TAR archive)",
      "meshFileSize": "number (bytes)",
      "downloadUrl": "string|null (presigned S3 URL, 1-hour expiry)",
      "metadata": {
        "edFrameIndex": "number (1-based from ed_frame parameter)",
        "reconstructionTime": "number (seconds)",
        "numIterations": "number",
        "resolution": "number",
        "filename": "string",
        "filesize": "number (bytes)",
        "filehash": "string (SHA256)"
      },
      "createdAt": "string (ISO 8601)",
      "updatedAt": "string (ISO 8601)"
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
- **400**: Invalid project ID
- **404**: Project not found
- **500**: Database or S3 error

---

### 3. Check User Reconstruction Jobs

```http
GET /reconstruction/user-check-jobs
```

**Description**: Retrieves all reconstruction jobs for authenticated user with status and queue position.

**Request Body**: None

**Authentication**: Required (`isAuth`)

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "activeJobCount": "number (pending/in-progress jobs)",
  "totalJobs": "number (total returned, limited to 20)",
  "jobs": [
    {
      "jobId": "string (UUID)",
      "projectId": "string",
      "status": "string (PENDING|IN_PROGRESS|COMPLETED|FAILED)",
      "name": "string",
      "description": "string",
      "queuePosition": "number|null (1-based for pending jobs)"
    }
  ]
}
```

**Job Status Values**:
- `PENDING`: Queued, waiting for GPU processing
- `IN_PROGRESS`: Currently processing
- `COMPLETED`: Finished successfully
- `FAILED`: Processing error

---

### 4. Batch Reconstruction Status Check

```http
POST /reconstruction/batch-reconstruction-status
```

**Description**: Check reconstruction status for multiple projects in a single request (optimized for dashboards).

**Request Body**: `application/json`
```json
{
  "projectIds": ["string", "string", "..."]
}
```

**Request Fields**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectIds` | array of strings | ✅ | MongoDB project IDs (max 50) |

**Authentication**: Required (`isAuth`)

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

**Error Responses**:
- **400**: Invalid/empty `projectIds` or exceeds 50 projects
- **403**: User attempting to access projects they don't own
- **500**: Database query error

**Performance Notes**:
- Uses MongoDB aggregation pipeline for efficient batch queries
- Validates user ownership of all requested projects
- Limited to 50 projects per request

---

### 5. Delete Project Reconstructions

```http
DELETE /reconstruction/delete-project-reconstructions/:projectId
```

**Description**: Deletes all reconstruction data (database + S3 files) for a project. Use when re-running reconstruction after mask edits.

**URL Parameters**:
- `projectId` (string, required): Project ID

**Request Body**: None

**Authentication**: Required (`isAuthAndNotGuest`)

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
- **400**: Missing project ID
- **403**: User doesn't own project
- **500**: S3 deletion or database error

**Processing Flow**:
1. Verifies user owns the project
2. Fetches all reconstructions
3. Deletes mesh TAR files from S3
4. Deletes database records
5. Returns deletion count

**Important Notes**:
- Irreversible operation - deleted reconstructions cannot be recovered
- Automatically removes S3 mesh files
- Does not cancel in-progress reconstruction jobs
- Only project owner can delete

---

### Mesh Format Support

#### GLB Format (Default, Recommended)

**File Extension**: `.glb`  
**Description**: Binary glTF format

**Advantages**:
- ✅ Optimized for web/AR/VR
- ✅ 30-50% smaller than OBJ
- ✅ Faster loading/parsing
- ✅ Native browser support
- ✅ Single-file (embedded data)
- ✅ Animation/PBR support

**Best For**: Web viewers, AR/VR, modern platforms

#### OBJ Format (Backward Compatible)

**File Extension**: `.obj`  
**Description**: Wavefront OBJ format

**Advantages**:
- ✅ Legacy 3D software support
- ✅ Human-readable text
- ✅ Easy to debug
- ✅ Compatible with older tools

**Best For**: Legacy software, manual inspection

#### Format Comparison

| Feature | GLB | OBJ |
|---------|-----|-----|
| File Size | Smaller (binary) | Larger (text) |
| Web Performance | Excellent | Good |
| Browser Support | Native (modern) | Requires loader |
| AR/VR Ready | ✅ Yes | ⚠️ Conversion needed |
| Legacy Software | Limited | Excellent |
| Human Readable | ❌ No | ✅ Yes |
| Single File | ✅ Yes | ✅ Yes |
| Animation Support | ✅ Yes | ❌ No |

#### TAR Archive Packaging

All reconstructions packaged as TAR archives regardless of format:

**Naming Convention**: `{userId}_{filehash}_mesh.tar`

**Example TAR Contents (GLB)**:
```
gpu_callback_1761471371546_uuid.nii_4D_frame00_ED.glb  (ED frame)
gpu_callback_1761471371546_uuid.nii_4D_frame01.glb
gpu_callback_1761471371546_uuid.nii_4D_frame02.glb
...
gpu_callback_1761471371546_uuid.nii_4D_frame29.glb
```

**Example TAR Contents (OBJ)**:
```
gpu_callback_1761471371546_uuid.nii_4D_frame00_ED.obj  (ED frame)
gpu_callback_1761471371546_uuid.nii_4D_frame01.obj
gpu_callback_1761471371546_uuid.nii_4D_frame02.obj
...
gpu_callback_1761471371546_uuid.nii_4D_frame29.obj
```

**Filename Pattern**: `gpu_callback_{timestamp}_{uuid}.nii_4D_frame{number}_{label}.{format}`
- `timestamp`: Unix timestamp/unique ID
- `uuid`: Reconstruction UUID
- `number`: Frame number (zero-padded: 00, 01, ...)
- `label`: `_ED` for end-diastolic frame (based on `ed_frame` parameter), omitted for other frames
- `format`: `.glb` or `.obj`

**Frame Label Conventions**:
- `_ED`: End-diastolic frame (appears on frame specified by `ed_frame` parameter)
- No label: Regular frames

**Important Notes**:
- Frame numbering starts at `00`
- Only ED frame has `_ED` suffix
- OBJ files are standalone (no .mtl material files)
- Both formats use identical naming conventions
- Storage: S3 with presigned URLs (1-hour expiry)
- Extraction: Standard TAR tools (`tar -xf mesh.tar`)

---

## GPU Status Routes (`/status`)

**Base Path**: `/status`

Monitor GPU server availability and resource utilization.

### 1. Check GPU Status

```http
GET /status/gpu-status
```

**Description**: Checks GPU server status including GPU availability and utilization.

**Request Body**: None

**Authentication**: None (backend uses `injectGpuAuthToken` for GPU server)

**Success Response** (HTTP 200):
```json
{
  "status": "online",
  "gpuAvailable": "boolean",
  "gpuUtilization": "number (0-100)",
  "gpuMemoryUsed": "number (bytes)",
  "gpuMemoryTotal": "number (bytes)"
}
```

---

### 2. Check GPU System Status

```http
GET /status/gpu-system-status
```

**Description**: Retrieves system resource information from GPU server.

**Request Body**: None

**Authentication**: None

**Success Response** (HTTP 200):
```json
{
  "cpuUsage": "number (0-100)",
  "ramUsage": "number (bytes)",
  "ramTotal": "number (bytes)",
  "diskUsage": "number (bytes)",
  "diskTotal": "number (bytes)"
}
```

---

## Webhook Routes (`/webhook`)

**Base Path**: `/webhook`

Endpoints for GPU server callbacks (not for direct client use).

**Authentication**: GPU server authentication (automatic)
- **No user session required**
- Security via network-level controls:
  - GPU server IP whitelisting
  - Job UUID validation
  - Requests must originate from configured GPU server endpoint
- **Not for direct client use** - designed for server-to-server communication

### 1. GPU Segmentation Callback

```http
POST /webhook/gpu-callback
```

**Description**: Receives segmentation results from GPU server.

**Request Headers**:
- `X-Job-ID` (string, required): UUID of the segmentation job

**Request Body**: `application/json`
```json
{
  "status": "string (completed|failed|processing|success)",
  "result": {
    "image_frame0_slice0.jpg": {
      "boxes": [
        {
          "class_name": "string (RV|MYO|LVC)",
          "confidence": "number",
          "bbox": [x1, y1, x2, y2]
        }
      ],
      "masks": {
        "RV": "string (RLE encoded)",
        "MYO": "string (RLE encoded)",
        "LVC": "string (RLE encoded)"
      }
    }
  },
  "error": "string|object (error details if status is 'failed')"
}
```

**Authentication**: GPU server authentication (automatic)

**Success Response** (HTTP 200):
```json
{
  "message": "Callback processed successfully"
}
```

---

### 2. GPU Reconstruction Callback

```http
POST /webhook/gpu-reconstruction-callback
```

**Description**: Receives 4D reconstruction mesh files from GPU server.

**Request Format**: `multipart/form-data`
- Multiple mesh files (`.glb` or `.obj` format)
- JSON metadata with reconstruction parameters

**Processing Flow**:
1. Validates mesh files (GLB magic number or OBJ vertex definitions)
2. Creates TAR archive of all frames
3. Uploads to S3
4. Updates database with reconstruction metadata

**Authentication**: GPU server authentication (automatic)

**Success Response** (HTTP 200):
```json
{
  "message": "Reconstruction callback processed successfully"
}
```

---

## Admin Tools Routes (`/admintools`)

**Base Path**: `/admintools`

System administration endpoints for GPU configuration and monitoring.

### 1. Get GPU Configuration

```http
GET /admintools/gpu-config
```

**Description**: Retrieves current GPU server configuration.

**Request Body**: None

**Authentication**: Required (`isAuthAndAdmin`)

**Success Response** (HTTP 200):
```json
{
  "host": "string",
  "port": "number",
  "isHTTPS": "boolean",
  "description": "string",
  "serverIdForGpuServer": "string",
  "gpuServerIdentity": "string",
  "jwtRefreshInterval": "number (seconds)",
  "jwtLifetimeSeconds": "number (seconds)"
}
```

---

### 2. Update GPU Configuration

```http
PATCH /admintools/gpu-config
```

**Description**: Updates GPU server configuration settings.

**Request Body**: `application/json`
```json
{
  "host": "string (optional)",
  "port": "number (optional)",
  "isHTTPS": "boolean (optional)",
  "description": "string (optional)",
  "serverIdForGpuServer": "string (optional)",
  "gpuServerIdentity": "string (optional)",
  "gpuServerAuthJwtSecret": "string (optional)",
  "jwtRefreshInterval": "number (optional, seconds)",
  "jwtLifetimeSeconds": "number (optional, seconds)"
}
```

**Authentication**: Required (`isAuthAndAdmin`)

**Success Response** (HTTP 200):
```json
{
  "message": "GPU configuration updated successfully"
}
```

---

### 3. Reload GPU Configuration

```http
POST /admintools/gpu-config/reload
```

**Description**: Reloads GPU configuration from database and refreshes authentication.

**Request Body**: None

**Authentication**: Required (`isAuthAndAdmin`)

**Success Response** (HTTP 200):
```json
{
  "message": "GPU configuration reloaded successfully"
}
```

---

### 4. Test GPU Connection

```http
POST /admintools/gpu-config/test-connection
```

**Description**: Tests connection to GPU server with current configuration.

**Request Body**: None

**Authentication**: Required (`isAuthAndAdmin`)

**Success Response** (HTTP 200):
```json
{
  "success": true,
  "message": "GPU server connection successful"
}
```

**Error Response** (HTTP 500):
```json
{
  "success": false,
  "message": "GPU server connection failed: {error details}"
}
```

---

## AWS CloudWatch Metrics API

Monitor AWS infrastructure in real-time with CloudWatch and Cost Explorer integration.

**AWS SDK**: `@aws-sdk/client-cloudwatch`, `@aws-sdk/client-cost-explorer`

### Prerequisites

**AWS Credentials** (required in `.env`):
```bash
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
AWS_REGION=ap-southeast-1
```

**IAM Permissions**: `CloudWatchReadOnlyAccess`

### Response Format

All metric endpoints return standardized format:
```json
{
  "timestamps": [
    "2025-10-30T10:00:00.000Z",
    "2025-10-30T10:05:00.000Z"
  ],
  "values": [45.2, 52.1]
}
```

- **timestamps**: ISO 8601 formatted datetime strings
- **values**: Numeric values corresponding to each timestamp
- Data sorted chronologically (oldest to newest)

---

### EC2 Metrics

**Base Path**: `/metrics`  
**Time Range**: Last 1 hour  
**Period**: 5 minutes  
**Instance**: Auto-detected from environment or EC2 metadata service

#### CPU Utilization

```http
GET /metrics/cpu-utilization
```

**Description**: CPU usage percentage for current EC2 instance.

**Units**: Percent (0-100)  
**Statistic**: Average

---

#### Network In

```http
GET /metrics/network-in
```

**Description**: Bytes received by EC2 instance.

**Units**: Bytes  
**Statistic**: Sum

---

#### Network Out

```http
GET /metrics/network-out
```

**Description**: Bytes sent by EC2 instance.

**Units**: Bytes  
**Statistic**: Sum

---

#### Disk Read

```http
GET /metrics/disk-read
```

**Description**: Bytes read from all disks.

**Units**: Bytes  
**Statistic**: Sum

---

#### Disk Write

```http
GET /metrics/disk-write
```

**Description**: Bytes written to all disks.

**Units**: Bytes  
**Statistic**: Sum

---

### ECR Metrics

**Base Path**: `/ecr`  
**Time Range**: Last 7 days  
**Period**: 1 day  

**Note**: Repository size/image count not available in CloudWatch (returns empty arrays). Pull count metrics available.

#### Backend Repository Pull Count (Legacy)

```http
GET /ecr/repository-size
GET /ecr/image-count
```

**Description**: Pull count for backend ECR repository.

**Repository**: `cardiac_segmentation_fyp_server_backend` (default)

---

#### Backend Repository Metrics

```http
GET /ecr/backend/repository-size
GET /ecr/backend/image-count
```

**Description**: Pull count for backend repository.

**Repository**: Configured via `ECR_BACKEND_REPOSITORY_NAME`

---

#### Frontend Repository Metrics

```http
GET /ecr/frontend/repository-size
GET /ecr/frontend/image-count
```

**Description**: Pull count for frontend repository.

**Repository**: Configured via `ECR_FRONTEND_REPOSITORY_NAME`

---

### S3 Metrics

**Base Path**: `/metrics/s3`  
**Time Ranges**:
- Storage metrics: Last 30 days, period 1 day
- Request metrics: Last 7 days, period 1 hour

#### List All Buckets

```http
GET /metrics/s3/buckets
```

**Description**: Lists all S3 buckets.

**Response**:
```json
{
  "buckets": [
    {
      "Name": "bucket-name",
      "CreationDate": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

---

#### Bucket Size

```http
GET /metrics/s3/:bucketName/bucket-size
```

**URL Parameters**:
- `bucketName` (required): S3 bucket name

**Units**: Bytes  
**Statistic**: Average  
**Storage Type**: StandardStorage

---

#### Object Count

```http
GET /metrics/s3/:bucketName/object-count
```

**URL Parameters**:
- `bucketName` (required): S3 bucket name

**Units**: Count  
**Statistic**: Average  
**Storage Type**: AllStorageTypes

---

#### All Requests

```http
GET /metrics/s3/:bucketName/all-requests
```

**URL Parameters**:
- `bucketName` (required): S3 bucket name

**Description**: Total requests to bucket.

**Units**: Count  
**Statistic**: Sum

---

#### GET Requests

```http
GET /metrics/s3/:bucketName/get-requests
```

**URL Parameters**:
- `bucketName` (required): S3 bucket name

**Units**: Count  
**Statistic**: Sum

---

#### PUT Requests

```http
GET /metrics/s3/:bucketName/put-requests
```

**URL Parameters**:
- `bucketName` (required): S3 bucket name

**Units**: Count  
**Statistic**: Sum

---

#### All Metrics Combined

```http
GET /metrics/s3/:bucketName/all
```

**URL Parameters**:
- `bucketName` (required): S3 bucket name

**Description**: All S3 metrics in single request.

**Response**:
```json
{
  "bucketName": "my-bucket",
  "bucketSizeBytes": { "timestamps": [...], "values": [...] },
  "numberOfObjects": { "timestamps": [...], "values": [...] },
  "allRequests": { "timestamps": [...], "values": [...] },
  "getRequests": { "timestamps": [...], "values": [...] },
  "putRequests": { "timestamps": [...], "values": [...] }
}
```

---

### ALB Metrics

**Base Path**: `/metrics/alb`  
**Time Range**: Last 24 hours  
**Period**: 5 minutes  
**Load Balancer**: Configured via `ALB_NAME`

#### Request Count

```http
GET /metrics/alb/request-count
```

**Description**: Total requests handled by ALB.

**Units**: Count  
**Statistic**: Sum

---

#### Target Response Time

```http
GET /metrics/alb/target-response-time
```

**Description**: Average target response time.

**Units**: Seconds  
**Statistic**: Average

---

#### HTTP 4XX Errors (ELB)

```http
GET /metrics/alb/http-4xx-elb
```

**Description**: 4xx errors from ALB (malformed requests).

**Units**: Count  
**Statistic**: Sum

---

#### HTTP 4XX Errors (Target)

```http
GET /metrics/alb/http-4xx-target
```

**Description**: 4xx errors from backend targets.

**Units**: Count  
**Statistic**: Sum

---

#### Healthy Host Count

```http
GET /metrics/alb/healthy-hosts
```

**Description**: Number of healthy targets.

**Units**: Count  
**Statistic**: Average  
**Requires**: `TARGET_GROUP_NAME` environment variable

---

#### Unhealthy Host Count

```http
GET /metrics/alb/unhealthy-hosts
```

**Description**: Number of unhealthy targets.

**Units**: Count  
**Statistic**: Average  
**Requires**: `TARGET_GROUP_NAME` environment variable

---

### ASG Metrics

**Base Path**: `/metrics/asg`  
**Time Range**: Last 1 hour  
**Period**: 5 minutes  
**Auto Scaling Group**: Configured via `ASG_NAME`

#### Minimum Size

```http
GET /metrics/asg/min-size
```

**Description**: Minimum ASG size.

**Units**: Count  
**Statistic**: Maximum

---

#### Maximum Size

```http
GET /metrics/asg/max-size
```

**Description**: Maximum ASG size.

**Units**: Count  
**Statistic**: Maximum

---

#### Desired Capacity

```http
GET /metrics/asg/desired-capacity
```

**Description**: Target instance count.

**Units**: Count  
**Statistic**: Average

---

#### In-Service Instances

```http
GET /metrics/asg/in-service
```

**Description**: Running instances.

**Units**: Count  
**Statistic**: Average

---

#### Pending Instances

```http
GET /metrics/asg/pending
```

**Description**: Instances being launched.

**Units**: Count  
**Statistic**: Average

---

#### Total Instances

```http
GET /metrics/asg/total
```

**Description**: Total instances (in-service + pending + terminating).

**Units**: Count  
**Statistic**: Average

---

### Billing & Cost Metrics

**Base Path**: `/metrics/billing`  
**Time Range**: Current month  
**Granularity**: Monthly  
**Currency**: USD

#### Total Costs

```http
GET /metrics/billing/total
```

**Description**: Total AWS costs for current month.

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "service": "Total",
      "amount": 125.45,
      "unit": "USD"
    }
  ],
  "timestamp": "2025-10-30T10:15:00.000Z"
}
```

---

#### Costs by Service

```http
GET /metrics/billing/by-service
```

**Description**: AWS costs grouped by service.

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "service": "Amazon Elastic Compute Cloud - Compute",
      "amount": 45.30,
      "unit": "USD"
    },
    {
      "service": "Amazon Simple Storage Service",
      "amount": 12.50,
      "unit": "USD"
    }
  ],
  "timestamp": "2025-10-30T10:15:00.000Z"
}
```

---

### Metric Characteristics

| Service | Time Range | Period | Update Frequency |
|---------|-----------|--------|------------------|
| EC2 | 1 hour | 5 minutes | Real-time |
| ECR | 7 days | 1 day | Daily |
| S3 (Storage) | 30 days | 1 day | Daily |
| S3 (Requests) | 7 days | 1 hour | Hourly |
| ALB | 24 hours | 5 minutes | Real-time |
| ASG | 1 hour | 5 minutes | Real-time |
| Billing | Current month | Monthly | Daily |

---

## Debug Routes (Development Only)

⚠️ **CRITICAL SECURITY WARNING**: 
- These routes are **ONLY enabled when `NODE_ENV !== "production"`**
- Controlled by environment variable check in `src/index.ts`
- **NEVER** deploy to production with `NODE_ENV` set to anything other than `"production"`
- They expose sensitive authentication tokens and bypass security middleware
- Intended for local development and testing only

**Deployment Safety**:
```bash
# Production deployment MUST set:
NODE_ENV=production

# Verify debug routes are disabled:
curl https://production-api.com/get-gpu_token
# Should return: 404 Not Found (if properly configured)
```

### 1. Get GPU Server Token

```http
GET /get-gpu_token
```

**Description**: Retrieves current GPU server authentication token.

**Request Body**: None

**Authentication**: None

---

### 2. Start Bounding Box Inferencing (Debug)

```http
GET /start-bbox-inferencing
```

**Description**: Initiates sample bounding box inference with hardcoded parameters (testing GPU job submission).

**Request Body**: None

**Authentication**: None (GPU auth via `injectGpuAuthToken`)

---

### 3. GPU Webhook (Debug)

```http
POST /gpu-webhook
```

**Description**: Debug version of GPU callback webhook.

**Request Body**: `application/json`
```json
{
  "uuid": "string (job ID)",
  "status": "string (completed|failed)",
  "result": "object (inference results)",
  "error": "string|object (error details)"
}
```

**Authentication**: None

---

## Environment Configuration

### Required Environment Variables

```bash
# MongoDB
MONGODB_URI=mongodb://localhost:27017/visheart

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# Security
SESSION_SECRET=your_session_secret
GPU_SERVER_AUTH_JWT_SECRET=your_gpu_auth_secret

# AWS S3
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key
AWS_BUCKET_NAME=your_s3_bucket_name
AWS_REGION=ap-southeast-1

# GPU Server
GPU_SERVER_URL=https://gpu.example.com
GPU_SERVER_PORT=8000
GPU_SERVER_SSL=true
CALLBACK_URL=https://api.visheart.art

# Admin
ADMIN_PASS=your_admin_password

# EC2 (optional - auto-detected)
EC2_INSTANCE_ID=i-1234567890abcdef0

# ECR
ECR_BACKEND_REPOSITORY_NAME=cardiac_segmentation_fyp_server_backend
ECR_FRONTEND_REPOSITORY_NAME=cardiac_segmentation_fyp_server_frontend

# ALB
ALB_NAME=app/my-load-balancer/1234567890abcdef
TARGET_GROUP_NAME=targetgroup/my-target-group/1234567890abcdef

# ASG
ASG_NAME=my-auto-scaling-group

# Reconstruction
RECONSTRUCTION_MESH_FORMAT=glb  # or 'obj'
```

---

## Implementation Notes

### Reconstruction NIfTI Generation

The system uses two methods for generating segmentation NIfTI files (from `src/services/segmentation_export.ts`):

1. **Stored Affine Matrix Approach** (Preferred, Faster):
   - Uses affine matrix stored in project metadata during upload
   - No S3 download required
   - Script: `src/python/create_nifti_with_stored_affine.py`
   - Enabled when `project.affineMatrix` exists in database

2. **Legacy Download Approach**:
   - Downloads original NIfTI from S3 to extract affine matrix
   - Fallback for projects created before affine matrix storage was implemented
   - Script: `src/python/create_nifti_from_segmentations.py`
   - Used when `project.affineMatrix` is not available

**Output Quality**: Both methods produce identical output quality and accurate spatial alignment. The stored affine approach is faster as it avoids S3 download overhead (typically 2-5 seconds faster).

**NIfTI Generation Logging**: The system logs detailed information during reconstruction NIfTI generation for debugging:
- Segmentation mask structure (frame count, slice indices)
- Class distribution across frames (RV, MYO, LVC counts)
- Critical parameters (dimensions, affine matrix shape)
- Expected output shape for validation
- File paths and processing steps

**Editable Mask Validation**: The reconstruction pipeline strictly validates:
- Only processes editable masks (`isMedSAMOutput: false`)
- Returns clear error if no editable mask exists
- Logs which mask type is being used for transparency

---

## Additional Resources

- [AWS CloudWatch Documentation](https://docs.aws.amazon.com/cloudwatch/)
- [AWS Cost Explorer API](https://docs.aws.amazon.com/cost-management/latest/userguide/ce-api.html)
- [IAM Policies for CloudWatch](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/permissions-reference-cw.html)
- [MongoDB Documentation](https://docs.mongodb.com/)
- [Express.js Guide](https://expressjs.com/en/guide/routing.html)

---

## Version History

*Last Updated: November, 2025*