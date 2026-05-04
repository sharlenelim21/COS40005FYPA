/**
 * Reconstruction Model Cache System
 * 
 * A comprehensive caching system for managing 4D cardiac reconstruction GLB models extracted from tar files.
 * This module handles the complete workflow from tar file fetching to model storage
 * and retrieval with performance optimization through URL caching and IndexedDB persistence.
 * 
 * Core Features:
 * - Fetches tar files containing GLB models from presigned URLs
 * - Extracts GLB binary files using js-untar library
 * - Stores models persistently in IndexedDB
 * - Manages object URLs with memory-efficient caching
 * - Parses filename patterns: frame_N.glb (where N is the frame index)
 * - Provides debug information and error handling
 * 
 * Performance Optimizations:
 * - URL cache prevents duplicate object URL creation for same blob
 * - Batch operations for efficient IndexedDB transactions
 * - Lazy loading with on-demand model URL generation
 * - Memory management with proper URL cleanup
 * 
 * Architecture:
 * - ReconstructionCacheDB: IndexedDB wrapper for persistent storage
 * - ReconstructionCache: Main cache management class with URL handling
 * - Helper functions: Filename parsing and frame extraction
 * 
 * Usage:
 * 1. Initialize with reconstructionCache.init()
 * 2. Fetch and extract with fetchAndExtractProjectModels()
 * 3. Retrieve models with getModelURL()
 * 4. Clean up with clearProjectModels()
 */

// Type definitions for js-untar
interface UntarFile {
  name: string;
  buffer: ArrayBuffer;
}

/**
 * Reconstruction Model Cache System with IndexedDB
 * Handles fetching, extracting, and caching 4D GLB models from tar files
 */

// Core interfaces for type safety and data structure definition

// Represents a single cached GLB model entry in IndexedDB
export interface ModelCacheEntry {
  id: string; // Unique identifier: projectId_reconstructionId_frameIndex
  blob: Blob; // Binary GLB model data stored as blob
  filename: string; // Original filename from tar file
  frameIndex: number; // Extracted frame number from filename
  timestamp: number; // Cache timestamp for cleanup operations
  projectId: string; // Project identifier for organization
  reconstructionId: string; // Reconstruction ID for tracking which 4D model this belongs to
}

// Result object for tar extraction operations
export interface TarExtractionResult {
  success: boolean; // Overall operation success status
  totalModels: number; // Total GLB models found in tar file
  extractedModels: number; // Successfully extracted and cached models
  errors: string[]; // Array of error messages encountered
  cacheSize: number; // Total cached models after operation
}

// Debug information for troubleshooting tar fetch operations
export interface TarFetchDebugInfo {
  presignedUrlFetched: boolean; // Whether presigned URL was successfully obtained
  presignedUrl: string | null; // The presigned URL or null if failed
  presignedUrlExpiry: number | null; // URL expiry timestamp if available
  tarFileFetched: boolean; // Whether tar file was successfully downloaded
  tarFileSize: number; // Size of downloaded tar file in bytes
  extractionStarted: boolean; // Whether tar extraction process began
  extractionCompleted: boolean; // Whether extraction finished successfully
  totalModelsFound: number; // Total GLB models found in tar file
  modelsStored: number; // Number of models successfully stored in cache
  cacheErrors: string[]; // Errors encountered during caching process
  processingTime: number; // Total processing time in milliseconds
}

/**
 * IndexedDB wrapper class for persistent model storage
 * Handles all database operations including initialization, CRUD operations, and cleanup
 */
class ReconstructionCacheDB {
  private db: IDBDatabase | null = null; // IndexedDB database instance
  private dbName = 'visheart-reconstruction-cache'; // Database name for identification
  private version = 1; // Database schema version
  private storeName = 'models'; // Object store name for GLB models

