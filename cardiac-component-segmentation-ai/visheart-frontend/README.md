# VisHeart Frontend

<div align="center">
  <img src="./public/visheart_logo.svg" alt="VisHeart Logo" width="120" height="120"/>

  **VisHeart Cardiac Segmentation Platform - Frontend Application**

  A modern, responsive web application for medical imaging analysis and cardiac component segmentation built with Next.js and TypeScript.
</div>

---

## Architecture Overview

VisHeart Frontend is a sophisticated medical imaging platform that provides a comprehensive interface for cardiac segmentation analysis. Built with modern web technologies, it integrates seamlessly with the VisHeart backend API and GPU inference server to deliver a complete medical imaging workflow.

### Core Features

- **Role-Based Authentication** - Multi-tier user system (Guest, User, Admin)
- **Interactive Dashboard** - Project management with card/table views and real-time status
- **Medical Image Visualization** - NIfTI file display with segmentation overlay capabilities
- **Real-Time Processing** - Live status updates for GPU-accelerated segmentation jobs
- **Responsive Design** - Mobile-first approach with adaptive layouts
- **Modern UI/UX** - Shadcn/ui components with light/dark theme support
- **Accessibility First** - WCAG compliance with screen reader support

---

## Quick Start

### Prerequisites
- Node.js 18+ and npm/pnpm
- VisHeart Backend Server running
- Environment variables configured

### Installation & Setup

```powershell
# Navigate to frontend directory
cd visheart-frontend

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your configuration

# Start development server
pnpm dev
```

The application will be available at `http://localhost:5001`

### Environment Configuration

Create a `.env.local` file with:

```bash
# Backend API Configuration
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_API_TIMEOUT=30000

# Application Settings
NEXT_PUBLIC_APP_NAME=VisHeart
NEXT_PUBLIC_APP_VERSION=0.1.0

# Analytics (Optional)
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
```

---

## Project Structure

```
visheart-frontend/
├── src/
│   ├── app/                     # Next.js App Router pages
│   │   ├── dashboard/           # User project management interface
│   │   ├── project/[projectId]/ # Individual project detail pages
│   │   ├── admin/               # Administrative panel (admin-only)
│   │   ├── login/register/      # Authentication pages
│   │   ├── about/doc/policy/    # Static content pages
│   │   └── layout.tsx           # Root layout with providers
│   │
│   ├── components/              # Reusable React components
│   │   ├── dashboard/           # Dashboard-specific components
│   │   ├── project/             # Project management components
│   │   ├── upload/              # File upload interface
│   │   ├── home/                # Landing page components
│   │   ├── ProtectedRoute.tsx   # Route-level access control
│   │   └── RoleGuard.tsx        # Component-level role protection
│   │
│   ├── context/                 # React Context providers
│   │   ├── auth-context.tsx     # Global authentication state
│   │   └── ProjectContext.tsx   # Project-specific state management
│   │
│   ├── lib/                     # Utilities and configurations
│   │   ├── api.ts               # Centralized API client with axios
│   │   ├── dashboard-hooks.ts   # Custom hooks for dashboard data
│   │   ├── utils.ts             # General utility functions
│   │   └── theme-provider.tsx   # Theme management for dark/light modes
│   │
│   ├── hooks/                   # Custom React hooks
│   │   └── useProjectSegmentationStatus.ts
│   │
│   ├── types/                   # TypeScript type definitions
│   │   ├── api.ts               # API response interfaces
│   │   ├── dashboard.ts         # Dashboard data types
│   │   └── project.ts           # Project-related interfaces
│   │
│   ├── ui/                      # Layout components
│   │   ├── header/              # Navigation header
│   │   ├── footer/              # Site footer
│   │   └── theme-toggle.tsx     # Theme switcher component
│   │
│   └── components/ui/           # Shadcn/ui component library
│       ├── button.tsx           # Base UI components
│       ├── card.tsx
│       ├── table.tsx
│       └── ...                  # 30+ UI primitives
│
├── public/                      # Static assets
│   ├── visheart_logo.svg        # Application branding
│   ├── heart.mp4                # Hero section video
│   └── images/                  # Additional assets
│
├── next.config.ts               # Next.js configuration
├── tailwind.config.ts           # Tailwind CSS configuration
├── components.json              # Shadcn/ui configuration
└── package.json                 # Dependencies and scripts
```

