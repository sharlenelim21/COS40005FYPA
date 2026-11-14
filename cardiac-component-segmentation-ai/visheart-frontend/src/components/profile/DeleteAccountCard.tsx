"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { adminApi, authApi } from "@/lib/api";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type AdminCheck = "not-admin" | "checking" | "last-admin" | "other-admins" | "unknown";

function serverMessage(err: unknown, fallback: string) {
  const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

export function DeleteAccountCard({ username, role, isGuest }: { username: string; role: string; isGuest: boolean }) {
  const { endSession } = useAuth();
  const isAdmin = role === "admin";
  const [adminCheck, setAdminCheck] = useState<AdminCheck>(isAdmin ? "checking" : "not-admin");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!isAdmin) {
      setAdminCheck("not-admin");
      return;
    }
    let cancelled = false;
    setAdminCheck("checking");
    adminApi
      .getAllUsers()
      .then((result) => {
        if (cancelled) return;
        const users: { role?: string }[] = Array.isArray(result?.users) ? result.users : [];
        const admins = users.filter((user) => user.role === "admin").length;
        setAdminCheck(admins <= 1 ? "last-admin" : "other-admins");
      })
      .catch(() => {
        if (!cancelled) setAdminCheck("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const needsTypedConfirmation = isAdmin;
  const typedMatches = typed.trim() === username;
  const blockedReason = isGuest
    ? "Guest accounts are removed automatically when the session ends."
    : adminCheck === "checking"
      ? "Checking whether other administrators exist…"
      : adminCheck === "last-admin"
        ? "You are the only administrator. Make another account an administrator before deleting this one."
        : adminCheck === "unknown"
          ? "Could not check the other administrator accounts. Try again later."
          : null;

  const handleOpenChange = (next: boolean) => {
    if (deleting) return;
    setOpen(next);
    if (!next) setTyped("");
  };

  const handleDelete = async () => {
    if (needsTypedConfirmation && !typedMatches) return;
    setDeleting(true);
    try {
      const result = await authApi.deleteUser();
      if (result?.delete) {
        setOpen(false);
        toast.success("Your account has been deleted");
        endSession("/");
        return;
      }
      toast.error(result?.message || "Your account could not be deleted. Please try again.");
    } catch (err) {
      toast.error(serverMessage(err, "Your account could not be deleted. Please try again."));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card className="border-destructive">
      <CardHeader>
        <CardTitle className="text-destructive">Delete Account</CardTitle>
        <CardDescription>Permanently delete your account and all associated data.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button variant="destructive" className="w-full" disabled={blockedReason !== null} onClick={() => setOpen(true)}>
          Delete My Account
        </Button>
        {blockedReason && <p className="text-muted-foreground text-xs">{blockedReason}</p>}
        {adminCheck === "other-admins" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            You are an administrator. Deleting this account removes your admin access immediately.
          </p>
        )}

        <AlertDialog open={open} onOpenChange={handleOpenChange}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete the account &ldquo;{username}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                This can&apos;t be undone. The account, its saved projects and their data are permanently removed, and you
                will be signed out.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {needsTypedConfirmation && (
              <div className="space-y-2">
                <Label htmlFor="confirm-delete-username">
                  Type <span className="font-mono font-semibold">{username}</span> to confirm
                </Label>
                <Input
                  id="confirm-delete-username"
                  autoComplete="off"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  disabled={deleting}
                />
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={deleting || (needsTypedConfirmation && !typedMatches)}
              >
                {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {deleting ? "Deleting…" : "Delete account"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
