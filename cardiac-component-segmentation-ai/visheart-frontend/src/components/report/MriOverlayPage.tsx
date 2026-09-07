"use client";

import React, { useEffect, useState } from "react";
import { useProject } from "@/context/ProjectContext";
import { segmentationApi } from "@/lib/api";
import { decodeSegmentationMasks } from "@/lib/decode-RLE";
import { ANATOMICAL_LABELS, LABEL_COLORS, LABEL_NAMES, type AnatomicalLabel } from "@/types/segmentation";
import type { BaseSegmentationMask } from "@/types/project";
import { ReportPageFrame } from "./ReportPageFrame";
import { chunk } from "./print-utils";

// Same blend used on-screen (useMaskRendering.ts) so the printed overlay
// matches what the user already sees in the segmentation editor.
const OVERLAY_OPACITY = 0.45;
// 3 columns keeps each image large enough to actually read. Fixed grid, not
// a stretch-to-fill one — a `1fr`/`h-full` grid inside the print page's
// forced-height container made Chrome's print pagination split the grid
// itself mid-page, producing blank cells and duplicated frames across the
// page break. 3 rows (9/page), not 4 — natural-aspect MRI images at this
// column width run taller than the bullseye/table cells elsewhere in the
// report, so a 4th row didn't reliably fit one A4 sheet and forced an
// unwanted internal page break partway down, leaving the page above it
// mostly blank.
const FRAMES_PER_PAGE = 9;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

type FramePanel = { frame: number; dataUrl: string };

/** How many physical pages this component renders for `totalFrames`. */
export function mriOverlayPageCount(totalFrames: number): number {
  return Math.max(1, Math.ceil(totalFrames / FRAMES_PER_PAGE));
}

/**
 * Renders one cardiac-cycle frame (MRI slice + its segmentation mask) onto an
 * offscreen canvas and returns a PNG data URL — a real raster image, not an
 * SVG illustration, so it prints identically to what `window.print()` sees on
 * screen and survives being embedded in a saved PDF.
 */
async function renderFrame(
  mriUrl: string,
  decodedMasks: Record<string, Uint8Array>,
  maskKeyPrefix: string,
  width: number,
  height: number,
): Promise<string> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load MRI image"));
    img.src = mriUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, width, height);

  for (const label of ANATOMICAL_LABELS) {
    const mask = decodedMasks[`${maskKeyPrefix}${label}`];
    if (!mask || mask.length === 0) continue;

    let hasPixels = false;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] > 0) { hasPixels = true; break; }
    }
    if (!hasPixels) continue;

    const [r, g, b] = hexToRgb(LABEL_COLORS[label as AnatomicalLabel]);
    const alpha = Math.round(255 * OVERLAY_OPACITY);
    const imageData = new ImageData(width, height);
    const maxPixels = Math.min(mask.length, width * height);
    for (let i = 0; i < maxPixels; i++) {
      if (mask[i] > 0) {
        const p = i * 4;
        imageData.data[p] = r;
        imageData.data[p + 1] = g;
        imageData.data[p + 2] = b;
        imageData.data[p + 3] = alpha;
      }
    }

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = width;
    maskCanvas.height = height;
    maskCanvas.getContext("2d")!.putImageData(imageData, 0, 0);
    ctx.drawImage(maskCanvas, 0, 0);
  }

  return canvas.toDataURL("image/png");
}

