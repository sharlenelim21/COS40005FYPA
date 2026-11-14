"use client";

import type { ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

interface FooterSectionProps {
  id: string;
  title: string;
  subtitle?: string;
  className?: string;
  children: ReactNode;
}

export function FooterSection({ id, title, subtitle, className, children }: FooterSectionProps) {
  return (
    <section aria-labelledby={id} className={cn("min-w-0", className)}>
      <Accordion type="single" collapsible className="sm:hidden">
        <AccordionItem value={id} className="border-b">
          <AccordionTrigger className="py-3">
            <span className="min-w-0">
              <span id={`${id}-mobile`} className="text-foreground block text-sm font-semibold">
                {title}
              </span>
              {subtitle && <span className="text-muted-foreground block text-xs font-normal">{subtitle}</span>}
            </span>
          </AccordionTrigger>
          <AccordionContent>{children}</AccordionContent>
        </AccordionItem>
      </Accordion>
      <div className="hidden space-y-3 sm:block">
        <div>
          <h3 id={id} className="text-foreground text-sm font-semibold">
            {title}
          </h3>
          {subtitle && <p className="text-muted-foreground mt-1 text-xs">{subtitle}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}
