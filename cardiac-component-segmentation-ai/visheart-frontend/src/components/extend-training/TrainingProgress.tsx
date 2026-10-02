"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle, Circle, Loader2, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { elapsed, isActiveJob, retrainingApi, RetrainingStatus, StepState, TrainingJob } from "@/lib/retraining-api";
import { jobOutcome } from "@/components/extend-training/logic";

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") return <CheckCircle className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />;
  if (state === "running") return <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />;
  if (state === "pending") return <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />;
  return <XCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />;
}

function StepDetail({ job, stepKey }: { job: TrainingJob; stepKey: string }) {
  const progress = job.progress;
  if (stepKey === "prepare") {
    const chosen = job.params.cases ?? [];
    return (
      <p className="text-sm text-muted-foreground">
        {chosen.length
          ? `${chosen.length} ${chosen.length === 1 ? "case" : "cases"} you chose, ${chosen.reduce((sum, item) => sum + item.slices, 0)} corrected slices`
          : progress.corrections
            ? `${progress.corrections.slices} corrected slices from ${progress.corrections.projects} projects`
            : "Collecting the saved corrections"}
      </p>
    );
  }
  if (stepKey === "train" && progress.epochs) {
    const epoch = progress.epoch ?? 0;
    return (
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">Epoch {epoch} of {progress.epochs}</p>
        <Progress value={(epoch / progress.epochs) * 100} />
      </div>
    );
  }
  if (stepKey === "evaluate" && progress.total) {
    const scored = progress.scored ?? 0;
    return (
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {scored} of {progress.total} scans the model has never seen are scored
          {progress.scoring_active_first ? " (the model in use is scored first)" : ""}
        </p>
        <Progress value={(scored / progress.total) * 100} />
      </div>
    );
  }
  if (stepKey === "examples") {
    const examples = progress.examples;
    return (
      <p className="text-sm text-muted-foreground">
        {examples?.total ? `${examples.done} of ${examples.total} example scans` : "Choosing the scans to show"}
      </p>
    );
  }
  return null;
}

function JobLog({ job }: { job: TrainingJob }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const running = isActiveJob(job);

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    const load = async () => {
      const reply = await retrainingApi.log(job.id, 200);
      if (!stopped && reply.success && reply.data) setLines(reply.data.lines);
    };
    void load();
    const timer = running ? window.setInterval(() => void load(), 5000) : undefined;
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [open, job.id, running]);

  return (
    <details className="rounded-md border p-3" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium">Technical log</summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
        {lines.length ? lines.join("\n") : "No output yet."}
      </pre>
    </details>
  );
}

const ENDINGS: Record<string, string> = {
  failed: "Training did not finish",
  cancelled: "Training was cancelled",
  interrupted: "Training was interrupted",
};

export function TrainingProgress({ job, status, onChanged }: {
  job: TrainingJob;
  status: Pick<RetrainingStatus, "active" | "versions">;
  onChanged: () => void;
}) {
  // The version may have been used or deleted since the training finished; say so rather than "nothing has changed".
  const outcome = job.result ? jobOutcome(job.result.label, status.active, status.versions) : null;
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const running = isActiveJob(job);
  const lastState: StepState = job.state === "succeeded" ? "done" : running ? "pending" : "failed";

  const cancel = async () => {
    setCancelling(true);
    const reply = await retrainingApi.cancel(job.id);
    setCancelling(false);
    setConfirming(false);
    if (reply.success) toast.success("Training cancelled. The model in use has not changed.");
    else toast.error(reply.message);
    onChanged();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{running ? "Training in progress" : "Last training"}</CardTitle>
        <CardDescription>
          Started by {job.requested_by}
          {job.started_at ? ` · ${running ? "running for" : "took"} ${elapsed(job.started_at, running ? null : job.finished_at)}` : ""}
          {job.params.label ? ` · new version ${job.params.label}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {running && (
          <Alert>
            <AlertTitle>You can close this page</AlertTitle>
            <AlertDescription>
              Training continues on this computer. Open this page again at any time to see where it is. Only one
              training can run at a time.
            </AlertDescription>
          </Alert>
        )}
        <ol className="space-y-3">
          {job.steps.map(step => (
            <li key={step.key} className="flex gap-3">
              <StepIcon state={step.state} />
              <div className="flex-1 space-y-1">
                <p className={step.state === "running" ? "font-medium" : step.state === "pending" ? "text-muted-foreground" : ""}>
                  {step.title}
                </p>
                {step.state === "running" && <StepDetail job={job} stepKey={step.key} />}
              </div>
            </li>
          ))}
          <li className="flex gap-3">
            <StepIcon state={lastState} />
            <p className={job.state === "succeeded" ? "font-medium" : "text-muted-foreground"}>Ready for review</p>
          </li>
        </ol>
        {job.state === "succeeded" && job.result && (
          <Alert>
            <AlertTitle>{job.result.simulated ? "Simulation finished" : outcome?.title}</AlertTitle>
            <AlertDescription>
              {outcome?.text}
              {job.progress.examples?.error
                ? ` The example scans could not be prepared (${job.progress.examples.error}); the comparison is complete.`
                : ""}
            </AlertDescription>
          </Alert>
        )}
        {!running && job.error && (
          <Alert variant="destructive">
            <AlertTitle>{ENDINGS[job.state] ?? "Training stopped"}</AlertTitle>
            <AlertDescription>{job.error}</AlertDescription>
          </Alert>
        )}
        {running && (
          <Button variant="outline" onClick={() => setConfirming(true)} disabled={cancelling}>
            Cancel training
          </Button>
        )}
        <JobLog job={job} />
      </CardContent>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this training?</AlertDialogTitle>
            <AlertDialogDescription>
              The work done so far is lost and nothing is added to the versions list. The model in use does not
              change. You can start a new training afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep training</AlertDialogCancel>
            <Button variant="destructive" onClick={() => void cancel()} disabled={cancelling}>
              {cancelling ? "Cancelling…" : "Cancel training"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
