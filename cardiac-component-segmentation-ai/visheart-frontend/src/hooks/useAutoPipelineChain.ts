"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { reconstructionApi, segmentationApi } from "@/lib/api";
import { landmarkApi } from "@/lib/landmarkApi";
import { normalizeReconstructionChamber } from "@/context/ProjectContext";
import { buildReconstructionRequest, defaultReconstructionConfig } from "@/lib/reconstructionDefaults";

export type Model = "medsam" | "unet";
export type Chamber = "lv" | "rv";
export type StepStatus = "pending" | "queued" | "running" | "done" | "failed" | "skipped";

export interface SegStep {
  model: Model;
  status: StepStatus;
  jobUuid?: string;
  note?: string;
  maskWaitTicks?: number;
  priorMaskIds?: string[];
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
}

export const SEG_MODEL_ORDER: Model[] = ["medsam", "unet"];
export const RECON_COMBOS: Array<{ model: Model; chamber: Chamber }> = [
  { model: "medsam", chamber: "lv" },
  { model: "medsam", chamber: "rv" },
  { model: "unet", chamber: "lv" },
  { model: "unet", chamber: "rv" },
];

const TICK_MS = 5000;
const MAX_MASK_WAIT_TICKS = 12;

const storageKey = (projectId: string) => `vh-pipeline-v2-${projectId}`;

export const isActiveStep = (s: StepStatus) => s === "pending" || s === "queued" || s === "running";
const isTerminal = (s: StepStatus) => s === "done" || s === "failed" || s === "skipped";
const modelLabel = (m: Model) => (m === "medsam" ? "MedSAM" : "UNet");
const comboLabel = (m: Model, c: Chamber) => `${modelLabel(m)} · ${c.toUpperCase()}`;

function fromJobStatus(raw: unknown): StepStatus | null {
  const s = String(raw ?? "").toLowerCase();
  if (s === "pending") return "queued";
  if (s === "in_progress") return "running";
  if (s === "completed") return "done";
  if (s === "failed") return "failed";
  return null;
}

function editableMaskModel(m: Record<string, unknown>): Model | null {
  if (m?.isMedSAMOutput !== false) return null;
  const name = String(m?.name ?? "").toLowerCase();
  const tag = String(m?.segmentationModel ?? m?.model_used ?? "").toLowerCase();
  return name.includes("unet")
    ? "unet"
    : name.includes("medsam")
    ? "medsam"
    : tag === "medsam" || tag === "unet"
    ? tag
    : null;
}

function editableMaskIdsByModel(segmentations: unknown): Record<Model, string[]> {
  const out: Record<Model, string[]> = { medsam: [], unet: [] };
  if (!Array.isArray(segmentations)) return out;
  for (const m of segmentations as Array<Record<string, unknown>>) {
    const model = editableMaskModel(m);
    if (model) out[model].push(String(m?._id ?? ""));
  }
  return out;
}

function editableMaskCreatedAt(segmentations: unknown, model: Model): number | null {
  if (!Array.isArray(segmentations)) return null;
  let newest: number | null = null;
  for (const m of segmentations as Array<Record<string, unknown>>) {
    if (editableMaskModel(m) !== model) continue;
    const t = Date.parse(String(m?.createdAt ?? ""));
    if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
  }
  return newest;
}

type ErrorResponse = { status?: number; data?: { message?: string; reason?: string; jobUuid?: string; jobStatus?: string } };
const responseOf = (error: unknown) => (error as { response?: ErrorResponse })?.response;

