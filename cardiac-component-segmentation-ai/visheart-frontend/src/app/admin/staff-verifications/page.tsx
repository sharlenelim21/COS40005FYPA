"use client";

import { useCallback, useEffect, useState } from "react";
import { authApi } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { RefreshCw, FileCheck, Eye, Check, X, Phone, Mail } from "lucide-react";
import { adminAlertStore } from "@/lib/adminAlerts";

interface PendingUser {
  _id: string;
  username: string;
  email: string;
  phone: string;
  profession?: string;
  medicalId?: string;
  requestedRole?: "doctor" | "clinical_assistant";
  elevationReason?: string;
  hasStaffIdCard?: boolean;
}

export default function StaffVerificationsPage() {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerType, setViewerType] = useState<string>("");
  const [viewerOpen, setViewerOpen] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await authApi.getPendingElevations();
      const list = data?.users ?? [];
      setUsers(list);
      // Visiting this page counts as reviewing the current backlog — stops the global
      // notifier from re-chiming about requests already visible here.
      adminAlertStore.markSeen("elevations", list.map((u: PendingUser) => u._id));
    } catch {
      if (!silent) toast.error("Failed to load pending staff verifications.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll in the background so a newly-submitted request (or another admin's approval)
  // shows up without a manual refresh. Silent so it never flashes the skeleton loader,
  // and paused while an approve/reject is in flight or the ID card viewer is open so a
  // background refresh can't yank the list out from under an in-progress action.
  useEffect(() => {
    const interval = setInterval(() => {
      if (workingId || viewerOpen) return;
      void load(true);
    }, 15000);
    return () => clearInterval(interval);
  }, [load, workingId, viewerOpen]);

  const viewIdCard = async (userId: string) => {
    try {
      const blob = await authApi.getStaffIdCardBlob(userId);
      const url = URL.createObjectURL(blob);
      setViewerUrl(url);
      setViewerType(blob.type);
      setViewerOpen(true);
    } catch {
      toast.error("Failed to load the staff ID card.");
    }
  };

  const closeViewer = () => {
    if (viewerUrl) URL.revokeObjectURL(viewerUrl);
    setViewerUrl(null);
    setViewerOpen(false);
  };

  const approve = async (userId: string, role: "doctor" | "clinical_assistant") => {
    setWorkingId(userId);
    try {
      await authApi.approveElevation(userId, role);
      toast.success(`Approved as ${role === "doctor" ? "Doctor" : "Clinical Assistant"}.`);
      await load(true);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Failed to approve.");
    } finally {
      setWorkingId(null);
    }
  };

  const reject = async (userId: string) => {
    setWorkingId(userId);
    try {
      await authApi.rejectElevation(userId);
      toast.success("Request rejected.");
      await load(true);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Failed to reject.");
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Staff Verifications</h1>
          <p className="text-muted-foreground">
            Review educational accounts requesting Doctor or Clinical Assistant access.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            Pending requests ({users.length})
          </CardTitle>
          <CardDescription>Role is never changed until you approve a specific request below.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending staff verification requests.</p>
          ) : (
            <div className="space-y-4">
              {users.map((u) => (
                <div key={u._id} className="rounded-lg border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{u.username}</span>
                        <Badge variant="secondary">
                          Requested: {u.requestedRole === "doctor" ? "Doctor" : "Clinical Assistant"}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{u.email}</span>
                        <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{u.phone}</span>
                      </div>
                      <p className="text-sm"><span className="text-muted-foreground">Profession:</span> {u.profession}</p>
                      <p className="text-sm"><span className="text-muted-foreground">Medical ID:</span> {u.medicalId}</p>
                      {u.elevationReason && (
                        <p className="text-sm"><span className="text-muted-foreground">Reason:</span> {u.elevationReason}</p>
                      )}
                    </div>
                    <div className="flex flex-shrink-0 flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => void viewIdCard(u._id)} disabled={!u.hasStaffIdCard}>
                        <Eye className="mr-1 h-3 w-3" />
                        View ID Card
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-600 hover:bg-red-50"
                        disabled={workingId === u._id}
                        onClick={() => void reject(u._id)}
                      >
                        <X className="mr-1 h-3 w-3" />
                        Reject
                      </Button>
                      {/* The profession they declared decides which single role they can be
                          approved as — a cardiologist can only be approved as Doctor, every
                          other listed profession only as Clinical Assistant. */}
                      {u.profession === "Doctor (Cardiologist)" ? (
                        <Button
                          size="sm"
                          disabled={workingId === u._id}
                          onClick={() => void approve(u._id, "doctor")}
                        >
                          <Check className="mr-1 h-3 w-3" />
                          Approve as Doctor
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={workingId === u._id}
                          onClick={() => void approve(u._id, "clinical_assistant")}
                        >
                          <Check className="mr-1 h-3 w-3" />
                          Approve as Assistant
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={viewerOpen} onOpenChange={(open) => { if (!open) closeViewer(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Staff ID Card</DialogTitle>
          </DialogHeader>
          {viewerUrl && (
            viewerType === "application/pdf" ? (
              <iframe src={viewerUrl} className="h-[70vh] w-full rounded border" title="Staff ID card" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewerUrl} alt="Staff ID card" className="max-h-[70vh] w-full rounded border object-contain" />
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
