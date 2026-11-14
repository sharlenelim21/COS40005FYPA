// app/contact/layout.tsx
import type { Metadata } from "next";
import { ProtectedRoute } from "@/components/ProtectedRoute";

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
  return <ProtectedRoute allowedRoles={["guest", "user", "admin"]}>{children}</ProtectedRoute>;
}
