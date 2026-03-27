/**
 * Tar Image Cache System
 * 
 * A comprehensive caching system for managing MRI images extracted from tar files.
 * This module handles the complete workflow from tar file fetching to image storage
 * and retrieval with performance optimization through URL caching and IndexedDB persistence.
 * 
 * Core Features:
 * - Fetches tar files from presigned URLs
 * - Extracts JPEG images using js-untar library
 * - Stores images persistently in IndexedDB
 * - Manages object URLs with memory-efficient caching
 * - Parses filename patterns: projectid_filehash_frame_slice.jpg
 * - Provides debug information and error handling
 * 
 * Performance Optimizations:
 * - URL cache prevents duplicate object URL creation for same blob
 * - Batch operations for efficient IndexedDB transactions
 * - Lazy loading with on-demand image URL generation
 * - Memory management with proper URL cleanup
 * 
 * Architecture:
 * - TarImageCacheDB: IndexedDB wrapper for persistent storage
 * - TarImageCache: Main cache management class with URL handling
 * - Helper functions: Filename parsing and frame/slice extraction
 * 
 * Usage:
 * 1. Initialize with tarImageCache.init()
 * 2. Fetch and extract with fetchAndExtractProjectImages()
 * 3. Retrieve images with getImageURL()
 * 4. Clean up with clearProjectCache()
 */

// Type definitions for js-untar
interface UntarFile {
  name: string;
  buffer: ArrayBuffer;
}

/**
 * Tar Image Cache System with IndexedDB
 * Handles fetching, extracting, and caching MRI images from tar files
 */

// Install: npm install js-untar

// Core interfaces for type safety and data structure definition

// Represents a single cached image entry in IndexedDB
export interface ImageCacheEntry {
  id: string; // Unique identifier: projectId_frameIndex_sliceIndex
  blob: Blob; // Binary image data stored as blob
  filename: string; // Original filename from tar file
  frameIndex: number; // Extracted frame number from filename
  sliceIndex: number; // Extracted slice number from filename
  timestamp: number; // Cache timestamp for cleanup operations
  projectId: string; // Project identifier for organization
}

// Result object for tar extraction operations
export interface TarExtractionResult {
  success: boolean; // Overall operation success status
  totalImages: number; // Total images found in tar file
  extractedImages: number; // Successfully extracted and cached images
  errors: string[]; // Array of error messages encountered
  cacheSize: number; // Total cached images after operation
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
  totalImagesFound: number; // Total JPEG images found in tar file
  imagesStored: number; // Number of images successfully stored in cache
  cacheErrors: string[]; // Errors encountered during caching process
  processingTime: number; // Total processing time in milliseconds
}

/**
 * IndexedDB wrapper class for persistent image storage
 * Handles all database operations including initialization, CRUD operations, and cleanup
 */
class TarImageCacheDB {
  private db: IDBDatabase | null = null; // IndexedDB database instance
  private dbName = 'visheart-image-cache'; // Database name for identification
  private version = 1; // Database schema version
  private storeName = 'images'; // Object store name for images

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

      console.log(`[TarImageCacheDB] Opening IndexedDB database: ${this.dbName} v${this.version}`);
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = (event) => {
        const error = (event.target as IDBOpenDBRequest).error;
        console.error('[TarImageCacheDB] Failed to open IndexedDB:', error);
        reject(new Error(`Failed to open IndexedDB: ${error?.message || 'Unknown error'}`));
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        console.log('[TarImageCacheDB] IndexedDB opened successfully');

        // Add error handler for database operations
        this.db.onerror = (event) => {
          console.error('[TarImageCacheDB] Database error:', event);
        };

        resolve();
      };

