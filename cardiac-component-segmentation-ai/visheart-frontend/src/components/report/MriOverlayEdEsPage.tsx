"use client";

import React, { useEffect, useState } from "react";
import { useProject } from "@/context/ProjectContext";
import { segmentationApi } from "@/lib/api";
import { decodeSegmentationMasks } from "@/lib/decode-RLE";
import { ANATOMICAL_LABELS, LABEL_COLORS, LABEL_NAMES } from "@/types/segmentation";
import type { BaseSegmentationMask } from "@/types/project";
import { ReportPageFrame } from "./ReportPageFrame";
import { renderFrame } from "./MriOverlayPage";

type Panel = { label: "ED" | "ES"; frame: number; dataUrl: string };

/**
 * Default-mode ("ED/ES Only") twin of MriOverlayPage: the same real segmentation-overlay
 * render (`renderFrame`, reused as-is, not reimplemented), but only the ED and ES frames
 * instead of an every-frame grid — per the report-redesign spec, selected examples, not a
 * complete review of every slice.
 */
export function MriOverlayEdEsPage({
  projectId,
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  modeLabel,
  maskDocId,
  width,
  height,
  totalSlices,
  edFrame,
  esFrame,
}: {
  projectId: string;
  patientLabel: string;
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  modeLabel?: string;
  maskDocId?: string;
  width?: number;
  height?: number;
  totalSlices?: number;
  edFrame?: number | null;
  esFrame?: number | null;
}) {
  const { getMRIImage, tarCacheReady, tarCacheError } = useProject();
  const [panels, setPanels] = useState<Panel[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "unavailable">("loading");

  const sliceIndex = totalSlices ? Math.floor(totalSlices / 2) : 0;

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!width || !height || edFrame == null || esFrame == null) {
        setStatus("unavailable");
        return;
      }
      if (!tarCacheReady) {
        if (tarCacheError) setStatus("unavailable");
        return;
      }
      setStatus("loading");
      try {
        const res = await segmentationApi.getSegmentationResults(projectId);
        const rawMasks = (res.segmentations ?? []) as BaseSegmentationMask[];
        const rawDoc = maskDocId
          ? rawMasks.find((m) => m._id === maskDocId)
          : rawMasks.find((m) => !m.isMedSAMOutput);
        if (!rawDoc) {
          if (!cancelled) setStatus("unavailable");
          return;
        }

        const { masks: decodedMasks } = decodeSegmentationMasks([rawDoc], width, height);
        const maskType = rawDoc.isMedSAMOutput ? "medSamOutput" : "editable";

        const rendered: Panel[] = [];
        for (const [label, frame] of [["ED", edFrame], ["ES", esFrame]] as const) {
          const mriUrl = await getMRIImage(frame, sliceIndex);
          if (!mriUrl) continue;
          const maskKeyPrefix = `${maskType}_frame_${frame}_slice_${sliceIndex}_`;
          const dataUrl = await renderFrame(mriUrl, decodedMasks, maskKeyPrefix, width, height);
          rendered.push({ label, frame, dataUrl });
        }

        if (!cancelled) {
          if (rendered.length === 0) setStatus("unavailable");
          else { setPanels(rendered); setStatus("ready"); }
        }
      } catch (err) {
        console.error("[MriOverlayEdEsPage] Failed to render overlay:", err);
        if (!cancelled) setStatus("error");
      }
    }

    run();
    return () => { cancelled = true; };
  }, [projectId, maskDocId, width, height, sliceIndex, edFrame, esFrame, tarCacheReady, tarCacheError, getMRIImage]);

  const subtitle = `Short-axis slice ${sliceIndex + 1}${totalSlices ? ` of ${totalSlices}` : ""} · selected ED/ES examples, not a complete review of every slice`;

  if (status !== "ready" || !panels) {
    return (
      <ReportPageFrame
        pageNumber={pageNumber}
        totalPages={totalPages}
        patientLabel={patientLabel}
        statusLabel="Complete"
        modeLabel={modeLabel}
        title="Segmentation Visualization — ED/ES Examples"
        subtitle={subtitle}
        generatedAt={generatedAt}
      >
        {status === "loading" && <p className="py-10 text-center text-sm text-gray-600">Rendering segmentation overlay…</p>}
        {status === "unavailable" && (
          <p className="py-10 text-center text-sm text-gray-600">
            MRI imagery or segmentation frames are not available for this project — reopen the
            segmentation editor once to populate the image cache, then reload this report.
          </p>
        )}
        {status === "error" && <p className="py-10 text-center text-sm text-gray-600">Could not render the segmentation overlay for this project.</p>}
      </ReportPageFrame>
    );
  }

  return (
    <ReportPageFrame
      pageNumber={pageNumber}
      totalPages={totalPages}
      patientLabel={patientLabel}
      statusLabel="Complete"
      modeLabel={modeLabel}
      title="Segmentation Visualization — ED/ES Examples"
      subtitle={subtitle}
      generatedAt={generatedAt}
    >
      <p className="mb-2 text-[12px] leading-snug text-gray-600">
        Selected examples only — the ED and ES frames used elsewhere in this report, not every
        computed slice. See the Full Research Report for the complete frame-by-frame grid.
      </p>
      <div className="grid grid-cols-2 gap-6">
        {panels.map((p) => (
          <figure key={p.label} className="flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- static raster
                snapshot baked once via canvas.toDataURL, not a Next-optimized asset */}
            <img
              src={p.dataUrl}
              alt={`${p.label} frame — MRI with segmentation overlay`}
              className="w-full max-h-[90mm] rounded-lg border-2 border-teal-500 object-contain"
            />
            <figcaption className="mt-1 text-[13px] font-bold uppercase tracking-wide text-gray-900">
              {p.label} (Frame {p.frame + 1})
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="mt-4">
        <div className="flex items-center justify-center gap-5">
          {ANATOMICAL_LABELS.map((label) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: LABEL_COLORS[label] }} />
              <span className="text-[12px] text-gray-600">{LABEL_NAMES[label]}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] leading-snug text-gray-600">
          Overlay generated directly from the model&apos;s stored segmentation masks at the frame and
          slice shown; not a schematic illustration. Frame numbers are one-based.
        </p>
      </div>
    </ReportPageFrame>
  );
}
