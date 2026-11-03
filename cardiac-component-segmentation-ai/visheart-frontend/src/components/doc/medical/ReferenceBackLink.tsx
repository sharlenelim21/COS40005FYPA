"use client";

import { useEffect } from "react";
import { CornerLeftUp } from "lucide-react";

const CITE_REF_ATTR = "data-cite-ref";

const lastClickedCitation = new Map<string, HTMLElement>();
let listenerInstalled = false;

function recordCitationClicks(event: MouseEvent) {
  const link = (event.target as Element | null)?.closest?.(`a[${CITE_REF_ATTR}]`);
  const refId = link?.getAttribute(CITE_REF_ATTR);
  if (link instanceof HTMLElement && refId) lastClickedCitation.set(refId, link);
}

export function ReferenceBackLink({ refId, number }: { refId: string; number: number }) {
  useEffect(() => {
    if (listenerInstalled) return;
    listenerInstalled = true;
    document.addEventListener("click", recordCitationClicks, true);
  }, []);

  const goBack = () => {
    const remembered = lastClickedCitation.get(refId);
    const target =
      (remembered?.isConnected ? remembered : null) ??
      document.querySelector<HTMLElement>(`a[${CITE_REF_ATTR}="${CSS.escape(refId)}"]`);
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    target.focus({ preventScroll: true });
  };

  return (
    <button
      type="button"
      onClick={goBack}
      aria-label={`Back to where reference ${number} is cited`}
      title="Back to text"
      className="text-primary focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm text-xs underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
    >
      <CornerLeftUp className="h-3 w-3" aria-hidden="true" />
      Back to text
    </button>
  );
}
