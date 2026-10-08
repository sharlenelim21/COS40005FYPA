import { AxiosResponse } from "axios";
import api from "@/lib/api";

// Types mirror visheart-retraining/worker.py's replies (plan WS13).
export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export type StepState = "pending" | "running" | "done" | "failed" | "cancelled" | "interrupted";
export type VersionAction = "activate" | "reject";

export interface JobStep {
  key: string;
  title: string;
  state: StepState;
  started_at: string | null;
  finished_at: string | null;
}

export interface CaseSlice {
  frameindex: number;
  sliceindex: number;
  pixelsChanged: number;
  editedClasses: string[];
}

/** One corrected case on Prepare: a project's saved correction in one model (the export's dry run, plan WS13 R1). */
export interface CorrectionCase {
  maskId: string;
  projectId: string;
  projectName: string;
  model: "unet" | "medsam";
  aiMaskId: string | null;
  editedAt: string | null;
  height: number;
  width: number;
  slices: CaseSlice[];
  pixelsChanged: number;
  structures: string[];
  shared: number;
  /** The project is a scan of the frozen test set: listed so the user sees it, but it never trains. */
  frozen?: { frame: number; slice: number; frozen: string } | null;
}

export interface JobCase {
  maskId: string;
  projectId: string;
  projectName: string;
  model: string;
  slices: number;
}

export interface GateRow {
  n: number;
  expected?: number;
  complete: boolean;
  mean_delta_cardiac?: number;
  ci95?: [number, number];
  lower?: boolean;
}

export interface Gate {
  checked_at: string;
  against: string;
  public: Record<string, GateRow>;
  warnings: string[];
  notes: string[];
}

export interface TrainingJob {
  id: string;
  kind: string;
  state: JobState;
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  params: { label?: string; owner?: string; selection?: string[]; cases?: JobCase[] };
  steps: JobStep[];
  progress: {
    step?: string;
    epoch?: number;
    epochs?: number;
    scored?: number;
    total?: number;
    scoring_active_first?: boolean;
    corrections?: { projects: number; slices: number; conflicts: number };
    export?: { folder: string; projects: number; slices: number; conflicts: number; frozen_excluded: number };
    examples?: { done: number; total: number; ready: boolean; error?: string };
  };
  result?: {
    label: string;
    against: string;
    warnings: string[];
    notes: string[];
    public: Record<string, GateRow>;
    report: string | null;
    simulated?: boolean;
  };
  error: string | null;
  cancel_requested_by: string | null;
}

export interface ModelVersion {
  label: string;
  status: "original" | "active" | "candidate" | "deleted";
  registered_at: string | null;
  base: string | null;
  is_active: boolean;
  is_original: boolean;
  gate: Gate | null;
  recipe: string | null;
  deleted_because: string | null;
  /** Its model file is on this computer; a copied registry can name versions whose files are not. */
  on_disk: boolean;
}

export interface Eligible {
  checked_at: string;
  projects: number;
  slices: number;
  conflicts: number;
  fresh: boolean;
  cases?: CorrectionCase[];
  simulated?: boolean;
}

export interface RetrainingStatus {
  simulated: boolean;
  busy: boolean;
  training: { allowed: boolean; reason: string | null };
  original: string;
  active: string;
  /** Why versions cannot be switched on this computer (the original model or the active slot), or null. */
  problem: string | null;
  versions: ModelVersion[];
  eligible: Eligible | null;
  job: TrainingJob | null;
}

export interface SwitchPreview {
  label: string;
  action: "activate" | "rollback" | "reject";
  refusal: string | null;
  warnings: string[];
  confirm: string[];
}

export type StructureKey = "rv" | "myocardium" | "lv_cavity";
export type StructureScores = Record<StructureKey | "background", number>;

export interface ExampleEntry {
  n: number;
  dataset: string;
  case: string;
  role: "lowest" | "median" | "highest";
  delta: number;
  scores: { against: StructureScores; label: StructureScores };
  slices: number;
}

export interface ExampleIndex {
  label: string;
  against: string;
  report: string;
  created_at: string;
  size: number;
  examples: ExampleEntry[];
}