---

## Authentication System

### User Roles & Permissions

| Role | Access Level | Features |
|------|-------------|----------|
| **Guest** | Limited | View-only access, temporary projects, no saving |
| **User** | Standard | Full project management, permanent storage, segmentation |
| **Admin** | Full | User management, system monitoring, all features |

### Authentication Flow

```typescript
// Authentication Context Usage
const { user, loading, login, logout, guestLogin } = useAuth();

// Login process
await login(username, password);          // Regular user login
await guestLogin();                       // Instant guest access

// Role-based component protection
<ProtectedRoute allowedRoles={["user", "admin"]}>
  <SensitiveComponent />
</ProtectedRoute>

// Granular role guards
<ShowForAdmin>
  <AdminPanel />
</ShowForAdmin>

<ShowForRegisteredUser fallback={<LoginPrompt />}>
  <SaveProjectButton />
</ShowForRegisteredUser>
```

### Route Protection

```typescript
// Automatic redirection for unauthorized access
<ProtectedRoute allowedRoles={["admin"]} redirectTo="/login">
  <AdminOnlyPage />
</ProtectedRoute>

// Login/register pages that redirect authenticated users
<RegistrationOnly redirectTo="/dashboard">
  <LoginForm />
</RegistrationOnly>
```

---

## Dashboard Features

### Dual View System

The dashboard provides two distinct viewing modes for optimal user experience:

#### Card View (Default)

- **Visual project cards** with thumbnail previews
- **Inline editing** for project names and descriptions
- **Status indicators** with color-coded badges
- **Quick actions** (view, export, delete) on hover
- **Affine matrix display** for technical specifications


#### Table View

- **Compact data display** with sortable columns
- **Responsive column hiding** (mobile-first approach)
- **Interactive save/temp badges** for project status
- **Batch operations** support
- **Technical data columns** (dimensions, file type, affine matrix)

```typescript
// View mode switching with keyboard shortcuts
// Ctrl+1 (Cmd+1) - Switch to card view
// Ctrl+2 (Cmd+2) - Switch to table view

const [viewMode, setViewMode] = useState<"card" | "table">("card");

// Persistent view preference
localStorage.setItem("dashboard-view-mode", viewMode);
```

### Project Management

- **Smart filtering** - Search by project name or description
- **Multiple sorting options** - Date, name, size, file type
- **Real-time status updates** - Segmentation progress indicators
- **Bulk operations** - Save/unsave multiple projects
- **File export** - Download segmentation results as NIfTI files

### Data Visualization

- **File size formatting** - Human-readable byte conversions
- **Technical specifications** - Dimensions, affine matrices, metadata
- **Progress tracking** - Visual indicators for processing status
- **Statistical overview** - Project counts, completion rates

---

## Project Detail System

### Individual Project Pages

Each project gets a dedicated route at `/project/[projectId]` with:

- **Project Dashboard Bar** - Quick stats and export functionality
- **Inline Editing** - Edit project name and description directly
- **Technical Specifications** - Complete metadata display including affine matrices
- **Segmentation Visualization** - Interactive canvas for viewing results
- **Job History** - Processing logs and status updates

### Project Context Provider

```typescript
// Automatic data fetching and state management
<ProjectProvider projectId={projectId}>
  <ProjectPage />
</ProjectProvider>

// Access project data throughout the component tree
const { projectData, loading, hasMasks, jobs, error } = useProject();
```

### Segmentation Visualization

- **Canvas-based rendering** with Konva.js for smooth interactions
- **Layer management** - Toggle between original image and segmentation masks
- **Zoom and pan** - Intuitive image navigation
- **Frame navigation** - Browse through NIfTI slices
- **Export capabilities** - Download processed results

---

## Security & Access Control

### Component-Level Protection

```typescript
// Granular permission control
<ShowForAdmin fallback={<AccessDenied />}>
  <UserManagementPanel />
</ShowForAdmin>

<ShowForRegisteredUser fallback={<UpgradePrompt />}>
  <SaveProjectButton />
</ShowForRegisteredUser>

// Multiple role support
<ShowForUserOrAdmin>
  <AdvancedFeatures />
</ShowForUserOrAdmin>
```

### Route-Level Security

