"use client";

import { useState } from "react";
import { useProject, normalizeReconstructionChamber } from "@/context/ProjectContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Box, Download, Loader2 } from "lucide-react";
import { reconstructionApi } from "@/lib/api";
import { SEGMENTATION_MODEL_OPTIONS } from "@/lib/segmentation-model-utils";
import type { SegmentationModelId } from "@/lib/segmentation-model-utils";

type Chamber = "lv" | "rv";
const CHAMBERS: { value: Chamber; label: string }[] = [
  { value: "lv", label: "LV" },
  { value: "rv", label: "RV" },
];

/* eslint-disable @typescript-eslint/no-explicit-any */
const findReconstruction = (reconstructions: any[], model: SegmentationModelId, chamber: Chamber): any =>
  reconstructions.find(
    (recon) =>
      (recon?.segmentationModel ?? "").toString().toLowerCase() === model &&
      normalizeReconstructionChamber(recon?.chamber) === chamber,
  ) ?? null;
/* eslint-enable @typescript-eslint/no-explicit-any */

export function ExportReconstructionButton() {
  const { projectData, hasReconstructions, reconstructionResults } = useProject();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportingKey, setExportingKey] = useState<string | null>(null);

  const handleExportReconstruction = async (model: SegmentationModelId, chamber: Chamber) => {
    if (!projectData?.projectId) return;

    setExportingKey(`${model}:${chamber}`);
    try {
      console.log(`[Export] Starting reconstruction export for project: ${projectData.projectId}, model: ${model}, chamber: ${chamber}`);

      const result = await reconstructionApi.getReconstructionResults(projectData.projectId);
      const reconstruction = result.success ? findReconstruction(result.reconstructions ?? [], model, chamber) : null;

      if (!reconstruction) {
        console.warn(`[Export] No ${model} ${chamber} reconstruction found for project: ${projectData.projectId}`);
        alert("This reconstruction is no longer available to export.");
        return;
      }

      if (!reconstruction.downloadUrl) {
        console.warn(`[Export] No download URL available for reconstruction ${reconstruction.reconstructionId}`);
        alert("Reconstruction export is not available.");
        return;
      }

      const a = document.createElement("a");
      a.href = reconstruction.downloadUrl;
      a.download = reconstruction.metadata?.filename || `reconstruction_${projectData.projectId}_${model}_${chamber}.tar`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      console.log(`[Export] Successfully initiated reconstruction download for project: ${projectData.projectId}`);
      setExportDialogOpen(false);
    } catch (error) {
      console.error("Error exporting reconstruction:", error);
      alert("Failed to export reconstruction. Please try again.");
    } finally {
      setExportingKey(null);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        disabled={!hasReconstructions}
        onClick={() => setExportDialogOpen(true)}
        title={hasReconstructions ? "Choose a reconstruction to export as tar archive" : "No reconstructions available"}
      >
        <Box className="h-3 w-3 mr-1.5" />
        Export 3D
      </Button>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Export 3D Reconstruction</DialogTitle>
            <DialogDescription>
              Choose which reconstruction to download as a mesh archive. Only existing reconstructions are selectable.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            {SEGMENTATION_MODEL_OPTIONS.flatMap((opt) =>
              CHAMBERS.map((ch) => {
                const key = `${opt.value}:${ch.value}`;
                const label = `${opt.label} · ${ch.label}`;
                const available = !!findReconstruction(reconstructionResults ?? [], opt.value, ch.value);
                const isExporting = exportingKey === key;
                return (
                  <Button
                    key={key}
                    variant="outline"
                    className="justify-between h-10"
                    disabled={!available || exportingKey !== null}
                    onClick={() => handleExportReconstruction(opt.value, ch.value)}
                    title={available ? `Export ${label} reconstruction` : `No ${label} reconstruction available`}
                  >
                    <span className="flex items-center gap-2">
                      <Box className="h-3.5 w-3.5" />
                      {label}
                    </span>
                    {isExporting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : available ? (
                      <Download className="h-3.5 w-3.5" />
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Not built</span>
                    )}
                  </Button>
                );
              }),
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setExportDialogOpen(false)} disabled={exportingKey !== null}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
