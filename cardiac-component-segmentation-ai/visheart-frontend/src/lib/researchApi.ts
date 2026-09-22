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
  /** Crossref DOI verification: true = title matches Crossref's own record
   *  for that DOI, false = mismatch (a real red flag), null/undefined = not
   *  checked (no DOI, or the Crossref lookup failed/timed out) — null must
   *  NOT be rendered as a warning, only false should be. */
  verified?: boolean | null;
  /** Lexical-overlap check between the sentence citing this source and its
   *  own abstract — a heuristic, not true entailment. false = shares almost
   *  no vocabulary with the claim next to it (worth a second look), null =
   *  nothing to check (no abstract, or no sentence actually cited it). */
  content_supported?: boolean | null;
  /** How established the work is — Europe PMC's own count, backfilled via
   *  OpenAlex when missing/zero. null = neither source had a number. */
  citation_count?: number | null;
  /** Semantic Scholar's one-sentence AI summary. null is the common case
   *  (its keyless endpoint rate-limits hard) — not an error. */
  tldr?: string | null;
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

  /**
   * Free-text heart-literature question, e.g. "Explain peak GRS".
   * `sessionId` (optional) lets a vague follow-up like "give me other related
   * papers?" resolve against the previous question — the backend remembers
   * the last topic per session_id. Omit it and each call is answered fresh.
   */
  ask: async (question: string, sessionId?: string): Promise<ResearchAnswer> => {
    try {
      const res = await api.post<ResearchAnswer>("/ask", {
        question,
        session_id: sessionId,
      });
      return res.data;
    } catch (err) {
      throw toError(err, "Could not reach the research assistant.");
    }
  },

  /**
   * Explain a report in light of the literature. `context` is the patient's
   * measurements as a plain string; `question` is optional. `facts`
   * (optional — see buildLvPhenotypeFacts) is the STRUCTURED, backend-computed
   * phenotype result: when present, the assistant treats it as authoritative,
   * restricts retrieval to the permitted phenotype, and validates its own
   * answer against it — this is what stops it contradicting the deterministic
   * gate (e.g. calling a confirmed-dilated LV "non-dilated").
   */
  explain: async (
    context: string,
    question?: string,
    sessionId?: string,
    facts?: LvPhenotypeFacts,
  ): Promise<ResearchAnswer> => {
    try {
      const res = await api.post<ResearchAnswer>("/explain", {
        context,
        question,
        session_id: sessionId,
        facts,
      });
      return res.data;
    } catch (err) {
      throw toError(err, "Could not reach the research assistant.");
    }
  },
};

/**
 * Structured, backend-computed LV phenotype facts sent to the research
 * assistant's /explain endpoint alongside the free-text `context` string.
 *
 * WHY this exists: the assistant previously only ever saw a flat measurements
 * string (see buildPatientContext below) and had to infer the phenotype
 * itself from the raw numbers + whatever literature it retrieved. That let it
 * contradict this app's own deterministic result — e.g. retrieving a paper
 * about non-dilated LV cardiomyopathy (NDLVC) for a low-EF/low-strain patient
 * and calling THAT the pattern, even though this patient's BSA-indexed EDVI
 * already confirms marked dilation (compute_disease_similarity.py's own
 * dcm_gate_met/lv_dilatation_present said so). Sending those already-decided
 * facts as an authoritative block — instead of raw numbers the LLM has to
 * reason about from scratch — is what lets the assistant's server-side prompt
 * and post-generation validator refuse to render a phenotype the structured
 * data already rules out.
 *
 * Every gate/dilatation/dysfunction field here is tri-state (boolean | null):
 * `null` means "not enough data to assess" and must NOT be treated as false.
 */
export type LvPhenotypeFacts = {
  modality: string;
  analysis_scope: string;
  tissue_characterization_available: boolean;
  lge_available: boolean;
  t1_mapping_available: boolean;
  coronary_assessment_available: boolean;
  genetic_information_available: boolean;
  lvef_percent: number | null;
  lvedv_ml: number | null;
  lvesv_ml: number | null;
  lvsv_ml: number | null;
  bsa_m2: number | null;
  lvedvi_ml_m2: number | null;
  lvesvi_ml_m2: number | null;
  lvmi_g_m2: number | null;
  max_ed_wall_thickness_mm: number | null;
  peak_global_grs_percent: number | null;
  peak_global_gcs_percent: number | null;
  bsa_indexed: boolean;
  sex_available: boolean;
  sex: "male" | "female" | "unspecified";
  /** From compute_disease_similarity.py::_all_gate_facts — computed for ALL
   *  three profiles, independent of which one ranks top. */
  dcm_gate_met: boolean | null;
  hcm_gate_met: boolean | null;
  nor_gate_met: boolean | null;
  lv_dilatation_present: boolean | null;
  severe_lv_systolic_dysfunction: boolean | null;
  predominant_similarity_pattern: string | null;
  phenotype_headline: string | null;
  pattern_similarity: Record<string, number>;
  similarity_confidence: number | null;
  strain_method: string;
};

