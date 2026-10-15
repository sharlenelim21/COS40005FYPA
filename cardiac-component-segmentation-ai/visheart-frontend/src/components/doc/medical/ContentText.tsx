import { Fragment } from "react";

const PLACEHOLDER_SPLIT = /(\[PLACEHOLDER:[^\]]*\])/;
const IS_PLACEHOLDER = /^\[PLACEHOLDER:[^\]]*\]$/;

export function ContentText({ text }: { text: string }) {
  const parts = text.split(PLACEHOLDER_SPLIT);
  return (
    <>
      {parts.map((part, index) =>
        IS_PLACEHOLDER.test(part) ? (
          <span
            key={index}
            className="rounded border border-dashed border-amber-400 bg-amber-50 px-1 font-mono text-[0.85em] text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
