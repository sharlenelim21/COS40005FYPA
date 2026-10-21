"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, X, FileEdit } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { segmentationApi } from "@/lib/api";

interface DraftMask {
  _id: string;
  name: string;
  createdByUsername: string | null;
  createdAt?: string;
}

interface MaskReviewPanelProps {
  projectId: string;
  onReviewed?: () => void;
}

// Shown to a Doctor (or Admin) on a project's page whenever a Clinical Assistant has submitted a
// mask edit as a draft. Accept promotes it to the project's final mask; Discard rejects it. The
// Doctor's own original mask is never touched by either action.
export function MaskReviewPanel({ projectId, onReviewed }: MaskReviewPanelProps) {
  const [drafts, setDrafts] = useState<DraftMask[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await segmentationApi.getProjectDrafts(projectId);
      setDrafts(data?.drafts ?? []);
    } catch {
      // Non-owners get a 403 here (e.g. a Clinical Assistant viewing their own shared case) —
      // treat it the same as "nothing to review" rather than surfacing an error toast.
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const respond = async (maskId: string, action: "accept" | "discard") => {
    setWorkingId(maskId);
    try {
      if (action === "accept") {
        await segmentationApi.acceptDraftMask(maskId);
        toast.success("Draft accepted — it's now the project's final mask.");
      } else {
        await segmentationApi.discardDraftMask(maskId);
        toast.success("Draft discarded.");
      }
      await load();
      onReviewed?.();
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || "Failed to update the draft.");
    } finally {
      setWorkingId(null);
    }
  };

  if (loading || drafts.length === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileEdit className="h-4 w-4" />
          Pending review ({drafts.length})
        </CardTitle>
        <CardDescription>
          A Clinical Assistant edited the segmentation. Review and accept or discard each draft —
          your own original mask stays untouched either way.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {drafts.map((draft) => (
          <div
            key={draft._id}
            className="flex flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{draft.name}</p>
              <Badge variant="secondary" className="mt-1">
                Submitted by {draft.createdByUsername ?? "a Clinical Assistant"}
              </Badge>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-red-200 text-red-600 hover:bg-red-50"
                disabled={workingId === draft._id}
                onClick={() => void respond(draft._id, "discard")}
              >
                <X className="mr-1 h-4 w-4" />
                Discard
              </Button>
              <Button
                size="sm"
                disabled={workingId === draft._id}
                onClick={() => void respond(draft._id, "accept")}
              >
                <Check className="mr-1 h-4 w-4" />
                Accept
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
