"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Loader2, Pencil } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { segmentationApi } from "@/lib/api";
import { rleDecodeToArray } from "@/lib/decode-RLE";
import { CASE_STRUCTURE_NAMES, CorrectionCase, MODEL_NAMES } from "@/lib/retraining-api";
import { BaseSegmentationMask } from "@/types/project";
import { differences, editorHref, labelMap } from "@/components/extend-training/logic";
import { ensureProjectImages, sliceImageUrl } from "@/components/extend-training/project-images";
import { CHANGE_COLOR, LABEL_PALETTE, MaskLegend, Overlay, SliceCanvas } from "@/components/extend-training/SliceCanvas";

export const EDITED_KEY = "extend-training-edited"; // set when Edit opens the editor, so coming back checks again
const IMAGE_HEIGHT = "66vh"; // the slice never makes the dialog taller than the window

export function markEdited(): void {
  try {
    sessionStorage.setItem(EDITED_KEY, "1");
  } catch {
    // the page still works; it just does not check again by itself
  }
}

type View = "ai" | "correction";

function entriesAt(mask: BaseSegmentationMask | undefined, frame: number, slice: number) {
  return mask?.frames.find(item => item.frameindex === frame)?.slices.find(item => item.sliceindex === slice)?.segmentationmasks;
}

function Heading({ children }: { children: string }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</p>;
}