```typescript
// Automatic redirection based on authentication state
<ProtectedRoute 
  allowedRoles={["user", "admin"]} 
  redirectTo="/login"
  autoRedirect={true}
>
  <ProtectedContent />
</ProtectedRoute>

// Guest-only pages (login/register)
<RegistrationOnly redirectTo="/dashboard">
  <LoginForm />
</RegistrationOnly>
```

### Session Management

- **Persistent sessions** - Automatic login state restoration
- **Session validation** - Background auth checks
- **Guest user handling** - Temporary accounts with automatic cleanup
- **Role-based navigation** - Dynamic menu items based on permissions

---

## UI/UX Design System

### Technology Stack

- **Tailwind CSS v4** - Utility-first styling with CSS variables
- **Shadcn/ui** - High-quality, accessible component library
- **Radix UI** - Headless component primitives
- **Framer Motion** - Smooth animations and transitions
- **Lucide React** - Consistent iconography

### Theme System

```typescript
// Automatic theme detection and switching
<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  <App />
</ThemeProvider>

// Theme-aware components
className="bg-background text-foreground border-border"
```

### Responsive Design

- **Mobile-first** approach with progressive enhancement
- **Breakpoint system** - `sm:`, `md:`, `lg:`, `xl:` for different screen sizes
- **Adaptive layouts** - Grid systems that collapse on smaller screens
- **Touch-friendly** - Appropriate touch targets and gestures

### Accessibility Features

- **ARIA labels** - Comprehensive screen reader support
- **Keyboard navigation** - Full functionality without mouse
- **Focus management** - Logical tab order and focus trapping
- **Color contrast** - WCAG AA compliance in both themes
- **Alternative text** - Descriptive labels for all interactive elements

---

## State Management

### Authentication Context

```typescript
interface AuthContextType {
  user: User | null;           // Current authenticated user
  loading: boolean;            // Auth check in progress
  error: string | null;        // Auth error messages
  login: (username: string, password: string) => Promise<void>;
  guestLogin: () => Promise<void>;
  logout: () => Promise<void>;
  checkAuthStatus: () => Promise<void>;
}

// Global auth state provider
<AuthProvider>
  <App />
</AuthProvider>
```

### Project Context

```typescript
// Project-specific state management
interface ProjectContextType {
  projectData: ProjectData | null;
  loading: boolean;
  error: string | null;
  hasMasks: boolean;
  undecodedMasks: any[];
  jobs: SegmentationJob[];
  refreshProject: () => Promise<void>;
}

// Per-project data management
<ProjectProvider projectId={projectId}>
  <ProjectComponents />
</ProjectProvider>
```

### Custom Hooks

- **`useUserProjects()`** - Fetch and manage user's project list
- **`useUserJobs()`** - Track segmentation job status
- **`useGpuStatus()`** - Monitor GPU server availability
- **`useProjectSegmentationStatus()`** - Real-time processing updates
- **`useUserStats()`** - Calculate dashboard statistics

---

## API Integration

### Centralized API Client

```typescript
// Pre-configured axios instance with session handling
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  withCredentials: true,  // Essential for session cookies
  timeout: 30000,
});

// Structured API modules
export const authApi = { register, login, logout, fetchUser };
export const projectApi = { getProjects, uploadProject, updateProject };
export const segmentationApi = { startSegmentation, exportResults };
```

### Error Handling

```typescript
// Consistent error response handling
try {
  const response = await api.post('/endpoint', data);
  return response.data;
} catch (error) {
  const message = error.response?.data?.message || 'Operation failed';
  console.error('[API] Request failed:', { url, error: message });
  throw new Error(message);
}
```

### File Upload System

- **Multi-step upload process** - Frontend → Backend → S3 → Processing
- **Progress tracking** - Real-time upload and processing status
- **Validation** - Client-side file type and size checks
- **Preview generation** - Automatic JPEG frame extraction from NIfTI files

---

## Pages & Navigation

### Public Routes

- **`/`** - Landing page with hero section and feature overview
- **`/about`** - Application information and team details
- **`/doc`** - Documentation and user guides
- **`/policy`** - Privacy policy and terms of service
- **`/sample`** - Sample NIfTI files for testing

### Authentication Routes

- **`/login`** - User authentication with guest login option
- **`/register`** - Account creation and registration
- **`/profile`** - User profile management and settings

### Protected Routes

