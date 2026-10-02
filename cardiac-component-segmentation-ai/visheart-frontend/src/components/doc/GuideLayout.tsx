import type { ReactNode } from "react";
import { TableOfContents } from "@/components/doc/TableOfContents";
import type { TocItem } from "@/components/doc/guides";

interface GuideLayoutProps {
  title: string;
  description?: ReactNode;
  toc: TocItem[];
  children: ReactNode;
}

export function GuideLayout({ title, description, toc, children }: GuideLayoutProps) {
  return (
    <div className="container mx-auto px-4">
      <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[16rem_minmax(0,1fr)]">
        <TableOfContents items={toc} />
        <main id="doc-content" className="min-w-0 pt-6 pb-28 md:pt-8 md:pb-32">
          <header className="mb-8 border-b pb-6 md:mb-10">
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
            {description && <p className="text-muted-foreground mt-2">{description}</p>}
          </header>
          <div className="space-y-16 md:space-y-20">{children}</div>
        </main>
      </div>
    </div>
  );
}
