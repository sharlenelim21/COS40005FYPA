"use client";

import { createContext, useContext, useEffect, useState, useRef, ReactNode, useCallback, useMemo } from "react";
import { projectApi, segmentationApi, reconstructionApi } from "@/lib/api";
import { decodeSegmentationMasks } from "@/lib/decode-RLE";
import { tarImageCache } from "@/lib/tar-image-cache";
import { reconstructionCache } from "@/lib/reconstruction-cache";
import * as ProjectTypes from "@/types/project";
import { LoadingStage } from "@/types/project";
import { usePathname } from "next/navigation";

interface ProjectContextType {
  // Loading states
  loading: LoadingStage;

  // Data states
  projectData: ProjectTypes.ProjectData | null;
  hasMasks: boolean;
  undecodedMasks: ProjectTypes.BaseSegmentationMask[] | null;
  decodedMasks: Record<string, Uint8Array> | null;
  jobs: ProjectTypes.UserJob[] | null;
  reconstructionJobs: ProjectTypes.UserJob[] | null;

  // Error states
  error: string | null;
  segmentationError: string | null;
  jobsError: string | null;
  reconstructionJobsError: string | null;

  // Status flags
  maskFetchDone: boolean;

  // NEW: Tar cache management (MRI images)
  tarCacheReady: boolean;
  tarCacheError: string | null;
  getMRIImage: (frame: number, slice: number) => Promise<string | null>;
  getMRIImageFilename: (frame: number, slice: number) => Promise<string | null>;
  preloadMRIImages: () => Promise<void>;
  getAvailableFramesAndSlices: () => Promise<{ frames: number[]; slices: number[] }>;
  fetchAndExtractProjectImages: () => Promise<{ success: boolean; extractedImages: number; totalImages: number; errors: string[] }>;
  clearProjectCache: () => Promise<void>;
  
  // NEW: Reconstruction cache management (4D GLB models)
  hasReconstructions: boolean;
  reconstructionMetadata: any | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  reconstructionCacheReady: boolean;
  reconstructionCacheError: string | null;
  getReconstructionGLB: (frame: number) => Promise<string | null>;
  preloadReconstructionModels: () => Promise<void>;
  fetchAndExtractProjectModels: () => Promise<{ success: boolean; extractedModels: number; totalModels: number; errors: string[] }>;
  clearReconstructionCache: () => Promise<void>;
  refreshReconstructions: () => Promise<void>;
  
  // NEW: URL Preloading for smooth playback
  preloadAllModelURLs: (onProgress?: (current: number, total: number) => void) => Promise<number>;
  isPreloading: boolean;
  preloadProgress: { current: number; total: number } | null;
  isFullyPreloaded: boolean;
  
  // NEW: Three.js Aggressive Preloading (parse all GLB models)
  preloadAllThreeJSModels: (onProgress?: (current: number, total: number) => void) => Promise<number>;
  isThreeJSPreloading: boolean;
  threeJSPreloadProgress: { current: number; total: number } | null;
  
  // Cache invalidation
  refreshMasks: () => Promise<void>;
  refreshJobs: () => Promise<void>;
  refreshReconstructionJobs: () => Promise<void>;
  
  // Optimistic updates
  updateContextMasks: (newMasks: Record<string, Uint8Array>) => void;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export function useProject() {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error("useProject must be used within a ProjectProvider");
  }
  return context;
}

interface ProjectProviderProps {
  children: ReactNode;
  projectId: string;
}