- **`/dashboard`** - Main project management interface
- **`/project/[projectId]`** - Individual project details and visualization
- **`/admin/*`** - Administrative panel (admin role required)

### Navigation Patterns

```typescript
// Role-based navigation items
{user?.role === "admin" && (
  <NavigationMenuItem>
    <Link href="/admin">Admin Panel</Link>
  </NavigationMenuItem>
)}

// Conditional menu display
<ShowForRegisteredUser>
  <SavedProjectsMenu />
</ShowForRegisteredUser>
```

---

## Component Library

### UI Components (Shadcn/ui)
```
components/ui/
├── button.tsx          # Primary UI buttons with variants
├── card.tsx            # Container components for content grouping
├── table.tsx           # Data tables with sorting and filtering
├── input.tsx           # Form input fields with validation
├── select.tsx          # Dropdown selection components
├── badge.tsx           # Status and category indicators
├── dialog.tsx          # Modal dialogs and overlays
├── alert.tsx           # Notification and warning messages
├── tabs.tsx            # Content organization tabs
├── toggle-group.tsx    # Radio button groups
├── scroll-area.tsx     # Custom scrollable regions
├── separator.tsx       # Visual content dividers
├── tooltip.tsx         # Helpful hover information
└── ...                 # 30+ additional UI primitives
```

### Feature Components
```
components/
├── dashboard/
│   ├── EditableProjectCard.tsx      # Interactive project cards
│   ├── SegmentationIndicator.tsx    # Processing status display
│   └── AffineMatrixDisplay.tsx      # Medical imaging metadata
│
├── project/
│   ├── ProjectDashboardBar.tsx      # Project header with actions
│   └── SegmentationVisualization.tsx
│
├── upload/
│   ├── FileUploadDialog.tsx         # File selection interface
│   └── UploadProgress.tsx           # Real-time upload tracking
│
├── home/
│   ├── First.tsx                    # Hero section with animations
│   └── Second.tsx                   # Feature showcase
│
├── ProtectedRoute.tsx               # Route-level access control
└── RoleGuard.tsx                    # Component-level permissions
```

---

## Key Features Deep Dive

### Dashboard Interface

#### Project Management
- **Smart Search** - Filter projects by name or description
- **Multi-sort Options** - Date, name, size, file type
- **View Preferences** - Toggle between card and table layouts with persistence
- **Batch Operations** - Select and manage multiple projects simultaneously

#### Real-Time Updates
- **WebSocket Integration** - Live status updates for processing jobs
- **Optimistic Updates** - Immediate UI feedback for user actions
- **Background Sync** - Automatic data refresh without user intervention
- **Status Indicators** - Visual progress bars and completion states

#### Technical Data Display
```typescript
// Affine Matrix Visualization
<AffineMatrixDisplay 
  matrix={project.affineMatrix} 
  mode="compact"  // or "full"
/>

// File Metadata Cards
<TechnicalSpecifications>
  <MetadataField label="Dimensions" value="256×256×120" />
  <MetadataField label="Spacing" value="1.0×1.0×2.0 mm" />
  <MetadataField label="Orientation" value="RAS" />
</TechnicalSpecifications>
```

### File Upload System

#### Multi-Stage Processing
1. **Client Validation** - File type, size, format checks
2. **Secure Upload** - Direct S3 upload via presigned URLs
3. **Server Processing** - NIfTI metadata extraction and JPEG conversion
4. **Database Storage** - Project metadata and file references
5. **Preview Generation** - Thumbnail creation for dashboard display

#### Progress Tracking
```typescript
// Upload state management
const [uploadProgress, setUploadProgress] = useState({
  stage: 'uploading',    // uploading | processing | complete
  progress: 0,           // 0-100 percentage
  currentFile: string,   // Current file being processed
  error: null
});
```

### Segmentation Workflow

#### GPU Integration
- **Asynchronous Processing** - Jobs submitted to GPU server
- **Status Polling** - Real-time updates via webhook callbacks
- **Result Visualization** - Interactive overlay of segmentation masks
- **Export Functionality** - Download processed NIfTI files with masks

#### Visualization Engine
```typescript
// Canvas-based medical image display
<SegmentationVisualization
  projectData={projectData}
  masks={segmentationMasks}
  onFrameChange={handleFrameNavigation}
  overlayOpacity={0.7}
/>
```

