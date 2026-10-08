"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DATASET_NAMES, ExampleIndex, ExampleScan, ModelVersion, retrainingApi, VersionAction } from "@/lib/retraining-api";
import {
  countDifferences, decisionFor, disagreementLabels, disagreementSummary, exampleFor, exampleSides, exampleTitle, heartBox,
  LEFT_OUT, outline,
} from "@/components/extend-training/logic";
import { CHANGE_COLOR, LABEL_PALETTE, MaskLegend, OUTLINE_COLOR, Overlay, SliceCanvas } from "@/components/extend-training/SliceCanvas";

const DISAGREEMENT_PALETTE = { ...LABEL_PALETTE, [LEFT_OUT]: CHANGE_COLOR };
const ANSWER_NAMES: Record<number, string> = { 1: "right ventricle", 2: "myocardium", 3: "left ventricle cavity", 0: "nothing" };

/** "myocardium 98 px · nothing 42 px": what one side says where the two differ, the largest first. */
function answerLine(counts: Record<number, number>): string {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${ANSWER_NAMES[Number(label)] ?? `label ${label}`} ${count.toLocaleString()} px`).join(" · ");
}

interface DecodedSlice {
  truth: Uint8Array;
  left: Uint8Array;
  right: Uint8Array;
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

/**
 * Scans neither version was trained on, predicted by two versions side by side (plan WS13 R1). The model in use, the
 * one new segmentations get, is always on the left; the version under review is on the right, and the choice above
 * the pictures picks it, so the page, the pictures and the decision are always about the same version. A version
 * made before the page has no example scans: the worker makes them the first time it is compared (about a minute),
 * and predicts them with the model in use when that is not the version it was compared with in training.
 * Using or deleting the version is offered under the pictures, once they are shown. The dataset is the one chosen above
 * the results table, so the table and the pictures are always about the same scans.
 */
export function ExampleViewer({ label, against, active, index, dataset, versions, onChoose, onAction, cannotSwitch, busy }: {
  label: string;
  against: string;
  active: string;
  index: ExampleIndex | null;
  dataset: string;
  versions: ModelVersion[];
  onChoose: (label: string) => void;
  onAction: (label: string, action: VersionAction) => void;
  cannotSwitch: string | null;
  busy: boolean;
}) {
  const [scans, setScans] = useState<ExampleIndex | null>(index);   // made here for a version that had none
  const trainedAgainst = scans?.against ?? against;
  const options = useMemo(() => exampleSides(versions, active, label, trainedAgainst).options,
                          [versions, active, label, trainedAgainst]);
  const comparing = label !== active;   // the version in use has nothing to be compared with but itself
  const version = versions.find(item => item.label === label);
  const decision = version ? decisionFor(version, active) : null;
  const [prepared, setPrepared] = useState<string[]>([]);   // versions the worker predicted these scans with
  const [readyFor, setReadyFor] = useState<string | null>(null);   // the model in use whose pictures are ready
  const [preparing, setPreparing] = useState<string | null>(null);
  const [n, setN] = useState<number | null>(exampleFor(index?.examples ?? [], dataset, null));
  const lastScan = useRef<number | null>(null);   // switching versions keeps the slice; another scan starts mid-way
  const [scan, setScan] = useState<ExampleScan | null>(null);
  const [decoded, setDecoded] = useState<DecodedSlice[] | null>(null);
  const [slice, setSlice] = useState(0);
  const [disagreement, setDisagreement] = useState(false);
  const [expert, setExpert] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const examples = scans?.examples ?? [];
    setN(current => exampleFor(examples, dataset, examples.find(entry => entry.n === current)?.role ?? null));
  }, [scans, dataset]);

  // The pictures: this version's example scans (made now if it has none) and the model in use's predictions of them.
  useEffect(() => {
    if (!comparing) return;
    const ready = scans !== null && (active === label || active === scans.against || prepared.includes(active));
    if (ready) {
      setReadyFor(active);
      return;
    }
    let stopped = false;
    setReadyFor(null);
    setPreparing(scans ? active : label);
    setProblem(null);
    void retrainingApi.compareExamples(label, active).then(reply => {
      if (stopped) return;
      setPreparing(null);
      if (reply.success && reply.data) {
        if (reply.data.index) setScans(reply.data.index);
        setPrepared(current => [...current, active]);
      } else {
        setProblem(reply.message);
      }
    });
    return () => {
      stopped = true;
      setPreparing(null);
    };
  }, [comparing, active, label, scans, prepared]);

  const shown = comparing && readyFor === active;
  useEffect(() => {
    setScan(null);
    setDecoded(null);
    if (n === null || !shown) return;
    setProblem(null);
    let stopped = false;
    void (async () => {
      const reply = await retrainingApi.example(label, n, { left: active, right: label });
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
        // Decide now: React runs the updater later, after lastScan has already been set to this scan.
        const sameScan = lastScan.current === n;
        lastScan.current = n;
        setSlice(current => (sameScan ? Math.min(current, data.count - 1) : Math.floor(data.count / 2)));
      } catch (error) {
        if (!stopped) setProblem(error instanceof Error ? error.message : "The example scan could not be shown.");
      }
    })();
    return () => {
      stopped = true;
    };
  }, [label, active, n, shown]);

  const current = decoded?.[slice];
  // One box around the heart in every slice of this scan (both models and the expert), so paging does not move it.
  const box = useMemo(() => (decoded && scan
    ? heartBox(decoded.flatMap(item => [item.truth, item.left, item.right]), scan.size, scan.size)
    : null), [decoded, scan]);
  // Where the two differ: how many pixels, and what each side says there.
  const contrast = useMemo(() => {
    if (!current || !disagreement) return null;
    return {
      count: countDifferences(current.left, current.right),
      left: answerLine(disagreementSummary(current.left, current.right)),
      right: answerLine(disagreementSummary(current.right, current.left)),
    };
  }, [current, disagreement]);
  const overlays = useMemo(() => {
    if (!current || !scan) return null;
    // With disagreement on, the masks stay as they are and each side paints, solid, its own answer where the two
    // differ: its label, or yellow where it leaves out what the other labels.
    const side = (own: Uint8Array, other: Uint8Array): Overlay[] => [
      { labels: own, palette: LABEL_PALETTE, alpha: 0.45 },
      ...(contrast ? [{ labels: disagreementLabels(own, other), palette: DISAGREEMENT_PALETTE, alpha: 1 }] : []),
      ...(expert ? [{ labels: outline(current.truth, scan.size, scan.size), palette: { 1: OUTLINE_COLOR }, alpha: 1 }] : []),
    ];
    return { left: side(current.left, current.right), right: side(current.right, current.left) };
  }, [current, scan, contrast, expert]);

  const chooser = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground">Compare the model in use with</span>
      <Select value={comparing ? label : undefined} onValueChange={(value: string) => onChoose(value)}
              disabled={preparing !== null}>
        <SelectTrigger className="h-8 min-w-56 max-w-full" aria-label="Choose the version to compare the model in use with">
          <SelectValue placeholder="Choose a version" />
        </SelectTrigger>
        <SelectContent>
          {options.map(item => (
            <SelectItem key={item.label} value={item.label}>
              {item.label}
              <span className="ml-1 text-muted-foreground">{item.is_original ? "(original)" : ""}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  if (!comparing) {
    return (
      <div className="space-y-3 rounded-md border border-dashed p-4 text-sm">
        <p className="text-muted-foreground">
          This version is in use, so there is nothing to compare it with here. Choose another version to see it beside
          the model in use.
        </p>
        {options.length > 0 && chooser}
      </div>
    );
  }

  const extras = [
    ...(disagreement ? [{ label: "Left out here, labelled by the other model", color: "#facc15", outline: false }] : []),
    ...(expert ? [{ label: "Expert outline", color: "#ffffff", outline: true }] : []),
  ];
  const isOriginal = (name: string) => versions.some(item => item.label === name && item.is_original);
  const datasetName = DATASET_NAMES[dataset] ?? dataset;
  const mine = scans?.examples.filter(entry => entry.dataset === dataset) ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {chooser}
        <label className="flex items-center gap-2">
          <Switch checked={disagreement} onCheckedChange={setDisagreement} />
          Highlight disagreement
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={expert} onCheckedChange={setExpert} />
          Show expert outline
        </label>
        <label className="flex items-center gap-2">
          <Switch checked={zoom} onCheckedChange={setZoom} />
          Zoom to the heart
        </label>
      </div>
      {problem && <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription></Alert>}
      {preparing && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {preparing === label
            ? `Preparing ${label}'s example scans: made once, from the scans whose score it changed most and least. This takes about a minute.`
            : `Preparing ${preparing}'s predictions on these scans: made once, which takes about half a minute.`}
        </p>
      )}
      {!problem && (n !== null || !scans) && (!scan || !overlays) && (
        <div className="flex h-64 items-center justify-center rounded-md bg-muted">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}
      {scan && overlays && (
        <div className="grid gap-3 md:grid-cols-2">
          <figure className="space-y-1.5">
            <figcaption className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium" title="New segmentations use this model">Model in use</span>
              <span className="truncate text-xs text-muted-foreground">
                {scan.left_label}{isOriginal(scan.left_label) ? " (original)" : ""}
              </span>
            </figcaption>
            <SliceCanvas imageUrl={scan.slices[slice].image} width={scan.size} height={scan.size} crop={zoom ? box : null}
                         overlays={overlays.left} label={`${scan.left_label}, slice ${slice + 1}`} />
            {contrast?.count ? <p className="text-xs text-muted-foreground">Says, where they differ: {contrast.left}</p> : null}
          </figure>
          <figure className="space-y-1.5">
            <figcaption className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{version?.is_original ? "Original model" : "New version"}</span>
              <span className="truncate text-xs text-muted-foreground">{scan.right_label}</span>
            </figcaption>
            <SliceCanvas imageUrl={scan.slices[slice].image} width={scan.size} height={scan.size} crop={zoom ? box : null}
                         overlays={overlays.right} label={`${scan.right_label}, slice ${slice + 1}`} />
            {contrast?.count ? <p className="text-xs text-muted-foreground">Says, where they differ: {contrast.right}</p> : null}
          </figure>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
        {mine.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">{datasetName} scan</span>
            <Select value={n === null ? undefined : String(n)} onValueChange={(value: string) => setN(Number(value))}>
              <SelectTrigger className="h-8 min-w-64 max-w-full" aria-label={`Choose an example scan from ${datasetName}`}>
                <SelectValue placeholder="Choose a scan" />
              </SelectTrigger>
              <SelectContent>
                {mine.map(entry => (
                  <SelectItem key={entry.n} value={String(entry.n)}>
                    {exampleTitle(entry.role, entry.delta)}
                    <span className="ml-1 text-muted-foreground">· {entry.case.replace(/\.nii\.gz$/, "")}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : scans && (
          <span className="text-muted-foreground">No example scans from {datasetName} for this version.</span>
        )}
        {scan && overlays && (
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Previous slice"
                    disabled={slice <= 0} onClick={() => setSlice(value => Math.max(0, value - 1))}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <span className="w-24 text-center tabular-nums">Slice {slice + 1} / {scan.count}</span>
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label="Next slice"
                    disabled={slice >= scan.count - 1} onClick={() => setSlice(value => Math.min(scan.count - 1, value + 1))}>
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      <MaskLegend extras={extras} />
      {contrast && overlays && (
        <p className="text-sm">
          {contrast.count
            ? <><span className="font-medium tabular-nums">{contrast.count.toLocaleString()}</span> pixels differ on this
                slice. Solid colour: what each model says there; yellow: what it leaves out.</>
            : "The two models agree on every pixel of this slice."}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        The dataset is the one chosen above the table. Its scan with the lowest change is always here, so a drop is never
        hidden; the table covers every scan.
      </p>
      {scan && overlays && decision && (
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-medium">{label} is not in use. The decision is yours.</p>
            <p className="text-sm text-muted-foreground">
              {cannotSwitch ?? (version?.is_original
                ? `Going back to the original replaces ${active}. The original model is always kept.`
                : "Nothing changes until you confirm. The original model is always kept.")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="max-w-full whitespace-normal break-all" disabled={Boolean(cannotSwitch)}
                    onClick={() => onAction(label, "activate")}>
              Use {label}
              <ArrowRight className="ml-2 h-4 w-4 shrink-0" />
            </Button>
            {decision.remove && (
              <Button variant="outline" className="max-w-full whitespace-normal break-all" disabled={busy}
                      onClick={() => onAction(label, "reject")}>
                Delete {label}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
