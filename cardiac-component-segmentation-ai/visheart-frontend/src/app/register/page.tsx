"use client";

import { RegistrationForm } from "@/components/RegistrationForm";
import { RegistrationOnly } from "@/components/ProtectedRoute";

/**
 * Registration Page Component
 *
 * Provides a user registration interface for new users to create accounts.
 * This page is protected to prevent already authenticated users from accessing it.
 *
 * Features:
 * - Full user registration with form validation
 * - Guest account upgrade support
 * - Responsive design
 * - Protected route (redirects authenticated users)
 *
 * @returns JSX.Element - Rendered registration page
 */
export default function RegisterPage() {
  return (
    <RegistrationOnly>
      <div className="from-background to-muted/20 flex min-h-screen items-center justify-center bg-gradient-to-br p-4">
        <div className="w-full max-w-md">
          {/* Registration Form Component */}
          <RegistrationForm
            className="bg-card/80 border-0 shadow-xl backdrop-blur-sm"
            onSuccess={(userData: unknown) => {
              console.log("Registration successful:", userData);
              // Additional success handling can be added here
            }}
          />
        </div>
      </div>
    </RegistrationOnly>
  );
}