---

## Development Guide

### Available Scripts

```bash
# Development
pnpm dev              # Start dev server with hot reload
pnpm build            # Production build with optimizations
pnpm start            # Start production server
pnpm lint             # ESLint code quality checks

# Development workflow
pnpm lint:fix         # Auto-fix linting issues
pnpm type-check       # TypeScript compilation check
pnpm analyze          # Bundle size analysis
```

### Code Style & Conventions

#### Component Structure
```typescript
"use client";  // For interactive components

import { useState, useEffect } from "react";
import { ComponentProps } from "@/types";
import { Button } from "@/components/ui/button";

interface ComponentNameProps {
  // Explicit prop definitions
  data: DataType;
  onAction: (id: string) => void;
  className?: string;
}

export function ComponentName({ data, onAction, className }: ComponentNameProps) {
  // 1. State management
  const [localState, setLocalState] = useState(initialValue);
  
  // 2. Effects and hooks
  useEffect(() => {
    // Side effects
  }, [dependencies]);
  
  // 3. Event handlers
  const handleAction = (event: Event) => {
    // Event logic
  };
  
  // 4. Render logic
  return (
    <div className={cn("base-classes", className)}>
      {/* Component JSX */}
    </div>
  );
}
```

#### API Integration Patterns
```typescript
// Custom hooks for data fetching
export function useUserProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await projectApi.getProjects();
      setProjects(response.projects);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { projects, isLoading, error, refresh };
}
```

### Testing Strategy
```typescript
// Component testing with React Testing Library
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthProvider } from '@/context/auth-context';

test('dashboard displays projects correctly', () => {
  render(
    <AuthProvider>
      <DashboardPage />
    </AuthProvider>
  );
  
  expect(screen.getByText('My Projects')).toBeInTheDocument();
});
```

---

## Configuration

### Next.js Configuration

#### Webpack Customization
```typescript
// next.config.ts
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Konva.js canvas compatibility
    if (!isServer) {
      config.resolve.fallback = {
        canvas: false,
        encoding: false,
        fs: false,
      };
    }
    return config;
  },
  
  // Production optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  
  // Package transpilation
  transpilePackages: ["konva", "react-konva"],
};
```

#### Performance Optimizations
- **Bundle splitting** - Automatic code splitting for optimal loading
- **Image optimization** - Next.js automatic image processing
- **Console removal** - Production builds strip debug logs
- **Tree shaking** - Eliminate unused code in production builds

### Tailwind Configuration
```typescript
// tailwind.config.ts
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Custom color system for medical imaging
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: "hsl(var(--primary))",
        // ...medical-specific color palette
      },
    },
  },
};
```

---

## 📦 Dependencies & Technology Stack

### Core Framework
- **Next.js 15.5.0** - React framework with App Router
- **React 19.1.1** - UI library with concurrent features
- **TypeScript 5.9.2** - Type safety and developer experience

### UI & Styling
- **Tailwind CSS 4.1.12** - Utility-first CSS framework
- **Shadcn/ui** - Pre-built accessible components
- **Radix UI** - Headless component primitives
- **Framer Motion 12.23.12** - Animation library
- **Lucide React 0.542.0** - Icon library

### Data & API
- **Axios 1.11.0** - HTTP client with interceptors
- **React Hook Form 7.62.0** - Form validation and management
- **Zod 4.1.3** - Runtime type validation

### Medical Imaging
- **Konva 9.3.22** - 2D canvas library for image manipulation
- **React-Konva 19.0.7** - React bindings for Konva
- **Three.js 0.179.1** - 3D visualization capabilities

### Development Tools
- **ESLint 9.34.0** - Code quality and consistency
- **Prettier 3.6.2** - Code formatting
- **TypeScript** - Static type checking

---

## Deployment

### Build Process
```powershell
# Production build
pnpm build

# Static export (if needed)
# Uncomment output: 'export' in next.config.ts
pnpm build && pnpm export
```

### Environment Variables
```bash
# Production environment
NEXT_PUBLIC_API_URL=https://api.visheart.com
NEXT_PUBLIC_APP_ENV=production
NEXT_PUBLIC_GA_ID=G-PRODUCTION-ID

# Staging environment
NEXT_PUBLIC_API_URL=https://staging-api.visheart.com
NEXT_PUBLIC_APP_ENV=staging
```

