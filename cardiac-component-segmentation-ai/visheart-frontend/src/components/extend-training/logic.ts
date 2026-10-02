/**
 * The Extend Training page's decisions that need no browser (plan WS13 R1): what starts selected, what a search
 * matches, how a comparison is put into words, how numbers read, and how saved masks become pixels. It imports
 * nothing, so tests/extend-training-logic.test.mjs can load it with the TypeScript compiler alone.
 */

export interface SelectableCase {
  maskId: string;
  projectName: string;
  model: string;
  slices: unknown[];
  frozen?: unknown;
}

/** The cases that can train: a frozen test patient's are listed, locked, and never chosen. */
export function trainableCases<C extends SelectableCase>(cases: C[]): C[] {
  return cases.filter(item => !item.frozen);
}

/** Every case starts selected, except the ones this browser remembers the user clearing. */
export function initialSelection(maskIds: string[], cleared: string[]): string[] {
  const skip = new Set(cleared);
  return maskIds.filter(id => !skip.has(id));
}

/** What to remember as cleared: every listed case that is not selected. A case no longer listed is forgotten. */
export function clearedCases(maskIds: string[], selected: Set<string>): string[] {
  return maskIds.filter(id => !selected.has(id));
}

export function selectionSummary(cases: SelectableCase[], selected: Set<string>): { cases: number; slices: number } {
  const chosen = cases.filter(item => selected.has(item.maskId));
  return { cases: chosen.length, slices: chosen.reduce((sum, item) => sum + item.slices.length, 0) };
}

/** Every word of the query appears in the project name or the model. */
export function matchesQuery(item: SelectableCase, query: string): boolean {
  const text = `${item.projectName} ${item.model}`.toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean).every(word => text.includes(word));
}

export interface GateRowLike {
  complete: boolean;
  lower?: boolean;
  mean_delta_cardiac?: number;
}

export type Tone = "good" | "mixed" | "bad";

const SAME_BAND = 0.0005; // under 0.05 accuracy points a change reads "about the same", unless the gate says lower

