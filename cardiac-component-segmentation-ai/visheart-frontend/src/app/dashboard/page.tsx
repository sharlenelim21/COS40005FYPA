"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/context/auth-context";
import { useGpuStatus, useUserProjects, useUserJobs, useUserStats } from "@/lib/dashboard-hooks";
import { useProjectSegmentationStatus } from "@/hooks/useProjectSegmentationStatus";
import { useProjectReconstructionStatus } from "@/hooks/useProjectReconstructionStatus";
import { ShowForUser, ShowForGuest, ShowForRegisteredUser } from "@/components/RoleGuard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { reconstructionApi } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AlertCircle,
  Brain,
  Box,
  Download,
  FolderOpen,
  Heart,
  Upload,
  Clock,
  CheckCircle,
  XCircle,
  RefreshCw,
  FileText,
  Cpu,
  User,
  UserCheck,
  Settings,
  Shield,
  Grid3X3,
  List,
  Edit,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { projectApi, segmentationApi } from "@/lib/api";
import { FileUploadDialog } from "@/components/upload/FileUploadDialog";
import { SegmentationIndicator } from "@/components/dashboard/SegmentationIndicator";
import { ReconstructionIndicator } from "@/components/dashboard/ReconstructionIndicator";
import { EditableProjectCard } from "@/components/dashboard/EditableProjectCard";

// Helper function to format file size
const formatFileSize = (bytes: number) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// Helper function to get status icon and color
const getStatusDisplay = (status: string) => {
  switch (status.toLowerCase()) {
    case "completed":
      return {
        icon: CheckCircle,
        color: "text-green-600",
        bg: "bg-green-100",
      };
    case "pending":
      return { icon: Clock, color: "text-yellow-600", bg: "bg-yellow-100" };
    case "processing":
    case "in_progress":
      return { icon: RefreshCw, color: "text-blue-600", bg: "bg-blue-100" };
    case "failed":
      return { icon: XCircle, color: "text-red-600", bg: "bg-red-100" };
    default:
      return { icon: AlertCircle, color: "text-gray-600", bg: "bg-gray-100" };
  }
};

// Helper function to get role icon
const getRoleIcon = (role: string | undefined) => {
  switch (role) {
    case "admin":
      return <Shield className="h-4 w-4 text-blue-600" />;
    case "user":
      return <UserCheck className="h-4 w-4 text-green-600" />;
    case "guest":
      return <User className="h-4 w-4 text-gray-500" />;
    default:
      return <User className="h-4 w-4" />;
  }
};

