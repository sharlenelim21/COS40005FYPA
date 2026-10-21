"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { pipelineApi, type PipelineDto } from "@/lib/api";
import { buildReconstructionRequest, defaultReconstructionConfig } from "@/lib/reconstructionDefaults";

export type Model = "medsam" | "unet";
export type Chamber = "lv" | "rv";
export type StepStatus = "pending" | "queued" | "running" | "done" | "failed" | "skipped";

export interface SegStep {
  model: Model;
  status: StepStatus;
  jobUuid?: string;
  note?: string;
}

export interface ReconStep {
  model: Model;
  chamber: Chamber;
  status: StepStatus;
  jobUuid?: string;
  note?: string;
}

export interface LandmarkStep {
  model?: Model;
  status: StepStatus;
  jobUuid?: string;
  note?: string;
}

export interface PipelineState {
  seg: SegStep[];
  recon: ReconStep[];
  landmark: LandmarkStep | null;
}

export interface PipelineSelection {
  segModels: Model[];
  combos: Array<{ model: Model; chamber: Chamber }>;
  runLandmark: boolean;
  landmarkModel?: Model;
}

export interface PipelineInputs {
  projectId: string | undefined;
  projectName: string | undefined;
  gpuAvailable: boolean;
  ready: boolean;
  existing: Record<Chamber, Set<Model>>;
  building: Record<Chamber, Set<Model>>;
  refreshJobs: () => Promise<void> | void;
  refreshMasks: () => Promise<void> | void;
  refreshReconstructions: () => Promise<void> | void;
  refreshActiveReconstructionJobs: () => Promise<void> | void;
  /** A Clinical Assistant's reconstruction/landmark run isn't a "draft" — it's immediately the
   *  shared project result, with no separate send step. Segmentation already confirms this via
   *  its own save toast; this is the same confirmation for the two stages that don't have one. */
  isClinicalAssistant?: boolean;
}

export const SEG_MODEL_ORDER: Model[] = ["medsam", "unet"];
export const RECON_COMBOS: Array<{ model: Model; chamber: Chamber }> = [
  { model: "medsam", chamber: "lv" },
  { model: "medsam", chamber: "rv" },
  { model: "unet", chamber: "lv" },
  { model: "unet", chamber: "rv" },
];

const POLL_MS = 5000;
const legacyStorageKey = (projectId: string) => `vh-pipeline-v2-${projectId}`;

export const isActiveStep = (s: StepStatus) => s === "pending" || s === "queued" || s === "running";
const modelLabel = (m?: Model) => (m === "unet" ? "UNet" : "MedSAM");
const comboLabel = (m: Model, c: Chamber) => `${modelLabel(m)} · ${c.toUpperCase()}`;

function toPipelineState(dto: PipelineDto): PipelineState {
  const status = (s: PipelineDto["steps"][number]["status"]): StepStatus => (s === "starting" ? "queued" : s);
  const state: PipelineState = { seg: [], recon: [], landmark: null };
  for (const s of dto.steps) {
    const base = { status: status(s.status), jobUuid: s.jobUuid, note: s.note };
    if (s.kind === "seg" && s.model) state.seg.push({ ...base, model: s.model });
    else if (s.kind === "recon" && s.model && s.chamber) state.recon.push({ ...base, model: s.model, chamber: s.chamber });
    else if (s.kind === "landmark") state.landmark = { ...base, model: s.model };
  }
  return state;
}

const stepKey = (kind: string, model?: string, chamber?: string) => `${kind}:${model ?? ""}:${chamber ?? ""}`;

