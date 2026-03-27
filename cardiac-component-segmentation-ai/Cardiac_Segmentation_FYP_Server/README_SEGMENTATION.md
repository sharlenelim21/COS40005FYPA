# VisHeart Backend Server

Stack:

![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB)
![MongoDB](https://img.shields.io/badge/MongoDB-%234ea94b.svg?style=for-the-badge&logo=mongodb&logoColor=white)

Written in:

![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)

# API Documentation

This document provides a comprehensive overview of the API endpoints, including supported methods, expected request formats (JSON, multipart/form-data), and authentication requirements.

## General Notes

- **Authentication**: Many endpoints require authentication. This is typically handled via session cookies established after a successful login. The `isAuth` middleware protects these routes. Role-based access is controlled by `isAuthAndAdmin` or `isAuthAndNotGuest`.
- **GPU Authentication**: Some routes interact with a separate GPU server. The backend server manages authentication with the GPU server using a token. The `injectGpuAuthToken` middleware ensures the backend has this token before making requests to the GPU server. Client applications calling these backend endpoints do not need to manage or send this specific GPU server token directly; they rely on the standard user authentication with the backend.
- **Validation**: Input validation is performed on many routes. Refer to the specific endpoint details for required fields and formats.
- **Error Responses**: Errors are generally returned with appropriate HTTP status codes (e.g., 400 for bad request, 401 for unauthorized, 403 for forbidden, 404 for not found, 500 for internal server error) and a JSON body containing a `message` or `errors` field.

## Authentication Routes (`/auth`)

Base Path: `/auth`

Endpoints for user registration, login, logout, and profile management.

---

### 1\. Register New User

- **Endpoint**: `POST /auth/register`
- **Description**: Registers a new user.
- **Request Body**: `application/json`
  ```json
  {
    "username": "string",
    "password": "string (must meet complexity requirements)",
    "email": "string (valid email format)",
    "phone": "string (valid phone number format)"
  }
  ```
- **Authentication**: None

---

### 2\. Register From Guest

- **Endpoint**: `POST /auth/register-from-guest`
- **Description**: Upgrades a guest user to a registered user account.
- **Request Body**: `application/json`
  ```json
  {
    "username": "string",
    "password": "string (must meet complexity requirements)",
    "email": "string (valid email format)",
    "phone": "string (valid phone number format)"
  }
  ```
- **Authentication**: Required, user must be a guest (`isAuthandGuest`)

---

### 3\. User Login

- **Endpoint**: `POST /auth/login`
- **Description**: Logs in an existing user and establishes a session.
- **Request Body**: `application/json`
  ```json
  {
    "username": "string",
    "password": "string"
  }
  ```
- **Authentication**: None

---

### 4\. User Logout

- **Endpoint**: `POST /auth/logout`
- **Description**: Logs out the currently authenticated user and invalidates the session.
- **Request Body**: None
- **Authentication**: Required (`isAuth`)

---

### 5\. Delete User Account

- **Endpoint**: `POST /auth/delete`
- **Description**: Deletes the authenticated user's account and all associated data.
- **Request Body**: `application/json`
  ```json
  {
    "password": "string (current password for verification)"
  }
  ```
- **Authentication**: Required, user must not be a guest (`isAuthAndNotGuest`)

---

### 6\. Guest Login

- **Endpoint**: `POST /auth/guest`
- **Description**: Creates a temporary guest user account and logs them in.
- **Request Body**: None
- **Authentication**: None

---

### 7\. Update User Information

- **Endpoint**: `POST /auth/update`
- **Description**: Updates the authenticated user's profile information (username, email, phone).
- **Request Body**: `application/json`
  ```json
  {
    "username": "string",
    "email": "string (valid email format)",
    "phone": "string (valid phone number format)"
  }
  ```
- **Authentication**: Required, user must not be a guest (`isAuthAndNotGuest`)

---

### 8\. Update User Password

- **Endpoint**: `POST /auth/update-password`
- **Description**: Updates the authenticated user's password.
- **Request Body**: `application/json`
  ```json
  {
    "old_password": "string",
    "password": "string (new password, must meet complexity requirements)"
  }
  ```
- **Authentication**: Required, user must not be a guest (`isAuthAndNotGuest`)

---

### 9\. Update User Role (Admin)

- **Endpoint**: `POST /auth/update-role`
- **Description**: Updates the role of a specified user.
- **Request Body**: `application/json`
  ```json
  {
    "username": "string (username of the user to update)",
    "newrole": "string (target role: e.g., 'User', 'Admin', 'Guest')"
  }
  ```
- **Authentication**: Required, user must be an admin (`isAuthAndAdmin`)

---

### 10\. Fetch User Information

- **Endpoint**: `GET /auth/fetch`
- **Description**: Retrieves the profile information of the currently authenticated user.
- **Request Body**: None
- **Authentication**: Required (`isAuth`)

---

### 11\. Admin Route Test

- **Endpoint**: `GET /auth/admin`
- **Description**: A sample route to test if a user is an authenticated admin.
- **Request Body**: None
- **Authentication**: Required, user must be an admin (`isAuthAndAdmin`)

---

### 12\. Admin Delete User

- **Endpoint**: `POST /auth/admin-delete-user`
- **Description**: Allows administrators to delete any user account.
- **Request Body**: `application/json`
  ```json
  {
    "username": "string (username of the user to delete)"
  }
  ```
- **Authentication**: Required, user must be an admin (`isAuthAndAdmin`)

---

### 13\. Admin Update User

- **Endpoint**: `POST /auth/admin-update-user`
- **Description**: Allows administrators to update any user's information.
- **Request Body**: `application/json`
  ```json
  {
    "username": "string (username of the user to update)",
    "newUsername": "string (optional, new username)",
    "email": "string (optional, new email)",
    "phone": "string (optional, new phone)",
    "role": "string (optional, new role)"
  }
  ```
- **Authentication**: Required, user must be an admin (`isAuthAndAdmin`)

---

### 14\. Get All Users (Admin)

- **Endpoint**: `GET /auth/users`
- **Description**: Retrieves a list of all users in the system.
- **Request Body**: None
- **Authentication**: Required, user must be an admin (`isAuthAndAdmin`)

---

### 15\. Protected Route Test

- **Endpoint**: `GET /auth/protected`
- **Description**: A sample route to test if a user is authenticated.
- **Request Body**: None
- **Authentication**: Required (`isAuth`)

---

## Project Routes (`/project`)

Base Path: `/project`

Endpoints for managing projects, including file uploads and metadata updates.

---

### 1\. Get Project Information

- **Endpoint**: `GET /project/get-project-info/:projectId`
- **Description**: Retrieves detailed information about a specific project.
- **Path Parameters**:
  - `projectId`: `string` - The ID of the project to retrieve.
- **Request Body**: None
- **Authentication**: Required (`isAuth`)

---

### 2\. Upload New Project

- **Endpoint**: `PUT /project/upload-new-project`
- **Description**: Uploads a new project file (e.g., NIfTI, DICOM) and associated metadata.
- **Request Body**: `multipart/form-data`
  - `files`: File (The project file. Allowed extensions: `.nii`, `.nii.gz`, `.dcm`. Max 1 file per request. Max file size: 200GB)
  - `name`: String (Name of the project)
  - `description`: String (Description of the project)
- **Authentication**: Required (`isAuth`)

  **Example `curl` command:**

  ```bash
  curl -X PUT -H "Cookie: <session_cookie_here>" \
       -F "files=@/path/to/your/file.nii.gz" \
       -F "name=My First Project" \
       -F "description=This is a test NIfTI file upload" \
       http://localhost:PORT/project/upload-new-project
  ```

---

### 3\. Get Projects List

- **Endpoint**: `GET /project/get-projects-list`
- **Description**: Retrieves a list of projects for the authenticated user. Supports filtering.
- **Query Parameters**:
  - `projectid` (optional): `string` - Filter by a specific project ID.
  - `name` (optional): `string` - Filter by project name (substring match).
  - `filetype` (optional): `string` or `array of strings` - Filter by file type(s) (e.g., "nifti", "nifti_gz", "dicom").
    - Example: `?filetype=nifti` or `?filetype=nifti&filetype=dicom`
  - `daterange` (optional): `JSON string` - Filter by creation date range.
    - Format: `{ "start": "YYYY-MM-DDTHH:mm:ss.sssZ", "end": "YYYY-MM-DDTHH:mm:ss.sssZ" }`
    - Example: `?daterange={"start":"2023-01-01T00:00:00.000Z","end":"2023-12-31T23:59:59.999Z"}`
- **Authentication**: Required (`isAuth`)

---

### 4\. Get All Users with Projects (Admin)

- **Endpoint**: `GET /project/get-allusers-with-projects`
- **Description**: Retrieves a list of all users and their associated projects.
- **Request Body**: None
- **Authentication**: Required, user must be an admin (`isAuthAndAdmin`)

---

### 5\. Update Project Details

- **Endpoint**: `PATCH /project/update-project`
- **Description**: Updates the name and/or description of an existing project.
- **Request Body**: `application/json`
  ```json
  {
    "projectId": "string (required, ID of the project to update)",
    "name": "string (optional, new name for the project)",
    "description": "string (optional, new description for the project)"
  }
  ```
- **Authentication**: Required (`isAuth`)

---

### 6\. Save/Unsave Project

- **Endpoint**: `PATCH /project/save-project`
- **Description**: Marks a project as "saved" (to prevent automatic deletion by cleanup jobs) or "unsaved".
- **Request Body**: `application/json`
  ```json
  {
    "projectId": "string (required, ID of the project)",
    "isSaved": "boolean (required, true to save, false to unsave)"
  }
  ```
- **Authentication**: Required, user must not be a guest (`isAuthAndNotGuest`)

---

### 7\. Get Project Presigned URL

- **Endpoint**: `GET /project/get-project-presigned-url`
- **Description**: Generates a presigned URL for downloading project files from S3.
- **Query Parameters**:
  - `projectId`: `string` (required) - The ID of the project.
  - `expiryInSeconds`: `number` (optional) - URL expiry time in seconds (default: 1800).
- **Request Body**: None
- **Authentication**: Required (`isAuth`)

---

### 8\. User Delete Project

- **Endpoint**: `DELETE /project/user-delete-project/:projectId`
- **Description**: Allows a user to delete their own project and all associated data.
- **Path Parameters**:
  - `projectId`: `string` - The ID of the project to delete.
- **Request Body**: None
- **Authentication**: Required, user must not be a guest (`isAuthAndNotGuest`)

---

### 9\. Admin Delete Project

- **Endpoint**: `DELETE /project/admin-delete-project/:projectId`
- **Description**: Allows administrators to delete any project and all associated data.
- **Path Parameters**:
  - `projectId`: `string` - The ID of the project to delete.
- **Request Body**: None
- **Authentication**: Required, user must be an admin (`isAuthAndAdmin`)

---

## Segmentation Routes (`/segmentation`)

Base Path: `/segmentation`

Endpoints for initiating and managing medical image segmentation tasks.

---

### 1\. Start AI Segmentation

- **Endpoint**: `POST /segmentation/start-segmentation/:projectId`
- **Description**: Initiates an AI segmentation inference task on the GPU server for the specified project.
- **Path Parameters**:
  - `projectId`: `string` - The ID of the project to be segmented.
- **Request Body**: None (Project ID is taken from the URL path).
- **Authentication**: Required (`isAuth`). The backend uses `injectGpuAuthToken` middleware to communicate with the GPU server.

---

### 2\. Get Segmentation Results

- **Endpoint**: `GET /segmentation/segmentation-results/:projectId`
- **Description**: Retrieves the AI segmentation results for a specific project.
- **Path Parameters**:
  - `projectId`: `string` - The ID of the project to retrieve results for.
- **Request Body**: None
- **Authentication**: Required (`isAuth`)

---

### 3\. Start Manual Segmentation

- **Endpoint**: `POST /segmentation/start-manual-segmentation/:projectId`
- **Description**: Initiates a manual segmentation task using user-provided bounding box coordinates.
- **Path Parameters**:
  - `projectId`: `string` - The ID of the project to be segmented.
- **Request Body**: `application/json`
  ```json
  {
    "image_name": "string (required, name of the image to segment)",
    "bbox": "array (required, bounding box coordinates as [x1, y1, x2, y2])",
    "segmentationName": "string (optional, name for the segmentation)",
    "segmentationDescription": "string (optional, description for the segmentation)"
  }
  ```
- **Authentication**: Required (`isAuth`). The backend uses `injectGpuAuthToken` middleware to communicate with the GPU server.

---

### 4\. Check User Jobs

- **Endpoint**: `GET /segmentation/user-check-jobs`
- **Description**: Retrieves the status of all segmentation jobs for the authenticated user.
- **Request Body**: None
- **Authentication**: Required (`isAuth`)

---

### 5\. Check All Jobs Status (Admin)

- **Endpoint**: `GET /segmentation/admin-check-all-jobs-status`
- **Description**: Retrieves the status of all segmentation jobs across all users.
- **Request Body**: None
- **Authentication**: Required, user must be an admin (`isAuthAndAdmin`)

---

### 6\. Save AI Segmentation

- **Endpoint**: `PATCH /segmentation/save-ai-segmentation`
- **Description**: Saves AI segmentation results to prevent automatic deletion.
- **Request Body**: `application/json`
  ```json
  {
    "projectId": "string (required, ID of the project)",
    "segmentationId": "string (required, ID of the segmentation to save)"
  }
  ```
- **Authentication**: Required, user must not be a guest (`isAuthAndNotGuest`)

---

### 7\. Save Manual Segmentation

- **Endpoint**: `PUT /segmentation/save-manual-segmentation/:projectId`
- **Description**: Saves manual segmentation results to the database.
- **Path Parameters**:
  - `projectId`: `string` - The ID of the project.
- **Request Body**: `application/json`
  ```json
  {
    "segmentationData": "object (required, segmentation mask data)",
    "segmentationName": "string (optional, name for the segmentation)",
    "segmentationDescription": "string (optional, description for the segmentation)"
  }
  ```
- **Authentication**: Required (`isAuth`)

---

### 8\. Export Project Data

- **Endpoint**: `GET /segmentation/export-project-data/:projectId`
- **Description**: Exports project data and segmentation results in various formats.
- **Path Parameters**:
  - `projectId`: `string` - The ID of the project to export.
- **Query Parameters**:
  - `format` (optional): `string` - Export format ('json', 'nifti', 'dicom'). Default: 'json'
- **Request Body**: None
- **Authentication**: Required (`isAuth`)

---

## GPU Status Routes (`/status`)

Base Path: `/status`

Endpoints for checking the status and availability of the GPU server.

---

### 1\. Check GPU Status

- **Endpoint**: `GET /status/gpu-status`
- **Description**: Checks the GPU server status including GPU availability and utilization.
- **Request Body**: None
- **Authentication**: None explicitly required for the client to call this backend endpoint, but the backend uses `injectGpuAuthToken` middleware to authenticate its request to the GPU server.

---

### 2\. Check GPU System Status

- **Endpoint**: `GET /status/gpu-system-status`
- **Description**: Retrieves system status information (RAM, CPU usage) from the GPU server.
- **Request Body**: None
- **Authentication**: None explicitly required for the client to call this backend endpoint.

---

## Webhook Routes (`/webhook`)

Base Path: `/webhook`

Endpoints designed to be called by external services (like the GPU server) to send back results or notifications.

---

### 1\. GPU Callback

- **Endpoint**: `POST /webhook/gpu-callback`
- **Description**: This webhook endpoint is called by the GPU server to return the results of an inference job (e.g., segmentation or bounding box detection).
- **Request Headers**:
  - `X-Job-ID`: `string` - The unique job identifier (UUID) that was initially sent to the GPU server.
- **Request Body**: `application/json`
  ```json
  {
    "status": "string (e.g., 'completed', 'failed', 'processing', 'success')",
    "result": "object | string (Contains the inference results. Structure depends on the task and GPU server output. For completed segmentation, it might be a map of image filenames to segmentation data including bounding boxes and RLE encoded masks. See example below.)",
    "error": "string | object (Details of the error if the 'status' is 'failed')"
  }
  ```
  **Example `result` object structure for completed segmentation:**
  ```json
  {
    "image_frame0_slice0.jpg": {
      "boxes": [
        { "class_name": "RV", "confidence": 0.98, "bbox": [100, 150, 200, 250] },
        { "class_name": "MYO", "confidence": 0.95, "bbox": [110, 160, 210, 260] }
      ],
      "masks": {
        "RV": "RLE_encoded_string_for_RV_mask",
        "MYO": "RLE_encoded_string_for_MYO_mask"
      }
    },
    "image_frame0_slice1.jpg": {
      "// ... similar structure for other slices/frames"
    }
  }
  ```
- **Authentication**: None (This endpoint is designed to be called by the GPU server, which is typically secured by network rules or a pre-shared secret/token mechanism if needed, not user session auth).

---

## Admin Tools Routes (`/admintools`)

Base Path: `/admintools`

Administrative endpoints for managing GPU server configuration and system settings.

---

### 1\. Get GPU Configuration

- **Endpoint**: `GET /admintools/gpu-config`
- **Description**: Retrieves the current GPU server configuration settings.
- **Request Body**: None
- **Authentication**: Required, user must be an admin (`isAuthAndAdmin`)

---

### 2\. Update GPU Configuration

- **Endpoint**: `PATCH /admintools/gpu-config`
- **Description**: Updates GPU server configuration settings.
- **Request Body**: `application/json`
  ```json
  {
    "host": "string (optional, GPU server hostname)",
    "port": "number (optional, GPU server port)",
    "isHTTPS": "boolean (optional, whether to use HTTPS)",
    "description": "string (optional, configuration description)",
    "serverIdForGpuServer": "string (optional, server identifier)",
    "gpuServerIdentity": "string (optional, GPU server identity)",
    "gpuServerAuthJwtSecret": "string (optional, JWT secret for authentication)",
    "jwtRefreshInterval": "number (optional, JWT refresh interval in seconds)",
    "jwtLifetimeSeconds": "number (optional, JWT lifetime in seconds)"
  }
  ```
- **Authentication**: Required, user must be an admin (`isAuthAndAdmin`)

---

### 3\. Reload GPU Configuration

- **Endpoint**: `POST /admintools/gpu-config/reload`
- **Description**: Reloads the GPU configuration from the database and refreshes authentication.
- **Request Body**: None
- **Authentication**: Required, user must be an admin (`isAuthAndAdmin`)

---

### 4\. Test GPU Connection

- **Endpoint**: `POST /admintools/gpu-config/test-connection`
- **Description**: Tests the connection to the GPU server with current configuration.
- **Request Body**: None
- **Authentication**: Required, user must be an admin (`isAuthAndAdmin`)

---

## Debug Routes (No Prefix - Development Only)

Base Path: No prefix (routes are mounted directly on the app in development mode)

**Caution: These routes are for debugging purposes only and should NOT be exposed or used in a production environment.**

---

### 1\. Get GPU Server Token

- **Endpoint**: `GET /get-gpu_token`
- **Description**: Retrieves the current authentication token that the backend server is using to communicate with the GPU server.
- **Request Body**: None
- **Authentication**: None

---

### 2\. Start Bounding Box Inferencing (Debug)

- **Endpoint**: `GET /start-bbox-inferencing`
- **Description**: Initiates a sample bounding box inferencing job using hardcoded parameters. This endpoint is for testing the GPU job submission flow.
- **Request Body**: None
- **Authentication**: Intended for use without user auth (`isAuth` is commented out in the source). The backend uses `injectGpuAuthToken` for its request to the GPU server.
- **Note**: This route internally sends a POST request to the GPU server at `/inference/v2/medsam-inference` with a JSON body like:
  ```json
  {
    "url": "string (presigned URL to the source NIfTI file)",
    "callback_url": "string (URL for the GPU server to post results back, typically the /debug/gpu-webhook or /webhook/gpu-callback)",
    "uuid": "string (unique job identifier)"
  }
  ```

---

### 3\. GPU Webhook (Debug)

- **Endpoint**: `POST /gpu-webhook`
- **Description**: A debug version of the GPU callback webhook. It is similar to the one in `webhook_routes.ts`. Ensure there are no path conflicts if both are active.
- **Request Body**: `application/json` (Same structure as `/webhook/gpu-callback`)
  ```json
  {
    "uuid": "string (job identifier)",
    "status": "string (e.g., 'completed', 'failed')",
    "result": "object (inference results)",
    "error": "string | object (error details if any)"
  }
  ```
- **Authentication**: None

---
