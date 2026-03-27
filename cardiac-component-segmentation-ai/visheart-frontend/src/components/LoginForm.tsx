"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useLogin } from "@/lib/login";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { Lock, User as UserIcon, Mail, Eye, EyeOff, LogIn, UserPlus, Zap, AlertTriangle, CheckCircle, ArrowRight, Shield, RefreshCw } from "lucide-react";

export const LoginForm = () => {
  const { username, setUsername, password, setPassword, error, loading, isRedirecting, handleLogin, handleGuestLogin } = useLogin("/dashboard");

  const [showPassword, setShowPassword] = useState(false);

  // Show redirecting state after successful login
  if (isRedirecting) {
    return (
      <div className="mx-auto flex h-screen w-full flex-col items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          <div className="text-center">
            <h2 className="text-lg font-semibold">Redirecting to Dashboard</h2>
            <p className="text-muted-foreground text-sm">Please wait while we prepare your workspace...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full flex-col items-center self-center justify-center sm:flex-row sm:my-30">
      {/* Brand Header */}
      <div className="my-8 text-center sm:w-[500px]">
        <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl ">
          <Image src="/visheart_logo.svg" alt="VisHeart Logo" width={64} height={64} className="h-full w-full object-contain " />
        </div>
        <h1 className="bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-3xl font-bold text-transparent dark:from-white dark:to-gray-300 text-shadow-2xs">VisHeart</h1>
        <p className="text-muted-foreground mt-1 text-shadow-2xs">Advanced Cardiac Imaging Platform</p>
      </div>

      {/* Main Login Card */}
      <div className="bg-card border-border mx-4 overflow-hidden rounded-2xl border sm:my-3 sm:h-[610px] sm:w-[500px] mb-10">
        <CardHeader className="from-muted/50 to-muted/30 border-border/50 border-b bg-gradient-to-r pt-6">
          <CardTitle className="flex items-center gap-2 text-xl font-semibold">
            <Shield className="text-primary h-5 w-5" />
            Sign In to Your Account
          </CardTitle>
          <CardDescription>Access your cardiac segmentation workspace and projects</CardDescription>
        </CardHeader>

        <form onSubmit={handleLogin}>
          <CardContent className="space-y-6 p-6">
            {/* Error Alert */}
            {error && (
              <Alert variant="destructive" className="border-red-200 bg-red-50 dark:bg-red-950/20">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="font-medium">{error}</AlertDescription>
              </Alert>
            )}

            {/* Username Field */}
            <div className="space-y-3">
              <Label htmlFor="username" className="flex items-center gap-2 text-sm font-medium">
                <UserIcon className="text-muted-foreground h-4 w-4" />
                Username
              </Label>
              <div className="group relative">
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  required
                  disabled={loading}
                  className="focus:border-primary group-hover:border-primary/50 h-12 border-2 pr-4 pl-4 text-base transition-all duration-200"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="flex items-center gap-2 text-sm font-medium">
                  <Lock className="text-muted-foreground h-4 w-4" />
                  Password
                </Label>
              </div>
              <div className="group relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  disabled={loading}
                  className="focus:border-primary group-hover:border-primary/50 h-12 border-2 pr-12 pl-4 text-base transition-all duration-200"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {/* Sign In Button */}
            <Button
              type="submit"
              disabled={loading}
              className="from-primary to-primary/90 hover:from-primary/90 hover:to-primary/80 h-12 w-full bg-gradient-to-r text-base font-semibold shadow-lg transition-all duration-200 hover:cursor-pointer hover:shadow-xl"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  Signing In...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <LogIn className="h-5 w-5" />
                  Sign In
                  <ArrowRight className="ml-auto h-4 w-4" />
                </div>
              )}
            </Button>
          </CardContent>

          {/* Alternative Actions */}
          <div className="px-6 pb-6">
            <div className="relative mb-6">
              <Separator />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="bg-card text-muted-foreground px-4 text-sm font-medium">Alternative Options</span>
              </div>
            </div>

            <div className="space-y-3">
              {/* Register Button */}
              <Link href="/register" className="block">
                <Button type="button" variant="outline" className="hover:bg-muted/50 h-11 w-full border-2 text-base font-medium transition-all duration-200 hover:cursor-pointer" disabled={loading}>
                  <UserPlus className="mr-2 h-5 w-5" />
                  Create New Account
                </Button>
              </Link>

              {/* Guest Access Button with Dialog */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-11 w-full border border-orange-200 bg-gradient-to-r from-orange-500/10 to-amber-500/10 text-base font-medium text-orange-700 transition-all duration-200 hover:cursor-pointer hover:bg-gradient-to-r hover:from-orange-500/20 hover:to-amber-500/20 dark:text-orange-300"
                    disabled={loading}
                  >
                    <Zap className="mr-2 h-5 w-5" />
                    Quick Guest Access
                  </Button>
                </AlertDialogTrigger>

                <AlertDialogContent className="max-w-md">
                  <AlertDialogHeader className="text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-500">
                      <Zap className="h-6 w-6 text-white" />
                    </div>
                    <AlertDialogTitle className="text-xl font-bold">Guest Access Mode</AlertDialogTitle>
                  </AlertDialogHeader>
                  
                  <div className="mt-4 space-y-4 text-left">
                    <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 dark:bg-orange-950/20">
                      <h4 className="mb-2 flex items-center gap-2 font-semibold text-orange-800 dark:text-orange-200">
                        <CheckCircle className="h-4 w-4" />
                        What you get:
                      </h4>
                      <ul className="space-y-1 text-sm text-orange-700 dark:text-orange-300">
                        <li>• Full access to all brushing tools and exports</li>
                        <li>• Real-time cardiac segmentation via Artificial Intelligence</li>
                        <li>• Interactive analysis features</li>
                      </ul>
                    </div>

                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:bg-red-950/20">
                      <h4 className="mb-2 flex items-center gap-2 font-semibold text-red-800 dark:text-red-200">
                        <AlertTriangle className="h-4 w-4" />
                        Important limitations:
                      </h4>
                      <ul className="space-y-1 text-sm text-red-700 dark:text-red-300">
                        <li>• Projects are temporary and will be deleted at 3am daily</li>
                        <li>• No data persistence after logout</li>
                        <li>• Cannot save work in cloud</li>
                      </ul>
                    </div>

                    <div className="bg-muted/50 rounded-lg p-3 text-center">
                      <p className="text-sm font-medium">💡 Create a free account to save your valuable work - only 2 minutes!</p>
                    </div>
                  </div>

                  <AlertDialogFooter className="flex-col space-y-2 sm:flex-row sm:space-y-0 sm:space-x-2">
                    <AlertDialogCancel className="h-10 w-full sm:w-auto">Go Back</AlertDialogCancel>
                    <div className="flex w-full gap-2 sm:w-auto">
                      <Link href="/register" className="flex-1">
                        <Button variant="outline" className="h-10 w-full">
                          <UserPlus className="mr-2 h-4 w-4" />
                          Register
                        </Button>
                      </Link>
                      <Button onClick={handleGuestLogin} disabled={loading} className="h-10 flex-1 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600">
                        <Zap className="mr-2 h-4 w-4" />
                        {loading ? "Loading..." : "Continue"}
                      </Button>
                    </div>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            {/* Footer Text */}
            <div className="border-border/50 mt-6 border-t pt-4 text-center">
              <p className="text-muted-foreground text-sm">Secure Storage • Smart Segmentation • Simple Solutions</p>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
