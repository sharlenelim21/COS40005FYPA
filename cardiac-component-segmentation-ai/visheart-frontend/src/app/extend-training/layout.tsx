"use client";

import { AdminShell } from "@/components/admin/AdminShell";

// /extend-training lives outside the /admin route segment, so it doesn't automatically pick up
// admin/layout.tsx's sidebar via Next's layout nesting — this gives it the same shell directly.
export default function ExtendTrainingLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
