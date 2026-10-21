"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import { authApi } from "@/lib/api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, CheckCircle, Clock, Loader2, Stethoscope, Upload, XCircle } from "lucide-react";

/** Must match ALLOWED_PROFESSIONS in Cardiac_Segmentation_FYP_Server/src/routes/authentication.ts */
const PROFESSIONS = [
  "MRI Radiographer / Cardiac Imaging Technologist",
  "Cardiac Physiologist / Cardiovascular Technologist",
  "Nurse / Medical Assistant",
  "Doctor (Cardiologist)",
] as const;

function RequestAccessInner() {
  const { user, checkAuthStatus } = useAuth();
  const router = useRouter();

  const [profession, setProfession] = useState("");
  const [medicalId, setMedicalId] = useState("");
  const [requestedRole, setRequestedRole] = useState<"doctor" | "clinical_assistant" | "">("");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!profession || !medicalId.trim() || !requestedRole) {
      setError("Please fill in profession, medical ID, and requested access.");
      return;
    }
    if (!file) {
      setError("Please upload a photo or PDF of your staff ID card.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("File must be 5MB or smaller.");
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.set("profession", profession);
      formData.set("medicalId", medicalId.trim());
      formData.set("requestedRole", requestedRole);
      if (reason.trim()) formData.set("reason", reason.trim());
      formData.set("staffIdCard", file);

      const response = await authApi.requestElevation(formData);
      if (response.success) {
        setSubmitted(true);
        await checkAuthStatus();
      } else {
        setError(response.message || "Failed to submit your request.");
      }
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || "Failed to submit your request.");
    } finally {
      setSubmitting(false);
    }
  }, [profession, medicalId, requestedRole, reason, file, checkAuthStatus]);

  if (!user) return null;

  if (user.role !== "educational_user") {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Not applicable</AlertTitle>
          <AlertDescription>
            Your account already has {user.role === "doctor" ? "Doctor" : user.role === "clinical_assistant" ? "Clinical Assistant" : "elevated"} access.
          </AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/dashboard")}>Back to Dashboard</Button>
      </div>
    );
  }

  if (submitted || user.elevationStatus === "pending") {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Alert>
          <Clock className="h-4 w-4" />
          <AlertTitle>Request submitted</AlertTitle>
          <AlertDescription>
            Your staff verification request is pending review. An Admin will approve or reject it —
            you&apos;ll keep your current Educational access until then.
          </AlertDescription>
        </Alert>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/dashboard")}>Back to Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5" />
            Request Clinical Access
          </CardTitle>
          <CardDescription>
            Submit your profession, medical registration number, and a staff ID card. An Admin
            reviews every request before granting Doctor or Clinical Assistant access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {user.elevationStatus === "rejected" && (
            <Alert variant="destructive" className="mb-4">
              <XCircle className="h-4 w-4" />
              <AlertTitle>Your previous request was rejected</AlertTitle>
              <AlertDescription>You may submit a new request below.</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="profession">Profession *</Label>
              <Select value={profession} onValueChange={setProfession} disabled={submitting}>
                <SelectTrigger id="profession">
                  <SelectValue placeholder="Select your profession" />
                </SelectTrigger>
                <SelectContent>
                  {PROFESSIONS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="medicalId">Medical / Registration ID *</Label>
              <Input
                id="medicalId"
                value={medicalId}
                onChange={(e) => setMedicalId(e.target.value)}
                placeholder="e.g. MMC number, Nursing Board number, MAHPC number"
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="requestedRole">Requested Access *</Label>
              <Select value={requestedRole} onValueChange={(v: string) => setRequestedRole(v as "doctor" | "clinical_assistant")} disabled={submitting}>
                <SelectTrigger id="requestedRole">
                  <SelectValue placeholder="Select the access you need" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="doctor">Doctor</SelectItem>
                  <SelectItem value="clinical_assistant">Clinical Assistant</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="staffIdCard">Staff ID Card *</Label>
              <div className="relative">
                <Upload className="text-muted-foreground absolute top-3 left-3 h-4 w-4" />
                <Input
                  id="staffIdCard"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="pl-10"
                  disabled={submitting}
                />
              </div>
              <p className="text-xs text-muted-foreground">JPEG, PNG, WebP, or PDF — max 5MB. Visible only to an Admin reviewing your request.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Reason for access (optional)</Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                disabled={submitting}
              />
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Submit Request
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function RequestAccessPage() {
  return (
    <ProtectedRoute allowedRoles={["educational_user"]}>
      <RequestAccessInner />
    </ProtectedRoute>
  );
}