      // Handle database schema upgrades and initial creation
      request.onupgradeneeded = (event) => {
        console.log('[TarImageCacheDB] Upgrading IndexedDB schema');
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          console.log(`[TarImageCacheDB] Creating object store: ${this.storeName}`);
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });

          // Create indexes for efficient querying by different criteria
          store.createIndex('projectId', 'projectId', { unique: false }); // Query by project
          store.createIndex('frameIndex', 'frameIndex', { unique: false }); // Query by frame
          store.createIndex('sliceIndex', 'sliceIndex', { unique: false }); // Query by slice
          store.createIndex('timestamp', 'timestamp', { unique: false }); // Query by time (for cleanup)
          console.log('[TarImageCacheDB] Object store and indexes created');
        }
      };

      // Handle blocked database upgrades (multiple tabs open)
      request.onblocked = () => {
        console.warn('[TarImageCacheDB] IndexedDB upgrade blocked - close other tabs');
        reject(new Error('IndexedDB upgrade blocked. Please close other tabs with this application.'));
      };
    });
  }

  async storeImage(entry: ImageCacheEntry): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const request = store.put(entry);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to store image'));
    });
  }

  async getImage(id: string): Promise<ImageCacheEntry | null> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);

      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error('Failed to get image'));
    });
  }

  async getImagesByProject(projectId: string): Promise<ImageCacheEntry[]> {
    if (!this.db) {
      console.error('[TarImageCacheDB] Database not initialized when getting images by project');
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('projectId');

      const request = index.getAll(projectId);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(new Error('Failed to get images by project'));
    });
  }

  async clearProject(projectId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const images = await this.getImagesByProject(projectId);

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      let deleted = 0;
      const total = images.length;

      if (total === 0) {
        resolve();
        return;
      }

      images.forEach(image => {
        const deleteRequest = store.delete(image.id);
        deleteRequest.onsuccess = () => {
          deleted++;
          if (deleted === total) resolve();
        };
        deleteRequest.onerror = () => reject(new Error('Failed to delete image'));
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
 * Extract frame and slice indices from filename using multiple pattern matching
 * Supports various medical imaging filename conventions including the project-specific pattern
 * 
 * Patterns supported:
 * - projectid_filehash_frame_slice.jpg (project-specific format)
 * - slice_001_frame_000.jpg (slice-first format)  
 * - frame_000_slice_001.dcm (frame-first format)
 * - img_f000_s001.png (abbreviated format)
 * - Various underscore-separated patterns
 * 
 * @param filename - The filename to parse (e.g., "project123_abc123_5_12.jpg")
 * @returns Object with frame and slice numbers, or defaults if parsing fails
 */
function extractIndicesFromFilename(filename: string): { frame: number; slice: number } {
  // Multiple regex patterns to handle various filename conventions
  const patterns = [
    // Project-specific pattern: projectid_filehash_frame_slice.jpg
    /^[^_]+_[^_]+_(\d+)_(\d+)\./i,

    // Standard medical imaging patterns
    /slice_(\d+)_frame_(\d+)/i,  // slice_001_frame_000
    /frame_(\d+)_slice_(\d+)/i,  // frame_000_slice_001
    /s(\d+)_f(\d+)/i,           // s001_f000
    /f(\d+)_s(\d+)/i,           // f000_s001
    /_s(\d+)_f(\d+)/i,          // prefix_s001_f000
    /_f(\d+)_s(\d+)/i,          // prefix_f000_s001
  ];

  // Try each pattern until one matches
  for (const pattern of patterns) {
    const match = filename.match(pattern);
    if (match) {
      // Handle different ordering based on pattern type
      if (pattern.source.includes('slice.*frame')) {
        // slice_frame pattern: first number is slice, second is frame
        return { slice: parseInt(match[1], 10), frame: parseInt(match[2], 10) };
      } else {
        // frame_slice pattern: first number is frame, second is slice
        return { frame: parseInt(match[1], 10), slice: parseInt(match[2], 10) };
      }
    }
  }

  // Fallback: try to extract any numbers from filename
  const numbers = filename.match(/\d+/g);
  if (numbers && numbers.length >= 2) {
    return { frame: parseInt(numbers[0], 10), slice: parseInt(numbers[1], 10) };
  }

  // Last resort: use filename hash as indices
  let hash = 0;
  for (let i = 0; i < filename.length; i++) {
    const char = filename.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }

  return { frame: Math.abs(hash) % 100, slice: Math.abs(hash >> 16) % 100 };
}

/**
 * Main cache management class with URL optimization and debug capabilities
 * Coordinates between IndexedDB storage and in-memory URL caching for optimal performance
 */
export class TarImageCache {
  private db: TarImageCacheDB; // IndexedDB wrapper instance
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
    totalImagesFound: 0,
    imagesStored: 0,
    cacheErrors: [],
    processingTime: 0,
  };

  constructor() {
    this.db = new TarImageCacheDB();
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
      totalImagesFound: 0,
      imagesStored: 0,
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
      console.log('[TarImageCache] Already initialized');
      return;
    }

    try {
      await this.db.init();
      this.isInitialized = true;
      console.log('[TarImageCache] Initialization complete');
    } catch (error) {
      this.isInitialized = false;
      console.error('[TarImageCache] Initialization failed:', error);
      throw error;
    }
  }

  // Validation helper to ensure cache is initialized before operations
  private checkInitialization(): void {
    if (!this.isInitialized) {
      throw new Error('TarImageCache not initialized. Call init() first.');
    }
  }

  // Get current debug information for troubleshooting
  getDebugInfo(): TarFetchDebugInfo {
    return { ...this.debugInfo };
  }

  /**
   * Main method to fetch and extract all images from a tar file
   * This is the core functionality that handles the entire workflow:
   * 
   * Process:
   * 1. Get presigned URL for tar file from server
   * 2. Download tar file using presigned URL
   * 3. Extract all JPEG images using js-untar
   * 4. Parse filenames to get frame/slice indices
   * 5. Store images in IndexedDB for persistent caching
   * 6. Update debug information and return results
   * 
   * @param projectId - Project identifier 
   * @param getPresignedUrl - Function to fetch presigned URL from server
   * @returns Promise with extraction results including success status and statistics
   */
  async fetchAndExtractProjectImages(
    projectId: string,
    getPresignedUrl: (projectId: string) => Promise<{ success: boolean; presignedUrl?: string; expiresAt?: number; message?: string }>
  ): Promise<TarExtractionResult> {
    this.checkInitialization();

    // Start performance tracking
    const startTime = performance.now();
    this.resetDebugInfo();

    try {
      // Step 1: Get presigned URL from server API
      console.log(`[TarImageCache] Fetching presigned URL for project ${projectId}`);
      const presignedResponse = await getPresignedUrl(projectId);

      if (!presignedResponse.success || !presignedResponse.presignedUrl) {
        this.debugInfo.cacheErrors.push(`Failed to get presigned URL: ${presignedResponse.message || 'Unknown error'}`);
        return {
          success: false,
          totalImages: 0,
          extractedImages: 0,
          errors: this.debugInfo.cacheErrors,
          cacheSize: await this.db.getCacheSize(),
        };
      }

      this.debugInfo.presignedUrlFetched = true;
      this.debugInfo.presignedUrl = presignedResponse.presignedUrl;
      this.debugInfo.presignedUrlExpiry = presignedResponse.expiresAt || null;

      // Step 2: Fetch tar file
      console.log(`[TarImageCache] Fetching tar file from presigned URL`);
      const tarResponse = await fetch(presignedResponse.presignedUrl);

      if (!tarResponse.ok) {
        this.debugInfo.cacheErrors.push(`Failed to fetch tar file: ${tarResponse.status} ${tarResponse.statusText}`);
        return {
          success: false,
          totalImages: 0,
          extractedImages: 0,
          errors: this.debugInfo.cacheErrors,
          cacheSize: await this.db.getCacheSize(),
        };
      }

      const tarBlob = await tarResponse.blob();
      this.debugInfo.tarFileFetched = true;
      this.debugInfo.tarFileSize = tarBlob.size;

      // Step 3: Extract and store images
      console.log(`[TarImageCache] Extracting tar file (${tarBlob.size} bytes)`);
      const extractionResult = await this.extractAndStoreImages(projectId, tarBlob);

      this.debugInfo.processingTime = performance.now() - startTime;

      return extractionResult;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.debugInfo.cacheErrors.push(`Extraction failed: ${errorMessage}`);
      this.debugInfo.processingTime = performance.now() - startTime;

      return {
        success: false,
        totalImages: 0,
        extractedImages: 0,
        errors: this.debugInfo.cacheErrors,
        cacheSize: await this.db.getCacheSize(),
      };
    }
  }

  private async extractAndStoreImages(projectId: string, tarBlob: Blob): Promise<TarExtractionResult> {
    this.debugInfo.extractionStarted = true;

    try {
      // Clear existing images for this project
      await this.db.clearProject(projectId);

      // Convert blob to array buffer for js-untar
      const arrayBuffer = await tarBlob.arrayBuffer();

      // Dynamic import of js-untar v2.0.0
      console.log(`[TarImageCache] Attempting to import js-untar...`);
      const untarModule = await import('js-untar');
      console.log(`[TarImageCache] js-untar module:`, untarModule);

      // js-untar v2.0.0 exports untar as the default export
      const untar = untarModule.default || untarModule.untar || untarModule;
      console.log(`[TarImageCache] untar function:`, typeof untar);

      if (typeof untar !== 'function') {
        throw new Error(`js-untar did not export a function. Got: ${typeof untar}. Available exports: ${Object.keys(untarModule).join(', ')}`);
      }

      console.log(`[TarImageCache] Calling untar with ${arrayBuffer.byteLength} bytes...`);
      const files = await untar(arrayBuffer);
      console.log(`[TarImageCache] Extracted ${files.length} files from tar`);

      // Filter image files
      const imageFiles = files.filter((file: UntarFile) => {
        const filename = file.name.toLowerCase();
        return filename.match(/\.(jpg|jpeg|png|bmp|tiff|tif|dcm|dicom)$/i) && !filename.includes('__MACOSX');
      });

      this.debugInfo.totalImagesFound = imageFiles.length;
      console.log(`[TarImageCache] Found ${imageFiles.length} image files`);

      let storedCount = 0;
      const errors: string[] = [];

      // Process each image file
      for (const file of imageFiles) {
        try {
          const { frame, slice } = extractIndicesFromFilename(file.name);
          const imageId = `${projectId}_f${frame}_s${slice}`;

          const blob = new Blob([file.buffer], {
            type: this.getMimeType(file.name)
          });

          const entry: ImageCacheEntry = {
            id: imageId,
            blob,
            filename: file.name,
            frameIndex: frame,
            sliceIndex: slice,
            timestamp: Date.now(),
            projectId,
          };

          await this.db.storeImage(entry);
          storedCount++;

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Failed to store ${file.name}: ${errorMessage}`);
        }
      }

      this.debugInfo.imagesStored = storedCount;
      this.debugInfo.extractionCompleted = true;
      this.debugInfo.cacheErrors.push(...errors);

      const cacheSize = await this.db.getCacheSize();

      console.log(`[TarImageCache] Successfully stored ${storedCount}/${imageFiles.length} images`);

      return {
        success: storedCount > 0,
        totalImages: imageFiles.length,
        extractedImages: storedCount,
        errors,
        cacheSize,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[TarImageCache] Extraction failed:`, error);
      this.debugInfo.cacheErrors.push(`Extraction error: ${errorMessage}`);

      return {
        success: false,
        totalImages: 0,
        extractedImages: 0,
        errors: [errorMessage],
        cacheSize: await this.db.getCacheSize(),
      };
    }
  }

  private getMimeType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'bmp': 'image/bmp',
      'tiff': 'image/tiff',
      'tif': 'image/tiff',
      'dcm': 'application/dicom',
      'dicom': 'application/dicom',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  async getImageBlob(projectId: string, frame: number, slice: number): Promise<Blob | null> {
    this.checkInitialization();
    const imageId = `${projectId}_f${frame}_s${slice}`;
    const entry = await this.db.getImage(imageId);
    return entry?.blob || null;
  }

  /**
   * Get the original filename for a specific frame and slice
   * @param projectId - Project identifier
   * @param frame - Frame index (0-based)
   * @param slice - Slice index (0-based)
   * @returns Original filename from tar archive or null if not found
   */
  async getImageFilename(projectId: string, frame: number, slice: number): Promise<string | null> {
    this.checkInitialization();
    const imageId = `${projectId}_f${frame}_s${slice}`;
    const entry = await this.db.getImage(imageId);
    return entry?.filename || null;
  }

  /**
   * Get a blob URL for displaying an image with URL caching optimization
   * This is the primary method for retrieving images for display in the UI
   * 
   * Performance optimization: URLs are cached in memory to prevent creating
   * duplicate object URLs for the same blob, which improves memory efficiency
   * and prevents broken images when the same image is accessed multiple times
   * 
   * @param projectId - Project identifier
   * @param frame - Frame number to retrieve
   * @param slice - Slice number to retrieve
   * @returns Promise resolving to blob URL string or null if not found
   */
  async getImageURL(projectId: string, frame: number, slice: number): Promise<string | null> {
    this.checkInitialization();
    const imageId = `${projectId}_f${frame}_s${slice}`;

    // Check URL cache first to avoid creating duplicate URLs for same blob
    if (this.urlCache.has(imageId)) {
      return this.urlCache.get(imageId)!;
    }

    // Retrieve blob from IndexedDB and create object URL
    const blob = await this.getImageBlob(projectId, frame, slice);
    if (blob) {
      const url = URL.createObjectURL(blob);
      this.urlCache.set(imageId, url); // Cache URL to prevent duplicates
      return url;
    }

    return null; // Image not found in cache
  }

  /**
   * Get all available frames and slices for a project
   * Used to populate navigation controls and determine dataset bounds
   */
  async getAvailableFramesAndSlices(projectId: string): Promise<{ frames: number[]; slices: number[] }> {
    this.checkInitialization();
    const images = await this.db.getImagesByProject(projectId);
    const frames = [...new Set(images.map(img => img.frameIndex))].sort((a, b) => a - b);
    const slices = [...new Set(images.map(img => img.sliceIndex))].sort((a, b) => a - b);
    return { frames, slices };
  }

  /**
   * Clear all cached images and URLs for a specific project
   * Essential for memory management and preventing URL leaks
   * 
   * Process:
   * 1. Find all cached URLs for the project
   * 2. Revoke object URLs to free memory
   * 3. Remove entries from in-memory URL cache
   * 4. Delete images from IndexedDB storage
   * 
   * @param projectId - Project identifier to clear
   */
  async clearProjectCache(projectId: string): Promise<void> {
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

    // Clear images from persistent IndexedDB storage
    await this.db.clearProject(projectId);
  }

  /**
   * Get total number of cached images across all projects
   * Useful for monitoring cache size and storage usage
   */
  async getCacheSize(): Promise<number> {
    this.checkInitialization();
    return await this.db.getCacheSize();
  }
}

// Export singleton instance for global access
export const tarImageCache = new TarImageCache();
