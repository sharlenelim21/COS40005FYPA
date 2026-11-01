"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/auth-context";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Link from "next/link";
import { authApi } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Toaster, toast } from "sonner";
import { User, Shield, UserCheck, RefreshCw, AlertCircle } from "lucide-react";

const profileSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
});

const passwordSchema = z
  .object({
    old_password: z.string().min(1, "Old password is required"),
    password: z.string().min(8, "New password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export default function ProfilePage() {
  const { user, loading, error, logout } = useAuth();
  const [userData, setUserData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const profileForm = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      username: "",
      email: "",
      phone: "",
    },
  });

  const passwordForm = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      old_password: "",
      password: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    const fetchUserData = async () => {
      if (user) {
        try {
          setIsLoading(true);
          const response = await authApi.fetchUser();
          if (response.fetch) {
            setUserData(response.user);
            profileForm.reset({
              username: response.user.username,
              email: response.user.email,
              phone: response.user.phone || "",
            });
          }
        } catch (err) {
          toast.error("Failed to fetch user data.");
        } finally {
          setIsLoading(false);
        }
      } else {
        setIsLoading(false);
      }
    };
    fetchUserData();
  }, [user, profileForm]);

  const onProfileSubmit = async (values: z.infer<typeof profileSchema>) => {
    setIsSubmitting(true);
    try {
      const result = await authApi.updateUser(values);
      if (result.update) {
        toast.success("Profile updated successfully!");
        setUserData(result.user);
      } else {
        toast.error(result.message || "Failed to update profile.");
      }
    } catch (err: any) {
      toast.error(err.message || "An error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const onPasswordSubmit = async (values: z.infer<typeof passwordSchema>) => {
    setIsSubmitting(true);
    try {
      const result = await authApi.updatePassword({
        currentPassword: values.old_password,
        newPassword: values.password,
      });
      if (result.update) {
        toast.success("Password updated successfully!");
        passwordForm.reset();
      } else {
        toast.error(result.message || "Failed to update password.");
      }
    } catch (err: any) {
      toast.error(err.message || "An error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAccount = async () => {
    try {
      const result = await authApi.deleteUser();
      if (result.delete) {
        toast.success("Account deleted successfully.");
        logout();
      } else {
        toast.error(result.message || "Failed to delete account.");
      }
    } catch (err: any) {
      toast.error(err.message || "An error occurred.");
    }
  };

  const getRoleIcon = (role: string | undefined) => {
    switch (role) {
      case "admin":
        return <Shield className="h-5 w-5 text-blue-600" />;
      case "user":
        return <UserCheck className="h-5 w-5 text-green-600" />;
      case "guest":
        return <User className="h-5 w-5 text-gray-500" />;
      default:
        return <User className="h-5 w-5" />;
    }
  };

  if (loading || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Error: {error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Please log in to view your profile.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const isGuest = user.role === "guest";

  return (
    <div className="">
      <Toaster richColors />
      <div className="container mx-auto max-w-4xl space-y-8 p-4 md:p-8">
        <div className="flex items-center gap-4">
          {getRoleIcon(user.role)}
          <div>
            <h1 className="text-3xl font-bold">{userData?.username}</h1>
            <p className="text-muted-foreground">Manage your account settings and preferences.</p>
          </div>
        </div>

        {isGuest && (
          <Alert variant="default" className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/30">
            <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
            <AlertDescription className="text-yellow-800 dark:text-yellow-200">
              You are currently in guest mode. To save your data and access all features, please{" "}
              <Link href="/register" className="font-semibold underline hover:text-yellow-900 dark:hover:text-yellow-100">
                register for a full account
              </Link>
              .
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-8 md:grid-cols-2">
          {/* Profile Information */}
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>Update your personal details.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...profileForm}>
                <form onSubmit={profileForm.handleSubmit(onProfileSubmit)} className="space-y-4">
                  <FormField
                    control={profileForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
                        <FormControl>
                          <Input placeholder="Your username" {...field} disabled={isGuest || isSubmitting} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={profileForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="Your email" {...field} disabled={isGuest || isSubmitting} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={profileForm.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input placeholder="Your phone number" {...field} disabled={isGuest || isSubmitting} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormItem>
                    <FormLabel>Account Created</FormLabel>
                    <FormControl>
                      <Input value={userData?.createdAt ? new Date(userData.createdAt).toLocaleString() : "N/A"} disabled />
                    </FormControl>
                  </FormItem>
                  <FormItem>
                    <FormLabel>Last Updated</FormLabel>
                    <FormControl>
                      <Input value={userData?.updatedAt ? new Date(userData.updatedAt).toLocaleString() : "N/A"} disabled />
                    </FormControl>
                  </FormItem>
                  <Button type="submit" disabled={isGuest || isSubmitting} className="w-full">
                    {isSubmitting ? "Saving..." : "Save Changes"}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          {/* Security Settings */}
          <div className="space-y-8">
            <Card>
              <CardHeader>
                <CardTitle>Change Password</CardTitle>
                <CardDescription>Update your password for better security.</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...passwordForm}>
                  <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
                    <FormField
                      control={passwordForm.control}
                      name="old_password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Old Password</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="••••••••" {...field} disabled={isGuest || isSubmitting} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={passwordForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>New Password</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="••••••••" {...field} disabled={isGuest || isSubmitting} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={passwordForm.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confirm New Password</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="••••••••" {...field} disabled={isGuest || isSubmitting} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" disabled={isGuest || isSubmitting} className="w-full">
                      {isSubmitting ? "Updating..." : "Update Password"}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>

            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive">Delete Account</CardTitle>
                <CardDescription>Permanently delete your account and all associated data.</CardDescription>
              </CardHeader>
              <CardContent>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" className="w-full" disabled={isGuest}>
                      Delete My Account
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                      <AlertDialogDescription>This action cannot be undone. This will permanently delete your account and remove your data from our servers.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDeleteAccount}>Continue</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
