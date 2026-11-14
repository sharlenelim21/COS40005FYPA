// This is a library for react hooks related to the login functionality
// Most of the functions are used in the Login.tsx file

import { useState } from "react";
import { useAuth } from "@/context/auth-context";
import { useRouter } from "next/navigation";
import { readNextParam } from "@/lib/safeNext";

export function useLogin(redirectTo: string = "#") {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isRedirecting, setIsRedirecting] = useState(false);
  const { login, guestLogin, error, loading } = useAuth();
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Add a minimum 1-second delay to show the signing in spinner
      const [authenticatedUser] = await Promise.all([
        login(username, password),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      // Set redirecting state to prevent login screen flash
      if (redirectTo !== "#") {
        setIsRedirecting(true);
        // Admin's landing page is the Admin Panel (oversight is their primary job here), not
        // the pipeline dashboard every other role lands on -- same rule ProtectedRoute's
        // RegistrationOnly already applies on a route-mount recheck, but that never fires here
        // since this push already navigates away before it would run.
        router.push(readNextParam() ?? (authenticatedUser.role === "admin" ? "/admin" : redirectTo));
      }
    } catch (error) {
      // Reset redirecting state on error
      setIsRedirecting(false);
      // Error is handled by the auth context
      console.error("Login failed:", error);
    }
  };

  const handleGuestLogin = async () => {
    try {
      // Add a minimum 1-second delay to show the loading spinner
      const [authenticatedUser] = await Promise.all([
        guestLogin(),
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      // Set redirecting state to prevent login screen flash
      if (redirectTo !== "#") {
        setIsRedirecting(true);
        router.push(readNextParam() ?? (authenticatedUser.role === "admin" ? "/admin" : redirectTo));
      }
    } catch (error) {
      // Reset redirecting state on error
      setIsRedirecting(false);
      // Error is handled by the auth context
      console.error("Guest login failed:", error);
    }
  };

  return {
    username,
    setUsername,
    password,
    setPassword,
    error,
    loading,
    isRedirecting,
    handleLogin,
    handleGuestLogin,
  };
}
