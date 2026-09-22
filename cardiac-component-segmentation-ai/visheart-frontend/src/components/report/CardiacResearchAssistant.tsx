"use client";

/**
 * CardiacResearchAssistant — an in-report panel that answers heart-literature
 * questions with cited sources, from the separate local assistant service.
 *
 * It is a research/suggestion tool, NOT a diagnostic aid. It never asserts a
 * diagnosis; it summarises what the literature reports about similar patterns.
 *
 * The patient's computed measurements are passed as read-only context so
 * "Explain these results" is grounded in this specific report. Nothing here is
 * generated locally — every answer and citation comes from the assistant.
 */

import React, { useEffect, useRef, useState } from "react";
import { BookOpen, Sparkles, Send, ExternalLink, Loader2, AlertTriangle, FileText, Trash2, BadgeCheck } from "lucide-react";
import {
  researchApi,
  researchAssistantEnabled,
  type ResearchAnswer,
  type LvPhenotypeFacts,
} from "@/lib/researchApi";

type Props = {
  /** Prebuilt patient-context string (see buildPatientContext). Empty = none. */
  patientContext?: string;
  /**
   * Structured, backend-computed phenotype facts (see buildLvPhenotypeFacts) —
   * sent alongside `patientContext` so the assistant's answer is constrained
   * to the deterministic gate result instead of inferring the phenotype from
   * raw numbers + whatever literature it happens to retrieve. Optional so a
   * caller with no disease-similarity result yet still gets a plain /explain.
   */
  patientFacts?: LvPhenotypeFacts;
  /**
   * Identifies which report this panel belongs to (e.g. the project ID), so
   * the persisted conversation and session_id are scoped per-report — opening
   * a different patient's report starts a fresh conversation rather than
   * showing the previous patient's chat.
   */
  storageKey?: string;
};

type Turn = {
  question: string;
  answer?: ResearchAnswer;
  error?: string;
  loading: boolean;
};

const QUICK_ACTIONS = [
  "Explain these results",
  "Explain Peak GRS",
  "Compare HCM and DCM",
];

/**
 * sessionStorage (not localStorage): survives switching tabs and coming back
 * — the actual bug being fixed — but clears when the browser tab is closed,
 * which is the right lifetime for "the conversation about this report visit"
 * rather than a permanent chat history.
 */