export default function DashboardPage() {
  const { user, loading: authLoading, error: authError } = useAuth();
  const isAuthenticated = Boolean(user);
  const { projects, isLoading: projectsLoading, refresh: refreshProjects } = useUserProjects(isAuthenticated);
  const { recentJobs, isLoading: jobsLoading, refresh: refreshJobs } = useUserJobs(isAuthenticated);
  const { processingUnit, isLoading: gpuLoading, refresh: refreshGpuStatus } = useGpuStatus();
  const userStats = useUserStats(projects, recentJobs);

  // Add reconstruction jobs tracking
  const [reconstructionJobs, setReconstructionJobs] = useState<any[]>([]);
  const [isLoadingReconstructionJobs, setIsLoadingReconstructionJobs] = useState(true);

  // Fetch reconstruction jobs
  const fetchReconstructionJobs = useCallback(async () => {
    if (!isAuthenticated) {
      setReconstructionJobs([]);
      setIsLoadingReconstructionJobs(false);
      return;
    }

    setIsLoadingReconstructionJobs(true);
    try {
      const response = await reconstructionApi.getUserReconstructionJobs();
      setReconstructionJobs(response.jobs || []);
    } catch (error: any) {
      const isUnauthorized = error?.response?.status === 401;
      if (!isUnauthorized) {
        console.error("Error fetching reconstruction jobs:", error);
      }
      setReconstructionJobs([]);
    } finally {
      setIsLoadingReconstructionJobs(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    fetchReconstructionJobs();
  }, [fetchReconstructionJobs]);

  // Combine and sort all jobs by creation date
  const allJobs = useMemo(() => {
    const segmentationJobsWithType = recentJobs.map(job => ({
      ...job,
      jobType: 'segmentation' as const,
      createdAt: job.createdAt || new Date().toISOString()
    }));

    const reconstructionJobsWithType = reconstructionJobs.map(job => ({
      ...job,
      jobType: 'reconstruction' as const,
      createdAt: job.createdAt || new Date().toISOString()
    }));

    return [...segmentationJobsWithType, ...reconstructionJobsWithType]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [recentJobs, reconstructionJobs]);

  // Helper function to get project name from projectId
  const getProjectName = (projectId: string): string => {
    const project = projects.find(p => p.projectId === projectId);
    return project?.name || 'Unknown Project';
  };

  // Add segmentation status tracking for projects
  const { statuses: segmentationStatuses, refresh: refreshSegmentationStatuses } = useProjectSegmentationStatus(projects);
  
  // Add reconstruction status tracking for projects
  const { statuses: reconstructionStatuses, refresh: refreshReconstructionStatuses } = useProjectReconstructionStatus(projects);

  // State for upload dialog
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);

  // State for delete confirmation dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // State for sorting and filtering
  const [sortBy, setSortBy] = useState<string>("date");
  const [searchTerm, setSearchTerm] = useState("");

  // State for view mode (card or table view) with localStorage persistence
  const [viewMode, setViewMode] = useState<"card" | "table">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("dashboard-view-mode") as "card" | "table") || "card";
    }
    return "card";
  });

  // Save view mode preference to localStorage
  const handleViewModeChange = (value: "card" | "table") => {
    setViewMode(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("dashboard-view-mode", value);
    }
  };

  // Add keyboard shortcuts for view switching
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey) {
        switch (event.key) {
          case "1":
            event.preventDefault();
            handleViewModeChange("card");
            break;
          case "2":
            event.preventDefault();
            handleViewModeChange("table");
            break;
        }
      }
    };

    document.addEventListener("keydown", handleKeyPress);
    return () => document.removeEventListener("keydown", handleKeyPress);
  }, []);

  // Function to sort and filter projects
  const getSortedAndFilteredProjects = () => {
    const filteredProjects = projects.filter((project) => project.name.toLowerCase().includes(searchTerm.toLowerCase()) || project.description.toLowerCase().includes(searchTerm.toLowerCase()));

    return filteredProjects.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        case "nifti-size":
          // Sort by NIfTI file size (larger first)
          return b.filesize - a.filesize;
        case "mesh-size":
          // Sort by mesh/reconstruction size (larger first)
          const aMeshSize = a.reconstruction?.tarFileSize ?? 0;
          const bMeshSize = b.reconstruction?.tarFileSize ?? 0;
          return bMeshSize - aMeshSize;
        case "total-size":
          // Sort by total size (NIfTI + mesh, larger first)
          const aTotalSize = a.filesize + (a.reconstruction?.tarFileSize ?? 0);
          const bTotalSize = b.filesize + (b.reconstruction?.tarFileSize ?? 0);
          return bTotalSize - aTotalSize;
        case "type":
          return a.filetype.toLowerCase().localeCompare(b.filetype.toLowerCase());
        case "date":
        default:
          // Sort by creation date (newest first)
          return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      }
    });
  };

  const isLoadingData = projectsLoading || jobsLoading || gpuLoading || isLoadingReconstructionJobs;

  const refreshDashboard = async () => {
    if (user) {
      await Promise.all([refreshProjects(), refreshJobs(), refreshGpuStatus(), fetchReconstructionJobs()]);
      // Refresh segmentation and reconstruction statuses after projects are refreshed
      refreshSegmentationStatuses();
      refreshReconstructionStatuses();
    }
  };

  // Handle project actions

  const handleExportProject = async (projectId: string) => {
    try {
      console.log(`[Export] Starting export for project: ${projectId}`);
      const exportResult = await segmentationApi.exportProjectData(projectId);
      console.log(`[Export] Received export result:`, {
        blobSize: exportResult.blob.size,
        blobType: exportResult.blob.type,
        expectedSize: exportResult.fileSizeBytes,
        filename: exportResult.suggestedFilename,
      });

      const url = window.URL.createObjectURL(exportResult.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportResult.suggestedFilename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      console.log(`[Export] Successfully downloaded export for project: ${projectId} as ${exportResult.suggestedFilename}`);
    } catch (error) {
      console.error("Error exporting project:", error);
    }
  };

  const handleSaveProject = async (projectId: string, isSaved: boolean) => {
    try {
      await projectApi.saveProject(projectId, isSaved);
      await refreshProjects();
    } catch (error) {
      console.error("Error saving project:", error);
    }
  };

  const handleDeleteProject = async (projectId: string, projectName: string) => {
    setProjectToDelete({ id: projectId, name: projectName });
    setDeleteDialogOpen(true);
  };

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;

    try {
      await projectApi.deleteProject(projectToDelete.id);
      await refreshProjects();
      setDeleteDialogOpen(false);
      setProjectToDelete(null);
    } catch (error) {
      console.error("Error deleting project:", error);
      alert("Failed to delete project. Please try again.");
    }
  };

  const handleUploadSuccess = async () => {
    await refreshProjects();
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (authError) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Error: {authError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Please log in to access the dashboard.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="container mx-auto space-y-6 p-4 md:p-6">
      {/* Header Section */}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Heart className="h-8 w-8 text-red-500" />
            <h1 className="text-3xl font-bold tracking-tight">VisHeart Dashboard</h1>
          </div>
          <div className="text-muted-foreground flex items-center gap-2">
            {getRoleIcon(user.role)}
            <span>
              Welcome back, <span className="font-semibold">{user.role === "guest" ? "Guest User" : user.username}.</span>
            </span>
            <Badge variant="outline" className="ml-2">
              {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
            </Badge>
          </div>
        </div>

        {/* GPU Status Indicator */}
        <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
          <Button variant="outline" size="sm" onClick={refreshDashboard} disabled={isLoadingData}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoadingData ? "animate-spin" : ""}`} />
            Refresh
          </Button>

          <div className="flex items-center gap-2">
            {/* Processing Unit Indicator: Green=NVIDIA GPU, Yellow=CPU, Grey=Unknown/Error */}
            <div
              className={`h-3 w-3 rounded-full ${
                gpuLoading
                  ? "bg-yellow-500"
                  : processingUnit.status === "online" && processingUnit.gpuAvailable
                    ? "bg-green-500"
                    : processingUnit.status === "degraded" && processingUnit.serviceOnline
                      ? "bg-yellow-500"
                      : processingUnit.status === "timeout" || processingUnit.status === "offline"
                        ? "bg-gray-400"
                        : "bg-gray-400"
              }`}
            />
            <span className="text-muted-foreground text-sm">
              {gpuLoading
                ? "Processing Unit Checking..."
                : processingUnit.status === "online" && processingUnit.gpuAvailable
                  ? "NVIDIA GPU"
                  : processingUnit.status === "degraded" && processingUnit.serviceOnline
                    ? "CPU"
                    : "Unknown / Error"}
            </span>
          </div>
        </div>
      </div>

      {/* Guest Mode Alert */}
      <ShowForGuest fallback={null}>
        <Alert className="border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30">
          <AlertCircle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
          <AlertDescription className="text-orange-800 dark:text-orange-200">
            You&apos;re in guest mode. Your projects and work won&apos;t be permanently saved.
            <Link href="/register">
              <Button variant="link" className="ml-2 h-auto p-0 text-orange-800 dark:text-orange-200 underline hover:text-orange-900 dark:hover:text-orange-100">
                Upgrade to full account
              </Button>
            </Link>
          </AlertDescription>
        </Alert>
      </ShowForGuest>

      {/* Main Dashboard Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          {/* Stats Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
                <FolderOpen className="text-muted-foreground h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{userStats?.projectCount || 0}</div>
                <p className="text-muted-foreground text-xs">{formatFileSize(userStats?.totalFileSize || 0)} total</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Segmentations</CardTitle>
                <Brain className="text-muted-foreground h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{userStats?.completedSegmentations || 0}</div>
                <p className="text-muted-foreground text-xs">Completed</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Reconstructions</CardTitle>
                <Box className="text-muted-foreground h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{userStats?.completedReconstructions || 0}</div>
                <p className="text-muted-foreground text-xs">4D Models</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pending Jobs</CardTitle>
                <Clock className="text-muted-foreground h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{userStats?.pendingJobs || 0}</div>
                <p className="text-muted-foreground text-xs">In queue</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Processing Unit</CardTitle>
                <Cpu className="text-muted-foreground h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${
                    processingUnit.status === "online" && processingUnit.gpuAvailable
                      ? "text-green-600"
                      : processingUnit.status === "degraded" && processingUnit.serviceOnline
                        ? "text-yellow-600"
                        : "text-gray-600"
                  }`}
                >
                  {processingUnit.status === "online" && processingUnit.gpuAvailable
                    ? "🟢 NVIDIA GPU"
                    : processingUnit.status === "degraded" && processingUnit.serviceOnline
                      ? "🟡 CPU"
                      : "⚪ Unknown / Error"}
                </div>
                <p className="text-muted-foreground text-xs">Processing server</p>
              </CardContent>
            </Card>
          </div>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Common tasks and shortcuts</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <ShowForUser fallback={null}>
                <Button className="w-full justify-start" onClick={() => setUploadDialogOpen(true)}>
                  <Upload className="mr-2 h-4 w-4" />
                  New Project
                </Button>
              </ShowForUser>

              <Link href="/profile">
                <Button variant="outline" className="w-full justify-start">
                  <Settings className="mr-2 h-4 w-4" />
                  Profile Settings
                </Button>
              </Link>

              <ShowForUser fallback={null}>
                {user?.role === "admin" && (
                  <Link href="/admin">
                    <Button variant="outline" className="w-full justify-start">
                      <Shield className="mr-2 h-4 w-4" />
                      Admin Panel
                    </Button>
                  </Link>
                )}
              </ShowForUser>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Recent Projects</CardTitle>
                <CardDescription>Your latest uploaded projects</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {projects
                  .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
                  .slice(0, 4)
                  .map((project) => (
                    <Link key={project.projectId} href={`/project/${project.projectId}`}>
                      <div className="flex items-center justify-between rounded-lg border p-2 hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer">
                        <div className="flex items-center gap-3">
                          <FileText className="text-muted-foreground h-4 w-4" />
                          <div>
                            <p className="text-sm font-medium truncate max-w-96">{project.name}</p>
                            <p className="text-muted-foreground text-xs">
                              {formatFileSize(project.filesize)} • {project.filetype}
                            </p>
                          </div>
                        </div>
                        <Badge variant={project.isSaved ? "default" : "secondary"}>{project.isSaved ? "Saved" : "Temp"}</Badge>
                      </div>
                    </Link>
                  ))}
                {projects.length === 0 && <p className="text-muted-foreground py-4 text-center text-sm">No projects yet. Upload your first project to get started.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Jobs</CardTitle>
                <CardDescription>Latest segmentation and reconstruction tasks</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {allJobs.slice(0, 4).map((job) => {
                  const statusDisplay = getStatusDisplay(job.status);
                  const StatusIcon = statusDisplay.icon;
                  const projectName = getProjectName(job.projectId);

                  return (
                    <div key={`${job.jobType}-${job.jobId}`} className="flex items-center justify-between rounded-lg border p-2">
                      <div className="flex items-center gap-3">
                        <div className={`rounded-full p-1 ${statusDisplay.bg}`}>
                          <StatusIcon className={`h-3 w-3 ${statusDisplay.color}`} />
                        </div>
                        <div>
                          <p className="text-sm font-medium">
                            {job.jobType === 'segmentation' ? 'Segmentation' : '4D Reconstruction'}
                          </p>
                          <p className="text-muted-foreground text-xs">
                            {projectName} • {job.projectId.slice(-8)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant={job.jobType === 'segmentation' ? "secondary" : "outline"}
                          className="text-xs"
                        >
                          {job.jobType === 'segmentation' ? (
                            <><Brain className="h-3 w-3 mr-1" />Seg</>
                          ) : (
                            <><Box className="h-3 w-3 mr-1" />4D</>
                          )}
                        </Badge>
                        <Badge variant="outline" className={statusDisplay.color}>
                          {job.status}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
                {allJobs.length === 0 && <p className="text-muted-foreground py-4 text-center text-sm">No processing jobs yet.</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Projects Tab */}

        <TabsContent value="projects" className="space-y-4">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold">My Projects</h2>
              <p className="text-muted-foreground">Manage your cardiac imaging projects</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => window.open("/sample", "_blank")} className="hidden sm:flex">
                <FileText className="mr-2 h-4 w-4" />
                Sample NIfTI Files
              </Button>
              <Button variant="outline" onClick={() => window.open("/sample", "_blank")} className="sm:hidden">
                <FileText className="h-4 w-4" />
              </Button>
              <ShowForUser fallback={null}>
                <Button onClick={() => setUploadDialogOpen(true)} className="hidden sm:flex">
                  <Upload className="mr-2 h-4 w-4" />
                  Upload New Project
                </Button>
                <Button onClick={() => setUploadDialogOpen(true)} className="sm:hidden">
                  <Upload className="h-4 w-4" />
                </Button>
              </ShowForUser>
            </div>
          </div>

          {/* Project Management Info */}
          <ShowForRegisteredUser>
            <Alert>
              <AlertCircle className="inline h-4 w-4" />
              <AlertTitle>Project Management:</AlertTitle>
              <AlertDescription className="inline-block">
                <span className="inline">New projects start as </span>
                <span className="bg-secondary text-secondary-foreground mx-1 inline-block rounded-md px-2 py-0.5 text-xs font-medium">Temp</span>
                <span className="inline">
                  and will be <span className="font-semibold">automatically deleted</span> when you log out. Click the
                </span>
                <span className="bg-secondary text-secondary-foreground mx-1 inline-block rounded-md px-2 py-0.5 text-xs font-medium">Temp</span>
                <span className="inline"> badge to mark projects as </span>
                <span className="bg-primary text-primary-foreground mx-1 inline-block rounded-md px-2 py-0.5 text-xs font-medium">Saved</span>
                <span className="inline">
                  for permanent storage. Use the delete button to delete projects
                  <span className="font-semibold"> immediately</span>.
                </span>
              </AlertDescription>
            </Alert>
          </ShowForRegisteredUser>

          <ShowForGuest>
            <Alert className="opacity-60">
              <AlertCircle className="inline h-4 w-4" />
              <AlertTitle className="text-muted-foreground">Project Management (Guest Mode):</AlertTitle>
              <AlertDescription className="inline-block text-muted-foreground">
                <span className="inline">All projects are temporary as </span>
                <span className="bg-muted text-muted-foreground mx-1 inline-block rounded-md px-2 py-0.5 text-xs font-medium opacity-70">Temp</span>
                <span className="inline">
                  and will be <span className="font-semibold">automatically deleted</span> when you log out.
                  <span className="italic"> As a guest, you cannot save projects permanently or change their status.</span>
                  <span className="font-semibold"> You may only perform segmentation, edits and exports while the guest session is active.</span>
                </span>
              </AlertDescription>
            </Alert>
          </ShowForGuest>

          {/* Sorting, Filtering and View Controls */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-4">
              <div className="flex-1 max-w-sm">
                <Input placeholder="Search projects by name or description..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Sort by:</span>
                <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">Date Added</SelectItem>
                    <SelectItem value="name">Name (A-Z)</SelectItem>
                    <SelectItem value="nifti-size">NIfTI Size</SelectItem>
                    <SelectItem value="mesh-size">Mesh Size</SelectItem>
                    <SelectItem value="total-size">Total Size</SelectItem>
                    <SelectItem value="type">File Type</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">View:</span>
              <ToggleGroup type="single" value={viewMode} onValueChange={(value) => value && handleViewModeChange(value as "card" | "table")} className="border rounded-md">
                <ToggleGroupItem value="card" aria-label="Card view (Ctrl+1)" size="sm" title="Card view (Ctrl+1)">
                  <Grid3X3 className="h-4 w-4" />
                </ToggleGroupItem>
                <ToggleGroupItem value="table" aria-label="Table view (Ctrl+2)" size="sm" title="Table view (Ctrl+2)">
                  <List className="h-4 w-4" />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          {/* Results count with view mode indicator */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div>{searchTerm ? `Showing ${getSortedAndFilteredProjects().length} of ${projects.length} projects` : `${projects.length} project${projects.length !== 1 ? "s" : ""} total`}</div>
            <div className="flex items-center gap-2">
              <span>Viewing as {viewMode === "card" ? "cards" : "table"}</span>
            </div>
          </div>

          {/* Projects Display - Card or Table View */}
          {getSortedAndFilteredProjects().length === 0 ? (
            <Card>
              <CardContent className="text-center py-12 ">
                <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">{searchTerm ? "No projects match your search" : "No projects yet"}</h3>
                <p className="text-muted-foreground mb-4">
                  {searchTerm ? "Try adjusting your search terms or clear the search to see all projects." : "Upload your first project to get started with cardiac segmentation."}
                </p>
                <ShowForUser fallback={null}>
                  {!searchTerm && (
                    <Button onClick={() => setUploadDialogOpen(true)}>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload First Project
                    </Button>
                  )}
                </ShowForUser>
              </CardContent>
            </Card>
          ) : viewMode === "card" ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {getSortedAndFilteredProjects().map((project) => (
                <div key={project.projectId} className="group">
                  <EditableProjectCard
                    project={project}
                    onUpdate={refreshProjects}
                    onSave={handleSaveProject}
                    onDelete={handleDeleteProject}
                    onExport={handleExportProject}
                    segmentationIndicator={<SegmentationIndicator status={segmentationStatuses[project.projectId]} variant="badge" />}
                    reconstructionIndicator={<ReconstructionIndicator status={reconstructionStatuses[project.projectId]} variant="badge" />}
                    hasMasks={segmentationStatuses[project.projectId]?.hasMasks || false}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden sm:table-cell">Size</TableHead>
                      <TableHead className="hidden md:table-cell">Type</TableHead>
                      <TableHead className="hidden lg:table-cell">Dimensions</TableHead>
                      <TableHead className="hidden xl:table-cell">Reconstruction</TableHead>
                      <TableHead className="hidden md:table-cell">Created</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {getSortedAndFilteredProjects().map((project) => (
                      <TableRow key={project.projectId} className="group hover:bg-muted/50 cursor-pointer" onClick={() => window.open(`/project/${project.projectId}`, "_blank")}>
                        <TableCell className="font-medium">
                          <div>
                            <div className="font-semibold truncate max-w-80 group-hover:text-primary transition-colors" title={project.name}>
                              {project.name}
                            </div>
                            <div className="text-sm text-muted-foreground truncate max-w-xs" title={project.description || "No description"}>
                              {project.description || "No description"}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            <ShowForRegisteredUser fallback={<Badge variant={project.isSaved ? "default" : "secondary"}>{project.isSaved ? "Saved" : "Temp"}</Badge>}>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleSaveProject(project.projectId, !project.isSaved)}
                                className="h-auto p-1"
                                title={`Click to ${project.isSaved ? "mark as temporary" : "save permanently"}`}
                              >
                                <Badge variant={project.isSaved ? "default" : "secondary"} className="cursor-pointer hover:opacity-80">
                                  {project.isSaved ? "Saved" : "Temp"}
                                </Badge>
                              </Button>
                            </ShowForRegisteredUser>
                            <SegmentationIndicator status={segmentationStatuses[project.projectId]} variant="badge" />
                            <ReconstructionIndicator status={reconstructionStatuses[project.projectId]} variant="badge" />
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{formatFileSize(project.filesize)}</TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Badge variant="outline" className="font-mono text-xs">
                            {project.filetype}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <span className="font-mono text-sm">
                            {(() => {
                              let dimensionStringRepresentation = `${project.dimensions.width}×${project.dimensions.height}`;
                              if (project.dimensions.slices) dimensionStringRepresentation += `×${project.dimensions.slices}`;
                              if (project.dimensions.frames) dimensionStringRepresentation += `×${project.dimensions.frames}`;
                              return dimensionStringRepresentation;
                            })()}
                          </span>
                        </TableCell>
                        <TableCell className="hidden xl:table-cell">
                          <div className="text-sm">
                            <div className="text-muted-foreground">
                              ED Frame: <span className="font-medium text-foreground">{project.reconstruction ? project.reconstruction.edFrame : "—"}</span>
                            </div>
                            <div className="text-muted-foreground">
                              Mesh: <span className="font-medium text-foreground">{project.reconstruction?.tarFileSize ? formatFileSize(project.reconstruction.tarFileSize) : "—"}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{new Date(project.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => window.open(`/project/${project.projectId}`, "_blank")} title={`Open project ${project.name}`}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => handleExportProject(project.projectId)}
                              disabled={!segmentationStatuses[project.projectId]?.hasMasks}
                              title={segmentationStatuses[project.projectId]?.hasMasks ? "Export segmentation as NIfTI" : "Complete segmentation to enable export"}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            <ShowForRegisteredUser fallback={null}>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={() => handleDeleteProject(project.projectId, project.name)}
                                title={`Delete project ${project.name}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </ShowForRegisteredUser>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Ongoing Segmentation Jobs Tab */}
        <TabsContent value="jobs" className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold">Jobs</h2>
            <p className="text-muted-foreground">View all processing jobs (segmentation and reconstruction)</p>
          </div>

          {/* All Jobs Display */}
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Active Processing Jobs</CardTitle>
                <CardDescription>Track your ongoing segmentation and reconstruction tasks</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {allJobs
                  .filter((job) => job.status === "processing" || job.status === "pending" || job.status === "in_progress")
                  .map((job) => {
                    const statusDisplay = getStatusDisplay(job.status);
                    const StatusIcon = statusDisplay.icon;
                    const projectName = getProjectName(job.projectId);

                    return (
                      <div key={`${job.jobType}-${job.jobId}`} className="flex items-center justify-between rounded-lg border p-3 gap-4">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className={`rounded-full p-2 flex-shrink-0 ${statusDisplay.bg}`}>
                            <StatusIcon className={`h-4 w-4 ${statusDisplay.color}`} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium">
                                {job.jobType === 'segmentation' ? 'Segmentation' : '4D Reconstruction'}
                              </p>
                              <Badge 
                                variant={job.jobType === 'segmentation' ? "secondary" : "outline"}
                                className="text-xs"
                              >
                                {job.jobType === 'segmentation' ? (
                                  <><Brain className="h-3 w-3 mr-1" />Seg</>
                                ) : (
                                  <><Box className="h-3 w-3 mr-1" />4D</>
                                )}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                              <span className="flex items-center gap-1">
                                <span className="font-medium">{projectName}</span>
                                <span>•</span>
                                <span className="font-mono">{job.projectId.slice(-8)}</span>
                              </span>
                              <span className="hidden sm:inline">•</span>
                              <span className="whitespace-nowrap">{new Date(job.createdAt).toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                        <Badge variant="outline" className={`${statusDisplay.color} flex-shrink-0`}>
                          {job.status}
                        </Badge>
                      </div>
                    );
                  })}
                {allJobs.filter((job) => job.status === "processing" || job.status === "pending" || job.status === "in_progress").length === 0 && (
                  <div className="py-8 text-center">
                    <Brain className="text-muted-foreground/50 mx-auto h-12 w-12" />
                    <h3 className="mt-4 text-lg font-semibold">No Active Jobs</h3>
                    <p className="text-muted-foreground">Start a segmentation or reconstruction task from your projects to see active jobs here.</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Completed Jobs History */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Results</CardTitle>
                <CardDescription>Your completed processing tasks</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {allJobs
                  .filter((job) => job.status === "completed")
                  .slice(0, 10)
                  .map((job) => {
                    const statusDisplay = getStatusDisplay(job.status);
                    const StatusIcon = statusDisplay.icon;
                    const projectName = getProjectName(job.projectId);

                    return (
                      <div key={`${job.jobType}-${job.jobId}`} className="flex items-center justify-between rounded-lg border p-3 gap-4">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className={`rounded-full p-2 flex-shrink-0 ${statusDisplay.bg}`}>
                            <StatusIcon className={`h-4 w-4 ${statusDisplay.color}`} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium">
                                {job.jobType === 'segmentation' ? 'Segmentation' : '4D Reconstruction'}
                              </p>
                              <Badge 
                                variant={job.jobType === 'segmentation' ? "secondary" : "outline"}
                                className="text-xs"
                              >
                                {job.jobType === 'segmentation' ? (
                                  <><Brain className="h-3 w-3 mr-1" />Seg</>
                                ) : (
                                  <><Box className="h-3 w-3 mr-1" />4D</>
                                )}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                              <span className="flex items-center gap-1">
                                <span className="font-medium">{projectName}</span>
                                <span>•</span>
                                <span className="font-mono">{job.projectId.slice(-8)}</span>
                              </span>
                              <span className="hidden sm:inline">•</span>
                              <span className="whitespace-nowrap">{new Date(job.createdAt).toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`${statusDisplay.color} flex-shrink-0`}>
                            {job.status}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                {allJobs.filter((job) => job.status === "completed").length === 0 && (
                  <p className="text-muted-foreground py-4 text-center text-sm">No completed tasks yet.</p>
                )}
              </CardContent>
            </Card>

            {/* Failed Jobs */}
            {allJobs.filter((job) => job.status === "failed").length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Failed Jobs</CardTitle>
                  <CardDescription>Jobs that encountered errors</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {allJobs
                    .filter((job) => job.status === "failed")
                    .slice(0, 5)
                    .map((job) => {
                      const statusDisplay = getStatusDisplay(job.status);
                      const StatusIcon = statusDisplay.icon;
                      const projectName = getProjectName(job.projectId);

                      return (
                        <div key={`${job.jobType}-${job.jobId}`} className="flex items-center justify-between rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 p-3 gap-4">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className={`rounded-full p-2 flex-shrink-0 ${statusDisplay.bg}`}>
                              <StatusIcon className={`h-4 w-4 ${statusDisplay.color}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-medium">
                                  {job.jobType === 'segmentation' ? 'Segmentation' : '4D Reconstruction'}
                                </p>
                                <Badge 
                                  variant={job.jobType === 'segmentation' ? "secondary" : "outline"}
                                  className="text-xs"
                                >
                                  {job.jobType === 'segmentation' ? (
                                    <><Brain className="h-3 w-3 mr-1" />Seg</>
                                  ) : (
                                    <><Box className="h-3 w-3 mr-1" />4D</>
                                  )}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                                <span className="flex items-center gap-1">
                                  <span className="font-medium">{projectName}</span>
                                  <span>•</span>
                                  <span className="font-mono">{job.projectId.slice(-8)}</span>
                                </span>
                                <span className="hidden sm:inline">•</span>
                                <span className="whitespace-nowrap">{new Date(job.createdAt).toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                          <Badge variant="outline" className={`${statusDisplay.color} flex-shrink-0`}>
                            {job.status}
                          </Badge>
                        </div>
                      );
                    })}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* File Upload Dialog */}
      <FileUploadDialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen} onUploadSuccess={handleUploadSuccess} />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              Are you sure you want to delete &quot;{projectToDelete?.name}&quot;?
              <br />
              <span className="text-muted-foreground text-sm italic">This will permanently delete the project and all associated data including segmentation results.</span>
              <br />
              <span className="font-semibold">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setProjectToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteProject} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