  /**
   * Initialize IndexedDB database with proper error handling
   * Creates object store with indexes for efficient querying
   */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if IndexedDB is supported in current browser
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is not supported in this browser'));
        return;
      }

      console.log(`[ReconstructionCacheDB] Opening IndexedDB database: ${this.dbName} v${this.version}`);
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = (event) => {
        const error = (event.target as IDBOpenDBRequest).error;
        console.error('[ReconstructionCacheDB] Failed to open IndexedDB:', error);
        reject(new Error(`Failed to open IndexedDB: ${error?.message || 'Unknown error'}`));
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        console.log('[ReconstructionCacheDB] IndexedDB opened successfully');

        // Add error handler for database operations
        this.db.onerror = (event) => {
          console.error('[ReconstructionCacheDB] Database error:', event);
        };

        resolve();
      };

      // Handle database schema upgrades and initial creation
      request.onupgradeneeded = (event) => {
        console.log('[ReconstructionCacheDB] Upgrading IndexedDB schema');
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          console.log(`[ReconstructionCacheDB] Creating object store: ${this.storeName}`);
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });

          // Create indexes for efficient querying by different criteria
          store.createIndex('projectId', 'projectId', { unique: false }); // Query by project
          store.createIndex('reconstructionId', 'reconstructionId', { unique: false }); // Query by reconstruction
          store.createIndex('frameIndex', 'frameIndex', { unique: false }); // Query by frame
          store.createIndex('timestamp', 'timestamp', { unique: false }); // Query by time (for cleanup)
          console.log('[ReconstructionCacheDB] Object store and indexes created');
        }
      };

      // Handle blocked database upgrades (multiple tabs open)
      request.onblocked = () => {
        console.warn('[ReconstructionCacheDB] IndexedDB upgrade blocked - close other tabs');
        reject(new Error('IndexedDB upgrade blocked. Please close other tabs with this application.'));
      };
    });
  }

  async storeModel(entry: ModelCacheEntry): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const request = store.put(entry);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to store model'));
    });
  }

  async getModel(id: string): Promise<ModelCacheEntry | null> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);

      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('Failed to get model'));
    });
  }

  async getModelsByProject(projectId: string): Promise<ModelCacheEntry[]> {
    if (!this.db) {
      console.error('[ReconstructionCacheDB] Database not initialized when getting models by project');
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('projectId');

      const request = index.getAll(projectId);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(new Error('Failed to get models by project'));
    });
  }

  async getModelsByReconstruction(reconstructionId: string): Promise<ModelCacheEntry[]> {
    if (!this.db) {
      console.error('[ReconstructionCacheDB] Database not initialized when getting models by reconstruction');
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('reconstructionId');

      const request = index.getAll(reconstructionId);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(new Error('Failed to get models by reconstruction'));
    });
  }

  async clearProject(projectId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const models = await this.getModelsByProject(projectId);

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      let deleted = 0;
      const total = models.length;

      if (total === 0) {
        resolve();
        return;
      }

      models.forEach(model => {
        const deleteRequest = store.delete(model.id);
        deleteRequest.onsuccess = () => {
          deleted++;
          if (deleted === total) resolve();
        };
        deleteRequest.onerror = () => reject(new Error('Failed to delete model'));
      });
    });
  }

  async clearReconstruction(reconstructionId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const models = await this.getModelsByReconstruction(reconstructionId);

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      let deleted = 0;
      const total = models.length;

      if (total === 0) {
        resolve();
        return;
      }

      models.forEach(model => {
        const deleteRequest = store.delete(model.id);
        deleteRequest.onsuccess = () => {
          deleted++;
          if (deleted === total) resolve();
        };
        deleteRequest.onerror = () => reject(new Error('Failed to delete model'));
      });
    });
  }

  async getCacheSize(): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);

      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Failed to get cache size'));
    });
  }
}

// Utility functions for filename parsing

/**
 * Extract frame index from GLB filename
 * Supports various filename conventions for 4D reconstruction models
 * 
 * Patterns supported:
 * - frame_0.glb, frame_1.glb, ... (standard format)
 * - 0.glb, 1.glb, ... (numeric only)
 * - model_frame_0.glb (prefixed format)
 * - f0.glb, f1.glb (abbreviated format)
 * 
 * @param filename - The filename to parse (e.g., "frame_5.glb")
 * @returns Frame number, or -1 if parsing fails
 */
function extractFrameFromFilename(filename: string): number {
  // Remove file extension
  const nameWithoutExt = filename.replace(/\.glb$/i, '');

  // Multiple regex patterns to handle various filename conventions
  const patterns = [
    /frame[_\s-]*(\d+)/i,  // frame_0, frame-0, frame 0
    /^(\d+)$/,             // 0, 1, 2 (numeric only)
    /f[_\s-]*(\d+)/i,      // f_0, f-0, f0
    /_(\d+)$/,             // prefix_0 (extract trailing number)
  ];

  // Try each pattern until one matches
  for (const pattern of patterns) {
    const match = nameWithoutExt.match(pattern);
    if (match && match[1]) {
      return parseInt(match[1], 10);
    }
  }

  // Fallback: try to extract any number from filename
  const numbers = nameWithoutExt.match(/\d+/);
  if (numbers) {
    return parseInt(numbers[0], 10);
  }

  // Last resort: return -1 to indicate parsing failure
  console.warn(`[ReconstructionCache] Could not extract frame index from filename: ${filename}`);
  return -1;
}

/**
 * Main cache management class with URL optimization and debug capabilities
 * Coordinates between IndexedDB storage and in-memory URL caching for optimal performance
 */
export class ReconstructionCache {
  private db: ReconstructionCacheDB; // IndexedDB wrapper instance
  private isInitialized: boolean = false; // Tracks initialization status
  private urlCache: Map<string, string> = new Map(); // In-memory cache to prevent duplicate object URLs
  private debugInfo: TarFetchDebugInfo = { // Debug information for troubleshooting
    presignedUrlFetched: false,
    presignedUrl: null,
    presignedUrlExpiry: null,
    tarFileFetched: false,
    tarFileSize: 0,
    extractionStarted: false,
    extractionCompleted: false,
    totalModelsFound: 0,
    modelsStored: 0,
    cacheErrors: [],
    processingTime: 0,
  };

  constructor() {
    this.db = new ReconstructionCacheDB();
    this.resetDebugInfo();
  }

