# VisHeart Frontend - AI Coding Instructions

## Architecture Overview
Next.js 15 App Router medical imaging frontend for cardiac segmentation. **Session-based authentication** (cookies, not JWT) requires `withCredentials: true` on all axios calls.

**Integration Points:**
- Backend API (`Cardiac_Segmentation_FYP_Server`) on port 3001 - file uploads, user management, segmentation coordination
- GPU Server (FastAPI) - AI inference accessed **only through backend proxy** (frontend never calls GPU directly)
- Role hierarchy: `guest` < `user` < `admin` (affects routing and feature access)

## Critical Patterns & Non-Standard Conventions

### Authentication Flow (Session-Based, NOT JWT)
```typescript
// src/context/auth-context.tsx provides global auth state
const { user, loading, login, logout, checkAuthStatus } = useAuth();

// All API calls MUST include credentials (configured in src/lib/api.ts)
withCredentials: true  // Essential for session cookies
```

**Auto-guest login**: If no session exists, frontend doesn't auto-create guests. Use `ProtectedRoute` to control access:
```tsx
<ProtectedRoute allowedRoles={["user", "admin"]} redirectTo="/login">
  <UserContent />
</ProtectedRoute>
```

### Role-Based Access Components (Declarative Pattern)
```tsx
// Route-level protection (redirects) - src/components/ProtectedRoute.tsx
<ProtectedRoute allowedRoles={["admin"]} redirectTo="/dashboard">

// Component-level visibility (hides/shows) - src/components/RoleGuard.tsx
<ShowForAdmin fallback={<div>Access denied</div>}>
  <AdminPanel />
</ShowForAdmin>

<ShowForRegisteredUser>  // Excludes guests
<ShowForGuests>          // Guest-only content
<RegistrationOnly redirectTo="/dashboard">  // Login/register pages only
```

### Custom Hooks Architecture (Centralized Data Fetching)
```typescript
// src/lib/dashboard-hooks.ts - Standard pattern for dashboard data
const { projects, isLoading, refresh } = useUserProjects();
const { gpuStatus, isLoading, refresh } = useGpuStatus();
const { recentJobs, isLoading, refresh } = useUserJobs();

// src/hooks/useProjectSegmentationStatus.ts - Batch API pattern (NON-STANDARD)
const { statuses } = useProjectSegmentationStatus(projects);
// Returns: Record<projectId, { hasMasks, loading, error }>
// Single batch API call checks segmentation status for ALL projects efficiently
```

**Pattern**: All hooks return `{ data, isLoading, refresh }` for consistency. Use `refresh()` for manual updates.

### API Response Standard (Backend Contract)
```typescript
// All backend endpoints return this shape
interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;  // OR direct properties like 'projects', 'jobs', etc.
}

// Error handling pattern
try {
  const response = await projectApi.getProjects();
  if (!response.success) throw new Error(response.message);
  // Use response.data OR response.projects (varies by endpoint)
} catch (error: any) {
  toast.error(error.response?.data?.message || 'Operation failed');
}
```

### Dynamic Imports for Heavy Components (REQUIRED)
```typescript
// Required for Konva.js canvas and 3D visualization (SSR issues)
const ImageCanvas = dynamic(
  () => import("@/components/segmentation/image-canvas").then((mod) => mod.ImageCanvas),
  { ssr: false }
);
```

**When to use**: Canvas libraries (`konva`, `react-konva`), Three.js components, heavy animation libraries

## UI/Styling System

### Tailwind CSS v4 + Shadcn/ui
- **Theme variables** in `src/app/globals.css` with `@theme inline` directive mapping CSS custom properties
- **Color system**: Uses OKLCH color space for light/dark modes (see `:root` and `.dark` in `globals.css`)
- **Utility function**: `cn()` from `src/lib/utils.ts` for conditional class merging
```tsx
import { cn } from "@/lib/utils";
<div className={cn("base-class", isActive && "active-class")} />
```

### Shadcn/ui Components
- **Location**: `src/components/ui/` (Form, Button, Dialog, Input, etc.)
- **Installation**: `pnpm dlx shadcn@latest add <component>` (see `components.json`)
- **Customization**: Direct file editing encouraged - these are NOT npm packages
- **Icons**: Use `lucide-react` for consistency

### Forms Pattern (react-hook-form + Zod)
```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const schema = z.object({ name: z.string().min(1) });
const form = useForm<z.infer<typeof schema>>({
  resolver: zodResolver(schema),
  defaultValues: { name: "" }
});

// Use with Shadcn Form components (see src/app/profile/page.tsx)
<Form {...form}>
  <FormField name="name" render={({ field }) => <Input {...field} />} />
</Form>
```

### Notifications (Sonner Toasts)
```typescript
import { toast } from "sonner";

toast.success("Project created successfully");
toast.error("Failed to upload file");
toast.loading("Processing segmentation...");
```

