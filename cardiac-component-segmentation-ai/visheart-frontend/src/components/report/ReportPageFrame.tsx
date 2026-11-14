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
  /** "ED/ES Only" or "Full Research" — which export mode this page belongs to.
   *  Repeated on every page (header badge + footer) per the two-mode report
   *  redesign, so a reader can tell which report they're holding from any
   *  single sheet, not just the first page. */
  modeLabel,
  children,
}: {
  pageNumber: number;
  totalPages: number;
  patientLabel: string;
  statusLabel?: string;
  title: string;
  subtitle: string;
  generatedAt: string;
  modeLabel?: string;
  children: React.ReactNode;
}) {
  // A4 geometry (210×297mm) is what makes print/PDF come out one page per sheet,
  // so it stays. The card chrome (border/shadow/radius) was screen-only and is
  // dropped so the on-screen view reads like the rest of the app rather than a
  // boxed-in document.
  return (
    <section
      className="vh-report-page mx-auto mb-8 flex w-[210mm] min-h-[297mm] flex-col bg-white p-6 text-[13.5px] leading-snug text-gray-900 print:mb-0"
      data-page={pageNumber}
    >
      <header className="mb-3 flex items-center justify-between border-b border-gray-300 pb-2">
        <div className="flex items-center gap-1.5 text-base font-bold">
          {/* priority -- disables next/image's default lazy-loading. This same
              18x18 logo repeats on every one of the report's 6-32 pages;
              without `priority`, the copies below the fold never trigger
              their IntersectionObserver in a document the user never scrolls
              before clicking Print, so they're still unloaded the moment
              window.print() fires. Print DOES force lazy images to load, but
              that load is async and can still be mid-flight when Chrome
              paginates, shifting that one page's header height just enough
              to spill its tail onto an otherwise-blank next page -- a likely
              cause of the recurring blank-page reports, independent of (and
              probably more consequential than) the print-paint-timing race
              the double rAF in handlePrint already guards against. */}
          <Image src="/visheart_logo.svg" alt="" width={18} height={18} priority className="h-[18px] w-[18px]" />
          VisHeart
        </div>
        <div className="flex items-center gap-1.5">
          {modeLabel && (
            <span className="rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-[13px] font-semibold text-indigo-700">
              {modeLabel}
            </span>
          )}
          <span className="rounded-full border border-gray-300 px-2 py-0.5 text-[13px] text-gray-600">{patientLabel}</span>
          <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-[13px] font-semibold text-emerald-700">
            {statusLabel}
          </span>
        </div>
      </header>

      <h2 className="text-[21px] font-extrabold tracking-tight text-gray-900">{title}</h2>
      <p className="mb-3 text-[13.5px] text-gray-900/70">{subtitle}</p>

      <div className="min-h-0 flex-1">{children}</div>

      <footer className="mt-4 flex items-center justify-between border-t border-gray-300 pt-2 text-[12px] text-gray-600">
        <span>Generated {generatedAt}{modeLabel ? ` · ${modeLabel}` : ""}</span>
        <span>Page {pageNumber} of {totalPages}</span>
      </footer>
    </section>
  );
}
