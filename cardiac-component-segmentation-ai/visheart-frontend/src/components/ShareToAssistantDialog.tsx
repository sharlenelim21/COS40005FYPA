"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PlayCircle, Eye } from "lucide-react";
import { authApi, projectApi } from "@/lib/api";

interface ClinicalAssistant {
  _id: string;
  username: string;
  email: string;
}

type ShareMode = "run" | "view_only";

interface ShareToAssistantDialogProps {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShared?: () => void;
}

// A Doctor picks one of their known Clinical Assistants to share a case with. The project stays
// theirs — this only adds the assistant's access, it never changes ownership. Two modes:
// "Request to Run" (the assistant can run AI / edit — their edits save as drafts for the Doctor
// to review) or "Share as View-Only" (the assistant can open the case and switch between its
// result tabs, but every run/edit/export action is blocked server-side).
export function ShareToAssistantDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
  onShared,
}: ShareToAssistantDialogProps) {
  const [assistants, setAssistants] = useState<ClinicalAssistant[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [mode, setMode] = useState<ShareMode>("run");
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected("");
    setMode("run");
    setInstructions("");
    setLoading(true);
    authApi
      .getClinicalAssistants()
      .then((data) => setAssistants(data?.users ?? []))
      .catch(() => toast.error("Could not load Clinical Assistant accounts."))
      .finally(() => setLoading(false));
  }, [open]);

  const handleShare = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      await projectApi.assignAssistant(projectId, selected, mode, mode === "run" ? instructions.trim() : undefined);
      const assistant = assistants.find((a) => a._id === selected);
      toast.success(`Shared "${projectName}" with ${assistant?.username ?? "the assistant"}.`);
      onShared?.();
      onOpenChange(false);
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Failed to share the project.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share with Clinical Assistant</DialogTitle>
          <DialogDescription>
            Choose how much they can do on &quot;{projectName}&quot;. Your own work is never
            overwritten either way.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="h-10 animate-pulse rounded-md bg-muted" />
        ) : assistants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No Clinical Assistant accounts exist yet. Ask an Admin to create one first.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Clinical Assistant</Label>
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a Clinical Assistant" />
                </SelectTrigger>
                <SelectContent>
                  {assistants.map((assistant) => (
                    <SelectItem key={assistant._id} value={assistant._id}>
                      {assistant.username} ({assistant.email})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Access level</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode("run")}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                    mode === "run" ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <PlayCircle className="h-4 w-4" />
                    Request to Run
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Can run AI, edit masks (as a draft), export
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("view_only")}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                    mode === "view_only" ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Eye className="h-4 w-4" />
                    Share as View-Only
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Can only view results — no running, no editing
                  </span>
                </button>
              </div>
            </div>

            {mode === "run" && (
              <div className="space-y-2">
                <Label htmlFor="instructions">Instructions (optional)</Label>
                <Textarea
                  id="instructions"
                  placeholder="e.g. Please run segmentation and landmark detection, then check the strain results"
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  rows={3}
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleShare()} disabled={!selected || submitting}>
            {submitting ? "Sharing…" : "Share"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
