"use client";

import React, { useRef, useState } from "react";
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
import { Upload, File, X, AlertCircle, Loader2 } from "lucide-react";
import { projectApi } from "@/lib/api";

interface FileUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadSuccess?: (result?: any) => void;
}

interface FileDetails {
  file: File;
  name: string;
  size: number;
  type: string;
  lastModified: Date;
}

const friendlySuccessMessage =
  "Your files are uploading. Each file will be created as its own project.";

const stripMedicalExtension = (filename: string) =>
  filename.replace(/\.(nii\.gz|nii|dcm|zip)$/i, "");

const getUploadErrorMessage = (error: any) => {
  if (error.response?.status === 409) {
    return "An existing project with an identical file already exists. Please edit that project or delete it before uploading a new one to prevent server overload.";
  }

  return (
    error.response?.data?.message ||
    error.response?.data?.error ||
    error.message ||
    "Failed to upload file. Please try again."
  );
};

export function FileUploadDialog({
  open,
  onOpenChange,
  onUploadSuccess,
}: FileUploadDialogProps) {
  const [selectedFiles, setSelectedFiles] = useState<FileDetails[]>([]);
  const [projectName, setProjectName] = useState("");
  const [description, setDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const validateFile = (file: File): string | null => {
    const maxSize = 500 * 1024 * 1024;
    const lowerName = file.name.toLowerCase();

    if (file.size > maxSize) {
      return `${file.name}: file size must be less than 500MB`;
    }

    const isValidType =
      lowerName.endsWith(".nii") ||
      lowerName.endsWith(".nii.gz") ||
      lowerName.endsWith(".dcm") ||
      lowerName.endsWith(".zip") ||
      file.type === "application/gzip" ||
      file.type === "application/x-gzip" ||
      file.type === "application/dicom" ||
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed";

    if (!isValidType) {
      return `${file.name}: please select .nii, .nii.gz, .dcm, or .zip files.`;
    }

    return null;
  };

  const handleFilesSelect = (files: File[]) => {
    const errors = files.map(validateFile).filter(Boolean) as string[];
    if (errors.length > 0) {
      setUploadError(errors[0]);
      return;
    }

    const nextFiles = files.map((file) => ({
      file,
      name: file.name,
      size: file.size,
      type: file.type || "Unknown",
      lastModified: new Date(file.lastModified),
    }));

    setUploadError(null);
    setUploadNotice(files.length > 1 ? friendlySuccessMessage : null);
    setSelectedFiles(nextFiles);

    if (nextFiles.length === 1 && !projectName) {
      setProjectName(stripMedicalExtension(nextFiles[0].name));
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
      handleFilesSelect(files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFilesSelect(Array.from(files));
    }
  };

  const handleUpload = async () => {
    const isSingleUpload = selectedFiles.length === 1;
    if (selectedFiles.length === 0 || (isSingleUpload && !projectName.trim())) {
      setUploadError("Please select a file and provide a project name.");
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    const results: any[] = [];
    try {
      for (const fileDetails of selectedFiles) {
        const formData = new FormData();
        formData.append("files", fileDetails.file);
        formData.append(
          "name",
          isSingleUpload ? projectName.trim() : stripMedicalExtension(fileDetails.name),
        );
        if (description.trim()) {
          formData.append("description", description.trim());
        }

        results.push(await projectApi.uploadProject(formData));
      }

      setSelectedFiles([]);
      setProjectName("");
      setDescription("");
      setUploadNotice(null);

      onOpenChange(false);
      onUploadSuccess?.(
        results.length === 1
          ? results[0]
          : { success: true, batch: true, results },
      );
    } catch (error: any) {
      const progress = results.length > 0 ? ` Uploaded ${results.length} of ${selectedFiles.length} files.` : "";
      setUploadError(`${getUploadErrorMessage(error)}${progress}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancel = () => {
    setSelectedFiles([]);
    setProjectName("");
    setDescription("");
    setUploadError(null);
    setUploadNotice(null);
    setIsUploading(false);
    onOpenChange(false);
  };

  const removeSelectedFile = (index: number) => {
    const nextFiles = selectedFiles.filter((_, fileIndex) => fileIndex !== index);
    setSelectedFiles(nextFiles);
    setUploadError(null);
    setUploadNotice(nextFiles.length > 1 ? friendlySuccessMessage : null);
    if (nextFiles.length !== 1) {
      setProjectName("");
    } else {
      setProjectName(stripMedicalExtension(nextFiles[0].name));
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const isSingleUpload = selectedFiles.length === 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload New Project</DialogTitle>
          <DialogDescription>
            Select one or more medical imaging files to create projects in one upload flow.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {selectedFiles.length === 0 ? (
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
                multiple
                accept=".nii,.nii.gz,.dcm,.zip"
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
                    Supports multiple .nii, .nii.gz, .dcm, or .zip files up to 500MB each
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {selectedFiles.length} file{selectedFiles.length > 1 ? "s" : ""} selected
                  </p>
                  <p className="text-xs text-gray-500">
                    Each scan will become a separate project. ZIP files are extracted on the server.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedFiles([]);
                    setProjectName("");
                    setUploadNotice(null);
                  }}
                >
                  Clear
                </Button>
              </div>

              <div className="max-h-44 space-y-2 overflow-y-auto pr-1">
                {selectedFiles.map((selectedFile, index) => (
                  <div key={`${selectedFile.name}-${selectedFile.lastModified.getTime()}`} className="flex items-center justify-between rounded-md border p-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100">
                        <File className="h-4 w-4 text-blue-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{selectedFile.name}</p>
                        <p className="text-xs text-gray-500">
                          {formatFileSize(selectedFile.size)} - {selectedFile.type}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeSelectedFile(index)}
                      className="h-8 w-8 shrink-0 p-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedFiles.length > 0 && (
            <div className="space-y-3">
              {isSingleUpload && (
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
              )}

              <div>
                <Label htmlFor="description">Description (Optional)</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={isSingleUpload ? "Enter project description" : "Apply one description to all uploaded projects"}
                  className="mt-1 resize-none"
                  rows={3}
                />
              </div>
            </div>
          )}

          {uploadNotice && (
            <Alert>
              <Upload className="h-4 w-4" />
              <AlertDescription>{uploadNotice}</AlertDescription>
            </Alert>
          )}

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
            disabled={selectedFiles.length === 0 || (isSingleUpload && !projectName.trim()) || isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                {selectedFiles.length > 1 ? `Upload ${selectedFiles.length} Projects` : "Upload to Cloud"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
