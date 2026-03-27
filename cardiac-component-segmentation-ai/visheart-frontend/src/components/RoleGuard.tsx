// This component protects sections or components based on their roles
// Example:
// // src/components/SignUpBanner.tsx
// "use client";

// import { ShowForGuest } from "@/components/role-guard";

// export function SignUpBanner() {
//   return (
//     <ShowForGuest>
//       <div className="rounded-lg bg-blue-100 p-4 text-center">
//         <p className="font-medium">
//           New here? <a href="/register" className="underline">Create an account</a> to unlock more features!
//         </p>
//       </div>
//     </ShowForGuest>
//   );
// }

"use client";

import { useAuth } from "@/context/auth-context";

interface RoleGuardProps {
  children: React.ReactNode;
  allowedRoles?: string[];
  fallback?: React.ReactNode;
  requireAuth?: boolean;
}

export function RoleGuard({
  children,
  allowedRoles = [],
  fallback = null,
  requireAuth = true,
}: RoleGuardProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  // If auth is required but user is not logged in
  if (requireAuth && !user) {
    return <>{fallback}</>;
  }

  // If no roles specified, just check auth
  if (allowedRoles.length === 0) {
    return requireAuth && !user ? <>{fallback}</> : <>{children}</>;
  }

  // Check if user has required role
  if (user && allowedRoles.includes(user.role)) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}

// Convenience components
export function ShowForAdmin({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return (
    <RoleGuard allowedRoles={["admin"]} fallback={fallback}>
      {children}
    </RoleGuard>
  );
}

export function ShowForUser({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return (
    <RoleGuard allowedRoles={["user", "admin", "guest"]} fallback={fallback}>
      {children}
    </RoleGuard>
  );
}

export function ShowForGuest({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return (
    <RoleGuard allowedRoles={["guest"]} fallback={fallback}>
      {children}
    </RoleGuard>
  );
}

export function HideForGuest({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return (
    <RoleGuard allowedRoles={["user", "admin"]} fallback={fallback}>
      {children}
    </RoleGuard>
  );
}

// New component: Show only for registered users (user, admin) - excludes guests
export function ShowForRegisteredUser({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return (
    <RoleGuard allowedRoles={["user", "admin"]} fallback={fallback}>
      {children}
    </RoleGuard>
  );
}
