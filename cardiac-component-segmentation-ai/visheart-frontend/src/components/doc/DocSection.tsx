import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DocSectionProps {
  id: string;
  title?: ReactNode;
  level?: 2 | 3;
  className?: string;
  children: ReactNode;
}

const HEADING_CLASSES = {
  2: "mb-4 text-2xl font-bold tracking-tight md:text-3xl",
  3: "mb-3 text-xl font-semibold tracking-tight md:text-2xl",
} as const;

export function DocSection({ id, title, level = 2, className, children }: DocSectionProps) {
  const headingId = title ? `${id}-heading` : undefined;
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section
      id={id}
      tabIndex={-1}
      aria-labelledby={headingId}
      className={cn("scroll-mt-44 focus:outline-none lg:scroll-mt-32", className)}
    >
      {title && (
        <Heading id={headingId} className={HEADING_CLASSES[level]}>
          {title}
        </Heading>
      )}
      {children}
    </section>
  );
}
