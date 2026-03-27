import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Edit2, Check, X, Loader2, Edit, Download, Trash2 } from "lucide-react";
import { Project } from "@/types/dashboard";
import { projectApi } from "@/lib/api";
import { ShowForRegisteredUser } from "@/components/RoleGuard";

interface EditableProjectCardProps {
  project: Project;
  onUpdate: () => void;
  onSave: (projectId: string, isSaved: boolean) => void;
  onDelete: (projectId: string, projectName: string) => void;
  onExport: (projectId: string) => void;
  segmentationIndicator?: React.ReactNode;
  reconstructionIndicator?: React.ReactNode;
  hasMasks?: boolean; // Add mask availability info
}

export function EditableProjectCard({ project, onUpdate, onSave, onDelete, onExport, segmentationIndicator, reconstructionIndicator, hasMasks = false }: EditableProjectCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [editedName, setEditedName] = useState(project.name);
  const [editedDescription, setEditedDescription] = useState(project.description || "");
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Format file size helper
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Start editing
  const handleStartEdit = () => {
    setEditedName(project.name);
    setEditedDescription(project.description || "");
    setIsEditing(true);
    setUpdateError(null);
  };

  // Cancel editing
  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedName(project.name);
    setEditedDescription(project.description || "");
    setUpdateError(null);
  };

  // Save changes
  const handleSave = async () => {
    if (!editedName.trim()) {
      setUpdateError("Project name is required");
      return;
    }

    setIsUpdating(true);
    setUpdateError(null);

    try {
      await projectApi.updateProject(project.projectId, editedName.trim(), editedDescription.trim());

      setIsEditing(false);
      onUpdate(); // Refresh the projects list
    } catch (error) {
      console.error("Error updating project:", error);
      setUpdateError((error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to update project");
    } finally {
      setIsUpdating(false);
    }
  };

  // Handle key press for save on Enter
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      handleCancelEdit();
    }
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 pr-2">
            {isEditing ? (
              <div className="space-y-2">
                <Input
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Project name"
                  className="font-semibold text-lg"
                  disabled={isUpdating}
                />
                <Input
                  value={editedDescription}
                  onChange={(e) => setEditedDescription(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Project description (optional)"
                  className="text-sm"
                  disabled={isUpdating}
                />
                {updateError && <p className="text-sm text-destructive">{updateError}</p>}
              </div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2 max-w-[180px] sm:max-w-[200px] md:max-w-64">
                  <p className="text-lg font-semibold truncate" title={project.name}>
                    {project.name}
                  </p>
                  <ShowForRegisteredUser fallback={null}>
                    <Button variant="ghost" size="sm" onClick={handleStartEdit} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 h-auto self-end">
                      <Edit2 className="h-3 w-3" />
                    </Button>
                  </ShowForRegisteredUser>
                </div>
                <p className="text-sm text-muted-foreground truncate overflow-hidden text-ellipsis whitespace-nowrap max-w-[90px] sm:max-w-[140px] md:max-w-[200px] lg:max-w-[260px]" title={project.description || "No description"}>
                  {project.description || "No description"}
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-1.5 flex-shrink-0 min-w-[110px]">
            {isEditing ? (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={handleCancelEdit} disabled={isUpdating} className="h-7 px-2">
                  <X className="h-3 w-3" />
                </Button>
                <Button variant="default" size="sm" onClick={handleSave} disabled={isUpdating || !editedName.trim()} className="h-7 px-2">
                  {isUpdating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-end gap-1 md:gap-2">
                <ShowForRegisteredUser fallback={<Badge variant={project.isSaved ? "default" : "secondary"} className="text-xs whitespace-nowrap">{project.isSaved ? "Saved" : "Temp"}</Badge>}>
                  <Button variant="ghost" size="sm" onClick={() => onSave(project.projectId, !project.isSaved)} className="h-auto p-1">
                    <Badge variant={project.isSaved ? "default" : "secondary"} className="cursor-pointer hover:opacity-80 text-xs whitespace-nowrap">
                      {project.isSaved ? "Saved" : "Temp"}
                    </Badge>
                  </Button>
                </ShowForRegisteredUser>
                {segmentationIndicator}
                {reconstructionIndicator}
              </div>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Size:</span>
            <p className="font-medium">{formatFileSize(project.filesize)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Type:</span>
            <p className="font-medium">{project.filetype}</p>
          </div>
          <div>
            <span className="text-muted-foreground" title="In the representation of width * height * slices * frames">
              Dimensions:
            </span>
            <p className="font-medium">
              {(() => {
                let dimensionStringRepresentation = `${project.dimensions.width}x${project.dimensions.height}`;
                if (project.dimensions.slices) dimensionStringRepresentation += `x${project.dimensions.slices}`;
                if (project.dimensions.frames) dimensionStringRepresentation += `x${project.dimensions.frames}`;
                return dimensionStringRepresentation;
              })()}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Created:</span>
            <p className="font-medium">{new Date(project.createdAt).toLocaleDateString()}</p>
          </div>
          {/* Reconstruction Metadata - Always show these fields for consistent layout */}
          <div>
            <span className="text-muted-foreground">ED Frame:</span>
            <p className={project.reconstruction?.edFrame ? "font-medium" : "font-medium text-muted-foreground"}>
              {project.reconstruction?.edFrame ?? "n/a"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Mesh Size:</span>
            <p className={project.reconstruction?.tarFileSize ? "font-medium" : "font-medium text-muted-foreground"}>
              {project.reconstruction?.tarFileSize ? formatFileSize(project.reconstruction.tarFileSize) : "n/a"}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => window.open(`/project/${project.projectId}`, "_blank")} title={`Open project ${project.name}`}>
            <Edit className="mr-1 h-3 w-3" />
            Open
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => onExport(project.projectId)}
            disabled={!hasMasks}
            title={hasMasks ? "Export segmentation as NIfTI" : "Complete segmentation to enable export"}
          >
            <Download className="mr-1 h-3 w-3" />
            Export
          </Button>
        </div>

        <ShowForRegisteredUser fallback={null}>
          <Button size="sm" variant="destructive" className="w-full" onClick={() => onDelete(project.projectId, project.name)}>
            <Trash2 className="mr-1 h-3 w-3" />
            Delete Project
          </Button>
        </ShowForRegisteredUser>
      </CardContent>
    </Card>
  );
}