**Setup**: `<Toaster richColors />` already in `src/app/layout.tsx`

## Project Structure Specifics

### App Router Organization
```
src/app/
 layout.tsx           # Root layout: ThemeProvider + AuthProvider + Header/Footer
 page.tsx             # Landing page (public)
 dashboard/           # User project management (auth required)
 project/[projectId]/ # Dynamic project routes with segmentation sub-pages
 admin/               # Admin-only: user-management/, system-monitor/
 login/, register/    # Authentication pages (RegistrationOnly guard)
 profile/             # User settings (auth required)
 about/, doc/, policy/  # Static content pages
```

### Key Files Reference
- **API client**: `src/lib/api.ts` (632 lines) - `authApi`, `projectApi`, `segmentationApi`, `adminApi`, `statusApi` modules
- **Auth context**: `src/context/auth-context.tsx` - Global auth state with auto-check on mount
- **Dashboard hooks**: `src/lib/dashboard-hooks.ts` - Data fetching hooks for dashboard UI
- **Types**: `src/types/dashboard.ts` - `Project`, `Job`, `UserStats`, `SystemStats` interfaces

## Development Workflow

### Commands
```bash
pnpm dev    # Dev server on port 5001 (configured in package.json)
pnpm build  # Production build (removes console.* statements)
pnpm lint   # ESLint check (disabled during builds in next.config.ts)
```

### Environment Variables
```bash
# Required in .env.local
NEXT_PUBLIC_API_URL=http://localhost:3001  # Backend API base URL
NEXT_PUBLIC_APP_NAME=VisHeart
NEXT_PUBLIC_APP_VERSION=0.1.0
```

### Build Configuration Gotchas
**`next.config.ts` webpack overrides:**
- Konva.js requires `canvas: false` fallback for browser builds
- `transpilePackages: ["konva", "react-konva"]` for ESM compatibility
- Console statements removed in production (`compiler.removeConsole`)

## Medical Imaging Specific Patterns

### NIfTI File Handling
- **Backend processes** NIfTI  JPEG frame extraction (Python scripts)
- **Frontend displays** JPEG frames via Konva.js canvas (`src/components/segmentation/image-canvas.tsx`)
- **Dimensions**: Projects store `{ width, height, depth, slices, frames }` metadata
- **Affine matrix**: 4x4 transformation matrix for medical coordinate systems (optional field)

### Segmentation Canvas (Konva.js)
```tsx
// Heavy component - always use dynamic import
const ImageCanvas = dynamic(() => import("@/components/segmentation/image-canvas").then(m => m.ImageCanvas), { ssr: false });

<ImageCanvas
  currentFrame={frameIndex}
  sliceIndex={sliceIndex}
  projectId={projectId}
  canvasWidth={1000}
  canvasHeight={550}
  // ... other props
/>
```

**Features**: Brush/eraser tools, zoom/pan, undo/redo, mask overlay rendering

### Project States & Job Tracking
```typescript
// Job statuses from backend
type JobStatus = "pending" | "processing" | "completed" | "failed";

// Segmentation status check (batch API for efficiency)
const { statuses } = useProjectSegmentationStatus(projects);
// statuses[projectId].hasMasks  boolean indicating if AI segmentation exists
```

## Common Pitfalls & Solutions

### Double-Redirect Issue
**Problem**: `ProtectedRoute` + navigation guards can cause redirect loops
**Solution**: Use `autoRedirect={false}` prop when manual control needed, check `loading` state before conditional rendering

### Session Cookie Issues
**Symptom**: API returns 401 despite login
**Check**: Ensure `withCredentials: true` in axios config (`src/lib/api.ts` line 13)

### Konva Canvas SSR Errors
**Symptom**: "window is not defined" or canvas rendering errors
**Solution**: Always use `dynamic(() => import(...), { ssr: false })` for Konva components

### Theme Hydration Mismatch
**Symptom**: Flash of unstyled content or theme mismatch warnings
**Solution**: `suppressHydrationWarning` on `<html>` and `<body>` tags (already implemented in `layout.tsx`)

## Integration with Backend

### File Upload Flow
1. Frontend: `<input type="file">`  FormData with NIfTI file
2. POST to backend `/project/upload` with `multipart/form-data`
3. Backend: S3 upload  Python metadata extraction  MongoDB save
4. Frontend: Poll project list or use refresh callback

### Segmentation Request Flow
1. User triggers segmentation via dashboard/project page
2. Frontend: POST to backend `/segmentation/start` with `projectId`
3. Backend: Creates Job  calls GPU server  webhook callback on completion
4. Frontend: Poll job status or refresh dashboard to see results

**GPU Server**: Frontend NEVER calls GPU directly - all inference proxied through backend with JWT auth managed server-side