export function MriOverlayPage({
  projectId,
  patientLabel,
  pageNumber,
  totalPages,
  generatedAt,
  maskDocId,
  width,
  height,
  totalSlices,
  totalFrames,
  edFrame,
  esFrame,
}: {
  projectId: string;
  patientLabel: string;
  /** First physical page number this component occupies. */
  pageNumber: number;
  totalPages: number;
  generatedAt: string;
  /** `_id` of the editable mask document to pull raw RLE frames from — the
   *  hook's typed MaskDoc omits `frames`, so the raw doc is fetched separately
   *  and matched by this id. Always resolves to the newest saved mask (see
   *  segmentationApi.getSegmentationResults), so a manually edited and
   *  re-saved mask is what gets rendered here, not a stale AI-only output. */
  maskDocId?: string;
  width?: number;
  height?: number;
  totalSlices?: number;
  totalFrames: number;
  edFrame?: number | null;
  esFrame?: number | null;
}) {
  const { getMRIImage, tarCacheReady, tarCacheError } = useProject();
  const [panels, setPanels] = useState<FramePanel[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "unavailable">("loading");

  // No slice convention exists elsewhere in the app for "the representative
  // slice" — the mid short-axis slice is the closest thing to a standard
  // choice for a single illustrative frame.
  const sliceIndex = totalSlices ? Math.floor(totalSlices / 2) : 0;
  const midFrame = edFrame != null && esFrame != null ? Math.round((edFrame + esFrame) / 2) : null;

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!width || !height || !totalFrames) {
        setStatus("unavailable");
        return;
      }
      if (!tarCacheReady) {
        if (tarCacheError) setStatus("unavailable");
        return; // still waiting for the MRI image cache to finish loading
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

        const rendered: FramePanel[] = [];
        for (let frame = 0; frame < totalFrames; frame++) {
          const mriUrl = await getMRIImage(frame, sliceIndex);
          if (!mriUrl) continue;
          const maskKeyPrefix = `${maskType}_frame_${frame}_slice_${sliceIndex}_`;
          const dataUrl = await renderFrame(mriUrl, decodedMasks, maskKeyPrefix, width, height);
          rendered.push({ frame, dataUrl });
        }

        if (!cancelled) {
          if (rendered.length === 0) {
            setStatus("unavailable");
          } else {
            setPanels(rendered);
            setStatus("ready");
          }
        }
      } catch (err) {
        console.error("[MriOverlayPage] Failed to render overlay:", err);
        if (!cancelled) setStatus("error");
      }
    }

    run();
    return () => { cancelled = true; };
  }, [projectId, maskDocId, width, height, sliceIndex, totalFrames, tarCacheReady, tarCacheError, getMRIImage]);

  const frameTag = (frame: number) => {
    if (frame === edFrame) return "ED";
    if (frame === esFrame) return "ES";
    if (frame === midFrame) return "Mid";
    return null;
  };

  const panelChunks = chunk(panels ?? [], FRAMES_PER_PAGE);
  const subtitle = `Short-axis slice ${sliceIndex + 1}${totalSlices ? ` of ${totalSlices}` : ""} · MRI with model segmentation overlay, every frame`;

  if (status !== "ready" || !panels) {
    return (
      <ReportPageFrame
        pageNumber={pageNumber}
        totalPages={totalPages}
        patientLabel={patientLabel}
        statusLabel="Complete"
        title="Segmentation Visualization"
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
    <>
      {panelChunks.map((panelChunk, ci) => (
        <ReportPageFrame
          key={ci}
          pageNumber={pageNumber + ci}
          totalPages={totalPages}
          patientLabel={patientLabel}
          statusLabel="Complete"
          title={`Segmentation Visualization${panelChunks.length > 1 ? ` (${ci + 1} of ${panelChunks.length})` : ""}`}
          subtitle={subtitle}
          generatedAt={generatedAt}
        >
          <div className="grid grid-cols-3 gap-3">
            {panelChunk.map((p) => {
              const tag = frameTag(p.frame);
              return (
                <figure key={p.frame} className="flex flex-col items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static
                      raster snapshot baked once via canvas.toDataURL, not a
                      Next-optimized asset */}
                  <img
                    src={p.dataUrl}
                    alt={`Frame ${p.frame} — MRI with segmentation overlay`}
                    className={`w-full rounded-lg border-2 ${tag ? "border-teal-500" : "border-gray-300"}`}
                  />
                  <figcaption className="mt-1 text-[9px] font-bold uppercase tracking-wide text-gray-900">
                    Frame {p.frame}{tag && <span className="ml-1 rounded-full bg-teal-100 px-1.5 py-0.5 text-teal-700">{tag}</span>}
                  </figcaption>
                </figure>
              );
            })}
          </div>

          {ci === panelChunks.length - 1 && (
            <div className="mt-4">
              <div className="flex items-center justify-center gap-5">
                {ANATOMICAL_LABELS.map((label) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: LABEL_COLORS[label] }} />
                    <span className="text-[8.5px] text-gray-600">{LABEL_NAMES[label]}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[8.5px] leading-snug text-gray-600">
                Overlay generated directly from the model&apos;s stored segmentation masks at the frame and slice
                shown; not a schematic illustration. ED, Mid, and ES frames are outlined and tagged.
              </p>
            </div>
          )}
        </ReportPageFrame>
      ))}
    </>
  );
}
