// app/contact/layout.tsx
import type { Metadata } from "next";

/** Segment‑level SEO (inherits from root, can be overridden by pages) */
export const metadata: Metadata = {
  title: "VisHeart Dashboard",
  description: "VisHeart Account Settings",
};

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    /* Keep this minimal for now; add nav, sidebar, etc. later */
    <section className="max-w-8xl mx-auto p-6">{children}</section>
  );
}
