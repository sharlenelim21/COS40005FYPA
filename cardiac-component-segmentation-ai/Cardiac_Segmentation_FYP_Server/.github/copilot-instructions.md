# VisHeart Cardiac Segmentation Server - AI Coding Instructions

## Architecture Overview
This is a **medical imaging backend** that processes cardiac NIfTI/DICOM files through AI segmentation. The system coordinates between:
- **Node.js/Express API** (this server) - handles file uploads, user management, project lifecycle
- **GPU Server** (`./visheart-inference-gpu`) - FastAPI + YOLO + MedSAM for cardiac segmentation
- **MongoDB** - stores projects, users, segmentation masks, and job queues
- **Redis** - manages sessions and caching
- **AWS S3** - stores original files and processed outputs
- **Python scripts** - handles medical image format conversions (NIfTI ↔ JPEG)

## Core Data Flow
1. User uploads NIfTI/DICOM → stored in S3, metadata extracted via Python
2. Segmentation request → queued as Job, sent to GPU server with presigned S3 URLs
3. GPU server (YOLO + MedSAM) → returns RLE-encoded masks via webhook callbacks
4. Results stored in MongoDB, converted to NIfTI for export

## Essential Patterns

### Authentication & Authorization
- **Session-based auth** via `express-session` + Redis (not JWT)
- **Role hierarchy**: Guest < User < Admin (see `UserRole` enum in `src/types/database_types.ts`)
- **Middleware stack**: `isAuth` → `isAuthAndNotGuest` → `isAuthAndAdmin`
- **GPU authentication**: Self-generated JWT system via `gpu_auth_client.ts` + `injectGpuAuthToken` middleware
- **Guest cleanup**: Automated CRON job removes inactive guests (configurable via `GUEST_INACTIVITY_THRESHOLD_HOURS`)

### Database Patterns
- **Service layer**: All DB operations go through `src/services/database.ts` (1690 lines - central hub)
- **Type safety**: Strict interfaces in `src/types/database_types.ts` with proper Document extensions
- **CRUD pattern**: Functions return `{ success: boolean, message?: string, data?: T }` structure
- **Document structure**: Projects contain embedded segmentation frames/slices with RLE masks
- **Connection**: Mongoose with automatic reconnection, admin user seeded on startup

### File Processing & Storage
- **Upload flow**: `project_routes.ts` → `uploadmiddleware.ts` → `project_handler.ts` → S3
- **Python integration**: Execute via `child_process.exec()` for medical image operations in `src/python/`
- **Temp directories**: `temp_upload/`, `temp_jpeg/`, `temp_exports/` (auto-cleaned, ignored by nodemon)
- **S3 integration**: Presigned URLs for secure file access, configurable via `STORAGE_MODE=s3`
- **File validation**: Medical imaging formats (.nii, .nii.gz) with size limits

### GPU Server Integration
- **Microservice**: Separate FastAPI service (`./visheart-inference-gpu`) with Docker deployment
- **Authentication**: Self-signed JWT tokens managed by `gpu_auth_client.ts` with auto-refresh
- **Database config**: GPU server endpoints configurable via database with fallback to env vars
- **Webhook callbacks**: Async processing results delivered via webhooks to `/webhook/*` routes
- **Concurrency**: GPU server handles concurrent requests with resource management

### Error Handling & Logging
- **Centralized logging**: Winston logger in `src/services/logger.ts` with file rotation
- **Error utility**: `LogError()` function for consistent error tracking with service location context
- **Response pattern**: Always return `{ success: boolean, message: string }` structure
- **Health checks**: Redis and database connectivity monitoring

## Development Workflow

### Local Development
```bash
npm run dev          # Development with nodemon + ts-node
npm run build        # TypeScript compilation to dist/
npm run test         # Jest tests with --runInBand --detectOpenHandles
npm start           # Production (runs compiled JS)
```

### Testing Patterns
- **Jest config**: Uses ts-jest preset, node environment, tests in `__tests__/` directory
- **Database tests**: Connection state checks before running DB operations
- **Async handling**: Tests use `--runInBand --detectOpenHandles --forceExit` flags

### Deployment
- **PM2 ecosystem**: `ecosystem.config.js` with pnpm integration and virtual environment PATH
- **Docker**: GPU server containerized with CUDA support requirements
- **Environment**: Development vs production configs with different cleanup thresholds

## Environment Dependencies
**Critical env vars** (check `.env` file):
- `MONGODB_URI` - MongoDB connection (supports both local and Atlas)
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` - Redis Cloud configuration
- `SESSION_SECRET`, `GPU_SERVER_AUTH_JWT_SECRET` - Security tokens
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_BUCKET_NAME` - S3 storage
- `GPU_SERVER_URL`, `GPU_SERVER_PORT`, `GPU_SERVER_SSL` - Cloud inference server
- `CALLBACK_URL` - Webhook endpoint for GPU server responses
- `ADMIN_PASS` - Default admin password for seeded admin user

## Route Architecture
- `/auth/*` - Session management, role-based access (see extensive API docs in README.md)
- `/projects/*` - File upload, project lifecycle, metadata extraction
- `/segmentation/*` - AI inference coordination, manual segmentation tools
- `/admin/*` - System monitoring, user management tools
- `/webhook/*` - GPU server async callback handlers
- `/gpu-status` - Real-time GPU server health monitoring

## Common Patterns & Gotchas
- **Service location**: Use descriptive `serviceLocation` constants for logging context
- **File extensions**: Handle both `.nii` and `.nii.gz` formats in validation
- **Medical enums**: Use proper TypeScript enums (`FileDataType`, `ComponentBoundingBoxesClass`)
- **Async operations**: Always wrap in try/catch with `LogError()` calls
- **Middleware order**: GPU auth middleware must come after user auth middleware
- **Temp cleanup**: Temporary directories excluded from nodemon watching
- **Database startup**: Connect to database before initializing GPU auth client
- **Memory limits**: JSON parsing increased to 10mb for webhook payloads
