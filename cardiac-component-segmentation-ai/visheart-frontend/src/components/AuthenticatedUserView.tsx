"use client";

import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import {
  ShowForAdmin,
  ShowForUser,
  ShowForGuest,
} from "@/components/RoleGuard";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  LogOut,
  Settings,
  Shield,
  User,
  UserCheck,
  AlertCircleIcon,
} from "lucide-react";

const RoleBadge = () => {
  const { user } = useAuth();

  if (!user) return null;

  const roleConfig = {
    admin: {
      icon: <Shield className="inline-flex h-4 w-4 text-blue-600" />,
      colors: "bg-blue-100 text-blue-800 border-blue-200",
    },
    user: {
      icon: <UserCheck className="inline-flex h-4 w-4 text-green-600" />,
      colors: "bg-green-100 text-green-800 border-green-200",
    },
    guest: {
      icon: <User className="inline-flex h-4 w-4 text-gray-500" />,
      colors: "bg-gray-100 text-gray-800 border-gray-200",
    },
  };

  const config =
    roleConfig[user.role as keyof typeof roleConfig] || roleConfig.guest;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium ${config.colors}`}
    >
      {config.icon}
      <span className="ml-1 capitalize">{user.role}</span>
    </span>
  );
};

export const AuthenticatedUserView = () => {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <div className="w-full max-w-[400px] pb-5 select-none sm:w-[400px]">
      <CardHeader className="pb-4 text-center">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-0">
          <div className="flex-1 text-center sm:text-left">
            <CardTitle className="text-lg">Welcome back,</CardTitle>
            <p className="text-muted-foreground text-sm">
              {user.role === "guest" ? "Guest User" : user.username}
            </p>
          </div>
          <div className="flex justify-center sm:justify-end">
            <RoleBadge />
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-3 px-4 sm:px-6">
        <ShowForGuest fallback={null}>
          <Alert className="border-orange-200 bg-orange-50 py-2">
            <AlertCircleIcon className="h-4 w-4 stroke-black" />
            <AlertDescription className="text-orange-800 text-sm">
              You're in guest mode. Your work won't be saved.{" "}
              <Link href="/register" className="font-medium underline">
                Create an account now.
              </Link>
            </AlertDescription>
          </Alert>
        </ShowForGuest>

        <ShowForAdmin fallback={null}>
          <Alert className="border-blue-200 bg-blue-50 py-2">
            <AlertDescription className="flex items-center justify-center text-blue-800 text-sm">
              <Shield className="mr-2 h-4 w-4 text-black" />
              Admin privileges active
            </AlertDescription>
          </Alert>
        </ShowForAdmin>

        <div className="grid gap-2">
          <Link href="/dashboard">
            <Button variant="outline" className="w-full justify-start h-11 text-sm sm:text-base hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:border-zinc-600 dark:hover:border-zinc-400 transition-all duration-200">
              <Settings className="mr-2 h-4 w-4 flex-shrink-0" />
              My Dashboard
            </Button>
          </Link>
          <ShowForAdmin fallback={null}>
            <Link href="/admin">
              <Button variant="outline" className="w-full justify-start h-11 text-sm sm:text-base hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:border-zinc-600 dark:hover:border-zinc-400 transition-all duration-200">
                <Shield className="mr-2 h-4 w-4 flex-shrink-0" />
                Admin Panel
              </Button>
            </Link>
          </ShowForAdmin>
          <ShowForUser fallback={null}>
            <Link href="/profile">
              <Button variant="outline" className="w-full justify-start h-11 text-sm sm:text-base hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:border-zinc-600 dark:hover:border-zinc-400 transition-all duration-200">
                <User className="mr-2 h-4 w-4 flex-shrink-0" />
                Profile Settings
              </Button>
            </Link>
          </ShowForUser>
          <ShowForGuest>
            <Link href="/register">
              <Button className="w-full bg-green-600 hover:bg-green-700 h-11 text-sm sm:text-base">
                <UserCheck className="mr-2 h-4 w-4 flex-shrink-0" />
                Upgrade Account
              </Button>
            </Link>
          </ShowForGuest>
        </div>
      </CardContent>

      <CardFooter className="pt-4 px-4 sm:px-6">
        <Button
          variant="outline"
          className="w-full justify-start border-red-200 text-red-600 hover:bg-red-50 h-11 text-sm sm:text-base hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:border-zinc-600 dark:hover:border-zinc-400 transition-all duration-200"
          onClick={logout}
        >
          <LogOut className="mr-2 h-4 w-4 flex-shrink-0" />
          Sign Out
        </Button>
      </CardFooter>
    </div>
  );
};
