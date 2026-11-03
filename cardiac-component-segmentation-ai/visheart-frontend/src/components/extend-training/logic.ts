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
  ownerName?: string | null;
}

const TEST_SET_NAMES: Record<string, string> = { acdc: "ACDC", mms1: "M&Ms-1", mms2: "M&Ms-2" };

/** A frozen-set match ("acdc/patient108_frame01.nii.gz#z0") in words: "the ACDC scan patient108_frame01". */
export function testScanName(frozen: string): string {
  const [dataset, file] = frozen.split("/");
  if (!dataset || !file) return "a test scan";
  const scan = file.replace(/#z\d+$/, "").replace(/\.nii(\.gz)?$/, "");
  return `the ${TEST_SET_NAMES[dataset] ?? dataset} scan ${scan}`;
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

/** Every word of the query appears in the project name, the model or the owner's name. */
export function matchesQuery(item: SelectableCase, query: string): boolean {
  const text = `${item.projectName} ${item.model} ${item.ownerName ?? ""}`.toLowerCase();
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

/**
 * The example scan shown for the dataset chosen above the results table: the one of the same kind (lowest, median or
 * highest change) as the scan shown before, so switching dataset compares like with like; else the dataset's first.
 */
export function exampleFor(examples: { n: number; dataset: string; role: string }[], dataset: string,
                           role: string | null): number | null {
  const mine = examples.filter(entry => entry.dataset === dataset);
  return (mine.find(entry => entry.role === role) ?? mine[0])?.n ?? null;
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

/** The label disagreementLabels gives a pixel this prediction leaves as background while the other labels it. */
export const LEFT_OUT = 5;

/**
 * Where two predictions differ, this one's answer: its own label, or LEFT_OUT where it has none and the other has one;
 * 0 where they agree. Each side of the viewer paints its own, so the two pictures differ exactly where the models do
 * (one shared layer over both would hide what each model said there).
 */
export function disagreementLabels(own: Uint8Array, other: Uint8Array): Uint8Array {
  const out = new Uint8Array(own.length);
  for (let i = 0; i < own.length; i++) if (own[i] !== other[i]) out[i] = own[i] || LEFT_OUT;
  return out;
}

/** Where two predictions differ, how many pixels this one gives each label (0: it labels nothing there). */
export function disagreementSummary(own: Uint8Array, other: Uint8Array): Record<number, number> {
  const counts: Record<number, number> = {};
  for (let i = 0; i < own.length; i++) if (own[i] !== other[i]) counts[own[i]] = (counts[own[i]] ?? 0) + 1;
  return counts;
}

/** How many pixels two predictions label differently. */
export function countDifferences(a: Uint8Array, b: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
  return count;
}

export interface Box {
  x: number;
  y: number;
  size: number;
}

/**
 * The square around every labelled pixel of these label maps, with a margin on each side, inside the image: the "Zoom
 * to the heart" view. Given every slice of a scan, it is one box for all of them, so paging through the slices does not
 * move the picture. Null when nothing is labelled.
 */
export function heartBox(maps: Uint8Array[], width: number, height: number, margin = 0.35, least = 48): Box | null {
  let left = width, top = height, right = -1, bottom = -1;
  for (const labels of maps) {
    for (let i = 0; i < labels.length; i++) {
      if (!labels[i]) continue;
      const x = i % width, y = (i - x) / width;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return null;
  const span = Math.max(right - left + 1, bottom - top + 1);
  const size = Math.min(Math.max(Math.ceil(span * (1 + 2 * margin)), least), width, height);
  const clamp = (start: number, extent: number) => Math.min(Math.max(start, 0), extent - size);
  return {
    x: clamp(Math.round((left + right + 1) / 2 - size / 2), width),
    y: clamp(Math.round((top + bottom + 1) / 2 - size / 2), height),
    size,
  };
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

/**
 * Whether the signed-in user may edit this case: only its project's owner may, admins included (the client's request,
 * 2026-10-08). Everyone else previews it. The server refuses anyone else's save too.
 */
export function canEditCase(item: { ownerId?: string | null }, userId: string | null | undefined): boolean {
  return Boolean(userId) && item.ownerId === userId;
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

/**
 * The whole heart over every scored scan of every dataset: each dataset's mean of the three structures (as the table's
 * "Whole heart" row), weighted by its number of scans. Null when no dataset was scored.
 */
export function overallAccuracy(
  datasets: Record<string, { n: number; against: Record<string, number>; label: Record<string, number> }> | null | undefined,
): { datasets: number; scans: number; against: number; label: number } | null {
  const rows = Object.values(datasets ?? {}).filter(row => row.n > 0);
  const scans = rows.reduce((sum, row) => sum + row.n, 0);
  if (!scans) return null;
  const heart = (scores: Record<string, number>) => (scores.rv + scores.myocardium + scores.lv_cavity) / 3;
  const mean = (side: "against" | "label") => rows.reduce((sum, row) => sum + row.n * heart(row[side]), 0) / scans;
  return { datasets: rows.length, scans, against: mean("against"), label: mean("label") };
}

export const HISTORY_ROWS = 10;

/**
 * The version history's rows: all of them when expanded, else at most `limit`, keeping the table's order. The version
 * in use and the original always stay, so "Back to the original model" is always one click away.
 */
export function historyRows<V extends VersionLike>(sorted: V[], expanded: boolean,
                                                   limit: number = HISTORY_ROWS): { rows: V[]; hidden: number } {
  if (expanded || sorted.length <= limit) return { rows: sorted, hidden: 0 };
  const pinned = new Set(sorted.filter(version => version.is_active || version.is_original).map(version => version.label));
  const others = sorted.filter(version => !pinned.has(version.label)).slice(0, Math.max(0, limit - pinned.size));
  const keep = new Set([...pinned, ...others.map(version => version.label)]);
  const rows = sorted.filter(version => keep.has(version.label));
  return { rows, hidden: sorted.length - rows.length };
}

export const TRAINING_RUNNING = "A training is running. Versions can be changed when it has finished.";

/**
 * Why versions cannot be switched here, or null when they can: a running training, or a problem the service found
 * with this computer's original model or active slot (status.problem). Versions whose model file is not on this
 * computer are never listed, so they need no reason.
 */
export function whyNotSwitch(problem: string | null | undefined, busy: boolean): string | null {
  if (busy) return TRAINING_RUNNING;
  if (problem) return `Versions cannot be switched on this computer: ${problem}.`;
  return null;
}

/**
 * What the scan viewer offers for the version it compares with the model in use: using it, and deleting it unless
 * it is the original, which is always kept. Nothing for the version in use, which has nothing to compare with.
 */
export function decisionFor(version: { label: string; status: string; is_original: boolean },
                            active: string): { use: boolean; remove: boolean } | null {
  if (version.label === active || version.status === "deleted") return null;
  return { use: true, remove: version.status === "candidate" && !version.is_original };
}

/** Every version not deleted except `except`: in use, original, then newest. */
export function compareOptions<V extends VersionLike>(versions: V[], except: string): V[] {
  const rank = (version: V) => (version.is_active ? 0 : version.is_original ? 1 : 2);
  return versions
    .filter(version => version.status !== "deleted" && version.label !== except)
    .sort((a, b) => rank(a) - rank(b) || String(b.registered_at).localeCompare(String(a.registered_at)));
}

/**
 * The example viewer's two sides. The model in use, the one new segmentations get, is always on the left. The right is
 * any other version not deleted, so the two are never the same: it starts on the version under review, or, when that
 * is the one in use, on the version it was compared with, else the original.
 */
export function exampleSides<V extends VersionLike>(versions: V[], active: string, label: string,
                                                    trainedAgainst: string | null): { options: V[]; initial: string | null } {
  const options = compareOptions(versions, active)
    .sort((a, b) => Number(b.label === label) - Number(a.label === label));   // stable: the rest keep their order
  const offered = (name: string | null) => name !== null && options.some(version => version.label === name);
  const initial = offered(label) ? label : offered(trainedAgainst) ? trainedAgainst : options[0]?.label ?? null;
  return { options, initial };
}
