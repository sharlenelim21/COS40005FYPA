"use client";

import React from "react";
import Image from "next/image";

/**
 * Chrome shared by every printed report page: A4-proportioned card, VisHeart
 * header with patient/status badges, title block, and a footer with page count.
 * Each page is a `.vh-report-page` — see globals.css for the @media print rules
 * that lay these out as one-page-per-sheet when the user prints/saves as PDF.
 */
export function ReportPageFrame({
  pageNumber,
  totalPages,
  patientLabel,
  statusLabel = "Preview",
  title,
  subtitle,
  generatedAt,
  children,
}: {
  pageNumber: number;
  totalPages: number;
  patientLabel: string;
  statusLabel?: string;
  title: string;
  subtitle: string;
  generatedAt: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="vh-report-page mx-auto mb-6 flex w-[210mm] min-h-[297mm] flex-col rounded-lg border border-border bg-background p-6 text-[11px] leading-snug text-foreground shadow-sm print:mb-0 print:rounded-none print:border-0 print:shadow-none"
      data-page={pageNumber}
    >
      <header className="mb-3 flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center gap-1.5 text-base font-bold">
          <Image src="/visheart_logo.svg" alt="" width={18} height={18} className="h-[18px] w-[18px]" />
          VisHeart
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{patientLabel}</span>
          <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
            {statusLabel}
          </span>
        </div>
      </header>

      <h2 className="text-[15px] font-bold text-foreground">{title}</h2>
      <p className="mb-3 text-[10px] text-muted-foreground">{subtitle}</p>

      <div className="flex-1">{children}</div>

      <footer className="mt-4 flex items-center justify-between border-t border-border pt-2 text-[8.5px] text-muted-foreground">
        <span>Generated {generatedAt}</span>
        <span>Page {pageNumber} of {totalPages}</span>
      </footer>
    </section>
  );
}