/**
 * Build the structured facts block from what's already on screen — no new
 * backend call. EDVI/ESVI/LVMI are recomputed here the same way the on-screen
 * tiles already display them (raw value / bsaM2); the gate/dilatation/
 * dysfunction booleans are NOT recomputed — they're passed straight through
 * from `similarity.phenotype_facts`, the one authoritative source, so this
 * function can never disagree with the report it's describing.
 */
export function buildLvPhenotypeFacts(input: {
  EF?: number | null;
  EDV?: number | null;
  ESV?: number | null;
  StrokeVolume?: number | null;
  PeakGRS?: number | null;
  PeakGCS?: number | null;
  LVMassG?: number | null;
  MaxWallThicknessMm?: number | null;
  bsaM2?: number | null;
  sex?: "male" | "female" | "unspecified";
  similarity?: {
    most_similar?: string | null;
    phenotype_headline?: string | null;
    confidence?: number | null;
    similarities?: { code: string; percent: number }[];
    phenotype_facts?: {
      dcm_gate_met: boolean | null;
      hcm_gate_met: boolean | null;
      nor_gate_met: boolean | null;
      lv_dilatation_present: boolean | null;
      severe_lv_systolic_dysfunction: boolean | null;
    };
  };
}): LvPhenotypeFacts {
  const bsaM2 = input.bsaM2 ?? null;
  const indexed = (v: number | null | undefined): number | null =>
    bsaM2 && v != null ? v / bsaM2 : null;
  // Raw pipeline values carry full floating-point precision (e.g.
  // 26.362933367702023). Sent unrounded, the LLM parrots that exact number
  // back next to the already-rounded "26.4%" from the plain-text context,
  // producing a confusing "EF at 26.36% and LVEF at 26.362933367702023%"
  // duplicate — round everything here to the same precision the rest of the
  // report UI already uses (see useProjectResults.ts's fmt()).
  const round1 = (v: number | null | undefined): number | null =>
    v == null ? null : Math.round(v * 10) / 10;
  const pf = input.similarity?.phenotype_facts;
  const patternSimilarity: Record<string, number> = {};
  for (const s of input.similarity?.similarities ?? []) patternSimilarity[s.code] = round1(s.percent) as number;

  return {
    modality: "short-axis cine cardiac MRI",
    analysis_scope: "LV geometry and function only",
    tissue_characterization_available: false,
    lge_available: false,
    t1_mapping_available: false,
    coronary_assessment_available: false,
    genetic_information_available: false,
    lvef_percent: round1(input.EF),
    lvedv_ml: round1(input.EDV),
    lvesv_ml: round1(input.ESV),
    lvsv_ml: round1(input.StrokeVolume),
    bsa_m2: bsaM2 != null ? Math.round(bsaM2 * 100) / 100 : null,
    lvedvi_ml_m2: round1(indexed(input.EDV)),
    lvesvi_ml_m2: round1(indexed(input.ESV)),
    lvmi_g_m2: round1(indexed(input.LVMassG)),
    max_ed_wall_thickness_mm: round1(input.MaxWallThicknessMm),
    peak_global_grs_percent: round1(input.PeakGRS),
    peak_global_gcs_percent: round1(input.PeakGCS),
    bsa_indexed: bsaM2 != null,
    sex_available: input.sex === "male" || input.sex === "female",
    sex: input.sex ?? "unspecified",
    dcm_gate_met: pf?.dcm_gate_met ?? null,
    hcm_gate_met: pf?.hcm_gate_met ?? null,
    nor_gate_met: pf?.nor_gate_met ?? null,
    lv_dilatation_present: pf?.lv_dilatation_present ?? null,
    severe_lv_systolic_dysfunction: pf?.severe_lv_systolic_dysfunction ?? null,
    predominant_similarity_pattern: input.similarity?.most_similar ?? null,
    phenotype_headline: input.similarity?.phenotype_headline ?? null,
    pattern_similarity: patternSimilarity,
    // Kept as a 0-1 fraction (matches compute_disease_similarity.py's own
    // `confidence`) — the backend already rounds this to 3dp, but round again
    // defensively since it passed through client-side state.
    similarity_confidence:
      input.similarity?.confidence != null ? Math.round(input.similarity.confidence * 1000) / 1000 : null,
    strain_method:
      "geometric cine-mask deformation surrogate; not CMR feature-tracking strain; " +
      "derived from independently segmented masks",
  };
}

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
      // Raw pipeline values carry full floating-point precision (e.g.
      // 26.362933367702023) — round before it reaches the LLM, otherwise it
      // gets echoed back verbatim next to the already-rounded value from
      // buildLvPhenotypeFacts, producing a confusing duplicate.
      parts.push(`${label}: ${Math.round(v * 10) / 10}${unit}`);
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
