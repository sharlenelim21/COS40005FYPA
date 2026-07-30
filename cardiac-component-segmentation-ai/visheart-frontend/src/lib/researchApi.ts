import axios, { type AxiosError } from "axios";

/**
 * Client for the Cardiac Research Assistant — a SEPARATE local service (the
 * cardiac-research-assistant repo) that runs on its own port and answers
 * heart-literature questions with cited sources. It is NOT the main VisHeart
 * backend, so it has its own base URL env var.
 *
 * Start the service:  uvicorn app:app --port 8000   (from its backend/ folder)
 * Set in .env.local:  NEXT_PUBLIC_RESEARCH_API_URL=http://localhost:8000
 */

const baseURL = process.env.NEXT_PUBLIC_RESEARCH_API_URL;

if (!baseURL && process.env.NODE_ENV !== "test") {
  console.warn(
    "[researchApi] NEXT_PUBLIC_RESEARCH_API_URL is not defined; the research " +
      "assistant panel will be disabled until it is set.",
  );
}

const api = axios.create({
  baseURL: baseURL ?? "",
  // The assistant is stateless and cross-origin; no cookies needed.
  withCredentials: false,
  // LLM generation can take a while on CPU — allow generous time. Measured on a
  // CPU-only machine (qwen2.5:3b via Ollama, no GPU offload): /ask ~90s and
  // /explain ~190s, since /explain's patient context makes the prompt longer.
  // 120s was not enough for /explain and surfaced as a spurious timeout error.
  timeout: 300_000,
});

/** One cited source, as returned by the assistant. */
export type ResearchSource = {
  n: number;
  title: string;
  url: string | null;
  year: number | null;
  /** Link to a legally-free full text, when the paper is open access. */
  pdf_url?: string | null;
};

/** A grounded, cited answer. */
export type ResearchAnswer = {
  answer: string;
  sources: ResearchSource[];
};

/** True when the assistant URL is configured; UI can hide itself otherwise. */
export const researchAssistantEnabled = Boolean(baseURL);

export const researchApi = {
  /** Liveness check — is the assistant service running? */
  health: async (): Promise<boolean> => {
    try {
      const res = await api.get("/health", { timeout: 4_000 });
      return res.data?.status === "ok";
    } catch {
      return false;
    }
  },

  /** Free-text heart-literature question, e.g. "Explain peak GRS". */
  ask: async (question: string): Promise<ResearchAnswer> => {
    try {
      const res = await api.post<ResearchAnswer>("/ask", { question });
      return res.data;
    } catch (err) {
      throw toError(err, "Could not reach the research assistant.");
    }
  },

  /**
   * Explain a report in light of the literature. `context` is the patient's
   * measurements as a plain string; `question` is optional.
   */
  explain: async (context: string, question?: string): Promise<ResearchAnswer> => {
    try {
      const res = await api.post<ResearchAnswer>("/explain", { context, question });
      return res.data;
    } catch (err) {
      throw toError(err, "Could not reach the research assistant.");
    }
  },
};

function toError(err: unknown, fallback: string): Error {
  const ax = err as AxiosError<{ detail?: string }>;
  const detail = ax?.response?.data?.detail;
  if (ax?.code === "ECONNABORTED") {
    return new Error("The assistant took too long to respond. Please try again.");
  }
  return new Error(detail || ax?.message || fallback);
}

/**
 * Build the `context` string the /explain endpoint expects from VisHeart's
 * computed measurements + disease-similarity result. Only includes values that
 * were actually computed (null-safe) so the assistant never sees fabricated
 * numbers. Kept framework-agnostic (plain fields in) so the report component
 * can call it without importing hook types here.
 */
export function buildPatientContext(input: {
  EF?: number | null;
  EDV?: number | null;
  ESV?: number | null;
  StrokeVolume?: number | null;
  PeakGRS?: number | null;
  PeakGCS?: number | null;
  mostSimilarPattern?: string | null;
}): string {
  const parts: string[] = [];
  const add = (label: string, v: number | null | undefined, unit = "") => {
    if (v !== null && v !== undefined && !Number.isNaN(v)) {
      parts.push(`${label}: ${v}${unit}`);
    }
  };
  add("EF", input.EF, "%");
  add("EDV", input.EDV, " mL");
  add("ESV", input.ESV, " mL");
  add("Stroke Volume", input.StrokeVolume, " mL");
  add("Peak GRS", input.PeakGRS, "%");
  add("Peak GCS", input.PeakGCS, "%");
  if (input.mostSimilarPattern) {
    parts.push(`most similar pattern: ${input.mostSimilarPattern}`);
  }
  return parts.join(", ");
}