  // Reset debug information for fresh operation tracking
  private resetDebugInfo(): void {
    this.debugInfo = {
      presignedUrlFetched: false,
      presignedUrl: null,
      presignedUrlExpiry: null,
      tarFileFetched: false,
      tarFileSize: 0,
      extractionStarted: false,
      extractionCompleted: false,
      totalModelsFound: 0,
      modelsStored: 0,
      cacheErrors: [],
      processingTime: 0,
    };
  }

  /**
   * Initialize the cache system - must be called before any operations
   * Sets up IndexedDB connection and validates browser support
   */
  async init(): Promise<void> {
    if (this.isInitialized) {
      console.log('[ReconstructionCache] Already initialized');
      return;
    }

    try {
      await this.db.init();
      this.isInitialized = true;
      console.log('[ReconstructionCache] Initialization complete');
    } catch (error) {
      this.isInitialized = false;
      console.error('[ReconstructionCache] Initialization failed:', error);
      throw error;
    }
  }

  // Validation helper to ensure cache is initialized before operations
  private checkInitialization(): void {
    if (!this.isInitialized) {
      throw new Error('ReconstructionCache not initialized. Call init() first.');
    }
  }

  // Get current debug information for troubleshooting
  getDebugInfo(): TarFetchDebugInfo {
    return { ...this.debugInfo };
  }