### Deployment Targets
- **Vercel** - Recommended for Next.js applications
- **AWS S3/CloudFront** - Static hosting with CDN
- **Docker** - Containerized deployment
- **Traditional Hosting** - Static export support

---

## Debugging & Troubleshooting

### Common Issues

#### Authentication Problems
```typescript
// Debug authentication state
console.log('[Auth] Current state:', {
  user: user?.username,
  role: user?.role,
  loading,
  error
});

// Check API connectivity
const testAuth = async () => {
  try {
    const response = await authApi.fetchUser();
    console.log('[Auth] API response:', response);
  } catch (error) {
    console.error('[Auth] API error:', error.response?.data);
  }
};
```

#### Project Loading Issues
```typescript
// Debug project data flow
console.log('[Projects] Loading state:', {
  isLoading,
  projectCount: projects.length,
  hasError: !!error
});

// Validate project structure
projects.forEach(project => {
  console.log('[Project] Validation:', {
    id: project.projectId,
    hasName: !!project.name,
    hasAffineMatrix: !!project.affineMatrix,
    dimensions: project.dimensions
  });
});
```

#### GPU Integration Debugging
```typescript
// Monitor GPU server communication
console.log('[GPU] Server status:', {
  available: gpuStatus?.available,
  lastCheck: gpuStatus?.lastChecked,
  jobs: gpuStatus?.activeJobs
});
```

### Performance Monitoring
- **Next.js built-in metrics** - Core web vitals tracking
- **Console logging** - Comprehensive debug information
- **Error boundaries** - Graceful error handling and recovery
- **Loading states** - User feedback during async operations

---

## Contributing

### Development Workflow
1. **Fork the repository** and create a feature branch
2. **Install dependencies** - `pnpm install`
3. **Set up environment** - Copy and configure `.env.local`
4. **Start development server** - `pnpm dev`
5. **Make changes** following the coding conventions
6. **Test thoroughly** - Ensure no regressions
7. **Create pull request** with detailed description

### Code Quality Standards
- **TypeScript strict mode** - No implicit any types
- **ESLint compliance** - Follow established rules
- **Component testing** - Unit tests for critical functionality
- **Accessibility testing** - Screen reader and keyboard navigation
- **Cross-browser compatibility** - Modern browser support

### Contribution Guidelines
- **Clear commit messages** - Descriptive and atomic commits
- **Documentation updates** - Keep README and code comments current
- **Performance considerations** - Optimize for medical imaging workflows
- **Security awareness** - Follow healthcare data protection practices

---

## Project Roadmap

### Current Features

- Multi-role authentication system
- Interactive project dashboard
- Real-time segmentation processing
- Responsive design with accessibility
- File upload and management
- Technical metadata display

### Upcoming Features

- **Advanced Visualization** - 3D cardiac model rendering
- **Collaborative Features** - Project sharing and team workflows
- **Analytics Dashboard** - Usage metrics and system performance
- **Mobile App** - React Native companion application
- **API Documentation** - Interactive OpenAPI documentation
- **Batch Processing** - Multiple file segmentation workflows

### Long-term Vision

- **Machine Learning Integration** - Model training interface
<!-- - **DICOM Support** - Expanded medical imaging format support -->
- **Cloud Integration** - Multi-cloud deployment options
- **Research Tools** - Advanced analysis and reporting features

---

## Support & Resources

### Documentation
- **API Documentation** - See `Cardiac_Segmentation_FYP_Server/README.md`
- **Component Storybook** - Visual component documentation
- **User Guides** - Available at `/doc` route in application

### Community & Support
- **GitHub Issues** - Bug reports and feature requests
- **Development Team** - Internal support and code reviews
- **Medical Advisory** - Clinical workflow validation

### External Dependencies
- **Shadcn/ui Documentation** - https://ui.shadcn.com/
- **Next.js Documentation** - https://nextjs.org/docs
- **Tailwind CSS Documentation** - https://tailwindcss.com/docs
- **React Documentation** - https://react.dev/

---

## License

This project is proprietary software developed for academic and research purposes as part of a Final Year Project (FYP). All rights reserved.

---

<div align="center">
  <p><strong>VisHeart - Advanced Cardiac Segmentation Platform</strong></p>
  <p>Built for the medical imaging community</p>
</div>
