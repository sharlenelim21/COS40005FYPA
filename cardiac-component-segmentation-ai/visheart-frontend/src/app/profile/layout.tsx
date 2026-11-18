import { ProtectedRoute } from "@/components/ProtectedRoute";

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute allowedRoles={["guest", "user", "admin"]}>{children}</ProtectedRoute>;
}
