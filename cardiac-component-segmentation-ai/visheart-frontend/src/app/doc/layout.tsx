import type { ReactNode } from "react";
import { GuideSwitch } from "@/components/doc/GuideSwitch";
import { DocSearch } from "@/components/doc/DocSearch";

export default function DocLayout({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background min-h-screen">
      <div className="bg-background sticky top-10 z-40 border-b">
        <div className="container mx-auto flex h-14 items-center gap-3 px-4">
          <GuideSwitch />
          <div className="ml-auto w-full min-w-0 max-w-xs">
            <DocSearch />
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
