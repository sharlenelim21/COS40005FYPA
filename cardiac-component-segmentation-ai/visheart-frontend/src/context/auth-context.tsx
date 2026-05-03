// This is used to check if there is a User logged in

// Example of using would be:
// import { useAuth } from '@/contexts/auth-context';

// export default function ProfileButton() {
//   const { user, logout } = useAuth();

//   if (!user) {
//     return <button>Login</button>;
//   }

//   return (
//     <div>
//       <span>Welcome, {user.username}</span>
//       <button onClick={logout}>Logout</button>
//     </div>
//   );
// }

"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { authApi } from "@/lib/api";

interface User {
  _id: string;
  username: string;
  email: string;
  phone: string;
  role: string;
  createdAt: string;
  updatedAt: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  guestLogin: () => Promise<void>;
  logout: () => Promise<void>;
  checkAuthStatus: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check auth status on mount
  // If no session, automatically log in as guest
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async (): Promise<boolean> => {
    setLoading(true);
    try {
      const response = await authApi.fetchUser();
      if (response.fetch && response.user) {
        setUser(response.user);
        return true;
      }
      setUser(null);
      return false;
    } catch (err) {
      // Only log unexpected errors (not authentication failures)
      const errorStatus = (err as any)?.response?.status;
      const isNetworkError = (err as any)?.code === "ERR_NETWORK" || (err as any)?.message === "Network Error";
      if (errorStatus !== 401 && errorStatus !== 403 && !isNetworkError) {
        console.error("Auth check failed:", err);
      }
      setUser(null);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const login = async (username: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await authApi.login(username, password);
      if (response.login) {
        const authenticated = await checkAuthStatus();
        if (!authenticated) {
          const errorMessage = "Login succeeded, but your session was not established. Please refresh and try again.";
          setError(errorMessage);
          throw new Error(errorMessage);
        }
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || "Login failed";
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const guestLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await authApi.guestLogin();
      if (response && response.guest) {
        const authenticated = await checkAuthStatus();
        if (!authenticated) {
          const errorMessage = "Guest session started, but your session was not established. Please refresh and try again.";
          setError(errorMessage);
          throw new Error(errorMessage);
        }
      }
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || "Guest login failed";
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await authApi.logout();
      setUser(null);
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || "Logout failed";
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        login,
        guestLogin,
        logout,
        checkAuthStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