function storage() {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

function loadTurns(key: string): Turn[] {
  try {
    const raw = storage()?.getItem(`cra:turns:${key}`);
    return raw ? (JSON.parse(raw) as Turn[]) : [];
  } catch {
    return []; // corrupted/old-shape data -> start clean rather than crash
  }
}

function saveTurns(key: string, turns: Turn[]) {
  try {
    // Never persist a turn stuck mid-request -- resuming a tab shouldn't show
    // a permanently spinning loader for a request that will never complete.
    const persistable = turns.filter((t) => !t.loading);
    storage()?.setItem(`cra:turns:${key}`, JSON.stringify(persistable));
  } catch {
    // Storage full or unavailable (private browsing) -- conversation still
    // works for this tab session, it just won't survive a switch. Non-fatal.
  }
}

function freshSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadOrCreateSessionId(key: string): string {
  const storageKey = `cra:session:${key}`;
  const existing = storage()?.getItem(storageKey);
  if (existing) return existing;
  const fresh = freshSessionId();
  storage()?.setItem(storageKey, fresh);
  return fresh;
}

export default function CardiacResearchAssistant({ patientContext, patientFacts, storageKey = "default" }: Props) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [input, setInput] = useState("");
  // Restored synchronously from sessionStorage so a tab switch never shows an
  // empty panel before the effect below runs.
  const [turns, setTurns] = useState<Turn[]>(() => loadTurns(storageKey));
  // NOT `const [sessionId]` -- "New conversation" below needs to replace this,
  // e.g. after a backend fix, so an old answer sitting in the transcript
  // doesn't get mistaken for what the CURRENT code would produce, and so a
  // stale server-side follow-up topic can't leak into a fresh question.
  const [sessionId, setSessionId] = useState<string>(() => loadOrCreateSessionId(storageKey));
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Wipes this patient's persisted chat + starts a new session_id. The old
   *  turns are just static text -- they never re-run against updated backend
   *  logic, so without this, a bug fix can look like it "didn't work" when
   *  really the panel is just showing an answer from before the fix. */
  function startNewConversation() {
    setTurns([]);
    const fresh = freshSessionId();
    setSessionId(fresh);
    try {
      storage()?.removeItem(`cra:turns:${storageKey}`);
      storage()?.setItem(`cra:session:${storageKey}`, fresh);
    } catch {
      // Storage unavailable -- the in-memory state above still resets for
      // this tab, it just won't stick if the tab is somehow restored.
    }
  }

  // Check the service is up once on mount (only if a URL is configured).
  useEffect(() => {
    if (!researchAssistantEnabled) {
      setOnline(false);
      return;
    }
    researchApi.health().then(setOnline);
  }, []);

  // Persist every change so switching tabs and coming back restores the chat.
  useEffect(() => {
    saveTurns(storageKey, turns);
  }, [turns, storageKey]);

  // Keep the newest turn in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const busy = turns.some((t) => t.loading);

  async function run(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    const index = turns.length;
    setTurns((prev) => [...prev, { question: q, loading: true }]);

    try {
      // "Explain these results" (and having patient data) -> /explain with
      // context; anything else is a free-text /ask.
      const useExplain = patientContext && /explain these results/i.test(q);
      const res = useExplain
        ? await researchApi.explain(patientContext!, undefined, sessionId, patientFacts)
        : patientContext
          ? await researchApi.explain(patientContext, q, sessionId, patientFacts)
          : await researchApi.ask(q, sessionId);
      setTurns((prev) =>
        prev.map((t, i) => (i === index ? { ...t, answer: res, loading: false } : t)),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setTurns((prev) =>
        prev.map((t, i) => (i === index ? { ...t, error: message, loading: false } : t)),
      );
    }
  }

  return (
    <div className="rounded-xl border border-teal-200 bg-white shadow-sm dark:border-teal-900/50 dark:bg-slate-900">
      {/* Header — teal accent theme. */}
      <div className="flex items-center gap-2.5 border-b border-teal-100 px-5 py-4 dark:border-slate-700">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/40">
          <BookOpen className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden />
        </div>
        <h2 className="text-[15px] font-bold text-slate-800 dark:text-slate-100">Cardiac Research Suggestion Assistant</h2>
        <span className="ml-auto rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-teal-600 dark:bg-teal-900/30 dark:text-teal-300">
          Research aid · not diagnostic
        </span>
        {/* Old turns are static text — they never re-run against updated
            backend logic, so after a fix this is the only way to confirm a
            genuinely fresh answer instead of re-reading a stale one. */}
        {turns.length > 0 && (
          <button
            type="button"
            onClick={startNewConversation}
            disabled={busy}
            title="Start a new conversation — clears this patient's saved chat"
            className="flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
            New conversation
          </button>
        )}
      </div>

      {/* Offline notice */}
      {online === false && (
        <div className="flex items-start gap-2 px-5 py-6 text-[13px] text-slate-600 dark:text-slate-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          <div>
            The research assistant service isn’t reachable. Start it locally
            (<code className="rounded bg-slate-100 px-1 text-slate-800 dark:bg-slate-800 dark:text-slate-100">uvicorn app:app --port 8000</code>)
            and set <code className="rounded bg-slate-100 px-1 text-slate-800 dark:bg-slate-800 dark:text-slate-100">NEXT_PUBLIC_RESEARCH_API_URL</code>.
          </div>
        </div>
      )}

      {online !== false && (
        <>
          {/* Conversation */}
          <div ref={scrollRef} className="max-h-96 space-y-4 overflow-y-auto px-5 py-4">
            {turns.length === 0 && (
              <p className="text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
                Ask about the cardiac metrics, disease patterns, or relevant
                literature, and I’ll <span className="font-medium text-slate-600 dark:text-slate-300">suggest research to read</span> —
                every answer cites its sources. I point you to the literature; I don’t diagnose.
              </p>
            )}

            {turns.map((turn, i) => (
              <div key={i} className="space-y-2">
                <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-teal-600 px-3 py-2 text-[13px] text-white">
                  {turn.question}
                </div>

                {turn.loading && (
                  <div className="flex items-center gap-2 text-[13px] text-slate-500 dark:text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Searching the literature…
                  </div>
                )}

                {turn.error && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    {turn.error}
                  </div>
                )}

                {turn.answer && (
                  <div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-slate-50 px-3 py-2 dark:bg-slate-800">
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800 dark:text-slate-100">
                      {turn.answer.answer}
                    </p>

                    {turn.answer.sources.length > 0 && (
                      <div className="mt-3 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                          Sources
                        </p>
                        {turn.answer.sources.map((s) => (
                          <div key={s.n} className="flex items-start gap-1.5 text-xs">
                            <span className="font-mono text-slate-400">[{s.n}]</span>
                            <div className="flex-1">
                              <a
                                href={s.url ?? undefined}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group text-slate-600 transition-colors hover:text-teal-700 dark:text-slate-300 dark:hover:text-teal-400"
                              >
                                {s.title}
                                {s.year ? ` (${s.year})` : ""}
                                {s.url && (
                                  <ExternalLink className="ml-1 inline h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                                )}
                              </a>
                              {/* Citation count — Europe PMC's own number,
                                  backfilled via OpenAlex when missing/zero.
                                  Plain text, not a badge: it's a magnitude
                                  signal ("how established"), not a pass/fail
                                  check like the ones below. */}
                              {typeof s.citation_count === "number" && (
                                <span className="ml-1.5 text-slate-400 dark:text-slate-500">
                                  · {s.citation_count.toLocaleString()} citation{s.citation_count === 1 ? "" : "s"}
                                </span>
                              )}
                              {/* Semantic Scholar's one-line AI summary — a
                                  quick preview before clicking through. Absent
                                  more often than not (its keyless endpoint
                                  rate-limits hard), so this simply doesn't
                                  render rather than showing a placeholder. */}
                              {s.tldr && (
                                <p className="mt-0.5 text-[11px] italic leading-snug text-slate-500 dark:text-slate-400">
                                  {s.tldr}
                                </p>
                              )}
                              {/* Only shown when Unpaywall found a legally-free
                                  full text — abstracts alone often aren't enough. */}
                              {s.pdf_url && (
                                <a
                                  href={s.pdf_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="ml-2 inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700 transition-colors hover:bg-teal-100 dark:bg-teal-900/30 dark:text-teal-300 dark:hover:bg-teal-900/50"
                                >
                                  <FileText className="h-2.5 w-2.5" aria-hidden />
                                  Free PDF
                                </a>
                              )}
                              {/* Crossref DOI check — `verified === false` is a
                                  real red flag (title doesn't match the DOI's
                                  own bibliographic record) worth surfacing;
                                  `null`/`undefined` (not checked — no DOI, or
                                  the lookup failed) shows nothing rather than
                                  implying every unchecked source is suspect. */}
                              {s.verified === true && (
                                <span
                                  className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                                  title="This citation's title matches the DOI's own Crossref record."
                                >
                                  <BadgeCheck className="h-2.5 w-2.5" aria-hidden />
                                  Verified
                                </span>
                              )}
                              {s.verified === false && (
                                <span
                                  className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300"
                                  title="This citation's title does not match the DOI's own Crossref record — treat with caution."
                                >
                                  <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                                  Title mismatch
                                </span>
                              )}
                              {/* Lexical-overlap heuristic, not true entailment
                                  — only the negative case is shown (a softer,
                                  lower-confidence signal than Crossref, so no
                                  positive badge to avoid overclaiming). Flags
                                  a citation whose neighbouring sentence shares
                                  almost no vocabulary with that source's own
                                  abstract — worth a second look, not proof the
                                  claim is wrong. */}
                              {s.content_supported === false && (
                                <span
                                  className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                  title="The text next to this citation shares little vocabulary with the source's own abstract — it may not actually address the claim."
                                >
                                  <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                                  May not support claim
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap gap-2 px-5 pb-2">
            {QUICK_ACTIONS.map((action) => {
              // Only offer "Explain these results" when we have patient data.
              if (/these results/i.test(action) && !patientContext) return null;
              return (
                <button
                  key={action}
                  type="button"
                  disabled={busy}
                  onClick={() => run(action)}
                  className="flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-teal-400 hover:text-teal-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:text-teal-400"
                >
                  <Sparkles className="h-3 w-3" aria-hidden />
                  {action}
                </button>
              );
            })}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(input);
            }}
            className="flex items-center gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask a heart-related question…"
              disabled={busy || online === null}
              className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none focus:border-teal-400 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="flex items-center justify-center rounded-lg bg-teal-600 px-3 py-2 text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
              aria-label="Send"
            >
              <Send className="h-4 w-4" aria-hidden />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
