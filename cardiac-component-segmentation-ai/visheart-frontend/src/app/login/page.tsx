"use client";

import { LoginForm } from "@/components/LoginForm";
import { RegistrationOnly } from "@/components/ProtectedRoute";

/**
 * Login Page Component
 *
 * Provides a dedicated login interface for users to authenticate.
 * This page is protected to prevent already authenticated users from accessing it.
 *
 * Features:
 * - User authentication with form validation
 * - Guest login support
 * - Responsive design
 * - Protected route (redirects authenticated users)
 *
 * @returns JSX.Element - Rendered login page
 */
export default function LoginPage() {
  return (
    <RegistrationOnly redirectTo="/dashboard">
      <div className="bg-background">
        {/* Login Form Component */}
        <LoginForm />
      </div>
    </RegistrationOnly>
  );
}