export function CasePreview({ item, selected, locked, onSelectedChange, onClose }: {
  item: CorrectionCase | null;
  selected: boolean;
  locked: boolean;
  onSelectedChange: (value: boolean) => void;
  onClose: () => void;
}) {
  const [masks, setMasks] = useState<{ edited: BaseSegmentationMask; ai?: BaseSegmentationMask } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<View>("correction");
  const [highlight, setHighlight] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    setMasks(null);
    setProblem(null);
    setIndex(0);
    setView("correction");
    setHighlight(false);
    setImageUrl(null);
    if (!item) return;
    let stopped = false;
    void (async () => {
      try {
        const [reply] = await Promise.all([segmentationApi.getSegmentationResults(item.projectId),
                                           ensureProjectImages(item.projectId)]);
        const saved = (reply?.segmentations ?? []) as BaseSegmentationMask[];
        const edited = saved.find(mask => String(mask._id) === item.maskId);
        if (!edited) throw new Error("This correction is no longer saved. Check the corrections again.");
        const ai = item.aiMaskId ? saved.find(mask => String(mask._id) === item.aiMaskId) : undefined;
        if (!stopped) setMasks({ edited, ai });
      } catch (error) {
        if (!stopped) setProblem(error instanceof Error ? error.message : "The preview could not be loaded.");
      }
    })();
    return () => {
      stopped = true;
    };
  }, [item]);

  const current = item?.slices[index];

  useEffect(() => {
    if (!item || !current || !masks) return;
    let stopped = false;
    void sliceImageUrl(item.projectId, current.frameindex, current.sliceindex).then(url => {
      if (!stopped) setImageUrl(url);
    });
    return () => {
      stopped = true;
    };
  }, [item, current, masks]);

  const labels = useMemo(() => {
    if (!item || !current || !masks) return null;
    const at = (mask: BaseSegmentationMask | undefined) => mask
      ? labelMap(entriesAt(mask, current.frameindex, current.sliceindex), item.width, item.height, rleDecodeToArray)
      : null;
    return { correction: at(masks.edited), ai: at(masks.ai) };
  }, [item, current, masks]);

  const overlays = useMemo<Overlay[]>(() => {
    if (!labels?.correction) return [];
    const shown = view === "ai" && labels.ai ? labels.ai : labels.correction;
    const layers: Overlay[] = [{ labels: shown, palette: LABEL_PALETTE, alpha: 0.45 }];
    if (highlight && labels.ai) {
      layers.push({ labels: differences(labels.ai, labels.correction), palette: { 1: CHANGE_COLOR }, alpha: 0.95 });
    }
    return layers;
  }, [labels, view, highlight]);

  const imageBox = item ? { maxWidth: `calc(${IMAGE_HEIGHT} * ${item.width / Math.max(item.height, 1)})` } : undefined;

  return (
    <Dialog open={item !== null} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-5xl">
        {item && current && (
          <>
            <DialogHeader>
              <DialogTitle>{item.projectName} · {MODEL_NAMES[item.model] ?? item.model}</DialogTitle>
              <DialogDescription>
                {item.slices.length} corrected {item.slices.length === 1 ? "slice" : "slices"} ·{" "}
                {item.pixelsChanged.toLocaleString()} pixels changed in all
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
              <div className="flex items-start justify-center">
                {problem ? (
                  <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription></Alert>
                ) : masks ? (
                  <div className="w-full" style={imageBox}>
                    <SliceCanvas
                      imageUrl={imageUrl}
                      width={item.width}
                      height={item.height}
                      overlays={overlays}
                      label={`${view === "ai" ? "AI result" : "Your correction"}, frame ${current.frameindex + 1}, slice ${current.sliceindex + 1}`}
                    />
                  </div>
                ) : (
                  <div className="flex w-full items-center justify-center rounded-md bg-muted"
                       style={{ ...imageBox, aspectRatio: `${item.width} / ${item.height}` }}>
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-5">
                <div className="space-y-1">
                  <p className="font-medium">Frame {current.frameindex + 1}, slice {current.sliceindex + 1}</p>
                  <p className="text-sm text-muted-foreground">
                    {current.pixelsChanged.toLocaleString()} pixels changed
                    {current.editedClasses.length
                      ? ` (${current.editedClasses.map(name => CASE_STRUCTURE_NAMES[name] ?? name).join(", ")})`
                      : ""}
                  </p>
                </div>

                <div className="space-y-2">
                  <Heading>Show</Heading>
                  <ToggleGroup type="single" variant="outline" size="sm" value={view} className="w-full"
                               onValueChange={value => { if (value) setView(value as View); }}>
                    <ToggleGroupItem value="ai" disabled={!labels?.ai} className="flex-1">AI result</ToggleGroupItem>
                    <ToggleGroupItem value="correction" className="flex-1">Your correction</ToggleGroupItem>
                  </ToggleGroup>
                  <label className="flex items-center justify-between gap-2 pt-1 text-sm">
                    <span>
                      Highlight changes
                      <span className="block text-xs text-muted-foreground">The pixels you changed, in yellow</span>
                    </span>
                    <Switch checked={highlight} onCheckedChange={setHighlight} disabled={!labels?.ai} />
                  </label>
                  {masks && !masks.ai && (
                    <p className="text-xs text-muted-foreground">
                      The AI result of this case was not kept, so only your correction can be shown.
                    </p>
                  )}
                </div>

                <MaskLegend extras={highlight ? [{ label: "Changed pixels", color: "#facc15" }] : []} />

                <div className="space-y-2">
                  <Heading>Corrected slices</Heading>
                  <div className="flex flex-wrap gap-1.5">
                    {item.slices.map((slice, position) => (
                      <Button
                        key={`${slice.frameindex}:${slice.sliceindex}`}
                        size="sm"
                        variant={position === index ? "default" : "outline"}
                        className="h-7 px-2 text-xs tabular-nums"
                        onClick={() => setIndex(position)}
                        aria-label={`Frame ${slice.frameindex + 1}, slice ${slice.sliceindex + 1}`}
                      >
                        F{slice.frameindex + 1} · S{slice.sliceindex + 1}
                      </Button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => setIndex(index - 1)}>
                      <ChevronLeft className="mr-1 h-4 w-4" />
                      Previous
                    </Button>
                    <span className="text-xs text-muted-foreground tabular-nums">{index + 1} / {item.slices.length}</span>
                    <Button variant="ghost" size="sm" disabled={index >= item.slices.length - 1} onClick={() => setIndex(index + 1)}>
                      Next
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="mt-auto space-y-3 border-t pt-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={selected && !item.frozen} disabled={locked}
                              onCheckedChange={value => onSelectedChange(value === true)} />
                    Include this case in training
                  </label>
                  {item.frozen && (
                    <p className="text-xs text-muted-foreground">
                      This is a test scan: every new version is tested on it, so it is not used for training.
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Button asChild variant="outline">
                      <Link href={editorHref(item.projectId, item.model, current.frameindex, current.sliceindex)} onClick={markEdited}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit slice
                      </Link>
                    </Button>
                    <Button onClick={onClose}>Done</Button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