export interface ExampleScan extends Omit<ExampleEntry, "slices"> {
  count: number;
  size: number;
  /** The versions whose predictions are in `left` and `right`; never the same one. */
  left_label: string;
  right_label: string;
  slices: { image: string; truth: string; left: string; right: string }[];
}

export interface Comparison {
  label: string;
  against: string;
  ready: boolean;
  rendered: boolean;
  /** label's example scans: made by this call when a version made before the page had none. */
  index?: ExampleIndex;
}

export interface VersionResults {
  label: string;
  status: string;
  against: string | null;
  gate: Gate | null;
  report: string | null;
  datasets: Record<string, { n: number; against: StructureScores; label: StructureScores }> | null;
  examples: ExampleIndex | null;
}

export interface Reply<T> {
  success: boolean;
  message: string;
  data: T | null;
  status: number;
}

interface Envelope {
  success?: boolean;
  message?: string;
  data?: unknown;
}

async function call<T>(request: Promise<AxiosResponse<Envelope>>): Promise<Reply<T>> {
  try {
    const response = await request;
    const body = response.data ?? {};
    return { success: Boolean(body.success), message: String(body.message ?? ""), data: (body.data ?? null) as T | null,
             status: response.status };
  } catch {
    return { success: false, message: "The VisHeart server could not be reached.", data: null, status: 0 };
  }
}

const anyStatus = { validateStatus: () => true };
const versionPath = (label: string) => `/retraining/versions/${encodeURIComponent(label)}`;

export const retrainingApi = {
  status: () => call<RetrainingStatus>(api.get("/retraining/status", anyStatus)),
  checkCorrections: () =>
    call<Eligible>(api.post("/retraining/eligible-cases/check", {}, { ...anyStatus, timeout: 190000 })),
  start: (selection: string[]) => call<TrainingJob>(api.post("/retraining/start", { selection }, anyStatus)),
  cancel: (jobId: string) => call<TrainingJob>(api.post(`/retraining/job/${jobId}/cancel`, {}, anyStatus)),
  preview: (label: string, action: VersionAction) =>
    call<SwitchPreview>(api.get(`${versionPath(label)}/preview`, { ...anyStatus, params: { action } })),
  activate: (label: string, confirm: string[]) =>
    call<{ active: string; restarted: string[]; restart_error: string | null }>(
      api.post(`${versionPath(label)}/activate`, { confirm }, { ...anyStatus, timeout: 250000 })),
  reject: (label: string, confirm: string[]) =>
    call<{ rejected: string }>(api.post(`${versionPath(label)}/reject`, { confirm }, anyStatus)),
  results: (label: string) =>
    call<VersionResults>(api.get(`${versionPath(label)}/results`, { ...anyStatus, timeout: 70000 })),
  /** One of label's example scans, with the predictions of `left` and `right` (by default as trained). */
  example: (label: string, n: number, sides: { left?: string; right?: string } = {}) =>
    call<ExampleScan>(api.get(`${versionPath(label)}/examples/${n}`, { ...anyStatus, timeout: 70000, params: sides })),
  /** Another version's predictions on these example scans: made once, about half a minute, then kept. */
  compareExamples: (label: string, against: string) =>
    call<Comparison>(api.post(`${versionPath(label)}/compare`, { against }, { ...anyStatus, timeout: 910000 })),
};

export const DATASET_NAMES: Record<string, string> = { acdc: "ACDC", mms1: "M&Ms-1", mms2: "M&Ms-2" };
export const MODEL_NAMES: Record<string, string> = { unet: "UNet", medsam: "MedSAM" };
/** Edit tracking's class names, as the cases table and the preview say them. */
export const CASE_STRUCTURE_NAMES: Record<string, string> = { rv: "RV", myo: "Myocardium", lvc: "LV cavity", manual: "Manual" };
export const STRUCTURE_KEYS: StructureKey[] = ["rv", "myocardium", "lv_cavity"];
export const STRUCTURE_NAMES: Record<StructureKey, string> = {
  rv: "Right ventricle", myocardium: "Myocardium", lv_cavity: "Left ventricle cavity",
};

export function elapsed(from: string | null, to: string | null = null): string {
  if (!from) return "";
  const seconds = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours} h ${minutes} min`;
  return minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

export function isActiveJob(job: TrainingJob | null | undefined): boolean {
  return job != null && (job.state === "queued" || job.state === "running");
}
