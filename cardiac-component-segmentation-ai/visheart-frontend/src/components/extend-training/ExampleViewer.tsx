"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { DATASET_NAMES, ExampleIndex, ExampleScan, ModelVersion, retrainingApi } from "@/lib/retraining-api";
import { differences, exampleSides, exampleTitle, outline } from "@/components/extend-training/logic";
import { CHANGE_COLOR, LABEL_PALETTE, MaskLegend, OUTLINE_COLOR, Overlay, SliceCanvas } from "@/components/extend-training/SliceCanvas";

interface DecodedSlice {
  truth: Uint8Array;
  left: Uint8Array;
  right: Uint8Array;
}

interface Sides {
  left: string;
  right: string;
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

/** What the right-hand version is to the user, for its caption. The left is always the model in use. */
function roleOf(version: ModelVersion | undefined, label: string): string {
  if (version?.label === label) return "New version";
  if (version?.is_original) return "Original model";
  return "Another version";
}

/**
 * Scans neither version was trained on, predicted by two versions side by side (plan WS13 R1). The model in use, the
 * one new segmentations get, is always on the left. The right is any other version that was not deleted, starting with
 * the one under review, so both sides are never the same version. The worker predicts these scans once with a version
 * other than this one and the one it was compared with in training, and keeps them.
 */
export function ExampleViewer({ label, against, active, index, versions }: {
  label: string;
  against: string;
  active: string;
  index: ExampleIndex | null;
  versions: ModelVersion[];
}) {
  const trainedAgainst = index?.against ?? against;
  const sides = useMemo(() => exampleSides(versions, active, label, trainedAgainst),
                        [versions, active, label, trainedAgainst]);
  const [right, setRight] = useState<string | null>(sides.initial);
  const [prepared, setPrepared] = useState<string[]>([]);   // versions the worker predicted these scans with
  const [shown, setShown] = useState<Sides | null>(null);   // the two versions whose pictures are ready
  const [preparing, setPreparing] = useState<string | null>(null);
  const [n, setN] = useState<number | null>(index?.examples[0]?.n ?? null);
  const lastScan = useRef<number | null>(null);   // switching versions keeps the slice; another scan starts mid-way
  const [scan, setScan] = useState<ExampleScan | null>(null);
  const [decoded, setDecoded] = useState<DecodedSlice[] | null>(null);
  const [slice, setSlice] = useState(0);
  const [disagreement, setDisagreement] = useState(false);
  const [expert, setExpert] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setN(index?.examples[0]?.n ?? null);
  }, [index]);

  // Another model put in use: it takes the left, so the right starts again from its default.
  useEffect(() => {
    setRight(sides.initial);
  }, [active, sides.initial]);

  // A right-hand version deleted meanwhile is no longer offered.
  useEffect(() => {
    if (right !== null && !sides.options.some(version => version.label === right)) setRight(sides.initial);
  }, [right, sides]);

  // Both sides' pictures, made once by the worker when neither this version nor its training comparison (about half a
  // minute each), then kept.
  useEffect(() => {
    if (right === null || right === active) return;
    const ready = (version: string) => version === label || version === trainedAgainst || prepared.includes(version);
    const missing = [active, right].find(version => !ready(version));
    if (!missing) {
      setShown(current => (current?.left === active && current.right === right ? current : { left: active, right }));
      return;
    }
    let stopped = false;
    setPreparing(missing);
    setProblem(null);
    void retrainingApi.compareExamples(label, missing).then(reply => {
      if (stopped) return;
      setPreparing(null);
      if (reply.success) {
        setPrepared(current => [...current, missing]);
      } else {
        setProblem(reply.message);
        if (missing === right && shown) setRight(shown.right);   // back to the pictures that are shown
      }
    });
    return () => {
      stopped = true;
      setPreparing(null);
    };
  }, [active, right, label, trainedAgainst, prepared, shown]);

  useEffect(() => {
    setScan(null);
    setDecoded(null);
    setProblem(null);
    if (n === null || shown === null) return;
    let stopped = false;
    void (async () => {
      const reply = await retrainingApi.example(label, n, shown);
      if (stopped) return;
      if (!reply.success || !reply.data) {
        setProblem(reply.message);
        return;
      }
      const data = reply.data;
      try {
        const slices = await Promise.all(data.slices.map(async item => ({
          truth: await readLabels(item.truth, data.size),
          left: await readLabels(item.left, data.size),
          right: await readLabels(item.right, data.size),
        })));
        if (stopped) return;
        setScan(data);
        setDecoded(slices);
        setSlice(current => (lastScan.current === n ? Math.min(current, data.count - 1) : Math.floor(data.count / 2)));
        lastScan.current = n;
      } catch (error) {
        if (!stopped) setProblem(error instanceof Error ? error.message : "The example scan could not be shown.");
      }
    })();
    return () => {
      stopped = true;
    };
  }, [label, n, shown]);

  const current = decoded?.[slice];
  const overlays = useMemo(() => {
    if (!current || !scan) return null;
    const shared: Overlay[] = [];
    if (disagreement) shared.push({ labels: differences(current.left, current.right), palette: { 1: CHANGE_COLOR }, alpha: 0.9 });
    if (expert) shared.push({ labels: outline(current.truth, scan.size, scan.size), palette: { 1: OUTLINE_COLOR }, alpha: 1 });
    return {
      left: [{ labels: current.left, palette: LABEL_PALETTE, alpha: 0.45 }, ...shared],
      right: [{ labels: current.right, palette: LABEL_PALETTE, alpha: 0.45 }, ...shared],
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
  if (sides.initial === null) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        There is no other version to compare the model in use with.
      </div>
    );
  }

  const extras = [
    ...(disagreement ? [{ label: "Disagreement", color: "#facc15", outline: false }] : []),
    ...(expert ? [{ label: "Expert outline", color: "#ffffff", outline: true }] : []),
  ];
  const isOriginal = (name: string) => versions.some(version => version.label === name && version.is_original);

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
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Compare the model in use with</span>
            <Select value={right ?? undefined} onValueChange={(value: string) => setRight(value)} disabled={preparing !== null}>
              <SelectTrigger className="h-8 min-w-56 max-w-full" aria-label="Choose the version to compare the model in use with">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sides.options.map(version => (
                  <SelectItem key={version.label} value={version.label}>
                    {version.label}
                    <span className="ml-1 text-muted-foreground">
                      {version.label === label ? "(this version)" : version.is_original ? "(original)" : ""}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
      {preparing && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparing {preparing}&apos;s predictions on these scans: they are made once, which takes about half a minute.
        </p>
      )}
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
                <span className="font-medium" title="New segmentations use this model">Model in use</span>
                <span className="truncate text-xs text-muted-foreground">
                  {scan.left_label}{isOriginal(scan.left_label) ? " (original)" : ""}
                </span>
              </figcaption>
              <SliceCanvas imageUrl={scan.slices[slice].image} width={scan.size} height={scan.size}
                           overlays={overlays.left} label={`${scan.left_label}, slice ${slice + 1}`} />
            </figure>
            <figure className="space-y-1.5">
              <figcaption className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">
                  {roleOf(versions.find(version => version.label === scan.right_label), label)}
                </span>
                <span className="truncate text-xs text-muted-foreground">{scan.right_label}</span>
              </figcaption>
              <SliceCanvas imageUrl={scan.slices[slice].image} width={scan.size} height={scan.size}
                           overlays={overlays.right} label={`${scan.right_label}, slice ${slice + 1}`} />
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
