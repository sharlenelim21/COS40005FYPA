"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { retrainingApi, SwitchPreview, VersionAction } from "@/lib/retraining-api";

export interface SwitchTarget {
  label: string;
  action: VersionAction;
}

type Action = SwitchPreview["action"];
const TITLES: Record<Action, (label: string) => string> = {
  activate: label => `Use ${label}?`,
  rollback: () => "Go back to the original model?",
  reject: label => `Discard ${label}?`,
};
const BUTTONS: Record<Action, string> = { activate: "Use this version", rollback: "Go back to the original", reject: "Discard it" };
const DONE: Record<Action, (label: string) => string> = {
  activate: label => `${label} is now in use.`,
  rollback: () => "The original model is in use again.",
  reject: label => `${label} was discarded.`,
};

export function SwitchDialog({ target, onClose, onDone }: {
  target: SwitchTarget | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [preview, setPreview] = useState<SwitchPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const load = useCallback(async (next: SwitchTarget) => {
    setPreview(null);
    const reply = await retrainingApi.preview(next.label, next.action);
    if (reply.success && reply.data) setPreview(reply.data);
    else setProblem(reply.message);
  }, []);

  useEffect(() => {
    setProblem(null);
    setPreview(null);
    if (target) void load(target);
  }, [target, load]);

  const confirm = async () => {
    if (!target || !preview) return;
    setWorking(true);
    const reply = target.action === "reject"
      ? await retrainingApi.reject(target.label, preview.confirm)
      : await retrainingApi.activate(target.label, preview.confirm);
    setWorking(false);
    if (!reply.success) {
      if (reply.status === 409) {
        setProblem(reply.message); // something changed after it was shown: show the new situation before any retry
        await load(target);
      } else {
        toast.error(reply.message);
      }
      return;
    }
    const restartError = (reply.data as { restart_error?: string | null } | null)?.restart_error;
    if (restartError) toast.warning(`Changed, but the segmentation service did not restart: ${restartError}. Restart it from Docker Desktop.`);
    else toast.success(DONE[preview.action](target.label));
    onDone();
  };

  const action: Action = preview?.action ?? (target?.action === "reject" ? "reject" : "activate");
  const deletions = preview ? preview.confirm.filter(line => !preview.warnings.includes(line)) : [];

  return (
    <AlertDialog open={target !== null} onOpenChange={open => { if (!open && !working) onClose(); }}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{target ? TITLES[action](target.label) : ""}</AlertDialogTitle>
          <AlertDialogDescription>Read this first. Nothing changes until you confirm.</AlertDialogDescription>
        </AlertDialogHeader>
        {problem && (
          <Alert variant="destructive"><AlertDescription>{problem}</AlertDescription></Alert>
        )}
        {!preview && !problem && <div className="h-24 animate-pulse rounded-md bg-muted" />}
        {preview?.refusal && (
          <Alert variant="destructive"><AlertDescription>This cannot be done now: {preview.refusal}</AlertDescription></Alert>
        )}
        {preview && !preview.refusal && (
          <div className="space-y-3 text-sm">
            {preview.warnings.length > 0 && (
              <div>
                <p className="font-medium text-red-600 dark:text-red-400">Warnings: it scored lower, or its comparison is incomplete</p>
                <ul className="list-disc space-y-1 pl-5">{preview.warnings.map(line => <li key={line}>{line}</li>)}</ul>
              </div>
            )}
            {preview.warnings.length === 0 && action !== "reject" && <p>No warnings.</p>}
            {deletions.length > 0 && (
              <div>
                <p className="font-medium">Deleted for good</p>
                <ul className="list-disc space-y-1 pl-5">{deletions.map(line => <li key={line}>{line}</li>)}</ul>
              </div>
            )}
            {action !== "reject" && (
              <p className="text-muted-foreground">
                The segmentation service restarts to load the model, so a segmentation running at that moment stops.
                The original model is always kept.
              </p>
            )}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Keep things as they are</AlertDialogCancel>
          <Button
            variant={action === "reject" ? "destructive" : "default"}
            disabled={!preview || Boolean(preview.refusal) || working}
            onClick={() => void confirm()}
          >
            {working ? "Working…" : BUTTONS[action]}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