  /**
   * Main method to fetch and extract all GLB models from a tar file
   * This is the core functionality that handles the entire workflow:
   * 
   * Process:
   * 1. Get presigned URL for tar file from server
   * 2. Download tar file using presigned URL
   * 3. Extract all GLB models using js-untar
   * 4. Parse filenames to get frame indices
   * 5. Store models in IndexedDB for persistent caching
   * 6. Update debug information and return results
   * 
   * @param projectId - Project identifier 
   * @param reconstructionId - Reconstruction ID for tracking
   * @param getPresignedUrl - Function to fetch presigned URL from server
   * @returns Promise with extraction results including success status and statistics
   */
  async fetchAndExtractProjectModels(
    projectId: string,
    reconstructionId: string,
    getPresignedUrl: (projectId: string, reconstructionId: string) => Promise<{ success: boolean; presignedUrl?: string; expiresAt?: number; message?: string }>
  ): Promise<TarExtractionResult> {
    this.checkInitialization();

    // Start performance tracking
    const startTime = performance.now();
    this.resetDebugInfo();

    try {
      // Step 1: Get presigned URL from server API
      console.log(`[ReconstructionCache] Fetching presigned URL for project ${projectId}, reconstruction ${reconstructionId}`);
      const presignedResponse = await getPresignedUrl(projectId, reconstructionId);

      if (!presignedResponse.success || !presignedResponse.presignedUrl) {
        this.debugInfo.cacheErrors.push(`Failed to get presigned URL: ${presignedResponse.message || 'Unknown error'}`);
        return {
          success: false,
          totalModels: 0,
          extractedModels: 0,
          errors: this.debugInfo.cacheErrors,
          cacheSize: await this.db.getCacheSize(),
        };
      }

      this.debugInfo.presignedUrlFetched = true;
      this.debugInfo.presignedUrl = presignedResponse.presignedUrl;
      this.debugInfo.presignedUrlExpiry = presignedResponse.expiresAt || null;

      // Step 2: Fetch tar file
      console.log(`[ReconstructionCache] 🌐 Fetching tar file from presigned URL...`);
      console.log(`[ReconstructionCache] 🔗 URL: ${presignedResponse.presignedUrl.substring(0, 100)}...`);
      
      const downloadStartTime = performance.now();
      let tarResponse;
      
      try {
        tarResponse = await fetch(presignedResponse.presignedUrl);
      } catch (fetchError) {
        const errorMsg = fetchError instanceof Error ? fetchError.message : 'Unknown fetch error';
        console.error(`[ReconstructionCache] ❌ Network error fetching tar file:`, fetchError);
        this.debugInfo.cacheErrors.push(`Network error: ${errorMsg}`);
        return {
          success: false,
          totalModels: 0,
          extractedModels: 0,
          errors: this.debugInfo.cacheErrors,
          cacheSize: await this.db.getCacheSize(),
        };
      }

      if (!tarResponse.ok) {
        const errorText = await tarResponse.text().catch(() => 'Could not read response body');
        console.error(`[ReconstructionCache] ❌ Failed to fetch tar file: ${tarResponse.status} ${tarResponse.statusText}`);
        console.error(`[ReconstructionCache] 📄 Response body:`, errorText.substring(0, 500));
        this.debugInfo.cacheErrors.push(`Failed to fetch tar file: ${tarResponse.status} ${tarResponse.statusText} - ${errorText.substring(0, 200)}`);
        return {
          success: false,
          totalModels: 0,
          extractedModels: 0,
          errors: this.debugInfo.cacheErrors,
          cacheSize: await this.db.getCacheSize(),
        };
      }

      const tarBlob = await tarResponse.blob();
      const downloadTime = ((performance.now() - downloadStartTime) / 1000).toFixed(2);
      
      this.debugInfo.tarFileFetched = true;
      this.debugInfo.tarFileSize = tarBlob.size;
      
      console.log(`[ReconstructionCache] ✅ TAR file downloaded successfully`);
      console.log(`[ReconstructionCache] 📦 File size: ${(tarBlob.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`[ReconstructionCache] ⚡ Download time: ${downloadTime}s`);
      console.log(`[ReconstructionCache] 📊 Download speed: ${((tarBlob.size / 1024 / 1024) / parseFloat(downloadTime)).toFixed(2)} MB/s`);

      // Step 3: Extract and store models
      console.log(`[ReconstructionCache] 📂 Starting TAR extraction and model caching...`);
      const extractionResult = await this.extractAndStoreModels(projectId, reconstructionId, tarBlob);

      this.debugInfo.processingTime = performance.now() - startTime;
      const totalTime = (this.debugInfo.processingTime / 1000).toFixed(2);
      console.log(`[ReconstructionCache] ⏱️ Total processing time: ${totalTime}s (download: ${downloadTime}s, extraction: ${(parseFloat(totalTime) - parseFloat(downloadTime)).toFixed(2)}s)`);

      return extractionResult;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.debugInfo.cacheErrors.push(`Extraction failed: ${errorMessage}`);
      this.debugInfo.processingTime = performance.now() - startTime;

      return {
        success: false,
        totalModels: 0,
        extractedModels: 0,
        errors: this.debugInfo.cacheErrors,
        cacheSize: await this.db.getCacheSize(),
      };
    }
  }

  private async extractAndStoreModels(projectId: string, reconstructionId: string, tarBlob: Blob): Promise<TarExtractionResult> {
    this.debugInfo.extractionStarted = true;
    const extractionStartTime = performance.now();

    try {
      // Clear existing models for this reconstruction
      console.log(`[ReconstructionCache] 🗑️ Clearing existing cached models for reconstruction ${reconstructionId}...`);
      await this.db.clearReconstruction(reconstructionId);
      console.log(`[ReconstructionCache] ✅ Cache cleared`);

      // Convert blob to array buffer for js-untar
      console.log(`[ReconstructionCache] 🔄 Converting blob to array buffer...`);
      console.log(`[ReconstructionCache] 📦 Blob size: ${(tarBlob.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`[ReconstructionCache] 📦 Blob type: ${tarBlob.type || 'unknown'}`);
      
      let arrayBuffer;
      try {
        arrayBuffer = await tarBlob.arrayBuffer();
        console.log(`[ReconstructionCache] ✅ Array buffer ready: ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
      } catch (conversionError) {
        const errorMsg = conversionError instanceof Error ? conversionError.message : 'Unknown conversion error';
        console.error(`[ReconstructionCache] ❌ Failed to convert blob to array buffer:`, conversionError);
        throw new Error(`Blob conversion failed: ${errorMsg}`);
      }

      // Dynamic import of js-untar v2.0.0
      console.log(`[ReconstructionCache] 📚 Loading js-untar library...`);
      const untarModule = await import('js-untar');

      // js-untar v2.0.0 exports untar as the default export
      const untar = untarModule.default || untarModule.untar || untarModule;

      if (typeof untar !== 'function') {
        throw new Error(`js-untar did not export a function. Got: ${typeof untar}. Available exports: ${Object.keys(untarModule).join(', ')}`);
      }
      console.log(`[ReconstructionCache] ✅ js-untar loaded successfully`);

      console.log(`[ReconstructionCache] 📦 Extracting TAR archive...`);
      const untarStartTime = performance.now();
      
      let files;
      try {
        files = await untar(arrayBuffer);
        const untarTime = ((performance.now() - untarStartTime) / 1000).toFixed(2);
        console.log(`[ReconstructionCache] ✅ TAR extraction complete in ${untarTime}s`);
      } catch (untarError) {
        const errorMsg = untarError instanceof Error ? untarError.message : 'Unknown untar error';
        console.error(`[ReconstructionCache] ❌ Failed to extract TAR archive:`, untarError);
        console.error(`[ReconstructionCache] 💥 Untar error stack:`, untarError instanceof Error ? untarError.stack : 'No stack trace');
        throw new Error(`TAR extraction failed: ${errorMsg}`);
      }
      
      const untarTime = ((performance.now() - untarStartTime) / 1000).toFixed(2);
      console.log(`[ReconstructionCache] ✅ TAR extraction complete in ${untarTime}s`);
      console.log(`[ReconstructionCache] 📋 Extracted ${files.length} total files from archive`);

      // Filter GLB model files
      console.log(`[ReconstructionCache] 🔍 Filtering for model files (GLB/OBJ)...`);
      const modelFiles = files.filter((file: UntarFile) => {
        const filename = file.name.toLowerCase();
        return (filename.endsWith('.glb') || filename.endsWith('.obj')) && !filename.includes('__MACOSX');
      });

      this.debugInfo.totalModelsFound = modelFiles.length;
      console.log(`[ReconstructionCache] ✅ Found ${modelFiles.length} model files (GLB/OBJ)`);
      
      if (modelFiles.length > 0) {
        const filenames = modelFiles.map(f => f.name).slice(0, 5);
        console.log(`[ReconstructionCache] 📝 Sample files: ${filenames.join(', ')}${modelFiles.length > 5 ? '...' : ''}`);
      }

      let storedCount = 0;
      const errors: string[] = [];

      // Process each model file (GLB/OBJ)
      console.log(`[ReconstructionCache] 💾 Starting IndexedDB storage for ${modelFiles.length} models...`);
      const storageStartTime = performance.now();
      
      for (const file of modelFiles) {
        try {
          const frameIndex = extractFrameFromFilename(file.name);
          
          if (frameIndex === -1) {
            console.warn(`[ReconstructionCache] ⚠️ Failed to parse frame index from: ${file.name}`);
            errors.push(`Failed to extract frame index from filename: ${file.name}`);
            continue;
          }

          const modelId = `${projectId}_${reconstructionId}_f${frameIndex}`;
          const modelSizeMB = (file.buffer.byteLength / 1024 / 1024).toFixed(2);

          // Detect file type from extension and set appropriate MIME type
          const fileExtension = file.name.toLowerCase().split('.').pop();
          const mimeType = fileExtension === 'obj' ? 'text/plain' : 'model/gltf-binary';

          const blob = new Blob([file.buffer], {
            type: mimeType // MIME type based on file extension
          });

          const entry: ModelCacheEntry = {
            id: modelId,
            blob,
            filename: file.name,
            frameIndex,
            timestamp: Date.now(),
            projectId,
            reconstructionId,
          };

          await this.db.storeModel(entry);
          storedCount++;
          
          // Log progress for every 10 models or if it's the last one
          if (storedCount % 10 === 0 || storedCount === modelFiles.length) {
            console.log(`[ReconstructionCache] 💾 Cached ${storedCount}/${modelFiles.length} models (${file.name}: ${modelSizeMB} MB)`);
          }

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[ReconstructionCache] ❌ Failed to store ${file.name}:`, errorMessage);
          errors.push(`Failed to store ${file.name}: ${errorMessage}`);
        }
      }

      const storageTime = ((performance.now() - storageStartTime) / 1000).toFixed(2);
      const totalExtractionTime = ((performance.now() - extractionStartTime) / 1000).toFixed(2);

      this.debugInfo.modelsStored = storedCount;
      this.debugInfo.extractionCompleted = true;
      this.debugInfo.cacheErrors.push(...errors);

      const cacheSize = await this.db.getCacheSize();

      console.log(`[ReconstructionCache] ✅ Successfully cached ${storedCount}/${modelFiles.length} model files`);
      console.log(`[ReconstructionCache] ⚡ Storage time: ${storageTime}s`);
      console.log(`[ReconstructionCache] ⚡ Total extraction+storage time: ${totalExtractionTime}s`);
      console.log(`[ReconstructionCache] 📊 Total cache size: ${cacheSize} models across all projects`);

      if (errors.length > 0) {
        console.warn(`[ReconstructionCache] ⚠️ ${errors.length} errors occurred during extraction:`);
        errors.forEach((err, idx) => console.warn(`  ${idx + 1}. ${err}`));
      }

      return {
        success: storedCount > 0,
        totalModels: modelFiles.length,
        extractedModels: storedCount,
        errors,
        cacheSize,
      };

    } catch (error) {
      const totalExtractionTime = ((performance.now() - extractionStartTime) / 1000).toFixed(2);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[ReconstructionCache] ❌ Extraction failed after ${totalExtractionTime}s:`, error);
      console.error(`[ReconstructionCache] 💥 Error details:`, {
        message: errorMessage,
        projectId,
        reconstructionId,
        stack: error instanceof Error ? error.stack : undefined
      });
      this.debugInfo.cacheErrors.push(`Extraction error: ${errorMessage}`);

      return {
        success: false,
        totalModels: 0,
        extractedModels: 0,
        errors: [errorMessage],
        cacheSize: await this.db.getCacheSize(),
      };
    }
  }

  async getModelBlob(projectId: string, reconstructionId: string, frame: number): Promise<Blob | null> {
    this.checkInitialization();
    
    console.log(`[ReconstructionCache] 🔍 Looking up model blob (sequential frame ${frame}):`, {
      projectId,
      reconstructionId,
      frame
    });
    
    // Map sequential frame to actual stored frame index
    const actualFrame = await this.mapSequentialToActualFrame(reconstructionId, frame);
    
    if (actualFrame === -1) {
      console.warn(`[ReconstructionCache] ❌ No model found for sequential frame ${frame}`);
      return null;
    }
    
    console.log(`[ReconstructionCache] 🔄 Mapped sequential frame ${frame} → actual frame ${actualFrame}`);
    
    const modelId = `${projectId}_${reconstructionId}_f${actualFrame}`;
    const entry = await this.db.getModel(modelId);
    
    if (entry) {
      console.log(`[ReconstructionCache] ✅ Model blob found:`, {
        modelId,
        filename: entry.filename,
        blobSize: `${(entry.blob.size / 1024 / 1024).toFixed(2)} MB`,
        blobType: entry.blob.type,
        frameIndex: entry.frameIndex,
        cachedAt: new Date(entry.timestamp).toLocaleString()
      });
    } else {
      console.warn(`[ReconstructionCache] ❌ Model blob NOT found:`, {
        modelId,
        projectId,
        reconstructionId,
        frame
      });
      
      // Check what models are actually available
      const allModels = await this.db.getModelsByReconstruction(reconstructionId);
      console.log(`[ReconstructionCache] 📋 Available models for reconstruction ${reconstructionId}:`, {
        totalModels: allModels.length,
        modelIds: allModels.map(m => m.id),
        filenames: allModels.map(m => m.filename),
        frames: allModels.map(m => m.frameIndex).sort((a, b) => a - b)
      });
    }
    
    return entry?.blob || null;
  }

  /**
   * Map sequential frame number to actual stored frame index
   * 
   * The GPU server names files with original temporal frame indices (e.g., 0, 4, 9, 14, 19),
   * but the frontend uses sequential indices (0, 1, 2, 3, 4). This method maps between them.
   * 
   * @param reconstructionId - Reconstruction ID
   * @param sequentialFrame - Sequential frame number (0, 1, 2...)
   * @returns Actual stored frame index or -1 if not found
   */
  private async mapSequentialToActualFrame(reconstructionId: string, sequentialFrame: number): Promise<number> {
    // Get all models for this reconstruction
    const models = await this.db.getModelsByReconstruction(reconstructionId);
    
    if (models.length === 0) {
      return -1;
    }
    
    // Sort by frame index to establish sequential order
    models.sort((a, b) => a.frameIndex - b.frameIndex);
    
    // Check if sequential index is valid
    if (sequentialFrame < 0 || sequentialFrame >= models.length) {
      return -1;
    }
    
    // Return the actual frame index
    return models[sequentialFrame].frameIndex;
  }

  /**
   * Get the original filename for a specific frame's model
   * @param projectId - Project identifier
   * @param reconstructionId - Reconstruction ID
   * @param frame - Frame index (0-based sequential)
   * @returns Original filename from tar archive or null if not found
   */
  async getModelFilename(projectId: string, reconstructionId: string, frame: number): Promise<string | null> {
    this.checkInitialization();
    
    // Map sequential frame to actual stored frame
    const actualFrame = await this.mapSequentialToActualFrame(reconstructionId, frame);
    if (actualFrame === -1) {
      return null;
    }
    
    const modelId = `${projectId}_${reconstructionId}_f${actualFrame}`;
    const entry = await this.db.getModel(modelId);
    return entry?.filename || null;
  }

  /**
   * Get a blob URL for displaying a GLB model with URL caching optimization
   * This is the primary method for retrieving models for display in Three.js viewers
   * 
   * Performance optimization: URLs are cached in memory to prevent creating
   * duplicate object URLs for the same blob, which improves memory efficiency
   * and prevents errors when the same model is accessed multiple times
   * 
   * @param projectId - Project identifier
   * @param reconstructionId - Reconstruction ID
   * @param frame - Sequential frame number (0, 1, 2...)
   * @returns Promise resolving to blob URL string or null if not found
   */
  async getModelURL(projectId: string, reconstructionId: string, frame: number): Promise<string | null> {
    this.checkInitialization();

    console.log(`[ReconstructionCache] 🎯 getModelURL called (sequential frame ${frame}):`, {
      projectId,
      reconstructionId,
      frame
    });

    // Map sequential frame to actual stored frame index
    const actualFrame = await this.mapSequentialToActualFrame(reconstructionId, frame);
    
    if (actualFrame === -1) {
      console.warn(`[ReconstructionCache] ❌ No model found for sequential frame ${frame}`);
      
      // Show available frames for debugging
      const allModels = await this.db.getModelsByReconstruction(reconstructionId);
      const sortedModels = allModels.sort((a, b) => a.frameIndex - b.frameIndex);
      console.log(`[ReconstructionCache] 📋 Available frames:`, {
        totalModels: sortedModels.length,
        sequentialIndices: Array.from({ length: sortedModels.length }, (_, i) => i),
        actualFrameIndices: sortedModels.map(m => m.frameIndex),
        filenames: sortedModels.map(m => m.filename)
      });
      
      return null;
    }

    console.log(`[ReconstructionCache] 🔄 Mapped sequential frame ${frame} → actual frame ${actualFrame}`);
    
    const modelId = `${projectId}_${reconstructionId}_f${actualFrame}`;
    
    console.log(`[ReconstructionCache] 🆔 Model ID:`, modelId);

    // Check URL cache first to avoid creating duplicate URLs for same blob
    if (this.urlCache.has(modelId)) {
      const cachedUrl = this.urlCache.get(modelId)!;
      console.log(`[ReconstructionCache] 💾 Using cached URL:`, {
        modelId,
        url: cachedUrl.substring(0, 50) + '...'
      });
      return cachedUrl;
    }

    console.log(`[ReconstructionCache] 📥 URL not cached, fetching blob from IndexedDB...`);

    // Retrieve blob from IndexedDB and create object URL
    const blob = await this.getModelBlob(projectId, reconstructionId, frame);
    if (blob) {
      console.log(`[ReconstructionCache] 🔗 Creating object URL for blob:`, {
        modelId,
        blobSize: `${(blob.size / 1024 / 1024).toFixed(2)} MB`,
        blobType: blob.type
      });
      
      const url = URL.createObjectURL(blob);
      this.urlCache.set(modelId, url); // Cache URL to prevent duplicates
      
      console.log(`[ReconstructionCache] ✅ Object URL created and cached:`, {
        modelId,
        url: url.substring(0, 50) + '...',
        totalCachedUrls: this.urlCache.size
      });
      
      return url;
    }

    console.error(`[ReconstructionCache] ❌ Failed to get model URL - blob not found:`, {
      modelId,
      projectId,
      reconstructionId,
      frame
    });

    return null; // Model not found in cache
  }

  /**
   * Get all available frames for a specific reconstruction
   * Used to populate navigation controls and determine dataset bounds
   */
  /**
   * Get available frame indices (sequential 0-based)
   * Returns sequential indices that can be used to load models
   * 
   * @param reconstructionId - Reconstruction ID
   * @returns Array of sequential frame indices (e.g., [0, 1, 2, 3, 4])
   */
  async getAvailableFrames(reconstructionId: string): Promise<number[]> {
    this.checkInitialization();
    const models = await this.db.getModelsByReconstruction(reconstructionId);
    
    // Sort by actual frame index to establish order
    models.sort((a, b) => a.frameIndex - b.frameIndex);
    
    // Return sequential indices
    return Array.from({ length: models.length }, (_, i) => i);
  }

  /**
   * Get debug information about frame mapping
   * Useful for understanding the relationship between sequential and actual frame indices
   * 
   * @param reconstructionId - Reconstruction ID
   * @returns Mapping information for debugging
   */
  async getFrameMappingInfo(reconstructionId: string): Promise<{
    totalFrames: number;
    sequentialIndices: number[];
    actualFrameIndices: number[];
    filenames: string[];
  }> {
    this.checkInitialization();
    const models = await this.db.getModelsByReconstruction(reconstructionId);
    
    // Sort by actual frame index
    models.sort((a, b) => a.frameIndex - b.frameIndex);
    
    return {
      totalFrames: models.length,
      sequentialIndices: Array.from({ length: models.length }, (_, i) => i),
      actualFrameIndices: models.map(m => m.frameIndex),
      filenames: models.map(m => m.filename)
    };
  }

  /**
   * Clear all cached models and URLs for a specific project
   * Essential for memory management and preventing URL leaks
   * 
   * Process:
   * 1. Find all cached URLs for the project
   * 2. Revoke object URLs to free memory
   * 3. Remove entries from in-memory URL cache
   * 4. Delete models from IndexedDB storage
   * 
   * @param projectId - Project identifier to clear
   */
  async clearProjectModels(projectId: string): Promise<void> {
    this.checkInitialization();

    // First pass: collect URLs that need to be revoked
    const urlsToRevoke: string[] = [];
    for (const [key, url] of this.urlCache.entries()) {
      if (key.startsWith(projectId)) {
        urlsToRevoke.push(url);
        this.urlCache.delete(key); // Remove from cache
      }
    }

    // Revoke object URLs to free browser memory
    urlsToRevoke.forEach(url => {
      URL.revokeObjectURL(url);
    });

    // Clear models from persistent IndexedDB storage
    await this.db.clearProject(projectId);
  }

  /**
   * Clear all cached models for a specific reconstruction
   * @param reconstructionId - Reconstruction ID to clear
   */
  async clearReconstructionModels(reconstructionId: string): Promise<void> {
    this.checkInitialization();

    // First pass: collect URLs that need to be revoked
    const urlsToRevoke: string[] = [];
    for (const [key, url] of this.urlCache.entries()) {
      if (key.includes(`_${reconstructionId}_`)) {
        urlsToRevoke.push(url);
        this.urlCache.delete(key); // Remove from cache
      }
    }

    // Revoke object URLs to free browser memory
    urlsToRevoke.forEach(url => {
      URL.revokeObjectURL(url);
    });

    // Clear models from persistent IndexedDB storage
    await this.db.clearReconstruction(reconstructionId);
  }

  /**
   * Get total number of cached models across all projects
   * Useful for monitoring cache size and storage usage
   */
  async getCacheSize(): Promise<number> {
    this.checkInitialization();
    return await this.db.getCacheSize();
  }

  /**
   * Preload all model URLs for a reconstruction into memory cache
   * 
   * This method loads all model blob URLs for a given reconstruction,
   * eliminating the IndexedDB lookup delay when switching frames.
   * 
   * Benefits:
   * - Eliminates ~100-300ms IndexedDB read delay per frame
   * - Creates smooth, stutterless frame navigation
   * - Lightweight - only creates Object URLs (small memory footprint)
   * 
   * @param projectId - Project identifier
   * @param reconstructionId - Reconstruction ID
   * @param onProgress - Optional callback for progress updates (current, total)
   * @returns Promise resolving to number of models preloaded
   */
  async preloadAllModelURLs(
    projectId: string,
    reconstructionId: string,
    onProgress?: (current: number, total: number) => void
  ): Promise<number> {
    this.checkInitialization();

    console.log(`[ReconstructionCache] 🚀 Starting URL preload for reconstruction ${reconstructionId}...`);
    const startTime = performance.now();

    // Get all models for this reconstruction
    const models = await this.db.getModelsByReconstruction(reconstructionId);
    const sortedModels = models.sort((a, b) => a.frameIndex - b.frameIndex);
    const totalFrames = sortedModels.length;

    if (totalFrames === 0) {
      console.warn(`[ReconstructionCache] ⚠️ No models found for reconstruction ${reconstructionId}`);
      return 0;
    }

    console.log(`[ReconstructionCache] 📊 Preloading ${totalFrames} model URLs...`);

    let preloadedCount = 0;

    // Iterate through all sequential frames and load URLs
    for (let frame = 0; frame < totalFrames; frame++) {
      try {
        const url = await this.getModelURL(projectId, reconstructionId, frame);
        if (url) {
          preloadedCount++;
          
          // Report progress
          if (onProgress) {
            onProgress(preloadedCount, totalFrames);
          }

          // Log progress every 10 frames
          if (preloadedCount % 10 === 0 || preloadedCount === totalFrames) {
            console.log(`[ReconstructionCache] 💾 Preloaded ${preloadedCount}/${totalFrames} URLs`);
          }
        }
      } catch (error) {
        console.error(`[ReconstructionCache] ❌ Failed to preload frame ${frame}:`, error);
      }
    }

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`[ReconstructionCache] ✅ Preloaded ${preloadedCount}/${totalFrames} model URLs in ${elapsed}s`);
    console.log(`[ReconstructionCache] 📈 URL Cache size: ${this.urlCache.size} entries`);

    return preloadedCount;
  }

  /**
   * Check if all models for a reconstruction have been preloaded
   * 
   * @param projectId - Project identifier
   * @param reconstructionId - Reconstruction ID
   * @returns True if all models are cached in memory
   */
  async isFullyPreloaded(projectId: string, reconstructionId: string): Promise<boolean> {
    this.checkInitialization();

    const models = await this.db.getModelsByReconstruction(reconstructionId);
    
    if (models.length === 0) {
      return false;
    }

    // Check if all models have cached URLs
    for (const model of models) {
      const modelId = `${projectId}_${reconstructionId}_f${model.frameIndex}`;
      if (!this.urlCache.has(modelId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get preload status information
   * 
   * @param projectId - Project identifier
   * @param reconstructionId - Reconstruction ID
   * @returns Preload status with loaded/total counts
   */
  async getPreloadStatus(projectId: string, reconstructionId: string): Promise<{
    totalModels: number;
    preloadedModels: number;
    isFullyPreloaded: boolean;
    preloadPercentage: number;
  }> {
    this.checkInitialization();

    const models = await this.db.getModelsByReconstruction(reconstructionId);
    const totalModels = models.length;
    
    if (totalModels === 0) {
      return {
        totalModels: 0,
        preloadedModels: 0,
        isFullyPreloaded: false,
        preloadPercentage: 0,
      };
    }

    // Count preloaded models
    let preloadedModels = 0;
    for (const model of models) {
      const modelId = `${projectId}_${reconstructionId}_f${model.frameIndex}`;
      if (this.urlCache.has(modelId)) {
        preloadedModels++;
      }
    }

    return {
      totalModels,
      preloadedModels,
      isFullyPreloaded: preloadedModels === totalModels,
      preloadPercentage: Math.round((preloadedModels / totalModels) * 100),
    };
  }

  /**
   * Get all model URLs for a reconstruction (for external Three.js preloading)
   * 
   * This method retrieves all blob URLs for a reconstruction, which can then be
   * used by Three.js loaders to preload and cache the parsed models.
   * 
   * @param projectId - Project identifier
   * @param reconstructionId - Reconstruction ID
   * @returns Array of { frame: number, url: string } objects
   */
  async getAllModelURLs(projectId: string, reconstructionId: string): Promise<Array<{ frame: number; url: string; filename: string }>> {
    this.checkInitialization();

    const models = await this.db.getModelsByReconstruction(reconstructionId);
    const sortedModels = models.sort((a, b) => a.frameIndex - b.frameIndex);
    
    const urls: Array<{ frame: number; url: string; filename: string }> = [];

    for (let i = 0; i < sortedModels.length; i++) {
      const url = await this.getModelURL(projectId, reconstructionId, i);
      if (url) {
        urls.push({
          frame: i,
          url,
          filename: sortedModels[i].filename
        });
      }
    }

    return urls;
  }
}

// Export singleton instance for global access
export const reconstructionCache = new ReconstructionCache();
