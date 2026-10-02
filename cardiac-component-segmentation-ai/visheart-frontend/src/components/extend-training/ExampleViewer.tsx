"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { DATASET_NAMES, ExampleIndex, ExampleScan, retrainingApi } from "@/lib/retraining-api";
import { differences, exampleTitle, outline } from "@/components/extend-training/logic";
import { CHANGE_COLOR, LABEL_PALETTE, MaskLegend, OUTLINE_COLOR, Overlay, SliceCanvas } from "@/components/extend-training/SliceCanvas";

interface DecodedSlice {
  truth: Uint8Array;
  against: Uint8Array;
  label: Uint8Array;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("An example image could not be read."));
    image.src = source;
  });
}

/** A PNG of labels 0–3, as render_examples.py writes it, back to one label per pixel. */
async function readLabels(source: string, size: number): Promise<Uint8Array> {
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser cannot read the example images.");
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, size, size).data;
  const labels = new Uint8Array(size * size);
  for (let i = 0; i < labels.length; i++) labels[i] = pixels[i * 4];
  return labels;
}

/** Scans neither version was trained on, predicted by both, side by side (plan WS13 R1). */
export function ExampleViewer({ label, against, index }: { label: string; against: string; index: ExampleIndex | null }) {
  const [n, setN] = useState<number | null>(index?.examples[0]?.n ?? null);
  const [scan, setScan] = useState<ExampleScan | null>(null);
  const [decoded, setDecoded] = useState<DecodedSlice[] | null>(null);
  const [slice, setSlice] = useState(0);
  const [disagreement, setDisagreement] = useState(false);
  const [expert, setExpert] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setN(index?.examples[0]?.n ?? null);
  }, [index]);

  useEffect(() => {
    setScan(null);
    setDecoded(null);
    setProblem(null);
    if (n === null) return;
    let stopped = false;
    void (async () => {
      const reply = await retrainingApi.example(label, n);
      if (stopped) return;
      if (!reply.success || !reply.data) {
        setProblem(reply.message);
        return;
      }
      const data = reply.data;
      try {
        const slices = await Promise.all(data.slices.map(async item => ({
          truth: await readLabels(item.truth, data.size),
          against: await readLabels(item.against, data.size),
          label: await readLabels(item.label, data.size),
        })));
        if (stopped) return;
        setScan(data);
        setDecoded(slices);
        setSlice(Math.floor(data.count / 2));
      } catch (error) {
        if (!stopped) setProblem(error instanceof Error ? error.message : "The example scan could not be shown.");
      }
    })();
    return () => {
      stopped = true;
    };
  }, [label, n]);

  const current = decoded?.[slice];
  const overlays = useMemo(() => {
    if (!current || !scan) return null;
    const shared: Overlay[] = [];
    if (disagreement) shared.push({ labels: differences(current.against, current.label), palette: { 1: CHANGE_COLOR }, alpha: 0.9 });
    if (expert) shared.push({ labels: outline(current.truth, scan.size, scan.size), palette: { 1: OUTLINE_COLOR }, alpha: 1 });
    return {
      against: [{ labels: current.against, palette: LABEL_PALETTE, alpha: 0.45 }, ...shared],
      label: [{ labels: current.label, palette: LABEL_PALETTE, alpha: 0.45 }, ...shared],
    };
  }, [current, scan, disagreement, expert]);

  if (!index || index.examples.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        No example scans for this version. Versions trained from this page get them automatically; this one was made
        before that, so only its numbers are shown.
      </div>
    );
  }

  const extras = [
    ...(disagreement ? [{ label: "Disagreement", color: "#facc15", outline: false }] : []),
    ...(expert ? [{ label: "Expert outline", color: "#ffffff", outline: true }] : []),
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Select value={n === null ? undefined : String(n)} onValueChange={(value: string) => setN(Number(value))}>
          <SelectTrigger className="w-full lg:w-[30rem]" aria-label="Choose an example scan">
            <SelectValue placeholder="Choose a scan" />
          </SelectTrigger>
          <SelectContent>
            {index.examples.map(entry => (
              <SelectItem key={entry.n} value={String(entry.n)}>
                {DATASET_NAMES[entry.dataset] ?? entry.dataset} · {exampleTitle(entry.role, entry.delta)} ·{" "}
                {entry.case.replace(/\.nii\.gz$/, "")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <Switch checked={disagreement} onCheckedChange={setDisagreement} />
            Highlight disagreement
          </label>
          <label className="flex items-center gap-2">
            <Switch checked={expert} onCheckedChange={setExpert} />
            Show expert outline
          </label>
        </div>
      </div>
      {problem && <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription></Alert>}
      {!problem && (!scan || !overlays) && (
        <div className="flex h-64 items-center justify-center rounded-md bg-muted">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {scan && overlays && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <figure className="space-y-1.5">
              <figcaption className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">Model in use</span>
                <span className="truncate text-xs text-muted-foreground">{against}</span>
              </figcaption>
              <SliceCanvas imageUrl={scan.slices[slice].image} width={scan.size} height={scan.size}
                           overlays={overlays.against} label={`${against}, slice ${slice + 1}`} />
            </figure>
            <figure className="space-y-1.5">
              <figcaption className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">New version</span>
                <span className="truncate text-xs text-muted-foreground">{label}</span>
              </figcaption>
              <SliceCanvas imageUrl={scan.slices[slice].image} width={scan.size} height={scan.size}
                           overlays={overlays.label} label={`${label}, slice ${slice + 1}`} />
            </figure>
          </div>
          <div className="flex items-center gap-4">
            <span className="w-28 shrink-0 text-sm tabular-nums">Slice {slice + 1} / {scan.count}</span>
            <Slider value={[slice]} min={0} max={Math.max(0, scan.count - 1)} step={1}
                    onValueChange={([value]) => setSlice(value)} aria-label="Slice" />
          </div>
        </>
      )}
      <MaskLegend extras={extras} />
      <p className="text-xs text-muted-foreground">
        These scans include each dataset&apos;s lowest change, so a drop is never hidden. The table above covers every scan.
      </p>
    </div>
  );
}