export function useAutoPipelineChain(inputs: PipelineInputs) {
  const { projectId } = inputs;
  const [pipeline, setPipelineState] = useState<PipelineState | null>(null);
  const pipelineRef = useRef<PipelineState | null>(null);
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const busyRef = useRef(false);

  const setPipeline = useCallback(
    (next: PipelineState | null) => {
      pipelineRef.current = next;
      setPipelineState(next);
      if (!projectId) return;
      try {
        if (next) sessionStorage.setItem(storageKey(projectId), JSON.stringify(next));
        else sessionStorage.removeItem(storageKey(projectId));
      } catch {
      }
    },
    [projectId],
  );

  useEffect(() => {
    if (!projectId) return;
    try {
      const raw = sessionStorage.getItem(storageKey(projectId));
      const parsed = raw ? (JSON.parse(raw) as PipelineState) : null;
      for (const step of parsed?.seg ?? []) {
        if (step.status === "pending") step.status = "queued";
      }
      pipelineRef.current = parsed;
      setPipelineState(parsed);
    } catch {
      pipelineRef.current = null;
      setPipelineState(null);
    }
  }, [projectId]);

  const active =
    !!pipeline &&
    (pipeline.seg.some((s) => isActiveStep(s.status)) ||
      pipeline.recon.some((s) => isActiveStep(s.status)) ||
      (!!pipeline.landmark && isActiveStep(pipeline.landmark.status)));

  const tick = useCallback(async () => {
    const inp = inputsRef.current;
    const pid = inp.projectId;
    if (!pipelineRef.current || !pid || !inp.ready || busyRef.current) return;
    busyRef.current = true;

    const cur = pipelineRef.current;
    const next: PipelineState = {
      seg: cur.seg.map((s) => ({ ...s })),
      recon: cur.recon.map((s) => ({ ...s })),
      landmark: cur.landmark ? { ...cur.landmark } : null,
    };
    let changed = false;
    let refreshRecons = false;
    let refreshMasks = false;

    try {
      if (next.seg.some((s) => s.status === "queued" || s.status === "running")) {
        const response = await segmentationApi.getUserJobs();
        const jobs: Array<Record<string, unknown>> = Array.isArray(response?.jobs) ? response.jobs : [];
        for (const step of next.seg) {
          if (step.status !== "queued" && step.status !== "running") continue;
          const job = step.jobUuid
            ? jobs.find((j) => String(j.jobId ?? "") === step.jobUuid)
            : jobs.find(
                (j) =>
                  String(j.projectId ?? "") === String(pid) &&
                  String(j.segmentationModel ?? "").toLowerCase() === step.model &&
                  !/4d_reconstruction|landmark/i.test(String(j.modelUsed ?? "")),
              );
          if (!job) {
            if (!step.jobUuid) {
              step.status = "failed";
              step.note = "Segmentation job not found.";
              toast.error(`${modelLabel(step.model)} segmentation job not found`);
              changed = true;
            }
            continue;
          }
          if (!step.jobUuid) {
            step.jobUuid = String(job.jobId);
            changed = true;
          }
          const status = fromJobStatus(job.status);
          if (status === "failed") {
            step.status = "failed";
            step.note = String(job.message || "") || "Segmentation failed.";
            toast.error(`${modelLabel(step.model)} segmentation failed`, { description: step.note });
            changed = true;
          } else if (status === "done") {
            step.status = "running";
            step.maskWaitTicks = step.maskWaitTicks ?? 0;
            changed = true;
          } else if (status && status !== step.status) {
            step.status = status;
            changed = true;
          }
        }
      }

      const awaitingMask = next.seg.filter((s) => s.status === "running" && s.maskWaitTicks !== undefined);
      if (awaitingMask.length > 0) {
        const results = await segmentationApi.getSegmentationResults(pid);
        const editable = editableMaskIdsByModel(results?.segmentations);
        for (const step of awaitingMask) {
          const prior = step.priorMaskIds ?? [];
          if (editable[step.model].some((id) => !prior.includes(id))) {
            step.status = "done";
            delete step.maskWaitTicks;
            refreshMasks = true;
          } else if ((step.maskWaitTicks ?? 0) + 1 > MAX_MASK_WAIT_TICKS) {
            step.status = "failed";
            step.note = "Segmentation finished but no editable mask was found.";
            delete step.maskWaitTicks;
            toast.error(`${modelLabel(step.model)} masks not found`, { description: step.note });
          } else {
            step.maskWaitTicks = (step.maskWaitTicks ?? 0) + 1;
          }
          changed = true;
        }
      }

      for (const r of next.recon) {
        if (r.status !== "pending") continue;
        const seg = next.seg.find((s) => s.model === r.model);
        if (!seg || seg.status === "failed") {
          r.status = "skipped";
          r.note = "segmentation failed";
          changed = true;
        }
      }

      for (const r of next.recon) {
        if (r.status !== "pending") continue;
        const seg = next.seg.find((s) => s.model === r.model);
        if (seg?.status !== "done") continue;
        changed = true;
        if (inp.existing[r.chamber].has(r.model)) {
          r.status = "skipped";
          r.note = "already exists";
          continue;
        }
        if (inp.building[r.chamber].has(r.model)) {
          r.status = "queued";
          r.note = "already building";
          continue;
        }
        try {
          const res = await reconstructionApi.startReconstruction(
            pid,
            buildReconstructionRequest(
              defaultReconstructionConfig(r.model, r.chamber, inp.gpuAvailable),
              inp.projectName || "Project",
            ),
          );
          r.status = "queued";
          r.jobUuid = res?.uuid;
        } catch (error: unknown) {
          const response = responseOf(error);
          if (response?.status === 409 && response.data?.reason === "job_in_progress") {
            r.status = "queued";
            r.note = "already building";
          } else if (response?.status === 409) {
            r.status = "skipped";
            r.note = "already exists";
          } else if (response) {
            r.status = "failed";
            r.note = response.data?.message || "could not start";
            toast.error(`Could not start ${comboLabel(r.model, r.chamber)} reconstruction`, { description: r.note });
          } else {
            r.status = "pending";
          }
        }
        refreshRecons = true;
      }

      const lm = next.landmark;
      if (lm?.status === "pending" && !next.recon.some((r) => r.status === "pending")) {
        const preferred = next.seg.find((s) => s.model === (lm.model ?? "unet")) ?? next.seg[0];
        const fallback = next.seg.find((s) => s !== preferred && s.status === "done");
        const source = preferred?.status === "done" ? preferred : preferred?.status === "failed" ? fallback : undefined;
        if (!source && next.seg.every((s) => isTerminal(s.status))) {
          lm.status = "skipped";
          lm.note = "no segmentation mask";
          changed = true;
        } else if (source) {
          const model = source.model;
          lm.model = model;
          changed = true;
          const maskTime = editableMaskCreatedAt(
            (await segmentationApi.getSegmentationResults(pid))?.segmentations,
            model,
          );
          const isCurrent = (created: number | null) =>
            maskTime === null || (created !== null && created >= maskTime);
          const running = await landmarkApi.findActiveJob(pid);
          const completed =
            maskTime === null ? null : await landmarkApi.findCompletedJobSince(pid, model, maskTime);
          if (running && running.segmentationModel === model && isCurrent(running.createdAt)) {
            lm.status = "running";
            lm.jobUuid = running.uuid;
            delete lm.note;
          } else if (running && running.segmentationModel === model) {
            lm.note = "waiting for an earlier landmark run to finish";
          } else if (completed) {
            lm.status = "done";
            lm.jobUuid = completed;
            lm.note = "already detected on this mask";
          } else {
            try {
              lm.jobUuid = await landmarkApi.startDetection(pid, model);
              lm.status = "running";
              delete lm.note;
            } catch (error: unknown) {
              const response = responseOf(error);
              if (response || (error instanceof Error && error.name === "LandmarkApiError")) {
                lm.status = "failed";
                lm.note = response?.data?.message || (error as Error).message || "Could not start landmark detection.";
                toast.error("Could not start landmark detection", { description: lm.note });
              } else {
                throw error;
              }
            }
          }
          await inp.refreshJobs();
        }
      }

      if (next.recon.some((r) => r.status === "queued" || r.status === "running")) {
        const response = await reconstructionApi.getUserReconstructionJobs();
        const jobs: Array<Record<string, unknown>> = Array.isArray(response?.jobs) ? response.jobs : [];
        for (const r of next.recon) {
          if (r.status !== "queued" && r.status !== "running") continue;
          const job = r.jobUuid
            ? jobs.find((j) => String(j.jobId ?? "") === r.jobUuid)
            : jobs.find(
                (j) =>
                  String(j.projectId ?? "") === String(pid) &&
                  String(j.segmentationModel ?? "").toLowerCase() === r.model &&
                  normalizeReconstructionChamber(j.chamber) === r.chamber,
              );
          if (!job) continue;
          if (!r.jobUuid) {
            r.jobUuid = String(job.jobId ?? "");
            changed = true;
          }
          const status = fromJobStatus(job.status);
          if (!status || status === r.status) continue;
          r.status = status;
          changed = true;
          if (status === "done") refreshRecons = true;
          if (status === "failed") {
            r.note = String(job.message || "") || "Reconstruction failed.";
            toast.error(`${comboLabel(r.model, r.chamber)} reconstruction failed`, { description: r.note });
            refreshRecons = true;
          }
        }
      }

      if (lm?.status === "running" && lm.jobUuid && lm.model) {
        const probe = await landmarkApi.probeJob(pid, lm.jobUuid, lm.model);
        if (probe.status === "completed") {
          lm.status = "done";
          changed = true;
        } else if (probe.status === "failed" || probe.status === "missing") {
          lm.status = "failed";
          lm.note = probe.message || (probe.status === "missing" ? "Landmark job was not found." : "Landmark detection failed.");
          toast.error("Landmark detection failed", { description: lm.note });
          changed = true;
        }
      }
    } catch (error: unknown) {
      console.warn("[Pipeline] tick error, will retry:", error);
    } finally {
      busyRef.current = false;
    }

    if (changed && pipelineRef.current === cur) {
      const finished =
        next.seg.every((s) => isTerminal(s.status)) &&
        next.recon.every((s) => isTerminal(s.status)) &&
        (!next.landmark || isTerminal(next.landmark.status));
      setPipeline(finished ? null : next);
    }
    if (refreshMasks) {
      await inp.refreshMasks();
      await inp.refreshJobs();
    }
    if (refreshRecons) {
      await inp.refreshReconstructions();
      await inp.refreshActiveReconstructionJobs();
    }
  }, [setPipeline]);

  useEffect(() => {
    if (!active) return;
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [active, tick]);

  useEffect(() => {
    if (active) tick();
  }, [active, tick, inputs.ready, inputs.existing, inputs.building]);

  const start = useCallback(
    async (selection: PipelineSelection) => {
      const pid = inputsRef.current.projectId;
      if (!pid || selection.segModels.length === 0) return;

      const segModels = SEG_MODEL_ORDER.filter((m) => selection.segModels.includes(m));
      let prior: Record<Model, string[]> = { medsam: [], unet: [] };
      try {
        prior = editableMaskIdsByModel((await segmentationApi.getSegmentationResults(pid))?.segmentations);
      } catch {
      }
      const initial: PipelineState = {
        seg: segModels.map((model) => ({ model, status: "pending" as StepStatus, priorMaskIds: prior[model] })),
        recon: RECON_COMBOS.filter(
          (c) =>
            segModels.includes(c.model) &&
            selection.combos.some((s) => s.model === c.model && s.chamber === c.chamber),
        ).map((c) => ({ ...c, status: "pending" as StepStatus })),
        landmark: selection.runLandmark
          ? { status: "pending", model: segModels.includes("unet") ? "unet" : segModels[0] }
          : null,
      };
      setPipeline(initial);

      const seg = initial.seg.map((s) => ({ ...s }));
      for (const step of seg) {
        try {
          const res = await segmentationApi.startSegmentation(pid, step.model, "auto");
          step.status = "queued";
          step.jobUuid = res?.uuid;
        } catch (error: unknown) {
          const response = responseOf(error);
          if (response?.status === 409) {
            step.status = fromJobStatus(response.data?.jobStatus) ?? "queued";
            step.jobUuid = response.data?.jobUuid;
            step.note = "already running";
          } else {
            step.status = "failed";
            step.note = response?.data?.message || "Could not start segmentation.";
            toast.error(`Could not start ${modelLabel(step.model)} segmentation`, { description: step.note });
          }
        }
      }
      if (pipelineRef.current === initial) setPipeline({ ...initial, seg });
      await inputsRef.current.refreshJobs();
    },
    [setPipeline],
  );

  const segActive = !!pipeline?.seg.some((s) => isActiveStep(s.status));
  const reconActive = !!pipeline?.recon.some((s) => s.status === "queued" || s.status === "running");
  const landmarkActive = !!pipeline?.landmark && pipeline.landmark.status === "running";
  const segQueued = segActive && !pipeline?.seg.some((s) => s.status === "running");

  return { pipeline, active, start, segActive, segQueued, reconActive, landmarkActive };
}