export function ProjectProvider({ children, projectId }: ProjectProviderProps) {
  const pathname = usePathname();
  const isDocPage = pathname?.startsWith("/doc");
  const isProjectOverviewPage = !!pathname && /^\/project\/[^/]+$/.test(pathname);
  const shouldSkipReconstructionPreload = isDocPage || isProjectOverviewPage;

  const [loading, setLoading] = useState<LoadingStage>("idle");

  // Performance monitoring effect - logs loading time metrics
  useEffect(() => {
    const startTime = Date.now();
    console.log(`[Performance] ProjectContext loading started for project ${projectId} at ${new Date().toISOString()}`);

    return () => {
      const endTime = Date.now();
      const duration = endTime - startTime;
      console.log(`[Performance] ProjectContext lifecycle completed in ${duration}ms for project ${projectId}`);
    };
  }, [projectId]);

  // General state variables
  const [error, setError] = useState<string | null>(null);

  // 1. Project data state
  const [projectData, setProjectData] = useState<ProjectTypes.ProjectData | null>(null);

  // 2. Masks state
  const [hasMasks, setHasMasks] = useState<boolean>(false);
  const [undecodedMasks, setUndecodedMasks] = useState<ProjectTypes.BaseSegmentationMask[] | null>(null);
  const [segmentationError, setSegmentationError] = useState<string | null>(null);
  const [decodedMasks, setDecodedMasks] = useState<Record<string, Uint8Array> | null>(null);
  const [maskFetchDone, setMaskFetchDone] = useState<boolean>(false);

  // 3. Jobs state
  const [jobs, setJobs] = useState<ProjectTypes.UserJob[] | null>(null);
  const [jobsError, setJobsError] = useState<string | null>(null);

  // 3b. Reconstruction jobs state
  const [reconstructionJobs, setReconstructionJobs] = useState<ProjectTypes.UserJob[] | null>(null);
  const [reconstructionJobsError, setReconstructionJobsError] = useState<string | null>(null);

  // 4. Tar cache state - NEW
  const [tarCacheReady, setTarCacheReady] = useState<boolean>(false);
  const [tarCacheError, setTarCacheError] = useState<string | null>(null);

  // 5. Reconstruction cache state - NEW
  const [hasReconstructions, setHasReconstructions] = useState<boolean>(false);
  const [reconstructionMetadata, setReconstructionMetadata] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [reconstructionCacheReady, setReconstructionCacheReady] = useState<boolean>(false);
  const [reconstructionCacheError, setReconstructionCacheError] = useState<string | null>(null);

  // 6. URL Preloading state - NEW
  const [isPreloading, setIsPreloading] = useState<boolean>(false);
  const [preloadProgress, setPreloadProgress] = useState<{ current: number; total: number } | null>(null);
  const [isFullyPreloaded, setIsFullyPreloaded] = useState<boolean>(false);

  // 7. Three.js Aggressive Preloading state - NEW
  const [isThreeJSPreloading, setIsThreeJSPreloading] = useState<boolean>(false);
  const [threeJSPreloadProgress, setThreeJSPreloadProgress] = useState<{ current: number; total: number } | null>(null);

  // Performance optimization: Use refs to track loading states and prevent race conditions
  const loadingRef = useRef<LoadingStage>("idle");
  const projectDataRef = useRef<ProjectTypes.ProjectData | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  // Refs to track if jobs have been fetched (prevents redundant API calls during polling)
  const jobsFetchedRef = useRef<boolean>(false);
  const reconstructionJobsFetchedRef = useRef<boolean>(false);

  // Update refs when state changes
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    projectDataRef.current = projectData;
  }, [projectData]);

  // Tar cache methods - NEW - Memoized for performance
  const getMRIImage = useCallback(
    async (frame: number, slice: number): Promise<string | null> => {
      if (!projectId || !tarCacheReady) return null;
      try {
        return await tarImageCache.getImageURL(projectId, frame, slice);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("TarImageCache not initialized")) {
          console.error("[ProjectContext] Failed to get MRI image:", error);
        }
        return null;
      }
    },
    [projectId, tarCacheReady],
  );

  const getMRIImageFilename = useCallback(
    async (frame: number, slice: number): Promise<string | null> => {
      if (!projectId || !tarCacheReady) return null;
      try {
        return await tarImageCache.getImageFilename(projectId, frame, slice);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("TarImageCache not initialized")) {
          console.error("[ProjectContext] Failed to get MRI image filename:", error);
        }
        return null;
      }
    },
    [projectId, tarCacheReady],
  );

  const preloadMRIImages = useCallback(async (): Promise<void> => {
    if (!projectId || !projectData) return;

    try {
      const result = await tarImageCache.fetchAndExtractProjectImages(projectId, projectApi.getProjectPresignedUrl);
      if (result.success) {
        setTarCacheReady(true);
        setTarCacheError(null);
        console.log(`[ProjectContext] Preloaded ${result.extractedImages} images for project ${projectId}`);
      } else {
        setTarCacheError(`Failed to preload images: ${result.errors.join(", ")}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown preload error";
      setTarCacheError(errorMessage);
      console.error("[ProjectContext] Preload error:", error);
    }
  }, [projectId, projectData]);

  const getAvailableFramesAndSlices = useCallback(async (): Promise<{ frames: number[]; slices: number[] }> => {
    if (!projectId) return { frames: [], slices: [] };

    try {
      return await tarImageCache.getAvailableFramesAndSlices(projectId);
    } catch (error) {
      console.error("[ProjectContext] Failed to get available frames and slices:", error);
      return { frames: [], slices: [] };
    }
  }, [projectId]);

  const fetchAndExtractProjectImages = useCallback(async (): Promise<{ success: boolean; extractedImages: number; totalImages: number; errors: string[] }> => {
    if (!projectId) return { success: false, extractedImages: 0, totalImages: 0, errors: ["No project ID"] };

    try {
      const result = await tarImageCache.fetchAndExtractProjectImages(projectId, projectApi.getProjectPresignedUrl);
      if (result.success) {
        setTarCacheReady(true);
        setTarCacheError(null);
      } else {
        setTarCacheError(`Image extraction failed: ${result.errors.join(", ")}`);
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown extraction error";
      setTarCacheError(errorMessage);
      console.error("[ProjectContext] Extraction error:", error);
      return { success: false, extractedImages: 0, totalImages: 0, errors: [errorMessage] };
    }
  }, [projectId]);

  const clearProjectCache = useCallback(async (): Promise<void> => {
    if (!projectId) return;

    try {
      await tarImageCache.clearProjectCache(projectId);
      setTarCacheReady(false);
      setTarCacheError(null);
      console.log(`[ProjectContext] Cleared cache for project ${projectId}`);
    } catch (error) {
      console.error("[ProjectContext] Failed to clear cache:", error);
      setTarCacheError(`Failed to clear cache: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }, [projectId]);

  // Reconstruction cache methods - NEW
  const getReconstructionGLB = useCallback(
    async (frame: number): Promise<string | null> => {
      if (!projectId || !reconstructionMetadata?.reconstructionId) {
        console.warn("[ProjectContext] Cannot get GLB: missing projectId or reconstructionId");
        return null;
      }
      try {
        return await reconstructionCache.getModelURL(projectId, reconstructionMetadata.reconstructionId, frame);
      } catch (error) {
        console.error("[ProjectContext] Failed to get reconstruction GLB:", error);
        return null;
      }
    },
    [projectId, reconstructionMetadata],
  );

  const preloadReconstructionModels = useCallback(async (): Promise<void> => {
    if (!projectId || !reconstructionMetadata?.reconstructionId) {
      console.warn("[ProjectContext] ⚠️ Cannot preload models: missing projectId or reconstructionId");
      return;
    }

    const startTime = performance.now();
    console.log(`[ProjectContext] 🚀 Starting reconstruction models preload...`);
    console.log(`[ProjectContext] 📋 Target: Project ${projectId}, Reconstruction ${reconstructionMetadata.reconstructionId}`);

    try {
      // Create wrapper function that matches expected signature
      const getPresignedUrl = async (pid: string, rid: string) => {
        console.log(`[ProjectContext] 🔗 Fetching presigned URL from backend...`);
        const response = await reconstructionApi.getReconstructionResults(pid);
        
        if (!response.success || !response.reconstructions || response.reconstructions.length === 0) {
          console.error(`[ProjectContext] ❌ Failed to get presigned URL: ${response.message || "No reconstructions found"}`);
          return {
            success: false,
            message: response.message || "No reconstructions found"
          };
        }
        
        // Find the reconstruction matching the ID
        // Backend returns 'reconstructionId' not '_id'
        const reconstruction = response.reconstructions.find((r: any) => r.reconstructionId === rid); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!reconstruction || !reconstruction.downloadUrl) {
          console.error(`[ProjectContext] ❌ Reconstruction not found or missing presigned URL`);
          console.error(`[ProjectContext] 🔍 Looking for reconstructionId: ${rid}`);
          console.error(`[ProjectContext] 📋 Available reconstructions:`, response.reconstructions.map((r: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
            id: r.reconstructionId, 
            name: r.name, 
            hasDownloadUrl: !!r.downloadUrl 
          })));
          return {
            success: false,
            message: "Reconstruction not found or no presigned URL available"
          };
        }

        console.log(`[ProjectContext] ✅ Presigned URL obtained successfully`);
        console.log(`[ProjectContext] 🔒 URL will expire in 1 hour from now`);
        
        return {
          success: true,
          presignedUrl: reconstruction.downloadUrl, // Backend returns 'downloadUrl'
          expiresAt: Date.now() + 3600000 // 1 hour from now (timestamp in ms)
        };
      };

      console.log(`[ProjectContext] 📦 Initiating TAR download and extraction...`);
      const result = await reconstructionCache.fetchAndExtractProjectModels(
        projectId,
        reconstructionMetadata.reconstructionId,
        getPresignedUrl
      );

      const elapsedTime = ((performance.now() - startTime) / 1000).toFixed(2);

      if (result.success) {
        setReconstructionCacheReady(true);
        setReconstructionCacheError(null);
        console.log(`[ProjectContext] ✅ Successfully preloaded ${result.extractedModels}/${result.totalModels} GLB models`);
        console.log(`[ProjectContext] ⚡ Total preload time: ${elapsedTime}s`);
        console.log(`[ProjectContext] 💾 Models cached in IndexedDB for instant access`);
        
        // Get detailed frame mapping info
        const mappingInfo = await reconstructionCache.getFrameMappingInfo(reconstructionMetadata.reconstructionId);
        console.log(`[ProjectContext] 📊 Frame Mapping:`, {
          totalFrames: mappingInfo.totalFrames,
          sequentialIndices: mappingInfo.sequentialIndices,
          actualFrameIndices: mappingInfo.actualFrameIndices,
          filenames: mappingInfo.filenames
        });
        
        // Get debug info from cache
        const debugInfo = reconstructionCache.getDebugInfo();
        console.log(`[ProjectContext] � Download stats:`, {
          tarFileSize: `${(debugInfo.tarFileSize / 1024 / 1024).toFixed(2)} MB`,
          extractedModels: result.extractedModels,
          processingTime: `${(debugInfo.processingTime / 1000).toFixed(2)}s`,
          downloadSuccess: debugInfo.tarFileFetched,
          extractionSuccess: debugInfo.extractionCompleted
        });
      } else {
        const errorMsg = `Failed to preload models: ${result.errors.join(", ")}`;
        console.error(`[ProjectContext] ❌ Preload failed after ${elapsedTime}s`);
        console.error(`[ProjectContext] 💥 Errors:`, result.errors);
        setReconstructionCacheError(errorMsg);
      }
    } catch (error) {
      const elapsedTime = ((performance.now() - startTime) / 1000).toFixed(2);
      const errorMessage = error instanceof Error ? error.message : "Unknown preload error";
      console.error(`[ProjectContext] ❌ Preload reconstruction models error after ${elapsedTime}s:`, error);
      console.error(`[ProjectContext] 💥 Error details:`, {
        message: errorMessage,
        projectId,
        reconstructionId: reconstructionMetadata.reconstructionId,
        stack: error instanceof Error ? error.stack : undefined
      });
      setReconstructionCacheError(errorMessage);
    }
  }, [projectId, reconstructionMetadata]);

  const fetchAndExtractProjectModels = useCallback(async (): Promise<{ success: boolean; extractedModels: number; totalModels: number; errors: string[] }> => {
    if (!projectId || !reconstructionMetadata?.reconstructionId) {
      return { success: false, extractedModels: 0, totalModels: 0, errors: ["Missing projectId or reconstructionId"] };
    }

    try {
      // Create wrapper function that matches expected signature
      const getPresignedUrl = async (pid: string, rid: string) => {
        const response = await reconstructionApi.getReconstructionResults(pid);
        if (!response.success || !response.reconstructions || response.reconstructions.length === 0) {
          return {
            success: false,
            message: response.message || "No reconstructions found"
          };
        }
        
        // Backend returns 'reconstructionId' not '_id'
        const reconstruction = response.reconstructions.find((r: any) => r.reconstructionId === rid); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (!reconstruction || !reconstruction.downloadUrl) {
          return {
            success: false,
            message: "Reconstruction not found or no presigned URL available"
          };
        }

        return {
          success: true,
          presignedUrl: reconstruction.downloadUrl, // Backend returns 'downloadUrl'
          expiresAt: Date.now() + 3600000 // 1 hour from now (timestamp in ms)
        };
      };

      const result = await reconstructionCache.fetchAndExtractProjectModels(
        projectId,
        reconstructionMetadata.reconstructionId,
        getPresignedUrl
      );

      if (result.success) {
        setReconstructionCacheReady(true);
        setReconstructionCacheError(null);
      } else {
        setReconstructionCacheError(`Model extraction failed: ${result.errors.join(", ")}`);
      }
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown extraction error";
      setReconstructionCacheError(errorMessage);
      console.error("[ProjectContext] Extraction error:", error);
      return { success: false, extractedModels: 0, totalModels: 0, errors: [errorMessage] };
    }
  }, [projectId, reconstructionMetadata]);

  const clearReconstructionCache = useCallback(async (): Promise<void> => {
    if (!projectId) return;

    try {
      await reconstructionCache.clearProjectModels(projectId);
      setReconstructionCacheReady(false);
      setReconstructionCacheError(null);
      setIsFullyPreloaded(false); // Reset preload status
      console.log(`[ProjectContext] Cleared reconstruction cache for project ${projectId}`);
    } catch (error) {
      console.error("[ProjectContext] Failed to clear reconstruction cache:", error);
      setReconstructionCacheError(`Failed to clear reconstruction cache: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }, [projectId]);

  // NEW: Preload all model URLs for smooth playback
  const preloadAllModelURLs = useCallback(
    async (onProgress?: (current: number, total: number) => void): Promise<number> => {
      if (!projectId || !reconstructionMetadata?.reconstructionId) {
        console.warn("[ProjectContext] ⚠️ Cannot preload URLs: missing projectId or reconstructionId");
        return 0;
      }

      if (!reconstructionCacheReady) {
        console.warn("[ProjectContext] ⚠️ Cannot preload URLs: reconstruction cache not ready yet");
        return 0;
      }

      setIsPreloading(true);
      setPreloadProgress({ current: 0, total: 0 });

      try {
        console.log(`[ProjectContext] 🚀 Starting URL preload for all frames...`);

        const count = await reconstructionCache.preloadAllModelURLs(
          projectId,
          reconstructionMetadata.reconstructionId,
          (current, total) => {
            // Update internal progress state
            setPreloadProgress({ current, total });
            
            // Call external progress callback if provided
            if (onProgress) {
              onProgress(current, total);
            }
          }
        );

        console.log(`[ProjectContext] ✅ Preloaded ${count} model URLs`);
        setIsFullyPreloaded(true);
        setPreloadProgress(null);
        
        return count;
      } catch (error) {
        console.error("[ProjectContext] ❌ Failed to preload model URLs:", error);
        setPreloadProgress(null);
        return 0;
      } finally {
        setIsPreloading(false);
      }
    },
    [projectId, reconstructionMetadata, reconstructionCacheReady]
  );

  // NEW: Aggressive Three.js preloading - parse all GLB models into Three.js cache
  const preloadAllThreeJSModels = useCallback(
    async (onProgress?: (current: number, total: number) => void): Promise<number> => {
      if (!projectId || !reconstructionMetadata?.reconstructionId) {
        console.warn("[ProjectContext] ⚠️ Cannot preload Three.js models: missing projectId or reconstructionId");
        return 0;
      }

      if (!reconstructionCacheReady) {
        console.warn("[ProjectContext] ⚠️ Cannot preload Three.js models: reconstruction cache not ready yet");
        return 0;
      }

      setIsThreeJSPreloading(true);
      setThreeJSPreloadProgress({ current: 0, total: 0 });

      try {
        console.log(`[ProjectContext] 🎮 Starting Three.js aggressive preload for all models...`);

        // First, ensure all URLs are preloaded
        await preloadAllModelURLs();

        // Get all model URLs from cache
        const modelURLs = await reconstructionCache.getAllModelURLs(
          projectId,
          reconstructionMetadata.reconstructionId
        );

        const total = modelURLs.length;
        let loaded = 0;

        console.log(`[ProjectContext] 📦 Preloading ${total} models into Three.js cache...`);

        // Import useGLTF from drei for proper React Three Fiber caching
        const { useGLTF } = await import('@react-three/drei');
        
        // Dynamically import OBJLoader for OBJ files
        const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
        const objLoader = new OBJLoader();

        // Load all models with concurrency limit to avoid memory issues
        const CONCURRENT_LOADS = 3; // Load 3 models at a time
        
        for (let i = 0; i < modelURLs.length; i += CONCURRENT_LOADS) {
          const batch = modelURLs.slice(i, i + CONCURRENT_LOADS);
          
          await Promise.all(
            batch.map(async ({ frame, url, filename }) => {
              try {
                const isOBJ = filename.toLowerCase().endsWith('.obj');
                
                if (isOBJ) {
                  // For OBJ files, use OBJLoader
                  await new Promise<void>((resolve) => {
                    objLoader.load(
                      url,
                      () => {
                        loaded++;
                        setThreeJSPreloadProgress({ current: loaded, total });
                        if (onProgress) onProgress(loaded, total);
                        if (loaded % 5 === 0 || loaded === total) {
                          console.log(`[ProjectContext] 🎮 Preloaded ${loaded}/${total} models (frame ${frame})`);
                        }
                        resolve();
                      },
                      undefined,
                      (error) => {
                        console.error(`[ProjectContext] ❌ Failed to preload OBJ frame ${frame}:`, error);
                        loaded++;
                        setThreeJSPreloadProgress({ current: loaded, total });
                        resolve();
                      }
                    );
                  });
                } else {
                  // For GLB/GLTF files, use useGLTF.preload() which integrates with React Three Fiber's cache
                  try {
                    useGLTF.preload(url);
                    loaded++;
                    setThreeJSPreloadProgress({ current: loaded, total });
                    if (onProgress) onProgress(loaded, total);
                    if (loaded % 5 === 0 || loaded === total) {
                      console.log(`[ProjectContext] 🎮 Preloaded ${loaded}/${total} models (frame ${frame})`);
                    }
                  } catch (error) {
                    console.error(`[ProjectContext] ❌ Failed to preload GLB frame ${frame}:`, error);
                    loaded++;
                    setThreeJSPreloadProgress({ current: loaded, total });
                  }
                }
              } catch (error) {
                console.error(`[ProjectContext] ❌ Error preloading frame ${frame}:`, error);
                loaded++;
                setThreeJSPreloadProgress({ current: loaded, total });
              }
            })
          );
        }

        console.log(`[ProjectContext] ✅ Preloaded ${loaded}/${total} models into Three.js cache`);
        console.log(`[ProjectContext] 🎯 All models should now load instantly when displayed!`);
        setThreeJSPreloadProgress(null);
        
        return loaded;
      } catch (error) {
        console.error("[ProjectContext] ❌ Failed to preload Three.js models:", error);
        setThreeJSPreloadProgress(null);
        return 0;
      } finally {
        setIsThreeJSPreloading(false);
      }
    },
    [projectId, reconstructionMetadata, reconstructionCacheReady, preloadAllModelURLs]
  );

  const refreshReconstructions = useCallback(async (): Promise<void> => {
    if (!projectId) {
      console.warn("[ProjectContext] Cannot refresh reconstructions - missing projectId");
      return;
    }

    try {
      console.log("[ProjectContext] Refreshing reconstructions...");
      const response = await reconstructionApi.getReconstructionResults(projectId);

      if (response.success && response.reconstructions && response.reconstructions.length > 0) {
        // Use the most recent reconstruction
        const latestReconstruction = response.reconstructions[0];
        setReconstructionMetadata(latestReconstruction);
        setHasReconstructions(true);
        console.log("[ProjectContext] Reconstructions refreshed successfully");
      } else {
        setReconstructionMetadata(null);
        setHasReconstructions(false);
        console.log("[ProjectContext] No reconstructions found");
      }
    } catch (error) {
      console.error("[ProjectContext] Failed to refresh reconstructions:", error);
    }
  }, [projectId]);

  // 1. Fetch project data from backend - Optimized with abort controller
  useEffect(() => {
    // Abort any pending requests
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setLoading("project");

    // Check if projectId is available
    if (!projectId) {
      setProjectData(null);
      setError("Project ID is missing.");
      // Don't set loading to done here - let final loading state management handle it
      return;
    }

    // Fetch project data using the projectId
    projectApi
      .getProjectInfo(projectId)
      .then((response) => {
        // Check if request was aborted
        if (signal.aborted) return;

        // If backend cannot find project, set error state, end loading
        if (!response.success) {
          setError(response.message);
          // Don't set loading to done here - let final loading state management handle it
          return;
        }

        // Handle project data
        setProjectData(response.project);
        console.log("Verifying project data:", response.project);
      })
      .catch((error: unknown) => {
        // Don't set error if request was aborted
        if (signal.aborted) return;

        setError("Failed to fetch project data.");
        console.error("Error fetching project:", error);
      })
      .finally(() => {
        // Don't update loading if request was aborted
        if (signal.aborted) return;

        setLoading("idle");
      });

    // Cleanup function
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [projectId]);

  // 2. Optimized mask loading - improved dependency checking and performance
  useEffect(() => {
    // Early returns for better performance
    if (error || !projectId || !projectData) {
      return;
    }

    setLoading("mask");
    setMaskFetchDone(false);

    // Fetch segmentation masks for the project
    segmentationApi
      .getSegmentationResults(projectId)
      .then((response) => {
        // Handle segmentation masks
        console.log("Segmentation masks response:", response);
        console.log("Decoded masks state:", decodedMasks);

        // If masks not found in backend, set mask error state, but not project/page error
        if (!response.success) {
          setHasMasks(false);
          setSegmentationError(response.message);
          setDecodedMasks(null);
          console.warn("No masks found:", response.message);
          return;
        }

        // Set into undecoded masks state first
        setUndecodedMasks(response.segmentations);
        // Determine if masks actually exist (non-empty set)
        const hasAnyMasks = Array.isArray(response.segmentations) && response.segmentations.length > 0;
        setHasMasks(hasAnyMasks);
        console.log("Undecoded masks:", response.segmentations);

        // Only decode masks if we have valid project dimensions
        // This prevents race conditions where masks are decoded with width/height = 0
        if (projectData?.dimensions?.width && projectData?.dimensions?.height) {
          console.log("Decoding masks with dimensions:", projectData.dimensions);
          const decodedResult = decodeSegmentationMasks(response.segmentations, projectData.dimensions.width, projectData.dimensions.height);
          setDecodedMasks(decodedResult.masks);
          console.log("Decoded masks:", decodedResult.masks);
        } else {
          console.warn("Cannot decode masks - missing or invalid project dimensions:", projectData?.dimensions);
          // Don't set decodedMasks to null - leave it for retry when dimensions are available
        }
      })
      .catch((error: unknown) => {
        setSegmentationError("Failed to fetch segmentation masks.");
        console.error("Error fetching segmentation masks:", error);
      })
      .finally(() => {
        // Don't set loading to done here - let final loading state management handle it
        setMaskFetchDone(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectData, projectId, error]);

  // 2b. Retry mask decoding when project dimensions become available (fixes race condition)
  useEffect(() => {
    // Only retry if we have undecoded masks, valid dimensions, but no decoded masks yet
    if (undecodedMasks && Array.isArray(undecodedMasks) && undecodedMasks.length > 0 && projectData?.dimensions?.width && projectData?.dimensions?.height && !decodedMasks) {
      console.log("Retrying mask decoding with available dimensions:", projectData.dimensions);

      try {
        const decodedResult = decodeSegmentationMasks(undecodedMasks, projectData.dimensions.width, projectData.dimensions.height);
        setDecodedMasks(decodedResult.masks);
        console.log("Successfully decoded masks on retry:", decodedResult.masks);
      } catch (error) {
        console.error("Failed to decode masks on retry:", error);
        setSegmentationError("Failed to decode segmentation masks");
      }
    }
  }, [projectData, undecodedMasks, decodedMasks]);

  // 3. Optimized jobs loading - if no masks exist, check for jobs with race condition prevention
  useEffect(() => {
    const abortController = new AbortController();

    // If masks are present, clear any previous job data and error about missing results
    if (hasMasks) {
      if (jobsError) {
        setJobsError(null);
      }
      if (jobs !== null) {
        console.log("[ProjectContext] Clearing segmentation jobs since masks are now available");
        setJobs(null);
      }
      // Reset the fetch flag so jobs can be fetched again if masks are later removed
      jobsFetchedRef.current = false;
      return;
    }

    // Only fetch jobs if mask fetch is done, we don't have masks, and project data is loaded
    // Don't block on segmentationError (e.g., 'No masks found')
    // IMPORTANT: Only fetch if we haven't already fetched jobs (prevents redundant API calls during mask polling)
    if (!maskFetchDone || hasMasks || !projectData || !projectId || jobsFetchedRef.current) {
      return;
    }

    setLoading("job");
    
    // Mark that we're fetching jobs to prevent redundant calls
    jobsFetchedRef.current = true;

    // Fetch jobs for the current user
    segmentationApi
      .getUserJobs()
      .then((response) => {
        // Check if request was aborted
        if (abortController.signal.aborted) {
          return;
        }

        console.log("Jobs response:", response);

        // Handle job fetch error
        if (!response.success) {
          setJobsError(response.message);
          console.warn("Failed to fetch jobs:", response.message);
          setJobs(null);
          return;
        }

        // Filter jobs by current project ID
        const projectJobs = response.jobs.filter((job: ProjectTypes.UserJob) => job.projectId === projectId);
        setJobs(projectJobs);
        console.log(`Found ${projectJobs.length} jobs for project ${projectId}:`, projectJobs);

        // Check for logical errors: completed jobs should have masks
        const completedJobs = projectJobs.filter((job: ProjectTypes.UserJob) => job.status === ProjectTypes.JobStatus.COMPLETED);
        if (completedJobs.length > 0 && !hasMasks) {
          console.warn(`Warning: Found ${completedJobs.length} completed job(s) but no masks for project ${projectId}. This may indicate a server-side issue.`);
          setJobsError(`Found completed segmentation job(s) but no results. Please contact support or try re-creating the project.`);
        }
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          console.log("Jobs fetch request was aborted");
          return;
        }
        setJobsError("Failed to fetch job data.");
        console.error("Error fetching jobs:", error);
        setJobs(null);
      });

    return () => {
      abortController.abort();
    };
  }, [maskFetchDone, hasMasks, projectData, projectId, jobsError]);

  // 3b. Optimized reconstruction jobs loading - similar to segmentation jobs
  useEffect(() => {
    const abortController = new AbortController();

    // If reconstructions are present, clear any previous job data and error about missing results
    if (hasReconstructions) {
      if (reconstructionJobsError) {
        setReconstructionJobsError(null);
      }
      if (reconstructionJobs !== null) {
        console.log("[ProjectContext] Clearing reconstruction jobs since reconstructions are now available");
        setReconstructionJobs(null);
      }
      // Reset the fetch flag so jobs can be fetched again if reconstructions are later removed
      reconstructionJobsFetchedRef.current = false;
      return;
    }

    // Only fetch jobs if we don't have reconstructions and project data is loaded
    // IMPORTANT: Only fetch if we haven't already fetched jobs (prevents redundant API calls during reconstruction polling)
    if (hasReconstructions || !projectData || !projectId || reconstructionJobsFetchedRef.current) {
      return;
    }

    // Mark that we're fetching jobs to prevent redundant calls
    reconstructionJobsFetchedRef.current = true;

    // Fetch reconstruction jobs for the current user
    reconstructionApi
      .getUserReconstructionJobs()
      .then((response: { success: boolean; message?: string; jobs: ProjectTypes.UserJob[] }) => {
        // Check if request was aborted
        if (abortController.signal.aborted) {
          return;
        }

        console.log("Reconstruction jobs response:", response);

        // Handle job fetch error
        if (!response.success) {
          setReconstructionJobsError(response.message || "Failed to fetch reconstruction jobs");
          console.warn("Failed to fetch reconstruction jobs:", response.message);
          setReconstructionJobs(null);
          return;
        }

        // Filter jobs by current project ID
        const projectJobs = response.jobs.filter((job: ProjectTypes.UserJob) => job.projectId === projectId);
        setReconstructionJobs(projectJobs);
        console.log(`Found ${projectJobs.length} reconstruction jobs for project ${projectId}:`, projectJobs);

        // Check for logical errors: completed jobs should have reconstructions
        const completedJobs = projectJobs.filter((job: ProjectTypes.UserJob) => job.status === ProjectTypes.JobStatus.COMPLETED);
        if (completedJobs.length > 0 && !hasReconstructions) {
          console.warn(`Warning: Found ${completedJobs.length} completed reconstruction job(s) but no reconstructions for project ${projectId}. This may indicate a server-side issue.`);
          setReconstructionJobsError(`Found completed reconstruction job(s) but no results. Please contact support or try re-creating the reconstruction.`);
        }
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) {
          console.log("Reconstruction jobs fetch request was aborted");
          return;
        }
        setReconstructionJobsError("Failed to fetch reconstruction job data.");
        console.error("Error fetching reconstruction jobs:", error);
        setReconstructionJobs(null);
      });

    return () => {
      abortController.abort();
    };
  }, [hasReconstructions, projectData, projectId, reconstructionJobsError]);

  // 4. Initialize tar cache when project data is available and mask fetch is done - NEW
  useEffect(() => {
    if (!projectData || !projectId || !maskFetchDone) {
      setTarCacheReady(false);
      setTarCacheError(null);
      return;
    }

    // Set loading to tar-cache stage when we start tar cache initialization
    setLoading("tar-cache");

    const initializeTarCache = async () => {
      try {
        console.log(`[ProjectContext] Initializing tar cache for project ${projectId}`);

        // Initialize tar cache system
        await tarImageCache.init();

        // Check if images are already cached
        const { frames, slices } = await tarImageCache.getAvailableFramesAndSlices(projectId);
        if (frames.length > 0 && slices.length > 0) {
          console.log(`[ProjectContext] Found ${frames.length} frames and ${slices.length} slices in tar cache`);
          setTarCacheReady(true);
          setTarCacheError(null);
        } else {
          console.log("[ProjectContext] No cached images found, will attempt to extract from tar");
          // Attempt to fetch and extract images in background
          const result = await tarImageCache.fetchAndExtractProjectImages(projectId, projectApi.getProjectPresignedUrl);
          if (result.success) {
            console.log(`[ProjectContext] Successfully extracted ${result.extractedImages} images to cache`);
            setTarCacheReady(true);
            setTarCacheError(null);
          } else {
            console.warn("[ProjectContext] Failed to extract images");
            setTarCacheError(`Image extraction failed: ${result.errors.join(", ")}`);
            setTarCacheReady(false);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown tar cache error";
        console.error("[ProjectContext] Tar cache initialization error:", error);
        setTarCacheError(errorMessage);
        setTarCacheReady(false);
      }
    };

    initializeTarCache();

    // Cleanup function - clear project-specific cache when component unmounts or project changes
    return () => {
      console.log(`[ProjectContext] Cleaning up tar cache for project ${projectId}`);
      tarImageCache.clearProjectCache(projectId).catch((error) => console.warn(`[ProjectContext] Cleanup error for project ${projectId}:`, error));
    };
  }, [projectData, projectId, maskFetchDone]);

  // 4b. Fetch reconstruction metadata when project is loaded - NEW
  useEffect(() => {
    if (!projectId || !projectData) {
      setHasReconstructions(false);
      setReconstructionMetadata(null);
      return;
    }

    const fetchReconstructionMetadata = async () => {
      try {
        console.log(`[ProjectContext] Fetching reconstruction metadata for project ${projectId}`);
        const response = await reconstructionApi.getReconstructionResults(projectId);

        if (response.success && response.reconstructions && response.reconstructions.length > 0) {
          // Use the most recent reconstruction
          const latestReconstruction = response.reconstructions[0];
          setReconstructionMetadata(latestReconstruction);
          setHasReconstructions(true);
          console.log(`[ProjectContext] Found reconstruction: ${latestReconstruction.reconstructionId}`);
        } else {
          setReconstructionMetadata(null);
          setHasReconstructions(false);
          console.log("[ProjectContext] No reconstructions found for project");
        }
      } catch (error) {
        console.error("[ProjectContext] Failed to fetch reconstruction metadata:", error);
        setReconstructionMetadata(null);
        setHasReconstructions(false);
      }
    };

    fetchReconstructionMetadata();
  }, [projectId, projectData]);

  // 4c. Initialize reconstruction cache when reconstruction metadata is available - NEW
  useEffect(() => {
    if (!projectId || !reconstructionMetadata || !reconstructionMetadata.reconstructionId) {
      setReconstructionCacheReady(false);
      setReconstructionCacheError(null);
      return;
    }

    // Set loading stage to reconstruction-cache
    setLoading("reconstruction-cache");

    const initializeReconstructionCache = async () => {
      const startTime = performance.now();
      try {
        console.log(`[ProjectContext] 🔷 Starting reconstruction cache initialization for project ${projectId}`);
        console.log(`[ProjectContext] 📋 Reconstruction ID: ${reconstructionMetadata.reconstructionId}`);
        console.log(`[ProjectContext] 📦 Reconstruction metadata:`, {
          id: reconstructionMetadata._id,
          name: reconstructionMetadata.name,
          createdAt: reconstructionMetadata.createdAt,
          frameCount: reconstructionMetadata.frameCount || 'unknown'
        });

        // Initialize reconstruction cache system
        console.log(`[ProjectContext] 🔧 Initializing IndexedDB for reconstruction cache...`);
        await reconstructionCache.init();
        console.log(`[ProjectContext] ✅ IndexedDB initialized successfully`);

        // Check if models are already cached
        console.log(`[ProjectContext] 🔍 Checking for cached GLB models...`);
        const frames = await reconstructionCache.getAvailableFrames(reconstructionMetadata.reconstructionId);
        
        if (frames.length > 0) {
          const elapsedTime = ((performance.now() - startTime) / 1000).toFixed(2);
          console.log(`[ProjectContext] ✅ Found ${frames.length} cached GLB models in IndexedDB`);
          
          // Get detailed frame mapping info for debugging
          const mappingInfo = await reconstructionCache.getFrameMappingInfo(reconstructionMetadata.reconstructionId);
          console.log(`[ProjectContext] 📊 Frame Mapping:`, {
            totalFrames: mappingInfo.totalFrames,
            sequentialIndices: mappingInfo.sequentialIndices,
            actualFrameIndices: mappingInfo.actualFrameIndices,
            filenames: mappingInfo.filenames
          });
          console.log(`[ProjectContext] ⚡ Cache check completed in ${elapsedTime}s`);
          setReconstructionCacheReady(true);
          setReconstructionCacheError(null);
        } else {
          console.log(`[ProjectContext] 📥 No cached models found - starting TAR download and extraction...`);
          console.log(`[ProjectContext] 🌐 Fetching presigned URL for reconstruction TAR file...`);
          
          // Preload models in background
          await preloadReconstructionModels();
          
          const elapsedTime = ((performance.now() - startTime) / 1000).toFixed(2);
          console.log(`[ProjectContext] ✅ Reconstruction cache initialization completed in ${elapsedTime}s`);
        }
      } catch (error) {
        const elapsedTime = ((performance.now() - startTime) / 1000).toFixed(2);
        const errorMessage = error instanceof Error ? error.message : "Unknown reconstruction cache error";
        console.error(`[ProjectContext] ❌ Reconstruction cache initialization failed after ${elapsedTime}s:`, error);
        console.error(`[ProjectContext] 💥 Error details:`, {
          message: errorMessage,
          projectId,
          reconstructionId: reconstructionMetadata.reconstructionId,
          stack: error instanceof Error ? error.stack : undefined
        });
        setReconstructionCacheError(errorMessage);
        setReconstructionCacheReady(false);
      }
    };

    initializeReconstructionCache();

    // Cleanup function - clear project-specific cache when component unmounts or project changes
    return () => {
      console.log(`[ProjectContext] 🧹 Cleaning up reconstruction cache for project ${projectId}`);
      reconstructionCache.clearProjectModels(projectId).catch((error) => console.warn(`[ProjectContext] ⚠️ Reconstruction cleanup error:`, error));
    };
  }, [projectId, reconstructionMetadata, preloadReconstructionModels]);

  // 4d. Auto-preload ALL models (URLs + Three.js cache) when reconstruction cache is ready - ZERO-LAG SYSTEM
  useEffect(() => {
    if (!reconstructionCacheReady || isPreloading || isThreeJSPreloading) {
      return;
    }

    if (!projectId || !reconstructionMetadata?.reconstructionId) {
      return;
    }

    // Auto-preload everything for instant, zero-lag frame switching
    const autoPreloadComplete = async () => {
      console.log(`[ProjectContext] 🚀 Auto-preloading all models for zero-lag playback...`);
      try {
        // Step 1: Preload URLs (fast - just creates blob URLs)
        console.log(`[ProjectContext] 📦 Step 1/2: Preloading URLs...`);
        const urlCount = await preloadAllModelURLs();
        console.log(`[ProjectContext] ✅ Step 1 complete: ${urlCount} URLs cached`);
        
        // Step 2: Preload Three.js models (slower - parses GLB files)
        console.log(`[ProjectContext] 🎮 Step 2/2: Preloading Three.js models...`);
        const threeJSCount = await preloadAllThreeJSModels();
        console.log(`[ProjectContext] ✅ Step 2 complete: ${threeJSCount} models parsed`);
        
        console.log(`[ProjectContext] 🎯 ZERO-LAG PRELOAD COMPLETE! All frames will load instantly.`);
      } catch (error) {
        console.error(`[ProjectContext] ❌ Auto-preload failed:`, error);
      }
    };

    // Small delay to allow UI to render first
    const timeoutId = setTimeout(autoPreloadComplete, 500);

    return () => clearTimeout(timeoutId);
  }, [reconstructionCacheReady, isPreloading, isThreeJSPreloading, projectId, reconstructionMetadata, preloadAllModelURLs, preloadAllThreeJSModels]);

  // 5. Optimized final loading state management - set to done when all components are ready or there's an error
  useEffect(() => {
    // Set to done when:
    // 1. There's an error (project not found, etc.)
    // 2. OR we have project data, masks are fetched, tar cache is ready (or has error)
    // 3. AND if reconstructions exist, reconstruction cache should be ready or have error
    const reconstructionCondition = hasReconstructions 
      ? (reconstructionCacheReady || reconstructionCacheError)
      : true; // If no reconstructions, don't wait for cache

    if (error || (projectData && maskFetchDone && (tarCacheReady || tarCacheError) && reconstructionCondition && loading !== "done")) {
      console.log(`[ProjectContext] 🎉 All loading complete - setting stage to "done"`);
      console.log(`[ProjectContext] 📊 Final status:`, {
        projectData: !!projectData,
        maskFetchDone,
        tarCacheReady,
        hasReconstructions,
        reconstructionCacheReady: hasReconstructions ? reconstructionCacheReady : 'N/A',
        error: error || 'none'
      });
      setLoading("done");
    }
  }, [error, projectData, maskFetchDone, tarCacheReady, tarCacheError, hasReconstructions, reconstructionCacheReady, reconstructionCacheError, loading]);

  // Cache invalidation function to refresh masks from backend
  const refreshMasks = useCallback(async () => {
    if (!projectId || !projectData?.dimensions) {
      console.warn("[ProjectContext] Cannot refresh masks - missing projectId or dimensions");
      return;
    }

    console.log("[ProjectContext] Refreshing masks from backend...");
    
    try {
      // Clear current mask cache
      setUndecodedMasks(null);
      setDecodedMasks(null);
      setSegmentationError(null);
      setHasMasks(false);

      // Fetch fresh masks from backend
      const response = await segmentationApi.getSegmentationResults(projectId);
      
      console.log("[ProjectContext] Fresh masks response:", response);

      if (!response.success) {
        setHasMasks(false);
        setSegmentationError(response.message);
        console.warn("[ProjectContext] No masks found after refresh:", response.message);
        return;
      }

      // Set fresh undecoded masks
      setUndecodedMasks(response.segmentations);
      const hasAnyMasks = Array.isArray(response.segmentations) && response.segmentations.length > 0;
      setHasMasks(hasAnyMasks);
      
      // Decode the fresh masks
      if (projectData.dimensions.width && projectData.dimensions.height) {
        console.log("[ProjectContext] Decoding fresh masks with dimensions:", projectData.dimensions);
        const decodedResult = decodeSegmentationMasks(
          response.segmentations, 
          projectData.dimensions.width, 
          projectData.dimensions.height
        );
        setDecodedMasks(decodedResult.masks);
        console.log("[ProjectContext] Successfully refreshed and decoded masks:", Object.keys(decodedResult.masks));
      }
    } catch (error) {
      console.error("[ProjectContext] Error refreshing masks:", error);
      setSegmentationError("Failed to refresh segmentation masks");
    }
  }, [projectId, projectData?.dimensions]);

  // Refresh jobs function - manually refetch jobs from backend
  const refreshJobs = useCallback(async () => {
    if (!projectId) {
      console.warn("[ProjectContext] Cannot refresh jobs - missing projectId");
      return;
    }

    console.log("[ProjectContext] Manually refreshing segmentation jobs...");
    
    // Reset the fetch flag to allow refetching
    jobsFetchedRef.current = false;
    
    try {
      const response = await segmentationApi.getUserJobs();
      
      if (!response.success) {
        setJobsError(response.message);
        console.warn("[ProjectContext] Failed to refresh jobs:", response.message);
        setJobs(null);
        return;
      }

      const projectJobs = response.jobs.filter((job: ProjectTypes.UserJob) => job.projectId === projectId);
      setJobs(projectJobs);
      console.log(`[ProjectContext] Refreshed jobs - found ${projectJobs.length} for project ${projectId}`);
      
      // Mark as fetched
      jobsFetchedRef.current = true;
    } catch (error) {
      console.error("[ProjectContext] Error refreshing jobs:", error);
      setJobsError("Failed to refresh job data");
      setJobs(null);
    }
  }, [projectId]);

  // Refresh reconstruction jobs function - manually refetch reconstruction jobs from backend
  const refreshReconstructionJobs = useCallback(async () => {
    if (!projectId) {
      console.warn("[ProjectContext] Cannot refresh reconstruction jobs - missing projectId");
      return;
    }

    console.log("[ProjectContext] Manually refreshing reconstruction jobs...");
    
    // Reset the fetch flag to allow refetching
    reconstructionJobsFetchedRef.current = false;
    
    try {
      const response = await reconstructionApi.getUserReconstructionJobs();
      
      if (!response.success) {
        setReconstructionJobsError(response.message || "Failed to refresh reconstruction jobs");
        console.warn("[ProjectContext] Failed to refresh reconstruction jobs:", response.message);
        setReconstructionJobs(null);
        return;
      }

      const projectJobs = response.jobs.filter((job: ProjectTypes.UserJob) => job.projectId === projectId);
      setReconstructionJobs(projectJobs);
      console.log(`[ProjectContext] Refreshed reconstruction jobs - found ${projectJobs.length} for project ${projectId}`);
      
      // Mark as fetched
      reconstructionJobsFetchedRef.current = true;
    } catch (error) {
      console.error("[ProjectContext] Error refreshing reconstruction jobs:", error);
      setReconstructionJobsError("Failed to refresh reconstruction job data");
      setReconstructionJobs(null);
    }
  }, [projectId]);

  // Optimistic update function - updates context masks directly without backend fetch
  const updateContextMasks = useCallback((newMasks: Record<string, Uint8Array>) => {
    console.log("[ProjectContext] Optimistic update - updating context masks directly:", Object.keys(newMasks));
    setDecodedMasks(newMasks);
    setHasMasks(Object.keys(newMasks).length > 0);
    setSegmentationError(null); // Clear any existing errors
  }, []);

  // Memoized context value to prevent unnecessary re-renders
  const contextValue: ProjectContextType = useMemo(
    () => ({
      loading,
      projectData,
      hasMasks,
      undecodedMasks,
      decodedMasks,
      jobs,
      reconstructionJobs,
      error,
      segmentationError,
      jobsError,
      reconstructionJobsError,
      maskFetchDone,
      // NEW: Tar cache properties and methods (MRI images)
      tarCacheReady,
      tarCacheError,
      getMRIImage,
      preloadMRIImages,
      getMRIImageFilename,
      getAvailableFramesAndSlices,
      fetchAndExtractProjectImages,
      clearProjectCache,
      // NEW: Reconstruction cache properties and methods (4D GLB models)
      hasReconstructions,
      reconstructionMetadata,
      reconstructionCacheReady,
      reconstructionCacheError,
      getReconstructionGLB,
      preloadReconstructionModels,
      fetchAndExtractProjectModels,
      clearReconstructionCache,
      refreshReconstructions,
      // NEW: URL Preloading for smooth playback
      preloadAllModelURLs,
      isPreloading,
      preloadProgress,
      isFullyPreloaded,
      // NEW: Three.js Aggressive Preloading
      preloadAllThreeJSModels,
      isThreeJSPreloading,
      threeJSPreloadProgress,
      // Cache invalidation
      refreshMasks,
      refreshJobs,
      refreshReconstructionJobs,
      updateContextMasks,
    }),
    [
      loading,
      projectData,
      hasMasks,
      undecodedMasks,
      decodedMasks,
      jobs,
      reconstructionJobs,
      error,
      segmentationError,
      jobsError,
      reconstructionJobsError,
      maskFetchDone,
      tarCacheReady,
      tarCacheError,
      getMRIImage,
      preloadMRIImages,
      getMRIImageFilename,
      getAvailableFramesAndSlices,
      fetchAndExtractProjectImages,
      clearProjectCache,
      hasReconstructions,
      reconstructionMetadata,
      reconstructionCacheReady,
      reconstructionCacheError,
      getReconstructionGLB,
      preloadReconstructionModels,
      fetchAndExtractProjectModels,
      clearReconstructionCache,
      refreshReconstructions,
      preloadAllModelURLs,
      isPreloading,
      preloadProgress,
      isFullyPreloaded,
      preloadAllThreeJSModels,
      isThreeJSPreloading,
      threeJSPreloadProgress,
      refreshMasks,
      refreshJobs,
      refreshReconstructionJobs,
      updateContextMasks,
    ],
  );

  return <ProjectContext.Provider value={contextValue}>{children}</ProjectContext.Provider>;
}