function listNames(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "Better on M&Ms-2. About the same on M&Ms-1. Lower on ACDC." It follows the gate (D3) and leaves nothing out. */
export function verdict(rows: Record<string, GateRowLike>, names: Record<string, string>): { tone: Tone; text: string } {
  const better: string[] = [];
  const same: string[] = [];
  const lower: string[] = [];
  const incomplete: string[] = [];
  for (const [key, row] of Object.entries(rows)) {
    const name = names[key] ?? key;
    if (!row.complete) incomplete.push(name);
    else if (row.lower) lower.push(name);
    else if ((row.mean_delta_cardiac ?? 0) >= SAME_BAND) better.push(name);
    else same.push(name);
  }
  const parts = [
    better.length ? `Better on ${listNames(better)}.` : "",
    same.length ? `About the same on ${listNames(same)}.` : "",
    lower.length ? `Lower on ${listNames(lower)}.` : "",
    incomplete.length ? `Not fully scored on ${listNames(incomplete)}.` : "",
  ].filter(Boolean);
  const problems = lower.length + incomplete.length;
  return { tone: problems === 0 ? "good" : better.length ? "mixed" : "bad", text: parts.join(" ") || "Not compared yet." };
}

/** A Dice score as accuracy: 0.90129 reads "90.1%". */
export function percent(value: number | undefined): string {
  return value === undefined || Number.isNaN(value) ? "—" : `${(value * 100).toFixed(1)}%`;
}

function roundedPoints(value: number): number {
  return Number((value * 100).toFixed(1));
}

/** A change in Dice as accuracy points: -0.0131 reads "−1.3 pts". */
export function points(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  const rounded = roundedPoints(value);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(1)} pts`;
}

export function changeTone(value: number | undefined): "up" | "down" | "flat" {
  if (value === undefined || Number.isNaN(value)) return "flat";
  const rounded = roundedPoints(value);
  return rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
}

/** The example picker's words for a scan's rank: "Lowest change (−4.1 pts)". */
export function exampleTitle(role: string, delta: number): string {
  const rank = role === "lowest" ? "Lowest change" : role === "highest" ? "Highest change" : "Median change";
  return `${rank} (${points(delta)})`;
}

export type Rgb = [number, number, number];

/** Edit tracking's class names as training labels; 0 is background. "manual" is no label: such slices never train. */
export const LABEL_OF: Record<string, number> = { rv: 1, myo: 2, lvc: 3, lv: 3 };

/**
 * One label per pixel (0 background, 1 RV, 2 myocardium, 3 LV cavity) from a slice's saved RLE masks, as training
 * labels it (build_training_volumes.py label_slice): where two classes overlap, the first one written wins. So the
 * preview's changes are the pixels whose training label changed, the count the server reports.
 */
export function labelMap(entries: { class: string; segmentationmaskcontents: string }[] | undefined,
                         width: number, height: number,
                         decode: (rle: string, height: number, width: number) => Uint8Array): Uint8Array {
  const labels = new Uint8Array(width * height);
  for (const entry of entries ?? []) {
    const label = LABEL_OF[String(entry.class).toLowerCase()];
    if (!label || !entry.segmentationmaskcontents) continue;
    const mask = decode(entry.segmentationmaskcontents, height, width);
    for (let i = 0; i < labels.length; i++) if (mask[i] && !labels[i]) labels[i] = label;
  }
  return labels;
}

/** 1 where two label maps disagree. */
export function differences(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] !== b[i] ? 1 : 0;
  return out;
}

/** 1 on the edge of every labelled region: a labelled pixel beside another label or the image border. */
export function outline(labels: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(labels.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const here = labels[i];
      if (!here) continue;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || labels[i - 1] !== here
          || labels[i + 1] !== here || labels[i - width] !== here || labels[i + width] !== here) {
        out[i] = 1;
      }
    }
  }
  return out;
}

/** Paint labels into an RGBA buffer; alpha is 0 to 1. Pixels without a colour are left as they are. */
export function paintLabels(rgba: Uint8ClampedArray, labels: Uint8Array, palette: Record<number, Rgb>, alpha: number): void {
  const opacity = Math.round(alpha * 255);
  for (let i = 0; i < labels.length; i++) {
    const color = palette[labels[i]];
    if (!color) continue;
    const p = i * 4;
    rgba[p] = color[0];
    rgba[p + 1] = color[1];
    rgba[p + 2] = color[2];
    rgba[p + 3] = opacity;
  }
}

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** The editor at exactly this mask, frame and slice (plan WS13 R1's deep link). */
export function editorHref(projectId: string, model: string, frame: number, slice: number): string {
  const query = new URLSearchParams({ model, frame: String(frame), slice: String(slice), from: "extend-training" });
  return `/project/${encodeURIComponent(projectId)}/segmentation?${query.toString()}`;
}

export interface VersionLike {
  label: string;
  status: string;
  is_active: boolean;
  is_original: boolean;
  registered_at: string | null;
}

/** Which version Results shows first: the last training's, else the newest one waiting, else a trained one in use. */
export function reviewLabel(versions: VersionLike[], lastResult: string | null | undefined): string | null {
  const alive = versions.filter(version => version.status !== "deleted");
  if (lastResult && alive.some(version => version.label === lastResult)) return lastResult;
  const waiting = alive.filter(version => version.status === "candidate")
    .sort((a, b) => String(b.registered_at).localeCompare(String(a.registered_at)));
  if (waiting.length) return waiting[0].label;
  return alive.find(version => version.is_active && !version.is_original)?.label ?? null;
}

export interface VersionFate {
  label: string;
  status: string;
  deleted_because?: string | null;
}

/** What the finished training's card says, from what has happened to its version since. */
export function jobOutcome(label: string, active: string, versions: VersionFate[]): { title: string; text: string } {
  if (label === active) {
    return { title: `${label} is in use`,
             text: "You chose to use it. The original model is always kept, and the version history can bring it back." };
  }
  const version = versions.find(item => item.label === label);
  if (version?.status === "deleted") {
    const why = version.deleted_because ? `It was ${version.deleted_because}.` : "It was deleted.";
    return { title: `${label} was deleted`, text: `${why} The model in use is ${active}.` };
  }
  return { title: `${label} is ready for review`,
           text: "Its results are below. Nothing has changed yet: the model in use stays active until you choose." };
}
