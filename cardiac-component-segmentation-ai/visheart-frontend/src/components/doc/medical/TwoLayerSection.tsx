import type { ReactNode } from "react";
import { ChevronDown, Stethoscope } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DocSection } from "@/components/doc/DocSection";

interface TwoLayerSectionProps {
  id: string;
  title: ReactNode;
  level?: 2 | 3;
  summary?: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
}

export function TwoLayerSection({ id, title, level = 2, summary, detail, children }: TwoLayerSectionProps) {
  return (
    <DocSection id={id} title={title} level={level}>
      <div className="space-y-5">
        {summary && <div className="space-y-3 leading-7">{summary}</div>}

        {detail && (
          <Collapsible className="group/detail bg-card rounded-lg border">
            <CollapsibleTrigger className="hover:bg-muted/50 focus-visible:ring-ring flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none">
              <Stethoscope className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden="true" />
              Clinical detail
              <span className="text-muted-foreground hidden font-normal sm:inline">· for clinicians</span>
              <ChevronDown
                className="text-muted-foreground ml-auto h-4 w-4 shrink-0 transition-transform group-data-[state=open]/detail:rotate-180"
                aria-hidden="true"
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t px-4 py-4">
              <div className="text-muted-foreground space-y-3 text-sm leading-6">{detail}</div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {children}
      </div>
    </DocSection>
  );
}