export function useAutoPipelineChain(inputs: PipelineInputs) {
  const { projectId } = inputs;
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const lastRef = useRef<{ id: string; statuses: Map<string, StepStatus> } | null>(null);
  const pollingRef = useRef(false);

  const apply = useCallback(async (dto: PipelineDto | null, { announce }: { announce: boolean }) => {
    const inp = inputsRef.current;
    if (!dto) {
      lastRef.current = null;
      setPipeline(null);
      return;
    }
    const next = toPipelineState(dto);
    const prev = lastRef.current?.id === dto.id ? lastRef.current.statuses : null;
    const statuses = new Map<string, StepStatus>();
    let refreshMasks = false;
    let refreshRecons = false;
    let refreshJobs = false;

    const visit = (key: string, status: StepStatus, describe: () => string, note?: string, kind?: "seg" | "recon" | "landmark") => {
      statuses.set(key, status);
      const before = prev?.get(key);
      if (!prev || before === status) return;
      refreshJobs = true;
      if (kind === "seg" && status === "done") refreshMasks = true;
      if (kind === "recon" && (status === "done" || status === "failed" || status === "skipped")) refreshRecons = true;
      if (announce && status === "failed") toast.error(`${describe()} failed`, note ? { description: note } : undefined);
      // Segmentation already confirms "sent to the Doctor" via its own save flow — only recon
      // and landmark need this, since those have no equivalent confirmation anywhere else.
      if (announce && status === "done" && inp.isClinicalAssistant && (kind === "recon" || kind === "landmark")) {
        toast.success(`${describe()} saved — visible to the Doctor`);
      }
    };
    for (const s of next.seg) visit(stepKey("seg", s.model), s.status, () => `${modelLabel(s.model)} segmentation`, s.note, "seg");
    for (const r of next.recon) visit(stepKey("recon", r.model, r.chamber), r.status, () => `${comboLabel(r.model, r.chamber)} reconstruction`, r.note, "recon");
    if (next.landmark) visit(stepKey("landmark"), next.landmark.status, () => "Landmark detection", next.landmark.note, "landmark");

    lastRef.current = { id: dto.id, statuses };
    setPipeline(dto.status === "active" ? next : null);

    if (refreshMasks) await inp.refreshMasks();
    if (refreshRecons) {
      await inp.refreshReconstructions();
      await inp.refreshActiveReconstructionJobs();
    }
    if (refreshJobs || refreshMasks) await inp.refreshJobs();
  }, []);

  const poll = useCallback(async ({ announce }: { announce: boolean }) => {
    const pid = inputsRef.current.projectId;
    if (!pid || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const { pipeline: dto } = await pipelineApi.get(pid);
      await apply(dto, { announce });
    } catch (error: unknown) {
      console.warn("[Pipeline] poll failed, will retry:", error);
    } finally {
      pollingRef.current = false;
    }
  }, [apply]);

  useEffect(() => {
    if (!projectId) return;
    try {
      sessionStorage.removeItem(legacyStorageKey(projectId));
    } catch {
    }
    lastRef.current = null;
    setPipeline(null);
    if (inputs.ready) void poll({ announce: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, inputs.ready]);

  const active =
    !!pipeline &&
    (pipeline.seg.some((s) => isActiveStep(s.status)) ||
      pipeline.recon.some((s) => isActiveStep(s.status)) ||
      (!!pipeline.landmark && isActiveStep(pipeline.landmark.status)));

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void poll({ announce: true }), POLL_MS);
    return () => clearInterval(timer);
  }, [active, poll]);

  const start = useCallback(
    async (selection: PipelineSelection) => {
      const inp = inputsRef.current;
      const pid = inp.projectId;
      if (!pid || selection.segModels.length === 0) return;
      const combos = selection.combos.map((c) => ({
        ...c,
        request: buildReconstructionRequest(
          defaultReconstructionConfig(c.model, c.chamber, inp.gpuAvailable),
          inp.projectName || "Project",
        ) as unknown as Record<string, unknown>,
      }));
      try {
        const { pipeline: dto } = await pipelineApi.start(pid, {
          segModels: SEG_MODEL_ORDER.filter((m) => selection.segModels.includes(m)),
          combos,
          runLandmark: selection.runLandmark,
          landmarkModel: selection.landmarkModel,
        });
        await apply(dto, { announce: true });
      } catch (error: unknown) {
        const response = (error as { response?: { status?: number; data?: { message?: string; pipeline?: PipelineDto } } })?.response;
        if (response?.status === 409 && response.data?.pipeline) {
          toast.info("A pipeline is already running for this project", { description: "Showing its progress." });
          await apply(response.data.pipeline, { announce: false });
          return;
        }
        toast.error("Could not start the pipeline", { description: response?.data?.message });
      }
    },
    [apply],
  );

  const segActive = !!pipeline?.seg.some((s) => isActiveStep(s.status));
  const reconActive = !!pipeline?.recon.some((s) => s.status === "queued" || s.status === "running");
  const landmarkActive = !!pipeline?.landmark && pipeline.landmark.status === "running";
  const segQueued = segActive && !pipeline?.seg.some((s) => s.status === "running");

  return { pipeline, active, start, segActive, segQueued, reconActive, landmarkActive };
}
