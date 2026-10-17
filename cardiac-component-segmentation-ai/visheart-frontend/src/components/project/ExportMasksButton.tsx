"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useProject } from "@/context/ProjectContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Download, Layers, Loader2 } from "lucide-react";
import { segmentationApi } from "@/lib/api";
import { SEGMENTATION_MODEL_OPTIONS } from "@/lib/segmentation-model-utils";
import type { SegmentationModelId } from "@/lib/segmentation-model-utils";

interface ExportMasksButtonProps {
  defaultModel?: SegmentationModelId;
  hasUnsavedChanges?: boolean;
  isSaving?: boolean;
  onSave?: () => Promise<boolean>;
}

const PENDING_EXPORT_TTL_MS = 2 * 60 * 1000;
let pendingExport: { projectId: string; at: number } | null = null;

export function ExportMasksButton({ defaultModel, hasUnsavedChanges = false, isSaving = false, onSave }: ExportMasksButtonProps) {
  const { projectData, hasMasks, maskAvailabilityByModel } = useProject();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [exportingModel, setExportingModel] = useState<SegmentationModelId | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const projectId = projectData?.projectId;
  useEffect(() => {
    if (!pendingExport || pendingExport.projectId !== projectId) return;
    if (Date.now() - pendingExport.at > PENDING_EXPORT_TTL_MS) {
      pendingExport = null;
      return;
    }
    if (isSaving || hasUnsavedChanges) return;
    pendingExport = null;
    setExportDialogOpen(true);
  }, [projectId, isSaving, hasUnsavedChanges]);

  const modelOptions = defaultModel
    ? [...SEGMENTATION_MODEL_OPTIONS].sort((a, b) => Number(b.value === defaultModel) - Number(a.value === defaultModel))
    : SEGMENTATION_MODEL_OPTIONS;

  const handleExportClick = () => {
    if (hasUnsavedChanges && onSave) setUnsavedDialogOpen(true);
    else setExportDialogOpen(true);
  };

  const handleSaveAndExport = async () => {
    if (!projectId || !onSave) return;
    pendingExport = { projectId, at: Date.now() };
    const saved = await onSave();
    if (mountedRef.current) setUnsavedDialogOpen(false);
    if (!saved) {
      pendingExport = null;
      toast.error("Save failed, so nothing was exported", { description: "Your edits are still in the editor. Try saving again." });
    } else if (mountedRef.current && pendingExport) {
      pendingExport = null;
      setExportDialogOpen(true);
    }
  };

  const handleExportLastSaved = () => {
    setUnsavedDialogOpen(false);
    setExportDialogOpen(true);
  };

  const handleExportModel = async (model: SegmentationModelId) => {
    if (!projectData?.projectId || !maskAvailabilityByModel[model]) return;

    setExportingModel(model);
    try {
      console.log(`[Export] Starting segmentation export for project: ${projectData.projectId}, model: ${model}`);
      const exportResult = await segmentationApi.exportProjectData(projectData.projectId, model);

      const url = window.URL.createObjectURL(exportResult.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportResult.suggestedFilename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      console.log(`[Export] Successfully downloaded segmentation export for project: ${projectData.projectId} as ${exportResult.suggestedFilename}`);
      setExportDialogOpen(false);
    } catch (error) {
      console.error("Error exporting segmentation:", error);
    } finally {
      setExportingModel(null);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="text-xs"
        disabled={!hasMasks || isSaving}
        onClick={handleExportClick}
        title={hasMasks ? "Choose a model to export its segmentation masks" : "No masks yet, run segmentation first"}
      >
        <Download className="h-3.5 w-3.5 mr-1.5" />
        Export Masks
      </Button>
      {!hasMasks && (
        <span className="text-xs text-muted-foreground">No masks yet, run segmentation first</span>
      )}

      <Dialog open={unsavedDialogOpen} onOpenChange={(open) => !isSaving && setUnsavedDialogOpen(open)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>You have unsaved edits. Save before exporting?</DialogTitle>
            <DialogDescription>
              The export uses the masks saved on the server. Unsaved edits are not included unless you save first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            <Button onClick={handleSaveAndExport} disabled={isSaving}>
              {isSaving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {isSaving ? "Saving..." : "Save and export"}
            </Button>
            <Button variant="outline" onClick={handleExportLastSaved} disabled={isSaving}>
              Export last saved version
            </Button>
            <Button variant="ghost" onClick={() => setUnsavedDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Export Segmentation Masks</DialogTitle>
            <DialogDescription>
              Choose which model&apos;s segmentation masks to download. Only models with a generated mask are selectable.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            {modelOptions.map((opt) => {
              const available = maskAvailabilityByModel[opt.value];
              const isExporting = exportingModel === opt.value;
              const isDefault = opt.value === defaultModel;
              return (
                <Button
                  key={opt.value}
                  variant="outline"
                  className={`justify-between h-10 ${isDefault ? "border-primary" : ""}`}
                  disabled={!available || exportingModel !== null}
                  onClick={() => handleExportModel(opt.value)}
                  title={available ? `Export ${opt.label} segmentation masks as NIfTI` : `No ${opt.label} segmentation masks available`}
                >
                  <span className="flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5" />
                    {opt.label}
                    {isDefault && <span className="text-[11px] font-normal text-muted-foreground">(in editor)</span>}
                  </span>
                  {isExporting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : available ? (
                    <Download className="h-3.5 w-3.5" />
                  ) : (
                    <span className="text-[11px] text-muted-foreground">No mask</span>
                  )}
                </Button>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setExportDialogOpen(false)} disabled={exportingModel !== null}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
