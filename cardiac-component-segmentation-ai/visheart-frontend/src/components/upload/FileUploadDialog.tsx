"use client";

import React, { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload,
  File,
  FolderOpen,
  X,
  CheckCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { projectApi } from "@/lib/api";

interface FileUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadSuccess?: () => void;
}

interface FileDetails {
  file: File;
  name: string;
  size: number;
  type: string;
  lastModified: Date;
}

export function FileUploadDialog({
  open,
  onOpenChange,
  onUploadSuccess,
}: FileUploadDialogProps) {
  const [selectedFile, setSelectedFile] = useState<FileDetails | null>(null);
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Supported file types for medical imaging
  const supportedTypes = [
    ".nii",
    ".nii.gz",
    "application/gzip",
    "application/x-gzip",
  ];

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const validateFile = (file: File): string | null => {
    // Check file size (limit to 500MB)
    const maxSize = 500 * 1024 * 1024; // 500MB
    if (file.size > maxSize) {
      return "File size must be less than 500MB";
    }

    // Check file type
    const isValidType = supportedTypes.some(
      (type) =>
        file.name.toLowerCase().endsWith(type.toLowerCase()) ||
        file.type === type,
    );

    if (!isValidType) {
      return "Please select a valid medical imaging file (.nii, .nii.gz)";
    }

    return null;
  };

  const handleFileSelect = (file: File) => {
    const error = validateFile(file);
    if (error) {
      setUploadError(error);
      return;
    }

    setUploadError(null);
    setSelectedFile({
      file,
      name: file.name,
      size: file.size,
      type: file.type || "Unknown",
      lastModified: new Date(file.lastModified),
    });

    // Auto-fill project name from filename
    if (!projectName) {
      const nameWithoutExt = file.name.replace(
        /\.(nii|nii\.gz)$/i,
        "",
      );
      setProjectName(nameWithoutExt);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || !projectName.trim()) {
      setUploadError("Please select a file and provide a project name");
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("files", selectedFile.file);
      formData.append("name", projectName.trim());
      if (description.trim()) {
        formData.append("description", description.trim());
      }

      await projectApi.uploadProject(formData);

      // Reset form
      setSelectedFile(null);
      setProjectName("");
      setDescription("");

      // Close dialog and trigger refresh
      onOpenChange(false);
      onUploadSuccess?.();
    } catch (error: any) {
      console.error("Upload error:", error);

      // Handle specific error cases
      if (error.response?.status === 409) {
        setUploadError(
          "An existing project with an identical file already exists. Please edit that project or delete it before uploading a new one to prevent server overload.",
        );
      } else {
        setUploadError(
          error.response?.data?.message ||
            error.message ||
            "Failed to upload file. Please try again.",
        );
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancel = () => {
    setSelectedFile(null);
    setProjectName("");
    setDescription("");
    setUploadError(null);
    setIsUploading(false);
    onOpenChange(false);
  };

  const removeSelectedFile = () => {
    setSelectedFile(null);
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload New Project</DialogTitle>
          <DialogDescription>
            Select a medical imaging file (.nii, .nii.gz, .dcm) to create a new
            project
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Upload Area */}
          {!selectedFile ? (
            <div
              className={`relative rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                dragActive
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-300 hover:border-gray-400"
              }`}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".nii,.nii.gz"
                onChange={handleFileInputChange}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              <div className="space-y-2">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                  <Upload className="h-6 w-6 text-gray-600" />
                </div>
                <div>
                  <p className="text-foreground text-sm font-medium">
                    Drop files here or click to browse
                  </p>
                  <p className="text-xs text-gray-500">
                    Supports .nii, .nii.gz, .dcm files up to 500MB
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Selected File Preview */
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                    <File className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-sm font-medium">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(selectedFile.size)} • {selectedFile.type}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={removeSelectedFile}
                  className="h-8 w-8 p-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-gray-500">Size:</span>
                  <p className="font-medium">
                    {formatFileSize(selectedFile.size)}
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Modified:</span>
                  <p className="font-medium">
                    {selectedFile.lastModified.toLocaleDateString()}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Project Details */}
          {selectedFile && (
            <div className="space-y-3">
              <div>
                <Label htmlFor="projectName">Project Name *</Label>
                <Input
                  id="projectName"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Enter project name"
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="description">Description (Optional)</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter project description"
                  className="mt-1 resize-none"
                  rows={3}
                />
              </div>
            </div>
          )}

          {/* Error Alert */}
          {uploadError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{uploadError}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isUploading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || !projectName.trim() || isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload to Cloud
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
