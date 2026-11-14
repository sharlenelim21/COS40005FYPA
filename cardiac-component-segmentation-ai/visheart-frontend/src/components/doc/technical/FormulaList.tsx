import type { ReactNode } from "react";

export interface FormulaItem {
  label: string;
  formula: string;
  note?: ReactNode;
}

/** Labelled formulas in monospace boxes (Technical Guide, "How LV and RV Works"). */
export function FormulaList({ caption, items }: { caption: string; items: FormulaItem[] }) {
  return (
    <div className="bg-card rounded-lg border p-3 md:p-4">
      <p className="mb-3 text-base font-medium">{caption}</p>
      <dl className="space-y-4">
        {items.map((item) => (
          <div key={item.label} className="space-y-1.5">
            <dt className="text-base font-semibold">{item.label}</dt>
            <dd className="space-y-1">
              <code className="bg-muted block rounded-md px-3 py-2 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap">
                {item.formula}
              </code>
              {item.note && <p className="text-muted-foreground text-sm leading-5">{item.note}</p>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
