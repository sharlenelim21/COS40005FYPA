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
import { BookOpen, Sparkles, Send, ExternalLink, Loader2, AlertTriangle } from "lucide-react";
import {
  researchApi,
  researchAssistantEnabled,
  type ResearchAnswer,
} from "@/lib/researchApi";

type Props = {
  /** Prebuilt patient-context string (see buildPatientContext). Empty = none. */
  patientContext?: string;
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

export default function CardiacResearchAssistant({ patientContext }: Props) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Check the service is up once on mount (only if a URL is configured).
  useEffect(() => {
    if (!researchAssistantEnabled) {
      setOnline(false);
      return;
    }
    researchApi.health().then(setOnline);
  }, []);

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
        ? await researchApi.explain(patientContext!, undefined)
        : patientContext
          ? await researchApi.explain(patientContext, q)
          : await researchApi.ask(q);
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
                          <a
                            key={s.n}
                            href={s.url ?? undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-start gap-1.5 text-xs text-slate-600 transition-colors hover:text-teal-700 dark:text-slate-300 dark:hover:text-teal-400"
                          >
                            <span className="font-mono text-slate-400">[{s.n}]</span>
                            <span className="flex-1">
                              {s.title}
                              {s.year ? ` (${s.year})` : ""}
                            </span>
                            {s.url && (
                              <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100" aria-hidden />
                            )}
                          </a>
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
