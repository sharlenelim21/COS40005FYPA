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
  checkAuthStatus: () => Promise<User | null>;
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

  const fetchUserData = async (): Promise<User | null> => {
    try {
      const response = await authApi.fetchUser();
      if (response.fetch && response.user) {
        setUser(response.user);
        return response.user;
      } else {
        setUser(null);
        return null;
      }
    } catch (err) {
      const errorStatus = (err as any)?.response?.status;
      const isNetworkError = (err as any)?.code === "ERR_NETWORK" || (err as any)?.message === "Network Error";
      if (errorStatus !== 401 && errorStatus !== 403 && !isNetworkError) {
        console.error("Auth check failed:", err);
      }
      setUser(null);
      return null;
    }
  };

  const checkAuthStatus = async (): Promise<User | null> => {
    setLoading(true);
    try {
      return await fetchUserData();
    } finally {
      setLoading(false);
    }
  };

  const login = async (username: string, password: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await authApi.login(username, password);
      if (!response?.login) {
        throw new Error("Login failed");
      }

      const authenticatedUser = await fetchUserData();
      if (!authenticatedUser) {
        throw new Error(
          "Login succeeded but no active session was found. Please check browser cookie settings and backend session configuration.",
        );
      }
    } catch (err: any) {
      const status = err.response?.status;
      const data = err.response?.data;
      let errorMessage = data?.message || err.message || "Login failed";
      if (status === 429) {
        errorMessage = data?.message ?? "Too many login attempts. Please try again in 10 minutes.";
      } else if (status === 423) {
        const mins = data?.minutesRemaining;
        errorMessage = data?.message ?? `Account locked. Try again in ${mins ?? 10} minute${mins !== 1 ? "s" : ""}.`;
      }
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
      await authApi.guestLogin();
      await fetchUserData();
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || "Guest login failed";
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
